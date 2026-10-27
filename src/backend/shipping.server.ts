import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import { COUNTRY_CODES, countryName, isCountryCode } from "@/lib/countries";
import type { ShippingOption, ShippingZoneInput, ShippingZoneView } from "@/lib/store-types";

import { recordAudit, type Actor } from "./admin/audit.server";
import { Abort, abortWith } from "./abort.server";
import { getDb, type Db } from "./db/client.server";
import { shippingRates, shippingZoneCountries, shippingZones, storeSettings } from "./db/schema";
import { pgError, UNIQUE_VIOLATION } from "./pg-error.server";

export type ShippingFailure = {
  ok: false;
  code: "INVALID" | "NOT_FOUND" | "DUPLICATE";
  message: string;
};

const fail = (code: ShippingFailure["code"], message: string): ShippingFailure => ({
  ok: false,
  code,
  message,
});

export async function listShippingZones(db: Db = getDb()): Promise<ShippingZoneView[]> {
  const [zones, countries, rates] = await Promise.all([
    db.select().from(shippingZones).orderBy(asc(shippingZones.sortOrder), asc(shippingZones.name)),
    db.select().from(shippingZoneCountries).orderBy(asc(shippingZoneCountries.countryCode)),
    db
      .select()
      .from(shippingRates)
      .orderBy(asc(shippingRates.sortOrder), asc(shippingRates.createdAt)),
  ]);
  return zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    restOfWorld: zone.restOfWorld,
    taxBps: zone.taxBps,
    countries: countries.filter((c) => c.zoneId === zone.id).map((c) => c.countryCode),
    rates: rates
      .filter((r) => r.zoneId === zone.id)
      .map((r) => ({
        id: r.id,
        name: r.name,
        priceCents: r.priceCents,
        freeOverCents: r.freeOverCents,
        estimate: r.estimate,
      })),
  }));
}

export function validateZoneInput(input: ShippingZoneInput): string | null {
  if (!input.name.trim() || input.name.length > 60)
    return "Give the zone a name (up to 60 characters).";
  if (!Number.isInteger(input.taxBps) || input.taxBps < 0 || input.taxBps > 5000) {
    return "Tax must be between 0% and 50%.";
  }
  const codes = new Set(input.countries);
  if (codes.size !== input.countries.length) return "A country is listed twice.";
  for (const code of input.countries)
    if (!isCountryCode(code)) return `"${code}" is not a valid country.`;
  if (input.restOfWorld && input.countries.length > 0) {
    return "A rest-of-the-world zone covers every country not listed elsewhere, so it cannot list countries.";
  }
  if (!input.restOfWorld && input.countries.length === 0)
    return "Choose at least one country for this zone.";
  if (input.rates.length === 0) return "Add at least one delivery option.";
  if (input.rates.length > 10) return "A zone can have up to 10 delivery options.";
  for (const rate of input.rates) {
    if (!rate.name.trim() || rate.name.length > 60)
      return "Every delivery option needs a name (up to 60 characters).";
    if (!Number.isInteger(rate.priceCents) || rate.priceCents < 0 || rate.priceCents > 1_000_000) {
      return "Delivery prices must be between 0 and 10,000.";
    }
    if (
      rate.freeOverCents !== null &&
      (!Number.isInteger(rate.freeOverCents) || rate.freeOverCents <= 0)
    ) {
      return "The free-delivery amount must be more than 0, or left empty.";
    }
    if (rate.estimate.length > 60) return "Delivery time estimates can be up to 60 characters.";
  }
  return null;
}

export async function saveShippingZone(
  actor: Actor,
  input: ShippingZoneInput,
  db: Db = getDb(),
): Promise<{ ok: true; zoneId: string } | ShippingFailure> {
  const problem = validateZoneInput(input);
  if (problem) return fail("INVALID", problem);

  try {
    return await db.transaction(async (tx) => {
      const fields = {
        name: input.name.trim(),
        restOfWorld: input.restOfWorld,
        taxBps: input.taxBps,
      };
      let zoneId: string;
      if (input.id) {
        const updated = await tx
          .update(shippingZones)
          .set({ ...fields, updatedAt: sql`now()` })
          .where(eq(shippingZones.id, input.id))
          .returning({ id: shippingZones.id });
        if (updated.length === 0)
          return abortWith(fail("NOT_FOUND", "That zone no longer exists."));
        zoneId = input.id;
      } else {
        const [last] = await tx
          .select({ sort: sql<number>`coalesce(max(${shippingZones.sortOrder}), 0)::int` })
          .from(shippingZones)
          .where(ne(shippingZones.restOfWorld, true));
        const [created] = await tx
          .insert(shippingZones)
          .values({ ...fields, sortOrder: (last?.sort ?? 0) + 10 })
          .returning({ id: shippingZones.id });
        if (!created) throw new Error("zone insert returned no row");
        zoneId = created.id;
      }

      if (input.countries.length > 0) {
        const taken = await tx
          .select({ code: shippingZoneCountries.countryCode, zone: shippingZones.name })
          .from(shippingZoneCountries)
          .innerJoin(shippingZones, eq(shippingZones.id, shippingZoneCountries.zoneId))
          .where(
            and(
              inArray(shippingZoneCountries.countryCode, input.countries),
              ne(shippingZoneCountries.zoneId, zoneId),
            ),
          );
        if (taken[0]) {
          return abortWith(
            fail(
              "INVALID",
              `${countryName(taken[0].code)} is already in the "${taken[0].zone}" zone.`,
            ),
          );
        }
      }
      await tx.delete(shippingZoneCountries).where(eq(shippingZoneCountries.zoneId, zoneId));
      if (input.countries.length > 0) {
        await tx
          .insert(shippingZoneCountries)
          .values(input.countries.map((countryCode) => ({ countryCode, zoneId })));
      }

      await tx.delete(shippingRates).where(eq(shippingRates.zoneId, zoneId));
      await tx.insert(shippingRates).values(
        input.rates.map((rate, sortOrder) => ({
          zoneId,
          name: rate.name.trim(),
          priceCents: rate.priceCents,
          freeOverCents: rate.freeOverCents,
          estimate: rate.estimate.trim(),
          sortOrder,
        })),
      );

      // Any change means the owner has to look at shipping again before launch.
      await tx
        .update(storeSettings)
        .set({ shippingConfirmedAt: null })
        .where(eq(storeSettings.id, 1));
      await recordAudit(
        tx,
        actor,
        input.id ? "shipping_zone_updated" : "shipping_zone_created",
        "shipping_zone",
        zoneId,
        `${input.id ? "Updated" : "Added"} shipping zone "${fields.name}" (${input.rates.length} option${input.rates.length === 1 ? "" : "s"})`,
      );
      return { ok: true as const, zoneId };
    });
  } catch (error) {
    if (error instanceof Abort) return error.failure as ShippingFailure;
    const { code, constraint } = pgError(error);
    if (code === UNIQUE_VIOLATION) {
      if (constraint === "shipping_zones_one_rest_of_world") {
        return fail("DUPLICATE", "There is already a rest-of-the-world zone.");
      }
      if (constraint === "shipping_zones_name_unique")
        return fail("DUPLICATE", "A zone with that name already exists.");
    }
    throw error;
  }
}

