import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  adminCancelOrderFn,
  adminDeliverOrderFn,
  adminGetOrderFn,
  adminRefundOrderFn,
  adminResendConfirmationFn,
  adminSetOrderNoteFn,
  adminShipOrderFn,
} from "@/backend/admin.functions";
import {
  adminCall,
  Field,
  formatDateTime,
  Notice,
  OrderStatusBadge,
  PageHeader,
} from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { countryName } from "@/lib/countries";
import { formatCents, formatOrderNumber, type AdminOrderView } from "@/lib/order-types";
import { formatTaxRate } from "@/lib/store-types";

export const Route = createFileRoute("/admin/orders/$id")({
  loader: ({ params }) => adminGetOrderFn({ data: { id: params.id } }),
  component: OrderPage,
});

type Result = { ok: true } | { ok: false; message: string };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-background p-5">
      <h2 className="mb-3 font-display text-lg">{title}</h2>
      {children}
    </section>
  );
}

function OrderPage() {
  const order = Route.useLoaderData();
  if (!order) {
    return (
      <>
        <PageHeader title="Order not found" />
        <Notice kind="warning">That order doesn't exist (it may have been removed).</Notice>
        <Link to="/admin/orders" className="mt-4 inline-block underline">
          Back to orders
        </Link>
      </>
    );
  }
  return <OrderDetail order={order} />;
}

