import Stripe from "stripe";

import { log } from "./log.server";
import { createMockProvider } from "./payments/mock.server";
import { createStripeProvider } from "./payments/stripe.server";
import type { PaymentProvider } from "./payments/types.server";

export type { PaymentEvent, PaymentProvider } from "./payments/types.server";
export { WebhookSignatureError } from "./payments/types.server";

type Env = Record<string, string | undefined>;

// Which payment provider the shop uses, decided purely by environment variables:
//   PAYMENTS_PROVIDER=mock                  a fake "pay" page for testing (development only,
//                                           or ALLOW_MOCK_PAYMENTS=true on a staging copy)
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

// The pretend provider takes real orders without real money, so it fails closed: it works only
// when the process says it is a development or test run, or when ALLOW_MOCK_PAYMENTS=true is set
// on purpose (for a staging copy). It is never allowed alongside a live Stripe key.
function mockAllowed(env: Env): boolean {
  if (env["STRIPE_SECRET_KEY"]?.includes("_live_")) return false;
  if (env["ALLOW_MOCK_PAYMENTS"] === "true") return true;
  const mode = env["NODE_ENV"];
  const deployed = Boolean(env["RAILWAY_ENVIRONMENT_NAME"] || env["RAILWAY_PUBLIC_DOMAIN"]);
  return (mode === "development" || mode === "test") && !deployed;
}

export function getPaymentProvider(env: Env = process.env): PaymentProvider | null {
  if (env["PAYMENTS_PROVIDER"] === "mock") {
    if (!mockAllowed(env)) {
      warnOnce(
        "PAYMENTS_PROVIDER=mock is ignored here (it only runs in development, or with ALLOW_MOCK_PAYMENTS=true, and never with a live Stripe key); checkout stays closed",
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
    // Events from the other mode (test events sent to a live shop, or the reverse) are ignored.
    cached = {
      key,
      provider: createStripeProvider(client, webhookSecret, secretKey.includes("_live_")),
    };
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
