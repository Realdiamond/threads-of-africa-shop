import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { adminListOrdersFn } from "@/backend/admin.functions";
import { formatDateTime, OrderStatusBadge, PageHeader } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { countryName } from "@/lib/countries";
import {
  formatCents,
  formatOrderNumber,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  type OrderStatus,
} from "@/lib/order-types";
import { searchText } from "@/lib/search-params";

type Search = {
  status?: OrderStatus | undefined;
  search?: string | undefined;
  page?: number | undefined;
};

export const Route = createFileRoute("/admin/orders/")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    status: ORDER_STATUSES.includes(search["status"] as OrderStatus)
      ? (search["status"] as OrderStatus)
      : undefined,
    search: searchText(search["search"])?.trim()
      ? searchText(search["search"])!.slice(0, 100)
      : undefined,
    page:
      Number.isInteger(Number(search["page"])) && Number(search["page"]) > 1
        ? Number(search["page"])
        : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    adminListOrdersFn({ data: { status: deps.status, search: deps.search, page: deps.page } }),
  component: OrdersPage,
});

const TABS: Array<{ label: string; value: OrderStatus | undefined }> = [
  { label: "All", value: undefined },
  { label: ORDER_STATUS_LABELS.paid, value: "paid" },
  { label: ORDER_STATUS_LABELS.shipped, value: "shipped" },
  { label: ORDER_STATUS_LABELS.delivered, value: "delivered" },
  { label: ORDER_STATUS_LABELS.pending_payment, value: "pending_payment" },
  { label: ORDER_STATUS_LABELS.refunded, value: "refunded" },
  { label: ORDER_STATUS_LABELS.cancelled, value: "cancelled" },
];

function OrdersPage() {
  const result = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [term, setTerm] = useState(search.search ?? "");

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const exportQuery = new URLSearchParams();
  if (search.status) exportQuery.set("status", search.status);
  if (search.search) exportQuery.set("search", search.search);

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order placed on the website. Paid orders are waiting for you to pack and send them."
        actions={
          <Button asChild variant="outline">
            <a href={`/api/admin/orders.csv${exportQuery.size ? `?${exportQuery}` : ""}`}>
              Download as spreadsheet
            </a>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter orders">
          {TABS.map((tab) => (
            <Button
              key={tab.label}
              role="tab"
              aria-selected={search.status === tab.value}
              variant={search.status === tab.value ? "default" : "ghost"}
              size="sm"
              onClick={() =>
                void navigate({ search: { ...search, status: tab.value, page: undefined } })
              }
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void navigate({
              search: { ...search, search: term.trim() || undefined, page: undefined },
            });
          }}
        >
          <Input
            aria-label="Search orders"
            placeholder="Order number, name or email"
            className="w-64"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      {result.rows.length === 0 ? (
        <div className="rounded-lg border bg-background p-10 text-center text-sm text-muted-foreground">
          {search.status || search.search
            ? "No orders match."
            : "No orders yet. They will appear here as soon as customers check out."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Placed</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.rows.map((order) => (
                <tr key={order.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      to="/admin/orders/$id"
                      params={{ id: order.id }}
                      className="underline-offset-4 hover:underline"
                    >
                      {formatOrderNumber(order.number)}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {formatDateTime(order.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <p>{order.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.email} · {countryName(order.country)}
                    </p>
                  </td>
                  <td className="px-4 py-3">{order.itemCount}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {formatCents(order.totalCents, order.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
          <Button
            variant="outline"
            size="sm"
            disabled={result.page <= 1}
            onClick={() =>
              void navigate({ search: { ...search, page: result.page - 1 || undefined } })
            }
          >
            Newer
          </Button>
          <span className="text-muted-foreground">
            Page {result.page} of {pages} · {result.total} orders
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={result.page >= pages}
            onClick={() => void navigate({ search: { ...search, page: result.page + 1 } })}
          >
            Older
          </Button>
        </nav>
      )}
    </>
  );
}
