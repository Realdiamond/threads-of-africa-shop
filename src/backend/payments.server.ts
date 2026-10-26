import Stripe from "stripe";

import { log } from "./log.server";
import { createMockProvider } from "./payments/mock.server";
import { createStripeProvider } from "./payments/stripe.server";
import type { PaymentProvider } from "./payments/types.server";

export type { PaymentEvent, PaymentProvider } from "./payments/types.server";
export { WebhookSignatureError } from "./payments/types.server";

type Env = Record<string, string | undefined>;

// Which payment provider the shop uses, decided purely by environment variables:
//   PAYMENTS_PROVIDER=mock                  a fake "pay" page for testing (never in production
//                                           unless ALLOW_MOCK_PAYMENTS=true is also set)
//   STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET   real Stripe payments
// With neither, checkout stays closed. A Stripe key without its webhook secret also keeps checkout
// closed, because orders are only ever confirmed from the verified webhook; taking money we
// could never confirm would be worse than not opening.
let cached: { key: string; provider: PaymentProvider } | undefined;
const warned = new Set<string>();

function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  log("warn", message);
}

export function getPaymentProvider(env: Env = process.env): PaymentProvider | null {
  if (env["PAYMENTS_PROVIDER"] === "mock") {
    if (env["NODE_ENV"] === "production" && env["ALLOW_MOCK_PAYMENTS"] !== "true") {
      warnOnce(
        "PAYMENTS_PROVIDER=mock is ignored in production (set ALLOW_MOCK_PAYMENTS=true to force it)",
      );
      return null;
    }
    if (cached?.key !== "mock") cached = { key: "mock", provider: createMockProvider() };
    return cached.provider;
  }

  const secretKey = env["STRIPE_SECRET_KEY"]?.trim();
  if (!secretKey) return null;
  if (!/^(sk|rk)_(test|live)_/.test(secretKey)) {
    warnOnce("STRIPE_SECRET_KEY does not look like a Stripe secret key; checkout stays closed");
    return null;
  }
  const webhookSecret = env["STRIPE_WEBHOOK_SECRET"]?.trim();
  if (!webhookSecret) {
    warnOnce("STRIPE_WEBHOOK_SECRET is missing; checkout stays closed until it is set");
    return null;
  }

  const key = `stripe:${secretKey}:${webhookSecret}`;
  if (cached?.key !== key) {
    const client = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
    cached = { key, provider: createStripeProvider(client, webhookSecret) };
  }
  return cached.provider;
}

export const paymentsConfigured = (env: Env = process.env) => getPaymentProvider(env) !== null;

export type PaymentMode = "off" | "test-page" | "stripe-test" | "stripe-live";

// For the admin launch checklist: tells the owner whether real money is flowing.
export function paymentMode(env: Env = process.env): PaymentMode {
  const provider = getPaymentProvider(env);
  if (!provider) return "off";
  if (provider.name === "mock") return "test-page";
  return env["STRIPE_SECRET_KEY"]?.includes("_live_") ? "stripe-live" : "stripe-test";
}
