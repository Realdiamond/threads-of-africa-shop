import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { getOrderFn } from "@/backend/orders.functions";
import { Button } from "@/components/ui/button";
import { countryName } from "@/lib/countries";
import { formatCents, formatOrderNumber, ORDER_STATUS_LABELS } from "@/lib/order-types";
import { formatTaxRate } from "@/lib/store-types";
import { searchFlag, searchText } from "@/lib/search-params";
import { useCartStore } from "@/stores/cart-store";

type Search = { t?: string | undefined; placed?: true | undefined };

export const Route = createFileRoute("/orders/$id")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    t: searchText(search["t"]),
    placed: searchFlag(search["placed"]),
  }),
  head: () => ({
    meta: [{ title: "Your order — The Threads of Africa" }, { name: "robots", content: "noindex" }],
  }),
  component: OrderPage,
});

// After paying, the confirmation from the payment provider can take a few seconds to reach us.
const POLL_MS = 2_000;
const POLL_FOR_MS = 90_000;

function OrderPage() {
  const { id } = Route.useParams();
  const { t, placed } = Route.useSearch();
  const clearCart = useCartStore((s) => s.clearCart);
  const openedAt = useRef(Date.now());

  const query = useQuery({
    queryKey: ["order", id],
    enabled: Boolean(t),
    gcTime: 0,
    queryFn: async () => {
      const result = await getOrderFn({ data: { orderId: id, token: t! } });
      if (result === "RATE_LIMITED") throw new Error("rate limited");
      return result;
    },
    refetchInterval: (q) =>
      q.state.data?.status === "pending_payment" && Date.now() - openedAt.current < POLL_FOR_MS
        ? POLL_MS
        : false,
  });
  const order = query.data;

  // Once the order is confirmed as paid, the bag it came from is gone.
  const paid = order && ["paid", "shipped", "delivered"].includes(order.status);
  useEffect(() => {
    if (paid && placed) clearCart();
  }, [paid, placed, clearCart]);

  const shell = (children: React.ReactNode) => (
    <main className="site-width max-w-3xl py-12 sm:py-16">{children}</main>
  );

  if (!t) {
    return shell(
      <>
        <h1 className="page-title">Order not found</h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">
          This link is incomplete. Please use the full link from your order email, or{" "}
          <Link to="/contact" className="underline underline-offset-4">
            contact us
          </Link>{" "}
          and we will help.
        </p>
      </>,
    );
  }
  if (query.isLoading)
    return shell(
      <p role="status" className="text-sm">
        Loading your order…
      </p>,
    );
  if (query.isError) {
    return shell(
      <p role="alert" className="text-sm">
        We couldn't load your order just now. Please refresh in a moment.
      </p>,
    );
  }
  if (!order) {
    return shell(
      <>
        <h1 className="page-title">Order not found</h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">
          We couldn't find that order. Check the link in your email, or{" "}
          <Link to="/contact" className="underline underline-offset-4">
            contact us
          </Link>
          .
        </p>
      </>,
    );
  }

  const number = formatOrderNumber(order.number);
  const stillWaiting = order.status === "pending_payment";
  const timedOut = stillWaiting && Date.now() - openedAt.current >= POLL_FOR_MS;

  return shell(
    <>
      <p className="eyebrow mb-4 text-muted-foreground">Order {number}</p>
      {order.status === "cancelled" ? (
        <>
          <h1 className="page-title leading-tight">This order was cancelled</h1>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            The payment was not completed, so nothing was charged. Your items may still be in your
            bag.
          </p>
        </>
      ) : order.status === "refunded" ? (
        <>
          <h1 className="page-title leading-tight">This order was refunded</h1>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            We have refunded {formatCents(order.totalCents, order.currency)}. It usually reaches
            your account within 5–10 business days.
          </p>
        </>
      ) : stillWaiting ? (
        <>
          <h1 className="page-title leading-tight">
            {placed ? "Confirming your payment…" : "Waiting for payment"}
          </h1>
          <p role="status" className="mt-4 text-sm leading-7 text-muted-foreground">
            {timedOut
              ? "Your payment is still being confirmed. You don't need to stay on this page — we will email you as soon as it goes through."
              : "This usually takes a few seconds. Please keep this page open."}
          </p>
        </>
      ) : (
        <>
          <h1 className="page-title leading-tight">
            {placed ? "Thank you — your order is confirmed" : ORDER_STATUS_LABELS[order.status]}
          </h1>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            {order.status === "paid" &&
              `We've emailed your receipt to ${order.email}. We'll let you know as soon as your order ships.`}
            {order.status === "shipped" && "Your order is on its way."}
            {order.status === "delivered" && "Your order has been delivered. We hope you love it."}
          </p>
          {order.trackingNumber && (
            <p className="mt-3 text-sm">
              Tracking: {order.trackingCarrier && `${order.trackingCarrier} · `}
              <strong>{order.trackingNumber}</strong>
            </p>
          )}
        </>
      )}

      <section className="mt-10 border-t pt-8" aria-label="Order details">
        <ul className="space-y-4">
          {order.lines.map((line) => (
            <li key={line.id} className="flex gap-4 text-sm">
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
              <p>{formatCents(line.lineTotalCents, order.currency)}</p>
            </li>
          ))}
        </ul>
        <dl className="mt-6 space-y-2 border-t pt-4 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatCents(order.itemsCents, order.currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Delivery ({order.shippingMethod})</dt>
            <dd>
              {order.shippingCents === 0
                ? "Free"
                : formatCents(order.shippingCents, order.currency)}
            </dd>
          </div>
          {order.taxCents > 0 && (
            <div className="flex justify-between">
              <dt>Tax ({formatTaxRate(order.taxBps)})</dt>
              <dd>{formatCents(order.taxCents, order.currency)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t pt-3 text-base font-medium">
            <dt>Total</dt>
            <dd>{formatCents(order.totalCents, order.currency)}</dd>
          </div>
        </dl>
        <div className="mt-8 text-sm leading-7">
          <p className="eyebrow mb-2 text-muted-foreground">Delivering to</p>
          <p>{order.address.name}</p>
          <p>{order.address.line1}</p>
          {order.address.line2 && <p>{order.address.line2}</p>}
          <p>
            {[order.address.city, order.address.region, order.address.postalCode]
              .filter(Boolean)
              .join(", ")}
          </p>
          <p>{countryName(order.address.country)}</p>
        </div>
      </section>

      <div className="mt-10 flex flex-wrap gap-3">
        <Button asChild className="rounded-none">
          <Link to="/shop" search={{ category: "All" }}>
            Continue shopping
          </Link>
        </Button>
        <Button asChild variant="outline" className="rounded-none">
          <Link to="/contact">Need help with this order?</Link>
        </Button>
      </div>
    </>,
  );
}
