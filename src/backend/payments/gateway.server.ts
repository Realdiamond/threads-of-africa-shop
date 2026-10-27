import { createHmac, timingSafeEqual } from "node:crypto";

import { WebhookSignatureError, type PaymentEvent, type PaymentProvider } from "./types.server";

// The shop's payments can run through the separate ASP.NET "Stripe gateway" service (repo
// threads-of-africa-shop-stripe): it alone holds the Stripe keys, creates checkout pages and
// refunds, and delivers verified, signed events to /api/payments/events. To the rest of the shop
// it is still "stripe", so orders, event ids and refunds behave exactly as with a direct
// connection.

export type GatewayConfig = {
  baseUrl: string;
  apiKey: string;
  // Verifies events delivered by the gateway (HMAC-SHA256 over "<t>.<body>").
  eventsSecret: string;
};

const REQUEST_TIMEOUT_MS = 20_000;
// Deliveries older than this are refused, so a captured one cannot be replayed later.
const SIGNATURE_TOLERANCE_SECONDS = 300;

type FetchFn = typeof fetch;

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    // Never includes the response body: it can echo customer details.
    super(`payments gateway answered ${status} for ${path}`);
  }
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Checks the shape of a delivered event; anything malformed is treated as not authentic.
function toPaymentEvent(value: unknown): PaymentEvent {
  if (typeof value !== "object" || value === null) throw new WebhookSignatureError();
  const e = value as Record<string, unknown>;
  if (!isString(e["eventId"]) || !isString(e["type"])) throw new WebhookSignatureError();
  const base = { eventId: e["eventId"], type: e["type"] };

  switch (e["kind"]) {
    case "paid":
      if (!isString(e["orderId"]) || !isString(e["sessionId"]) || !isNumber(e["amountCents"]))
        throw new WebhookSignatureError();
      return {
        kind: "paid",
        ...base,
        orderId: e["orderId"],
        sessionId: e["sessionId"],
        paymentId: isString(e["paymentId"]) ? e["paymentId"] : null,
        amountCents: e["amountCents"],
        currency: typeof e["currency"] === "string" ? e["currency"] : "",
      };
    case "expired":
      if (!isString(e["orderId"]) || !isString(e["sessionId"])) throw new WebhookSignatureError();
      return { kind: "expired", ...base, orderId: e["orderId"], sessionId: e["sessionId"] };
    case "failed":
      if (!isString(e["orderId"]) || !isString(e["sessionId"])) throw new WebhookSignatureError();
      return {
        kind: "failed",
        ...base,
        orderId: e["orderId"],
        sessionId: e["sessionId"],
        reason: typeof e["reason"] === "string" ? e["reason"] : "The payment failed.",
      };
    case "refunded":
      if (
        !isString(e["paymentId"]) ||
        !isNumber(e["amountRefundedCents"]) ||
        typeof e["fullyRefunded"] !== "boolean"
      )
        throw new WebhookSignatureError();
      return {
        kind: "refunded",
        ...base,
        paymentId: e["paymentId"],
        amountRefundedCents: e["amountRefundedCents"],
        fullyRefunded: e["fullyRefunded"],
      };
    case "dispute":
      if (!isString(e["paymentId"]) || !isNumber(e["amountCents"]))
        throw new WebhookSignatureError();
      return {
        kind: "dispute",
        ...base,
        paymentId: e["paymentId"],
        amountCents: e["amountCents"],
        reason: typeof e["reason"] === "string" ? e["reason"] : "",
      };
    case "ignored":
      return { kind: "ignored", ...base };
    default:
      throw new WebhookSignatureError();
  }
}

export function createGatewayProvider(
  config: GatewayConfig,
  fetchImpl: FetchFn = fetch,
  now: () => number = () => Date.now(),
): PaymentProvider {
  const base = config.baseUrl.replace(/\/+$/, "");

  async function call<T>(path: string, body: unknown): Promise<T> {
    const response = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new GatewayError(response.status, path);
    return (await response.json()) as T;
  }

  return {
    name: "stripe",
    viaGateway: true,

    async createCheckoutSession(input) {
      const result = await call<{ sessionId?: string; url?: string }>("/api/checkout-sessions", {
        orderId: input.orderId,
        number: input.number,
        email: input.email,
        currency: input.currency,
        lines: input.lines,
        shipping: input.shipping,
        tax: input.tax,
        totalCents: input.totalCents,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        expiresAt: input.expiresAt.toISOString(),
      });
      // The customer is sent to this address, so it must be a secure web address.
      if (!result.sessionId || !result.url?.startsWith("https://"))
        throw new Error("The payments gateway did not return a checkout address");
      return { sessionId: result.sessionId, url: result.url };
    },

    async expireSession(sessionId) {
      const result = await call<{ status?: string }>(
        `/api/checkout-sessions/${encodeURIComponent(sessionId)}/expire`,
        {},
      );
      return result.status === "expired" ? "expired" : "not_open";
    },

    async refund({ paymentId, amountCents, idempotencyKey, orderId }) {
      const result = await call<{ refundId?: string; alreadyRefunded?: boolean }>("/api/refunds", {
        paymentId,
        amountCents,
        idempotencyKey,
        orderId,
      });
      return { refundId: result.refundId ?? "", alreadyRefunded: result.alreadyRefunded === true };
    },

    // Header: "t=<unix seconds>,v1=<hex HMAC-SHA256 of '<t>.<body>'>"
    parseWebhook(rawBody, signature): PaymentEvent {
      if (!signature) throw new WebhookSignatureError();
      const parts = new Map(
        signature.split(",").map((part) => {
          const i = part.indexOf("=");
          return [part.slice(0, i).trim(), part.slice(i + 1).trim()] as const;
        }),
      );
      const t = parts.get("t");
      const v1 = parts.get("v1");
      const seconds = Number(t);
      if (!t || !v1 || !Number.isInteger(seconds)) throw new WebhookSignatureError();
      if (Math.abs(now() / 1000 - seconds) > SIGNATURE_TOLERANCE_SECONDS)
        throw new WebhookSignatureError();
      const expected = createHmac("sha256", config.eventsSecret)
        .update(`${t}.${rawBody}`)
        .digest("hex");
      if (!safeEqualHex(expected, v1)) throw new WebhookSignatureError();
      try {
        return toPaymentEvent(JSON.parse(rawBody));
      } catch (error) {
        if (error instanceof WebhookSignatureError) throw error;
        throw new WebhookSignatureError();
      }
    },
  };
}
