import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import type {
  AdminCategory,
  AdminImage,
  AdminProduct,
  AdminProductSummary,
  AdminVariant,
  ProductInput,
  ProductStatus,
} from "@/lib/admin-types";
import { SLUG_PATTERN, slugify } from "@/lib/slug";

import { getDb, type Db } from "../db/client.server";
import { categories, productImages, products, variants, type SelectedOption } from "../db/schema";
import { pgError, UNIQUE_VIOLATION } from "../pg-error.server";
import { recordAudit, type Actor } from "./audit.server";
import { deleteUnreferencedMedia, existingMediaIds, mediaIdFromUrl } from "./media.server";

export type {
  AdminCategory,
  AdminImage,
  AdminProduct,
  AdminProductSummary,
  AdminVariant,
  ProductInput,
  ProductStatus,
};

export type CatalogFailure = {
  ok: false;
  code:
    | "NOT_FOUND"
    | "CONFLICT"
    | "INVALID"
    | "DUPLICATE_HANDLE"
    | "DUPLICATE_SKU"
    | "DUPLICATE_VARIANT"
    | "CATEGORY_NOT_FOUND"
    | "DUPLICATE_CATEGORY"
    | "IN_USE";
  message: string;
};

const fail = (code: CatalogFailure["code"], message: string): CatalogFailure => ({
  ok: false,
  code,
  message,
});

// Thrown inside a transaction to roll everything back and hand the caller a friendly failure.
class Abort extends Error {
  constructor(readonly failure: CatalogFailure) {
    super(failure.message);
  }
}
const abort = (code: CatalogFailure["code"], message: string): never => {
  throw new Abort(fail(code, message));
};

export const LOW_STOCK_THRESHOLD = 3;
const IMAGE_URL = /^\/(media|products)\/[A-Za-z0-9._-]+$/;
const COLOR_NAMES = new Set(["color", "colour"]);

const optionValue = (options: SelectedOption[], match: (name: string) => boolean) =>
  options.find((o) => match(o.name.toLowerCase()))?.value ?? "";

const money = (cents: number) => (cents / 100).toFixed(2);

export function validateProductInput(input: ProductInput): string | null {
  if (!input.title.trim()) return "Enter a product name.";
  if (!SLUG_PATTERN.test(input.handle)) {
    return "The web address can only use lowercase letters, numbers and hyphens.";
  }
  const skus = new Set<string>();
  const combos = new Set<string>();
  for (const v of input.variants) {
    if (!v.size.trim()) return "Every size row needs a size.";
    const sku = v.sku.trim().toLowerCase();
    if (!sku) return "Every size row needs a stock code (SKU).";
    if (skus.has(sku)) return `The stock code "${v.sku.trim()}" is used on two rows.`;
    skus.add(sku);
    const combo = `${v.size.trim().toLowerCase()}|${v.color.trim().toLowerCase()}`;
    if (combos.has(combo)) {
      const label = [v.size.trim(), v.color.trim()].filter(Boolean).join(" / ");
      return `"${label}" appears on two rows.`;
    }
    combos.add(combo);
  }
  for (const image of input.images) {
    if (!IMAGE_URL.test(image.url))
      return "One of the photos is not valid. Remove it and upload it again.";
  }
  if (input.status === "active") {
    if (input.variants.length === 0) return "Add at least one size before publishing.";
    if (input.images.length === 0) return "Add at least one photo before publishing.";
  }
  return null;
}

