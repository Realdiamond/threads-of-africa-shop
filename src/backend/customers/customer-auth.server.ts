import { randomBytes } from "node:crypto";

import { and, eq, gt, lt, ne, or, sql } from "drizzle-orm";

import type { AuthResult, CustomerView } from "@/lib/customer-types";

import { hashToken, normaliseEmail } from "../auth/admin-auth.server";
import {
  hashPassword,
  passwordProblem,
  verifyAgainstDummy,
  verifyPassword,
} from "../auth/password.server";
import { getDb, type Db, type Executor } from "../db/client.server";
import { customerSessions, customerTokens, customers, orders } from "../db/schema";
import {
  activationEmail,
  alreadyRegisteredEmail,
  passwordChangedEmail,
  resetEmail,
} from "../email/customer-templates.server";
import { queueEmail } from "../email/outbox.server";
import { pgError, UNIQUE_VIOLATION } from "../pg-error.server";
import { withinRateLimit } from "../rate-limit.server";
import { getSettings } from "../settings.server";
import { siteUrl } from "../site-url.server";

// A session dies after 60 days no matter what, and after 14 days without use.
export const CUSTOMER_SESSION_ABSOLUTE_SECONDS = 60 * 24 * 60 * 60;
export const CUSTOMER_SESSION_IDLE_SECONDS = 14 * 24 * 60 * 60;
const ACTIVATE_MINUTES = 24 * 60;
const RESET_MINUTES = 60;
// At most this many account emails go to one address per hour, whoever asks.
const EMAILS_PER_ADDRESS_PER_HOUR = 3;

export type CustomerPrincipal = CustomerView;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fail = (code: Extract<AuthResult, { ok: false }>["code"], message: string) =>
  ({ ok: false, code, message }) as const;

const toPrincipal = (row: typeof customers.$inferSelect): CustomerPrincipal => ({
  id: row.id,
  email: row.email,
  name: row.name,
});

const newToken = (prefix: "c" | "s") => `${prefix}${randomBytes(32).toString("base64url")}`;

export { normaliseEmail };

// ---------------------------------------------------------------------------------------------
// Sessions

export async function purgeExpiredCustomerData(db: Db = getDb()) {
  await db
    .delete(customerSessions)
    .where(
      or(
        lt(customerSessions.expiresAt, sql`now()`),
        lt(
          customerSessions.lastUsedAt,
          sql`now() - ${CUSTOMER_SESSION_IDLE_SECONDS} * interval '1 second'`,
        ),
      ),
    );
  await db
    .delete(customerTokens)
    .where(lt(customerTokens.expiresAt, sql`now() - interval '7 days'`));
}

async function startSession(ex: Pick<Executor, "insert" | "update">, customerId: string) {
  const token = newToken("s");
  await ex.insert(customerSessions).values({
    tokenHash: hashToken(token),
    customerId,
    expiresAt: sql`now() + ${CUSTOMER_SESSION_ABSOLUTE_SECONDS} * interval '1 second'`,
  });
  await ex
    .update(customers)
    .set({ lastLoginAt: sql`now()` })
    .where(eq(customers.id, customerId));
  return token;
}

export async function resolveCustomerSession(
  token: string,
  db: Db = getDb(),
): Promise<CustomerPrincipal | null> {
  const [row] = await db
    .select({ session: customerSessions, customer: customers })
    .from(customerSessions)
    .innerJoin(customers, eq(customers.id, customerSessions.customerId))
    .where(
      and(
        eq(customerSessions.tokenHash, hashToken(token)),
        gt(customerSessions.expiresAt, sql`now()`),
        gt(
          customerSessions.lastUsedAt,
          sql`now() - ${CUSTOMER_SESSION_IDLE_SECONDS} * interval '1 second'`,
        ),
      ),
    );
  if (!row) return null;
  // Refresh the idle timer, but at most once an hour so reads stay cheap.
  await db
    .update(customerSessions)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(customerSessions.id, row.session.id),
        lt(customerSessions.lastUsedAt, sql`now() - interval '1 hour'`),
      ),
    );
  return toPrincipal(row.customer);
}

