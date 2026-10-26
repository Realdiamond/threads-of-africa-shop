// Payments are not wired up yet: the Stripe account and keys are still to come from the client.
// Until the integration lands, checkout stays closed regardless of environment variables.
export function paymentsConfigured(): boolean {
  return false;
}
