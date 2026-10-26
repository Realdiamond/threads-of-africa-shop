import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { completeMockPaymentFn, getMockSessionFn } from "@/backend/orders.functions";
import { Button } from "@/components/ui/button";
import { formatCents, formatOrderNumber } from "@/lib/order-types";
import { searchText } from "@/lib/search-params";

type Search = { s?: string | undefined };

export const Route = createFileRoute("/checkout/mock-pay")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    s: searchText(search["s"]),
  }),
  head: () => ({
    meta: [
      { title: "Test payment — The Threads of Africa" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MockPayPage,
});

// Stands in for Stripe's payment page while the shop is being tested without real keys. It only
// works when the server runs with PAYMENTS_PROVIDER=mock.
function MockPayPage() {
  const { s } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const session = useQuery({
    queryKey: ["mock-session", s],
    enabled: Boolean(s),
    gcTime: 0,
    queryFn: () => getMockSessionFn({ data: { sessionId: s! } }),
  });

  async function finish(outcome: "paid" | "failed" | "cancel") {
    if (!s) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await completeMockPaymentFn({ data: { sessionId: s, outcome } });
      if (result.ok) {
        window.location.assign(result.redirect);
        return;
      }
    } catch {
      // fall through to the message below
    }
    setFailed(true);
    setBusy(false);
  }

  const data = session.data;
  return (
    <main className="site-width max-w-xl py-12 sm:py-16">
      <p className="mb-6 border border-destructive p-3 text-center text-xs font-semibold uppercase tracking-widest text-destructive">
        Test mode — no real money is taken
      </p>
      {session.isLoading ? (
        <p role="status" className="text-sm">
          Loading…
        </p>
      ) : !data ? (
        <p role="alert" className="text-sm">
          This test payment page isn't available.
        </p>
      ) : (
        <>
          <h1 className="page-title leading-tight">
            Pay for order {formatOrderNumber(data.number)}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">Receipt will go to {data.email}</p>
          <ul className="mt-6 space-y-2 border-y py-4 text-sm">
            {data.lines.map((line) => (
              <li key={line.title} className="flex justify-between gap-4">
                <span>
                  {line.quantity} × {line.title}
                </span>
                <span>{formatCents(line.lineTotalCents, data.currency)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 flex justify-between text-base font-medium">
            <span>Total</span>
            <span>{formatCents(data.totalCents, data.currency)}</span>
          </p>
          {failed && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              That didn't work. The order may have already been completed or cancelled.
            </p>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            <Button className="rounded-none" disabled={busy} onClick={() => finish("paid")}>
              Pay (test card succeeds)
            </Button>
            <Button
              variant="outline"
              className="rounded-none"
              disabled={busy}
              onClick={() => finish("failed")}
            >
              Simulate a declined card
            </Button>
            <Button
              variant="ghost"
              className="rounded-none"
              disabled={busy}
              onClick={() => finish("cancel")}
            >
              Cancel
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
