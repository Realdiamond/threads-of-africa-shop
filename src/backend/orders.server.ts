import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import { checkCheckoutForm, normaliseCheckoutForm } from "@/lib/checkout-validation";
import {
  formatCents,
  type AdminOrderView,
  type CheckoutForm,
  type CheckoutSummary,
  type CustomerOrderView,
  type OrderEventView,
  type PlaceOrderResult,
} from "@/lib/order-types";
import { formatTaxRate } from "@/lib/store-types";

import { Abort, abortWith } from "./abort.server";
import { MAX_LINE_QUANTITY } from "./cart.server";
import { getDb, type Db, type Executor } from "./db/client.server";
import {
  cartLines,
  carts,
  orderEvents,
  orderLines,
  orders,
  productImages,
  products,
  variants,
} from "./db/schema";
import { errorFields, log } from "./log.server";
import { getPaymentProvider, type PaymentProvider } from "./payments.server";
import { pgError, UNIQUE_VIOLATION } from "./pg-error.server";
import { deliverableCountries, quoteShipping, taxFor } from "./shipping.server";
import { siteUrl } from "./site-url.server";

// How long an unpaid order keeps its items out of stock. Stripe's checkout page must stay open for
// at least 30 minutes, so the page expires at 35 (a safe margin over the minimum) and the shop's own
// hold a few minutes after that.
const HOLD_MINUTES = 40;
const PAYMENT_PAGE_MINUTES = 35;
// Someone starting many checkouts and never paying would keep stock off sale, so each email
// address may have only a few unfinished ones at a time.
const MAX_UNPAID_PER_EMAIL = 3;
// Past the hold, an order whose payment page could not be closed is cancelled anyway after this.
const EXPIRY_GRACE_MS = 60 * 60 * 1000;

export type Order = typeof orders.$inferSelect;
export type OrderLine = typeof orderLines.$inferSelect;

const fail = (
  code: Extract<PlaceOrderResult, { ok: false }>["code"],
  message: string,
): Extract<PlaceOrderResult, { ok: false }> => ({ ok: false, code, message });

const CLOSED = fail(
  "PAYMENTS_NOT_CONFIGURED",
  "Checkout isn't open yet — we're getting ready to launch. Please check back soon.",
);

// The leading letter keeps the token from ever looking like a number or `true` in a web address,
// where the router would otherwise change its type.
export const newAccessToken = () => `t${randomBytes(24).toString("base64url")}`;

export function tokenMatches(actual: string, given: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function addOrderEvent(
  ex: Pick<Executor, "insert">,
  orderId: string,
  kind: string,
  summary: string,
  actor: string,
) {
  await ex.insert(orderEvents).values({ orderId, kind, summary: summary.slice(0, 500), actor });
}

// Puts the items of an order back on the shelf: exactly what it took, and only once, because
// afterwards nothing is held.
export async function releaseStock(ex: Executor, orderId: string) {
  const held = await ex
    .select({ id: orderLines.id, variantId: orderLines.variantId, qty: orderLines.stockHeld })
    .from(orderLines)
    .where(and(eq(orderLines.orderId, orderId), gt(orderLines.stockHeld, 0)))
    .orderBy(asc(orderLines.variantId), asc(orderLines.id))
    .for("update");
  for (const line of held) {
    if (line.variantId) {
      await ex
        .update(variants)
        .set({ stock: sql`${variants.stock} + ${line.qty}` })
        .where(eq(variants.id, line.variantId));
    }
    await ex.update(orderLines).set({ stockHeld: 0 }).where(eq(orderLines.id, line.id));
  }
}

// For a payment that arrives after the hold expired: take whatever is still on the shelf.
// Returns the products that came up short (the shop has been paid for something it may not have).
export async function retakeStock(ex: Executor, orderId: string): Promise<string[]> {
  const lines = await ex
    .select({
      id: orderLines.id,
      variantId: orderLines.variantId,
      quantity: orderLines.quantity,
      title: orderLines.productTitle,
    })
    .from(orderLines)
    .where(eq(orderLines.orderId, orderId))
    .orderBy(asc(orderLines.variantId), asc(orderLines.id));
  const short: string[] = [];
  for (const line of lines) {
    let taken = 0;
    if (line.variantId) {
      const [variant] = await ex
        .select({ stock: variants.stock })
        .from(variants)
        .where(eq(variants.id, line.variantId))
        .for("update");
      taken = Math.min(variant?.stock ?? 0, line.quantity);
      if (taken > 0) {
        await ex
          .update(variants)
          .set({ stock: sql`${variants.stock} - ${taken}` })
          .where(eq(variants.id, line.variantId));
      }
    }
    if (taken < line.quantity) short.push(line.title);
    await ex.update(orderLines).set({ stockHeld: taken }).where(eq(orderLines.id, line.id));
  }
  return short;
}

// ---------------------------------------------------------------------------------------------
// Views

export function toCustomerView(order: Order, lines: OrderLine[]): CustomerOrderView {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    email: order.email,
    address: {
      name: order.shipName,
      line1: order.shipLine1,
      line2: order.shipLine2,
      city: order.shipCity,
      region: order.shipRegion,
      postalCode: order.shipPostalCode,
      country: order.shipCountry,
      phone: order.shipPhone,
    },
    currency: order.currency,
    itemsCents: order.itemsCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    taxBps: order.taxBps,
    shippingMethod: order.shippingMethod,
    lines: lines.map((line) => ({
      id: line.id,
      productTitle: line.productTitle,
      variantTitle: line.variantTitle,
      sku: line.sku,
      imageUrl: line.imageUrl,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
      lineTotalCents: line.lineTotalCents,
    })),
    trackingCarrier: order.trackingCarrier,
    trackingNumber: order.trackingNumber,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    shippedAt: order.shippedAt?.toISOString() ?? null,
    accountLinked: order.customerId !== null,
  };
}

