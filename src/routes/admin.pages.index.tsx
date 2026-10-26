import { createFileRoute, Link } from "@tanstack/react-router";

import { adminListPagesFn } from "@/backend/admin.functions";
import { formatDateTime, Notice, PageHeader } from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import type { SitePageView } from "@/lib/store-types";

export const Route = createFileRoute("/admin/pages/")({
  loader: () => adminListPagesFn(),
  component: PagesIndex,
});

const PAGE_PUBLIC_PATH: Record<string, string> = {
  privacy: "/privacy",
  terms: "/terms",
  "shipping-policy": "/shipping",
  "returns-policy": "/returns",
};

function Status({ page }: { page: SitePageView }) {
  if (page.reviewedAt) {
    return (
      <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
        Reviewed {formatDateTime(page.reviewedAt)}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-500/40 bg-amber-50 text-amber-900">
      {page.isStarter ? "Starter text — needs your review" : "Edited — needs review"}
    </Badge>
  );
}

function PagesIndex() {
  const pages = Route.useLoaderData();
  return (
    <>
      <PageHeader
        title="Policy pages"
        description="The legal and policy pages linked from the footer and checkout. Edit the wording here, no developer needed."
      />
      <Notice kind="warning" className="mb-6">
        The privacy policy and terms start as generic templates, which are not legal advice. Before
        launch, have them read by a lawyer who knows the rules where the business is registered and
        where it sells, then mark them reviewed.
      </Notice>
      <div className="divide-y rounded-lg border bg-background">
        {pages.map((page) => (
          <Link
            key={page.slug}
            to="/admin/pages/$slug"
            params={{ slug: page.slug }}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-secondary/40"
          >
            <span>
              <span className="block font-medium">{page.title}</span>
              <span className="block font-mono text-xs text-muted-foreground">
                {PAGE_PUBLIC_PATH[page.slug]}
              </span>
            </span>
            <Status page={page} />
          </Link>
        ))}
      </div>
    </>
  );
}
