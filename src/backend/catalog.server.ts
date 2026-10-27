import { eq } from "drizzle-orm";

import type { Product, Variant } from "@/lib/catalog";

import { getDb, type Db } from "./db/client.server";
import { products } from "./db/schema";

type ProductRow = Awaited<ReturnType<typeof loadActiveProducts>>[number];

const COLOR_OPTION_NAMES = new Set(["color", "colour"]);

// Amounts are shown as decimal strings; this assumes 2-decimal currencies (USD today).
export const centsToAmount = (cents: number) => (cents / 100).toFixed(2);

function loadActiveProducts(db: Db) {
  return db.query.products.findMany({
    where: eq(products.status, "active"),
    with: {
      category: true,
      variants: { orderBy: (v, { asc }) => [asc(v.position), asc(v.sku)] },
      images: { orderBy: (i, { asc }) => [asc(i.position), asc(i.createdAt)] },
    },
    orderBy: (p, { asc }) => [asc(p.sortOrder), asc(p.handle)],
    limit: 200,
  });
}

export function toProduct(row: ProductRow): Product {
  const variants: Variant[] = row.variants.map((v) => ({
    id: v.id,
    title: v.title,
    price: { amount: centsToAmount(v.priceCents), currencyCode: v.currency },
    availableForSale: v.stock > 0,
    selectedOptions: v.selectedOptions,
  }));

  const optionValues = new Map<string, string[]>();
  for (const variant of variants) {
    for (const { name, value } of variant.selectedOptions) {
      const values = optionValues.get(name) ?? [];
      if (!values.includes(value)) values.push(value);
      optionValues.set(name, values);
    }
  }
  const options = [...optionValues].map(([name, values]) => ({ name, values }));
  const colorOption = options.find((o) => COLOR_OPTION_NAMES.has(o.name.toLowerCase()));
  const lowestPriceCents = Math.min(...row.variants.map((v) => v.priceCents));
  const [image] = row.images;

  return {
    id: row.handle,
    name: row.title,
    category: row.category.name,
    color: colorOption?.values[0] ?? "",
    tag: row.tags[0] ?? "",
    description: row.description,
    price: lowestPriceCents / 100,
    currencyCode: row.variants[0]?.currency ?? "USD",
    image: image?.url ?? "",
    imageAlt: image?.alt || row.title,
    images: row.images.map((i) => ({ url: i.url, alt: i.alt || row.title })),
    details: row.details,
    materialsCare: row.materialsCare,
    options,
    variants,
  };
}

// A product with no variants can't be priced or bought, so it stays off the storefront.
export async function fetchActiveProducts(db: Db = getDb()): Promise<Product[]> {
  const rows = await loadActiveProducts(db);
  return rows.filter((row) => row.variants.length > 0).map(toProduct);
}
