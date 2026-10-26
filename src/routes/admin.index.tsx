import { createFileRoute, Link } from "@tanstack/react-router";

import { adminDashboardFn } from "@/backend/admin.functions";
import { formatDateTime, Notice, OrderStatusBadge, PageHeader } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { formatCents, formatOrderNumber } from "@/lib/order-types";

export const Route = createFileRoute("/admin/")({
  loader: () => adminDashboardFn(),
  component: Dashboard,
});

function Stat({
  label,
  value,
  tone,
  text,
  hint,
}: {
  label: string;
  value: number;
  tone?: "warn";
  text?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-display text-3xl ${tone === "warn" && value > 0 ? "text-amber-700" : ""}`}
      >
        {text ?? value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Dashboard() {
  const data = Route.useLoaderData();
  const { admin } = Route.useRouteContext();

  return (
    <>
      <PageHeader
        title={`Welcome, ${admin?.name.split(" ")[0] ?? "there"}`}
        description="What needs attention in the shop."
        actions={
          <Button asChild>
            <Link to="/admin/products/new">Add a product</Link>
          </Button>
        }
      />

      {data.counts.active === 0 && (
        <Notice kind="warning" className="mb-6">
          No products are live in the shop yet. Add a product and set its status to Active to
          publish it.
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Link to="/admin/orders" search={{ status: "paid" }} className="block">
          <Stat
            label="Orders to ship"
            value={data.orders.toShip}
            tone="warn"
            hint="Paid and waiting for you"
          />
        </Link>
        <Link to="/admin/orders" search={{ status: "pending_payment" }} className="block">
          <Stat
            label="Awaiting payment"
            value={data.orders.awaitingPayment}
            hint="Items held for these customers"
          />
        </Link>
        <Stat
          label="Sales, last 30 days"
          value={data.orders.last30Days.count}
          text={formatCents(data.orders.last30Days.cents, data.orders.last30Days.currency)}
          hint={`${data.orders.last30Days.count} paid order${data.orders.last30Days.count === 1 ? "" : "s"}`}
        />
      </div>

      <section className="mt-6 rounded-lg border bg-background p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">Latest orders</h2>
          <Link to="/admin/orders" className="text-sm underline underline-offset-4">
            See all
          </Link>
        </div>
        {data.orders.latest.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <ul className="mt-3 divide-y text-sm">
            {data.orders.latest.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <Link
                  to="/admin/orders/$id"
                  params={{ id: order.id }}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {formatOrderNumber(order.number)}
                </Link>
                <span className="flex-1 text-muted-foreground">
                  {order.name} · {formatDateTime(order.createdAt)}
                </span>
                <span>{formatCents(order.totalCents, order.currency)}</span>
                <OrderStatusBadge status={order.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Live products" value={data.counts.active} />
        <Stat label="Drafts" value={data.counts.draft} />
        <Stat label="Archived" value={data.counts.archived} />
        <Stat label="Sold-out sizes" value={data.outOfStock} tone="warn" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border bg-background p-5">
          <h2 className="font-display text-lg">Running low</h2>
          {data.lowStock.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing is running low on stock.</p>
          ) : (
            <ul className="mt-3 divide-y text-sm">
              {data.lowStock.map((row) => (
                <li key={row.variantId} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    to="/admin/products/$id"
                    params={{ id: row.productId }}
                    className="underline-offset-4 hover:underline"
                  >
                    {row.productTitle}{" "}
                    <span className="font-mono text-xs text-muted-foreground">{row.sku}</span>
                  </Link>
                  <span className="rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
                    {row.stock} left
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border bg-background p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg">Recent activity</h2>
            <Link to="/admin/activity" className="text-xs underline underline-offset-4">
              See all
            </Link>
          </div>
          {data.recent.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing has happened yet.</p>
          ) : (
            <ul className="mt-3 divide-y text-sm">
              {data.recent.map((entry) => (
                <li key={entry.id} className="py-2">
                  <p>{entry.summary || entry.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.adminEmail} · {formatDateTime(entry.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
