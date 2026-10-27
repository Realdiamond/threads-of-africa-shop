import { and, asc, eq, gt, lt, sql } from "drizzle-orm";

import type { CartResult, CartView } from "@/lib/cart-types";

import { centsToAmount } from "./catalog.server";
import { getDb, type Db } from "./db/client.server";
import { cartLines, carts, products, variants } from "./db/schema";

// Business limit per line; the schema only enforces a looser sanity bound (1..99).
export const MAX_LINE_QUANTITY = 10;

type Executor = Pick<Db, "select" | "insert" | "update" | "delete">;

const maxQuantityFor = (stock: number) => Math.min(MAX_LINE_QUANTITY, stock);

const cartNotFound = (): CartResult => ({
  ok: false,
  code: "CART_NOT_FOUND",
  message: "Your bag has expired. Please add your items again.",
});

const lineNotFound = (): CartResult => ({
  ok: false,
  code: "LINE_NOT_FOUND",
  message: "That item is no longer in your bag.",
});

const variantNotFound = (): CartResult => ({
  ok: false,
  code: "VARIANT_NOT_FOUND",
  message: "This piece is no longer available.",
});

function overLimit(maxQuantity: number): CartResult {
  const message =
    maxQuantity === 0
      ? "This size is sold out."
      : maxQuantity >= MAX_LINE_QUANTITY
        ? `You can add up to ${MAX_LINE_QUANTITY} of an item.`
        : `Only ${maxQuantity} left in this size.`;
  return { ok: false, code: "OUT_OF_STOCK", message, available: maxQuantity };
}

// Extends the cart's expiry and row-locks it, which serialises concurrent changes to one cart.
async function lockOpenCart(tx: Executor, cartId: string) {
  const rows = await tx
    .update(carts)
    .set({ updatedAt: sql`now()`, expiresAt: sql`now() + interval '30 days'` })
    .where(and(eq(carts.id, cartId), eq(carts.status, "open"), gt(carts.expiresAt, sql`now()`)))
    .returning({ id: carts.id });
  return rows.length === 1;
}

async function findPurchasableVariant(tx: Executor, variantId: string) {
  const [row] = await tx
    .select({ id: variants.id, stock: variants.stock })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(and(eq(variants.id, variantId), eq(products.status, "active")));
  return row;
}

async function readCart(ex: Executor, cartId: string): Promise<CartView> {
  const rows = await ex
    .select({
      lineId: cartLines.id,
      variantId: cartLines.variantId,
      quantity: cartLines.quantity,
      priceCents: variants.priceCents,
      currency: variants.currency,
      stock: variants.stock,
      productStatus: products.status,
    })
    .from(cartLines)
    .innerJoin(variants, eq(variants.id, cartLines.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(cartLines.cartId, cartId))
    .orderBy(asc(cartLines.createdAt), asc(cartLines.id));

  const lines = rows.map((row) => ({
    lineId: row.lineId,
    variantId: row.variantId,
    quantity: row.quantity,
    price: { amount: centsToAmount(row.priceCents), currencyCode: row.currency },
    maxQuantity: row.productStatus === "active" ? maxQuantityFor(row.stock) : 0,
  }));
  return {
    cartId,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    lines,
  };
}

export async function getCart(cartId: string, db: Db = getDb()): Promise<CartResult> {
  const [cart] = await db
    .select({ id: carts.id })
    .from(carts)
    .where(and(eq(carts.id, cartId), eq(carts.status, "open"), gt(carts.expiresAt, sql`now()`)));
  if (!cart) return cartNotFound();
  return { ok: true, cart: await readCart(db, cartId) };
}

export async function createCart(
  variantId: string,
  quantity: number,
  db: Db = getDb(),
): Promise<CartResult> {
  return db.transaction(async (tx) => {
    const variant = await findPurchasableVariant(tx, variantId);
    if (!variant) return variantNotFound();
    const max = maxQuantityFor(variant.stock);
    if (quantity > max) return overLimit(max);

    const [cart] = await tx.insert(carts).values({}).returning({ id: carts.id });
    if (!cart) throw new Error("cart insert returned no row");
    await tx.insert(cartLines).values({ cartId: cart.id, variantId, quantity });
    return { ok: true, cart: await readCart(tx, cart.id) };
  });
}

export async function addToCart(
  cartId: string,
  variantId: string,
  quantity: number,
  db: Db = getDb(),
): Promise<CartResult> {
  return db.transaction(async (tx) => {
    if (!(await lockOpenCart(tx, cartId))) return cartNotFound();
    const variant = await findPurchasableVariant(tx, variantId);
    if (!variant) return variantNotFound();

    const [existing] = await tx
      .select({ quantity: cartLines.quantity })
      .from(cartLines)
      .where(and(eq(cartLines.cartId, cartId), eq(cartLines.variantId, variantId)));
    const wanted = (existing?.quantity ?? 0) + quantity;
    const max = maxQuantityFor(variant.stock);
    if (wanted > max) return overLimit(max);

    await tx
      .insert(cartLines)
      .values({ cartId, variantId, quantity: wanted })
      .onConflictDoUpdate({
        target: [cartLines.cartId, cartLines.variantId],
        set: { quantity: wanted, updatedAt: sql`now()` },
      });
    return { ok: true, cart: await readCart(tx, cartId) };
  });
}

export async function updateCartLine(
  cartId: string,
  lineId: string,
  quantity: number,
  db: Db = getDb(),
): Promise<CartResult> {
  return db.transaction(async (tx) => {
    if (!(await lockOpenCart(tx, cartId))) return cartNotFound();

    // Scoped to cartId so a line id from another cart can never be touched.
    const [line] = await tx
      .select({ variantId: cartLines.variantId })
      .from(cartLines)
      .where(and(eq(cartLines.id, lineId), eq(cartLines.cartId, cartId)));
    if (!line) return lineNotFound();

    const variant = await findPurchasableVariant(tx, line.variantId);
    if (!variant) return variantNotFound();
    const max = maxQuantityFor(variant.stock);
    if (quantity > max) return overLimit(max);

    await tx
      .update(cartLines)
      .set({ quantity, updatedAt: sql`now()` })
      .where(and(eq(cartLines.id, lineId), eq(cartLines.cartId, cartId)));
    return { ok: true, cart: await readCart(tx, cartId) };
  });
}

// Removing a line that is already gone succeeds, so a retried request is harmless.
export async function removeCartLine(
  cartId: string,
  lineId: string,
  db: Db = getDb(),
): Promise<CartResult> {
  return db.transaction(async (tx) => {
    if (!(await lockOpenCart(tx, cartId))) return cartNotFound();
    await tx.delete(cartLines).where(and(eq(cartLines.id, lineId), eq(cartLines.cartId, cartId)));
    return { ok: true, cart: await readCart(tx, cartId) };
  });
}

// For a scheduled maintenance job: expired carts are unreachable and only take up space.
export async function purgeExpiredCarts(db: Db = getDb()): Promise<number> {
  const deleted = await db
    .delete(carts)
    .where(lt(carts.expiresAt, sql`now()`))
    .returning({ id: carts.id });
  return deleted.length;
}