export function toAdminView(
  order: Order,
  lines: OrderLine[],
  events: OrderEventView[],
): AdminOrderView {
  return {
    ...toCustomerView(order, lines),
    notes: order.notes,
    paymentProvider: order.paymentProvider,
    providerPaymentId: order.providerPaymentId,
    providerSessionId: order.providerSessionId,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    refundedAt: order.refundedAt?.toISOString() ?? null,
    expiresAt: order.expiresAt?.toISOString() ?? null,
    shippingZone: order.shippingZone,
    events,
  };
}

export async function loadOrderLines(ex: Pick<Executor, "select">, orderId: string) {
  return ex
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, orderId))
    .orderBy(asc(orderLines.productTitle), asc(orderLines.variantTitle), asc(orderLines.id));
}

export async function loadCustomerOrder(
  ex: Pick<Executor, "select">,
  orderId: string,
): Promise<CustomerOrderView | null> {
  const [order] = await ex.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
  return toCustomerView(order, await loadOrderLines(ex, orderId));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

// A customer's own order, opened with the link from their confirmation email.
export async function getOrderByToken(
  orderId: string,
  token: string,
  db: Db = getDb(),
): Promise<CustomerOrderView | null> {
  if (!isUuid(orderId) || token.length < 16 || token.length > 100) return null;
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || !tokenMatches(order.accessToken, token)) return null;
  return toCustomerView(order, await loadOrderLines(db, orderId));
}

// ---------------------------------------------------------------------------------------------
// Reading the bag for checkout

type CheckoutLine = {
  lineId: string;
  variantId: string;
  quantity: number;
  unitPriceCents: number;
  currency: string;
  stock: number;
  sku: string;
  variantTitle: string;
  productId: string;
  productTitle: string;
  productActive: boolean;
  imageUrl: string;
};

