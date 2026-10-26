// Shapes and rules for orders, shared by the checkout, order pages and admin screens.
// Browser-safe: nothing in here touches the database or a secret.

export type OrderStatus =
  "pending_payment" | "paid" | "shipped" | "delivered" | "cancelled" | "refunded";

export const ORDER_STATUSES: OrderStatus[] = [
  "pending_payment",
  "paid",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid — to ship",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

// Where an order may go next. Every change in the database is guarded by this table, so a
// repeated or out-of-order payment event can never move an order somewhere it should not be.
// "cancelled → paid" exists for one case only: a customer paid just after their hold expired.
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["paid", "cancelled"],
  paid: ["shipped", "refunded"],
  shipped: ["delivered", "refunded"],
  delivered: ["refunded"],
  cancelled: ["paid"],
  refunded: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus) =>
  ORDER_TRANSITIONS[from].includes(to);

// Statuses in which the customer has paid and the shop owes them the goods or their money back.
export const PAID_STATUSES: readonly OrderStatus[] = ["paid", "shipped", "delivered"];

export const formatOrderNumber = (number: number) => `TOA-${number}`;

export type OrderAddress = {
  name: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string;
};

export type OrderLineView = {
  id: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  imageUrl: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
};

export type OrderTotals = {
  currency: string;
  itemsCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  taxBps: number;
  shippingMethod: string;
};

export type OrderEventView = {
  id: string;
  kind: string;
  summary: string;
  actor: string;
  createdAt: string;
};

// What a customer sees about their own order: never the internal notes or timeline.
export type CustomerOrderView = OrderTotals & {
  id: string;
  number: number;
  status: OrderStatus;
  email: string;
  address: OrderAddress;
  lines: OrderLineView[];
  trackingCarrier: string;
  trackingNumber: string;
  createdAt: string;
  paidAt: string | null;
  shippedAt: string | null;
  // True when the order already belongs to a customer account.
  accountLinked: boolean;
};

// What the shop team sees: everything.
export type AdminOrderView = CustomerOrderView & {
  notes: string;
  paymentProvider: string;
  providerPaymentId: string | null;
  providerSessionId: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  expiresAt: string | null;
  shippingZone: string;
  events: OrderEventView[];
};

export type OrderListRow = {
  id: string;
  number: number;
  status: OrderStatus;
  email: string;
  name: string;
  country: string;
  totalCents: number;
  currency: string;
  itemCount: number;
  createdAt: string;
};

export type OrderListResult = {
  rows: OrderListRow[];
  total: number;
  page: number;
  pageSize: number;
};

// The checkout form, as the browser sends it. The server re-validates every field.
export type CheckoutForm = {
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

export type CheckoutSummaryLine = {
  lineId: string;
  productTitle: string;
  variantTitle: string;
  imageUrl: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
};

export type CheckoutShippingOption = {
  rateId: string;
  name: string;
  priceCents: number;
  estimate: string;
};

export type CheckoutSummary =
  | {
      ok: true;
      // True while payments go through the built-in test page instead of a real provider.
      testMode: boolean;
      currency: string;
      lines: CheckoutSummaryLine[];
      itemsCents: number;
      countries: string[];
      // Present once a country has been chosen.
      shipping: {
        zoneName: string;
        taxBps: number;
        taxCents: number;
        options: CheckoutShippingOption[];
      } | null;
    }
  | {
      ok: false;
      code: "CART_NOT_FOUND" | "CART_EMPTY" | "ITEMS_UNAVAILABLE" | "PAYMENTS_NOT_CONFIGURED";
      message: string;
    };

export type PlaceOrderFailureCode =
  | "CART_NOT_FOUND"
  | "CART_EMPTY"
  | "ITEMS_UNAVAILABLE"
  | "INVALID"
  | "NOT_SHIPPABLE"
  | "PAYMENTS_NOT_CONFIGURED"
  | "PAYMENT_UNAVAILABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMITED";

export type PlaceOrderResult =
  { ok: true; url: string } | { ok: false; code: PlaceOrderFailureCode; message: string };

export function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
