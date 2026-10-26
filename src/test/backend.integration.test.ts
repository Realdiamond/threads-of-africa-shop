// @vitest-environment node
//
// Runs against a real Postgres, never a mock: the cart rules rely on row locks and constraints.
//   TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/toa_test bun run test
// Skipped when TEST_DATABASE_URL is not set.
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addToCart,
  createCart,
  getCart,
  purgeExpiredCarts,
  removeCartLine,
  updateCartLine,
} from "@/backend/cart.server";
import { fetchActiveProducts } from "@/backend/catalog.server";
import { startCheckout, validateCartForCheckout } from "@/backend/checkout.server";
import * as schema from "@/backend/db/schema";
import {
  cartLines,
  carts,
  categories,
  productImages,
  products,
  variants,
} from "@/backend/db/schema";

if (!process.env["TEST_DATABASE_URL"]) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file: the suite is skipped below.
  }
}
const url = process.env["TEST_DATABASE_URL"];

describe.skipIf(!url)("backend (Postgres)", () => {
  // Every test truncates the tables, so refuse to run against anything that isn't a test database.
  if (url && !new URL(url).pathname.includes("test")) {
    throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'");
  }

  const pool = new Pool({ connectionString: url, max: 20 });
  const db = drizzle(pool, { schema });

  let sizeM: string; // stock 3
  let sizeL: string; // stock 0 (sold out)
  let sizeXL: string; // stock 25 (limited only by the per-line cap)
  let draftVariant: string;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "./db/migrations" });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate cart_lines, carts, product_images, variants, products, categories restart identity cascade`,
    );
    const [women] = await db
      .insert(categories)
      .values({ slug: "women", name: "Women" })
      .returning();
    const [active] = await db
      .insert(products)
      .values({
        handle: "amara-dress",
        title: "Amara Dress",
        categoryId: women!.id,
        tags: ["bestseller"],
        status: "active",
        sortOrder: 20,
      })
      .returning();
    const [second] = await db
      .insert(products)
      .values({
        handle: "kofi-shirt",
        title: "Kofi Shirt",
        categoryId: women!.id,
        status: "active",
        sortOrder: 10,
      })
      .returning();
    const [draft] = await db
      .insert(products)
      .values({
        handle: "secret-draft",
        title: "Secret Draft",
        categoryId: women!.id,
        status: "draft",
      })
      .returning();
    await db.insert(products).values({
      handle: "no-variants",
      title: "No Variants",
      categoryId: women!.id,
      status: "active",
    });
    await db
      .insert(productImages)
      .values({ productId: active!.id, url: "/products/amara.jpg", alt: "Amara" });

    const opt = (size: string) => [{ name: "Size", value: size }];
    const inserted = await db
      .insert(variants)
      .values([
        {
          productId: active!.id,
          sku: "AM-M",
          title: "M",
          priceCents: 12900,
          stock: 3,
          selectedOptions: opt("M"),
        },
        {
          productId: active!.id,
          sku: "AM-L",
          title: "L",
          priceCents: 12900,
          stock: 0,
          selectedOptions: opt("L"),
        },
        {
          productId: active!.id,
          sku: "AM-XL",
          title: "XL",
          priceCents: 12900,
          stock: 25,
          selectedOptions: opt("XL"),
        },
        {
          productId: second!.id,
          sku: "KO-M",
          title: "M",
          priceCents: 8500,
          stock: 5,
          selectedOptions: opt("M"),
        },
        {
          productId: draft!.id,
          sku: "DR-M",
          title: "M",
          priceCents: 1000,
          stock: 5,
          selectedOptions: opt("M"),
        },
      ])
      .returning();
    const bySku = new Map(inserted.map((v) => [v.sku, v.id]));
    sizeM = bySku.get("AM-M")!;
    sizeL = bySku.get("AM-L")!;
    sizeXL = bySku.get("AM-XL")!;
    draftVariant = bySku.get("DR-M")!;
  });

  async function pgCode(promise: Promise<unknown>) {
    try {
      await promise;
      return null;
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause;
      return cause?.code ?? (error as { code?: string }).code ?? "unknown";
    }
  }

  describe("schema constraints", () => {
    it("rejects negative prices, negative stock and bad currencies", async () => {
      const [product] = await db.select().from(products).limit(1);
      const base = {
        productId: product!.id,
        title: "X",
        selectedOptions: [{ name: "Size", value: "Z" }],
      };
      const check = "23514";

      expect(await pgCode(db.insert(variants).values({ ...base, sku: "N1", priceCents: -1 }))).toBe(
        check,
      );
      expect(
        await pgCode(db.insert(variants).values({ ...base, sku: "N2", priceCents: 1, stock: -1 })),
      ).toBe(check);
      expect(
        await pgCode(
          db.insert(variants).values({ ...base, sku: "N3", priceCents: 1, currency: "usd" }),
        ),
      ).toBe(check);
    });

    it("rejects duplicate SKUs, duplicate option combinations and malformed handles", async () => {
      const [product] = await db.select().from(products).limit(1);
      const unique = "23505";
      const check = "23514";

      expect(
        await pgCode(
          db.insert(variants).values({
            productId: product!.id,
            sku: "AM-M",
            title: "dup",
            priceCents: 1,
            selectedOptions: [{ name: "Size", value: "Q" }],
          }),
        ),
      ).toBe(unique);
      expect(
        await pgCode(
          db.insert(variants).values({
            productId: product!.id,
            sku: "NEW-SKU",
            title: "dup",
            priceCents: 1,
            selectedOptions: [{ name: "Size", value: "M" }],
          }),
        ),
      ).toBe(unique);
      expect(
        await pgCode(
          db
            .insert(products)
            .values({ handle: "Bad Handle!", title: "x", categoryId: product!.categoryId }),
        ),
      ).toBe(check);
    });

    it("keeps cart line quantity within 1..99 and one line per variant per cart", async () => {
      const [cart] = await db.insert(carts).values({}).returning();
      const line = { cartId: cart!.id, variantId: sizeM };

      expect(await pgCode(db.insert(cartLines).values({ ...line, quantity: 0 }))).toBe("23514");
      expect(await pgCode(db.insert(cartLines).values({ ...line, quantity: 100 }))).toBe("23514");
      await db.insert(cartLines).values({ ...line, quantity: 1 });
      expect(await pgCode(db.insert(cartLines).values({ ...line, quantity: 2 }))).toBe("23505");
    });

    it("generates version-7 UUIDs for public ids", async () => {
      const [product] = await db.select().from(products).limit(1);
      expect(product!.id[14]).toBe("7");
    });
  });

  describe("catalog", () => {
    it("lists only active products that have variants, in sort order", async () => {
      const catalog = await fetchActiveProducts(db);

      expect(catalog.map((p) => p.id)).toEqual(["kofi-shirt", "amara-dress"]);
      const amara = catalog.find((p) => p.id === "amara-dress")!;
      expect(amara.price).toBe(129);
      expect(amara.category).toBe("Women");
      expect(amara.variants.find((v) => v.title === "L")?.availableForSale).toBe(false);
      expect(amara.variants.find((v) => v.title === "M")?.availableForSale).toBe(true);
    });
  });

  describe("cart", () => {
    it("creates a cart, merges repeat adds of one variant, and prices lines from the database", async () => {
      const created = await createCart(sizeM, 1, db);
      if (!created.ok) throw new Error(created.message);
      const { cartId } = created.cart;

      const added = await addToCart(cartId, sizeM, 1, db);
      if (!added.ok) throw new Error(added.message);
      expect(added.cart.lines).toHaveLength(1);
      expect(added.cart.lines[0]).toMatchObject({
        quantity: 2,
        price: { amount: "129.00", currencyCode: "USD" },
      });
      expect(added.cart.totalQuantity).toBe(2);

      await db
        .update(variants)
        .set({ priceCents: 10000 })
        .where(sql`${variants.id} = ${sizeM}`);
      const reread = await getCart(cartId, db);
      expect(reread.ok && reread.cart.lines[0]?.price.amount).toBe("100.00");
    });

    it("refuses quantities beyond stock or the per-line limit, and sold-out variants", async () => {
      const created = await createCart(sizeM, 3, db);
      if (!created.ok) throw new Error(created.message);
      const { cartId } = created.cart;

      expect(await addToCart(cartId, sizeM, 1, db)).toMatchObject({
        ok: false,
        code: "OUT_OF_STOCK",
        available: 3,
      });
      expect(await addToCart(cartId, sizeL, 1, db)).toMatchObject({
        ok: false,
        code: "OUT_OF_STOCK",
        available: 0,
      });
      expect(await createCart(sizeXL, 11, db)).toMatchObject({
        ok: false,
        code: "OUT_OF_STOCK",
        available: 10,
      });
    });

    it("treats draft products and unknown variants as unavailable", async () => {
      expect(await createCart(draftVariant, 1, db)).toMatchObject({
        ok: false,
        code: "VARIANT_NOT_FOUND",
      });
      expect(await createCart("00000000-0000-4000-8000-000000000000", 1, db)).toMatchObject({
        ok: false,
        code: "VARIANT_NOT_FOUND",
      });
    });

    it("updates and removes lines; removing twice is harmless", async () => {
      const created = await createCart(sizeXL, 1, db);
      if (!created.ok) throw new Error(created.message);
      const { cartId } = created.cart;
      const lineId = created.cart.lines[0]!.lineId;

      const updated = await updateCartLine(cartId, lineId, 4, db);
      expect(updated.ok && updated.cart.lines[0]?.quantity).toBe(4);
      expect(await updateCartLine(cartId, lineId, 11, db)).toMatchObject({
        ok: false,
        code: "OUT_OF_STOCK",
      });

      const removed = await removeCartLine(cartId, lineId, db);
      expect(removed.ok && removed.cart.lines).toHaveLength(0);
      expect((await removeCartLine(cartId, lineId, db)).ok).toBe(true);
    });

    it("reports unknown and expired carts as not found", async () => {
      expect(await getCart("00000000-0000-4000-8000-000000000000", db)).toMatchObject({
        ok: false,
        code: "CART_NOT_FOUND",
      });

      const created = await createCart(sizeXL, 1, db);
      if (!created.ok) throw new Error(created.message);
      const { cartId } = created.cart;
      await db.update(carts).set({ expiresAt: sql`now() - interval '1 minute'` });

      expect(await getCart(cartId, db)).toMatchObject({ ok: false, code: "CART_NOT_FOUND" });
      expect(await addToCart(cartId, sizeXL, 1, db)).toMatchObject({
        ok: false,
        code: "CART_NOT_FOUND",
      });
    });

    it("never lets one cart touch another cart's lines", async () => {
      const a = await createCart(sizeXL, 2, db);
      const b = await createCart(sizeXL, 1, db);
      if (!a.ok || !b.ok) throw new Error("setup failed");
      const lineOfA = a.cart.lines[0]!.lineId;

      expect(await updateCartLine(b.cart.cartId, lineOfA, 9, db)).toMatchObject({
        ok: false,
        code: "LINE_NOT_FOUND",
      });
      await removeCartLine(b.cart.cartId, lineOfA, db);

      const stillThere = await getCart(a.cart.cartId, db);
      expect(stillThere.ok && stillThere.cart.lines[0]).toMatchObject({
        lineId: lineOfA,
        quantity: 2,
      });
    });

    it("cannot be pushed past the line limit by concurrent requests", async () => {
      const created = await createCart(sizeXL, 1, db);
      if (!created.ok) throw new Error(created.message);
      const { cartId } = created.cart;

      const results = await Promise.all(
        Array.from({ length: 14 }, () => addToCart(cartId, sizeXL, 1, db)),
      );

      expect(results.filter((r) => r.ok)).toHaveLength(9); // 1 existing + 9 = the limit of 10
      expect(results.filter((r) => !r.ok && r.code === "OUT_OF_STOCK")).toHaveLength(5);
      const final = await getCart(cartId, db);
      expect(final.ok && final.cart.lines[0]?.quantity).toBe(10);
    });

    it("purges only expired carts", async () => {
      const keep = await createCart(sizeXL, 1, db);
      const drop = await createCart(sizeXL, 1, db);
      if (!keep.ok || !drop.ok) throw new Error("setup failed");
      await db
        .update(carts)
        .set({ expiresAt: sql`now() - interval '1 day'` })
        .where(sql`${carts.id} = ${drop.cart.cartId}`);

      expect(await purgeExpiredCarts(db)).toBe(1);
      expect((await getCart(keep.cart.cartId, db)).ok).toBe(true);
      expect((await getCart(drop.cart.cartId, db)).ok).toBe(false);
    });
  });

  describe("checkout", () => {
    it("re-checks the bag against live stock", async () => {
      const created = await createCart(sizeM, 2, db);
      if (!created.ok) throw new Error(created.message);
      const { cartId } = created.cart;
      expect(await validateCartForCheckout(cartId, db)).toMatchObject({ ok: true });

      await db
        .update(variants)
        .set({ stock: 1 })
        .where(sql`${variants.id} = ${sizeM}`);
      expect(await validateCartForCheckout(cartId, db)).toMatchObject({
        ok: false,
        code: "ITEMS_UNAVAILABLE",
      });

      const line = created.cart.lines[0]!.lineId;
      await removeCartLine(cartId, line, db);
      expect(await validateCartForCheckout(cartId, db)).toMatchObject({
        ok: false,
        code: "CART_EMPTY",
      });
      expect(
        await validateCartForCheckout("00000000-0000-4000-8000-000000000000", db),
      ).toMatchObject({
        ok: false,
        code: "CART_NOT_FOUND",
      });
    });

    it("stays closed until payments are configured", async () => {
      const created = await createCart(sizeXL, 1, db);
      if (!created.ok) throw new Error(created.message);

      expect(await startCheckout(created.cart.cartId, db)).toMatchObject({
        ok: false,
        code: "PAYMENTS_NOT_CONFIGURED",
      });
    });
  });
});
