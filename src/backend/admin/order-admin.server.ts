import { randomUUID } from "node:crypto";

import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";

import {
  formatCents,
  formatOrderNumber,
  PAID_STATUSES,
  type AdminOrderView,
  type OrderListResult,
  type OrderStatus,
} from "@/lib/order-types";

import { csvLine } from "../csv.server";
import { getDb, type Db } from "../db/client.server";
import { orderEvents, orderLines, orders } from "../db/schema";
import { queueEmail } from "../email/outbox.server";
import { orderConfirmationEmail, orderShippedEmail } from "../email/order-templates.server";
import {
  addOrderEvent,
  isUuid,
  loadOrderLines,
  toAdminView,
  toCustomerView,
} from "../orders.server";
import { cancelUnpaidOrder } from "../orders.server";
import { getPaymentProvider, type PaymentProvider } from "../payments.server";
import { getSettings } from "../settings.server";
import { siteUrl } from "../site-url.server";
import { recordAudit, type Actor } from "./audit.server";

export const ORDERS_PAGE_SIZE = 25;

export type OrderActionResult =
  { ok: true } | { ok: false; code: "NOT_FOUND" | "INVALID_STATE" | "INVALID"; message: string };

const fail = (code: Extract<OrderActionResult, { ok: false }>["code"], message: string) =>
  ({ ok: false, code, message }) as const;

const escapeLike = (term: string) => term.replace(/[\\%_]/g, (c) => `\\${c}`);

function listWhere(filter: { status?: OrderStatus | undefined; search?: string | undefined }) {
  const conditions: Array<SQL | undefined> = [];
  if (filter.status) conditions.push(eq(orders.status, filter.status));
  const term = filter.search?.trim();
  if (term) {
    const number = /^(?:toa-?)?(\d{1,9})$/i.exec(term);
    const pattern = `%${escapeLike(term)}%`;
    conditions.push(
      or(
        number ? eq(orders.number, Number(number[1])) : undefined,
        ilike(orders.email, pattern),
        ilike(orders.shipName, pattern),
      ),
    );
  }
  return and(...conditions);
}

export async function listAdminOrders(
  filter: {
    status?: OrderStatus | undefined;
    search?: string | undefined;
    page?: number | undefined;
  },
  db: Db = getDb(),
): Promise<OrderListResult> {
  const where = listWhere(filter);
  const page = Math.max(1, Math.floor(filter.page ?? 1));
  const [rows, totals] = await Promise.all([
    db
      .select({
        id: orders.id,
        number: orders.number,
        status: orders.status,
        email: orders.email,
        name: orders.shipName,
        country: orders.shipCountry,
        totalCents: orders.totalCents,
        currency: orders.currency,
        createdAt: orders.createdAt,
        itemCount: sql<number>`(select coalesce(sum(l.quantity), 0)::int from order_lines l where l.order_id = "orders"."id")`,
      })
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt), desc(orders.number))
      .limit(ORDERS_PAGE_SIZE)
      .offset((page - 1) * ORDERS_PAGE_SIZE),
    db.select({ total: count() }).from(orders).where(where),
  ]);
  return {
    rows: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    total: totals[0]?.total ?? 0,
    page,
    pageSize: ORDERS_PAGE_SIZE,
  };
}

export async function getAdminOrder(
  orderId: string,
  db: Db = getDb(),
): Promise<AdminOrderView | null> {
  if (!isUuid(orderId)) return null;
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
  const [lines, events] = await Promise.all([
    loadOrderLines(db, orderId),
    db
      .select()
      .from(orderEvents)
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id)),
  ]);
  return toAdminView(
    order,
    lines,
    events.map((e) => ({
      id: e.id,
      kind: e.kind,
      summary: e.summary,
      actor: e.actor,
      createdAt: e.createdAt.toISOString(),
    })),
  );
}

const orderUrl = (order: { id: string; accessToken: string }) =>
  `${siteUrl()}/orders/${order.id}?t=${order.accessToken}`;

