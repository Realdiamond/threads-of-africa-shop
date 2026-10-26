// Shapes shared by the account pages and the server functions behind them.

export type CustomerView = {
  id: string;
  email: string;
  name: string;
};

export type AuthFailureCode =
  | "INVALID"
  | "WEAK_PASSWORD"
  | "INVALID_TOKEN"
  | "WRONG_PASSWORD"
  | "SAME_PASSWORD"
  | "RATE_LIMITED";

export type AuthResult<T = unknown> =
  ({ ok: true } & T) | { ok: false; code: AuthFailureCode; message: string };

// What a signed-in customer's saved details fill in on the checkout form.
export type CheckoutPrefill = {
  email: string;
  name: string;
  phone: string;
  country: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
};
