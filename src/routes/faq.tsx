import { createFileRoute } from "@tanstack/react-router";
import { BrandPage, brandHead } from "@/components/brand-page";
export const Route = createFileRoute("/faq")({ head: () => brandHead("faq"), component: Page });
function Page() {
  return <BrandPage pageKey="faq" />;
}
