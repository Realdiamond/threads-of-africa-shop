import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { adminListSubscribersFn, adminRemoveSubscriberFn } from "@/backend/admin.functions";
import {
  adminCall,
  formatDateTime,
  Notice,
  PageHeader,
  selectClass,
  StatusBadge,
} from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Filter = "subscribed" | "unsubscribed";

export const Route = createFileRoute("/admin/subscribers")({
  validateSearch: (search: {
    status?: unknown;
    q?: unknown;
  }): { status?: Filter | undefined; q?: string | undefined } => ({
    status:
      search.status === "subscribed" || search.status === "unsubscribed"
        ? search.status
        : undefined,
    q: typeof search.q === "string" && search.q ? search.q : undefined,
  }),
  loaderDeps: ({ search }) => ({ status: search.status, q: search.q }),
  loader: ({ deps }) => adminListSubscribersFn({ data: { status: deps.status, search: deps.q } }),
  component: SubscribersPage,
});

function SubscribersPage() {
  const { rows, subscribed, unsubscribed } = Route.useLoaderData();
  const search = Route.useSearch();
  const { admin } = Route.useRouteContext();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const [term, setTerm] = useState(search.q ?? "");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  return (
    <>
      <PageHeader
        title="Newsletter subscribers"
        description="People who signed up on the website. Everyone gets an unsubscribe link in every email."
        actions={
          <Button asChild variant="outline">
            <a href="/api/admin/subscribers.csv">Download CSV</a>
          </Button>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-background p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Subscribed</p>
          <p className="mt-1 font-display text-3xl">{subscribed}</p>
        </div>
        <div className="rounded-lg border bg-background p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Unsubscribed</p>
          <p className="mt-1 font-display text-3xl">{unsubscribed}</p>
        </div>
      </div>

      <form
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({ search: { status: search.status, q: term || undefined } });
        }}
      >
        <Input
          aria-label="Search subscribers"
          placeholder="Search by email"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="max-w-xs"
        />
        <select
          aria-label="Filter by status"
          className={`${selectClass} w-44`}
          value={search.status ?? ""}
          onChange={(e) =>
            void navigate({
              search: {
                status:
                  e.target.value === "subscribed" || e.target.value === "unsubscribed"
                    ? e.target.value
                    : undefined,
                q: term || undefined,
              },
            })
          }
        >
          <option value="">Everyone</option>
          <option value="subscribed">Subscribed</option>
          <option value="unsubscribed">Unsubscribed</option>
        </select>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {message && (
        <Notice kind={message.kind} className="mb-4">
          {message.text}
        </Notice>
      )}

      <div className="overflow-x-auto rounded-lg border bg-background">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b bg-secondary/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-normal">Email</th>
              <th className="px-4 py-3 font-normal">Status</th>
              <th className="px-4 py-3 font-normal">Joined</th>
              <th className="px-4 py-3 font-normal">From</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  No subscribers found.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-2">{row.email}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={row.status === "subscribed" ? "active" : "archived"} />
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {formatDateTime(row.subscribedAt)}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{row.source || "—"}</td>
                <td className="px-4 py-2 text-right">
                  {admin?.role === "owner" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={async () => {
                        if (
                          !window.confirm(`Permanently remove ${row.email}? They will not be told.`)
                        )
                          return;
                        setMessage(null);
                        const result = await adminCall(() =>
                          adminRemoveSubscriberFn({ data: { id: row.id } }),
                        );
                        if (!result.ok) setMessage({ kind: "error", text: result.message });
                        await router.invalidate();
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Showing up to 1,000 people. “Remove” deletes the record completely (for example if someone
        asks you to erase their data).
      </p>
    </>
  );
}
