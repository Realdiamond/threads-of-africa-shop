import { and, asc, eq, ne, sql } from "drizzle-orm";

import { endAllSessions, normaliseEmail, type AdminPrincipal } from "../auth/admin-auth.server";
import { generatePassword, hashPassword } from "../auth/password.server";
import { getDb, type Db, type Executor } from "../db/client.server";
import { adminUsers } from "../db/schema";
import { recordAudit } from "./audit.server";

export type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "staff";
  status: "invited" | "active" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
};

export type UserFailure = {
  ok: false;
  code: "FORBIDDEN" | "NOT_FOUND" | "EMAIL_TAKEN" | "INVALID" | "SELF" | "LAST_OWNER";
  message: string;
};

const fail = (code: UserFailure["code"], message: string): UserFailure => ({
  ok: false,
  code,
  message,
});
const forbidden = () => fail("FORBIDDEN", "Only owners can manage the team.");

const toRow = (user: typeof adminUsers.$inferSelect): AdminUserRow => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  status: user.status,
  lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  createdAt: user.createdAt.toISOString(),
});

// Serialises changes to owners, so two owners disabling each other at once cannot leave nobody in charge.
async function lockOwners(tx: Executor) {
  await tx
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.role, "owner"))
    .for("update");
}

async function otherActiveOwners(tx: Executor, userId: string) {
  const rows = await tx
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(
      and(eq(adminUsers.role, "owner"), eq(adminUsers.status, "active"), ne(adminUsers.id, userId)),
    );
  return rows.length;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function listAdminUsers(
  actor: AdminPrincipal,
  db: Db = getDb(),
): Promise<{ ok: true; users: AdminUserRow[] } | UserFailure> {
  if (actor.role !== "owner") return forbidden();
  const rows = await db.select().from(adminUsers).orderBy(asc(adminUsers.createdAt));
  return { ok: true, users: rows.map(toRow) };
}

export async function createAdminUser(
  actor: AdminPrincipal,
  input: { name: string; email: string; role: "owner" | "staff" },
  db: Db = getDb(),
): Promise<{ ok: true; user: AdminUserRow; temporaryPassword: string } | UserFailure> {
  if (actor.role !== "owner") return forbidden();
  const email = normaliseEmail(input.email);
  const name = input.name.trim();
  if (!EMAIL_PATTERN.test(email) || email.length > 254)
    return fail("INVALID", "Enter a valid email address.");
  if (!name || name.length > 80) return fail("INVALID", "Enter a name (up to 80 characters).");

  const temporaryPassword = generatePassword();
  const passwordHash = await hashPassword(temporaryPassword);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, email));
    if (existing) return fail("EMAIL_TAKEN", "Someone with that email already has an account.");
    const [user] = await tx
      .insert(adminUsers)
      .values({ email, name, role: input.role, status: "invited", passwordHash })
      .returning();
    if (!user) throw new Error("admin user insert returned no row");
    await recordAudit(
      tx,
      actor,
      "user_created",
      "admin_user",
      user.id,
      `Added ${email} as ${input.role}`,
    );
    return { ok: true as const, user: toRow(user), temporaryPassword };
  });
}

export async function setAdminRole(
  actor: AdminPrincipal,
  userId: string,
  role: "owner" | "staff",
  db: Db = getDb(),
): Promise<{ ok: true } | UserFailure> {
  if (actor.role !== "owner") return forbidden();
  return db.transaction(async (tx) => {
    await lockOwners(tx);
    const [user] = await tx.select().from(adminUsers).where(eq(adminUsers.id, userId));
    if (!user) return fail("NOT_FOUND", "That person no longer exists.");
    if (user.role === "owner" && role !== "owner" && user.status === "active") {
      if ((await otherActiveOwners(tx, userId)) === 0) {
        return fail("LAST_OWNER", "There must always be at least one active owner.");
      }
    }
    await tx
      .update(adminUsers)
      .set({ role, updatedAt: sql`now()` })
      .where(eq(adminUsers.id, userId));
    await recordAudit(
      tx,
      actor,
      "user_role_changed",
      "admin_user",
      userId,
      `${user.email}: ${user.role} → ${role}`,
    );
    return { ok: true as const };
  });
}

export async function disableAdminUser(
  actor: AdminPrincipal,
  userId: string,
  db: Db = getDb(),
): Promise<{ ok: true } | UserFailure> {
  if (actor.role !== "owner") return forbidden();
  if (actor.id === userId) return fail("SELF", "You cannot disable your own account.");
  return db.transaction(async (tx) => {
    await lockOwners(tx);
    const [user] = await tx.select().from(adminUsers).where(eq(adminUsers.id, userId));
    if (!user) return fail("NOT_FOUND", "That person no longer exists.");
    if (
      user.role === "owner" &&
      user.status === "active" &&
      (await otherActiveOwners(tx, userId)) === 0
    ) {
      return fail("LAST_OWNER", "There must always be at least one active owner.");
    }
    await tx
      .update(adminUsers)
      .set({ status: "disabled", updatedAt: sql`now()` })
      .where(eq(adminUsers.id, userId));
    await endAllSessions(userId, undefined, tx as unknown as Db);
    await recordAudit(tx, actor, "user_disabled", "admin_user", userId, `Disabled ${user.email}`);
    return { ok: true as const };
  });
}

// Enabling and resetting both hand out a fresh temporary password and force a password change.
async function issueTemporaryPassword(
  actor: AdminPrincipal,
  userId: string,
  action: "user_enabled" | "user_password_reset",
  db: Db,
): Promise<{ ok: true; temporaryPassword: string } | UserFailure> {
  if (actor.role !== "owner") return forbidden();
  if (actor.id === userId)
    return fail("SELF", "Use your account page to change your own password.");
  const temporaryPassword = generatePassword();
  const passwordHash = await hashPassword(temporaryPassword);
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, userId))
      .for("update");
    if (!user) return fail("NOT_FOUND", "That person no longer exists.");
    if (action === "user_password_reset" && user.status === "disabled") {
      return fail("INVALID", "Enable this account before resetting its password.");
    }
    await tx
      .update(adminUsers)
      .set({ passwordHash, status: "invited", updatedAt: sql`now()` })
      .where(eq(adminUsers.id, userId));
    await endAllSessions(userId, undefined, tx as unknown as Db);
    await recordAudit(
      tx,
      actor,
      action,
      "admin_user",
      userId,
      `${user.email}: new temporary password issued`,
    );
    return { ok: true as const, temporaryPassword };
  });
}

export const enableAdminUser = (actor: AdminPrincipal, userId: string, db: Db = getDb()) =>
  issueTemporaryPassword(actor, userId, "user_enabled", db);

export const resetAdminPassword = (actor: AdminPrincipal, userId: string, db: Db = getDb()) =>
  issueTemporaryPassword(actor, userId, "user_password_reset", db);
