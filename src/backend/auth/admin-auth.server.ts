import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, lt, ne, or, sql } from "drizzle-orm";

import { recordAudit } from "../admin/audit.server";
import { getDb, type Db } from "../db/client.server";
import { adminSessions, adminUsers } from "../db/schema";
import {
  hashPassword,
  passwordProblem,
  verifyAgainstDummy,
  verifyPassword,
} from "./password.server";

// A session dies after 7 days no matter what, and after 12 hours without use.
export const SESSION_ABSOLUTE_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_IDLE_SECONDS = 12 * 60 * 60;

export type AdminPrincipal = {
  id: string;
  email: string;
  name: string;
  role: "owner" | "staff";
  status: "invited" | "active";
};

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const normaliseEmail = (email: string) => email.trim().toLowerCase();

export type LoginResult = { ok: true; token: string; admin: AdminPrincipal } | { ok: false };

const toPrincipal = (user: typeof adminUsers.$inferSelect): AdminPrincipal => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  status: user.status === "invited" ? "invited" : "active",
});

export async function purgeExpiredSessions(db: Db = getDb()) {
  await db
    .delete(adminSessions)
    .where(
      or(
        lt(adminSessions.expiresAt, sql`now()`),
        lt(adminSessions.lastUsedAt, sql`now() - ${SESSION_IDLE_SECONDS} * interval '1 second'`),
      ),
    );
}

// One generic failure for every reason (unknown email, disabled account, wrong password) so the
// response never reveals which accounts exist.
export async function login(
  email: string,
  password: string,
  db: Db = getDb(),
): Promise<LoginResult> {
  const [user] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, normaliseEmail(email)));
  if (!user || user.status === "disabled") {
    await verifyAgainstDummy(password);
    return { ok: false };
  }
  if (!(await verifyPassword(password, user.passwordHash))) return { ok: false };

  const token = randomBytes(32).toString("base64url");
  await db.insert(adminSessions).values({
    tokenHash: hashToken(token),
    adminUserId: user.id,
    expiresAt: sql`now() + ${SESSION_ABSOLUTE_SECONDS} * interval '1 second'`,
  });
  await db
    .update(adminUsers)
    .set({ lastLoginAt: sql`now()` })
    .where(eq(adminUsers.id, user.id));
  await purgeExpiredSessions(db);

  const admin = toPrincipal(user);
  await recordAudit(db, admin, "login", "session", "", "Signed in");
  return { ok: true, token, admin };
}

export async function resolveSession(
  token: string,
  db: Db = getDb(),
): Promise<AdminPrincipal | null> {
  const [row] = await db
    .select({ session: adminSessions, user: adminUsers })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
    .where(
      and(
        eq(adminSessions.tokenHash, hashToken(token)),
        gt(adminSessions.expiresAt, sql`now()`),
        gt(adminSessions.lastUsedAt, sql`now() - ${SESSION_IDLE_SECONDS} * interval '1 second'`),
        ne(adminUsers.status, "disabled"),
      ),
    );
  if (!row) return null;

  // Refresh the idle timer, but at most once a minute so reads stay cheap.
  await db
    .update(adminSessions)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(adminSessions.id, row.session.id),
        lt(adminSessions.lastUsedAt, sql`now() - interval '1 minute'`),
      ),
    );
  return toPrincipal(row.user);
}

// Logging out deletes the session row; clearing the cookie alone would leave a live token.
export async function endSession(token: string, db: Db = getDb()) {
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token)));
}

export async function endAllSessions(userId: string, exceptToken?: string, db: Db = getDb()) {
  await db
    .delete(adminSessions)
    .where(
      and(
        eq(adminSessions.adminUserId, userId),
        exceptToken ? ne(adminSessions.tokenHash, hashToken(exceptToken)) : undefined,
      ),
    );
}

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; code: "WRONG_PASSWORD" | "WEAK_PASSWORD" | "SAME_PASSWORD"; message: string };

export async function changePassword(
  admin: AdminPrincipal,
  currentToken: string,
  currentPassword: string,
  newPassword: string,
  db: Db = getDb(),
): Promise<ChangePasswordResult> {
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, admin.id));
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, code: "WRONG_PASSWORD", message: "Your current password is not correct." };
  }
  const problem = passwordProblem(newPassword, user.email);
  if (problem) return { ok: false, code: "WEAK_PASSWORD", message: problem };
  if (newPassword === currentPassword) {
    return {
      ok: false,
      code: "SAME_PASSWORD",
      message: "Choose a password you have not used just now.",
    };
  }

  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(adminUsers)
      .set({ passwordHash, status: "active", updatedAt: sql`now()` })
      .where(eq(adminUsers.id, admin.id));
    // A new password signs every other device out.
    await tx
      .delete(adminSessions)
      .where(
        and(
          eq(adminSessions.adminUserId, admin.id),
          ne(adminSessions.tokenHash, hashToken(currentToken)),
        ),
      );
    await recordAudit(
      tx,
      admin,
      "password_changed",
      "admin_user",
      admin.id,
      "Changed own password",
    );
  });
  return { ok: true };
}