export async function listAdminProducts(
  filter: { status?: ProductStatus | undefined; search?: string | undefined } = {},
  db: Db = getDb(),
): Promise<AdminProductSummary[]> {
  const term = filter.search?.trim().replace(/[\\%_]/g, "\\$&");
  const pattern = term ? `%${term}%` : null;
  const rows = await db.query.products.findMany({
    where: and(
      filter.status ? eq(products.status, filter.status) : undefined,
      pattern ? or(ilike(products.title, pattern), ilike(products.handle, pattern)) : undefined,
    ),
    with: {
      category: true,
      variants: true,
      images: { orderBy: (i, { asc }) => [asc(i.position)], limit: 1 },
    },
    orderBy: (p, { asc }) => [asc(p.sortOrder), asc(p.handle)],
    limit: 500,
  });

  return rows.map((row) => {
    const prices = row.variants.map((v) => v.priceCents);
    return {
      id: row.id,
      handle: row.handle,
      title: row.title,
      status: row.status,
      category: row.category.name,
      imageUrl: row.images[0]?.url ?? null,
      variantCount: row.variants.length,
      minPriceCents: prices.length ? Math.min(...prices) : 0,
      maxPriceCents: prices.length ? Math.max(...prices) : 0,
      currency: row.variants[0]?.currency ?? "USD",
      totalStock: row.variants.reduce((sum, v) => sum + v.stock, 0),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export async function getAdminProduct(id: string, db: Db = getDb()): Promise<AdminProduct | null> {
  const row = await db.query.products.findFirst({
    where: eq(products.id, id),
    with: {
      variants: { orderBy: (v, { asc }) => [asc(v.position), asc(v.sku)] },
      images: { orderBy: (i, { asc }) => [asc(i.position), asc(i.createdAt)] },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    handle: row.handle,
    title: row.title,
    description: row.description,
    details: row.details,
    materialsCare: row.materialsCare,
    categoryId: row.categoryId,
    tags: row.tags,
    status: row.status,
    sortOrder: row.sortOrder,
    currency: row.variants[0]?.currency ?? "USD",
    variants: row.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      size: optionValue(v.selectedOptions, (n) => n === "size") || v.title,
      color: optionValue(v.selectedOptions, (n) => COLOR_NAMES.has(n)),
      priceCents: v.priceCents,
      stock: v.stock,
    })),
    images: row.images.map((i) => ({ url: i.url, alt: i.alt })),
  };
}

export type SaveProductResult = { ok: true; id: string; version: number } | CatalogFailure;

export async function saveAdminProduct(
  actor: Actor,
  input: ProductInput,
  db: Db = getDb(),
): Promise<SaveProductResult> {
  const problem = validateProductInput(input);
  if (problem) return fail("INVALID", problem);

  try {
    return await db.transaction(async (tx) => {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, input.categoryId));
      if (!category) return abort("CATEGORY_NOT_FOUND", "Choose a category for this product.");

      const fields = {
        handle: input.handle,
        title: input.title.trim(),
        description: input.description.trim(),
        details: input.details.trim(),
        materialsCare: input.materialsCare.trim(),
        categoryId: input.categoryId,
        tags: input.tags,
        status: input.status,
        sortOrder: input.sortOrder,
      };

      let productId: string;
      let version: number;
      let existingVariants: Array<typeof variants.$inferSelect> = [];
      let existingImageUrls: string[] = [];
      const changes: string[] = [];

      if (input.id) {
        const [current] = await tx
          .select()
          .from(products)
          .where(eq(products.id, input.id))
          .for("update");
        if (!current) return abort("NOT_FOUND", "That product no longer exists.");
        if (input.version !== current.version) {
          return abort(
            "CONFLICT",
            "Someone else changed this product while you were editing it. Reload the page to see their changes.",
          );
        }
        existingVariants = await tx
          .select()
          .from(variants)
          .where(eq(variants.productId, current.id));
        existingImageUrls = (
          await tx
            .select({ url: productImages.url })
            .from(productImages)
            .where(eq(productImages.productId, current.id))
        ).map((row) => row.url);
        await tx
          .update(products)
          .set({ ...fields, version: sql`${products.version} + 1`, updatedAt: sql`now()` })
          .where(eq(products.id, current.id));
        productId = current.id;
        version = current.version + 1;
        if (current.status !== input.status)
          changes.push(`status ${current.status} → ${input.status}`);
      } else {
        const [created] = await tx
          .insert(products)
          .values(fields)
          .returning({ id: products.id, version: products.version });
        if (!created) throw new Error("product insert returned no row");
        productId = created.id;
        version = created.version;
        changes.push(`created as ${input.status}`);
      }

      // Sizes: remove what was dropped, update what is kept, add what is new.
      const kept = new Set(input.variants.flatMap((v) => (v.id ? [v.id] : [])));
      const byId = new Map(existingVariants.map((v) => [v.id, v]));
      for (const v of input.variants) {
        if (v.id && !byId.has(v.id))
          return abort("INVALID", "A size row does not belong to this product.");
      }
      const removed = existingVariants.filter((v) => !kept.has(v.id));
      if (removed.length > 0) {
        await tx.delete(variants).where(
          inArray(
            variants.id,
            removed.map((v) => v.id),
          ),
        );
        changes.push(`removed ${removed.map((v) => v.sku).join(", ")}`);
      }
      for (const [position, v] of input.variants.entries()) {
        const options: SelectedOption[] = [{ name: "Size", value: v.size.trim() }];
        if (v.color.trim()) options.push({ name: "Color", value: v.color.trim() });
        const values = {
          sku: v.sku.trim(),
          title: options.map((o) => o.value).join(" / "),
          priceCents: v.priceCents,
          stock: v.stock,
          selectedOptions: options,
          position,
        };
        const previous = v.id ? byId.get(v.id) : undefined;
        if (previous) {
          if (previous.priceCents !== v.priceCents) {
            changes.push(
              `${values.sku} price ${money(previous.priceCents)} → ${money(v.priceCents)}`,
            );
          }
          if (previous.stock !== v.stock)
            changes.push(`${values.sku} stock ${previous.stock} → ${v.stock}`);
          await tx
            .update(variants)
            .set({ ...values, updatedAt: sql`now()` })
            .where(and(eq(variants.id, previous.id), eq(variants.productId, productId)));
        } else {
          await tx.insert(variants).values({ productId, currency: "USD", ...values });
          if (input.id) changes.push(`added ${values.sku}`);
        }
      }

      // Photos: uploaded ones must exist; already-attached ones may stay; the list replaces the old one.
      const uploadIds = input.images.flatMap((i) => mediaIdFromUrl(i.url) ?? []);
      const uploaded = await existingMediaIds(tx, uploadIds);
      for (const image of input.images) {
        const uploadId = mediaIdFromUrl(image.url);
        const usable = uploadId ? uploaded.has(uploadId) : existingImageUrls.includes(image.url);
        if (!usable)
          return abort(
            "INVALID",
            "One of the photos is no longer available. Remove it and upload it again.",
          );
      }
      await tx.delete(productImages).where(eq(productImages.productId, productId));
      if (input.images.length > 0) {
        await tx.insert(productImages).values(
          input.images.map((image, position) => ({
            productId,
            url: image.url,
            alt: image.alt.trim(),
            position,
          })),
        );
      }
      await deleteUnreferencedMedia(
        tx,
        existingImageUrls.filter((url) => !input.images.some((image) => image.url === url)),
      );

      await recordAudit(
        tx,
        actor,
        input.id ? "product_updated" : "product_created",
        "product",
        productId,
        `"${fields.title}": ${changes.length > 0 ? changes.join("; ") : "saved"}`,
      );
      return { ok: true as const, id: productId, version };
    });
  } catch (error) {
    if (error instanceof Abort) return error.failure;
    const { code, constraint } = pgError(error);
    if (code === UNIQUE_VIOLATION) {
      if (constraint === "products_handle_unique") {
        return fail("DUPLICATE_HANDLE", "Another product already uses that web address.");
      }
      if (constraint === "variants_sku_unique") {
        return fail(
          "DUPLICATE_SKU",
          "One of those stock codes (SKUs) is already used by another product.",
        );
      }
      if (constraint === "variants_product_options_unique") {
        return fail("DUPLICATE_VARIANT", "Two rows have the same size and colour.");
      }
    }
    throw error;
  }
}

export async function setAdminProductStatus(
  actor: Actor,
  id: string,
  status: ProductStatus,
  db: Db = getDb(),
): Promise<{ ok: true; version: number } | CatalogFailure> {
  try {
    return await db.transaction(async (tx) => {
      const [product] = await tx.select().from(products).where(eq(products.id, id)).for("update");
      if (!product) return abort("NOT_FOUND", "That product no longer exists.");
      if (status === "active") {
        const [sizes, photos] = await Promise.all([
          tx.select({ id: variants.id }).from(variants).where(eq(variants.productId, id)),
          tx
            .select({ id: productImages.id })
            .from(productImages)
            .where(eq(productImages.productId, id)),
        ]);
        if (sizes.length === 0) return abort("INVALID", "Add at least one size before publishing.");
        if (photos.length === 0)
          return abort("INVALID", "Add at least one photo before publishing.");
      }
      await tx
        .update(products)
        .set({ status, version: sql`${products.version} + 1`, updatedAt: sql`now()` })
        .where(eq(products.id, id));
      await recordAudit(
        tx,
        actor,
        "product_status",
        "product",
        id,
        `"${product.title}": ${product.status} → ${status}`,
      );
      return { ok: true as const, version: product.version + 1 };
    });
  } catch (error) {
    if (error instanceof Abort) return error.failure;
    throw error;
  }
}

export async function deleteAdminProduct(
  actor: Actor,
  id: string,
  db: Db = getDb(),
): Promise<{ ok: true } | CatalogFailure> {
  try {
    return await db.transaction(async (tx) => {
      const [product] = await tx.select().from(products).where(eq(products.id, id)).for("update");
      if (!product) return abort("NOT_FOUND", "That product no longer exists.");
      if (product.status === "active")
        return abort("INVALID", "Archive this product before deleting it.");
      const urls = (
        await tx
          .select({ url: productImages.url })
          .from(productImages)
          .where(eq(productImages.productId, id))
      ).map((row) => row.url);
      await tx.delete(products).where(eq(products.id, id));
      await deleteUnreferencedMedia(tx, urls);
      await recordAudit(tx, actor, "product_deleted", "product", id, `Deleted "${product.title}"`);
      return { ok: true as const };
    });
  } catch (error) {
    if (error instanceof Abort) return error.failure;
    throw error;
  }
}

export async function setVariantStock(
  actor: Actor,
  variantId: string,
  stock: number,
  db: Db = getDb(),
): Promise<{ ok: true; stock: number } | CatalogFailure> {
  try {
    return await db.transaction(async (tx) => {
      const [variant] = await tx
        .select()
        .from(variants)
        .where(eq(variants.id, variantId))
        .for("update");
      if (!variant) return abort("NOT_FOUND", "That size no longer exists.");
      await tx
        .update(variants)
        .set({ stock, updatedAt: sql`now()` })
        .where(eq(variants.id, variantId));
      // Anyone editing the product form right now must be told it changed underneath them.
      await tx
        .update(products)
        .set({ version: sql`${products.version} + 1`, updatedAt: sql`now()` })
        .where(eq(products.id, variant.productId));
      await recordAudit(
        tx,
        actor,
        "stock_changed",
        "variant",
        variantId,
        `${variant.sku} stock ${variant.stock} → ${stock}`,
      );
      return { ok: true as const, stock };
    });
  } catch (error) {
    if (error instanceof Abort) return error.failure;
    throw error;
  }
}

export async function listAdminCategories(db: Db = getDb()): Promise<AdminCategory[]> {
  return db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      // Written out by hand: Drizzle drops table prefixes in a single-table select, which would
      // make the inner "id" shadow the outer one and count nothing.
      productCount: sql<number>`(select count(*)::int from products p where p.category_id = categories.id)`,
    })
    .from(categories)
    .orderBy(asc(categories.name));
}

