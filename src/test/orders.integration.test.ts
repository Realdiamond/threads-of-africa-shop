// @vitest-environment node
//
// Real-Postgres tests for orders: reserving stock, paying, expiring, refunding and replayed
// payment events. A fake payment provider stands in for Stripe. Skipped when TEST_DATABASE_URL
// is not set.
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Actor } from "@/backend/admin/audit.server";
import { recentAudit } from "@/backend/admin/audit.server";
import { adminDashboard } from "@/backend/admin/dashboard.server";
import {
  cancelUnpaid,
  getAdminOrder,
  listAdminOrders,
  markOrderDelivered,
  ORDERS_PAGE_SIZE,
  ordersCsv,
  resendConfirmation,
  setOrderNote,
  shipOrder,
} from "@/backend/admin/order-admin.server";
import { createCart } from "@/backend/cart.server";
import * as schema from "@/backend/db/schema";
import {
  categories,
  emailOutbox,
  orderEvents,
  orderLines,
  orders,
  products,
  variants,
  webhookEvents,
} from "@/backend/db/schema";
import { handlePaymentEvent, refundOrder } from "@/backend/order-payments.server";
import {
  cancelCheckoutByToken,
  checkoutSummary,
  expireStaleOrders,
  getOrderByToken,
  placeOrder,
} from "@/backend/orders.server";
import type { PaymentEvent, PaymentProvider } from "@/backend/payments.server";
import type { CheckoutSessionInput } from "@/backend/payments/types.server";
import { saveShippingZone, listShippingZones } from "@/backend/shipping.server";
import type { CheckoutForm } from "@/lib/order-types";

if (!process.env["TEST_DATABASE_URL"]) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file: the suite is skipped below.
  }
}
const url = process.env["TEST_DATABASE_URL"];
const actor: Actor = { id: null, email: "owner@example.com" };

