import { randomBytes } from "node:crypto";

import type { PaymentProvider } from "./types.server";

// A pretend provider for testing the whole purchase without Stripe keys: "paying" happens on a
// clearly-labelled test page inside the shop. Selecting it takes PAYMENTS_PROVIDER=mock.
export function createMockProvider(): PaymentProvider {
  return {
    name: "mock",
    async createCheckoutSession() {
      const sessionId = `mock_${randomBytes(16).toString("hex")}`;
      return { sessionId, url: `/checkout/mock-pay?s=${sessionId}` };
    },
    async expireSession() {
      return "expired";
    },
    async refund() {
      return { refundId: `mock_refund_${randomBytes(8).toString("hex")}`, alreadyRefunded: false };
    },
    parseWebhook() {
      throw new Error("the test payment provider does not send webhooks");
    },
  };
}
