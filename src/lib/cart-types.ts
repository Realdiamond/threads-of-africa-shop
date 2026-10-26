// Shapes shared by the cart server functions and the browser cart store.

export type CartLineView = {
  lineId: string;
  variantId: string;
  quantity: number;
  price: { amount: string; currencyCode: string };
  // Largest quantity currently purchasable for this line; 0 means unavailable.
  maxQuantity: number;
};

export type CartView = {
  cartId: string;
  totalQuantity: number;
  lines: CartLineView[];
};

export type CartErrorCode =
  "CART_NOT_FOUND" | "LINE_NOT_FOUND" | "VARIANT_NOT_FOUND" | "OUT_OF_STOCK" | "RATE_LIMITED";

export type CartResult =
  | { ok: true; cart: CartView }
  | { ok: false; code: CartErrorCode; message: string; available?: number };
