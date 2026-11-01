import { createFileRoute } from "@tanstack/react-router";

import { errorFields, log } from "@/backend/log.server";
import { handlePaymentEvent } from "@/backend/order-payments.server";
import { getPaymentProvider, WebhookSignatureError } from "@/backend/payments.server";

const MAX_BODY_BYTES = 1_000_000;

// Reads the body but stops as soon as it grows past the limit, even if the sender never said how
// big it would be. Returns null when it is too large.
async function readCapped(request: Request, limit: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// Where Stripe tells us a payment happened. This is the ONLY way an order becomes paid: the
// browser coming back from Stripe proves nothing. Anything without a valid signature is refused,
// and a failure on our side answers 500 so Stripe sends the event again.
export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provider = getPaymentProvider();
        if (!provider || provider.name !== "stripe")
          return new Response("Not found", { status: 404 });

        const body = await readCapped(request, MAX_BODY_BYTES);
        if (body === null) return new Response("Too large", { status: 413 });

        try {
          const event = provider.parseWebhook(body, request.headers.get("stripe-signature"));
          const outcome = await handlePaymentEvent(provider.name, event);
          if (outcome === "processed") {
            log("info", "payment event handled", { type: event.type, eventId: event.eventId });
          }
          return Response.json({ received: true });
        } catch (error) {
          if (error instanceof WebhookSignatureError) {
            log("warn", "payment webhook with a bad signature refused");
            return new Response("Invalid signature", { status: 400 });
          }
          log("error", "payment webhook failed", errorFields(error));
          return new Response("Temporary failure", { status: 500 });
        }
      },
    },
  },
});
