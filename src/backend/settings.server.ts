import { and, eq, sql } from "drizzle-orm";

import type { PublicSettings, StoreSettings } from "@/lib/store-types";

import { recordAudit, type Actor } from "./admin/audit.server";
import { getDb, type Db } from "./db/client.server";
import { shippingRates, shippingZones, storeSettings } from "./db/schema";

const toSettings = (row: typeof storeSettings.$inferSelect): StoreSettings => ({
  storeName: row.storeName,
  contactEmail: row.contactEmail,
  whatsappNumber: row.whatsappNumber,
  instagramUrl: row.instagramUrl,
  tiktokUrl: row.tiktokUrl,
  facebookUrl: row.facebookUrl,
  pinterestUrl: row.pinterestUrl,
  announcement: row.announcement,
  lowStockThreshold: row.lowStockThreshold,
  shippingConfirmedAt: row.shippingConfirmedAt?.toISOString() ?? null,
});

// The row is created by the migration; recreating it here keeps the shop working even if it was lost.
export async function getSettings(db: Db = getDb()): Promise<StoreSettings> {
  await db.insert(storeSettings).values({ id: 1 }).onConflictDoNothing();
  const [row] = await db.select().from(storeSettings).where(eq(storeSettings.id, 1));
  if (!row) throw new Error("store settings row is missing");
  return toSettings(row);
}

// Every page view needs these (header, footer, announcement bar), so they are cached briefly.
let publicCache: { value: PublicSettings; expires: number } | undefined;
const CACHE_MS = 30_000;

export const clearSettingsCache = () => {
  publicCache = undefined;
};

export function toPublic(settings: StoreSettings): PublicSettings {
  const { lowStockThreshold: _low, shippingConfirmedAt: _confirmed, ...rest } = settings;
  return rest;
}

export async function getPublicSettings(): Promise<PublicSettings> {
  if (publicCache && publicCache.expires > Date.now()) return publicCache.value;
  const value = toPublic(await getSettings());
  publicCache = { value, expires: Date.now() + CACHE_MS };
  return value;
}

export type SettingsInput = Omit<StoreSettings, "shippingConfirmedAt">;

export type SettingsResult =
  { ok: true; settings: StoreSettings } | { ok: false; code: "INVALID"; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkUrl(label: string, value: string): string | null {
  if (value === "") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.includes(".") || value.length > 200)
      throw new Error();
    return null;
  } catch {
    return `${label} must be a full link starting with https://`;
  }
}

export function validateSettings(input: SettingsInput): string | null {
  if (!input.storeName.trim() || input.storeName.length > 80)
    return "Enter the shop name (up to 80 characters).";
  if (!EMAIL.test(input.contactEmail) || input.contactEmail.length > 254)
    return "Enter a valid contact email address.";
  if (!/^([0-9]{6,15})?$/.test(input.whatsappNumber)) {
    return "WhatsApp number: digits only, including the country code (for example 2348012345678).";
  }
  for (const [label, value] of [
    ["Instagram", input.instagramUrl],
    ["TikTok", input.tiktokUrl],
    ["Facebook", input.facebookUrl],
    ["Pinterest", input.pinterestUrl],
  ] as const) {
    const problem = checkUrl(label, value);
    if (problem) return problem;
  }
  if (input.announcement.length > 160) return "The announcement can be up to 160 characters.";
  if (
    !Number.isInteger(input.lowStockThreshold) ||
    input.lowStockThreshold < 0 ||
    input.lowStockThreshold > 1000
  ) {
    return "The low-stock warning level must be a whole number from 0 to 1000.";
  }
  return null;
}

// People paste numbers like "+234 801 234 5678"; keep only the digits.
export const normaliseWhatsapp = (value: string) => value.replace(/\D/g, "");

export async function updateSettings(
  actor: Actor,
  raw: SettingsInput,
  db: Db = getDb(),
): Promise<SettingsResult> {
  const input: SettingsInput = {
    ...raw,
    storeName: raw.storeName.trim(),
    contactEmail: raw.contactEmail.trim().toLowerCase(),
    whatsappNumber: normaliseWhatsapp(raw.whatsappNumber),
    instagramUrl: raw.instagramUrl.trim(),
    tiktokUrl: raw.tiktokUrl.trim(),
    facebookUrl: raw.facebookUrl.trim(),
    pinterestUrl: raw.pinterestUrl.trim(),
    announcement: raw.announcement.trim(),
  };
  const problem = validateSettings(input);
  if (problem) return { ok: false, code: "INVALID", message: problem };

  const row = await db.transaction(async (tx) => {
    await tx.insert(storeSettings).values({ id: 1 }).onConflictDoNothing();
    const [updated] = await tx
      .update(storeSettings)
      .set({ ...input, updatedAt: sql`now()` })
      .where(eq(storeSettings.id, 1))
      .returning();
    await recordAudit(tx, actor, "settings_updated", "settings", "1", "Updated shop settings");
    return updated;
  });
  clearSettingsCache();
  if (!row) throw new Error("settings update returned no row");
  return { ok: true, settings: toSettings(row) };
}

export type ConfirmShippingResult = { ok: true } | { ok: false; code: "INVALID"; message: string };

// An owner's statement that the shipping zones, rates and tax are real, not placeholders.
export async function confirmShipping(
  actor: Actor,
  db: Db = getDb(),
): Promise<ConfirmShippingResult> {
  const rates = await db
    .select({ id: shippingRates.id })
    .from(shippingRates)
    .innerJoin(shippingZones, and(eq(shippingZones.id, shippingRates.zoneId)))
    .limit(1);
  if (rates.length === 0) {
    return {
      ok: false,
      code: "INVALID",
      message: "Add at least one shipping zone with a rate first.",
    };
  }
  await db.transaction(async (tx) => {
    await tx.insert(storeSettings).values({ id: 1 }).onConflictDoNothing();
    await tx
      .update(storeSettings)
      .set({ shippingConfirmedAt: sql`now()` })
      .where(eq(storeSettings.id, 1));
    await recordAudit(
      tx,
      actor,
      "shipping_confirmed",
      "settings",
      "1",
      "Confirmed the shipping and tax setup is correct",
    );
  });
  return { ok: true };
}