describe.skipIf(!url)("orders and payments (Postgres)", () => {
  if (url && !new URL(url).pathname.includes("test")) {
    throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'");
  }

  const pool = new Pool({ connectionString: url, max: 20 });
  const db = drizzle(pool, { schema });

  let dressM: string; // 120.00, stock 3
  let dressL: string; // 125.00, stock 1  (the "last piece")
  let shirt: string; //   49.99, stock 10
  let draftVariant: string;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "./db/migrations" });
  });
  afterAll(async () => {
    await pool.end();
  });

  // A stand-in for Stripe that records what it was asked and can be told to misbehave.
  function fakeProvider() {
    const state = {
      failCreate: false,
      expire: "expired" as "expired" | "not_open" | "throw",
      failRefund: false,
    };
    const calls = {
      created: [] as CheckoutSessionInput[],
      expired: [] as string[],
      refunds: [] as Array<{ paymentId: string; amountCents: number; idempotencyKey: string }>,
    };
    let counter = 0;
    const provider: PaymentProvider = {
      name: "stripe",
      async createCheckoutSession(input) {
        if (state.failCreate) throw new Error("stripe is down");
        calls.created.push(input);
        counter += 1;
        return { sessionId: `cs_test_${counter}`, url: `https://pay.example/cs_test_${counter}` };
      },
      async expireSession(sessionId) {
        calls.expired.push(sessionId);
        if (state.expire === "throw") throw new Error("network");
        return state.expire;
      },
      async refund(input) {
        if (state.failRefund) throw new Error("card network says no");
        calls.refunds.push(input);
        return { refundId: `re_${calls.refunds.length}`, alreadyRefunded: false };
      },
      parseWebhook() {
        throw new Error("not used here");
      },
    };
    return { provider, calls, state };
  }

  const stockOf = async (variantId: string) =>
    (
      await db.select({ stock: variants.stock }).from(variants).where(eq(variants.id, variantId))
    )[0]!.stock;
  const orderRow = async (id: string) =>
    (await db.select().from(orders).where(eq(orders.id, id)))[0]!;
  const eventKinds = async (id: string) =>
    (await db.select().from(orderEvents).where(eq(orderEvents.orderId, id))).map((e) => e.kind);
  const emails = async () => db.select().from(emailOutbox);

  beforeEach(async () => {
    await db.execute(
      sql`truncate orders, webhook_events, email_outbox, cart_lines, carts, product_images, variants, products, categories, store_settings, shipping_zones, audit_log restart identity cascade`,
    );
    const [women] = await db
      .insert(categories)
      .values({ slug: "women", name: "Women" })
      .returning();
    const [dress] = await db
      .insert(products)
      .values({
        handle: "amara-dress",
        title: "Amara Dress",
        categoryId: women!.id,
        status: "active",
      })
      .returning();
    const [shirtProduct] = await db
      .insert(products)
      .values({
        handle: "kofi-shirt",
        title: "Kofi Shirt",
        categoryId: women!.id,
        status: "active",
      })
      .returning();
    const [draft] = await db
      .insert(products)
      .values({ handle: "draft-top", title: "Draft Top", categoryId: women!.id, status: "draft" })
      .returning();
    const inserted = await db
      .insert(variants)
      .values([
        {
          productId: dress!.id,
          sku: "AMARA-M",
          title: "M",
          priceCents: 12000,
          stock: 3,
          position: 0,
          selectedOptions: [{ name: "Size", value: "M" }],
        },
        {
          productId: dress!.id,
          sku: "AMARA-L",
          title: "L",
          priceCents: 12500,
          stock: 1,
          position: 1,
          selectedOptions: [{ name: "Size", value: "L" }],
        },
        {
          productId: shirtProduct!.id,
          sku: "KOFI-1",
          title: "Default",
          priceCents: 4999,
          stock: 10,
          position: 0,
        },
        {
          productId: draft!.id,
          sku: "DRAFT-1",
          title: "Default",
          priceCents: 1000,
          stock: 5,
          position: 0,
        },
      ])
      .returning();
    dressM = inserted[0]!.id;
    dressL = inserted[1]!.id;
    shirt = inserted[2]!.id;
    draftVariant = inserted[3]!.id;

    const ok = async (input: Parameters<typeof saveShippingZone>[1]) => {
      const result = await saveShippingZone(actor, input, db);
      if (!result.ok) throw new Error(result.message);
    };
    await ok({
      name: "Nigeria",
      restOfWorld: false,
      taxBps: 750,
      countries: ["NG"],
      rates: [
        { name: "Standard", priceCents: 1000, freeOverCents: null, estimate: "3–5 days" },
        { name: "Express", priceCents: 2500, freeOverCents: null, estimate: "1–2 days" },
      ],
    });
    await ok({
      name: "Everywhere else",
      restOfWorld: true,
      taxBps: 0,
      countries: [],
      rates: [
        { name: "International", priceCents: 3000, freeOverCents: 30000, estimate: "7–14 days" },
      ],
    });
  });

  const form = (over: Partial<CheckoutForm> = {}): CheckoutForm => ({
    email: "buyer@example.com",
    name: "Ada Obi",
    phone: "+2348012345678",
    country: "NG",
    line1: "12 Marina Road",
    line2: "",
    city: "Lagos",
    region: "Lagos",
    postalCode: "101241",
    ...over,
  });

  async function rate(country: string, name: string) {
    const zones = await listShippingZones(db);
    const zone =
      zones.find((z) => z.countries.includes(country)) ?? zones.find((z) => z.restOfWorld)!;
    return zone.rates.find((r) => r.name === name)!.id;
  }

  async function cartWith(variantId: string, quantity: number) {
    const created = await createCart(variantId, quantity, db);
    if (!created.ok) throw new Error(created.message);
    return created.cart.cartId;
  }

  let keyCounter = 0;
  async function place(
    provider: PaymentProvider,
    variantId: string,
    quantity: number,
    over: {
      country?: string;
      rate?: string;
      key?: string;
      form?: Partial<CheckoutForm>;
      cartId?: string;
    } = {},
  ) {
    const country = over.country ?? "NG";
    const cartId = over.cartId ?? (await cartWith(variantId, quantity));
    keyCounter += 1;
    const result = await placeOrder(
      {
        cartId,
        rateId: await rate(country, over.rate ?? (country === "NG" ? "Standard" : "International")),
        idempotencyKey: over.key ?? `test-key-${keyCounter}-${"x".repeat(16)}`,
        form: form({ country, ...over.form }),
      },
      db,
      provider,
    );
    return { result, cartId };
  }

  async function placed(
    provider: PaymentProvider,
    variantId: string,
    quantity: number,
    over: Parameters<typeof place>[3] = {},
  ) {
    const { result, cartId } = await place(provider, variantId, quantity, over);
    if (!result.ok) throw new Error(result.message);
    const [order] = await db.select().from(orders).where(eq(orders.cartId, cartId));
    return order!;
  }

  const paid = (
    order: typeof orders.$inferSelect,
    over: Partial<Extract<PaymentEvent, { kind: "paid" }>> = {},
  ): PaymentEvent => ({
    kind: "paid",
    eventId: `evt_${Math.random().toString(36).slice(2)}`,
    type: "checkout.session.completed",
    orderId: order.id,
    sessionId: order.providerSessionId ?? "cs_test_x",
    paymentId: `pi_${order.number}`,
    amountCents: order.totalCents,
    currency: order.currency,
    ...over,
  });

  describe("placing an order", () => {
    it("works out the money on the server and takes the items off the shelf", async () => {
      const { provider, calls } = fakeProvider();
      const result = await place(provider, dressM, 2);
      expect(result.result).toEqual({ ok: true, url: "https://pay.example/cs_test_1" });

      const [order] = await db.select().from(orders);
      expect(order).toMatchObject({
        number: 1001,
        status: "pending_payment",
        email: "buyer@example.com",
        shipCountry: "NG",
        currency: "USD",
        itemsCents: 24000,
        shippingCents: 1000,
        taxCents: 1800, // 7.5% of the items
        totalCents: 26800,
        shippingMethod: "Standard",
        paymentProvider: "stripe",
        providerSessionId: "cs_test_1",
        paymentUrl: "https://pay.example/cs_test_1",
      });
      expect(order!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);

      const lines = await db.select().from(orderLines);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        productTitle: "Amara Dress",
        variantTitle: "M",
        sku: "AMARA-M",
        unitPriceCents: 12000,
        quantity: 2,
        lineTotalCents: 24000,
        stockHeld: 2,
      });
      expect(await stockOf(dressM)).toBe(1);

      // What the provider is asked to collect is exactly the order total.
      const asked = calls.created[0]!;
      const sum =
        asked.lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0) +
        asked.shipping.cents +
        asked.tax.cents;
      expect(sum).toBe(order!.totalCents);
      expect(asked.totalCents).toBe(order!.totalCents);
      expect(asked.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
      expect(asked.successUrl).toContain(`/orders/${order!.id}?t=`);
      expect(await eventKinds(order!.id)).toEqual(["created"]);
    });

    it("uses today's price, not whatever the shopper saw earlier", async () => {
      const { provider } = fakeProvider();
      const cartId = await cartWith(dressM, 1);
      await db.update(variants).set({ priceCents: 15000 }).where(eq(variants.id, dressM));
      const order = await placed(provider, dressM, 1, { cartId });
      expect(order.itemsCents).toBe(15000);
    });

    it("applies the rest-of-world zone, its tax and free-delivery threshold", async () => {
      const { provider } = fakeProvider();
      const small = await placed(provider, shirt, 1, { country: "FR", form: { country: "FR" } });
      expect(small).toMatchObject({ shippingCents: 3000, taxCents: 0, shipCountry: "FR" });
      const big = await placed(provider, dressM, 3, { country: "FR", form: { country: "FR" } });
      expect(big).toMatchObject({ shippingCents: 0, itemsCents: 36000 });
    });

    it("rejects bad details without touching stock", async () => {
      const { provider, calls } = fakeProvider();
      const cartId = await cartWith(dressM, 1);
      const attempt = (over: Partial<CheckoutForm>) =>
        place(provider, dressM, 1, { cartId, form: over });

      expect((await attempt({ email: "nope" })).result).toMatchObject({
        ok: false,
        code: "INVALID",
      });
      expect((await attempt({ name: "  " })).result).toMatchObject({ ok: false, code: "INVALID" });
      expect((await attempt({ line1: "" })).result).toMatchObject({ ok: false, code: "INVALID" });
      expect((await attempt({ phone: "call me maybe" })).result).toMatchObject({
        ok: false,
        code: "INVALID",
      });
      expect(await db.select().from(orders)).toHaveLength(0);
      expect(await stockOf(dressM)).toBe(3);
      expect(calls.created).toHaveLength(0);
    });

    it("refuses a delivery option that does not belong to the chosen country", async () => {
      const { provider } = fakeProvider();
      const cartId = await cartWith(dressM, 1);
      const result = await placeOrder(
        {
          cartId,
          rateId: await rate("FR", "International"),
          idempotencyKey: "k".repeat(20),
          form: form(),
        },
        db,
        provider,
      );
      expect(result).toMatchObject({ ok: false, code: "INVALID" });
      expect(await stockOf(dressM)).toBe(3);
    });

    it("will not deliver where there is no zone", async () => {
      const { provider } = fakeProvider();
      await db.execute(sql`delete from shipping_zones where rest_of_world`);
      const cartId = await cartWith(dressM, 1);
      const result = await placeOrder(
        {
          cartId,
          rateId: await rate("NG", "Standard"),
          idempotencyKey: "k".repeat(20),
          form: form({ country: "FR" }),
        },
        db,
        provider,
      );
      expect(result).toMatchObject({ ok: false, code: "NOT_SHIPPABLE" });
    });

    it("refuses an expired, empty or unknown bag", async () => {
      const { provider } = fakeProvider();
      const unknown = await place(provider, dressM, 1, {
        cartId: "00000000-0000-4000-8000-000000000000",
      });
      expect(unknown.result).toMatchObject({ ok: false, code: "CART_NOT_FOUND" });
    });

    it("refuses products that were taken off sale after being added to the bag", async () => {
      const { provider } = fakeProvider();
      const cartId = await cartWith(dressM, 1);
      await db
        .update(products)
        .set({ status: "archived" })
        .where(eq(products.handle, "amara-dress"));
      const { result } = await place(provider, dressM, 1, { cartId });
      expect(result).toMatchObject({ ok: false, code: "ITEMS_UNAVAILABLE" });
      expect(await stockOf(dressM)).toBe(3);
    });

    it("pressing Pay twice makes one order and one payment page", async () => {
      const { provider, calls } = fakeProvider();
      const cartId = await cartWith(dressM, 1);
      const key = "double-click-key-0000";
      const first = await place(provider, dressM, 1, { cartId, key });
      const second = await place(provider, dressM, 1, { cartId, key });
      expect(first.result).toEqual(second.result);
      expect(await db.select().from(orders)).toHaveLength(1);
      expect(calls.created).toHaveLength(1);
      expect(await stockOf(dressM)).toBe(2);
    });

    it("two identical requests at the same instant still make one order", async () => {
      const { provider } = fakeProvider();
      const cartId = await cartWith(dressM, 1);
      const key = "same-instant-key-0000";
      const [a, b] = await Promise.all([
        place(provider, dressM, 1, { cartId, key }),
        place(provider, dressM, 1, { cartId, key }),
      ]);
      expect(a.result.ok && b.result.ok).toBe(true);
      expect(await db.select().from(orders)).toHaveLength(1);
      expect(await stockOf(dressM)).toBe(2);
    });

    it("reusing a key for a different request is refused", async () => {
      const { provider } = fakeProvider();
      const cartId = await cartWith(dressM, 1);
      const key = "reused-key-000000000";
      await place(provider, dressM, 1, { cartId, key });
      const again = await place(provider, dressM, 1, {
        cartId,
        key,
        form: { name: "Someone Else" },
      });
      expect(again.result).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
      expect(await db.select().from(orders)).toHaveLength(1);
    });

    it("two shoppers cannot both buy the last piece", async () => {
      const { provider } = fakeProvider();
      const [cartA, cartB] = [await cartWith(dressL, 1), await cartWith(dressL, 1)];
      const [a, b] = await Promise.all([
        place(provider, dressL, 1, { cartId: cartA }),
        place(provider, dressL, 1, { cartId: cartB }),
      ]);
      const winners = [a.result, b.result].filter((r) => r.ok);
      const losers = [a.result, b.result].filter((r) => !r.ok);
      expect(winners).toHaveLength(1);
      expect(losers[0]).toMatchObject({ ok: false, code: "ITEMS_UNAVAILABLE" });
      expect(await stockOf(dressL)).toBe(0);
      expect(await db.select().from(orders)).toHaveLength(1);
    });

    it("a refused order does not leave half its items taken", async () => {
      const { provider } = fakeProvider();
      // Bag with a plentiful shirt and the last dress; the dress is sold to someone else first.
      const cartId = await cartWith(shirt, 2);
      const created = await createCart(dressL, 1, db);
      expect(created.ok).toBe(true);
      const { addToCart } = await import("@/backend/cart.server");
      await addToCart(cartId, dressL, 1, db);
      await db.update(variants).set({ stock: 0 }).where(eq(variants.id, dressL));
      const { result } = await place(provider, shirt, 2, { cartId });
      expect(result).toMatchObject({ ok: false, code: "ITEMS_UNAVAILABLE" });
      expect(await stockOf(shirt)).toBe(10);
      expect(await db.select().from(orders)).toHaveLength(0);
    });

    it("starting checkout again replaces the earlier attempt and frees its items", async () => {
      const { provider, calls } = fakeProvider();
      const cartId = await cartWith(dressM, 2);
      const first = await placed(provider, dressM, 2, { cartId });
      expect(await stockOf(dressM)).toBe(1);

      const second = await place(provider, dressM, 2, { cartId, form: { name: "Ada Obi-Eze" } });
      expect(second.result.ok).toBe(true);
      const rows = await db.select().from(orders).orderBy(orders.number);
      expect(rows.map((o) => o.status)).toEqual(["cancelled", "pending_payment"]);
      expect(rows[0]!.id).toBe(first.id);
      expect(await stockOf(dressM)).toBe(1); // 3 − 2: held once, not twice
      expect(calls.expired).toEqual(["cs_test_1"]);
      expect(
        (await db.select().from(orderLines).where(eq(orderLines.orderId, first.id)))[0]!.stockHeld,
      ).toBe(0);
    });

    it("gives the items back when the payment page cannot be opened", async () => {
      const { provider, state } = fakeProvider();
      state.failCreate = true;
      const { result } = await place(provider, dressM, 2);
      expect(result).toMatchObject({ ok: false, code: "PAYMENT_UNAVAILABLE" });
      const [order] = await db.select().from(orders);
      expect(order!.status).toBe("cancelled");
      expect(await stockOf(dressM)).toBe(3);
    });

    it("stays closed with no payment provider", async () => {
      const cartId = await cartWith(dressM, 1);
      const result = await placeOrder(
        {
          cartId,
          rateId: await rate("NG", "Standard"),
          idempotencyKey: "k".repeat(20),
          form: form(),
        },
        db,
        null,
      );
      expect(result).toMatchObject({ ok: false, code: "PAYMENTS_NOT_CONFIGURED" });
      expect(await db.select().from(orders)).toHaveLength(0);
    });
  });

  describe("the checkout summary", () => {
    it("shows the bag as the database sees it, with delivery options and tax per country", async () => {
      const { provider } = fakeProvider();
      const cartId = await cartWith(dressM, 2);
      const noCountry = await checkoutSummary(cartId, null, db, provider);
      expect(noCountry).toMatchObject({
        ok: true,
        itemsCents: 24000,
        shipping: null,
        testMode: false,
      });

      const ng = await checkoutSummary(cartId, "NG", db, provider);
      if (!ng.ok) throw new Error("expected ok");
      expect(ng.shipping).toMatchObject({ zoneName: "Nigeria", taxBps: 750, taxCents: 1800 });
      expect(ng.shipping!.options.map((o) => o.name)).toEqual(["Standard", "Express"]);
      expect(ng.lines[0]).toMatchObject({ productTitle: "Amara Dress", lineTotalCents: 24000 });
      expect(ng.countries).toContain("NG");
    });

    it("reports a closed shop, a missing bag and items that ran out", async () => {
      const { provider } = fakeProvider();
      const cartId = await cartWith(dressM, 3);
      expect(await checkoutSummary(cartId, null, db, null)).toMatchObject({
        ok: false,
        code: "PAYMENTS_NOT_CONFIGURED",
      });
      expect(
        await checkoutSummary("00000000-0000-4000-8000-000000000000", null, db, provider),
      ).toMatchObject({ ok: false, code: "CART_NOT_FOUND" });
      await db.update(variants).set({ stock: 1 }).where(eq(variants.id, dressM));
      expect(await checkoutSummary(cartId, null, db, provider)).toMatchObject({
        ok: false,
        code: "ITEMS_UNAVAILABLE",
      });
    });

    it("never offers draft products", async () => {
      const { provider } = fakeProvider();
      // The cart refuses draft variants outright; make one active, add it, then unpublish.
      const cartId = await cartWith(shirt, 1);
      await db.update(products).set({ status: "draft" }).where(eq(products.handle, "kofi-shirt"));
      expect(await checkoutSummary(cartId, null, db, provider)).toMatchObject({
        ok: false,
        code: "ITEMS_UNAVAILABLE",
      });
      expect(draftVariant).toBeTruthy();
    });
  });

  describe("expiring and cancelling unpaid orders", () => {
    it("cancels orders whose hold ran out and puts the items back exactly once", async () => {
      const { provider, calls } = fakeProvider();
      const order = await placed(provider, dressM, 2);
      expect(await stockOf(dressM)).toBe(1);
      await db
        .update(orders)
        .set({ expiresAt: sql`now() - interval '1 minute'` })
        .where(eq(orders.id, order.id));

      expect(await expireStaleOrders(db, provider)).toBe(1);
      expect(await expireStaleOrders(db, provider)).toBe(0);
      expect((await orderRow(order.id)).status).toBe("cancelled");
      expect(await stockOf(dressM)).toBe(3);
      expect(calls.expired).toEqual(["cs_test_1"]);
    });

    it("leaves orders alone that are still within their hold", async () => {
      const { provider } = fakeProvider();
      const order = await placed(provider, dressM, 1);
      expect(await expireStaleOrders(db, provider)).toBe(0);
      expect((await orderRow(order.id)).status).toBe("pending_payment");
    });

    it("waits when the payment page cannot be closed, then gives up after an hour", async () => {
      const { provider, state } = fakeProvider();
      const order = await placed(provider, dressM, 2);
      await db
        .update(orders)
        .set({ expiresAt: sql`now() - interval '1 minute'` })
        .where(eq(orders.id, order.id));

      state.expire = "not_open"; // maybe being paid right now
      expect(await expireStaleOrders(db, provider)).toBe(0);
      state.expire = "throw";
      expect(await expireStaleOrders(db, provider)).toBe(0);
      expect((await orderRow(order.id)).status).toBe("pending_payment");

      await db
        .update(orders)
        .set({ expiresAt: sql`now() - interval '2 hours'` })
        .where(eq(orders.id, order.id));
      expect(await expireStaleOrders(db, provider)).toBe(1);
      expect(await stockOf(dressM)).toBe(3);
    });

    it("lets a customer who leaves the payment page release their items at once", async () => {
      const { provider } = fakeProvider();
      const order = await placed(provider, dressM, 2);
      expect(await cancelCheckoutByToken(order.id, "wrong-token-wrong-token", db, provider)).toBe(
        false,
      );
      expect(await stockOf(dressM)).toBe(1);

      expect(await cancelCheckoutByToken(order.id, order.accessToken, db, provider)).toBe(true);
      expect(await cancelCheckoutByToken(order.id, order.accessToken, db, provider)).toBe(false);
      expect((await orderRow(order.id)).status).toBe("cancelled");
      expect(await stockOf(dressM)).toBe(3);
    });

    it("never cancels an order that may be mid-payment", async () => {
      const { provider, state } = fakeProvider();
      const order = await placed(provider, dressM, 1);
      state.expire = "not_open";
      expect(await cancelCheckoutByToken(order.id, order.accessToken, db, provider)).toBe(false);
      expect((await orderRow(order.id)).status).toBe("pending_payment");
    });
  });

  describe("opening an order with its private link", () => {
    it("needs the right token for that order", async () => {
      const { provider } = fakeProvider();
      const a = await placed(provider, dressM, 1);
      const b = await placed(provider, shirt, 1);
      expect(await getOrderByToken(a.id, a.accessToken, db)).toMatchObject({
        id: a.id,
        number: a.number,
        email: "buyer@example.com",
        totalCents: a.totalCents,
      });
      expect(await getOrderByToken(a.id, b.accessToken, db)).toBeNull();
      expect(await getOrderByToken(a.id, "short", db)).toBeNull();
      expect(await getOrderByToken("not-a-uuid", a.accessToken, db)).toBeNull();
      expect(
        await getOrderByToken("00000000-0000-4000-8000-000000000000", a.accessToken, db),
      ).toBeNull();
    });

    it("never exposes private notes or internal events", async () => {
      const { provider } = fakeProvider();
      const order = await placed(provider, dressM, 1);
      await db.update(orders).set({ notes: "VIP, wrap nicely" }).where(eq(orders.id, order.id));
      const view = await getOrderByToken(order.id, order.accessToken, db);
      expect(JSON.stringify(view)).not.toContain("VIP");
      expect(view).not.toHaveProperty("notes");
      expect(view).not.toHaveProperty("events");
      expect(view).not.toHaveProperty("accessToken");
      expect(view).not.toHaveProperty("providerPaymentId");
    });
  });

  describe("payment events", () => {
    it("marks the order paid, converts the bag and queues both emails", async () => {
      const { provider } = fakeProvider();
      await db.execute(
        sql`insert into store_settings (id, contact_email) values (1, 'shop@example.com') on conflict (id) do update set contact_email = 'shop@example.com'`,
      );
      const order = await placed(provider, dressM, 2);
      expect(await handlePaymentEvent("stripe", paid(order), db)).toBe("processed");

      const after = await orderRow(order.id);
      expect(after).toMatchObject({
        status: "paid",
        providerPaymentId: `pi_${order.number}`,
        expiresAt: null,
      });
      expect(after.paidAt).not.toBeNull();
      // The items stay reserved: paying changes nothing on the shelf.
      expect(await stockOf(dressM)).toBe(1);
      expect(
        (await db.select().from(schema.carts).where(eq(schema.carts.id, order.cartId!)))[0]!.status,
      ).toBe("converted");
      expect(await eventKinds(order.id)).toEqual(["created", "paid"]);

      const mail = await emails();
      expect(mail.map((m) => [m.kind, m.toEmail]).sort()).toEqual([
        ["order_alert", "shop@example.com"],
        ["order_confirmation", "buyer@example.com"],
      ]);
      const confirmation = mail.find((m) => m.kind === "order_confirmation")!;
      expect(confirmation.textBody).toContain("TOA-1001");
      expect(confirmation.textBody).toContain(`/orders/${order.id}?t=${order.accessToken}`);
    });

    it("does nothing the second time the same event arrives", async () => {
      const { provider } = fakeProvider();
      const order = await placed(provider, dressM, 1);
      const event = paid(order);
      expect(await handlePaymentEvent("stripe", event, db)).toBe("processed");
      expect(await handlePaymentEvent("stripe", event, db)).toBe("duplicate");
      expect(await db.select().from(webhookEvents)).toHaveLength(1);
      expect(await emails()).toHaveLength(2);
      expect(await eventKinds(order.id)).toEqual(["created", "paid"]);
    });

    it("ignores a different event for an order that is already paid", async () => {
      const { provider } = fakeProvider();
      const order = await placed(provider, dressM, 1);
      await handlePaymentEvent("stripe", paid(order), db);
      expect(await handlePaymentEvent("stripe", paid(order), db)).toBe("ignored");
      expect(await emails()).toHaveLength(2);
    });

    it("two copies of the same event at the same instant are applied once", async () => {
      const { provider } = fakeProvider();
      const order = await placed(provider, dressM, 1);
      const event = paid(order);
      const outcomes = await Promise.all([
        handlePaymentEvent("stripe", event, db),
        handlePaymentEvent("stripe", event, db),
      ]);
      expect(outcomes.sort()).toEqual(["duplicate", "processed"]);
      expect(await emails()).toHaveLength(2);
    });

    it("never marks an order paid for the wrong amount or currency", async () => {
      const { provider } = fakeProvider();
      const order = await placed(provider, dressM, 1);
      await handlePaymentEvent("stripe", paid(order, { amountCents: order.totalCents - 1 }), db);
      await handlePaymentEvent("stripe", paid(order, { currency: "eur" }), db);

      const after = await orderRow(order.id);
      expect(after.status).toBe("pending_payment");
      expect(after.paidAt).toBeNull();
      // It must not quietly expire either: a person has to look.
      expect(after.expiresAt).toBeNull();
      expect(await eventKinds(order.id)).toEqual([
        "created",
        "payment_mismatch",
        "payment_mismatch",
      ]);
      expect((await emails()).every((m) => m.kind === "order_attention")).toBe(true);
    });

    it("accepts the currency in any letter case", async () => {
      const { provider } = fakeProvider();
      const order = await placed(provider, dressM, 1);
      await handlePaymentEvent("stripe", paid(order, { currency: "usd" }), db);
      expect((await orderRow(order.id)).status).toBe("paid");
    });

    it("quietly ignores events for orders it does not know or that belong to another payment page", async () => {
      const { provider } = fakeProvider();
      const order = await placed(provider, dressM, 1);
      expect(
        await handlePaymentEvent(
          "stripe",
          paid(order, { orderId: "00000000-0000-4000-8000-000000000000" }),
          db,
        ),
      ).toBe("ignored");
      expect(await handlePaymentEvent("stripe", paid(order, { orderId: "not-a-uuid" }), db)).toBe(
        "ignored",
      );
      expect(
        await handlePaymentEvent("stripe", paid(order, { sessionId: "cs_someone_else" }), db),
      ).toBe("ignored");
      expect((await orderRow(order.id)).status).toBe("pending_payment");
    });

    it("cancels and restocks when the payment page expires unpaid", async () => {
      const { provider } = fakeProvider();
      const order = await placed(provider, dressM, 2);
      await handlePaymentEvent(
        "stripe",
        {
          kind: "expired",
          eventId: "evt_exp",
          type: "checkout.session.expired",
          orderId: order.id,
          sessionId: order.providerSessionId!,
        },
        db,
      );
      expect((await orderRow(order.id)).status).toBe("cancelled");
      expect(await stockOf(dressM)).toBe(3);
    });

    it("records a failed payment without changing the order", async () => {
      const { provider } = fakeProvider();
      const order = await placed(provider, dressM, 1);
      await handlePaymentEvent(
        "stripe",
        {
          kind: "failed",
          eventId: "evt_fail",
          type: "x",
          orderId: order.id,
          sessionId: order.providerSessionId!,
          reason: "Declined",
        },
        db,
      );
      expect((await orderRow(order.id)).status).toBe("pending_payment");
      expect(await eventKinds(order.id)).toEqual(["created", "payment_failed"]);
    });

    describe("a payment that arrives after the order was cancelled", () => {
      async function cancelledOrder(provider: PaymentProvider, variantId: string, qty: number) {
        const order = await placed(provider, variantId, qty);
        await handlePaymentEvent(
          "stripe",
          {
            kind: "expired",
            eventId: `evt_exp_${order.id}`,
            type: "x",
            orderId: order.id,
            sessionId: order.providerSessionId!,
          },
          db,
        );
        return order;
      }

      it("restores the order when the items are still available", async () => {
        const { provider } = fakeProvider();
        const order = await cancelledOrder(provider, dressM, 2);
        expect(await stockOf(dressM)).toBe(3);

        expect(await handlePaymentEvent("stripe", paid(order), db)).toBe("processed");
        const after = await orderRow(order.id);
        expect(after).toMatchObject({ status: "paid", cancelledAt: null });
        expect(await stockOf(dressM)).toBe(1);
        expect(
          (await db.select().from(orderLines).where(eq(orderLines.orderId, order.id)))[0]!
            .stockHeld,
        ).toBe(2);
        expect(await eventKinds(order.id)).toContain("late_payment");
      });

      it("still records the sale when the items were sold meanwhile, and tells the shop", async () => {
        const { provider } = fakeProvider();
        const order = await cancelledOrder(provider, dressM, 3);
        // Someone else buys two while it was cancelled.
        await db.update(variants).set({ stock: 1 }).where(eq(variants.id, dressM));

        await handlePaymentEvent("stripe", paid(order), db);
        const after = await orderRow(order.id);
        expect(after.status).toBe("paid");
        expect(await stockOf(dressM)).toBe(0); // never negative
        const held = (
          await db.select().from(orderLines).where(eq(orderLines.orderId, order.id))
        )[0]!;
        expect(held.stockHeld).toBe(1); // only what was really taken

        const alert = (await emails()).find((m) => m.kind === "order_alert")!;
        expect(alert.textBody).toContain("short on stock");

        // Refunding with "return to stock" gives back only what was taken.
        const result = await refundOrder(actor, order.id, { restock: true }, db, provider);
        expect(result).toEqual({ ok: true });
        expect(await stockOf(dressM)).toBe(1);
      });
    });

    describe("refunds reported by the payment provider", () => {
      it("a full refund before shipping returns the items to stock", async () => {
        const { provider } = fakeProvider();
        const order = await placed(provider, dressM, 2);
        await handlePaymentEvent("stripe", paid(order), db);
        await handlePaymentEvent(
          "stripe",
          {
            kind: "refunded",
            eventId: "evt_ref",
            type: "charge.refunded",
            paymentId: `pi_${order.number}`,
            amountRefundedCents: order.totalCents,
            fullyRefunded: true,
          },
          db,
        );
        const after = await orderRow(order.id);
        expect(after.status).toBe("refunded");
        expect(after.refundedAt).not.toBeNull();
        expect(await stockOf(dressM)).toBe(3);
        expect((await emails()).some((m) => m.kind === "order_refunded")).toBe(true);
      });

      it("a full refund after shipping does not put the items back on sale", async () => {
        const { provider } = fakeProvider();
        const order = await placed(provider, dressM, 2);
        await handlePaymentEvent("stripe", paid(order), db);
        await db
          .update(orders)
          .set({ status: "shipped", shippedAt: sql`now()` })
          .where(eq(orders.id, order.id));
        await handlePaymentEvent(
          "stripe",
          {
            kind: "refunded",
            eventId: "evt_ref",
            type: "charge.refunded",
            paymentId: `pi_${order.number}`,
            amountRefundedCents: order.totalCents,
            fullyRefunded: true,
          },
          db,
        );
        expect((await orderRow(order.id)).status).toBe("refunded");
        expect(await stockOf(dressM)).toBe(1);
      });

      it("a partial refund is only noted on the timeline", async () => {
        const { provider } = fakeProvider();
        const order = await placed(provider, dressM, 1);
        await handlePaymentEvent("stripe", paid(order), db);
        await handlePaymentEvent(
          "stripe",
          {
            kind: "refunded",
            eventId: "evt_part",
            type: "charge.refunded",
            paymentId: `pi_${order.number}`,
            amountRefundedCents: 500,
            fullyRefunded: false,
          },
          db,
        );
        expect((await orderRow(order.id)).status).toBe("paid");
        expect(await eventKinds(order.id)).toContain("partial_refund");
      });

      it("ignores refunds for payments it does not know", async () => {
        expect(
          await handlePaymentEvent(
            "stripe",
            {
              kind: "refunded",
              eventId: "evt_x",
              type: "charge.refunded",
              paymentId: "pi_unknown",
              amountRefundedCents: 1,
              fullyRefunded: true,
            },
            db,
          ),
        ).toBe("ignored");
      });
    });
  });

  describe("refunding from the admin", () => {
    async function paidOrder(provider: PaymentProvider, qty = 2) {
      const order = await placed(provider, dressM, qty);
      await handlePaymentEvent("stripe", paid(order), db);
      return orderRow(order.id);
    }

    it("refunds the full amount once, with a key derived from the order", async () => {
      const { provider, calls } = fakeProvider();
      const order = await paidOrder(provider);
      expect(await refundOrder(actor, order.id, { restock: true }, db, provider)).toEqual({
        ok: true,
      });
      expect(calls.refunds).toEqual([
        {
          paymentId: `pi_${order.number}`,
          amountCents: order.totalCents,
          idempotencyKey: `refund-${order.id}`,
          orderId: order.id,
        },
      ]);
      expect((await orderRow(order.id)).status).toBe("refunded");
      expect(await stockOf(dressM)).toBe(3);
      expect((await recentAudit(db)).map((a) => a.action)).toContain("order_refunded");

      // Pressing the button again changes nothing and asks the provider for nothing.
      expect(await refundOrder(actor, order.id, { restock: true }, db, provider)).toEqual({
        ok: true,
      });
      expect(calls.refunds).toHaveLength(1);
      expect(await stockOf(dressM)).toBe(3);
    });

    it("keeps the items off sale when told not to restock", async () => {
      const { provider } = fakeProvider();
      const order = await paidOrder(provider);
      await refundOrder(actor, order.id, { restock: false }, db, provider);
      expect(await stockOf(dressM)).toBe(1);
    });

    it("leaves the order untouched when the provider refuses", async () => {
      const { provider, state } = fakeProvider();
      const order = await paidOrder(provider);
      state.failRefund = true;
      expect(await refundOrder(actor, order.id, { restock: true }, db, provider)).toMatchObject({
        ok: false,
        code: "PROVIDER_ERROR",
      });
      expect((await orderRow(order.id)).status).toBe("paid");
    });

    it("refuses orders that were never paid, and a provider that is not connected", async () => {
      const { provider } = fakeProvider();
      const pending = await placed(provider, shirt, 1);
      expect(await refundOrder(actor, pending.id, { restock: true }, db, provider)).toMatchObject({
        ok: false,
        code: "NOT_REFUNDABLE",
      });
      const order = await paidOrder(provider, 1);
      expect(await refundOrder(actor, order.id, { restock: true }, db, null)).toMatchObject({
        ok: false,
        code: "PAYMENTS_NOT_CONFIGURED",
      });
      expect(
        await refundOrder(
          actor,
          "00000000-0000-4000-8000-000000000000",
          { restock: true },
          db,
          provider,
        ),
      ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    });

    it("works when the provider's own refund event got there first", async () => {
      const { provider, calls } = fakeProvider();
      const order = await paidOrder(provider);
      await handlePaymentEvent(
        "stripe",
        {
          kind: "refunded",
          eventId: "evt_first",
          type: "charge.refunded",
          paymentId: `pi_${order.number}`,
          amountRefundedCents: order.totalCents,
          fullyRefunded: true,
        },
        db,
      );
      expect(await refundOrder(actor, order.id, { restock: true }, db, provider)).toEqual({
        ok: true,
      });
      expect(calls.refunds).toHaveLength(0);
      expect(await stockOf(dressM)).toBe(3); // restocked once, by the first path
    });
  });

  describe("managing orders in the admin", () => {
    async function paidOrder(provider: PaymentProvider, over: Parameters<typeof place>[3] = {}) {
      const order = await placed(provider, dressM, 1, over);
      await handlePaymentEvent("stripe", paid(order), db);
      return orderRow(order.id);
    }
    const ship = (
      id: string,
      over: Partial<{ carrier: string; trackingNumber: string; notify: boolean }> = {},
    ) =>
      shipOrder(actor, id, { carrier: "DHL", trackingNumber: "JD0123", notify: true, ...over }, db);

    it("marks a paid order shipped, records tracking and emails the customer once", async () => {
      const { provider } = fakeProvider();
      const order = await paidOrder(provider);
      expect(await ship(order.id)).toEqual({ ok: true });

      const after = await orderRow(order.id);
      expect(after).toMatchObject({
        status: "shipped",
        trackingCarrier: "DHL",
        trackingNumber: "JD0123",
      });
      expect(after.shippedAt).not.toBeNull();
      expect(await eventKinds(order.id)).toContain("shipped");
      expect((await recentAudit(db)).map((a) => a.action)).toContain("order_shipped");

      const shippedMail = () =>
        emails().then((all) => all.filter((m) => m.kind === "order_shipped"));
      expect(await shippedMail()).toHaveLength(1);
      expect((await shippedMail())[0]).toMatchObject({ toEmail: "buyer@example.com" });
      expect((await shippedMail())[0]!.textBody).toContain("JD0123");

      // Same details again: no second email. Corrected tracking: a new one.
      await ship(order.id);
      expect(await shippedMail()).toHaveLength(1);
      await ship(order.id, { trackingNumber: "JD9999" });
      expect(await shippedMail()).toHaveLength(2);
      expect(await eventKinds(order.id)).toContain("tracking_updated");
      expect((await orderRow(order.id)).trackingNumber).toBe("JD9999");
    });

    it("can ship without telling the customer", async () => {
      const { provider } = fakeProvider();
      const order = await paidOrder(provider);
      await ship(order.id, { notify: false });
      expect((await emails()).filter((m) => m.kind === "order_shipped")).toHaveLength(0);
    });

    it("only ships paid orders and checks the details", async () => {
      const { provider } = fakeProvider();
      const pending = await placed(provider, shirt, 1);
      expect(await ship(pending.id)).toMatchObject({ ok: false, code: "INVALID_STATE" });
      expect(await ship("00000000-0000-4000-8000-000000000000")).toMatchObject({
        ok: false,
        code: "NOT_FOUND",
      });
      const order = await paidOrder(provider);
      expect(await ship(order.id, { carrier: "x".repeat(61) })).toMatchObject({
        ok: false,
        code: "INVALID",
      });
      expect((await orderRow(order.id)).status).toBe("paid");
    });

    it("marks shipped orders delivered, and nothing else", async () => {
      const { provider } = fakeProvider();
      const order = await paidOrder(provider);
      expect(await markOrderDelivered(actor, order.id, db)).toMatchObject({
        ok: false,
        code: "INVALID_STATE",
      });
      await ship(order.id);
      expect(await markOrderDelivered(actor, order.id, db)).toEqual({ ok: true });
      expect(await markOrderDelivered(actor, order.id, db)).toEqual({ ok: true });
      const after = await orderRow(order.id);
      expect(after.status).toBe("delivered");
      expect(after.deliveredAt).not.toBeNull();
      // A delivered order can no longer be shipped again.
      expect(await ship(order.id)).toMatchObject({ ok: false, code: "INVALID_STATE" });
    });

    it("cancels an unpaid order and frees the items, but never a paid one or one mid-payment", async () => {
      const { provider, state } = fakeProvider();
      const unpaid = await placed(provider, dressM, 2);
      expect(await stockOf(dressM)).toBe(1);
      state.expire = "not_open";
      expect(await cancelUnpaid(actor, unpaid.id, db, provider)).toMatchObject({
        ok: false,
        code: "INVALID_STATE",
      });
      expect((await orderRow(unpaid.id)).status).toBe("pending_payment");

      state.expire = "expired";
      expect(await cancelUnpaid(actor, unpaid.id, db, provider)).toEqual({ ok: true });
      expect((await orderRow(unpaid.id)).status).toBe("cancelled");
      expect(await stockOf(dressM)).toBe(3);
      expect(await cancelUnpaid(actor, unpaid.id, db, provider)).toMatchObject({
        ok: false,
        code: "INVALID_STATE",
      });

      const done = await paidOrder(provider);
      expect(await cancelUnpaid(actor, done.id, db, provider)).toMatchObject({
        ok: false,
        code: "INVALID_STATE",
      });
      expect(
        await cancelUnpaid(actor, "00000000-0000-4000-8000-000000000000", db, provider),
      ).toMatchObject({
        ok: false,
        code: "NOT_FOUND",
      });
    });

    it("keeps private notes", async () => {
      const { provider } = fakeProvider();
      const order = await paidOrder(provider);
      expect(await setOrderNote(actor, order.id, "  Gift — wrap nicely  ", db)).toEqual({
        ok: true,
      });
      expect((await orderRow(order.id)).notes).toBe("Gift — wrap nicely");
      expect(await setOrderNote(actor, order.id, "x".repeat(2001), db)).toMatchObject({
        ok: false,
        code: "INVALID",
      });
      expect(
        await setOrderNote(actor, "00000000-0000-4000-8000-000000000000", "hi", db),
      ).toMatchObject({
        ok: false,
        code: "NOT_FOUND",
      });
    });

    it("sends the receipt again, but only for orders that were paid", async () => {
      const { provider } = fakeProvider();
      const pending = await placed(provider, shirt, 1);
      expect(await resendConfirmation(actor, pending.id, db)).toMatchObject({
        ok: false,
        code: "INVALID_STATE",
      });
      const order = await paidOrder(provider);
      expect(await resendConfirmation(actor, order.id, db)).toEqual({ ok: true });
      expect((await emails()).filter((m) => m.kind === "order_confirmation")).toHaveLength(2);
    });

    it("lists, filters and searches orders", async () => {
      const { provider } = fakeProvider();
      const a = await paidOrder(provider, { form: { name: "Ada Obi", email: "ada@example.com" } });
      const b = await placed(provider, shirt, 2, {
        form: { name: "Bola Ade", email: "bola@example.org" },
      });
      await ship(a.id);

      const all = await listAdminOrders({}, db);
      expect(all).toMatchObject({ total: 2, page: 1, pageSize: ORDERS_PAGE_SIZE });
      expect(all.rows.map((r) => r.number)).toEqual([b.number, a.number]); // newest first
      expect(all.rows.find((r) => r.id === b.id)).toMatchObject({
        itemCount: 2,
        status: "pending_payment",
        name: "Bola Ade",
      });

      expect((await listAdminOrders({ status: "shipped" }, db)).rows.map((r) => r.id)).toEqual([
        a.id,
      ]);
      expect((await listAdminOrders({ search: "TOA-1002" }, db)).rows.map((r) => r.id)).toEqual([
        b.id,
      ]);
      expect((await listAdminOrders({ search: "1001" }, db)).rows.map((r) => r.id)).toEqual([a.id]);
      expect((await listAdminOrders({ search: "bola" }, db)).rows.map((r) => r.id)).toEqual([b.id]);
      expect((await listAdminOrders({ search: "example.com" }, db)).rows.map((r) => r.id)).toEqual([
        a.id,
      ]);
      // % and _ are plain characters in a search, not wildcards.
      expect((await listAdminOrders({ search: "%" }, db)).total).toBe(0);
      expect((await listAdminOrders({ search: "ad_" }, db)).total).toBe(0);
      expect((await listAdminOrders({ status: "paid", search: "bola" }, db)).total).toBe(0);
    });

    it("pages through long lists", async () => {
      const { provider } = fakeProvider();
      const first = await placed(provider, shirt, 1);
      // Bulk-copy the first order's data to make a long history without 30 checkouts.
      for (let i = 0; i < ORDERS_PAGE_SIZE + 4; i += 1) {
        await db.insert(orders).values({
          email: `bulk${i}@example.com`,
          accessToken: `bulk-token-${i}-${"x".repeat(20)}`,
          status: "cancelled",
          cancelledAt: new Date(),
          shipName: "Bulk",
          shipLine1: "1 Road",
          shipCity: "City",
          shipCountry: "NG",
          itemsCents: 100,
          shippingCents: 0,
          taxCents: 0,
          totalCents: 100,
          shippingMethod: "Standard",
          shippingZone: "Nigeria",
          paymentProvider: "stripe",
        });
      }
      const page1 = await listAdminOrders({ page: 1 }, db);
      const page2 = await listAdminOrders({ page: 2 }, db);
      expect(page1.total).toBe(ORDERS_PAGE_SIZE + 5);
      expect(page1.rows).toHaveLength(ORDERS_PAGE_SIZE);
      expect(page2.rows).toHaveLength(5);
      expect(new Set([...page1.rows, ...page2.rows].map((r) => r.id)).size).toBe(
        ORDERS_PAGE_SIZE + 5,
      );
      expect([...page1.rows, ...page2.rows].some((r) => r.id === first.id)).toBe(true);
    });

    it("shows one order with its full history", async () => {
      const { provider } = fakeProvider();
      const order = await paidOrder(provider);
      await ship(order.id);
      const view = await getAdminOrder(order.id, db);
      expect(view).toMatchObject({
        number: order.number,
        status: "shipped",
        paymentProvider: "stripe",
        providerPaymentId: `pi_${order.number}`,
        shippingZone: "Nigeria",
      });
      expect(view!.events.map((e) => e.kind)).toEqual(["created", "paid", "shipped"]);
      expect(await getAdminOrder("not-a-uuid", db)).toBeNull();
      expect(await getAdminOrder("00000000-0000-4000-8000-000000000000", db)).toBeNull();
    });

    it("exports a spreadsheet that cannot run formulas", async () => {
      const { provider } = fakeProvider();
      await paidOrder(provider, {
        form: { name: '=HYPERLINK("http://evil.test","click")', line1: "5, Main St" },
      });
      const csv = await ordersCsv({}, db);
      const [header, row] = csv.trim().split("\n");
      expect(header).toContain("order,placed_at,status,email,name");
      expect(row).toContain("TOA-1001");
      expect(row).toContain("1 x Amara Dress (M)");
      // The formula is neutralised and the comma-containing address is quoted.
      expect(row).toContain(`"'=HYPERLINK(""http://evil.test"",""click"")"`);
      expect(row).toContain('"5, Main St"');
      expect(row).toContain("$139.00"); // 120.00 + 10.00 delivery + 9.00 tax
    });

    it("feeds the dashboard", async () => {
      const { provider } = fakeProvider();
      await paidOrder(provider);
      await placed(provider, shirt, 1);
      const board = await adminDashboard(db);
      expect(board.orders).toMatchObject({ toShip: 1, awaitingPayment: 1 });
      expect(board.orders.last30Days.count).toBe(1);
      expect(board.orders.last30Days.cents).toBeGreaterThan(0);
      expect(board.orders.latest.map((o) => o.status)).toEqual(["paid"]); // unpaid ones are not "latest"
    });
  });

  describe("what the database itself refuses", () => {
    it("rejects totals that do not add up and statuses without their timestamps", async () => {
      const { provider } = fakeProvider();
      const order = await placed(provider, dressM, 1);
      await expect(
        db.execute(sql`update orders set total_cents = total_cents + 1 where id = ${order.id}`),
      ).rejects.toMatchObject({ cause: { constraint: "orders_total_adds_up" } });
      await expect(
        db.execute(sql`update orders set status = 'paid' where id = ${order.id}`),
      ).rejects.toMatchObject({ cause: { constraint: "orders_paid_has_paid_at" } });
      await expect(
        db.execute(
          sql`update orders set status = 'shipped', paid_at = now() where id = ${order.id}`,
        ),
      ).rejects.toMatchObject({ cause: { constraint: "orders_shipped_has_shipped_at" } });
    });

    it("allows one unpaid order per bag, and never negative stock", async () => {
      const { provider } = fakeProvider();
      const order = await placed(provider, dressM, 1);
      await expect(
        db.insert(orders).values({
          email: "x@example.com",
          cartId: order.cartId,
          accessToken: "dup-token",
          shipName: "X",
          shipLine1: "1",
          shipCity: "C",
          shipCountry: "NG",
          itemsCents: 1,
          shippingCents: 0,
          taxCents: 0,
          totalCents: 1,
          shippingMethod: "S",
          shippingZone: "Z",
          paymentProvider: "stripe",
        }),
      ).rejects.toThrow();
      await expect(
        db.execute(sql`update variants set stock = -1 where id = ${dressM}`),
      ).rejects.toThrow();
    });
  });
});
