import { and, eq, lte, sql } from "drizzle-orm";

import { getDb, type Db } from "../db/client.server";
import { emailOutbox } from "../db/schema";
import { log } from "../log.server";
import { getSettings } from "../settings.server";
import { getEmailProvider, type EmailProvider } from "./provider.server";

const MAX_ATTEMPTS = 6;
const LEASE_MINUTES = 5;
// Wait before the next try after attempt 1, 2, 3...: 1 min, 5 min, 30 min, 2 h, 12 h.
const BACKOFF_MINUTES = [1, 5, 30, 120, 720];

let warnedNoProvider = false;

export type ProcessResult = { skipped: boolean; sent: number; retrying: number; failed: number };

// Sends due emails. Each one is claimed first (its retry time is pushed out as a lease), then sent
// outside any transaction: a slow mail service never holds database locks, and if this process dies
// mid-send the email simply becomes due again after the lease.
export async function processEmailOutbox(
  options: { db?: Db; provider?: EmailProvider | null; limit?: number } = {},
): Promise<ProcessResult> {
  const db = options.db ?? getDb();
  const provider = options.provider === undefined ? getEmailProvider() : options.provider;
  if (!provider) {
    if (!warnedNoProvider) {
      warnedNoProvider = true;
      log(
        "warn",
        "no email service is configured (set RESEND_API_KEY): emails are being queued but not sent",
      );
    }
    return { skipped: true, sent: 0, retrying: 0, failed: 0 };
  }

  const settings = await getSettings(db);
  const from = process.env["EMAIL_FROM"] ?? `${settings.storeName} <${settings.contactEmail}>`;

  const claimed = await db.execute<{ id: string }>(sql`
    update email_outbox set attempts = attempts + 1,
      next_attempt_at = now() + ${LEASE_MINUTES} * interval '1 minute'
    where id in (
      select id from email_outbox
      where status = 'pending' and next_attempt_at <= now()
      order by created_at
      limit ${options.limit ?? 20}
      for update skip locked
    )
    returning id`);

  const result: ProcessResult = { skipped: false, sent: 0, retrying: 0, failed: 0 };
  for (const { id } of claimed.rows) {
    const [email] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id));
    if (!email) continue;
    let outcome;
    try {
      outcome = await provider.send({
        from,
        to: email.toEmail,
        replyTo: email.replyTo ?? undefined,
        subject: email.subject,
        text: email.textBody,
        html: email.htmlBody,
      });
    } catch (error) {
      outcome = {
        ok: false as const,
        retryable: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (outcome.ok) {
      await db
        .update(emailOutbox)
        .set({ status: "sent", sentAt: sql`now()`, lastError: "" })
        .where(eq(emailOutbox.id, id));
      result.sent += 1;
    } else if (outcome.retryable && email.attempts < MAX_ATTEMPTS) {
      const wait = BACKOFF_MINUTES[Math.min(email.attempts, BACKOFF_MINUTES.length) - 1] ?? 720;
      await db
        .update(emailOutbox)
        .set({
          nextAttemptAt: sql`now() + ${wait} * interval '1 minute'`,
          lastError: outcome.error.slice(0, 500),
        })
        .where(eq(emailOutbox.id, id));
      result.retrying += 1;
    } else {
      await db
        .update(emailOutbox)
        .set({ status: "failed", lastError: outcome.error.slice(0, 500) })
        .where(eq(emailOutbox.id, id));
      result.failed += 1;
      log("error", "email permanently failed", { id, kind: email.kind, error: outcome.error });
    }
  }
  return result;
}

export async function purgeOldEmails(db: Db = getDb()): Promise<number> {
  const deleted = await db
    .delete(emailOutbox)
    .where(
      and(eq(emailOutbox.status, "sent"), lte(emailOutbox.sentAt, sql`now() - interval '90 days'`)),
    )
    .returning({ id: emailOutbox.id });
  return deleted.length;
}

export async function emailBacklog(db: Db = getDb()) {
  const rows = await db
    .select({ status: emailOutbox.status, total: sql<number>`count(*)::int` })
    .from(emailOutbox)
    .groupBy(emailOutbox.status);
  const count = (status: string) => rows.find((row) => row.status === status)?.total ?? 0;
  return { pending: count("pending"), failed: count("failed") };
}

// After the cause of a permanent failure is fixed (a wrong key, an unverified sending domain), puts
// those emails back in the queue to be sent.
export async function requeueFailedEmails(db: Db = getDb()): Promise<number> {
  const rows = await db
    .update(emailOutbox)
    .set({ status: "pending", attempts: 0, nextAttemptAt: sql`now()` })
    .where(eq(emailOutbox.status, "failed"))
    .returning({ id: emailOutbox.id });
  return rows.length;
}
