import { createFileRoute } from "@tanstack/react-router";

import { getSitePageFn } from "@/backend/site.functions";
import { PolicyPage, policyHead } from "@/components/policy-page";

export const Route = createFileRoute("/privacy")({
  loader: () => getSitePageFn({ data: { slug: "privacy" } }),
  head: ({ loaderData }) => (loaderData ? policyHead(loaderData) : {}),
  component: PrivacyPage,
});

function PrivacyPage() {
  return <PolicyPage page={Route.useLoaderData()} eyebrow="How we look after your information" />;
}
