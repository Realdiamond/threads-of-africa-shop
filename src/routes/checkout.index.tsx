import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { cancelCheckoutFn, getCheckoutSummaryFn, placeOrderFn } from "@/backend/orders.functions";
import { Button } from "@/components/ui/button";
import { checkCheckoutForm } from "@/lib/checkout-validation";
import { countryName } from "@/lib/countries";
import { formatCents, type CheckoutForm } from "@/lib/order-types";
import { formatTaxRate } from "@/lib/store-types";
import { searchFlag, searchText } from "@/lib/search-params";
import { useCartStore } from "@/stores/cart-store";

type Search = {
  cancelled?: true | undefined;
  declined?: true | undefined;
  o?: string | undefined;
  t?: string | undefined;
};

export const Route = createFileRoute("/checkout/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    cancelled: searchFlag(search["cancelled"]),
    declined: searchFlag(search["declined"]),
    o: searchText(search["o"]),
    t: searchText(search["t"]),
  }),
  head: () => ({
    meta: [{ title: "Checkout — The Threads of Africa" }, { name: "robots", content: "noindex" }],
  }),
  component: CheckoutPage,
});

const fieldClass =
  "w-full rounded-none border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-[invalid=true]:border-destructive";

const EMPTY_FORM: CheckoutForm = {
  email: "",
  name: "",
  phone: "",
  country: "",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postalCode: "",
};