export async function deleteShippingZone(
  actor: Actor,
  zoneId: string,
  db: Db = getDb(),
): Promise<{ ok: true } | ShippingFailure> {
  try {
    return await db.transaction(async (tx) => {
      const zones = await tx.select().from(shippingZones).for("update");
      const zone = zones.find((z) => z.id === zoneId);
      if (!zone) return abortWith(fail("NOT_FOUND", "That zone no longer exists."));
      if (zones.length === 1)
        return abortWith(
          fail("INVALID", "Keep at least one shipping zone, or customers cannot check out."),
        );
      await tx.delete(shippingZones).where(eq(shippingZones.id, zoneId));
      await tx
        .update(storeSettings)
        .set({ shippingConfirmedAt: null })
        .where(eq(storeSettings.id, 1));
      await recordAudit(
        tx,
        actor,
        "shipping_zone_deleted",
        "shipping_zone",
        zoneId,
        `Deleted shipping zone "${zone.name}"`,
      );
      return { ok: true as const };
    });
  } catch (error) {
    if (error instanceof Abort) return error.failure as ShippingFailure;
    throw error;
  }
}

export type ShippingQuote =
  | {
      ok: true;
      zone: { id: string; name: string; taxBps: number };
      options: ShippingOption[];
    }
  | { ok: false; code: "NOT_SHIPPABLE"; message: string };

// The delivery options and tax for an order going to `country`. A country in a specific zone uses
// that zone; otherwise the rest-of-the-world zone applies; if there is none, we do not ship there.
export async function quoteShipping(
  country: string,
  itemsSubtotalCents: number,
  db: Pick<Db, "select"> = getDb(),
): Promise<ShippingQuote> {
  const code = country.trim().toUpperCase();
  const [listed] = await db
    .select({ zoneId: shippingZoneCountries.zoneId })
    .from(shippingZoneCountries)
    .where(eq(shippingZoneCountries.countryCode, code));
  const [zone] = listed
    ? await db.select().from(shippingZones).where(eq(shippingZones.id, listed.zoneId))
    : await db.select().from(shippingZones).where(eq(shippingZones.restOfWorld, true));
  if (!zone) {
    return {
      ok: false,
      code: "NOT_SHIPPABLE",
      message: "Sorry, we do not deliver to that country yet.",
    };
  }
  const rates = await db
    .select()
    .from(shippingRates)
    .where(eq(shippingRates.zoneId, zone.id))
    .orderBy(asc(shippingRates.sortOrder), asc(shippingRates.createdAt));
  if (rates.length === 0) {
    return {
      ok: false,
      code: "NOT_SHIPPABLE",
      message: "Sorry, we do not deliver to that country yet.",
    };
  }
  return {
    ok: true,
    zone: { id: zone.id, name: zone.name, taxBps: zone.taxBps },
    options: rates.map((rate) => ({
      rateId: rate.id,
      name: rate.name,
      priceCents:
        rate.freeOverCents !== null && itemsSubtotalCents >= rate.freeOverCents
          ? 0
          : rate.priceCents,
      estimate: rate.estimate,
    })),
  };
}

// The countries a customer can pick at checkout.
export async function deliverableCountries(db: Pick<Db, "select"> = getDb()): Promise<string[]> {
  const [restOfWorld] = await db
    .select({ id: shippingZones.id })
    .from(shippingZones)
    .where(eq(shippingZones.restOfWorld, true));
  if (restOfWorld) return [...COUNTRY_CODES];
  const rows = await db
    .select({ code: shippingZoneCountries.countryCode })
    .from(shippingZoneCountries);
  return rows.map((row) => row.code).sort();
}

export const taxFor = (itemsSubtotalCents: number, taxBps: number) =>
  Math.round((itemsSubtotalCents * taxBps) / 10_000);
