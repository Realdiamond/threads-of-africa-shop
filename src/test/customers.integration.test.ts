// @vitest-environment node
//
// Real-Postgres tests for customer accounts: creating one, signing in, forgotten passwords and
// what a customer can see. Skipped when TEST_DATABASE_URL is not set.
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashToken } from "@/backend/auth/admin-auth.server";
import {
  activateAccount,
  changeCustomerPassword,
  deleteCustomerAccount,
  endCustomerSession,
  loginCustomer,
  register,
  requestPasswordReset,
  resetPassword,
  resolveCustomerSession,
  updateCustomerName,
} from "@/backend/customers/customer-auth.server";
import {
  checkoutPrefill,
  getCustomerOrder,
  listCustomerOrders,
} from "@/backend/customers/customer-orders.server";
import * as schema from "@/backend/db/schema";
import {
  customerSessions,
  customerTokens,
  customers,
  emailOutbox,
  orders,
} from "@/backend/db/schema";
import { resetRateLimitsForTests } from "@/backend/rate-limit.server";

if (!process.env["TEST_DATABASE_URL"]) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file: the suite is skipped below.
  }
}
const url = process.env["TEST_DATABASE_URL"];

describe.skipIf(!url)("customer accounts (Postgres)", () => {
  if (url && !new URL(url).pathname.includes("test")) {
    throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'");
  }

  const pool = new Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "./db/migrations" });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    resetRateLimitsForTests();
    await db.execute(
      sql`truncate customers, orders, email_outbox, store_settings restart identity cascade`,
    );
  });

  const PASSWORD = "correct horse battery";

  const mails = async (kind?: string) =>
    (await db.select().from(emailOutbox).orderBy(emailOutbox.createdAt)).filter(
      (m) => !kind || m.kind === kind,
    );
  const tokenFrom = async (kind: string) => {
    const all = await mails(kind);
    const last = all.at(-1);
    const found = last ? /[?&]t=(c[A-Za-z0-9_-]+)/.exec(last.textBody) : null;
    if (!found) throw new Error(`no ${kind} link was emailed`);
    return found[1]!;
  };
  const customerRow = async (email: string) =>
    (await db.select().from(customers).where(eq(customers.email, email)))[0];

  async function activated(email = "ada@example.com", name = "Ada Obi") {
    await register({ email, name }, db);
    const result = await activateAccount(await tokenFrom("customer_activation"), PASSWORD, db);
    if (!result.ok) throw new Error(result.message);
    return result;
  }

  async function guestOrder(email: string, over: Partial<typeof orders.$inferInsert> = {}) {
    const [order] = await db
      .insert(orders)
      .values({
        email,
        accessToken: `t${Math.random().toString(36).slice(2)}${"x".repeat(20)}`,
        status: "paid",
        paidAt: new Date(),
        shipName: "Ada Obi",
        shipLine1: "12 Marina Road",
        shipCity: "Lagos",
        shipCountry: "NG",
        itemsCents: 1000,
        shippingCents: 0,
        taxCents: 0,
        totalCents: 1000,
        shippingMethod: "Standard",
        shippingZone: "Nigeria",
        paymentProvider: "stripe",
        ...over,
      })
      .returning();
    return order!;
  }

  describe("creating an account", () => {
    it("emails a link and creates nothing usable until it is followed", async () => {
      expect(await register({ email: "Ada@Example.com ", name: " Ada Obi " }, db)).toEqual({
        ok: true,
      });
      const row = await customerRow("ada@example.com");
      expect(row).toMatchObject({ name: "Ada Obi", passwordHash: null, emailVerifiedAt: null });

      const [mail] = await mails("customer_activation");
      expect(mail).toMatchObject({ toEmail: "ada@example.com" });
      expect(mail!.textBody).toContain("/account/activate?t=c");
      // The link's token is stored only as a hash.
      const token = await tokenFrom("customer_activation");
      const stored = await db.select().from(customerTokens);
      expect(stored).toHaveLength(1);
      expect(stored[0]!.tokenHash).toBe(hashToken(token));
      expect(JSON.stringify(stored)).not.toContain(token);

      // No password yet, so no signing in, with any password.
      expect(await loginCustomer("ada@example.com", PASSWORD, db)).toMatchObject({ ok: false });
    });

    it("rejects bad details", async () => {
      expect(await register({ email: "nope", name: "Ada" }, db)).toMatchObject({
        ok: false,
        code: "INVALID",
      });
      expect(await register({ email: "a@b.co", name: "  " }, db)).toMatchObject({
        ok: false,
        code: "INVALID",
      });
      expect(await register({ email: "a@b.co", name: "x".repeat(101) }, db)).toMatchObject({
        ok: false,
      });
      expect(await db.select().from(customers)).toHaveLength(0);
    });

    it("gives the same answer for an address that already has an account, and tells its owner", async () => {
      await activated();
      const before = (await mails()).length;
      expect(await register({ email: "ada@example.com", name: "Someone Else" }, db)).toEqual({
        ok: true,
      });
      expect(await db.select().from(customers)).toHaveLength(1);
      const after = await mails();
      expect(after).toHaveLength(before + 1);
      const notice = after.at(-1)!;
      expect(notice.kind).toBe("customer_already_registered");
      // It carries no way in: no activation or reset token.
      expect(notice.textBody).not.toMatch(/[?&]t=c/);
      // Asking again the same day does not send it again.
      resetRateLimitsForTests();
      await register({ email: "ada@example.com", name: "Someone Else" }, db);
      expect(await mails("customer_already_registered")).toHaveLength(1);
    });

    it("lets only the owner of the address set the password, so it cannot be claimed in advance", async () => {
      // An attacker registers the victim's address with their own name.
      await register({ email: "victim@example.com", name: "Mallory" }, db);
      expect(await loginCustomer("victim@example.com", "mallory-password-1", db)).toMatchObject({
        ok: false,
      });
      expect((await customerRow("victim@example.com"))!.passwordHash).toBeNull();

      // The victim gets the email, follows it and chooses their own password.
      const result = await activateAccount(await tokenFrom("customer_activation"), PASSWORD, db);
      expect(result.ok).toBe(true);
      expect(await loginCustomer("victim@example.com", "mallory-password-1", db)).toMatchObject({
        ok: false,
      });
      expect(await loginCustomer("victim@example.com", PASSWORD, db)).toMatchObject({ ok: true });
    });

    it("a second request replaces the first link", async () => {
      await register({ email: "ada@example.com", name: "Ada" }, db);
      const first = await tokenFrom("customer_activation");
      resetRateLimitsForTests();
      await register({ email: "ada@example.com", name: "Ada" }, db);
      const second = await tokenFrom("customer_activation");
      expect(second).not.toBe(first);
      expect(await activateAccount(first, PASSWORD, db)).toMatchObject({
        ok: false,
        code: "INVALID_TOKEN",
      });
      expect(await activateAccount(second, PASSWORD, db)).toMatchObject({ ok: true });
    });

    it("sends at most a few emails per address per hour, saying nothing different", async () => {
      for (let i = 0; i < 5; i += 1) {
        expect(await register({ email: "flood@example.com", name: "Flood" }, db)).toEqual({
          ok: true,
        });
      }
      expect(await mails()).toHaveLength(3);
    });

    it("copes with the same address being registered at the same instant", async () => {
      const results = await Promise.all(
        [1, 2, 3].map(() => register({ email: "race@example.com", name: "Race" }, db)),
      );
      expect(results.every((r) => r.ok)).toBe(true);
      expect(await db.select().from(customers)).toHaveLength(1);
    });
  });

  describe("following the link", () => {
    it("sets the password, verifies the address and signs the customer in", async () => {
      const result = await activated();
      expect(result.customer).toMatchObject({ email: "ada@example.com", name: "Ada Obi" });
      const row = (await customerRow("ada@example.com"))!;
      expect(row.passwordHash).toMatch(/^scrypt\$/);
      expect(row.emailVerifiedAt).not.toBeNull();
      expect(await resolveCustomerSession(result.sessionToken, db)).toMatchObject({ id: row.id });
      // The session token itself is never stored.
      const sessions = await db.select().from(customerSessions);
      expect(sessions[0]!.tokenHash).toBe(hashToken(result.sessionToken));
      expect(JSON.stringify(sessions)).not.toContain(result.sessionToken);
    });

    it("works once", async () => {
      await register({ email: "ada@example.com", name: "Ada" }, db);
      const token = await tokenFrom("customer_activation");
      expect(await activateAccount(token, PASSWORD, db)).toMatchObject({ ok: true });
      expect(await activateAccount(token, "another long password", db)).toMatchObject({
        ok: false,
        code: "INVALID_TOKEN",
      });
      expect(await loginCustomer("ada@example.com", PASSWORD, db)).toMatchObject({ ok: true });
    });

    it("two clicks at the same instant take turns", async () => {
      await register({ email: "ada@example.com", name: "Ada" }, db);
      const token = await tokenFrom("customer_activation");
      const results = await Promise.all([
        activateAccount(token, PASSWORD, db),
        activateAccount(token, "a different long password", db),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
    });

    it("refuses a weak password without using up the link", async () => {
      await register({ email: "ada@example.com", name: "Ada" }, db);
      const token = await tokenFrom("customer_activation");
      expect(await activateAccount(token, "short", db)).toMatchObject({
        ok: false,
        code: "WEAK_PASSWORD",
      });
      expect(await activateAccount(token, "ada@example.com", db)).toMatchObject({
        ok: false,
        code: "WEAK_PASSWORD",
      });
      expect(await activateAccount(token, PASSWORD, db)).toMatchObject({ ok: true });
    });

    it("refuses expired and made-up links", async () => {
      await register({ email: "ada@example.com", name: "Ada" }, db);
      const token = await tokenFrom("customer_activation");
      await db.update(customerTokens).set({ expiresAt: sql`now() - interval '1 minute'` });
      expect(await activateAccount(token, PASSWORD, db)).toMatchObject({
        ok: false,
        code: "INVALID_TOKEN",
      });
      expect(await activateAccount("c" + "x".repeat(43), PASSWORD, db)).toMatchObject({
        ok: false,
        code: "INVALID_TOKEN",
      });
    });

    it("hands earlier guest orders to the customer, and only those with the same address", async () => {
      const mine = await guestOrder("ada@example.com");
      const theirs = await guestOrder("other@example.com");
      const result = await activated();
      const [linked] = await db.select().from(orders).where(eq(orders.id, mine.id));
      const [untouched] = await db.select().from(orders).where(eq(orders.id, theirs.id));
      expect(linked!.customerId).toBe(result.customer.id);
      expect(untouched!.customerId).toBeNull();
    });
  });

  describe("signing in", () => {
    it("accepts the right password in any letter case of the address", async () => {
      await activated();
      expect(await loginCustomer("ADA@example.com", PASSWORD, db)).toMatchObject({ ok: true });
    });

    it("gives one answer for a wrong password, an unknown address and an unfinished account", async () => {
      await activated();
      await register({ email: "pending@example.com", name: "Pending" }, db);
      const wrong = await loginCustomer("ada@example.com", "not the password", db);
      const unknown = await loginCustomer("nobody@example.com", PASSWORD, db);
      const unfinished = await loginCustomer("pending@example.com", PASSWORD, db);
      expect(wrong).toEqual({ ok: false, code: "INVALID", message: "Wrong email or password." });
      expect(unknown).toEqual(wrong);
      expect(unfinished).toEqual(wrong);
    });

    it("ends sessions on logout, expiry and idleness", async () => {
      const { sessionToken } = await activated();
      expect(await resolveCustomerSession(sessionToken, db)).not.toBeNull();
      await endCustomerSession(sessionToken, db);
      expect(await resolveCustomerSession(sessionToken, db)).toBeNull();

      const login = await loginCustomer("ada@example.com", PASSWORD, db);
      if (!login.ok) throw new Error("login failed");
      await db.update(customerSessions).set({ lastUsedAt: sql`now() - interval '15 days'` });
      expect(await resolveCustomerSession(login.sessionToken, db)).toBeNull();
      const again = await loginCustomer("ada@example.com", PASSWORD, db);
      if (!again.ok) throw new Error("login failed");
      await db.update(customerSessions).set({ expiresAt: sql`now() - interval '1 minute'` });
      expect(await resolveCustomerSession(again.sessionToken, db)).toBeNull();
      expect(await resolveCustomerSession("not-a-token", db)).toBeNull();
    });
  });

  describe("forgotten passwords", () => {
    it("says nothing different for an unknown address and sends nothing", async () => {
      await requestPasswordReset("nobody@example.com", db);
      expect(await mails()).toHaveLength(0);
    });

    it("lets the owner choose a new password, signing everyone else out", async () => {
      const first = await activated();
      await requestPasswordReset("ada@example.com", db);
      const [mail] = await mails("customer_reset");
      expect(mail!.toEmail).toBe("ada@example.com");
      const token = await tokenFrom("customer_reset");

      const result = await resetPassword(token, "a brand new passphrase", db);
      if (!result.ok) throw new Error(result.message);
      expect(await resolveCustomerSession(first.sessionToken, db)).toBeNull(); // the old session is gone
      expect(await resolveCustomerSession(result.sessionToken, db)).not.toBeNull();
      expect(await loginCustomer("ada@example.com", PASSWORD, db)).toMatchObject({ ok: false });
      expect(await loginCustomer("ada@example.com", "a brand new passphrase", db)).toMatchObject({
        ok: true,
      });
      expect(await mails("customer_password_changed")).toHaveLength(1);

      // Works once.
      expect(await resetPassword(token, "yet another passphrase", db)).toMatchObject({
        ok: false,
        code: "INVALID_TOKEN",
      });
    });

    it("keeps the two kinds of link apart", async () => {
      await register({ email: "ada@example.com", name: "Ada" }, db);
      const activation = await tokenFrom("customer_activation");
      expect(await resetPassword(activation, PASSWORD, db)).toMatchObject({
        ok: false,
        code: "INVALID_TOKEN",
      });
      await activateAccount(activation, PASSWORD, db);
      await requestPasswordReset("ada@example.com", db);
      const reset = await tokenFrom("customer_reset");
      expect(await activateAccount(reset, "something else entirely", db)).toMatchObject({
        ok: false,
        code: "INVALID_TOKEN",
      });
    });

    it("sends the finish-creating link to an address that never finished", async () => {
      await register({ email: "ada@example.com", name: "Ada" }, db);
      resetRateLimitsForTests();
      await requestPasswordReset("ada@example.com", db);
      expect(await mails("customer_reset")).toHaveLength(0);
      expect(await mails("customer_activation")).toHaveLength(2);
    });

    it("refuses expired links and weak passwords", async () => {
      await activated();
      await requestPasswordReset("ada@example.com", db);
      const token = await tokenFrom("customer_reset");
      expect(await resetPassword(token, "short", db)).toMatchObject({
        ok: false,
        code: "WEAK_PASSWORD",
      });
      await db.update(customerTokens).set({ expiresAt: sql`now() - interval '1 minute'` });
      expect(await resetPassword(token, PASSWORD + "!", db)).toMatchObject({
        ok: false,
        code: "INVALID_TOKEN",
      });
    });
  });

  describe("looking after the account", () => {
    it("changes the password, keeping this session and ending the others", async () => {
      const here = await activated();
      const other = await loginCustomer("ada@example.com", PASSWORD, db);
      if (!other.ok) throw new Error("login failed");
      const wrong = await changeCustomerPassword(
        here.customer,
        here.sessionToken,
        "nope",
        "a new long passphrase",
        db,
      );
      expect(wrong).toMatchObject({ ok: false, code: "WRONG_PASSWORD" });
      expect(
        await changeCustomerPassword(here.customer, here.sessionToken, PASSWORD, "short", db),
      ).toMatchObject({ code: "WEAK_PASSWORD" });
      expect(
        await changeCustomerPassword(here.customer, here.sessionToken, PASSWORD, PASSWORD, db),
      ).toMatchObject({ code: "SAME_PASSWORD" });

      expect(
        await changeCustomerPassword(
          here.customer,
          here.sessionToken,
          PASSWORD,
          "a new long passphrase",
          db,
        ),
      ).toEqual({ ok: true });
      expect(await resolveCustomerSession(here.sessionToken, db)).not.toBeNull();
      expect(await resolveCustomerSession(other.sessionToken, db)).toBeNull();
      expect(await loginCustomer("ada@example.com", "a new long passphrase", db)).toMatchObject({
        ok: true,
      });
      expect(await mails("customer_password_changed")).toHaveLength(1);
    });

    it("changes the name", async () => {
      const { customer } = await activated();
      expect(await updateCustomerName(customer.id, " Ada Obi-Eze ", db)).toMatchObject({
        ok: true,
        customer: { name: "Ada Obi-Eze" },
      });
      expect(await updateCustomerName(customer.id, "  ", db)).toMatchObject({ ok: false });
    });

    it("deletes the account but keeps the shop's order records", async () => {
      const { customer, sessionToken } = await activated();
      const order = await guestOrder("ada@example.com");
      expect(await deleteCustomerAccount(customer.id, "wrong password", db)).toMatchObject({
        ok: false,
        code: "WRONG_PASSWORD",
      });
      expect(await customerRow("ada@example.com")).toBeDefined();

      expect(await deleteCustomerAccount(customer.id, PASSWORD, db)).toEqual({ ok: true });
      expect(await customerRow("ada@example.com")).toBeUndefined();
      expect(await resolveCustomerSession(sessionToken, db)).toBeNull();
      expect(await db.select().from(customerSessions)).toHaveLength(0);
      const [kept] = await db.select().from(orders).where(eq(orders.id, order.id));
      expect(kept).toMatchObject({ customerId: null, email: "ada@example.com" });
    });
  });

  describe("a customer's orders", () => {
    it("lists only their own paid orders", async () => {
      const ada = await activated("ada@example.com");
      const bola = await activated("bola@example.com", "Bola Ade");
      const mine = await guestOrder("ada@example.com", { customerId: ada.customer.id });
      await guestOrder("ada@example.com", {
        customerId: ada.customer.id,
        status: "pending_payment",
        paidAt: null,
      });
      const theirs = await guestOrder("bola@example.com", { customerId: bola.customer.id });

      const list = await listCustomerOrders(ada.customer.id, db);
      expect(list.map((o) => o.id)).toEqual([mine.id]);
      expect(list[0]).toMatchObject({ number: mine.number, totalCents: 1000, status: "paid" });

      expect(await getCustomerOrder(ada.customer.id, mine.id, db)).toMatchObject({ id: mine.id });
      // Someone else's order, and one that does not exist, look exactly the same.
      expect(await getCustomerOrder(ada.customer.id, theirs.id, db)).toBeNull();
      expect(
        await getCustomerOrder(ada.customer.id, "00000000-0000-4000-8000-000000000000", db),
      ).toBeNull();
      expect(await getCustomerOrder(ada.customer.id, "not-a-uuid", db)).toBeNull();
    });

    it("fills the checkout from the account and the last order", async () => {
      const { customer } = await activated();
      expect(await checkoutPrefill(customer, db)).toMatchObject({
        email: "ada@example.com",
        name: "Ada Obi",
        line1: "",
      });
      await guestOrder("ada@example.com", {
        customerId: customer.id,
        shipName: "Ada O.",
        shipLine1: "5 Palm Street",
        shipCity: "Abuja",
        shipPostalCode: "900001",
        shipPhone: "+2348000000000",
      });
      expect(await checkoutPrefill(customer, db)).toEqual({
        email: "ada@example.com",
        name: "Ada O.",
        phone: "+2348000000000",
        country: "NG",
        line1: "5 Palm Street",
        line2: "",
        city: "Abuja",
        region: "",
        postalCode: "900001",
      });
    });
  });

  describe("what the database insists on", () => {
    it("never stores a password for an address that was not verified, or an unnormalised email", async () => {
      await expect(
        db.insert(customers).values({ email: "x@example.com", passwordHash: "scrypt$x" }),
      ).rejects.toMatchObject({ cause: { constraint: "customers_password_needs_verified_email" } });
      await expect(
        db.insert(customers).values({ email: "Upper@Example.com" }),
      ).rejects.toMatchObject({ cause: { constraint: "customers_email_normalised" } });
    });
  });
});