export async function saveAdminCategory(
  actor: Actor,
  input: { id?: string | undefined; name: string },
  db: Db = getDb(),
): Promise<{ ok: true; category: AdminCategory } | CatalogFailure> {
  const name = input.name.trim();
  const slug = slugify(name);
  if (!name || name.length > 60 || !slug)
    return fail("INVALID", "Enter a category name (up to 60 characters).");
  try {
    return await db.transaction(async (tx) => {
      let id = input.id;
      if (id) {
        const updated = await tx
          .update(categories)
          .set({ name, slug })
          .where(eq(categories.id, id))
          .returning({ id: categories.id });
        if (updated.length === 0) return abort("NOT_FOUND", "That category no longer exists.");
      } else {
        const [created] = await tx
          .insert(categories)
          .values({ name, slug })
          .returning({ id: categories.id });
        if (!created) throw new Error("category insert returned no row");
        id = created.id;
      }
      await recordAudit(
        tx,
        actor,
        input.id ? "category_renamed" : "category_created",
        "category",
        id,
        input.id ? `Renamed a category to "${name}"` : `Added the category "${name}"`,
      );
      return { ok: true as const, category: { id, slug, name, productCount: 0 } };
    });
  } catch (error) {
    if (error instanceof Abort) return error.failure;
    if (pgError(error).code === UNIQUE_VIOLATION) {
      return fail("DUPLICATE_CATEGORY", "A category with that name already exists.");
    }
    throw error;
  }
}

export async function deleteAdminCategory(
  actor: Actor,
  id: string,
  db: Db = getDb(),
): Promise<{ ok: true } | CatalogFailure> {
  try {
    return await db.transaction(async (tx) => {
      const [category] = await tx
        .select()
        .from(categories)
        .where(eq(categories.id, id))
        .for("update");
      if (!category) return abort("NOT_FOUND", "That category no longer exists.");
      const used = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.categoryId, id));
      if (used.length > 0) {
        return abort(
          "IN_USE",
          `${used.length} product${used.length === 1 ? " uses" : "s use"} this category. Move them first.`,
        );
      }
      await tx.delete(categories).where(eq(categories.id, id));
      await recordAudit(
        tx,
        actor,
        "category_deleted",
        "category",
        id,
        `Deleted the category "${category.name}"`,
      );
      return { ok: true as const };
    });
  } catch (error) {
    if (error instanceof Abort) return error.failure;
    throw error;
  }
}
