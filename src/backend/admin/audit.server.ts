import { desc } from "drizzle-orm";

import type { Executor } from "../db/client.server";
import { auditLog } from "../db/schema";

export type Actor = { id: string | null; email: string };

export type AuditEntry = {
  id: string;
  adminEmail: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  createdAt: string;
};

// Append-only: nothing in the app updates or deletes audit rows.
export async function recordAudit(
  ex: Executor,
  actor: Actor,
  action: string,
  entity: string,
  entityId: string,
  summary: string,
) {
  await ex.insert(auditLog).values({
    adminUserId: actor.id,
    adminEmail: actor.email,
    action,
    entity,
    entityId,
    summary: summary.slice(0, 500),
  });
}

export async function recentAudit(ex: Pick<Executor, "select">, limit = 50): Promise<AuditEntry[]> {
  const rows = await ex.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
  return rows.map((row) => ({
    id: row.id,
    adminEmail: row.adminEmail,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
  }));
}
