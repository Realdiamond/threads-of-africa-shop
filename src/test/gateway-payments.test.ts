// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { getPaymentProvider, paymentMode, WebhookSignatureError } from "@/backend/payments.server";
import { createGatewayProvider, GatewayError } from "@/backend/payments/gateway.server";
import type { CheckoutSessionInput } from "@/backend/payments/types.server";

const SECRET = "shared-events-secret";
const NOW = 1_800_000_000_000;

// Signs the way the .NET gateway does: t=<seconds>,v1=hex(HMAC-SHA256("<t>.<body>")).
function signed(event: unknown, secret = SECRET, at = NOW / 1000) {
  const body = JSON.stringify(event);
  const v1 = createHmac("sha256", secret).update(`${at}.${body}`).digest("hex");
  return { body, header: `t=${at},v1=${v1}` };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function provider(fetchImpl: typeof fetch) {
  return createGatewayProvider(
    { baseUrl: "https://gateway.example/", apiKey: "key-123", eventsSecret: SECRET },
    fetchImpl,
    () => NOW,
  );
}

const input: CheckoutSessionInput = {
  orderId: "ord_1",
  number: 1001,
  email: "buyer@example.com",
  currency: "USD",
  lines: [
    { name: "Amara Dress — M", quantity: 2, unitPriceCents: 12000, imageUrl: "https://s/m/a" },
  ],
  shipping: { label: "Delivery", cents: 1500 },
  tax: { label: "VAT", cents: 0 },
  totalCents: 25500,
  successUrl: "https://shop.example/orders/ord_1",
  cancelUrl: "https://shop.example/checkout",
  expiresAt: new Date("2030-01-01T10:00:00Z"),
};

describe("gateway requests", () => {
  it("creates a checkout session with the API key and the order's own totals", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        json(200, { sessionId: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }),
      );
    const result = await provider(fetchMock as unknown as typeof fetch).createCheckoutSession(
      input,
    );
    expect(result).toEqual({ sessionId: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gateway.example/api/checkout-sessions");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer key-123");
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({
      orderId: "ord_1",
      totalCents: 25500,
      expiresAt: "2030-01-01T10:00:00.000Z",
      shipping: { label: "Delivery", cents: 1500 },
    });
    expect(sent.lines[0]).toEqual({
      name: "Amara Dress — M",
      quantity: 2,
      unitPriceCents: 12000,
      imageUrl: "https://s/m/a",
    });
  });

  it("refuses a checkout address that is not https, and errors without leaking the body", async () => {
    await expect(
      provider(
        vi.fn().mockResolvedValue(json(200, { sessionId: "cs_1", url: "http://evil" })) as never,
      ).createCheckoutSession(input),
    ).rejects.toThrow(/checkout address/);

    const failing = provider(
      vi.fn().mockResolvedValue(json(502, { detail: "buyer@example.com" })) as never,
    );
    const error = await failing.createCheckoutSession(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as Error).message).not.toContain("buyer@example.com");
  });

  it("expires sessions and refunds through the gateway", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { status: "not_open" }))
      .mockResolvedValueOnce(json(200, { refundId: "re_1", alreadyRefunded: false }))
      .mockResolvedValueOnce(json(200, { refundId: "", alreadyRefunded: true }));
    const p = provider(fetchMock as unknown as typeof fetch);
    expect(await p.expireSession("cs_1")).toBe("not_open");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://gateway.example/api/checkout-sessions/cs_1/expire",
    );
    const refund = { paymentId: "pi_1", amountCents: 500, idempotencyKey: "r-1", orderId: "ord_1" };
    expect(await p.refund(refund)).toEqual({ refundId: "re_1", alreadyRefunded: false });
    expect(await p.refund(refund)).toEqual({ refundId: "", alreadyRefunded: true });
    expect(JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual(
      refund,
    );
  });
});

