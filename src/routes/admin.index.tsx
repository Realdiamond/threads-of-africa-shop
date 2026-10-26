import { createFileRoute, Link } from "@tanstack/react-router";

import { adminDashboardFn } from "@/backend/admin.functions";
import { formatDateTime, Notice, PageHeader } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/")({
  loader: () => adminDashboardFn(),
  component: Dashboard,
});

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-display text-3xl ${tone === "warn" && value > 0 ? "text-amber-700" : ""}`}
      >
        {value}
      </p>
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
