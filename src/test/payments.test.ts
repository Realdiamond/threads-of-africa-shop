// @vitest-environment node
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";

import { getPaymentProvider, paymentMode, WebhookSignatureError } from "@/backend/payments.server";
import { createStripeProvider, type StripeClient } from "@/backend/payments/stripe.server";
import type { CheckoutSessionInput } from "@/backend/payments/types.server";
import { canTransition, ORDER_STATUSES, ORDER_TRANSITIONS } from "@/lib/order-types";

const SECRET = "whsec_test_secret_for_unit_tests";
// The real SDK signs and verifies webhooks without any network access.
const real = new Stripe("sk_test_unit");

function fakeClient(overrides: Partial<StripeClient> = {}) {
  const create = vi
    .fn()
    .mockResolvedValue({ id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" });
  const expire = vi.fn().mockResolvedValue({});
  const refund = vi.fn().mockResolvedValue({ id: "re_123" });
  const client = {
    checkout: { sessions: { create, expire } },
    refunds: { create: refund },
    webhooks: real.webhooks,
    ...overrides,
  } as unknown as StripeClient;
  return { client, create, expire, refund };
}

const session = (over: Record<string, unknown> = {}) => ({
  id: "cs_test_123",
  object: "checkout.session",
  client_reference_id: "0192a6b2-0000-7000-8000-000000000001",
  metadata: { order_id: "0192a6b2-0000-7000-8000-000000000001" },
  payment_status: "paid",
  amount_total: 26800,
  currency: "usd",
  payment_intent: "pi_123",
  ...over,
});

function signed(type: string, object: unknown, secret = SECRET, id = "evt_1", livemode = false) {
  const payload = JSON.stringify({ id, object: "event", livemode, type, data: { object } });
  const header = real.webhooks.generateTestHeaderString({ payload, secret });
  return { payload, header };
}

describe("Stripe checkout sessions", () => {
  const input: CheckoutSessionInput = {
    orderId: "0192a6b2-0000-7000-8000-000000000001",
    number: 1001,
    email: "buyer@example.com",
    currency: "USD",
    lines: [
      {
        name: "Amara Dress — M",
        quantity: 2,
        unitPriceCents: 12000,
        imageUrl: "https://shop.example/media/a",
      },
      {
        name: "Kofi Shirt",
        quantity: 1,
        unitPriceCents: 4999,
        imageUrl: "http://localhost:8080/media/b",
      },
    ],
    shipping: { label: "Delivery — Standard", cents: 1000 },
    tax: { label: "Tax (7.50%)", cents: 1800 },
    totalCents: 31799,
    successUrl: "https://shop.example/orders/x?t=abc&placed=1",
    cancelUrl: "https://shop.example/checkout?cancelled=1",
    expiresAt: new Date("2030-01-01T00:31:00Z"),
  };

  it("sends exactly what the order says, and a key that makes retries safe", async () => {
    const { client, create } = fakeClient();
    const result = await createStripeProvider(client, SECRET, false).createCheckoutSession(input);
    expect(result).toEqual({
      sessionId: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });

    const [params, options] = create.mock.calls[0]!;
    expect(options).toEqual({ idempotencyKey: `order-${input.orderId}` });
    expect(params).toMatchObject({
      mode: "payment",
      client_reference_id: input.orderId,
      customer_email: "buyer@example.com",
      metadata: { order_id: input.orderId },
      payment_intent_data: { metadata: { order_id: input.orderId }, description: "Order TOA-1001" },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      expires_at: Math.floor(input.expiresAt.getTime() / 1000),
    });
    const items = params.line_items as Array<{
      quantity: number;
      price_data: {
        currency: string;
        unit_amount: number;
        product_data: { name: string; images?: string[] };
      };
    }>;
    expect(
      items.map((i) => [i.price_data.product_data.name, i.quantity, i.price_data.unit_amount]),
    ).toEqual([
      ["Amara Dress — M", 2, 12000],
      ["Kofi Shirt", 1, 4999],
      ["Delivery — Standard", 1, 1000],
      ["Tax (7.50%)", 1, 1800],
    ]);
    expect(items.every((i) => i.price_data.currency === "usd")).toBe(true);
    const total = items.reduce((sum, i) => sum + i.quantity * i.price_data.unit_amount, 0);
    expect(total).toBe(input.totalCents);
    // Only public https images are passed on; Stripe cannot fetch localhost.
    expect(items[0]!.price_data.product_data.images).toEqual(["https://shop.example/media/a"]);
    expect(items[1]!.price_data.product_data).not.toHaveProperty("images");
  });

  it("leaves out delivery and tax lines that cost nothing", async () => {
    const { client, create } = fakeClient();
    await createStripeProvider(client, SECRET, false).createCheckoutSession({
      ...input,
      shipping: { label: "Delivery — Free", cents: 0 },
      tax: { label: "Tax", cents: 0 },
    });
    expect(create.mock.calls[0]![0].line_items).toHaveLength(2);
  });

  it("fails loudly if Stripe returns no page to send the customer to", async () => {
    const { client, create } = fakeClient();
    create.mockResolvedValue({ id: "cs_1", url: null });
    await expect(
      createStripeProvider(client, SECRET, false).createCheckoutSession(input),
    ).rejects.toThrow(/address/);
  });

  it("treats a session that can no longer be closed as not open, but surfaces real errors", async () => {
    const { client, expire } = fakeClient();
    const provider = createStripeProvider(client, SECRET, false);
    expect(await provider.expireSession("cs_1")).toBe("expired");
    expire.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({
        message: "already complete",
        type: "invalid_request_error",
      }),
    );
    expect(await provider.expireSession("cs_1")).toBe("not_open");
    expire.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(provider.expireSession("cs_1")).rejects.toThrow("socket hang up");
  });

  it("refunds with an idempotency key and treats an earlier refund as done", async () => {
    const { client, refund } = fakeClient();
    const provider = createStripeProvider(client, SECRET, false);
    expect(
      await provider.refund({
        paymentId: "pi_1",
        amountCents: 500,
        idempotencyKey: "refund-1",
        orderId: "o1",
      }),
    ).toEqual({
      refundId: "re_123",
      alreadyRefunded: false,
    });
    expect(refund).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 500, metadata: { order_id: "o1" } },
      { idempotencyKey: "refund-1" },
    );
    refund.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({
        message: "already refunded",
        type: "invalid_request_error",
        code: "charge_already_refunded",
      }),
    );
    expect(
      await provider.refund({
        paymentId: "pi_1",
        amountCents: 500,
        idempotencyKey: "refund-1",
        orderId: "o1",
      }),
    ).toMatchObject({
      alreadyRefunded: true,
    });
    refund.mockRejectedValueOnce(new Error("boom"));
    await expect(
      provider.refund({
        paymentId: "pi_1",
        amountCents: 500,
        idempotencyKey: "refund-1",
        orderId: "o1",
      }),
    ).rejects.toThrow("boom");
  });
});