async function readCheckoutLines(ex: Pick<Executor, "select">, cartId: string) {
  const rows = await ex
    .select({
      lineId: cartLines.id,
      variantId: cartLines.variantId,
      quantity: cartLines.quantity,
      unitPriceCents: variants.priceCents,
      currency: variants.currency,
      stock: variants.stock,
      sku: variants.sku,
      variantTitle: variants.title,
      productId: products.id,
      productTitle: products.title,
      productStatus: products.status,
    })
    .from(cartLines)
    .innerJoin(variants, eq(variants.id, cartLines.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(cartLines.cartId, cartId))
    .orderBy(asc(cartLines.createdAt), asc(cartLines.id));
  if (rows.length === 0) return [];

  const images = await ex
    .select({ productId: productImages.productId, url: productImages.url })
    .from(productImages)
    .where(
      inArray(
        productImages.productId,
        rows.map((r) => r.productId),
      ),
    )
    .orderBy(asc(productImages.position), asc(productImages.createdAt));
  const firstImage = new Map<string, string>();
  for (const image of images)
    if (!firstImage.has(image.productId)) firstImage.set(image.productId, image.url);

  return rows.map((row): CheckoutLine => ({
    lineId: row.lineId,
    variantId: row.variantId,
    quantity: row.quantity,
    unitPriceCents: row.unitPriceCents,
    currency: row.currency,
    stock: row.stock,
    sku: row.sku,
    variantTitle: row.variantTitle,
    productId: row.productId,
    productTitle: row.productTitle,
    productActive: row.productStatus === "active",
    imageUrl: firstImage.get(row.productId) ?? "",
  }));
}

const lineAvailable = (line: CheckoutLine) =>
  line.productActive && line.quantity <= Math.min(MAX_LINE_QUANTITY, line.stock);

const UNAVAILABLE =
  "Some items are no longer available in the quantity you chose. Please review your bag.";

async function openCart(ex: Pick<Executor, "select">, cartId: string) {
  const [cart] = await ex
    .select({ id: carts.id })
    .from(carts)
    .where(and(eq(carts.id, cartId), eq(carts.status, "open"), gt(carts.expiresAt, sql`now()`)));
  return cart !== undefined;
}

// What the checkout page shows: the bag as the database sees it, plus delivery options and tax
// for the chosen country. The browser's own copy of the bag is never used for prices.
export async function checkoutSummary(
  cartId: string,
  country: string | null,
  db: Db = getDb(),
  provider: PaymentProvider | null = getPaymentProvider(),
): Promise<CheckoutSummary> {
  if (!provider) return { ok: false, code: "PAYMENTS_NOT_CONFIGURED", message: CLOSED.message };
  if (!(await openCart(db, cartId))) {
    return {
      ok: false,
      code: "CART_NOT_FOUND",
      message: "Your bag has expired. Please add your items again.",
    };
  }
  const lines = await readCheckoutLines(db, cartId);
  if (lines.length === 0) return { ok: false, code: "CART_EMPTY", message: "Your bag is empty." };
  if (!lines.every(lineAvailable) || new Set(lines.map((l) => l.currency)).size > 1) {
    return { ok: false, code: "ITEMS_UNAVAILABLE", message: UNAVAILABLE };
  }
  const itemsCents = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);

  let shipping: Extract<CheckoutSummary, { ok: true }>["shipping"] = null;
  if (country) {
    const quote = await quoteShipping(country, itemsCents, db);
    if (quote.ok) {
      shipping = {
        zoneName: quote.zone.name,
        taxBps: quote.zone.taxBps,
        taxCents: taxFor(itemsCents, quote.zone.taxBps),
        options: quote.options,
      };
    }
  }
  return {
    ok: true,
    testMode: provider.name === "mock",
    currency: lines[0]?.currency ?? "USD",
    lines: lines.map((l) => ({
      lineId: l.lineId,
      productTitle: l.productTitle,
      variantTitle: l.variantTitle,
      imageUrl: l.imageUrl,
      unitPriceCents: l.unitPriceCents,
      quantity: l.quantity,
      lineTotalCents: l.unitPriceCents * l.quantity,
    })),
    itemsCents,
    countries: await deliverableCountries(db),
    shipping,
  };
}

// ---------------------------------------------------------------------------------------------
// Placing an order

export type PlaceOrderInput = {
  cartId: string;
  rateId: string;
  // Chosen by the browser once per checkout attempt: pressing "Pay" twice makes one order.
  idempotencyKey: string;
  form: CheckoutForm;
  // The signed-in customer placing it, if any.
  customerId?: string | null | undefined;
};

type Reserved = { kind: "created"; order: Order } | { kind: "existing"; order: Order };

const requestHash = (input: PlaceOrderInput, form: CheckoutForm) =>
  createHash("sha256")
    .update(JSON.stringify({ cartId: input.cartId, rateId: input.rateId, form }))
    .digest("hex");

// Cancels an unpaid order and puts its items back. Safe to call twice: only the first call finds
// the order still unpaid, so stock is restored exactly once.
export async function cancelPendingInTx(
  tx: Executor,
  orderId: string,
  reason: string,
  actor: string,
): Promise<boolean> {
  const rows = await tx
    .update(orders)
    .set({
      status: "cancelled",
      cancelledAt: sql`now()`,
      expiresAt: null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(orders.id, orderId), eq(orders.status, "pending_payment")))
    .returning({ id: orders.id });
  if (rows.length === 0) return false;
  await releaseStock(tx, orderId);
  await addOrderEvent(tx, orderId, "cancelled", reason, actor);
  return true;
}

