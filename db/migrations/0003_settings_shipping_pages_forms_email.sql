CREATE TYPE "public"."email_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('new', 'handled');--> statement-breakpoint
CREATE TYPE "public"."subscriber_status" AS ENUM('subscribed', 'unsubscribed');--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"text_body" text NOT NULL,
	"html_body" text NOT NULL,
	"kind" text NOT NULL,
	"status" "email_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_outbox_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "email_outbox_to_has_at" CHECK (position('@' in "email_outbox"."to_email") > 1)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"topic" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"body" text NOT NULL,
	"status" "message_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handled_at" timestamp with time zone,
	CONSTRAINT "messages_topic_allowed" CHECK ("messages"."topic" in ('general', 'order', 'wholesale', 'collaboration', 'press')),
	CONSTRAINT "messages_name_range" CHECK (length(btrim("messages"."name")) between 1 and 100),
	CONSTRAINT "messages_email_has_at" CHECK (position('@' in "messages"."email") > 1),
	CONSTRAINT "messages_body_range" CHECK (length(btrim("messages"."body")) between 1 and 5000)
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"email" text NOT NULL,
	"status" "subscriber_status" DEFAULT 'subscribed' NOT NULL,
	"token" text NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	CONSTRAINT "newsletter_subscribers_email_unique" UNIQUE("email"),
	CONSTRAINT "newsletter_subscribers_token_unique" UNIQUE("token"),
	CONSTRAINT "newsletter_email_normalised" CHECK ("newsletter_subscribers"."email" = lower(btrim("newsletter_subscribers"."email"))),
	CONSTRAINT "newsletter_email_has_at" CHECK (position('@' in "newsletter_subscribers"."email") > 1)
);
--> statement-breakpoint
CREATE TABLE "shipping_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"zone_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer NOT NULL,
	"free_over_cents" integer,
	"estimate" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_rates_name_not_blank" CHECK (length(btrim("shipping_rates"."name")) > 0),
	CONSTRAINT "shipping_rates_price_non_negative" CHECK ("shipping_rates"."price_cents" >= 0),
	CONSTRAINT "shipping_rates_free_over_positive" CHECK ("shipping_rates"."free_over_cents" is null or "shipping_rates"."free_over_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "shipping_zone_countries" (
	"country_code" text PRIMARY KEY NOT NULL,
	"zone_id" uuid NOT NULL,
	CONSTRAINT "shipping_zone_countries_code_format" CHECK ("shipping_zone_countries"."country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "shipping_zones" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"name" text NOT NULL,
	"rest_of_world" boolean DEFAULT false NOT NULL,
	"tax_bps" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_zones_name_unique" UNIQUE("name"),
	CONSTRAINT "shipping_zones_name_not_blank" CHECK (length(btrim("shipping_zones"."name")) > 0),
	CONSTRAINT "shipping_zones_tax_range" CHECK ("shipping_zones"."tax_bps" between 0 and 5000)
);
--> statement-breakpoint
CREATE TABLE "site_pages" (
	"slug" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"reviewed_at" timestamp with time zone,
	"updated_by" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_pages_slug_format" CHECK ("site_pages"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "site_pages_title_not_blank" CHECK (length(btrim("site_pages"."title")) > 0),
	CONSTRAINT "site_pages_body_not_blank" CHECK (length(btrim("site_pages"."body")) > 0)
);
--> statement-breakpoint
CREATE TABLE "store_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"store_name" text DEFAULT 'The Threads of Africa' NOT NULL,
	"contact_email" text DEFAULT 'info@thethreadsofafrica.com' NOT NULL,
	"whatsapp_number" text DEFAULT '' NOT NULL,
	"instagram_url" text DEFAULT '' NOT NULL,
	"tiktok_url" text DEFAULT '' NOT NULL,
	"facebook_url" text DEFAULT '' NOT NULL,
	"pinterest_url" text DEFAULT '' NOT NULL,
	"announcement" text DEFAULT 'Welcome to The Threads of Africa — Every Thread Tells a Story.' NOT NULL,
	"low_stock_threshold" integer DEFAULT 3 NOT NULL,
	"shipping_confirmed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_settings_single_row" CHECK ("store_settings"."id" = 1),
	CONSTRAINT "store_settings_email_has_at" CHECK (position('@' in "store_settings"."contact_email") > 1),
	CONSTRAINT "store_settings_whatsapp_digits" CHECK ("store_settings"."whatsapp_number" ~ '^([0-9]{6,15})?$'),
	CONSTRAINT "store_settings_low_stock_range" CHECK ("store_settings"."low_stock_threshold" between 0 and 1000),
	CONSTRAINT "store_settings_instagram_https" CHECK (("store_settings"."instagram_url" = '' or "store_settings"."instagram_url" ~ '^https://[^ ]+$')),
	CONSTRAINT "store_settings_tiktok_https" CHECK (("store_settings"."tiktok_url" = '' or "store_settings"."tiktok_url" ~ '^https://[^ ]+$')),
	CONSTRAINT "store_settings_facebook_https" CHECK (("store_settings"."facebook_url" = '' or "store_settings"."facebook_url" ~ '^https://[^ ]+$')),
	CONSTRAINT "store_settings_pinterest_https" CHECK (("store_settings"."pinterest_url" = '' or "store_settings"."pinterest_url" ~ '^https://[^ ]+$'))
);
--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_zone_id_shipping_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."shipping_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_zone_countries" ADD CONSTRAINT "shipping_zone_countries_zone_id_shipping_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."shipping_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_due_idx" ON "email_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "messages_status_created_idx" ON "messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "shipping_rates_zone_idx" ON "shipping_rates" USING btree ("zone_id","sort_order");--> statement-breakpoint
CREATE INDEX "shipping_zone_countries_zone_idx" ON "shipping_zone_countries" USING btree ("zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipping_zones_one_rest_of_world" ON "shipping_zones" USING btree ("rest_of_world") WHERE "shipping_zones"."rest_of_world";--> statement-breakpoint
-- Starting data. The settings row must exist (the app only ever updates it).
INSERT INTO "store_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint
-- PLACEHOLDER shipping: one worldwide flat rate so checkout works before real rates are entered.
-- The admin keeps warning that shipping is unconfirmed until an owner reviews and confirms it.
WITH zone AS (
  INSERT INTO "shipping_zones" ("name", "rest_of_world", "tax_bps", "sort_order")
  VALUES ('Everywhere else', true, 0, 1000)
  ON CONFLICT ("name") DO NOTHING
  RETURNING "id"
)
INSERT INTO "shipping_rates" ("zone_id", "name", "price_cents", "estimate", "sort_order")
SELECT "id", 'Standard international shipping', 1500, '7–14 business days', 0 FROM zone;
