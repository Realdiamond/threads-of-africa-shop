import { relations, sql, type SQL } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
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

const httpsOrEmpty = (column: SQL) => sql`(${column} = '' or ${column} ~ '^https://[^ ]+$')`;

// One row, always id = 1: shop-wide details the owner edits in the admin.
export const storeSettings = pgTable(
  "store_settings",
  {
    id: smallint("id").primaryKey().default(1),
    storeName: text("store_name").notNull().default("The Threads of Africa"),
    // Shown on the site, and where contact-form messages and new-order alerts are sent.
    contactEmail: text("contact_email").notNull().default("info@thethreadsofafrica.com"),
    // Digits only, with country code and no "+" (e.g. 2348012345678). Empty hides the WhatsApp button.
    whatsappNumber: text("whatsapp_number").notNull().default(""),
    instagramUrl: text("instagram_url").notNull().default(""),
    tiktokUrl: text("tiktok_url").notNull().default(""),
    facebookUrl: text("facebook_url").notNull().default(""),
    pinterestUrl: text("pinterest_url").notNull().default(""),
    announcement: text("announcement")
      .notNull()
      .default("Welcome to The Threads of Africa — Every Thread Tells a Story."),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(3),
    // Set when an owner confirms the shipping and tax setup is real; editing it clears this again.
    shippingConfirmedAt: timestamp("shipping_confirmed_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("store_settings_single_row", sql`${t.id} = 1`),
    check("store_settings_email_has_at", sql`position('@' in ${t.contactEmail}) > 1`),
    check("store_settings_whatsapp_digits", sql`${t.whatsappNumber} ~ '^([0-9]{6,15})?$'`),
    check("store_settings_low_stock_range", sql`${t.lowStockThreshold} between 0 and 1000`),
    check("store_settings_instagram_https", httpsOrEmpty(sql`${t.instagramUrl}`)),
    check("store_settings_tiktok_https", httpsOrEmpty(sql`${t.tiktokUrl}`)),
    check("store_settings_facebook_https", httpsOrEmpty(sql`${t.facebookUrl}`)),
    check("store_settings_pinterest_https", httpsOrEmpty(sql`${t.pinterestUrl}`)),
  ],
);

export const shippingZones = pgTable(
  "shipping_zones",
  {
    id: id(),
    name: text("name").notNull().unique(),
    // The zone that applies to every country not listed in another zone. At most one.
    restOfWorld: boolean("rest_of_world").notNull().default(false),
    // Tax as basis points of the items total: 750 = 7.5%.
    taxBps: integer("tax_bps").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("shipping_zones_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check("shipping_zones_tax_range", sql`${t.taxBps} between 0 and 5000`),
    uniqueIndex("shipping_zones_one_rest_of_world")
      .on(t.restOfWorld)
      .where(sql`${t.restOfWorld}`),
  ],
);

// The primary key makes a country belong to at most one zone.
export const shippingZoneCountries = pgTable(
  "shipping_zone_countries",
  {
    countryCode: text("country_code").primaryKey(),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => shippingZones.id, { onDelete: "cascade" }),
  },
  (t) => [
    check("shipping_zone_countries_code_format", sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    index("shipping_zone_countries_zone_idx").on(t.zoneId),
  ],
);

export const shippingRates = pgTable(
  "shipping_rates",
  {
    id: id(),
    zoneId: uuid("zone_id")
      .notNull()
      .references(() => shippingZones.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceCents: integer("price_cents").notNull(),
    // Orders with items worth at least this much ship free; NULL means never free.
    freeOverCents: integer("free_over_cents"),
    estimate: text("estimate").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("shipping_rates_name_not_blank", sql`length(btrim(${t.name})) > 0`),
    check("shipping_rates_price_non_negative", sql`${t.priceCents} >= 0`),
    check(
      "shipping_rates_free_over_positive",
      sql`${t.freeOverCents} is null or ${t.freeOverCents} > 0`,
    ),
    index("shipping_rates_zone_idx").on(t.zoneId, t.sortOrder),
  ],
);

// Policy pages (privacy, terms, shipping, returns). A missing row means "use the starter text".
export const sitePages = pgTable(
  "site_pages",
  {
    slug: text("slug").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // Set when an owner confirms the text has been reviewed; editing it clears this again.
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    updatedBy: text("updated_by").notNull().default(""),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("site_pages_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("site_pages_title_not_blank", sql`length(btrim(${t.title})) > 0`),
    check("site_pages_body_not_blank", sql`length(btrim(${t.body})) > 0`),
  ],
);

export const messageStatus = pgEnum("message_status", ["new", "handled"]);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    topic: text("topic").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    body: text("body").notNull(),
    status: messageStatus("status").notNull().default("new"),
    createdAt: createdAt(),
    handledAt: timestamp("handled_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "messages_topic_allowed",
      sql`${t.topic} in ('general', 'order', 'wholesale', 'collaboration', 'press')`,
    ),
    check("messages_name_range", sql`length(btrim(${t.name})) between 1 and 100`),
    check("messages_email_has_at", sql`position('@' in ${t.email}) > 1`),
    check("messages_body_range", sql`length(btrim(${t.body})) between 1 and 5000`),
    index("messages_status_created_idx").on(t.status, t.createdAt),
  ],
);

export const subscriberStatus = pgEnum("subscriber_status", ["subscribed", "unsubscribed"]);

export const newsletterSubscribers = pgTable(
  "newsletter_subscribers",
  {
    id: id(),
    email: text("email").notNull().unique(),
    status: subscriberStatus("status").notNull().default("subscribed"),
    // Random secret in each email's unsubscribe link.
    token: text("token").notNull().unique(),
    source: text("source").notNull().default(""),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true }).notNull().defaultNow(),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  },
  (t) => [
    check("newsletter_email_normalised", sql`${t.email} = lower(btrim(${t.email}))`),
    check("newsletter_email_has_at", sql`position('@' in ${t.email}) > 1`),
  ],
);

