import { randomBytes, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import {
  formatCents,
  formatOrderNumber,
  PAID_STATUSES,
  type CustomerOrderView,
} from "@/lib/order-types";

import { recordAudit, type Actor } from "./admin/audit.server";
import { getDb, type Db, type Executor } from "./db/client.server";
import { carts, orders, webhookEvents } from "./db/schema";
import { queueEmail } from "./email/outbox.server";
import {
  newOrderAlertEmail,
  orderAttentionEmail,
  orderConfirmationEmail,
  orderRefundedEmail,
} from "./email/order-templates.server";
import { errorFields, log } from "./log.server";
import {
  addOrderEvent,
  cancelCheckoutByToken,
  cancelPendingInTx,
  isUuid,
  loadCustomerOrder,
  releaseStock,
  retakeStock,
} from "./orders.server";
import { getPaymentProvider, type PaymentEvent, type PaymentProvider } from "./payments.server";
import { getSettings } from "./settings.server";
import { siteUrl } from "./site-url.server";

export type HandleOutcome = "processed" | "duplicate" | "ignored";

type Shop = { storeName: string; contactEmail: string };

const orderLink = (order: Pick<CustomerOrderView, "id"> & { token: string }) =>
  `${siteUrl()}/orders/${order.id}?t=${order.token}`;
const adminLink = (orderId: string) => `${siteUrl()}/admin/orders/${orderId}`;

async function customerView(tx: Executor, orderId: string) {
  const view = await loadCustomerOrder(tx, orderId);
  if (!view) throw new Error(`order ${orderId} vanished`);
  return view;
}

// Tells the shop team something about an order needs a person.
async function alertShop(tx: Executor, shop: Shop, orderId: string, problem: string, kind: string) {
  const view = await customerView(tx, orderId);
  const mail = orderAttentionEmail(shop, view, adminLink(orderId), problem);
  await queueEmail(tx, {
    ...mail,
    to: shop.contactEmail,
    kind: "order_attention",
    dedupeKey: `${kind}:${orderId}`,
  });
}

// ---------------------------------------------------------------------------------------------
// Incoming payment events

// The single place where the outside world changes an order. The event id is claimed first, in
// the same transaction as everything it causes, so a replayed delivery does nothing twice and a
// crash half-way leaves no trace (the provider simply sends it again).
export async function handlePaymentEvent(
  providerName: string,
  event: PaymentEvent,
  db: Db = getDb(),
): Promise<HandleOutcome> {
  if (event.kind === "ignored") return "ignored";
  const shop = await getSettings(db);

  return db.transaction(async (tx) => {
    const [claim] = await tx
      .insert(webhookEvents)
      .values({ provider: providerName, eventId: event.eventId, type: event.type })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (!claim) return "duplicate";

    let outcome: HandleOutcome = "processed";
    switch (event.kind) {
      case "paid":
        outcome = await onPaid(tx, providerName, event, shop);
        break;
      case "expired":
        outcome = await onExpired(tx, providerName, event);
        break;
      case "failed":
        outcome = await onFailed(tx, providerName, event);
        break;
      case "refunded":
        outcome = await onRefunded(tx, providerName, event, shop);
        break;
    }
    await tx
      .update(webhookEvents)
      .set({ processedAt: sql`now()` })
      .where(eq(webhookEvents.id, claim.id));
    return outcome;
  });
}

async function onPaid(
  tx: Executor,
  providerName: string,
  event: Extract<PaymentEvent, { kind: "paid" }>,
  shop: Shop,
): Promise<HandleOutcome> {
  if (!isUuid(event.orderId)) return "ignored";
  const [order] = await tx.select().from(orders).where(eq(orders.id, event.orderId)).for("update");
  if (!order) {
    log("warn", "payment received for an order we do not have", {
      provider: providerName,
      eventId: event.eventId,
    });
    return "ignored";
  }
  if (order.providerSessionId && order.providerSessionId !== event.sessionId) {
    log("warn", "payment received for a different session than the order's", {
      orderId: order.id,
    });
    return "ignored";
  }
  // Already paid, shipped, refunded...: a repeat of something we have dealt with.
  if (order.status !== "pending_payment" && order.status !== "cancelled") return "ignored";

  const matches =
    event.amountCents === order.totalCents && event.currency.toUpperCase() === order.currency;
  if (!matches) {
    // Never mark an order paid for the wrong amount. Keep it from expiring so a person can sort
    // it out (cancel it, or refund in the payment dashboard) with the money still traceable.
    await tx
      .update(orders)
      .set({
        expiresAt: null,
        providerPaymentId: event.paymentId,
        providerSessionId: sql`coalesce(${orders.providerSessionId}, ${event.sessionId})`,
        updatedAt: sql`now()`,
      })
      .where(eq(orders.id, order.id));
    await addOrderEvent(
      tx,
      order.id,
      "payment_mismatch",
      `A payment of ${(event.amountCents / 100).toFixed(2)} ${event.currency.toUpperCase()} arrived but the order total is ${formatCents(order.totalCents, order.currency)}. The order was NOT marked paid.`,
      providerName,
    );
    await alertShop(
      tx,
      shop,
      order.id,
      "A payment came in for a different amount than the order total, so the order was not marked as paid. Please check it in your payment dashboard.",
      "order-mismatch",
    );
    return "processed";
  }

  const lateRecovery = order.status === "cancelled";
  const short = lateRecovery ? await retakeStock(tx, order.id) : [];

  const [paid] = await tx
    .update(orders)
    .set({
      status: "paid",
      paidAt: sql`now()`,
      cancelledAt: null,
      expiresAt: null,
      providerPaymentId: event.paymentId,
      providerSessionId: sql`coalesce(${orders.providerSessionId}, ${event.sessionId})`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(orders.id, order.id), eq(orders.status, order.status)))
    .returning({ id: orders.id });
  if (!paid) return "ignored";

  if (order.cartId) {
    await tx
      .update(carts)
      .set({ status: "converted", updatedAt: sql`now()` })
      .where(and(eq(carts.id, order.cartId), eq(carts.status, "open")));
  }

  await addOrderEvent(
    tx,
    order.id,
    "paid",
    `Payment of ${formatCents(order.totalCents, order.currency)} received`,
    providerName,
  );

  const view = await customerView(tx, order.id);
  const confirmation = orderConfirmationEmail(
    shop,
    view,
    orderLink({ id: order.id, token: order.accessToken }),
  );
  await queueEmail(tx, {
    ...confirmation,
    to: order.email,
    kind: "order_confirmation",
    dedupeKey: `order-paid:${order.id}`,
  });

  let note: string | undefined;
  if (lateRecovery) {
    note =
      short.length > 0
        ? `This customer paid after the order's hold had expired, and we were short on stock for: ${short.join(", ")}. Please either fulfil it or refund it from the order page.`
        : "This customer paid after the order's hold had expired. The items were still in stock, so the order has been restored.";
    await addOrderEvent(tx, order.id, "late_payment", note, "system");
  }
  const alert = newOrderAlertEmail(shop, view, adminLink(order.id), note);
  await queueEmail(tx, {
    ...alert,
    to: shop.contactEmail,
    kind: "order_alert",
    dedupeKey: `order-alert:${order.id}`,
  });
  return "processed";
}

async function onExpired(
  tx: Executor,
  providerName: string,
  event: Extract<PaymentEvent, { kind: "expired" }>,
): Promise<HandleOutcome> {
  if (!isUuid(event.orderId)) return "ignored";
  const [order] = await tx.select().from(orders).where(eq(orders.id, event.orderId));
  if (!order || (order.providerSessionId && order.providerSessionId !== event.sessionId)) {
    return "ignored";
  }
  await cancelPendingInTx(tx, order.id, "The payment page expired unpaid", providerName);
  return "processed";
}

async function onFailed(
  tx: Executor,
  providerName: string,
  event: Extract<PaymentEvent, { kind: "failed" }>,
): Promise<HandleOutcome> {
  if (!isUuid(event.orderId)) return "ignored";
  const [order] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.id, event.orderId));
  if (!order) return "ignored";
  await addOrderEvent(tx, order.id, "payment_failed", event.reason, providerName);
  return "processed";
}

