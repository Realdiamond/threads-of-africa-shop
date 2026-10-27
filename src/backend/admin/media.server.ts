import { createHash } from "node:crypto";

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { getDb, type Db, type Executor } from "../db/client.server";
import { media, productImages } from "../db/schema";
import { recordAudit, type Actor } from "./audit.server";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

// The file's own bytes decide its type; the browser-supplied content type and file name are not
// trusted. SVG is deliberately unsupported because it can carry scripts.
export function detectImageType(bytes: Uint8Array): ImageType | null {
  const startsWith = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export type SaveMediaResult =
  | { ok: true; id: string; url: string }
  | { ok: false; code: "EMPTY" | "TOO_LARGE" | "UNSUPPORTED"; message: string };

export async function saveMedia(
  actor: Actor,
  file: { bytes: Buffer; filename: string },
  db: Db = getDb(),
): Promise<SaveMediaResult> {
  if (file.bytes.length === 0) return { ok: false, code: "EMPTY", message: "That file is empty." };
  if (file.bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, code: "TOO_LARGE", message: "Photos must be 5 MB or smaller." };
  }
  const contentType = detectImageType(file.bytes);
  if (!contentType) {
    return { ok: false, code: "UNSUPPORTED", message: "Upload a JPEG, PNG or WebP photo." };
  }

  const filename = (file.filename.split(/[\\/]/).pop() ?? "").slice(0, 100);
  const [row] = await db
    .insert(media)
    .values({
      contentType,
      data: file.bytes,
      byteSize: file.bytes.length,
      sha256: createHash("sha256").update(file.bytes).digest("hex"),
      filename,
      uploadedBy: actor.id,
    })
    .returning({ id: media.id });
  if (!row) throw new Error("media insert returned no row");
  await recordAudit(
    db,
    actor,
    "photo_uploaded",
    "media",
    row.id,
    `Uploaded photo ${filename || "(unnamed)"}`,
  );
  return { ok: true, id: row.id, url: `/media/${row.id}` };
}

export async function getMedia(id: string, db: Db = getDb()) {
  const [row] = await db
    .select({ contentType: media.contentType, data: media.data, sha256: media.sha256 })
    .from(media)
    .where(eq(media.id, id));
  return row ?? null;
}

const MEDIA_URL = /^\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export const mediaIdFromUrl = (url: string) => MEDIA_URL.exec(url)?.[1] ?? null;

export async function existingMediaIds(ex: Executor, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await ex.select({ id: media.id }).from(media).where(inArray(media.id, ids));
  return new Set(rows.map((row) => row.id));
}

// Drops uploaded files that no product references any more (e.g. a photo removed from a product).
export async function deleteUnreferencedMedia(ex: Executor, urls: string[]) {
  const ids = urls.map(mediaIdFromUrl).filter((id): id is string => id !== null);
  if (ids.length === 0) return;
  const stillUsed = await ex
    .select({ url: productImages.url })
    .from(productImages)
    .where(
      inArray(
        productImages.url,
        ids.map((id) => `/media/${id}`),
      ),
    );
  const used = new Set(stillUsed.map((row) => mediaIdFromUrl(row.url)));
  const orphaned = ids.filter((id) => !used.has(id));
  if (orphaned.length > 0) await ex.delete(media).where(inArray(media.id, orphaned));
}

// Used by the cleanup job: uploads that never made it onto a product after a day.
export async function purgeStrayUploads(db: Db = getDb()): Promise<number> {
  const referenced = db
    .select({ id: sql<string>`substring(${productImages.url} from 8)::uuid` })
    .from(productImages)
    .where(sql`${productImages.url} ~ '^/media/[0-9a-f-]{36}$'`);
  const deleted = await db
    .delete(media)
    .where(
      and(sql`${media.createdAt} < now() - interval '1 day'`, notInArray(media.id, referenced)),
    )
    .returning({ id: media.id });
  return deleted.length;
}
