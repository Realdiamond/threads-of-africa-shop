import { createFileRoute } from "@tanstack/react-router";
import { BrandPage, brandHead } from "@/components/brand-page";
export const Route = createFileRoute("/size-guide")({
  head: () => brandHead("size-guide"),
  component: Page,
});
function Page() {
  return <BrandPage pageKey="size-guide" />;
}
