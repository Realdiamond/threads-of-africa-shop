import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { OrderListRow } from "@/lib/order-types";

import { getDb, type Db } from "../db/client.server";
import { orders, products, variants } from "../db/schema";
import { getSettings } from "../settings.server";
import { recentAudit, type AuditEntry } from "./audit.server";

export type AdminDashboard = {
  counts: { active: number; draft: number; archived: number };
  outOfStock: number;
  lowStock: Array<{
    variantId: string;
    productId: string;
    productTitle: string;
    sku: string;
    stock: number;
  }>;
  recent: AuditEntry[];
  orders: {
    toShip: number;
    awaitingPayment: number;
    // Orders paid in the last 30 days and what they came to (in the shop's currency).
    last30Days: { count: number; cents: number; currency: string };
    latest: OrderListRow[];
  };
};

export async function adminDashboard(db: Db = getDb()): Promise<AdminDashboard> {
  const { lowStockThreshold } = await getSettings(db);
  const [statusRows, outOfStockRows, lowStock, recent, orderCounts, paidRecently, latest] =
    await Promise.all([
      db
        .select({ status: products.status, total: sql<number>`count(*)::int` })
        .from(products)
        .groupBy(products.status),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(variants)
        .innerJoin(products, eq(products.id, variants.productId))
        .where(and(eq(products.status, "active"), eq(variants.stock, 0))),
      db
        .select({
          variantId: variants.id,
          productId: products.id,
          productTitle: products.title,
          sku: variants.sku,
          stock: variants.stock,
        })
        .from(variants)
        .innerJoin(products, eq(products.id, variants.productId))
        .where(
          and(
            eq(products.status, "active"),
            sql`${variants.stock} between 1 and ${lowStockThreshold}`,
          ),
        )
        .orderBy(asc(variants.stock), asc(products.title))
        .limit(10),
      recentAudit(db, 10),
      db
        .select({ status: orders.status, total: sql<number>`count(*)::int` })
        .from(orders)
        .where(inArray(orders.status, ["paid", "pending_payment"]))
        .groupBy(orders.status),
      db
        .select({
          count: sql<number>`count(*)::int`,
          cents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
          currency: sql<string>`coalesce(max(${orders.currency}), 'USD')`,
        })
        .from(orders)
        .where(
          and(
            inArray(orders.status, ["paid", "shipped", "delivered"]),
            sql`${orders.paidAt} > now() - interval '30 days'`,
          ),
        ),
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
        .where(sql`${orders.status} <> 'pending_payment'`)
        .orderBy(desc(orders.createdAt))
        .limit(5),
    ]);

  const counts = { active: 0, draft: 0, archived: 0 };
  for (const row of statusRows) counts[row.status] = row.total;
  const byStatus = new Map(orderCounts.map((row) => [row.status, row.total]));
  return {
    counts,
    outOfStock: outOfStockRows[0]?.total ?? 0,
    lowStock,
    recent,
    orders: {
      toShip: byStatus.get("paid") ?? 0,
      awaitingPayment: byStatus.get("pending_payment") ?? 0,
      last30Days: paidRecently[0] ?? { count: 0, cents: 0, currency: "USD" },
      latest: latest.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    },
  };
}