export const emailStatus = pgEnum("email_status", ["pending", "sent", "failed"]);

// Every email is written here first and sent by a background job, so a mail-service outage never
// loses a message or fails the request that caused it.
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: id(),
    toEmail: text("to_email").notNull(),
    // Set on notifications about a customer's message, so "reply" goes straight to them.
    replyTo: text("reply_to"),
    subject: text("subject").notNull(),
    textBody: text("text_body").notNull(),
    htmlBody: text("html_body").notNull(),
    kind: text("kind").notNull(),
    status: emailStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error").notNull().default(""),
    // Queuing the same key twice is a no-op, so a retried request cannot send a duplicate.
    dedupeKey: text("dedupe_key").unique(),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    check("email_outbox_to_has_at", sql`position('@' in ${t.toEmail}) > 1`),
    index("email_outbox_due_idx").on(t.status, t.nextAttemptAt),
  ],
);

export const orderStatus = pgEnum("order_status", [
  "pending_payment",
  "paid",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

// Shoppers who made an account. Guests never appear here: an order is complete without one.
// The password stays empty until the owner of the email address follows the link we send, so
// nobody can claim someone else's address by registering it first.
export const customers = pgTable(
  "customers",
  {
    id: id(),
    email: text("email").notNull().unique(),
    name: text("name").notNull().default(""),
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("customers_email_normalised", sql`${t.email} = lower(btrim(${t.email}))`),
    check("customers_email_has_at", sql`position('@' in ${t.email}) > 1`),
    // A password can only exist once the email address has been proven.
    check(
      "customers_password_needs_verified_email",
      sql`${t.passwordHash} is null or ${t.emailVerifiedAt} is not null`,
    ),
  ],
);

export const customerSessions = pgTable(
  "customer_sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("customer_sessions_customer_idx").on(t.customerId),
    index("customer_sessions_expires_idx").on(t.expiresAt),
  ],
);

// One-time links sent by email: finishing a new account ("activate") or choosing a new password
// ("reset"). Only a hash of the token is stored, and each token works once.
export const customerTokens = pgTable(
  "customer_tokens",
  {
    id: id(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("customer_tokens_kind", sql`${t.kind} in ('activate', 'reset')`),
    index("customer_tokens_customer_idx").on(t.customerId, t.kind),
    index("customer_tokens_expires_idx").on(t.expiresAt),
  ],
);

// An order is a permanent record: prices, names and the address are copied onto it, so later
// catalog edits never change what a customer bought.
export const orders = pgTable(
  "orders",
  {
    id: id(),
    // Human-friendly order number shown to customers (TOA-1001, TOA-1002, ...).
    number: integer("number").notNull().unique().generatedAlwaysAsIdentity({ startWith: 1001 }),
    status: orderStatus("status").notNull().default("pending_payment"),
    email: text("email").notNull(),
    cartId: uuid("cart_id").references(() => carts.id, { onDelete: "set null" }),
    // Set when the customer was signed in, or when the email address was later proven to be theirs.
    // Deleting an account keeps the order (it is the shop's record) and just clears this.
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    // Sent by the browser once per checkout attempt, so a double-click cannot place two orders.
    idempotencyKey: text("idempotency_key").unique(),
    // Fingerprint of what was asked for, so reusing a key for a different request is refused.
    idempotencyHash: text("idempotency_hash"),
    // Lets a guest open their order from the emailed link. It is stored as given because the
    // emails (queued later, from the payment webhook) need to contain it.
    accessToken: text("access_token").notNull().unique(),

    shipName: text("ship_name").notNull(),
    shipLine1: text("ship_line1").notNull(),
    shipLine2: text("ship_line2").notNull().default(""),
    shipCity: text("ship_city").notNull(),
    shipRegion: text("ship_region").notNull().default(""),
    shipPostalCode: text("ship_postal_code").notNull().default(""),
    shipCountry: text("ship_country").notNull(),
    shipPhone: text("ship_phone").notNull().default(""),

    currency: text("currency").notNull().default("USD"),
    itemsCents: integer("items_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    shippingMethod: text("shipping_method").notNull(),
    shippingZone: text("shipping_zone").notNull(),
    taxBps: integer("tax_bps").notNull().default(0),

    paymentProvider: text("payment_provider").notNull(),
    providerSessionId: text("provider_session_id").unique(),
    providerPaymentId: text("provider_payment_id"),
    // Where the customer pays; kept so a retried request can hand the same link back.
    paymentUrl: text("payment_url"),

    trackingCarrier: text("tracking_carrier").notNull().default(""),
    trackingNumber: text("tracking_number").notNull().default(""),
    // Private notes for the shop team; never shown to the customer.
    notes: text("notes").notNull().default(""),

    // While unpaid, the stock is held until this moment; then the order is cancelled and released.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("orders_email_has_at", sql`position('@' in ${t.email}) > 1`),
    check("orders_email_normalised", sql`${t.email} = lower(btrim(${t.email}))`),
    check("orders_country_format", sql`${t.shipCountry} ~ '^[A-Z]{2}$'`),
    check(
      "orders_amounts_non_negative",
      sql`${t.itemsCents} >= 0 and ${t.shippingCents} >= 0 and ${t.taxCents} >= 0`,
    ),
    check(
      "orders_total_adds_up",
      sql`${t.totalCents} = ${t.itemsCents} + ${t.shippingCents} + ${t.taxCents}`,
    ),
    check("orders_tax_range", sql`${t.taxBps} between 0 and 5000`),
    check(
      "orders_paid_has_paid_at",
      sql`${t.status} in ('pending_payment', 'cancelled') or ${t.paidAt} is not null`,
    ),
    check(
      "orders_shipped_has_shipped_at",
      sql`${t.status} not in ('shipped', 'delivered') or ${t.shippedAt} is not null`,
    ),
    check(
      "orders_delivered_has_delivered_at",
      sql`${t.status} <> 'delivered' or ${t.deliveredAt} is not null`,
    ),
    check(
      "orders_cancelled_has_cancelled_at",
      sql`${t.status} <> 'cancelled' or ${t.cancelledAt} is not null`,
    ),
    check(
      "orders_refunded_has_refunded_at",
      sql`${t.status} <> 'refunded' or ${t.refundedAt} is not null`,
    ),
    // A bag can have at most one unpaid order at a time.
    uniqueIndex("orders_one_pending_per_cart")
      .on(t.cartId)
      .where(sql`${t.status} = 'pending_payment'`),
    index("orders_status_created_idx").on(t.status, t.createdAt),
    index("orders_email_idx").on(t.email),
    index("orders_customer_idx").on(t.customerId, t.createdAt),
    index("orders_pending_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending_payment'`),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    // The variant can be deleted from the catalog later; the line keeps its own copy of the details.
    variantId: uuid("variant_id").references(() => variants.id, { onDelete: "set null" }),
    productTitle: text("product_title").notNull(),
    variantTitle: text("variant_title").notNull(),
    sku: text("sku").notNull(),
    imageUrl: text("image_url").notNull().default(""),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalCents: integer("line_total_cents").notNull(),
    // How many units of this line are currently taken out of the variant's stock. Cancelling or
    // refunding puts exactly this many back, once.
    stockHeld: integer("stock_held").notNull().default(0),
  },
  (t) => [
    check("order_lines_stock_held_range", sql`${t.stockHeld} between 0 and ${t.quantity}`),
    check("order_lines_quantity_range", sql`${t.quantity} between 1 and 99`),
    check("order_lines_price_non_negative", sql`${t.unitPriceCents} >= 0`),
    check(
      "order_lines_total_adds_up",
      sql`${t.lineTotalCents} = ${t.unitPriceCents} * ${t.quantity}`,
    ),
    index("order_lines_order_idx").on(t.orderId),
    index("order_lines_variant_idx").on(t.variantId),
  ],
);

// The history of an order: what happened, when, and who or what did it.
export const orderEvents = pgTable(
  "order_events",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    actor: text("actor").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);

// One row per payment-provider event ever received. The unique key is what makes a replayed
// webhook harmless.
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [unique("webhook_events_provider_event_unique").on(t.provider, t.eventId)],
);