export type ShipInput = { carrier: string; trackingNumber: string; notify: boolean };

// Marks a paid order as shipped, or (if it is already shipped) corrects its tracking details.
export async function shipOrder(
  actor: Actor,
  orderId: string,
  input: ShipInput,
  db: Db = getDb(),
): Promise<OrderActionResult> {
  const carrier = input.carrier.trim();
  const trackingNumber = input.trackingNumber.trim();
  if (carrier.length > 60) return fail("INVALID", "The carrier name can be up to 60 characters.");
  if (trackingNumber.length > 100) {
    return fail("INVALID", "The tracking number can be up to 100 characters.");
  }
  const shop = await getSettings(db);

  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) return fail("NOT_FOUND", "That order no longer exists.");
    if (order.status !== "paid" && order.status !== "shipped") {
      return fail("INVALID_STATE", "Only paid orders can be marked as shipped.");
    }
    const firstTime = order.status === "paid";
    await tx
      .update(orders)
      .set({
        status: "shipped",
        shippedAt: sql`coalesce(${orders.shippedAt}, now())`,
        trackingCarrier: carrier,
        trackingNumber,
        updatedAt: sql`now()`,
      })
      .where(eq(orders.id, orderId));
    const detail = [carrier, trackingNumber].filter(Boolean).join(" ");
    await addOrderEvent(
      tx,
      orderId,
      firstTime ? "shipped" : "tracking_updated",
      `${firstTime ? "Marked as shipped" : "Tracking details changed"}${detail ? ` (${detail})` : ""}`,
      actor.email,
    );
    await recordAudit(
      tx,
      actor,
      firstTime ? "order_shipped" : "order_tracking_updated",
      "order",
      orderId,
      `${firstTime ? "Shipped" : "Updated tracking for"} order ${formatOrderNumber(order.number)}`,
    );
    if (input.notify) {
      const view = toCustomerView(
        { ...order, trackingCarrier: carrier, trackingNumber },
        await loadOrderLines(tx, orderId),
      );
      await queueEmail(tx, {
        ...orderShippedEmail(shop, view, orderUrl(order)),
        to: order.email,
        kind: "order_shipped",
        // Pressing the button twice sends one email; changed tracking sends a fresh one.
        dedupeKey: `order-shipped:${orderId}:${trackingNumber}`,
      });
    }
    return { ok: true } as const;
  });
}

export async function markOrderDelivered(
  actor: Actor,
  orderId: string,
  db: Db = getDb(),
): Promise<OrderActionResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) return fail("NOT_FOUND", "That order no longer exists.");
    if (order.status === "delivered") return { ok: true } as const;
    if (order.status !== "shipped") {
      return fail("INVALID_STATE", "Mark the order as shipped before marking it delivered.");
    }
    await tx
      .update(orders)
      .set({ status: "delivered", deliveredAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(orders.id, orderId));
    await addOrderEvent(tx, orderId, "delivered", "Marked as delivered", actor.email);
    await recordAudit(
      tx,
      actor,
      "order_delivered",
      "order",
      orderId,
      `Delivered order ${formatOrderNumber(order.number)}`,
    );
    return { ok: true } as const;
  });
}

// For an order the customer never paid for (abandoned at the payment page).
export async function cancelUnpaid(
  actor: Actor,
  orderId: string,
  db: Db = getDb(),
  provider: PaymentProvider | null = getPaymentProvider(),
): Promise<OrderActionResult> {
  const [order] = await db
    .select({ number: orders.number })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order) return fail("NOT_FOUND", "That order no longer exists.");
  const outcome = await cancelUnpaidOrder(
    orderId,
    "Cancelled by the shop team",
    actor.email,
    db,
    provider,
  );
  if (outcome === "payment_in_progress") {
    return fail(
      "INVALID_STATE",
      "The customer may be paying right now, so the order was left as it is. Try again in a few minutes.",
    );
  }
  if (outcome === "not_pending")
    return fail("INVALID_STATE", "Only orders waiting for payment can be cancelled.");
  await recordAudit(
    db,
    actor,
    "order_cancelled",
    "order",
    orderId,
    `Cancelled unpaid order ${formatOrderNumber(order.number)}`,
  );
  return { ok: true };
}