// Logging out deletes the session row; clearing the cookie alone would leave a live token.
export async function endCustomerSession(token: string, db: Db = getDb()) {
  await db.delete(customerSessions).where(eq(customerSessions.tokenHash, hashToken(token)));
}

async function endOtherSessions(
  ex: Pick<Executor, "delete">,
  customerId: string,
  keepToken?: string,
) {
  await ex
    .delete(customerSessions)
    .where(
      and(
        eq(customerSessions.customerId, customerId),
        keepToken ? ne(customerSessions.tokenHash, hashToken(keepToken)) : undefined,
      ),
    );
}

// ---------------------------------------------------------------------------------------------
// One-time email links

type TokenKind = "activate" | "reset";

// Issuing a link cancels any earlier unused link of the same kind, so only the newest works.
async function issueToken(
  tx: Pick<Executor, "insert" | "delete">,
  customerId: string,
  kind: TokenKind,
) {
  const token = newToken("c");
  await tx
    .delete(customerTokens)
    .where(and(eq(customerTokens.customerId, customerId), eq(customerTokens.kind, kind)));
  await tx.insert(customerTokens).values({
    customerId,
    kind,
    tokenHash: hashToken(token),
    expiresAt: sql`now() + make_interval(mins => ${kind === "activate" ? ACTIVATE_MINUTES : RESET_MINUTES})`,
  });
  return token;
}

async function findLiveToken(
  ex: Pick<Executor, "select">,
  token: string,
  kind: TokenKind,
  lock = false,
) {
  const query = ex
    .select({ token: customerTokens, customer: customers })
    .from(customerTokens)
    .innerJoin(customers, eq(customers.id, customerTokens.customerId))
    .where(
      and(
        eq(customerTokens.tokenHash, hashToken(token)),
        eq(customerTokens.kind, kind),
        sql`${customerTokens.usedAt} is null`,
        gt(customerTokens.expiresAt, sql`now()`),
      ),
    );
  // Locking makes two clicks on the same link at the same instant take turns, so it works once.
  const [row] = lock ? await query.for("update") : await query;
  return row ?? null;
}

// Orders placed as a guest become the customer's once their email address is proven.
async function linkOrders(tx: Pick<Executor, "update">, customerId: string, email: string) {
  await tx
    .update(orders)
    .set({ customerId })
    .where(and(eq(orders.email, email), sql`${orders.customerId} is null`));
}

const accountUrl = (path: string) => `${siteUrl()}/account/${path}`;

// A few emails per address per hour, no matter who is asking; beyond that we quietly do nothing
// (the response is the same either way, so this reveals nothing).
const mayEmail = (email: string) =>
  withinRateLimit(`customer-mail:${email}`, EMAILS_PER_ADDRESS_PER_HOUR, 60 * 60 * 1000);

// ---------------------------------------------------------------------------------------------
// Creating an account

// Always answers "check your email", whether or not the address already has an account.
export async function register(
  input: { email: string; name: string },
  db: Db = getDb(),
): Promise<AuthResult> {
  const email = normaliseEmail(input.email);
  const name = input.name.trim();
  if (!EMAIL.test(email) || email.length > 254) {
    return fail("INVALID", "Enter a valid email address.");
  }
  if (!name || name.length > 100) return fail("INVALID", "Enter your name.");
  if (!mayEmail(email)) return { ok: true };

  const shop = await getSettings(db);
  const attempt = () =>
    db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(customers)
        .where(eq(customers.email, email))
        .for("update");

      if (existing?.passwordHash) {
        const mail = alreadyRegisteredEmail(shop, accountUrl("login"), accountUrl("forgot"));
        await queueEmail(tx, {
          ...mail,
          to: email,
          kind: "customer_already_registered",
          // Once a day is plenty, however often someone retries.
          dedupeKey: `already-registered:${existing.id}:${new Date().toISOString().slice(0, 10)}`,
        });
        return;
      }

      const customer =
        existing ?? (await tx.insert(customers).values({ email, name }).returning())[0];
      if (!customer) throw new Error("customer insert returned no row");
      const token = await issueToken(tx, customer.id, "activate");
      const mail = activationEmail(
        shop,
        customer.name || name,
        `${accountUrl("activate")}?t=${token}`,
      );
      await queueEmail(tx, { ...mail, to: email, kind: "customer_activation" });
    });

  try {
    await attempt();
  } catch (error) {
    // Two sign-ups for the same address at once: the second simply takes the existing-account path.
    if (pgError(error).code !== UNIQUE_VIOLATION) throw error;
    await attempt();
  }
  return { ok: true };
}

