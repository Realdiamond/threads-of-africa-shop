import { and, asc, eq, sql } from "drizzle-orm";

import { getDb, type Db } from "../db/client.server";
import { products, variants } from "../db/schema";
import { recentAudit, type AuditEntry } from "./audit.server";
import { LOW_STOCK_THRESHOLD } from "./product-admin.server";

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
};

export async function adminDashboard(db: Db = getDb()): Promise<AdminDashboard> {
  const [statusRows, outOfStockRows, lowStock, recent] = await Promise.all([
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
          sql`${variants.stock} between 1 and ${LOW_STOCK_THRESHOLD}`,
        ),
      )
      .orderBy(asc(variants.stock), asc(products.title))
      .limit(10),
    recentAudit(db, 10),
  ]);

  const counts = { active: 0, draft: 0, archived: 0 };
  for (const row of statusRows) counts[row.status] = row.total;
  return { counts, outOfStock: outOfStockRows[0]?.total ?? 0, lowStock, recent };
}
