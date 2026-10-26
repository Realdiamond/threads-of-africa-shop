CREATE TYPE "public"."order_status" AS ENUM('pending_payment', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid,
	"product_title" text NOT NULL,
	"variant_title" text NOT NULL,
	"sku" text NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_cents" integer NOT NULL,
	"stock_held" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "order_lines_stock_held_range" CHECK ("order_lines"."stock_held" between 0 and "order_lines"."quantity"),
	CONSTRAINT "order_lines_quantity_range" CHECK ("order_lines"."quantity" between 1 and 99),
	CONSTRAINT "order_lines_price_non_negative" CHECK ("order_lines"."unit_price_cents" >= 0),
	CONSTRAINT "order_lines_total_adds_up" CHECK ("order_lines"."line_total_cents" = "order_lines"."unit_price_cents" * "order_lines"."quantity")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "orders_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1001 CACHE 1),
	"status" "order_status" DEFAULT 'pending_payment' NOT NULL,
	"email" text NOT NULL,
	"cart_id" uuid,
	"idempotency_key" text,
	"idempotency_hash" text,
	"access_token" text NOT NULL,
	"ship_name" text NOT NULL,
	"ship_line1" text NOT NULL,
	"ship_line2" text DEFAULT '' NOT NULL,
	"ship_city" text NOT NULL,
	"ship_region" text DEFAULT '' NOT NULL,
	"ship_postal_code" text DEFAULT '' NOT NULL,
	"ship_country" text NOT NULL,
	"ship_phone" text DEFAULT '' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"items_cents" integer NOT NULL,
	"shipping_cents" integer NOT NULL,
	"tax_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"shipping_method" text NOT NULL,
	"shipping_zone" text NOT NULL,
	"tax_bps" integer DEFAULT 0 NOT NULL,
	"payment_provider" text NOT NULL,
	"provider_session_id" text,
	"provider_payment_id" text,
	"payment_url" text,
	"tracking_carrier" text DEFAULT '' NOT NULL,
	"tracking_number" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_number_unique" UNIQUE("number"),
	CONSTRAINT "orders_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "orders_access_token_unique" UNIQUE("access_token"),
	CONSTRAINT "orders_provider_session_id_unique" UNIQUE("provider_session_id"),
	CONSTRAINT "orders_email_has_at" CHECK (position('@' in "orders"."email") > 1),
	CONSTRAINT "orders_email_normalised" CHECK ("orders"."email" = lower(btrim("orders"."email"))),
	CONSTRAINT "orders_country_format" CHECK ("orders"."ship_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "orders_amounts_non_negative" CHECK ("orders"."items_cents" >= 0 and "orders"."shipping_cents" >= 0 and "orders"."tax_cents" >= 0),
	CONSTRAINT "orders_total_adds_up" CHECK ("orders"."total_cents" = "orders"."items_cents" + "orders"."shipping_cents" + "orders"."tax_cents"),
	CONSTRAINT "orders_tax_range" CHECK ("orders"."tax_bps" between 0 and 5000),
	CONSTRAINT "orders_paid_has_paid_at" CHECK ("orders"."status" in ('pending_payment', 'cancelled') or "orders"."paid_at" is not null),
	CONSTRAINT "orders_shipped_has_shipped_at" CHECK ("orders"."status" not in ('shipped', 'delivered') or "orders"."shipped_at" is not null),
	CONSTRAINT "orders_delivered_has_delivered_at" CHECK ("orders"."status" <> 'delivered' or "orders"."delivered_at" is not null),
	CONSTRAINT "orders_cancelled_has_cancelled_at" CHECK ("orders"."status" <> 'cancelled' or "orders"."cancelled_at" is not null),
	CONSTRAINT "orders_refunded_has_refunded_at" CHECK ("orders"."status" <> 'refunded' or "orders"."refunded_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_events_provider_event_unique" UNIQUE("provider","event_id")
);
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_variant_idx" ON "order_lines" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_pending_per_cart" ON "orders" USING btree ("cart_id") WHERE "orders"."status" = 'pending_payment';--> statement-breakpoint
CREATE INDEX "orders_status_created_idx" ON "orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "orders_email_idx" ON "orders" USING btree ("email");--> statement-breakpoint
CREATE INDEX "orders_pending_expiry_idx" ON "orders" USING btree ("expires_at") WHERE "orders"."status" = 'pending_payment';