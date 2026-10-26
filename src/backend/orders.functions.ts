import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { CheckoutSummary, CustomerOrderView, PlaceOrderResult } from "@/lib/order-types";

import { getCustomerOrder } from "./customers/customer-orders.server";
import { currentCustomer } from "./customers/customer-session.server";
import { guarded } from "./guarded.server";
import { completeMockPayment, getMockSession, type MockSession } from "./order-payments.server";
import {
  cancelCheckoutByToken,
  checkoutSummary,
  getOrderByToken,
  placeOrder,
} from "./orders.server";
import { tooManyRequests } from "./rate-limit.server";

const TEN_MINUTES = 10 * 60 * 1000;
const RATE_LIMIT_MESSAGE = "Too many requests. Please wait a moment and try again.";

const id = z.string().uuid();
const token = z.string().min(16).max(100);
const text = (max: number) => z.string().max(max);

const form = z.object({
  email: text(254),
  name: text(100),
  phone: text(30),
  country: z.string().length(2),
  line1: text(120),
  line2: text(120),
  city: text(80),
  region: text(80),
  postalCode: text(20),
});

// What the checkout page shows for the bag and the chosen country. POST so the bag id (a bearer
// credential) never lands in a URL or an access log.
export const getCheckoutSummaryFn = createServerFn({ method: "POST" })
  .validator(z.object({ cartId: id, country: z.string().length(2).nullable() }))
  .handler(({ data }) =>
    guarded("getCheckoutSummary", async (): Promise<CheckoutSummary> => {
      if (tooManyRequests("checkout-summary", 120, TEN_MINUTES)) {
        return { ok: false, code: "CART_NOT_FOUND", message: RATE_LIMIT_MESSAGE };
      }
      return checkoutSummary(data.cartId, data.country);
    }),
  );

export const placeOrderFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      cartId: id,
      rateId: id,
      idempotencyKey: z.string().min(16).max(64),
      form,
    }),
  )
  .handler(({ data }) =>
    guarded("placeOrder", async (): Promise<PlaceOrderResult> => {
      if (tooManyRequests("place-order", 20, TEN_MINUTES)) {
        return { ok: false, code: "RATE_LIMITED", message: RATE_LIMIT_MESSAGE };
      }
      const customer = await currentCustomer();
      return placeOrder({ ...data, customerId: customer?.id ?? null });
    }),
  );

// A customer's own order, opened with the private link from their email or the payment return.
export const getOrderFn = createServerFn({ method: "POST" })
  .validator(z.object({ orderId: id, token: token.optional() }))
  .handler(({ data }) =>
    guarded("getOrder", async (): Promise<CustomerOrderView | null | "RATE_LIMITED"> => {
      if (tooManyRequests("order-lookup", 150, TEN_MINUTES)) return "RATE_LIMITED";
      if (data.token) return getOrderByToken(data.orderId, data.token);
      // No private link: a signed-in customer may still open their own orders.
      const customer = await currentCustomer();
      return customer ? getCustomerOrder(customer.id, data.orderId) : null;
    }),
  );

export const cancelCheckoutFn = createServerFn({ method: "POST" })
  .validator(z.object({ orderId: id, token }))
  .handler(({ data }) =>
    guarded("cancelCheckout", async () => {
      if (tooManyRequests("cancel-checkout", 20, TEN_MINUTES)) return false;
      return cancelCheckoutByToken(data.orderId, data.token);
    }),
  );

// The two functions below only work while the built-in test payment page is switched on.
export const getMockSessionFn = createServerFn({ method: "POST" })
  .validator(z.object({ sessionId: z.string().min(10).max(80) }))
  .handler(({ data }) =>
    guarded("getMockSession", async (): Promise<MockSession | null> => {
      if (tooManyRequests("mock-session", 60, TEN_MINUTES)) return null;
      return getMockSession(data.sessionId);
    }),
  );

export const completeMockPaymentFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sessionId: z.string().min(10).max(80),
      outcome: z.enum(["paid", "failed", "cancel"]),
    }),
  )
  .handler(({ data }) =>
    guarded("completeMockPayment", async () => {
      if (tooManyRequests("mock-pay", 30, TEN_MINUTES)) return { ok: false as const };
      return completeMockPayment(data.sessionId, data.outcome);
    }),
  );