async function onRefunded(
  tx: Executor,
  providerName: string,
  event: Extract<PaymentEvent, { kind: "refunded" }>,
  shop: Shop,
): Promise<HandleOutcome> {
  const [order] = await tx
    .select()
    .from(orders)
    .where(eq(orders.providerPaymentId, event.paymentId))
    .for("update");
  if (!order) return "ignored";

  if (!event.fullyRefunded) {
    await addOrderEvent(
      tx,
      order.id,
      "partial_refund",
      `${formatCents(event.amountRefundedCents, order.currency)} was refunded in the payment dashboard (the order stays as it is)`,
      providerName,
    );
    return "processed";
  }
  if (!PAID_STATUSES.includes(order.status)) return "ignored";
  await applyRefund(tx, order, {
    // Before it shipped the goods are still here, so they go back on sale.
    restock: order.status === "paid",
    actor: providerName,
    summary: "Fully refunded in the payment dashboard",
    shop,
  });
  return "processed";
}

// ---------------------------------------------------------------------------------------------
// Refunds

// Moves a paid order to "refunded" inside the caller's transaction. The order must already be
// locked by the caller.
async function applyRefund(
  tx: Executor,
  order: typeof orders.$inferSelect,
  opts: { restock: boolean; actor: string; summary: string; shop: Shop },
) {
  const moved = await tx
    .update(orders)
    .set({ status: "refunded", refundedAt: sql`now()`, expiresAt: null, updatedAt: sql`now()` })
    .where(and(eq(orders.id, order.id), eq(orders.status, order.status)))
    .returning({ id: orders.id });
  if (moved.length === 0) return false;
  if (opts.restock) await releaseStock(tx, order.id);
  await addOrderEvent(
    tx,
    order.id,
    "refunded",
    `${opts.summary}${opts.restock ? "; items returned to stock" : ""}`,
    opts.actor,
  );
  const view = await customerView(tx, order.id);
  const mail = orderRefundedEmail(
    opts.shop,
    view,
    orderLink({ id: order.id, token: order.accessToken }),
  );
  await queueEmail(tx, {
    ...mail,
    to: order.email,
    kind: "order_refunded",
    dedupeKey: `order-refunded:${order.id}`,
  });
  return true;
}

