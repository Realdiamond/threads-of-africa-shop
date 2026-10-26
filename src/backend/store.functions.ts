import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { CartResult } from "@/lib/cart-types";

import { addToCart, createCart, getCart, removeCartLine, updateCartLine } from "./cart.server";
import { fetchActiveProducts } from "./catalog.server";
import { startCheckout, type CheckoutResult } from "./checkout.server";
import { errorFields, log } from "./log.server";
import { tooManyRequests } from "./rate-limit.server";

const id = z.string().uuid();
const quantity = z.number().int().min(1).max(99);

const TEN_MINUTES = 10 * 60 * 1000;
const RATE_LIMIT_MESSAGE = "Too many requests. Please wait a moment and try again.";

// Creating carts and starting checkouts are the expensive writes, so they get tight limits;
// ordinary bag edits get a generous one that a real shopper will never reach.
const limits = {
  createCart: { scope: "create-cart", limit: 30, windowMs: TEN_MINUTES },
  cart: { scope: "cart", limit: 600, windowMs: TEN_MINUTES },
  checkout: { scope: "checkout", limit: 30, windowMs: TEN_MINUTES },
} as const;

const cartRateLimited = (): CartResult => ({
  ok: false,
  code: "RATE_LIMITED",
  message: RATE_LIMIT_MESSAGE,
});

const hit = (rule: (typeof limits)[keyof typeof limits]) =>
  tooManyRequests(rule.scope, rule.limit, rule.windowMs);

// Unexpected failures are logged in full but only a generic message reaches the browser.
async function guarded<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    log("error", `${name} failed`, errorFields(error));
    throw new Error("Something went wrong. Please try again.");
  }
}

export const listProductsFn = createServerFn({ method: "GET" }).handler(() =>
  guarded("listProducts", () => fetchActiveProducts()),
);

export const createCartFn = createServerFn({ method: "POST" })
  .validator(z.object({ variantId: id, quantity }))
  .handler(({ data }) =>
    guarded("createCart", async () =>
      hit(limits.createCart) ? cartRateLimited() : createCart(data.variantId, data.quantity),
    ),
  );

export const addCartLineFn = createServerFn({ method: "POST" })
  .validator(z.object({ cartId: id, variantId: id, quantity }))
  .handler(({ data }) =>
    guarded("addCartLine", async () =>
      hit(limits.cart) ? cartRateLimited() : addToCart(data.cartId, data.variantId, data.quantity),
    ),
  );

export const updateCartLineFn = createServerFn({ method: "POST" })
  .validator(z.object({ cartId: id, lineId: id, quantity }))
  .handler(({ data }) =>
    guarded("updateCartLine", async () =>
      hit(limits.cart)
        ? cartRateLimited()
        : updateCartLine(data.cartId, data.lineId, data.quantity),
    ),
  );

export const removeCartLineFn = createServerFn({ method: "POST" })
  .validator(z.object({ cartId: id, lineId: id }))
  .handler(({ data }) =>
    guarded("removeCartLine", async () =>
      hit(limits.cart) ? cartRateLimited() : removeCartLine(data.cartId, data.lineId),
    ),
  );

// POST rather than GET so the cart id (a bearer credential) never appears in a URL or access log.
export const getCartFn = createServerFn({ method: "POST" })
  .validator(z.object({ cartId: id }))
  .handler(({ data }) =>
    guarded("getCart", async () => (hit(limits.cart) ? cartRateLimited() : getCart(data.cartId))),
  );

export const startCheckoutFn = createServerFn({ method: "POST" })
  .validator(z.object({ cartId: id }))
  .handler(({ data }) =>
    guarded("startCheckout", async (): Promise<CheckoutResult> =>
      hit(limits.checkout)
        ? { ok: false, code: "RATE_LIMITED", message: RATE_LIMIT_MESSAGE }
        : startCheckout(data.cartId),
    ),
  );
