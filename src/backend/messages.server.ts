import { desc, eq, sql } from "drizzle-orm";

import { MESSAGE_TOPICS, type MessageRow, type MessageTopic } from "@/lib/store-types";

import { recordAudit, type Actor } from "./admin/audit.server";
import { getDb, type Db } from "./db/client.server";
import { messages } from "./db/schema";
import { queueEmail } from "./email/outbox.server";
import { contactNotificationEmail } from "./email/templates.server";
import { getSettings } from "./settings.server";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MessageInput = { topic: string; name: string; email: string; body: string };

export type CreateMessageResult = { ok: true } | { ok: false; message: string };

const topicLabel = (topic: string) => MESSAGE_TOPICS.find((t) => t.value === topic)?.label ?? topic;

// A visitor's message is stored first (never lost), and the notification email to the shop is
// queued in the same transaction.
export async function createMessage(
  input: MessageInput,
  db: Db = getDb(),
): Promise<CreateMessageResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const body = input.body.trim();
  const topic = MESSAGE_TOPICS.find((t) => t.value === input.topic)?.value;
  if (!topic) return { ok: false, message: "Choose what your message is about." };
  if (!name || name.length > 100) return { ok: false, message: "Please enter your name." };
  if (!EMAIL.test(email) || email.length > 254)
    return { ok: false, message: "Please enter a valid email address." };
  if (!body) return { ok: false, message: "Please write a message." };
  if (body.length > 5000)
    return { ok: false, message: "Your message is too long (5,000 characters at most)." };

  const settings = await getSettings(db);
  await db.transaction(async (tx) => {
    await tx.insert(messages).values({ topic, name, email, body });
    await queueEmail(tx, {
      ...contactNotificationEmail({
        storeName: settings.storeName,
        contactEmail: settings.contactEmail,
        topicLabel: topicLabel(topic),
        name,
        email,
        body,
      }),
      to: settings.contactEmail,
      replyTo: email,
      kind: "contact-notification",
    });
  });
  return { ok: true };
}

const toRow = (row: typeof messages.$inferSelect): MessageRow => ({
  id: row.id,
  topic: row.topic as MessageTopic,
  name: row.name,
  email: row.email,
  body: row.body,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  handledAt: row.handledAt?.toISOString() ?? null,
});

export async function listMessages(
  filter: { status?: "new" | "handled" | undefined } = {},
  db: Db = getDb(),
): Promise<MessageRow[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(filter.status ? eq(messages.status, filter.status) : undefined)
    .orderBy(desc(messages.createdAt))
    .limit(500);
  return rows.map(toRow);
}

export async function countNewMessages(db: Db = getDb()): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(messages)
    .where(eq(messages.status, "new"));
  return row?.total ?? 0;
}

export async function setMessageStatus(
  actor: Actor,
  id: string,
  status: "new" | "handled",
  db: Db = getDb(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  const updated = await db
    .update(messages)
    .set({ status, handledAt: status === "handled" ? sql`now()` : null })
    .where(eq(messages.id, id))
    .returning({ id: messages.id });
  if (updated.length === 0) return { ok: false, message: "That message no longer exists." };
  await recordAudit(db, actor, "message_status", "message", id, `Marked a message as ${status}`);
  return { ok: true };
}

export async function deleteMessage(
  actor: Actor,
  id: string,
  db: Db = getDb(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  const deleted = await db
    .delete(messages)
    .where(eq(messages.id, id))
    .returning({ id: messages.id });
  if (deleted.length === 0) return { ok: false, message: "That message no longer exists." };
  await recordAudit(db, actor, "message_deleted", "message", id, "Deleted a message");
  return { ok: true };
}
