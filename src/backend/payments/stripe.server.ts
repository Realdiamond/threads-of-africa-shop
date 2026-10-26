import Stripe from "stripe";

import { WebhookSignatureError, type PaymentEvent, type PaymentProvider } from "./types.server";

// Only the parts of the SDK we use, so tests can hand in a fake.
export type StripeClient = {
  checkout: {
    sessions: Pick<Stripe.Checkout.SessionResource, "create" | "expire">;
  };
  refunds: Pick<Stripe.RefundResource, "create">;
  webhooks: Pick<Stripe.Webhooks, "constructEvent">;
};

const paymentIntentId = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);

export function createStripeProvider(
  client: StripeClient,
  webhookSecret: string,
  livemode: boolean,
): PaymentProvider {
  return {
    name: "stripe",

    async createCheckoutSession(input) {
      const currency = input.currency.toLowerCase();
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = input.lines.map((line) => ({
        quantity: line.quantity,
        price_data: {
          currency,
          unit_amount: line.unitPriceCents,
          product_data: {
            name: line.name,
            // Stripe fetches these from the internet, so only public https addresses are sent.
            ...(line.imageUrl.startsWith("https://") ? { images: [line.imageUrl] } : {}),
          },
        },
      }));
      // Delivery and tax are charged as their own lines so the total Stripe collects is exactly
      // the total on our order.
      for (const extra of [input.shipping, input.tax]) {
        if (extra.cents > 0) {
          lineItems.push({
            quantity: 1,
            price_data: {
              currency,
              unit_amount: extra.cents,
              product_data: { name: extra.label },
            },
          });
        }
      }

      const session = await client.checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: input.orderId,
          customer_email: input.email,
          line_items: lineItems,
          metadata: { order_id: input.orderId },
          payment_intent_data: {
            description: `Order TOA-${input.number}`,
            metadata: { order_id: input.orderId },
          },
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          expires_at: Math.floor(input.expiresAt.getTime() / 1000),
        },
        // Retrying the same order returns the same checkout page instead of creating a second.
        { idempotencyKey: `order-${input.orderId}` },
      );
      if (!session.url) throw new Error("Stripe did not return a checkout address");
      return { sessionId: session.id, url: session.url };
    },

    async expireSession(sessionId) {
      try {
        await client.checkout.sessions.expire(sessionId);
        return "expired";
      } catch (error) {
        // A session that is already complete, expired or gone cannot be expired again.
        if (error instanceof Stripe.errors.StripeInvalidRequestError) return "not_open";
        throw error;
      }
    },

    async refund({ paymentId, amountCents, idempotencyKey, orderId }) {
      try {
        const refund = await client.refunds.create(
          { payment_intent: paymentId, amount: amountCents, metadata: { order_id: orderId } },
          { idempotencyKey },
        );
        return { refundId: refund.id, alreadyRefunded: false };
      } catch (error) {
        if (
          error instanceof Stripe.errors.StripeInvalidRequestError &&
          error.code === "charge_already_refunded"
        ) {
          return { refundId: "", alreadyRefunded: true };
        }
        throw error;
      }
    },

    parseWebhook(rawBody, signature): PaymentEvent {
      if (!signature) throw new WebhookSignatureError();
      let event: Stripe.Event;
      try {
        event = client.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch {
        throw new WebhookSignatureError();
      }
      const base = { eventId: event.id, type: event.type };
      // A test-mode event must never touch a live shop, nor a live event a test shop.
      if (event.livemode !== livemode) return { kind: "ignored", ...base };

      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded": {
          const session = event.data.object;
          const orderId = session.client_reference_id ?? session.metadata?.["order_id"];
          // Still waiting on a delayed payment method: the "succeeded" event will follow.
          if (!orderId || session.payment_status !== "paid") return { kind: "ignored", ...base };
          return {
            kind: "paid",
            ...base,
            orderId,
            sessionId: session.id,
            paymentId: paymentIntentId(session.payment_intent),
            amountCents: session.amount_total ?? -1,
            currency: session.currency ?? "",
          };
        }
        case "checkout.session.async_payment_failed": {
          const session = event.data.object;
          const orderId = session.client_reference_id ?? session.metadata?.["order_id"];
          if (!orderId) return { kind: "ignored", ...base };
          return {
            kind: "failed",
            ...base,
            orderId,
            sessionId: session.id,
            reason: "The bank declined the delayed payment.",
          };
        }
        case "checkout.session.expired": {
          const session = event.data.object;
          const orderId = session.client_reference_id ?? session.metadata?.["order_id"];
          if (!orderId) return { kind: "ignored", ...base };
          return { kind: "expired", ...base, orderId, sessionId: session.id };
        }
        case "charge.refunded": {
          const charge = event.data.object;
          const paymentId = paymentIntentId(charge.payment_intent);
          if (!paymentId) return { kind: "ignored", ...base };
          return {
            kind: "refunded",
            ...base,
            paymentId,
            amountRefundedCents: charge.amount_refunded,
            fullyRefunded: charge.refunded,
          };
        }
        case "charge.dispute.created": {
          const dispute = event.data.object;
          const paymentId = paymentIntentId(dispute.payment_intent);
          if (!paymentId) return { kind: "ignored", ...base };
          return {
            kind: "dispute",
            ...base,
            paymentId,
            amountCents: dispute.amount,
            reason: dispute.reason,
          };
        }
        default:
          return { kind: "ignored", ...base };
      }
    },
  };
}
