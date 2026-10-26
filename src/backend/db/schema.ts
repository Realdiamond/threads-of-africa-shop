import { relations, sql, type SQL } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Public ids are UUIDv7 (uuid_generate_v7() is created in the first migration).
// Cart ids are the exception: a guest cart id is a bearer credential, so it uses
// fully random v4 ids instead of time-ordered ones.
const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v7()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

const currencyFormat = (column: SQL) => sql`${column} ~ '^[A-Z]{3}$'`;

export const productStatus = pgEnum("product_status", ["draft", "active", "archived"]);
export const cartStatus = pgEnum("cart_status", ["open", "converted"]);

export type SelectedOption = { name: string; value: string };

export const categories = pgTable(
  "categories",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    check("categories_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("categories_name_not_blank", sql`length(btrim(${t.name})) > 0`),
  ],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    handle: text("handle").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: productStatus("status").notNull().default("draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("products_handle_format", sql`${t.handle} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("products_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    index("products_category_id_idx").on(t.categoryId),
    index("products_status_sort_idx").on(t.status, t.sortOrder),
  ],
);

export const variants = pgTable(
  "variants",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull().unique(),
    title: text("title").notNull(),
    // Money is stored in minor units (cents) with an explicit currency.
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    stock: integer("stock").notNull().default(0),
    // Option names/values are user-defined per product (Size, Color, ...).
    selectedOptions: jsonb("selected_options")
      .$type<SelectedOption[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("variants_price_non_negative", sql`${t.priceCents} >= 0`),
    check("variants_stock_non_negative", sql`${t.stock} >= 0`),
    check("variants_currency_format", currencyFormat(sql`${t.currency}`)),
    check("variants_options_is_array", sql`jsonb_typeof(${t.selectedOptions}) = 'array'`),
    check("variants_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    unique("variants_product_options_unique").on(t.productId, t.selectedOptions),
    index("variants_product_position_idx").on(t.productId, t.position),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    alt: text("alt").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check("product_images_url_not_blank", sql`length(btrim(${t.url})) > 0`),
    index("product_images_product_position_idx").on(t.productId, t.position),
  ],
);

export const carts = pgTable(
  "carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: cartStatus("status").notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
  },
  (t) => [index("carts_expires_at_idx").on(t.expiresAt)],
);

export const cartLines = pgTable(
  "cart_lines",
  {
    id: id(),
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Hard sanity bound; the per-line business limit lives in cart.server.ts.
    check("cart_lines_quantity_range", sql`${t.quantity} between 1 and 99`),
    unique("cart_lines_cart_variant_unique").on(t.cartId, t.variantId),
    index("cart_lines_variant_id_idx").on(t.variantId),
  ],
);

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  variants: many(variants),
  images: many(productImages),
}));

export const variantsRelations = relations(variants, ({ one }) => ({
  product: one(products, { fields: [variants.productId], references: [products.id] }),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
}));

export const cartsRelations = relations(carts, ({ many }) => ({
  lines: many(cartLines),
}));

export const cartLinesRelations = relations(cartLines, ({ one }) => ({
  cart: one(carts, { fields: [cartLines.cartId], references: [carts.id] }),
  variant: one(variants, { fields: [cartLines.variantId], references: [variants.id] }),
}));
