import { randomBytes } from "node:crypto";

import { and, desc, eq, ilike, sql } from "drizzle-orm";

import type { SubscriberRow } from "@/lib/store-types";

import { recordAudit, type Actor } from "./admin/audit.server";
import { getDb, type Db } from "./db/client.server";
import { newsletterSubscribers } from "./db/schema";
import { queueEmail } from "./email/outbox.server";
import { newsletterWelcomeEmail } from "./email/templates.server";
import { getSettings } from "./settings.server";
import { siteUrl } from "./site-url.server";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SubscribeResult = { ok: true } | { ok: false; message: string };

// Always answers the same way for a valid address, whether or not it was already on the list, so
// the form cannot be used to find out who is subscribed.
export async function subscribe(
  rawEmail: string,
  source: string,
  db: Db = getDb(),
): Promise<SubscribeResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254)
    return { ok: false, message: "Please enter a valid email address." };

  const settings = await getSettings(db);
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email))
      .for("update");
    if (existing?.status === "subscribed") return;

    let token = existing?.token;
    if (existing) {
      await tx
        .update(newsletterSubscribers)
        .set({ status: "subscribed", unsubscribedAt: null, subscribedAt: sql`now()` })
        .where(eq(newsletterSubscribers.id, existing.id));
    } else {
      token = randomBytes(24).toString("base64url");
      await tx.insert(newsletterSubscribers).values({ email, token, source: source.slice(0, 40) });
    }
    await queueEmail(tx, {
      ...newsletterWelcomeEmail({
        storeName: settings.storeName,
        contactEmail: settings.contactEmail,
        siteUrl: siteUrl(),
        unsubscribeUrl: `${siteUrl()}/newsletter/unsubscribe?t=${token}`,
      }),
      to: email,
      kind: "newsletter-welcome",
    });
  });
  return { ok: true };
}

// The token in the email link is the only credential; unsubscribing twice is harmless.
export async function unsubscribeByToken(token: string, db: Db = getDb()): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return false;
  const rows = await db
    .update(newsletterSubscribers)
    .set({
      status: "unsubscribed",
      unsubscribedAt: sql`coalesce(${newsletterSubscribers.unsubscribedAt}, now())`,
    })
    .where(eq(newsletterSubscribers.token, token))
    .returning({ id: newsletterSubscribers.id });
  return rows.length > 0;
}

const toRow = (row: typeof newsletterSubscribers.$inferSelect): SubscriberRow => ({
  id: row.id,
  email: row.email,
  status: row.status,
  source: row.source,
  subscribedAt: row.subscribedAt.toISOString(),
  unsubscribedAt: row.unsubscribedAt?.toISOString() ?? null,
});

export async function listSubscribers(
  filter: { status?: "subscribed" | "unsubscribed" | undefined; search?: string | undefined } = {},
  db: Db = getDb(),
): Promise<{ rows: SubscriberRow[]; subscribed: number; unsubscribed: number }> {
  const term = filter.search?.trim().replace(/[\\%_]/g, "\\$&");
  const [rows, counts] = await Promise.all([
    db
      .select()
      .from(newsletterSubscribers)
      .where(
        and(
          filter.status ? eq(newsletterSubscribers.status, filter.status) : undefined,
          term ? ilike(newsletterSubscribers.email, `%${term}%`) : undefined,
        ),
      )
      .orderBy(desc(newsletterSubscribers.subscribedAt))
      .limit(1000),
    db
      .select({ status: newsletterSubscribers.status, total: sql<number>`count(*)::int` })
      .from(newsletterSubscribers)
      .groupBy(newsletterSubscribers.status),
  ]);
  const count = (status: string) => counts.find((row) => row.status === status)?.total ?? 0;
  return {
    rows: rows.map(toRow),
    subscribed: count("subscribed"),
    unsubscribed: count("unsubscribed"),
  };
}

export async function removeSubscriber(
  actor: Actor,
  id: string,
  db: Db = getDb(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  const deleted = await db
    .delete(newsletterSubscribers)
    .where(eq(newsletterSubscribers.id, id))
    .returning({ email: newsletterSubscribers.email });
  if (deleted.length === 0) return { ok: false, message: "That subscriber no longer exists." };
  await recordAudit(
    db,
    actor,
    "subscriber_removed",
    "subscriber",
    id,
    "Permanently removed a subscriber",
  );
  return { ok: true };
}

// Spreadsheet programs run cells that start with = + - @ as formulas, so a hostile address could
// do harm when the export is opened. Prefixing a quote makes them plain text.
const csvCell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function subscribersCsv(db: Db = getDb()): Promise<string> {
  const rows = await db
    .select()
    .from(newsletterSubscribers)
    .orderBy(desc(newsletterSubscribers.subscribedAt));
  const header = "email,status,source,subscribed_at,unsubscribed_at";
  const lines = rows.map((row) =>
    [
      row.email,
      row.status,
      row.source,
      row.subscribedAt.toISOString(),
      row.unsubscribedAt?.toISOString() ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}
