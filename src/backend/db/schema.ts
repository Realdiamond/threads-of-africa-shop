import { relations, sql, type SQL } from "drizzle-orm";
import {
  check,
  customType,
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
    // Fit notes and fabric/care text shown on the product page; empty falls back to generic copy.
    details: text("details").notNull().default(""),
    materialsCare: text("materials_care").notNull().default(""),
    // Bumped on every save so two admins cannot silently overwrite each other.
    version: integer("version").notNull().default(1),
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
    check("product_images_url_local", sql`${t.url} ~ '^/(media|products)/[A-Za-z0-9._-]+$'`),
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

export const adminRole = pgEnum("admin_role", ["owner", "staff"]);
// invited = holds a temporary password and must set their own before doing anything else.
export const adminStatus = pgEnum("admin_status", ["invited", "active", "disabled"]);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const adminUsers = pgTable(
  "admin_users",
  {
    id: id(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: adminRole("role").notNull().default("staff"),
    status: adminStatus("status").notNull().default("invited"),
    passwordHash: text("password_hash").notNull(),
    // NULL means the person has never signed in.
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("admin_users_email_normalised", sql`${t.email} = lower(btrim(${t.email}))`),
    check("admin_users_email_has_at", sql`position('@' in ${t.email}) > 1`),
    check("admin_users_name_not_blank", sql`length(btrim(${t.name})) > 0`),
  ],
);

// Only a hash of the session token is stored, so a database leak does not leak live sessions.
export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("admin_sessions_user_idx").on(t.adminUserId),
    index("admin_sessions_expires_idx").on(t.expiresAt),
  ],
);

// Uploaded product photos live in Postgres: no extra storage service to run or pay for.
export const media = pgTable(
  "media",
  {
    id: id(),
    contentType: text("content_type").notNull(),
    data: bytea("data").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    filename: text("filename").notNull().default(""),
    uploadedBy: uuid("uploaded_by").references(() => adminUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "media_content_type_allowed",
      sql`${t.contentType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check("media_size_range", sql`${t.byteSize} between 1 and 5242880`),
    check("media_size_matches_data", sql`${t.byteSize} = octet_length(${t.data})`),
  ],
);

// Append-only record of what admins did. The email is copied so history survives user removal.
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    adminUserId: uuid("admin_user_id").references(() => adminUsers.id, { onDelete: "set null" }),
    adminEmail: text("admin_email").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull().default(""),
    summary: text("summary").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt),
    index("audit_log_entity_idx").on(t.entity, t.entityId),
  ],
);