describe("gateway events", () => {
  const p = provider(vi.fn() as never);
  const paid = {
    kind: "paid",
    eventId: "evt_1",
    type: "checkout.session.completed",
    orderId: "ord_1",
    sessionId: "cs_1",
    paymentId: "pi_1",
    amountCents: 25500,
    currency: "usd",
  };

  it("accepts a correctly signed delivery", () => {
    const { body, header } = signed(paid);
    expect(p.parseWebhook(body, header)).toEqual(paid);
  });

  it("maps every kind the gateway sends", () => {
    const events = [
      { kind: "expired", eventId: "e2", type: "t", orderId: "o", sessionId: "s" },
      {
        kind: "failed",
        eventId: "e3",
        type: "t",
        orderId: "o",
        sessionId: "s",
        reason: "declined",
      },
      {
        kind: "refunded",
        eventId: "e4",
        type: "t",
        paymentId: "pi",
        amountRefundedCents: 5,
        fullyRefunded: false,
      },
      {
        kind: "dispute",
        eventId: "e5",
        type: "t",
        paymentId: "pi",
        amountCents: 9,
        reason: "fraudulent",
      },
      { kind: "ignored", eventId: "e6", type: "t" },
    ];
    for (const event of events) {
      const { body, header } = signed(event);
      expect(p.parseWebhook(body, header)).toEqual(event);
    }
  });

  it("treats a paid event without a payment id as paid-with-null", () => {
    const { body, header } = signed({ ...paid, paymentId: undefined });
    expect(p.parseWebhook(body, header)).toMatchObject({ kind: "paid", paymentId: null });
  });

  it("refuses missing, forged, tampered, stale and malformed deliveries", () => {
    const good = signed(paid);
    expect(() => p.parseWebhook(good.body, null)).toThrow(WebhookSignatureError);
    expect(() => p.parseWebhook(good.body, "garbage")).toThrow(WebhookSignatureError);
    const forged = signed(paid, "someone-elses-secret");
    expect(() => p.parseWebhook(forged.body, forged.header)).toThrow(WebhookSignatureError);
    expect(() => p.parseWebhook(good.body.replace("25500", "1"), good.header)).toThrow(
      WebhookSignatureError,
    );
    const stale = signed(paid, SECRET, NOW / 1000 - 3600);
    expect(() => p.parseWebhook(stale.body, stale.header)).toThrow(WebhookSignatureError);
    // Correctly signed but not an event we understand.
    for (const junk of [{ kind: "paid" }, { kind: "bogus", eventId: "e", type: "t" }, [], "x"]) {
      const s = signed(junk);
      expect(() => p.parseWebhook(s.body, s.header)).toThrow(WebhookSignatureError);
    }
  });
});

describe("choosing the gateway", () => {
  const base = {
    PAYMENTS_GATEWAY_URL: "https://gateway.example",
    PAYMENTS_GATEWAY_API_KEY: "k",
    PAYMENTS_GATEWAY_EVENTS_SECRET: "s",
    PAYMENTS_GATEWAY_MODE: "test",
  };

  it("opens only with every setting, over a safe address", () => {
    expect(getPaymentProvider(base)).toMatchObject({ name: "stripe", viaGateway: true });
    expect(paymentMode(base)).toBe("stripe-test");
    expect(paymentMode({ ...base, PAYMENTS_GATEWAY_MODE: "live" })).toBe("stripe-live");

    expect(getPaymentProvider({ ...base, PAYMENTS_GATEWAY_API_KEY: "" })).toBeNull();
    expect(getPaymentProvider({ ...base, PAYMENTS_GATEWAY_EVENTS_SECRET: "" })).toBeNull();
    expect(getPaymentProvider({ ...base, PAYMENTS_GATEWAY_MODE: "" })).toBeNull();
    expect(getPaymentProvider({ ...base, PAYMENTS_GATEWAY_MODE: "prod" })).toBeNull();
    expect(
      getPaymentProvider({ ...base, PAYMENTS_GATEWAY_URL: "http://gateway.example" }),
    ).toBeNull();
    expect(getPaymentProvider({ ...base, PAYMENTS_GATEWAY_URL: "not a url" })).toBeNull();
    expect(
      getPaymentProvider({ ...base, PAYMENTS_GATEWAY_URL: "http://gateway.railway.internal:8080" }),
    ).not.toBeNull();
  });

  it("never lets the pretend provider run next to a live gateway", () => {
    const env = { ...base, PAYMENTS_PROVIDER: "mock", NODE_ENV: "development" };
    expect(getPaymentProvider(env)?.name).toBe("mock");
    expect(getPaymentProvider({ ...env, PAYMENTS_GATEWAY_MODE: "live" })).toBeNull();
  });
});