async function reserve(
  input: PlaceOrderInput,
  form: CheckoutForm,
  provider: PaymentProvider,
  db: Db,
) {
  const hash = requestHash(input, form);

  return db.transaction(async (tx): Promise<Reserved> => {
    const [lockedCart] = await tx
      .select({ id: carts.id })
      .from(carts)
      .where(
        and(eq(carts.id, input.cartId), eq(carts.status, "open"), gt(carts.expiresAt, sql`now()`)),
      )
      .for("update");

    const [existing] = await tx
      .select()
      .from(orders)
      .where(eq(orders.idempotencyKey, input.idempotencyKey));
    if (existing) {
      if (existing.cartId !== input.cartId || existing.idempotencyHash !== hash) {
        return abortWith(
          fail("IDEMPOTENCY_CONFLICT", "Something changed. Please refresh the page and try again."),
        );
      }
      return { kind: "existing", order: existing };
    }
    if (!lockedCart) {
      return abortWith(
        fail("CART_NOT_FOUND", "Your bag has expired. Please add your items again."),
      );
    }

    // A bag has at most one unpaid order: starting again replaces the earlier attempt (whose
    // payment page was closed before we got here).
    const earlier = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.cartId, input.cartId), eq(orders.status, "pending_payment")))
      .for("update");
    for (const old of earlier) {
      await cancelPendingInTx(tx, old.id, "Replaced by a new checkout", "customer");
    }

    const [{ unpaid } = { unpaid: 0 }] = await tx
      .select({ unpaid: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.email, form.email), eq(orders.status, "pending_payment")));
    if (unpaid >= MAX_UNPAID_PER_EMAIL) {
      return abortWith(
        fail(
          "PAYMENT_UNAVAILABLE",
          "You already have several unfinished checkouts. Please complete or wait for them to expire, or contact us.",
        ),
      );
    }

    const lines = await readCheckoutLines(tx, input.cartId);
    if (lines.length === 0) return abortWith(fail("CART_EMPTY", "Your bag is empty."));
    if (!lines.every((l) => l.productActive) || new Set(lines.map((l) => l.currency)).size > 1) {
      return abortWith(fail("ITEMS_UNAVAILABLE", UNAVAILABLE));
    }
    const currency = lines[0]?.currency ?? "USD";
    const itemsCents = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);

    const quote = await quoteShipping(form.country, itemsCents, tx);
    if (!quote.ok) return abortWith(fail("NOT_SHIPPABLE", quote.message));
    const option = quote.options.find((o) => o.rateId === input.rateId);
    if (!option) {
      return abortWith(
        fail(
          "INVALID",
          "That delivery option is not available for your country. Please pick another.",
        ),
      );
    }
    const taxCents = taxFor(itemsCents, quote.zone.taxBps);

    // Take the items off the shelf now, so two people can never both buy the last piece. The
    // check and the decrement are one statement; the order of the updates is fixed so that two
    // checkouts touching the same products cannot deadlock.
    const heldBy = [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId));
    for (const line of heldBy) {
      const taken = await tx
        .update(variants)
        .set({ stock: sql`${variants.stock} - ${line.quantity}` })
        .where(and(eq(variants.id, line.variantId), gt(variants.stock, line.quantity - 1)))
        .returning({ id: variants.id });
      if (taken.length === 0) {
        return abortWith(
          fail(
            "ITEMS_UNAVAILABLE",
            `Sorry, ${line.productTitle}${line.variantTitle ? ` (${line.variantTitle})` : ""} just sold out or is low on stock. Please review your bag.`,
          ),
        );
      }
    }

    const [created] = await tx
      .insert(orders)
      .values({
        email: form.email,
        cartId: input.cartId,
        customerId: input.customerId ?? null,
        idempotencyKey: input.idempotencyKey,
        idempotencyHash: hash,
        accessToken: newAccessToken(),
        shipName: form.name,
        shipLine1: form.line1,
        shipLine2: form.line2,
        shipCity: form.city,
        shipRegion: form.region,
        shipPostalCode: form.postalCode,
        shipCountry: form.country,
        shipPhone: form.phone,
        currency,
        itemsCents,
        shippingCents: option.priceCents,
        taxCents,
        totalCents: itemsCents + option.priceCents + taxCents,
        shippingMethod: option.name,
        shippingZone: quote.zone.name,
        taxBps: quote.zone.taxBps,
        paymentProvider: provider.name,
        expiresAt: sql`now() + make_interval(mins => ${HOLD_MINUTES})`,
      })
      .returning();
    if (!created) throw new Error("order insert returned no row");

    await tx.insert(orderLines).values(
      lines.map((l) => ({
        orderId: created.id,
        variantId: l.variantId,
        productTitle: l.productTitle,
        variantTitle: l.variantTitle,
        sku: l.sku,
        imageUrl: l.imageUrl,
        unitPriceCents: l.unitPriceCents,
        quantity: l.quantity,
        lineTotalCents: l.unitPriceCents * l.quantity,
        stockHeld: l.quantity,
      })),
    );
    await addOrderEvent(
      tx,
      created.id,
      "created",
      `Order placed for ${formatCents(created.totalCents, currency)}; waiting for payment`,
      "customer",
    );
    return { kind: "created", order: created };
  });
}