export async function setOrderNote(
  actor: Actor,
  orderId: string,
  notes: string,
  db: Db = getDb(),
): Promise<OrderActionResult> {
  if (notes.length > 2000) return fail("INVALID", "Notes can be up to 2,000 characters.");
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(orders)
      .set({ notes: notes.trim(), updatedAt: sql`now()` })
      .where(eq(orders.id, orderId))
      .returning({ id: orders.id });
    if (updated.length === 0) return fail("NOT_FOUND", "That order no longer exists.");
    await addOrderEvent(tx, orderId, "note", "Updated the internal note", actor.email);
    return { ok: true } as const;
  });
}

// Sends the customer their receipt again, e.g. when it went to spam or the address was mistyped.
export async function resendConfirmation(
  actor: Actor,
  orderId: string,
  db: Db = getDb(),
): Promise<OrderActionResult> {
  const shop = await getSettings(db);
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) return fail("NOT_FOUND", "That order no longer exists.");
    if (!PAID_STATUSES.includes(order.status) && order.status !== "refunded") {
      return fail("INVALID_STATE", "Only paid orders have a receipt to send.");
    }
    const view = toCustomerView(order, await loadOrderLines(tx, orderId));
    await queueEmail(tx, {
      ...orderConfirmationEmail(shop, view, orderUrl(order)),
      to: order.email,
      kind: "order_confirmation",
      dedupeKey: `order-paid-resend:${orderId}:${randomUUID()}`,
    });
    await addOrderEvent(
      tx,
      orderId,
      "email_resent",
      `Receipt sent again to ${order.email}`,
      actor.email,
    );
    return { ok: true } as const;
  });
}

export async function ordersCsv(
  filter: { status?: OrderStatus | undefined; search?: string | undefined },
  db: Db = getDb(),
): Promise<string> {
  const rows = await db
    .select()
    .from(orders)
    .where(listWhere(filter))
    .orderBy(desc(orders.createdAt), desc(orders.number))
    .limit(10_000);
  const lines = rows.length
    ? await db
        .select()
        .from(orderLines)
        .where(
          inArray(
            orderLines.orderId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(asc(orderLines.productTitle))
    : [];
  const itemsByOrder = new Map<string, string[]>();
  for (const line of lines) {
    const list = itemsByOrder.get(line.orderId) ?? [];
    list.push(
      `${line.quantity} x ${line.productTitle}${line.variantTitle ? ` (${line.variantTitle})` : ""}`,
    );
    itemsByOrder.set(line.orderId, list);
  }

  const header = csvLine([
    "order",
    "placed_at",
    "status",
    "email",
    "name",
    "phone",
    "address_1",
    "address_2",
    "city",
    "region",
    "postal_code",
    "country",
    "items",
    "items_total",
    "delivery",
    "tax",
    "total",
    "currency",
    "delivery_method",
    "carrier",
    "tracking_number",
    "payment_provider",
    "payment_id",
  ]);
  const body = rows.map((o) =>
    csvLine([
      formatOrderNumber(o.number),
      o.createdAt.toISOString(),
      o.status,
      o.email,
      o.shipName,
      o.shipPhone,
      o.shipLine1,
      o.shipLine2,
      o.shipCity,
      o.shipRegion,
      o.shipPostalCode,
      o.shipCountry,
      (itemsByOrder.get(o.id) ?? []).join("; "),
      formatCents(o.itemsCents, o.currency),
      formatCents(o.shippingCents, o.currency),
      formatCents(o.taxCents, o.currency),
      formatCents(o.totalCents, o.currency),
      o.currency,
      o.shippingMethod,
      o.trackingCarrier,
      o.trackingNumber,
      o.paymentProvider,
      o.providerPaymentId ?? "",
    ]),
  );
  return [header, ...body].join("\n") + "\n";
}
