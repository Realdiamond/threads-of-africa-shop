import type { CartView } from "@/lib/cart-types";

import { getCart } from "./cart.server";
import { getDb, type Db } from "./db/client.server";
import { paymentsConfigured } from "./payments.server";

export type CheckoutErrorCode =
  | "CART_NOT_FOUND"
  | "CART_EMPTY"
  | "ITEMS_UNAVAILABLE"
  | "PAYMENTS_NOT_CONFIGURED"
  | "RATE_LIMITED";

export type CheckoutResult =
  { ok: true; url: string } | { ok: false; code: CheckoutErrorCode; message: string };

type Validation =
  | { ok: true; cart: CartView }
  | {
      ok: false;
      code: Exclude<CheckoutErrorCode, "PAYMENTS_NOT_CONFIGURED" | "RATE_LIMITED">;
      message: string;
    };

// Re-checks the bag against live stock; the browser's copy of the bag is never trusted.
export async function validateCartForCheckout(
  cartId: string,
  db: Db = getDb(),
): Promise<Validation> {
  const result = await getCart(cartId, db);
  if (!result.ok) {
    return {
      ok: false,
      code: "CART_NOT_FOUND",
      message: "Your bag has expired. Please add your items again.",
    };
  }
  const { cart } = result;
  if (cart.lines.length === 0) {
    return { ok: false, code: "CART_EMPTY", message: "Your bag is empty." };
  }
  if (cart.lines.some((line) => line.quantity > line.maxQuantity)) {
    return {
      ok: false,
      code: "ITEMS_UNAVAILABLE",
      message:
        "Some items are no longer available in the quantity you chose. Please review your bag.",
    };
  }
  return { ok: true, cart };
}

const checkoutClosed = (): CheckoutResult => ({
  ok: false,
  code: "PAYMENTS_NOT_CONFIGURED",
  message: "Checkout isn't open yet — we're getting ready to launch. Please check back soon.",
});

export async function startCheckout(cartId: string, db: Db = getDb()): Promise<CheckoutResult> {
  if (!paymentsConfigured()) return checkoutClosed();
  const validation = await validateCartForCheckout(cartId, db);
  if (!validation.ok) return validation;
  // Payment session creation arrives with the Stripe integration.
  return checkoutClosed();
}
