import { createFileRoute } from "@tanstack/react-router";

import { getSitePageFn } from "@/backend/site.functions";
import { BrandPage, brandHead } from "@/components/brand-page";
import { PolicyPage, policyHead } from "@/components/policy-page";

// Until an owner edits this policy in the admin, the built-in page is shown.
export const Route = createFileRoute("/returns")({
  loader: () => getSitePageFn({ data: { slug: "returns-policy" } }),
  head: ({ loaderData }) =>
    loaderData && !loaderData.isStarter ? policyHead(loaderData) : brandHead("returns"),
  component: Page,
});

function Page() {
  const page = Route.useLoaderData();
  return page.isStarter ? (
    <BrandPage pageKey="returns" />
  ) : (
    <PolicyPage page={page} eyebrow="Here to help" />
  );
}