describe("Stripe webhooks", () => {
  const provider = createStripeProvider(fakeClient().client, SECRET, false);

  it("accepts a genuinely signed payment and reads the amount from it", () => {
    const { payload, header } = signed("checkout.session.completed", session());
    expect(provider.parseWebhook(payload, header)).toEqual({
      kind: "paid",
      eventId: "evt_1",
      type: "checkout.session.completed",
      orderId: "0192a6b2-0000-7000-8000-000000000001",
      sessionId: "cs_test_123",
      paymentId: "pi_123",
      amountCents: 26800,
      currency: "usd",
    });
  });

  it("refuses anything not signed with the shop's secret", () => {
    const { payload, header } = signed("checkout.session.completed", session());
    expect(() => provider.parseWebhook(payload, null)).toThrow(WebhookSignatureError);
    expect(() => provider.parseWebhook(payload, "garbage")).toThrow(WebhookSignatureError);
    const other = signed("checkout.session.completed", session(), "whsec_someone_elses_secret");
    expect(() => provider.parseWebhook(other.payload, other.header)).toThrow(WebhookSignatureError);
    // Changing the amount after signing breaks the signature.
    const tampered = payload.replace("26800", "1");
    expect(() => provider.parseWebhook(tampered, header)).toThrow(WebhookSignatureError);
  });

  it("refuses an old, replayed signature", () => {
    const payload = JSON.stringify({
      id: "evt_old",
      object: "event",
      livemode: false,
      type: "checkout.session.completed",
      data: { object: session() },
    });
    const header = real.webhooks.generateTestHeaderString({
      payload,
      secret: SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 60 * 60,
    });
    expect(() => provider.parseWebhook(payload, header)).toThrow(WebhookSignatureError);
  });

  it("waits for delayed payment methods instead of treating the order as paid", () => {
    const pending = signed("checkout.session.completed", session({ payment_status: "unpaid" }));
    expect(provider.parseWebhook(pending.payload, pending.header)).toMatchObject({
      kind: "ignored",
    });
    const later = signed("checkout.session.async_payment_succeeded", session(), SECRET, "evt_2");
    expect(provider.parseWebhook(later.payload, later.header)).toMatchObject({
      kind: "paid",
      eventId: "evt_2",
    });
    const failed = signed("checkout.session.async_payment_failed", session(), SECRET, "evt_3");
    expect(provider.parseWebhook(failed.payload, failed.header)).toMatchObject({ kind: "failed" });
  });

  it("understands expiry and refunds, and ignores everything else", () => {
    const expired = signed(
      "checkout.session.expired",
      session({ payment_status: "unpaid" }),
      SECRET,
      "evt_4",
    );
    expect(provider.parseWebhook(expired.payload, expired.header)).toMatchObject({
      kind: "expired",
      orderId: "0192a6b2-0000-7000-8000-000000000001",
    });

    const full = signed(
      "charge.refunded",
      {
        id: "ch_1",
        object: "charge",
        payment_intent: "pi_123",
        amount_refunded: 26800,
        refunded: true,
      },
      SECRET,
      "evt_5",
    );
    expect(provider.parseWebhook(full.payload, full.header)).toEqual({
      kind: "refunded",
      eventId: "evt_5",
      type: "charge.refunded",
      paymentId: "pi_123",
      amountRefundedCents: 26800,
      fullyRefunded: true,
    });
    const part = signed(
      "charge.refunded",
      {
        id: "ch_1",
        object: "charge",
        payment_intent: "pi_123",
        amount_refunded: 500,
        refunded: false,
      },
      SECRET,
      "evt_6",
    );
    expect(provider.parseWebhook(part.payload, part.header)).toMatchObject({
      fullyRefunded: false,
      amountRefundedCents: 500,
    });

    const unrelated = signed(
      "customer.created",
      { id: "cus_1", object: "customer" },
      SECRET,
      "evt_7",
    );
    expect(provider.parseWebhook(unrelated.payload, unrelated.header)).toMatchObject({
      kind: "ignored",
    });
  });

  it("ignores events from the other mode, so test payments never touch a live shop", () => {
    const live = createStripeProvider(fakeClient().client, SECRET, true);
    const testEvent = signed("checkout.session.completed", session());
    expect(live.parseWebhook(testEvent.payload, testEvent.header)).toMatchObject({
      kind: "ignored",
    });
    const liveEvent = signed("checkout.session.completed", session(), SECRET, "evt_live", true);
    expect(live.parseWebhook(liveEvent.payload, liveEvent.header)).toMatchObject({ kind: "paid" });
    // ...and a test shop ignores live events.
    expect(provider.parseWebhook(liveEvent.payload, liveEvent.header)).toMatchObject({
      kind: "ignored",
    });
  });

  it("reports a chargeback", () => {
    const event = signed(
      "charge.dispute.created",
      {
        id: "dp_1",
        object: "dispute",
        payment_intent: "pi_123",
        amount: 26800,
        reason: "fraudulent",
      },
      SECRET,
      "evt_dp",
    );
    expect(provider.parseWebhook(event.payload, event.header)).toEqual({
      kind: "dispute",
      eventId: "evt_dp",
      type: "charge.dispute.created",
      paymentId: "pi_123",
      amountCents: 26800,
      reason: "fraudulent",
    });
  });

  it("ignores payments that did not come from this shop's checkout", () => {
    const foreign = signed(
      "checkout.session.completed",
      session({ client_reference_id: null, metadata: {} }),
    );
    expect(provider.parseWebhook(foreign.payload, foreign.header)).toMatchObject({
      kind: "ignored",
    });
  });
});

