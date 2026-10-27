import { createFileRoute } from "@tanstack/react-router";
import { BrandPage, brandHead } from "@/components/brand-page";
export const Route = createFileRoute("/heritage")({
  head: () => brandHead("heritage"),
  component: Page,
});
function Page() {
  return <BrandPage pageKey="heritage" />;
}
