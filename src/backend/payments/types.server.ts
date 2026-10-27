// What the shop needs from a payment provider. Stripe is the real one; a mock exists so the whole
// purchase flow can be tested without keys. Orders never depend on anything Stripe-specific.

export type CheckoutSessionInput = {
  orderId: string;
  number: number;
  email: string;
  currency: string;
  lines: Array<{ name: string; quantity: number; unitPriceCents: number; imageUrl: string }>;
  shipping: { label: string; cents: number };
  tax: { label: string; cents: number };
  totalCents: number;
  successUrl: string;
  cancelUrl: string;
  // Fixed when the order is created, so retrying the same order asks for the same thing.
  expiresAt: Date;
};

export type PaymentEvent =
  | {
      kind: "paid";
      eventId: string;
      type: string;
      orderId: string;
      sessionId: string;
      paymentId: string | null;
      amountCents: number;
      currency: string;
    }
  | { kind: "expired"; eventId: string; type: string; orderId: string; sessionId: string }
  | {
      kind: "failed";
      eventId: string;
      type: string;
      orderId: string;
      sessionId: string;
      reason: string;
    }
  | {
      kind: "refunded";
      eventId: string;
      type: string;
      paymentId: string;
      amountRefundedCents: number;
      fullyRefunded: boolean;
    }
  // A customer disputed the charge with their bank (a chargeback).
  | {
      kind: "dispute";
      eventId: string;
      type: string;
      paymentId: string;
      amountCents: number;
      reason: string;
    }
  // Valid events we have no use for (other products on the same account, unrelated updates).
  | { kind: "ignored"; eventId: string; type: string };

export class WebhookSignatureError extends Error {
  constructor() {
    super("webhook signature could not be verified");
  }
}

export type PaymentProvider = {
  name: "stripe" | "mock";
  createCheckoutSession(input: CheckoutSessionInput): Promise<{ sessionId: string; url: string }>;
  // "not_open" means the session already ended or was paid; the caller must wait for its event.
  expireSession(sessionId: string): Promise<"expired" | "not_open">;
  // Repeating a refund with the same key must not refund twice.
  refund(input: {
    paymentId: string;
    amountCents: number;
    idempotencyKey: string;
    orderId: string;
  }): Promise<{ refundId: string; alreadyRefunded: boolean }>;
  // Verifies the signature and turns the provider's event into ours. Throws WebhookSignatureError
  // for anything that is not authentic.
  parseWebhook(rawBody: string, signature: string | null): PaymentEvent;
};