describe("choosing the payment provider", () => {
  it("stays closed without both Stripe keys", () => {
    expect(getPaymentProvider({})).toBeNull();
    expect(getPaymentProvider({ STRIPE_SECRET_KEY: "sk_test_abc" })).toBeNull();
    expect(getPaymentProvider({ STRIPE_WEBHOOK_SECRET: "whsec_x" })).toBeNull();
    expect(
      getPaymentProvider({ STRIPE_SECRET_KEY: "not-a-key", STRIPE_WEBHOOK_SECRET: "whsec_x" }),
    ).toBeNull();
    expect(paymentMode({})).toBe("off");
  });

  it("opens with both keys, and says whether it is test or live", () => {
    const test = { STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: "whsec_x" };
    expect(getPaymentProvider(test)?.name).toBe("stripe");
    expect(paymentMode(test)).toBe("stripe-test");
    expect(
      paymentMode({ STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_WEBHOOK_SECRET: "whsec_x" }),
    ).toBe("stripe-live");
  });

  it("only allows the pretend provider in development, or when asked on purpose", () => {
    const mock = { PAYMENTS_PROVIDER: "mock" };
    expect(getPaymentProvider({ ...mock, NODE_ENV: "development" })?.name).toBe("mock");
    expect(getPaymentProvider({ ...mock, NODE_ENV: "test" })?.name).toBe("mock");
    expect(paymentMode({ ...mock, NODE_ENV: "development" })).toBe("test-page");
    // Unset or production NODE_ENV: closed, so a forgotten variable never gives away goods.
    expect(getPaymentProvider(mock)).toBeNull();
    expect(getPaymentProvider({ ...mock, NODE_ENV: "production" })).toBeNull();
    // Running on Railway counts as deployed even in development mode.
    expect(
      getPaymentProvider({
        ...mock,
        NODE_ENV: "development",
        RAILWAY_ENVIRONMENT_NAME: "production",
      }),
    ).toBeNull();
    expect(
      getPaymentProvider({ ...mock, NODE_ENV: "production", ALLOW_MOCK_PAYMENTS: "true" })?.name,
    ).toBe("mock");
  });

  it("never allows the pretend provider next to a live Stripe key", () => {
    expect(
      getPaymentProvider({
        PAYMENTS_PROVIDER: "mock",
        NODE_ENV: "development",
        ALLOW_MOCK_PAYMENTS: "true",
        STRIPE_SECRET_KEY: "sk_live_abc",
        STRIPE_WEBHOOK_SECRET: "whsec_x",
      }),
    ).toBeNull();
  });
});

describe("order status rules", () => {
  it("only allows the moves that make sense", () => {
    expect(canTransition("pending_payment", "paid")).toBe(true);
    expect(canTransition("paid", "shipped")).toBe(true);
    expect(canTransition("shipped", "delivered")).toBe(true);
    expect(canTransition("delivered", "refunded")).toBe(true);
    // Nothing un-ships, un-pays or un-refunds.
    expect(canTransition("shipped", "paid")).toBe(false);
    expect(canTransition("paid", "pending_payment")).toBe(false);
    expect(canTransition("refunded", "paid")).toBe(false);
    expect(canTransition("pending_payment", "shipped")).toBe(false);
    expect(canTransition("paid", "cancelled")).toBe(false);
    // A cancelled order can only come back through a late payment.
    expect(ORDER_TRANSITIONS.cancelled).toEqual(["paid"]);
    expect(ORDER_TRANSITIONS.refunded).toEqual([]);
  });

  it("covers every status and never loops back on itself", () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
    for (const status of ORDER_STATUSES) expect(canTransition(status, status)).toBe(false);
  });
});
