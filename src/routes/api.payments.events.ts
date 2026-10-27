import { createFileRoute } from "@tanstack/react-router";

import { errorFields, log } from "@/backend/log.server";
import { handlePaymentEvent } from "@/backend/order-payments.server";
import { getPaymentProvider, WebhookSignatureError } from "@/backend/payments.server";
import { readCapped } from "@/backend/read-capped.server";

const MAX_BODY_BYTES = 1_000_000;

// Where the payments gateway tells us a payment happened (it has already verified Stripe's
// signature, then signs its own delivery). Like the direct Stripe webhook this is the ONLY way an
// order becomes paid; an unsigned, stale or tampered delivery is refused, and a failure on our
// side answers 500 so the gateway (and Stripe behind it) sends the event again.
export const Route = createFileRoute("/api/payments/events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provider = getPaymentProvider();
        if (!provider || !provider.viaGateway) return new Response("Not found", { status: 404 });

        const body = await readCapped(request, MAX_BODY_BYTES);
        if (body === null) return new Response("Too large", { status: 413 });

        try {
          const event = provider.parseWebhook(body, request.headers.get("x-gateway-signature"));
          const outcome = await handlePaymentEvent(provider.name, event);
          if (outcome === "processed") {
            log("info", "payment event handled", { type: event.type, eventId: event.eventId });
          }
          return Response.json({ received: true });
        } catch (error) {
          if (error instanceof WebhookSignatureError) {
            log("warn", "gateway payment event with a bad signature refused");
            return new Response("Invalid signature", { status: 400 });
          }
          log("error", "gateway payment event failed", errorFields(error));
          return new Response("Temporary failure", { status: 500 });
        }
      },
    },
  },
});
