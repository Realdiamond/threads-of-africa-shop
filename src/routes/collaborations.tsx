import { createFileRoute } from "@tanstack/react-router";
import { BrandPage, brandHead } from "@/components/brand-page";
export const Route = createFileRoute("/collaborations")({
  head: () => brandHead("collaborations"),
  component: Page,
});
function Page() {
  return <BrandPage pageKey="collaborations" />;
}