function OrderDetail({ order }: { order: AdminOrderView }) {
  const router = useRouter();
  const { admin } = Route.useRouteContext();
  const isOwner = admin?.role === "owner";
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [carrier, setCarrier] = useState(order.trackingCarrier);
  const [tracking, setTracking] = useState(order.trackingNumber);
  const [notify, setNotify] = useState(true);
  const [notes, setNotes] = useState(order.notes);
  const [confirmRefund, setConfirmRefund] = useState(false);
  // Unshipped goods go back on sale by default; shipped ones do not, unless the owner says so.
  // The default follows the order's current status until the owner touches the box.
  const [restockChoice, setRestockChoice] = useState<boolean | null>(null);
  const restock = restockChoice ?? order.status === "paid";

  async function run(action: () => Promise<Result>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await adminCall(action);
      if (result.ok) {
        setMessage({ kind: "success", text: success });
        setConfirmRefund(false);
        await router.invalidate();
      } else {
        setMessage({ kind: "error", text: result.message });
      }
    } catch {
      setMessage({ kind: "error", text: "Something went wrong. Please try again." });
    }
    setBusy(false);
  }

  const money = (cents: number) => formatCents(cents, order.currency);
  const canShip = order.status === "paid" || order.status === "shipped";
  const refundable = ["paid", "shipped", "delivered"].includes(order.status);

  return (
    <>
      <PageHeader
        title={`Order ${formatOrderNumber(order.number)}`}
        description={`Placed ${formatDateTime(order.createdAt)}`}
        actions={
          <>
            <OrderStatusBadge status={order.status} />
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/orders">All orders</Link>
            </Button>
          </>
        }
      />
      {message && (
        <Notice kind={message.kind} className="mb-4">
          {message.text}
        </Notice>
      )}
      {order.status === "pending_payment" && (
        <Notice kind="warning" className="mb-4">
          The customer hasn't paid yet. The items are held for them
          {order.expiresAt
            ? ` until ${formatDateTime(order.expiresAt)}`
            : " (the hold is paused for you to check this order)"}
          , then released automatically.
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card title="Items">
            <ul className="divide-y">
              {order.lines.map((line) => (
                <li key={line.id} className="flex gap-4 py-3 text-sm first:pt-0">
                  {line.imageUrl && (
                    <img src={line.imageUrl} alt="" className="h-16 w-12 rounded object-cover" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium">{line.productTitle}</p>
                    <p className="text-xs text-muted-foreground">
                      {line.variantTitle && `${line.variantTitle} · `}SKU {line.sku}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {money(line.unitPriceCents)} × {line.quantity}
                    </p>
                  </div>
                  <p>{money(line.lineTotalCents)}</p>
                </li>
              ))}
            </ul>
            <dl className="mt-4 space-y-1.5 border-t pt-4 text-sm">
              <div className="flex justify-between">
                <dt>Items</dt>
                <dd>{money(order.itemsCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Delivery — {order.shippingMethod}</dt>
                <dd>{money(order.shippingCents)}</dd>
              </div>
              {order.taxCents > 0 && (
                <div className="flex justify-between">
                  <dt>Tax ({formatTaxRate(order.taxBps)})</dt>
                  <dd>{money(order.taxCents)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t pt-2 text-base font-medium">
                <dt>Total</dt>
                <dd>{money(order.totalCents)}</dd>
              </div>
            </dl>
          </Card>

          <Card title="History">
            <ol className="space-y-3 text-sm">
              {[...order.events].reverse().map((event) => (
                <li key={event.id} className="flex gap-3">
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                  <div>
                    <p>{event.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt)} · {event.actor}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          {canShip && (
            <Card title={order.status === "paid" ? "Ready to ship" : "Tracking"}>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(
                    () =>
                      adminShipOrderFn({
                        data: { id: order.id, carrier, trackingNumber: tracking, notify },
                      }),
                    order.status === "paid" ? "Marked as shipped." : "Tracking updated.",
                  );
                }}
              >
                <Field label="Carrier (optional)" htmlFor="carrier">
                  <Input
                    id="carrier"
                    value={carrier}
                    maxLength={60}
                    onChange={(e) => setCarrier(e.target.value)}
                    placeholder="DHL, FedEx, GIG Logistics…"
                  />
                </Field>
                <Field label="Tracking number (optional)" htmlFor="tracking">
                  <Input
                    id="tracking"
                    value={tracking}
                    maxLength={100}
                    onChange={(e) => setTracking(e.target.value)}
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={notify}
                    onChange={(e) => setNotify(e.target.checked)}
                  />
                  Email the customer
                </label>
                <Button type="submit" disabled={busy} className="w-full">
                  {order.status === "paid" ? "Mark as shipped" : "Update tracking"}
                </Button>
              </form>
              {order.status === "shipped" && (
                <Button
                  variant="outline"
                  className="mt-3 w-full"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => adminDeliverOrderFn({ data: { id: order.id } }),
                      "Marked as delivered.",
                    )
                  }
                >
                  Mark as delivered
                </Button>
              )}
            </Card>
          )}

          {order.status === "pending_payment" && (
            <Card title="Not paid">
              <p className="mb-3 text-sm text-muted-foreground">
                Cancelling frees the items so other customers can buy them.
              </p>
              <Button
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={() =>
                  void run(() => adminCancelOrderFn({ data: { id: order.id } }), "Order cancelled.")
                }
              >
                Cancel this order
              </Button>
            </Card>
          )}

          <Card title="Customer">
            <div className="space-y-0.5 text-sm">
              <p className="font-medium">{order.address.name}</p>
              <p>
                <a className="underline underline-offset-4" href={`mailto:${order.email}`}>
                  {order.email}
                </a>
              </p>
              {order.address.phone && <p>{order.address.phone}</p>}
            </div>
            <p className="eyebrow mb-1 mt-4 text-xs uppercase tracking-wider text-muted-foreground">
              Ship to
            </p>
            <address className="text-sm not-italic leading-6">
              {order.address.line1}
              <br />
              {order.address.line2 && (
                <>
                  {order.address.line2}
                  <br />
                </>
              )}
              {[order.address.city, order.address.region, order.address.postalCode]
                .filter(Boolean)
                .join(", ")}
              <br />
              {countryName(order.address.country)}
            </address>
            <p className="mt-3 text-xs text-muted-foreground">Zone: {order.shippingZone}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={busy || order.status === "pending_payment" || order.status === "cancelled"}
              onClick={() =>
                void run(
                  () => adminResendConfirmationFn({ data: { id: order.id } }),
                  "Receipt sent again.",
                )
              }
            >
              Resend receipt
            </Button>
          </Card>

          <Card title="Payment">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Provider</dt>
                <dd className="capitalize">
                  {order.paymentProvider === "mock" ? "Test page" : order.paymentProvider}
                </dd>
              </div>
              {order.paidAt && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Paid</dt>
                  <dd>{formatDateTime(order.paidAt)}</dd>
                </div>
              )}
              {order.providerPaymentId && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Payment ID</dt>
                  <dd className="break-all font-mono text-xs">{order.providerPaymentId}</dd>
                </div>
              )}
            </dl>
            {refundable && isOwner && (
              <div className="mt-4 border-t pt-4">
                {confirmRefund ? (
                  <div className="space-y-3">
                    <Notice kind="warning">
                      This sends {money(order.totalCents)} back to the customer and can't be undone.
                    </Notice>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={restock}
                        onChange={(e) => setRestockChoice(e.target.checked)}
                      />
                      Put the items back in stock
                    </label>
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => adminRefundOrderFn({ data: { id: order.id, restock } }),
                            "Refunded.",
                          )
                        }
                      >
                        {busy ? "Refunding…" : "Yes, refund"}
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setConfirmRefund(false)}
                      >
                        Keep order
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setConfirmRefund(true)}
                  >
                    Refund this order…
                  </Button>
                )}
              </div>
            )}
            {refundable && !isOwner && (
              <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
                Only an owner can refund an order.
              </p>
            )}
          </Card>

          <Card title="Private note">
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () => adminSetOrderNoteFn({ data: { id: order.id, notes } }),
                  "Note saved.",
                );
              }}
            >
              <Textarea
                aria-label="Private note"
                rows={4}
                value={notes}
                maxLength={2000}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Only your team can see this."
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={busy || notes === order.notes}
              >
                Save note
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
