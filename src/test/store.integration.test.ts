// @vitest-environment node
//
// Real-Postgres tests for settings, shipping, policy pages, the inbox, the newsletter and email.
// Skipped when TEST_DATABASE_URL is not set.
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "@/backend/admin/audit.server";
import { recentAudit } from "@/backend/admin/audit.server";
import * as schema from "@/backend/db/schema";
import {
  emailOutbox,
  messages,
  newsletterSubscribers,
  shippingZones,
  sitePages,
  storeSettings,
} from "@/backend/db/schema";
import { queueEmail } from "@/backend/email/outbox.server";
import { emailBacklog, processEmailOutbox, purgeOldEmails } from "@/backend/email/processor.server";
import type { EmailProvider, OutgoingEmail, SendResult } from "@/backend/email/provider.server";
import {
  countNewMessages,
  createMessage,
  deleteMessage,
  listMessages,
  setMessageStatus,
} from "@/backend/messages.server";
import {
  listSubscribers,
  removeSubscriber,
  subscribe,
  subscribersCsv,
  unsubscribeByToken,
} from "@/backend/newsletter.server";
import {
  getSitePage,
  listSitePages,
  resetSitePage,
  reviewSitePage,
  saveSitePage,
} from "@/backend/pages.server";
import {
  confirmShipping,
  getSettings,
  updateSettings,
  type SettingsInput,
} from "@/backend/settings.server";
import {
  deleteShippingZone,
  deliverableCountries,
  listShippingZones,
  quoteShipping,
  saveShippingZone,
  taxFor,
} from "@/backend/shipping.server";
import { COUNTRY_CODES } from "@/lib/countries";
import { POLICY_DEFAULTS } from "@/lib/policy-defaults";
import type { ShippingZoneInput } from "@/lib/store-types";

if (!process.env["TEST_DATABASE_URL"]) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file: the suite is skipped below.
  }
}
const url = process.env["TEST_DATABASE_URL"];
const actor: Actor = { id: null, email: "owner@example.com" };

