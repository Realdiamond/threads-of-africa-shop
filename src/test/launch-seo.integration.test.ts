// @vitest-environment node
//
// Real-Postgres tests for the launch checklist and for what search engines and Google see.
// Skipped when TEST_DATABASE_URL is not set.
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { launchChecklist } from "@/backend/admin/launch.server";
import * as schema from "@/backend/db/schema";
import {
  categories,
  emailOutbox,
  productImages,
  products,
  sitePages,
  variants,
} from "@/backend/db/schema";
import { queueEmail } from "@/backend/email/outbox.server";
import { requeueFailedEmails } from "@/backend/email/processor.server";
import { googleFeedXml, robotsTxt, sitemapXml, xmlEscape } from "@/backend/seo.server";
import { confirmShipping } from "@/backend/settings.server";
import { POLICY_SLUGS } from "@/lib/policy-defaults";

if (!process.env["TEST_DATABASE_URL"]) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file: the suite is skipped below.
  }
}
const url = process.env["TEST_DATABASE_URL"];

describe.skipIf(!url)("launch checklist and search-engine files (Postgres)", () => {
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
      sql`truncate email_outbox, site_pages, store_settings, shipping_zones, product_images, variants, products, categories, audit_log restart identity cascade`,
    );
  });

  async function product(
    handle: string,
    over: Partial<typeof products.$inferInsert> = {},
    stock = 3,
  ) {
    const [category] = await db
      .insert(categories)
      .values({ slug: `c-${handle}`, name: `Cat ${handle}` })
      .returning();
    const [row] = await db
      .insert(products)
      .values({
        handle,
        title: handle.replace(/-/g, " "),
        categoryId: category!.id,
        status: "active",
        ...over,
      })
      .returning();
    await db.insert(variants).values({
      productId: row!.id,
      sku: `${handle}-M`.toUpperCase(),
      title: "M",
      priceCents: 8500,
      stock,
      selectedOptions: [{ name: "Size", value: "M" }],
    });
    return row!;
  }
  const photo = (productId: string) =>
    db.insert(productImages).values({ productId, url: "/media/abc", alt: "A photo" });

  const byId = (list: Awaited<ReturnType<typeof launchChecklist>>) =>
    Object.fromEntries(list.items.map((i) => [i.id, i]));

  describe("the launch checklist", () => {
    it("starts with everything still to do", async () => {
      const list = await launchChecklist(db, {});
      const items = byId(list);
      expect(items["payments"]).toMatchObject({ status: "todo" });
      expect(items["email"]).toMatchObject({ status: "todo" });
      expect(items["site-url"]).toMatchObject({ status: "todo" });
      expect(items["products"]).toMatchObject({ status: "todo" });
      expect(items["photos"]).toMatchObject({ status: "todo" });
      expect(items["shipping"]).toMatchObject({ status: "todo" });
      expect(items["policies"]).toMatchObject({ status: "todo" });
      expect(list.done).toBe(0);
      expect(list.required).toBe(7);
      expect(list.items.filter((i) => i.optional).map((i) => i.id)).toEqual(["social", "whatsapp"]);
    });

    it("warns, rather than celebrates, when payments are only in test mode", async () => {
      const test = byId(
        await launchChecklist(db, {
          STRIPE_SECRET_KEY: "sk_test_x",
          STRIPE_WEBHOOK_SECRET: "whsec_x",
        }),
      );
      expect(test["payments"]).toMatchObject({ status: "warning" });
      expect(test["payments"]!.detail).toContain("TEST mode");
      const mock = byId(
        await launchChecklist(db, { PAYMENTS_PROVIDER: "mock", NODE_ENV: "development" }),
      );
      expect(mock["payments"]).toMatchObject({ status: "warning" });
      expect(mock["payments"]!.detail).toContain("anyone can 'pay' without money");
      const live = byId(
        await launchChecklist(db, {
          STRIPE_SECRET_KEY: "sk_live_x",
          STRIPE_WEBHOOK_SECRET: "whsec_x",
        }),
      );
      expect(live["payments"]).toMatchObject({ status: "done" });
    });

    it("is complete once everything is set up", async () => {
      const row = await product("kofi-shirt");
      await photo(row.id);
      await db.execute(
        sql`with z as (insert into shipping_zones (name, rest_of_world, tax_bps, sort_order) values ('Everywhere', true, 0, 1) returning id) insert into shipping_rates (zone_id, name, price_cents, estimate, sort_order) select id, 'Standard', 1000, '', 0 from z`,
      );
      expect(await confirmShipping({ id: null, email: "owner@example.com" }, db)).toMatchObject({
        ok: true,
      });
      await db.insert(sitePages).values(
        POLICY_SLUGS.map((slug) => ({
          slug,
          title: slug,
          body: "Reviewed text",
          reviewedAt: new Date(),
        })),
      );
      const list = await launchChecklist(db, {
        STRIPE_SECRET_KEY: "sk_live_x",
        STRIPE_WEBHOOK_SECRET: "whsec_x",
        RESEND_API_KEY: "re_x",
        SITE_URL: "https://shop.example",
      });
      expect(list.done).toBe(list.required);
      expect(list.items.filter((i) => !i.optional).every((i) => i.status === "done")).toBe(true);
    });

    it("notices products without photos and failed emails, and can retry them", async () => {
      const withPhoto = await product("with-photo");
      await photo(withPhoto.id);
      await product("without-photo");
      await product("a-draft", { status: "draft" });
      let items = byId(await launchChecklist(db, {}));
      expect(items["products"]!.detail).toBe("2 products live.");
      expect(items["photos"]).toMatchObject({ status: "todo" });
      expect(items["photos"]!.detail).toBe("1 live product has no photo yet.");

      await queueEmail(db, {
        to: "a@example.com",
        subject: "s",
        text: "t",
        html: "h",
        kind: "test",
      });
      await db.update(emailOutbox).set({ status: "failed", attempts: 6 });
      const list = await launchChecklist(db, {});
      items = byId(list);
      expect(items["email-failed"]).toMatchObject({ status: "warning" });
      expect(list.emailBacklog).toEqual({ pending: 0, failed: 1 });
      // The failed-email notice is not one of the things needed to launch.
      expect(list.required).toBe(7);

      expect(await requeueFailedEmails(db)).toBe(1);
      const [mail] = await db.select().from(emailOutbox);
      expect(mail).toMatchObject({ status: "pending", attempts: 0 });
      expect(byId(await launchChecklist(db, {}))["email-failed"]).toBeUndefined();
    });
  });

  describe("sitemap, robots and the Google feed", () => {
    it("lists the pages and only the live products", async () => {
      const live = await product("kofi-heritage-shirt");
      await product("hidden-draft", { status: "draft" });
      const [empty] = await db
        .insert(products)
        .values({
          handle: "no-variants",
          title: "No variants",
          categoryId: live.categoryId,
          status: "active",
        })
        .returning();
      expect(empty).toBeDefined();

      const xml = await sitemapXml(db, "https://shop.example");
      expect(xml).toContain("<loc>https://shop.example</loc>");
      expect(xml).toContain("<loc>https://shop.example/shop</loc>");
      expect(xml).toContain("<loc>https://shop.example/privacy</loc>");
      expect(xml).toContain("<loc>https://shop.example/product/kofi-heritage-shirt</loc>");
      expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
      expect(xml).not.toContain("hidden-draft");
      expect(xml).not.toContain("no-variants");
      // Private areas never appear.
      expect(xml).not.toMatch(/\/(admin|account|checkout|orders|api)\b/);
    });

    it("keeps private areas out of search engines and points to the sitemap", () => {
      const robots = robotsTxt("https://shop.example");
      for (const path of ["/admin", "/api/", "/checkout", "/account", "/orders/"]) {
        expect(robots).toContain(`Disallow: ${path}`);
      }
      expect(robots).toContain("Sitemap: https://shop.example/sitemap.xml");
    });

    it("builds a Google Merchant feed with one item per size", async () => {
      const row = await product("amara-dress", {
        title: "Amara & Co <Dress>",
        description: 'A "bold" dress.',
      });
      await photo(row.id);
      await db.insert(variants).values({
        productId: row.id,
        sku: "AMARA-DRESS-L",
        title: "L",
        priceCents: 9000,
        stock: 0,
        selectedOptions: [{ name: "Size", value: "L" }],
      });
      const xml = await googleFeedXml(db, "https://shop.example", "The Shop");
      expect(xml).toContain('xmlns:g="http://base.google.com/ns/1.0"');
      expect(xml.match(/<item>/g)).toHaveLength(2);
      expect(xml).toContain("<g:id>AMARA-DRESS-M</g:id>");
      expect(xml).toContain("<g:item_group_id>amara-dress</g:item_group_id>");
      expect(xml).toContain("<g:price>85.00 USD</g:price>");
      expect(xml).toContain("<g:price>90.00 USD</g:price>");
      expect(xml).toContain("<g:availability>in_stock</g:availability>");
      expect(xml).toContain("<g:availability>out_of_stock</g:availability>");
      expect(xml).toContain("<g:image_link>https://shop.example/media/abc</g:image_link>");
      expect(xml).toContain("<g:size>L</g:size>");
      // Text from the catalog cannot break out of the markup.
      expect(xml).toContain("Amara &amp; Co &lt;Dress&gt;");
      expect(xml).not.toContain("<Dress>");
      expect(xml).toContain("A &quot;bold&quot; dress.");
      expect(
        await db.select().from(products).where(eq(products.handle, "amara-dress")),
      ).toHaveLength(1);
    });

    it("escapes everything that could break XML", () => {
      expect(xmlEscape(`<a href="x">&'</a>`)).toBe(
        "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;",
      );
    });
  });
});
