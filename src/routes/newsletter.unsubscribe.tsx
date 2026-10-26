import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { unsubscribeFn } from "@/backend/site.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/newsletter/unsubscribe")({
  validateSearch: (search: { t?: unknown }): { t?: string | undefined } => ({
    t: typeof search.t === "string" ? search.t : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Unsubscribe — The Threads of Africa" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Unsubscribe,
});

// Unsubscribing needs a click, not just opening the link: email programs often "preview" links,
// and that must never remove someone from the list by accident.
function Unsubscribe() {
  const { t } = Route.useSearch();
  const [state, setState] = useState<"idle" | "working" | "done" | "failed">("idle");

  async function confirm() {
    if (!t) return;
    setState("working");
    try {
      const result = await unsubscribeFn({ data: { token: t } });
      setState(result.ok ? "done" : "failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <main className="site-width mx-auto max-w-xl py-20 text-center">
      <h1 className="page-title">Unsubscribe</h1>
      {state === "done" ? (
        <p role="status" className="mt-6 text-sm leading-7 text-muted-foreground">
          You have been unsubscribed and will not receive any more emails from us. We are sorry to
          see you go.
        </p>
      ) : !t || state === "failed" ? (
        <p role="alert" className="mt-6 text-sm leading-7 text-muted-foreground">
          That unsubscribe link is not valid. If you keep receiving emails, please contact us and we
          will remove you.
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm leading-7 text-muted-foreground">
            Do you want to stop receiving emails about new collections and stories?
          </p>
          <Button className="mt-6 rounded-none" onClick={confirm} disabled={state === "working"}>
            {state === "working" ? "Working…" : "Yes, unsubscribe me"}
          </Button>
        </>
      )}
      <p className="mt-10 text-xs">
        <Link to="/" className="underline underline-offset-4">
          Back to the shop
        </Link>
      </p>
    </main>
  );
}