// Opens the provider's payment page for an order that does not have one yet.
async function ensurePaymentPage(
  order: Order,
  provider: PaymentProvider,
  db: Db,
): Promise<PlaceOrderResult> {
  if (order.status === "paid" || order.status === "shipped" || order.status === "delivered") {
    return { ok: true, url: `/orders/${order.id}?t=${order.accessToken}&placed=1` };
  }
  if (order.status !== "pending_payment") {
    return fail("PAYMENT_UNAVAILABLE", "That checkout was cancelled. Please start again.");
  }
  if (order.paymentUrl) return { ok: true, url: order.paymentUrl };

  const lines = await loadOrderLines(db, order.id);
  const base = siteUrl();
  const absolute = (url: string) => (url.startsWith("/") ? `${base}${url}` : url);
  try {
    const session = await provider.createCheckoutSession({
      orderId: order.id,
      number: order.number,
      email: order.email,
      currency: order.currency,
      lines: lines.map((l) => ({
        name: l.variantTitle ? `${l.productTitle} — ${l.variantTitle}` : l.productTitle,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        imageUrl: l.imageUrl ? absolute(l.imageUrl) : "",
      })),
      shipping: { label: `Delivery — ${order.shippingMethod}`, cents: order.shippingCents },
      tax: { label: `Tax (${formatTaxRate(order.taxBps)})`, cents: order.taxCents },
      totalCents: order.totalCents,
      successUrl: `${base}/orders/${order.id}?t=${order.accessToken}&placed=1`,
      cancelUrl: `${base}/checkout?cancelled=1&o=${order.id}&t=${order.accessToken}`,
      expiresAt: new Date(order.createdAt.getTime() + PAYMENT_PAGE_MINUTES * 60_000),
    });
    const saved = await db
      .update(orders)
      .set({ providerSessionId: session.sessionId, paymentUrl: session.url, updatedAt: sql`now()` })
      .where(and(eq(orders.id, order.id), eq(orders.status, "pending_payment")))
      .returning({ id: orders.id });
    if (saved.length === 0) {
      return fail("PAYMENT_UNAVAILABLE", "That checkout expired. Please start again.");
    }
    return { ok: true, url: session.url };
  } catch (error) {
    log("error", "could not open the payment page", { orderId: order.id, ...errorFields(error) });
    // Nothing was charged and nothing will be; free the items and let the customer retry.
    await db.transaction((tx) =>
      cancelPendingInTx(tx, order.id, "Could not start payment with the provider", "system"),
    );
    return fail(
      "PAYMENT_UNAVAILABLE",
      "We couldn't reach the payment service just now. Nothing was charged — please try again in a moment.",
    );
  }
}

// Before a bag starts a new checkout, the payment page of its earlier unpaid order has to be
// closed for good. If it cannot be (it may be being paid right now), the new checkout waits;
// otherwise the customer could end up paying twice.
async function closeEarlierPaymentPage(
  input: PlaceOrderInput,
  provider: PaymentProvider,
  db: Db,
): Promise<Extract<PlaceOrderResult, { ok: false }> | null> {
  const [earlier] = await db
    .select({
      sessionId: orders.providerSessionId,
      providerName: orders.paymentProvider,
      key: orders.idempotencyKey,
    })
    .from(orders)
    .where(and(eq(orders.cartId, input.cartId), eq(orders.status, "pending_payment")));
  // No earlier attempt, no page to close, or this is the same attempt being repeated.
  if (!earlier?.sessionId || earlier.key === input.idempotencyKey) return null;
  if (earlier.providerName !== provider.name) return null;
  try {
    if ((await provider.expireSession(earlier.sessionId)) === "expired") return null;
  } catch (error) {
    log("warn", "could not close the earlier payment page", errorFields(error));
  }
  return fail(
    "PAYMENT_UNAVAILABLE",
    "Your last payment attempt is still being confirmed. Please wait a minute and try again — and check your email in case it went through.",
  );
}

