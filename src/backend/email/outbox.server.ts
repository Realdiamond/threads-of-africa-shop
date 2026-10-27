import type { Executor } from "../db/client.server";
import { emailOutbox } from "../db/schema";
import type { EmailContent } from "./templates.server";

export type QueuedEmail = EmailContent & {
  to: string;
  kind: string;
  replyTo?: string | undefined;
  // Queuing the same key twice does nothing, so a retried request cannot send a duplicate.
  dedupeKey?: string | undefined;
};

// Writes the email to the outbox (inside the caller's transaction when given one). A background
// job sends it, so a mail-service outage never fails or loses the thing that triggered the email.
export async function queueEmail(
  ex: Pick<Executor, "insert">,
  email: QueuedEmail,
): Promise<boolean> {
  const rows = await ex
    .insert(emailOutbox)
    .values({
      toEmail: email.to.trim().toLowerCase(),
      replyTo: email.replyTo ?? null,
      subject: email.subject,
      textBody: email.text,
      htmlBody: email.html,
      kind: email.kind,
      dedupeKey: email.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: emailOutbox.id });
  return rows.length > 0;
}