export type RefundResult =
  | { ok: true }
  | {
      ok: false;
      code: "NOT_FOUND" | "NOT_REFUNDABLE" | "PAYMENTS_NOT_CONFIGURED" | "PROVIDER_ERROR";
      message: string;
    };

// Refunds the whole order. The money moves first (with a key derived from the order, so a retry
// can never refund twice), then the order is updated; if the update is interrupted, the
// provider's own refund event finishes the job.
export async function refundOrder(
  actor: Actor,
  orderId: string,
  options: { restock: boolean },
  db: Db = getDb(),
  provider: PaymentProvider | null = getPaymentProvider(),
): Promise<RefundResult> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return { ok: false, code: "NOT_FOUND", message: "That order no longer exists." };
  if (order.status === "refunded") return { ok: true };
  if (!PAID_STATUSES.includes(order.status) || !order.providerPaymentId) {
    return {
      ok: false,
      code: "NOT_REFUNDABLE",
      message: "Only paid orders can be refunded.",
    };
  }
  if (!provider || provider.name !== order.paymentProvider) {
    return {
      ok: false,
      code: "PAYMENTS_NOT_CONFIGURED",
      message:
        "The payment provider this order was paid with is not connected, so it cannot be refunded here.",
    };
  }

  try {
    await provider.refund({
      paymentId: order.providerPaymentId,
      amountCents: order.totalCents,
      idempotencyKey: `refund-${order.id}`,
      orderId: order.id,
    });
  } catch (error) {
    log("error", "refund failed at the payment provider", {
      orderId: order.id,
      ...errorFields(error),
    });
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message:
        "The payment provider could not process the refund. Nothing was changed — please try again.",
    };
  }

  const shop = await getSettings(db);
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
    // The provider's refund event may already have updated the order.
    if (!locked || !PAID_STATUSES.includes(locked.status)) return;
    await applyRefund(tx, locked, {
      restock: options.restock,
      actor: actor.email,
      summary: `Refunded ${formatCents(locked.totalCents, locked.currency)} to the customer`,
      shop,
    });
    await recordAudit(
      tx,
      actor,
      "order_refunded",
      "order",
      order.id,
      `Refunded order ${formatOrderNumber(order.number)} (${formatCents(order.totalCents, order.currency)})`,
    );
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// The test payment page (only when PAYMENTS_PROVIDER=mock)

export type MockSession = {
  number: number;
  totalCents: number;
  currency: string;
  email: string;
  status: string;
  lines: Array<{ title: string; quantity: number; lineTotalCents: number }>;
};

export async function getMockSession(
  sessionId: string,
  db: Db = getDb(),
): Promise<MockSession | null> {
  if (getPaymentProvider()?.name !== "mock") return null;
  const [order] = await db.select().from(orders).where(eq(orders.providerSessionId, sessionId));
  if (!order) return null;
  const view = await loadCustomerOrder(db, order.id);
  if (!view) return null;
  return {
    number: view.number,
    totalCents: view.totalCents,
    currency: view.currency,
    email: view.email,
    status: view.status,
    lines: view.lines.map((l) => ({
      title: l.variantTitle ? `${l.productTitle} — ${l.variantTitle}` : l.productTitle,
      quantity: l.quantity,
      lineTotalCents: l.lineTotalCents,
    })),
  };
}

export async function completeMockPayment(
  sessionId: string,
  outcome: "paid" | "failed" | "cancel",
  db: Db = getDb(),
): Promise<{ ok: true; redirect: string } | { ok: false }> {
  if (getPaymentProvider()?.name !== "mock") return { ok: false };
  const [order] = await db.select().from(orders).where(eq(orders.providerSessionId, sessionId));
  if (!order) return { ok: false };

  const orderUrl = `/orders/${order.id}?t=${order.accessToken}&placed=1`;
  if (outcome === "cancel") {
    await cancelCheckoutByToken(order.id, order.accessToken, db);
    return { ok: true, redirect: `/checkout?cancelled=1` };
  }
  if (outcome === "failed") {
    await handlePaymentEvent(
      "mock",
      {
        kind: "failed",
        eventId: `mock_evt_${randomUUID()}`,
        type: "mock.payment_failed",
        orderId: order.id,
        sessionId,
        reason: "The test card was declined.",
      },
      db,
    );
    return { ok: true, redirect: `/checkout?cancelled=1&declined=1` };
  }
  await handlePaymentEvent(
    "mock",
    {
      kind: "paid",
      eventId: `mock_evt_${randomUUID()}`,
      type: "mock.payment_succeeded",
      orderId: order.id,
      sessionId,
      paymentId: `mock_pi_${randomBytes(8).toString("hex")}`,
      amountCents: order.totalCents,
      currency: order.currency,
    },
    db,
  );
  return { ok: true, redirect: orderUrl };
}
