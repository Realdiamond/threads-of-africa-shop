// Loads the starter catalog (db/seed/products.json) into an empty database.
//   bun run db:seed            first-time setup; refuses if products already exist
//   bun run db:seed -- --force overwrite the seeded products (discards edits made to them)
import { readFileSync } from "node:fs";

import { count, eq, sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/backend/db/client.server";
import { categories, productImages, products, variants } from "../src/backend/db/schema";

type Seed = {
  categories: Array<{ slug: string; name: string }>;
  products: Array<{
    handle: string;
    title: string;
    description: string;
    category: string;
    tags: string[];
    status: "draft" | "active" | "archived";
    images: Array<{ url: string; alt: string }>;
    variants: Array<{
      sku: string;
      title: string;
      priceCents: number;
      currency: string;
      stock: number;
      selectedOptions: Array<{ name: string; value: string }>;
    }>;
  }>;
};

const seed: Seed = JSON.parse(readFileSync("db/seed/products.json", "utf8"));
const force = process.argv.includes("--force");
const db = getDb();

try {
  const [existing] = await db.select({ total: count() }).from(products);
  if ((existing?.total ?? 0) > 0 && !force) {
    console.error("Products already exist. Re-run with --force to overwrite the seeded products.");
    process.exitCode = 1;
  } else {
    await db.transaction(async (tx) => {
      const categoryIds = new Map<string, string>();
      for (const category of seed.categories) {
        const [row] = await tx
          .insert(categories)
          .values(category)
          .onConflictDoUpdate({ target: categories.slug, set: { name: category.name } })
          .returning({ id: categories.id });
        if (!row) throw new Error(`category ${category.slug} not saved`);
        categoryIds.set(category.slug, row.id);
      }

      for (const [index, product] of seed.products.entries()) {
        const categoryId = categoryIds.get(product.category);
        if (!categoryId) throw new Error(`unknown category ${product.category}`);
        const values = {
          handle: product.handle,
          title: product.title,
          description: product.description,
          categoryId,
          tags: product.tags,
          status: product.status,
          sortOrder: (index + 1) * 10,
        };
        const [row] = await tx
          .insert(products)
          .values(values)
          .onConflictDoUpdate({
            target: products.handle,
            set: { ...values, updatedAt: sql`now()` },
          })
          .returning({ id: products.id });
        if (!row) throw new Error(`product ${product.handle} not saved`);

        await tx.delete(productImages).where(eq(productImages.productId, row.id));
        await tx
          .insert(productImages)
          .values(
            product.images.map((image, position) => ({ productId: row.id, ...image, position })),
          );

        for (const [position, variant] of product.variants.entries()) {
          const variantValues = { productId: row.id, position, ...variant };
          await tx
            .insert(variants)
            .values(variantValues)
            .onConflictDoUpdate({
              target: variants.sku,
              set: { ...variantValues, updatedAt: sql`now()` },
            });
        }
      }
    });
    console.log(`seeded ${seed.products.length} products`);
  }
} catch (error) {
  console.error("seed failed", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