describe.skipIf(!url)("store settings, shipping, pages, forms and email (Postgres)", () => {
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
    await db.execute(
      sql`truncate audit_log, store_settings, shipping_zones, site_pages, messages, newsletter_subscribers, email_outbox restart identity cascade`,
    );
  });

  const validSettings = (overrides: Partial<SettingsInput> = {}): SettingsInput => ({
    storeName: "The Threads of Africa",
    contactEmail: "hello@example.com",
    whatsappNumber: "",
    instagramUrl: "",
    tiktokUrl: "",
    facebookUrl: "",
    pinterestUrl: "",
    announcement: "Free returns this month",
    lowStockThreshold: 3,
    ...overrides,
  });

  const zone = (overrides: Partial<ShippingZoneInput> = {}): ShippingZoneInput => ({
    name: "Nigeria",
    restOfWorld: false,
    taxBps: 750,
    countries: ["NG"],
    rates: [{ name: "Standard", priceCents: 1000, freeOverCents: 20000, estimate: "3–5 days" }],
    ...overrides,
  });

  async function saved(input: ShippingZoneInput) {
    const result = await saveShippingZone(actor, input, db);
    if (!result.ok) throw new Error(result.message);
    return result.zoneId;
  }

  describe("settings", () => {
    it("recreates the settings row if it has gone missing", async () => {
      const settings = await getSettings(db);
      expect(settings).toMatchObject({
        storeName: "The Threads of Africa",
        lowStockThreshold: 3,
        shippingConfirmedAt: null,
      });
      expect(await db.select().from(storeSettings)).toHaveLength(1);
    });

    it("saves valid settings, cleaning up pasted phone numbers and spacing", async () => {
      const result = await updateSettings(
        actor,
        validSettings({
          whatsappNumber: "+234 801 234 5678",
          instagramUrl: " https://instagram.com/threadsofafrica ",
          contactEmail: " Hello@Example.com ",
        }),
        db,
      );
      expect(result.ok && result.settings).toMatchObject({
        whatsappNumber: "2348012345678",
        instagramUrl: "https://instagram.com/threadsofafrica",
        contactEmail: "hello@example.com",
      });
      expect((await recentAudit(db))[0]!.action).toBe("settings_updated");
    });

    it("rejects unsafe links and bad values", async () => {
      const bad = async (overrides: Partial<SettingsInput>) =>
        updateSettings(actor, validSettings(overrides), db);

      expect(await bad({ instagramUrl: "javascript:alert(1)" })).toMatchObject({ ok: false });
      expect(await bad({ facebookUrl: "http://facebook.com/x" })).toMatchObject({
        message: expect.stringContaining("https://"),
      });
      expect(await bad({ tiktokUrl: "not a link" })).toMatchObject({ ok: false });
      expect(await bad({ contactEmail: "nope" })).toMatchObject({ ok: false });
      expect(await bad({ whatsappNumber: "123" })).toMatchObject({ ok: false });
      expect(await bad({ announcement: "x".repeat(161) })).toMatchObject({ ok: false });
      expect(await bad({ lowStockThreshold: -1 })).toMatchObject({ ok: false });
      expect(await bad({ storeName: "   " })).toMatchObject({ ok: false });
    });

    it("backs the rules up in the database itself", async () => {
      await getSettings(db);
      await expect(
        db.update(storeSettings).set({ instagramUrl: "javascript:alert(1)" }),
      ).rejects.toThrow();
      await expect(db.update(storeSettings).set({ whatsappNumber: "abc" })).rejects.toThrow();
      await expect(db.insert(storeSettings).values({ id: 2 })).rejects.toThrow();
    });
  });

  describe("shipping zones", () => {
    it("saves a zone with its countries and delivery options", async () => {
      const id = await saved(zone());
      const zones = await listShippingZones(db);
      expect(zones).toHaveLength(1);
      expect(zones[0]).toMatchObject({
        id,
        name: "Nigeria",
        taxBps: 750,
        countries: ["NG"],
        restOfWorld: false,
      });
      expect(zones[0]!.rates[0]).toMatchObject({
        name: "Standard",
        priceCents: 1000,
        freeOverCents: 20000,
      });
    });

    it("rejects invalid zones with a clear reason", async () => {
      const bad = (overrides: Partial<ShippingZoneInput>) =>
        saveShippingZone(actor, zone(overrides), db);

      expect(await bad({ name: " " })).toMatchObject({ code: "INVALID" });
      expect(await bad({ countries: [] })).toMatchObject({
        message: expect.stringContaining("at least one country"),
      });
      expect(await bad({ countries: ["ZZ"] })).toMatchObject({
        message: expect.stringContaining("not a valid country"),
      });
      expect(await bad({ countries: ["NG", "NG"] })).toMatchObject({
        message: expect.stringContaining("twice"),
      });
      expect(await bad({ restOfWorld: true, countries: ["NG"] })).toMatchObject({
        code: "INVALID",
      });
      expect(await bad({ rates: [] })).toMatchObject({
        message: expect.stringContaining("delivery option"),
      });
      expect(await bad({ taxBps: 6000 })).toMatchObject({ code: "INVALID" });
      expect(
        await bad({ rates: [{ name: "X", priceCents: -5, freeOverCents: null, estimate: "" }] }),
      ).toMatchObject({ code: "INVALID" });
      expect(
        await bad({ rates: [{ name: "X", priceCents: 5, freeOverCents: 0, estimate: "" }] }),
      ).toMatchObject({ code: "INVALID" });
      expect(await listShippingZones(db)).toHaveLength(0);
    });

    it("never lets a country sit in two zones, and rolls back the failed save", async () => {
      await saved(zone());
      const other = await saveShippingZone(
        actor,
        zone({ name: "Africa", countries: ["GH", "NG"], taxBps: 0 }),
        db,
      );

      expect(other).toMatchObject({
        ok: false,
        code: "INVALID",
        message: 'Nigeria is already in the "Nigeria" zone.',
      });
      expect((await listShippingZones(db)).map((z) => z.name)).toEqual(["Nigeria"]);
    });

    it("allows only one rest-of-the-world zone and unique names", async () => {
      await saved(zone({ name: "Everywhere", restOfWorld: true, countries: [] }));
      expect(
        await saveShippingZone(
          actor,
          zone({ name: "Elsewhere", restOfWorld: true, countries: [] }),
          db,
        ),
      ).toMatchObject({
        code: "DUPLICATE",
      });
      expect(
        await saveShippingZone(actor, zone({ name: "Everywhere", countries: ["GH"] }), db),
      ).toMatchObject({
        code: "DUPLICATE",
      });
    });

    it("updates a zone in place, replacing its countries and options", async () => {
      const id = await saved(zone({ countries: ["NG", "GH"] }));
      await saved(
        zone({
          id,
          name: "West Africa",
          countries: ["GH", "SN"],
          taxBps: 0,
          rates: [{ name: "Express", priceCents: 2500, freeOverCents: null, estimate: "" }],
        }),
      );

      const [updated] = await listShippingZones(db);
      expect(updated).toMatchObject({ name: "West Africa", countries: ["GH", "SN"], taxBps: 0 });
      expect(updated!.rates.map((r) => r.name)).toEqual(["Express"]);
      expect(
        await saveShippingZone(actor, zone({ id: "00000000-0000-4000-8000-000000000000" }), db),
      ).toMatchObject({ code: "NOT_FOUND" });
    });

    it("clears the 'confirmed' mark whenever shipping changes", async () => {
      expect(await confirmShipping(actor, db)).toMatchObject({ ok: false });
      const id = await saved(zone());
      expect(await confirmShipping(actor, db)).toEqual({ ok: true });
      expect((await getSettings(db)).shippingConfirmedAt).not.toBeNull();

      await saved(zone({ id, taxBps: 800 }));
      expect((await getSettings(db)).shippingConfirmedAt).toBeNull();
    });

    it("keeps at least one zone", async () => {
      const only = await saved(zone());
      expect(await deleteShippingZone(actor, only, db)).toMatchObject({ code: "INVALID" });
      const second = await saved(zone({ name: "Ghana", countries: ["GH"] }));
      expect(await deleteShippingZone(actor, second, db)).toEqual({ ok: true });
      expect(await deleteShippingZone(actor, second, db)).toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("shipping quotes", () => {
    beforeEach(async () => {
      await saved(zone());
      await saved(
        zone({
          name: "Everywhere else",
          restOfWorld: true,
          countries: [],
          taxBps: 0,
          rates: [
            { name: "International", priceCents: 3000, freeOverCents: null, estimate: "7–14 days" },
          ],
        }),
      );
    });

    it("uses the zone that lists the country, else the rest-of-the-world zone", async () => {
      const home = await quoteShipping("ng", 5000, db);
      expect(home).toMatchObject({ ok: true, zone: { name: "Nigeria", taxBps: 750 } });
      expect(home.ok && home.options).toEqual([
        expect.objectContaining({ name: "Standard", priceCents: 1000, estimate: "3–5 days" }),
      ]);

      const abroad = await quoteShipping("FR", 5000, db);
      expect(abroad).toMatchObject({ ok: true, zone: { name: "Everywhere else", taxBps: 0 } });
      expect(abroad.ok && abroad.options[0]!.priceCents).toBe(3000);
    });

    it("makes delivery free once the order reaches the free-delivery amount", async () => {
      const under = await quoteShipping("NG", 19999, db);
      const over = await quoteShipping("NG", 20000, db);
      expect(under.ok && under.options[0]!.priceCents).toBe(1000);
      expect(over.ok && over.options[0]!.priceCents).toBe(0);
    });

    it("refuses countries it does not serve", async () => {
      await db.delete(shippingZones).where(eq(shippingZones.restOfWorld, true));
      expect(await quoteShipping("FR", 5000, db)).toMatchObject({
        ok: false,
        code: "NOT_SHIPPABLE",
      });
      expect(await deliverableCountries(db)).toEqual(["NG"]);
    });

    it("offers every country when a rest-of-the-world zone exists", async () => {
      expect(await deliverableCountries(db)).toHaveLength(COUNTRY_CODES.length);
    });

    it("rounds tax to the nearest cent", () => {
      expect(taxFor(10000, 750)).toBe(750);
      expect(taxFor(999, 750)).toBe(75); // 74.925
      expect(taxFor(12345, 0)).toBe(0);
    });
  });

  describe("policy pages", () => {
    it("shows the starter text until a page is edited", async () => {
      const page = await getSitePage("privacy", db);
      expect(page).toMatchObject({
        isStarter: true,
        title: POLICY_DEFAULTS.privacy.title,
        reviewedAt: null,
      });
      expect((await listSitePages(db)).map((p) => p.slug)).toEqual([
        "privacy",
        "terms",
        "shipping-policy",
        "returns-policy",
      ]);
    });

    it("saves edits, and an edit clears the 'reviewed' mark", async () => {
      expect(
        await saveSitePage(actor, { slug: "terms", title: "Terms", body: "Our terms." }, db),
      ).toEqual({ ok: true });
      expect(await getSitePage("terms", db)).toMatchObject({
        isStarter: false,
        body: "Our terms.",
        updatedBy: "owner@example.com",
      });

      await reviewSitePage(actor, "terms", db);
      expect((await getSitePage("terms", db)).reviewedAt).not.toBeNull();

      await saveSitePage(actor, { slug: "terms", title: "Terms", body: "Our terms, updated." }, db);
      expect((await getSitePage("terms", db)).reviewedAt).toBeNull();
    });

    it("reviewing the starter text adopts it as the live page", async () => {
      await reviewSitePage(actor, "privacy", db);
      const page = await getSitePage("privacy", db);
      expect(page).toMatchObject({ isStarter: false, body: POLICY_DEFAULTS.privacy.body });
      expect(page.reviewedAt).not.toBeNull();
    });

    it("can restore the starter text, and rejects empty or unknown pages", async () => {
      await saveSitePage(actor, { slug: "returns-policy", title: "Returns", body: "Custom." }, db);
      await resetSitePage(actor, "returns-policy", db);
      expect((await getSitePage("returns-policy", db)).isStarter).toBe(true);

      expect(
        await saveSitePage(actor, { slug: "terms", title: "T", body: "  " }, db),
      ).toMatchObject({ code: "INVALID" });
      expect(await saveSitePage(actor, { slug: "terms", title: " ", body: "x" }, db)).toMatchObject(
        { code: "INVALID" },
      );
      expect(
        await saveSitePage(actor, { slug: "about-us", title: "T", body: "x" }, db),
      ).toMatchObject({ code: "NOT_FOUND" });
      expect(await db.select().from(sitePages)).toHaveLength(0);
    });
  });

  describe("contact messages", () => {
    const valid = {
      topic: "wholesale",
      name: "Ada Obi",
      email: " ADA@Example.com ",
      body: "I run a boutique in Lagos.",
    };

    it("stores the message and queues an email to the shop that replies straight to the visitor", async () => {
      await updateSettings(actor, validSettings({ contactEmail: "shop@example.com" }), db);
      expect(await createMessage(valid, db)).toEqual({ ok: true });

      const [message] = await listMessages({}, db);
      expect(message).toMatchObject({
        topic: "wholesale",
        name: "Ada Obi",
        email: "ada@example.com",
        status: "new",
      });

      const [mail] = await db.select().from(emailOutbox);
      expect(mail).toMatchObject({
        toEmail: "shop@example.com",
        replyTo: "ada@example.com",
        kind: "contact-notification",
        status: "pending",
      });
      expect(mail!.subject).toContain("Ada Obi");
      expect(mail!.textBody).toContain("I run a boutique in Lagos.");
    });

    it("escapes anything a visitor types before it goes into the email", async () => {
      await createMessage(
        { ...valid, name: "<script>alert(1)</script>", body: '"><img src=x onerror=alert(1)>' },
        db,
      );
      const [mail] = await db.select().from(emailOutbox);
      expect(mail!.htmlBody).not.toContain("<script>alert(1)</script>");
      expect(mail!.htmlBody).not.toContain("<img src=x");
      expect(mail!.htmlBody).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });

    it("validates input and stores nothing when it is invalid", async () => {
      for (const bad of [
        { ...valid, topic: "spam" },
        { ...valid, name: "  " },
        { ...valid, email: "nope" },
        { ...valid, body: "   " },
        { ...valid, body: "x".repeat(5001) },
      ]) {
        expect(await createMessage(bad, db)).toMatchObject({ ok: false });
      }
      expect(await db.select().from(messages)).toHaveLength(0);
      expect(await db.select().from(emailOutbox)).toHaveLength(0);
    });

    it("lists, filters, resolves and deletes messages", async () => {
      await createMessage(valid, db);
      await createMessage({ ...valid, topic: "general", name: "Bola" }, db);
      expect(await countNewMessages(db)).toBe(2);

      const [first] = await listMessages({}, db);
      expect(await setMessageStatus(actor, first!.id, "handled", db)).toEqual({ ok: true });
      expect(await countNewMessages(db)).toBe(1);
      expect(await listMessages({ status: "handled" }, db)).toHaveLength(1);
      expect((await listMessages({ status: "handled" }, db))[0]!.handledAt).not.toBeNull();

      expect(await deleteMessage(actor, first!.id, db)).toEqual({ ok: true });
      expect(await deleteMessage(actor, first!.id, db)).toMatchObject({ ok: false });
      expect(await setMessageStatus(actor, first!.id, "new", db)).toMatchObject({ ok: false });
    });
  });

  describe("newsletter", () => {
    it("subscribes a new address and queues one welcome email with an unsubscribe link", async () => {
      expect(await subscribe(" New@Example.com ", "homepage", db)).toEqual({ ok: true });

      const [subscriber] = await db.select().from(newsletterSubscribers);
      expect(subscriber).toMatchObject({
        email: "new@example.com",
        status: "subscribed",
        source: "homepage",
      });
      const [mail] = await db.select().from(emailOutbox);
      expect(mail).toMatchObject({ toEmail: "new@example.com", kind: "newsletter-welcome" });
      expect(mail!.textBody).toContain(`/newsletter/unsubscribe?t=${subscriber!.token}`);
    });

    it("answers the same for an address already on the list and sends nothing again", async () => {
      await subscribe("a@example.com", "", db);
      expect(await subscribe("A@example.com", "", db)).toEqual({ ok: true });
      expect(await db.select().from(newsletterSubscribers)).toHaveLength(1);
      expect(await db.select().from(emailOutbox)).toHaveLength(1);
    });

    it("rejects invalid addresses", async () => {
      expect(await subscribe("not-an-email", "", db)).toMatchObject({ ok: false });
      expect(await subscribe("", "", db)).toMatchObject({ ok: false });
      expect(await db.select().from(newsletterSubscribers)).toHaveLength(0);
    });

    it("unsubscribes with the token from the email, and a person can rejoin later", async () => {
      await subscribe("a@example.com", "", db);
      const [row] = await db.select().from(newsletterSubscribers);
      const token = row!.token;

      expect(await unsubscribeByToken(token, db)).toBe(true);
      expect(await unsubscribeByToken(token, db)).toBe(true); // harmless to repeat
      const [gone] = await db.select().from(newsletterSubscribers);
      expect(gone).toMatchObject({ status: "unsubscribed" });
      expect(gone!.unsubscribedAt).not.toBeNull();

      await subscribe("a@example.com", "", db);
      const [back] = await db.select().from(newsletterSubscribers);
      expect(back).toMatchObject({ status: "subscribed", unsubscribedAt: null, token });
      expect(await db.select().from(emailOutbox)).toHaveLength(2);
    });

    it("ignores tokens that are malformed or unknown", async () => {
      expect(await unsubscribeByToken("short", db)).toBe(false);
      expect(await unsubscribeByToken("x".repeat(30), db)).toBe(false);
      expect(await unsubscribeByToken("'; drop table newsletter_subscribers; --", db)).toBe(false);
    });

    it("lists, searches (wildcards are literal) and removes subscribers", async () => {
      await subscribe("anna@example.com", "", db);
      await subscribe("bo_b@example.com", "", db);
      const [anna] = (await listSubscribers({ search: "anna" }, db)).rows;
      expect(anna!.email).toBe("anna@example.com");
      expect((await listSubscribers({ search: "_" }, db)).rows.map((r) => r.email)).toEqual([
        "bo_b@example.com",
      ]);
      expect(await listSubscribers({}, db)).toMatchObject({ subscribed: 2, unsubscribed: 0 });

      expect(await removeSubscriber(actor, anna!.id, db)).toEqual({ ok: true });
      expect(await removeSubscriber(actor, anna!.id, db)).toMatchObject({ ok: false });
    });

    it("exports a CSV that cannot run formulas when opened in a spreadsheet", async () => {
      await db.insert(newsletterSubscribers).values([
        { email: "plain@example.com", token: "t".repeat(24) },
        {
          email: '=hyperlink("http://evil.example")@example.com',
          token: "u".repeat(24),
          source: "a,b",
        },
      ]);
      const csv = await subscribersCsv(db);
      const lines = csv.trim().split("\n");

      expect(lines[0]).toBe("email,status,source,subscribed_at,unsubscribed_at");
      expect(csv).toContain("plain@example.com,subscribed,,");
      expect(csv).toContain(`"'=hyperlink(""http://evil.example"")@example.com"`);
      expect(csv).toContain('"a,b"');
      expect(csv).not.toMatch(/^=/m);
    });
  });

  describe("email outbox", () => {
    const mail = (overrides: Partial<Parameters<typeof queueEmail>[1]> = {}) => ({
      to: "Someone@Example.com",
      subject: "Hello",
      text: "Hi",
      html: "<p>Hi</p>",
      kind: "test",
      ...overrides,
    });

    // `results` is either one outcome for every email, or a function choosing one per email.
    function fakeProvider(
      results: SendResult | ((email: OutgoingEmail) => SendResult) = { ok: true },
    ) {
      const sent: OutgoingEmail[] = [];
      const provider: EmailProvider = {
        name: "fake",
        async send(email) {
          sent.push(email);
          return typeof results === "function" ? results(email) : results;
        },
      };
      return { provider, sent };
    }

    it("queues an email once per dedupe key", async () => {
      expect(await queueEmail(db, mail({ dedupeKey: "order-1" }))).toBe(true);
      expect(await queueEmail(db, mail({ dedupeKey: "order-1" }))).toBe(false);
      expect(await queueEmail(db, mail())).toBe(true);
      expect(await queueEmail(db, mail())).toBe(true); // no key: always queued
      const rows = await db.select().from(emailOutbox);
      expect(rows).toHaveLength(3);
      expect(rows[0]!.toEmail).toBe("someone@example.com");
    });

    it("sends due emails and marks them sent, using the shop's address as the sender", async () => {
      await updateSettings(
        actor,
        validSettings({ storeName: "Threads", contactEmail: "shop@example.com" }),
        db,
      );
      await queueEmail(db, mail({ replyTo: "visitor@example.com" }));
      const { provider, sent } = fakeProvider();

      const result = await processEmailOutbox({ db, provider });

      expect(result).toEqual({ skipped: false, sent: 1, retrying: 0, failed: 0 });
      expect(sent[0]).toMatchObject({
        from: "Threads <shop@example.com>",
        to: "someone@example.com",
        replyTo: "visitor@example.com",
        subject: "Hello",
      });
      const [row] = await db.select().from(emailOutbox);
      expect(row).toMatchObject({ status: "sent", attempts: 1 });
      expect(row!.sentAt).not.toBeNull();
      expect((await processEmailOutbox({ db, provider })).sent).toBe(0); // nothing left
    });

    it("leaves emails queued when no mail service is configured", async () => {
      await queueEmail(db, mail());
      expect(await processEmailOutbox({ db, provider: null })).toMatchObject({ skipped: true });
      expect(await emailBacklog(db)).toEqual({ pending: 1, failed: 0 });
    });

    it("retries temporary failures later and gives up on permanent ones", async () => {
      await queueEmail(db, mail({ dedupeKey: "temporary", subject: "temporary" }));
      await queueEmail(db, mail({ dedupeKey: "permanent", subject: "permanent" }));
      const { provider } = fakeProvider((email) =>
        email.subject === "temporary"
          ? { ok: false, retryable: true, error: "timeout" }
          : { ok: false, retryable: false, error: "invalid address" },
      );

      expect(await processEmailOutbox({ db, provider })).toEqual({
        skipped: false,
        sent: 0,
        retrying: 1,
        failed: 1,
      });

      const rows = await db.select().from(emailOutbox);
      const temporary = rows.find((r) => r.dedupeKey === "temporary")!;
      const permanent = rows.find((r) => r.dedupeKey === "permanent")!;
      expect(temporary).toMatchObject({ status: "pending", lastError: "timeout" });
      expect(temporary.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      expect(permanent).toMatchObject({ status: "failed", lastError: "invalid address" });
      // Not due yet, so a second pass leaves it alone.
      expect((await processEmailOutbox({ db, provider })).retrying).toBe(0);
    });

    it("stops retrying after the maximum number of attempts", async () => {
      await queueEmail(db, mail());
      const { provider } = fakeProvider({ ok: false, retryable: true, error: "still down" });
      for (let attempt = 1; attempt <= 6; attempt++) {
        await db.update(emailOutbox).set({ nextAttemptAt: sql`now() - interval '1 second'` });
        await processEmailOutbox({ db, provider });
      }
      expect((await db.select().from(emailOutbox))[0]).toMatchObject({
        status: "failed",
        attempts: 6,
      });
    });

    it("never sends the same email twice when two senders run at once", async () => {
      for (let i = 0; i < 5; i++) await queueEmail(db, mail({ dedupeKey: `m${i}` }));
      const { provider, sent } = fakeProvider();

      const [a, b] = await Promise.all([
        processEmailOutbox({ db, provider }),
        processEmailOutbox({ db, provider }),
      ]);

      expect(sent).toHaveLength(5);
      expect(a.sent + b.sent).toBe(5);
    });

    it("sends a message again if the sender crashed after claiming it", async () => {
      await queueEmail(db, mail());
      // Simulate a crash: claimed (attempt counted, lease set) but never completed.
      await db
        .update(emailOutbox)
        .set({ attempts: 1, nextAttemptAt: sql`now() + interval '5 minutes'` });
      const { provider, sent } = fakeProvider();
      expect((await processEmailOutbox({ db, provider })).sent).toBe(0);

      await db.update(emailOutbox).set({ nextAttemptAt: sql`now() - interval '1 minute'` });
      expect((await processEmailOutbox({ db, provider })).sent).toBe(1);
      expect(sent).toHaveLength(1);
    });

    it("treats a provider that throws as a temporary failure", async () => {
      await queueEmail(db, mail());
      const provider: EmailProvider = {
        name: "broken",
        async send() {
          throw new Error("socket hang up");
        },
      };
      expect(await processEmailOutbox({ db, provider })).toMatchObject({ retrying: 1 });
    });

    it("removes sent emails after 90 days", async () => {
      await queueEmail(db, mail({ dedupeKey: "old" }));
      await queueEmail(db, mail({ dedupeKey: "recent" }));
      await db
        .update(emailOutbox)
        .set({ status: "sent", sentAt: sql`now() - interval '91 days'` })
        .where(eq(emailOutbox.dedupeKey, "old"));
      await db
        .update(emailOutbox)
        .set({ status: "sent", sentAt: sql`now() - interval '5 days'` })
        .where(eq(emailOutbox.dedupeKey, "recent"));

      expect(await purgeOldEmails(db)).toBe(1);
      expect((await db.select().from(emailOutbox)).map((r) => r.dedupeKey)).toEqual(["recent"]);
    });
  });

  it("does not leak anything sensitive through the public settings shape", async () => {
    const { toPublic } = await import("@/backend/settings.server");
    const publicSettings = toPublic(await getSettings(db));
    expect(Object.keys(publicSettings)).not.toContain("lowStockThreshold");
    expect(Object.keys(publicSettings)).not.toContain("shippingConfirmedAt");
    vi.restoreAllMocks();
  });
});
