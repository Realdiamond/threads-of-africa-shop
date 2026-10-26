import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import {
  adminListPagesFn,
  adminResetPageFn,
  adminReviewPageFn,
  adminSavePageFn,
} from "@/backend/admin.functions";
import { adminCall, Field, formatDateTime, Notice, PageHeader } from "@/components/admin/admin-ui";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const PUBLIC_PATH: Record<string, string> = {
  privacy: "/privacy",
  terms: "/terms",
  "shipping-policy": "/shipping",
  "returns-policy": "/returns",
};

export const Route = createFileRoute("/admin/pages/$slug")({
  loader: async ({ params }) => {
    const page = (await adminListPagesFn()).find((p) => p.slug === params.slug);
    if (!page) throw notFound();
    return page;
  },
  notFoundComponent: () => (
    <div className="py-10">
      <p className="mb-3">That page does not exist.</p>
      <Link to="/admin/pages" className="underline">
        Back to the policy pages
      </Link>
    </div>
  ),
  component: EditPage,
});

function EditPage() {
  const page = Route.useLoaderData();
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(page.body);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run<T extends { ok: boolean }>(action: () => Promise<T>, success: string) {
    setMessage(null);
    setBusy(true);
    try {
      const result = await adminCall(action);
      if (!result.ok) {
        setMessage({
          kind: "error",
          text: (result as { message?: string }).message ?? "That did not work.",
        });
        return false;
      }
      setMessage({ kind: "success", text: success });
      await router.invalidate();
      return true;
    } catch {
      setMessage({ kind: "error", text: "Something went wrong. Please try again." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const dirty = title !== page.title || body !== page.body;

  return (
    <>
      <PageHeader
        title={page.title}
        description={
          <>
            Shown at{" "}
            <a className="underline" href={PUBLIC_PATH[page.slug]} target="_blank" rel="noreferrer">
              {PUBLIC_PATH[page.slug]}
            </a>
            .{" "}
            {page.reviewedAt
              ? `Reviewed ${formatDateTime(page.reviewedAt)}.`
              : page.isStarter
                ? "This is the starter text."
                : "Edited since it was last reviewed."}
          </>
        }
        actions={
          <Button asChild variant="ghost">
            <Link to="/admin/pages">All pages</Link>
          </Button>
        }
      />
      {message && (
        <Notice kind={message.kind} className="mb-4">
          {message.text}
        </Notice>
      )}
      {(page.slug === "privacy" || page.slug === "terms") && !page.reviewedAt && (
        <Notice kind="warning" className="mb-4">
          Generic template — not legal advice. Have it checked against the laws where the business
          is registered and where it sells.
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <Field label="Title" htmlFor="page-title">
            <Input
              id="page-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
            />
          </Field>
          <Field
            label="Text"
            htmlFor="page-body"
            hint={
              <>
                Formatting: <code>## Heading</code> · <code>- bullet</code> · <code>**bold**</code>{" "}
                · <code>*italic*</code> · <code>[link text](https://…)</code>. Leave a blank line
                between paragraphs.
              </>
            }
          >
            <Textarea
              id="page-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={26}
              className="font-mono text-xs leading-6"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !dirty}
              onClick={() =>
                run(
                  () => adminSavePageFn({ data: { slug: page.slug, title, body } }),
                  "Saved. The page is live.",
                )
              }
            >
              Save changes
            </Button>
            <Button
              variant="outline"
              disabled={busy || dirty}
              title={dirty ? "Save your changes first" : undefined}
              onClick={() =>
                run(() => adminReviewPageFn({ data: { slug: page.slug } }), "Marked as reviewed.")
              }
            >
              Mark as reviewed
            </Button>
            {!page.isStarter && (
              <Button
                variant="ghost"
                className="text-destructive"
                disabled={busy}
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Replace this page with the original starter text? Your edits will be lost.",
                    )
                  )
                    return;
                  if (
                    await run(
                      () => adminResetPageFn({ data: { slug: page.slug } }),
                      "Starter text restored.",
                    )
                  ) {
                    window.location.reload();
                  }
                }}
              >
                Restore the starter text
              </Button>
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Preview</p>
          <div className="rounded-lg border bg-background p-6">
            <h2 className="mb-4 font-display text-2xl">{title}</h2>
            <SimpleMarkdown text={body || " "} />
          </div>
        </div>
      </div>
    </>
  );
}