export async function placeOrder(
  input: PlaceOrderInput,
  db: Db = getDb(),
  provider: PaymentProvider | null = getPaymentProvider(),
): Promise<PlaceOrderResult> {
  if (!provider) return CLOSED;
  const form = normaliseCheckoutForm(input.form);
  const problem = checkCheckoutForm(form);
  if (problem) return fail("INVALID", problem.message);

  const blocked = await closeEarlierPaymentPage(input, provider, db);
  if (blocked) return blocked;

  let reserved: Reserved;
  try {
    reserved = await reserve(input, form, provider, db);
  } catch (error) {
    if (error instanceof Abort) return error.failure as Extract<PlaceOrderResult, { ok: false }>;
    // Two requests carrying the same key at the same instant: the loser simply asks again.
    if (pgError(error).code === UNIQUE_VIOLATION) {
      const [raced] = await db
        .select()
        .from(orders)
        .where(eq(orders.idempotencyKey, input.idempotencyKey));
      if (raced) reserved = { kind: "existing", order: raced };
      else throw error;
    } else {
      throw error;
    }
  }

  return ensurePaymentPage(reserved.order, provider, db);
}

// ---------------------------------------------------------------------------------------------
// Cancelling and expiring unpaid orders

export type CancelOutcome = "cancelled" | "not_pending" | "payment_in_progress";

// Cancels an unpaid order and frees its items, after closing its payment page so the customer
// cannot pay for something that was just released. If the page cannot be closed the customer may
// be paying this very moment, so the order is left alone.
export async function cancelUnpaidOrder(
  orderId: string,
  reason: string,
  actor: string,
  db: Db = getDb(),
  provider: PaymentProvider | null = getPaymentProvider(),
): Promise<CancelOutcome> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.status !== "pending_payment") return "not_pending";
  if (order.providerSessionId && provider && provider.name === order.paymentProvider) {
    try {
      if ((await provider.expireSession(order.providerSessionId)) === "not_open") {
        return "payment_in_progress";
      }
    } catch (error) {
      log("warn", "could not close the payment page", errorFields(error));
      return "payment_in_progress";
    }
  }
  const done = await db.transaction((tx) => cancelPendingInTx(tx, order.id, reason, actor));
  return done ? "cancelled" : "not_pending";
}

// The "back" link on the payment page: the customer changed their mind, so release the items now
// instead of making everyone wait for the hold to run out.
export async function cancelCheckoutByToken(
  orderId: string,
  token: string,
  db: Db = getDb(),
  provider: PaymentProvider | null = getPaymentProvider(),
): Promise<boolean> {
  if (!isUuid(orderId)) return false;
  const [order] = await db
    .select({ token: orders.accessToken })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order || !tokenMatches(order.token, token)) return false;
  return (
    (await cancelUnpaidOrder(
      orderId,
      "Customer left the payment page",
      "customer",
      db,
      provider,
    )) === "cancelled"
  );
}

// Run every minute: cancels unpaid orders whose hold ran out and frees their items.
export async function expireStaleOrders(
  db: Db = getDb(),
  provider: PaymentProvider | null = getPaymentProvider(),
): Promise<number> {
  const stale = await db
    .select({
      id: orders.id,
      sessionId: orders.providerSessionId,
      providerName: orders.paymentProvider,
      expiredForMs: sql<number>`(extract(epoch from now() - ${orders.expiresAt}) * 1000)::float8`,
    })
    .from(orders)
    .where(and(eq(orders.status, "pending_payment"), sql`${orders.expiresAt} <= now()`))
    .orderBy(asc(orders.expiresAt))
    .limit(50);

  let cancelled = 0;
  for (const order of stale) {
    if (order.sessionId && provider && provider.name === order.providerName) {
      let outcome: "expired" | "not_open" | "error" = "error";
      try {
        outcome = await provider.expireSession(order.sessionId);
      } catch (error) {
        log("warn", "could not close an expired payment page", {
          orderId: order.id,
          ...errorFields(error),
        });
      }
      // The page is still open or may have just been paid: wait for the provider's own event,
      // unless it has been long enough that the order is clearly dead.
      if (outcome !== "expired" && order.expiredForMs < EXPIRY_GRACE_MS) continue;
    }
    if (
      await db.transaction((tx) =>
        cancelPendingInTx(tx, order.id, "Payment window expired", "system"),
      )
    ) {
      cancelled += 1;
    }
  }
  if (cancelled > 0) log("info", "expired unpaid orders", { cancelled });
  return cancelled;
}