export type SessionResult = { sessionToken: string; customer: CustomerPrincipal };

// The email link: the owner of the address chooses a password, which also proves the address.
export async function activateAccount(
  token: string,
  password: string,
  db: Db = getDb(),
): Promise<AuthResult<SessionResult>> {
  const found = await findLiveToken(db, token, "activate");
  if (!found || found.customer.passwordHash) {
    return fail("INVALID_TOKEN", "This link has expired or was already used. Request a new one.");
  }
  const problem = passwordProblem(password, found.customer.email);
  if (problem) return fail("WEAK_PASSWORD", problem);
  const passwordHash = await hashPassword(password);

  return db.transaction(async (tx) => {
    const live = await findLiveToken(tx, token, "activate", true);
    if (!live) return fail("INVALID_TOKEN", "This link has expired or was already used.");
    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, live.customer.id))
      .for("update");
    if (!customer || customer.passwordHash) {
      return fail("INVALID_TOKEN", "This link has expired or was already used.");
    }
    const [updated] = await tx
      .update(customers)
      .set({ passwordHash, emailVerifiedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(customers.id, customer.id))
      .returning();
    await tx.delete(customerTokens).where(eq(customerTokens.customerId, customer.id));
    await linkOrders(tx, customer.id, customer.email);
    const sessionToken = await startSession(tx, customer.id);
    return { ok: true as const, sessionToken, customer: toPrincipal(updated ?? customer) };
  });
}

// ---------------------------------------------------------------------------------------------
// Signing in and out

export async function loginCustomer(
  emailInput: string,
  password: string,
  db: Db = getDb(),
): Promise<AuthResult<SessionResult>> {
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.email, normaliseEmail(emailInput)));
  // One generic failure for every reason (no account, not activated yet, wrong password), taking
  // the same time, so the response never reveals which addresses have accounts.
  if (!customer?.passwordHash) {
    await verifyAgainstDummy(password);
    return fail("INVALID", "Wrong email or password.");
  }
  if (!(await verifyPassword(password, customer.passwordHash))) {
    return fail("INVALID", "Wrong email or password.");
  }
  const sessionToken = await startSession(db, customer.id);
  await purgeExpiredCustomerData(db);
  return { ok: true, sessionToken, customer: toPrincipal(customer) };
}

// ---------------------------------------------------------------------------------------------
// Forgotten passwords

// Always answers "check your email". An address that never finished creating its account gets the
// finish-creating link instead, which is the same proof of ownership.
export async function requestPasswordReset(emailInput: string, db: Db = getDb()): Promise<void> {
  const email = normaliseEmail(emailInput);
  if (!EMAIL.test(email) || !mayEmail(email)) return;
  const shop = await getSettings(db);
  await db.transaction(async (tx) => {
    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.email, email))
      .for("update");
    if (!customer) return;
    if (customer.passwordHash) {
      const token = await issueToken(tx, customer.id, "reset");
      const mail = resetEmail(shop, `${accountUrl("reset")}?t=${token}`);
      await queueEmail(tx, { ...mail, to: email, kind: "customer_reset" });
    } else {
      const token = await issueToken(tx, customer.id, "activate");
      const mail = activationEmail(shop, customer.name, `${accountUrl("activate")}?t=${token}`);
      await queueEmail(tx, { ...mail, to: email, kind: "customer_activation" });
    }
  });
}

