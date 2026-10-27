import { and, desc, eq, sql } from "drizzle-orm";

import type { CheckoutPrefill } from "@/lib/customer-types";
import type { CustomerOrderView, OrderListRow } from "@/lib/order-types";

import { getDb, type Db } from "../db/client.server";
import { orders } from "../db/schema";
import { isUuid, loadOrderLines, toCustomerView } from "../orders.server";
import type { CustomerPrincipal } from "./customer-auth.server";

// A signed-in customer's own orders, newest first. Unpaid attempts are left out: they are not
// orders yet, and showing them would only confuse.
export async function listCustomerOrders(
  customerId: string,
  db: Db = getDb(),
): Promise<OrderListRow[]> {
  const rows = await db
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
    .where(and(eq(orders.customerId, customerId), sql`${orders.status} <> 'pending_payment'`))
    .orderBy(desc(orders.createdAt))
    .limit(100);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

// One of the customer's own orders. Someone else's order id gives exactly the same answer as an id
// that does not exist.
export async function getCustomerOrder(
  customerId: string,
  orderId: string,
  db: Db = getDb(),
): Promise<CustomerOrderView | null> {
  if (!isUuid(orderId)) return null;
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.customerId, customerId)));
  if (!order) return null;
  return toCustomerView(order, await loadOrderLines(db, order.id));
}

// Saved details for the checkout form: the account's email and name, and the address from the
// most recent order.
export async function checkoutPrefill(
  customer: CustomerPrincipal,
  db: Db = getDb(),
): Promise<CheckoutPrefill> {
  const [last] = await db
    .select()
    .from(orders)
    .where(eq(orders.customerId, customer.id))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  return {
    email: customer.email,
    name: last?.shipName ?? customer.name,
    phone: last?.shipPhone ?? "",
    country: last?.shipCountry ?? "",
    line1: last?.shipLine1 ?? "",
    line2: last?.shipLine2 ?? "",
    city: last?.shipCity ?? "",
    region: last?.shipRegion ?? "",
    postalCode: last?.shipPostalCode ?? "",
  };
}