function Field(props: {
  id: keyof CheckoutForm;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  autoComplete?: string;
  type?: string;
  maxLength?: number;
  hint?: string;
}) {
  const { id, label, value, onChange, error, autoComplete, type = "text", maxLength, hint } = props;
  return (
    <div className="space-y-1.5">
      <label htmlFor={`co-${id}`} className="text-sm">
        {label}
      </label>
      <input
        id={`co-${id}`}
        name={id}
        type={type}
        className={fieldClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `co-${id}-error` : hint ? `co-${id}-hint` : undefined}
      />
      {hint && !error && (
        <p id={`co-${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`co-${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "warn";
}) {
  return (
    <p
      role="status"
      className={`mb-6 border p-4 text-sm leading-6 ${tone === "warn" ? "border-destructive text-destructive" : "bg-secondary"}`}
    >
      {children}
    </p>
  );
}

function CheckoutPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const cartId = useCartStore((s) => s.cartId);
  const syncCart = useCartStore((s) => s.syncCart);
  const setBagOpen = useCartStore((s) => s.setBagOpen);

  // The bag is restored from the browser after the first render, so wait before judging it empty.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const [form, setForm] = useState<CheckoutForm>(EMPTY_FORM);
  const [rateId, setRateId] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof CheckoutForm, string>>>({});
  const [formError, setFormError] = useState("");
  const [placing, setPlacing] = useState(false);
  // One key per attempt: pressing Pay twice can only ever make one order.
  const attempt = useRef(crypto.randomUUID());

  const set = (field: keyof CheckoutForm) => (value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  // Coming back from the payment page via "back": release the items straight away, then tidy
  // the address bar so the private link is not left in it.
  useEffect(() => {
    if (search.o && search.t) {
      void cancelCheckoutFn({ data: { orderId: search.o, token: search.t } }).catch(() => {});
      void navigate({
        to: "/checkout",
        search: { cancelled: search.cancelled, declined: search.declined },
        replace: true,
      });
    }
  }, [search.o, search.t, search.cancelled, search.declined, navigate]);

  const summary = useQuery({
    queryKey: ["checkout-summary", cartId, form.country],
    queryFn: () =>
      getCheckoutSummaryFn({ data: { cartId: cartId!, country: form.country || null } }),
    enabled: ready && Boolean(cartId),
    gcTime: 0,
  });
  const data = summary.data;

  const options = useMemo(() => (data?.ok ? (data.shipping?.options ?? []) : []), [data]);
  useEffect(() => {
    // Keep the chosen delivery option if it still applies, otherwise pick the first.
    if (options.length > 0 && !options.some((o) => o.rateId === rateId)) {
      setRateId(options[0]!.rateId);
    }
    if (options.length === 0 && rateId) setRateId("");
  }, [options, rateId]);

  const chosen = options.find((o) => o.rateId === rateId);
  const totals = useMemo(() => {
    if (!data?.ok) return null;
    const shipping = chosen?.priceCents ?? 0;
    const tax = data.shipping?.taxCents ?? 0;
    return { items: data.itemsCents, shipping, tax, total: data.itemsCents + shipping + tax };
  }, [data, chosen]);

  const countries = useMemo(
    () =>
      data?.ok
        ? [...data.countries].sort((a, b) => countryName(a).localeCompare(countryName(b)))
        : [],
    [data],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");
    if (!cartId || !data?.ok) return;

    const problem = checkCheckoutForm(form);
    if (problem) {
      setErrors({ [problem.field]: problem.message });
      document.getElementById(`co-${problem.field}`)?.focus();
      return;
    }
    if (!chosen) {
      setFormError(
        form.country && data.shipping === null
          ? "Sorry, we don't deliver to that country yet."
          : "Choose a delivery option.",
      );
      return;
    }

    setPlacing(true);
    try {
      const result = await placeOrderFn({
        data: { cartId, rateId: chosen.rateId, idempotencyKey: attempt.current, form },
      });
      if (result.ok) {
        window.location.assign(result.url);
        return;
      }
      attempt.current = crypto.randomUUID();
      setFormError(result.message);
      if (result.code === "ITEMS_UNAVAILABLE") {
        await syncCart();
        void summary.refetch();
      }
    } catch {
      // No answer at all: keep the same key so a retry cannot create a second order.
      setFormError("We couldn't reach the shop. Check your connection and try again.");
    }
    setPlacing(false);
  }

  const header = (
    <header className="site-width py-10">
      <p className="eyebrow mb-4 text-muted-foreground">Secure checkout</p>
      <h1 className="page-title leading-tight">Checkout</h1>
    </header>
  );

  if (!ready || (cartId && summary.isLoading)) {
    return (
      <main>
        {header}
        <p className="site-width pb-20 text-sm text-muted-foreground" role="status">
          Loading your bag…
        </p>
      </main>
    );
  }

  const blocked = !cartId ? (
    <>
      <p className="text-sm leading-7">Your bag is empty.</p>
    </>
  ) : data && !data.ok ? (
    <>
      <p className="text-sm leading-7" role="alert">
        {data.message}
      </p>
    </>
  ) : null;

  if (blocked || !data?.ok) {
    return (
      <main>
        {header}
        <div className="site-width pb-24">
          {search.cancelled && <Notice>Payment was cancelled — nothing was charged.</Notice>}
          {blocked ?? <p className="text-sm">Something went wrong loading checkout.</p>}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild className="rounded-none">
              <Link to="/shop" search={{ category: "All" }}>
                Continue shopping
              </Link>
            </Button>
            {data && !data.ok && data.code === "ITEMS_UNAVAILABLE" && (
              <Button variant="outline" className="rounded-none" onClick={() => setBagOpen(true)}>
                Review your bag
              </Button>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main>
      {header}
      <div className="site-width grid gap-12 pb-24 lg:grid-cols-[minmax(0,1fr)_400px]">
        <form onSubmit={submit} noValidate className="space-y-10">
          {data.testMode && (
            <Notice tone="warn">
              TEST MODE — payments here are simulated and no real money is taken.
            </Notice>
          )}
          {search.cancelled && (
            <Notice>
              {search.declined
                ? "The payment was declined — nothing was charged. You can try again."
                : "Payment was cancelled — nothing was charged. Your items are still in your bag."}
            </Notice>
          )}

          <section className="space-y-4" aria-labelledby="co-contact">
            <h2 id="co-contact" className="font-display text-2xl">
              Contact
            </h2>
            <Field
              id="email"
              label="Email"
              type="email"
              value={form.email}
              onChange={set("email")}
              error={errors.email}
              autoComplete="email"
              maxLength={254}
              hint="We email your receipt and delivery updates here."
            />
          </section>

          <section className="space-y-4" aria-labelledby="co-delivery">
            <h2 id="co-delivery" className="font-display text-2xl">
              Delivery address
            </h2>
            <div className="space-y-1.5">
              <label htmlFor="co-country" className="text-sm">
                Country
              </label>
              <select
                id="co-country"
                name="country"
                className={fieldClass}
                value={form.country}
                onChange={(event) => set("country")(event.target.value)}
                autoComplete="country"
                aria-invalid={errors.country ? true : undefined}
              >
                <option value="">Choose a country…</option>
                {countries.map((code) => (
                  <option key={code} value={code}>
                    {countryName(code)}
                  </option>
                ))}
              </select>
              {errors.country && (
                <p role="alert" className="text-xs text-destructive">
                  {errors.country}
                </p>
              )}
            </div>
            <Field
              id="name"
              label="Full name"
              value={form.name}
              onChange={set("name")}
              error={errors.name}
              autoComplete="name"
              maxLength={100}
            />
            <Field
              id="line1"
              label="Address"
              value={form.line1}
              onChange={set("line1")}
              error={errors.line1}
              autoComplete="address-line1"
              maxLength={120}
            />
            <Field
              id="line2"
              label="Apartment, suite, etc. (optional)"
              value={form.line2}
              onChange={set("line2")}
              error={errors.line2}
              autoComplete="address-line2"
              maxLength={120}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                id="city"
                label="City"
                value={form.city}
                onChange={set("city")}
                error={errors.city}
                autoComplete="address-level2"
                maxLength={80}
              />
              <Field
                id="region"
                label="State / region"
                value={form.region}
                onChange={set("region")}
                error={errors.region}
                autoComplete="address-level1"
                maxLength={80}
              />
              <Field
                id="postalCode"
                label="Postal code"
                value={form.postalCode}
                onChange={set("postalCode")}
                error={errors.postalCode}
                autoComplete="postal-code"
                maxLength={20}
              />
            </div>
            <Field
              id="phone"
              label="Phone (optional)"
              type="tel"
              value={form.phone}
              onChange={set("phone")}
              error={errors.phone}
              autoComplete="tel"
              maxLength={30}
              hint="The courier may call if there is a problem delivering."
            />
          </section>

          <section className="space-y-4" aria-labelledby="co-shipping">
            <h2 id="co-shipping" className="font-display text-2xl">
              Delivery method
            </h2>
            {!form.country ? (
              <p className="text-sm text-muted-foreground">
                Choose a country to see delivery options.
              </p>
            ) : options.length === 0 ? (
              <p role="alert" className="text-sm text-destructive">
                Sorry, we don't deliver to {countryName(form.country)} yet.
              </p>
            ) : (
              <fieldset className="space-y-2">
                <legend className="sr-only">Delivery method</legend>
                {options.map((option) => (
                  <label
                    key={option.rateId}
                    className={`flex cursor-pointer items-center justify-between gap-4 border p-4 text-sm ${rateId === option.rateId ? "border-foreground" : ""}`}
                  >
                    <span className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="shipping"
                        className="mt-1"
                        checked={rateId === option.rateId}
                        onChange={() => setRateId(option.rateId)}
                      />
                      <span>
                        <span className="block">{option.name}</span>
                        {option.estimate && (
                          <span className="block text-xs text-muted-foreground">
                            {option.estimate}
                          </span>
                        )}
                      </span>
                    </span>
                    <span>
                      {option.priceCents === 0
                        ? "Free"
                        : formatCents(option.priceCents, data.currency)}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </section>

          {formError && (
            <p role="alert" className="border border-destructive p-4 text-sm text-destructive">
              {formError}
            </p>
          )}
          <div>
            <Button
              type="submit"
              size="lg"
              className="w-full rounded-none sm:w-auto"
              disabled={placing}
            >
              {placing
                ? "Taking you to payment…"
                : totals && chosen
                  ? `Continue to payment · ${formatCents(totals.total, data.currency)}`
                  : "Continue to payment"}
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">
              You'll enter your card on the next page. By continuing you agree to our{" "}
              <Link to="/terms" className="underline underline-offset-4">
                terms
              </Link>{" "}
              and{" "}
              <Link to="/returns" className="underline underline-offset-4">
                returns policy
              </Link>
              .
            </p>
          </div>
        </form>

        <aside
          className="h-fit space-y-5 border bg-secondary p-6 lg:sticky lg:top-6"
          aria-label="Order summary"
        >
          <h2 className="font-display text-2xl">Your order</h2>
          <ul className="space-y-4">
            {data.lines.map((line) => (
              <li key={line.lineId} className="flex gap-4 text-sm">
                {line.imageUrl && (
                  <img
                    src={line.imageUrl}
                    alt=""
                    width={56}
                    height={78}
                    className="h-[78px] w-14 object-cover"
                  />
                )}
                <div className="flex-1">
                  <p>{line.productTitle}</p>
                  {line.variantTitle && (
                    <p className="text-xs text-muted-foreground">{line.variantTitle}</p>
                  )}
                  <p className="text-xs text-muted-foreground">Qty {line.quantity}</p>
                </div>
                <p>{formatCents(line.lineTotalCents, data.currency)}</p>
              </li>
            ))}
          </ul>
          <dl className="space-y-2 border-t pt-4 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{formatCents(data.itemsCents, data.currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Delivery</dt>
              <dd>
                {chosen
                  ? chosen.priceCents === 0
                    ? "Free"
                    : formatCents(chosen.priceCents, data.currency)
                  : "—"}
              </dd>
            </div>
            {data.shipping && data.shipping.taxBps > 0 && (
              <div className="flex justify-between">
                <dt>Tax ({formatTaxRate(data.shipping.taxBps)})</dt>
                <dd>{formatCents(data.shipping.taxCents, data.currency)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t pt-3 text-base font-medium">
              <dt>Total</dt>
              <dd>{totals && chosen ? formatCents(totals.total, data.currency) : "—"}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}
