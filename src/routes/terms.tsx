import { createFileRoute } from "@tanstack/react-router";

import { getSitePageFn } from "@/backend/site.functions";
import { PolicyPage, policyHead } from "@/components/policy-page";

export const Route = createFileRoute("/terms")({
  loader: () => getSitePageFn({ data: { slug: "terms" } }),
  head: ({ loaderData }) => (loaderData ? policyHead(loaderData) : {}),
  component: TermsPage,
});

function TermsPage() {
  return <PolicyPage page={Route.useLoaderData()} eyebrow="The small print" />;
}
