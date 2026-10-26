import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { adminListProductsFn } from "@/backend/admin.functions";
import { PageHeader, selectClass, StatusBadge } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProductStatus } from "@/lib/admin-types";
import { centsToInput } from "@/lib/money-input";

const STATUSES: ProductStatus[] = ["active", "draft", "archived"];

export const Route = createFileRoute("/admin/products/")({
  // Declared with optional inputs so links can point at /admin/products without any filters.
  validateSearch: (search: {
    status?: unknown;
    q?: unknown;
  }): { status?: ProductStatus | undefined; q?: string | undefined } => ({
    status: STATUSES.find((status) => status === search.status),
    q: typeof search.q === "string" && search.q ? search.q : undefined,
  }),
  loaderDeps: ({ search }) => ({ status: search.status, q: search.q }),
  loader: ({ deps }) => adminListProductsFn({ data: { status: deps.status, search: deps.q } }),
  component: ProductsPage,
});

function priceRange(min: number, max: number) {
  if (min === 0 && max === 0) return "—";
  return min === max ? `$${centsToInput(min)}` : `$${centsToInput(min)} – $${centsToInput(max)}`;
}

function ProductsPage() {
  const rows = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [term, setTerm] = useState(search.q ?? "");

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything in the shop. Only Active products are visible to customers."
        actions={
          <Button asChild>
            <Link to="/admin/products/new">Add a product</Link>
          </Button>
        }
      />

      <form
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({ search: { status: search.status, q: term || undefined } });
        }}
      >
        <Input
          aria-label="Search products"
          placeholder="Search by name or web address"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="max-w-xs"
        />
        <select
          aria-label="Filter by status"
          className={`${selectClass} w-40`}
          value={search.status ?? ""}
          onChange={(e) =>
            void navigate({
              search: { status: STATUSES.find((s) => s === e.target.value), q: term || undefined },
            })
          }
        >
          <option value="">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status} className="capitalize">
              {status[0]!.toUpperCase() + status.slice(1)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-background p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {search.q || search.status ? "No products match those filters." : "No products yet."}
          </p>
          <Button asChild className="mt-4">
            <Link to="/admin/products/new">Add your first product</Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-background">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b bg-secondary/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-normal">Product</th>
                <th className="px-4 py-3 font-normal">Status</th>
                <th className="px-4 py-3 font-normal">Category</th>
                <th className="px-4 py-3 font-normal">Price</th>
                <th className="px-4 py-3 font-normal">Sizes</th>
                <th className="px-4 py-3 font-normal">In stock</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-secondary/30">
                  <td className="px-4 py-3">
                    <Link
                      to="/admin/products/$id"
                      params={{ id: row.id }}
                      className="flex items-center gap-3"
                    >
                      {row.imageUrl ? (
                        <img src={row.imageUrl} alt="" className="h-14 w-11 rounded object-cover" />
                      ) : (
                        <span className="flex h-14 w-11 items-center justify-center rounded bg-secondary text-[10px] text-muted-foreground">
                          No photo
                        </span>
                      )}
                      <span>
                        <span className="block font-medium underline-offset-4 hover:underline">
                          {row.title}
                        </span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {row.handle}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3">{row.category}</td>
                  <td className="px-4 py-3">{priceRange(row.minPriceCents, row.maxPriceCents)}</td>
                  <td className="px-4 py-3">{row.variantCount}</td>
                  <td className="px-4 py-3">
                    {row.totalStock === 0 && row.variantCount > 0 ? (
                      <span className="text-amber-700">Sold out</span>
                    ) : (
                      row.totalStock
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