export async function resetPassword(
  token: string,
  password: string,
  db: Db = getDb(),
): Promise<AuthResult<SessionResult>> {
  const found = await findLiveToken(db, token, "reset");
  if (!found)
    return fail("INVALID_TOKEN", "This link has expired or was already used. Request a new one.");
  const problem = passwordProblem(password, found.customer.email);
  if (problem) return fail("WEAK_PASSWORD", problem);
  const passwordHash = await hashPassword(password);
  const shop = await getSettings(db);

  return db.transaction(async (tx) => {
    const live = await findLiveToken(tx, token, "reset", true);
    if (!live) return fail("INVALID_TOKEN", "This link has expired or was already used.");
    const [updated] = await tx
      .update(customers)
      .set({
        passwordHash,
        // Following the link proves the address, so a half-finished account is finished too.
        emailVerifiedAt: sql`coalesce(${customers.emailVerifiedAt}, now())`,
        updatedAt: sql`now()`,
      })
      .where(eq(customers.id, live.customer.id))
      .returning();
    if (!updated) throw new Error("customer vanished");
    await tx.delete(customerTokens).where(eq(customerTokens.customerId, updated.id));
    // Whoever had the old password (or a stolen session) is signed out everywhere.
    await endOtherSessions(tx, updated.id);
    await linkOrders(tx, updated.id, updated.email);
    const mail = passwordChangedEmail(shop, `${accountUrl("forgot")}`);
    await queueEmail(tx, { ...mail, to: updated.email, kind: "customer_password_changed" });
    const sessionToken = await startSession(tx, updated.id);
    return { ok: true as const, sessionToken, customer: toPrincipal(updated) };
  });
}

// ---------------------------------------------------------------------------------------------
// Looking after the account

export async function changeCustomerPassword(
  customer: CustomerPrincipal,
  currentSessionToken: string,
  currentPassword: string,
  newPassword: string,
  db: Db = getDb(),
): Promise<AuthResult> {
  const [row] = await db.select().from(customers).where(eq(customers.id, customer.id));
  if (!row?.passwordHash || !(await verifyPassword(currentPassword, row.passwordHash))) {
    return fail("WRONG_PASSWORD", "Your current password is not right.");
  }
  const problem = passwordProblem(newPassword, row.email);
  if (problem) return fail("WEAK_PASSWORD", problem);
  if (currentPassword === newPassword) {
    return fail("SAME_PASSWORD", "Choose a password you have not used here before.");
  }
  const passwordHash = await hashPassword(newPassword);
  const shop = await getSettings(db);
  await db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({ passwordHash, updatedAt: sql`now()` })
      .where(eq(customers.id, row.id));
    await endOtherSessions(tx, row.id, currentSessionToken);
    const mail = passwordChangedEmail(shop, accountUrl("forgot"));
    await queueEmail(tx, { ...mail, to: row.email, kind: "customer_password_changed" });
  });
  return { ok: true };
}

export async function updateCustomerName(
  customerId: string,
  name: string,
  db: Db = getDb(),
): Promise<AuthResult<{ customer: CustomerPrincipal }>> {
  const clean = name.trim();
  if (!clean || clean.length > 100)
    return fail("INVALID", "Enter your name (up to 100 characters).");
  const [row] = await db
    .update(customers)
    .set({ name: clean, updatedAt: sql`now()` })
    .where(eq(customers.id, customerId))
    .returning();
  if (!row) return fail("INVALID", "That account no longer exists.");
  return { ok: true, customer: toPrincipal(row) };
}

// Removes the account and everything tied to signing in. Past orders stay (they are the shop's
// own records, and a refund or delivery may still depend on them) but no longer point to anyone.
export async function deleteCustomerAccount(
  customerId: string,
  password: string,
  db: Db = getDb(),
): Promise<AuthResult> {
  const [row] = await db.select().from(customers).where(eq(customers.id, customerId));
  if (!row?.passwordHash || !(await verifyPassword(password, row.passwordHash))) {
    return fail("WRONG_PASSWORD", "That password is not right.");
  }
  await db.delete(customers).where(eq(customers.id, customerId));
  return { ok: true };
}
