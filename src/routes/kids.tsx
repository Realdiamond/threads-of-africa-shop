import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { BrandPage, brandHead } from "@/components/brand-page";
import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { productsQueryOptions } from "@/lib/catalog";

export const Route = createFileRoute("/kids")({
  loader: ({ context }) => context.queryClient.ensureQueryData(productsQueryOptions),
  head: () => brandHead("kids"),
  component: Page,
});

// Once the owner adds a "Kids" category with live products, they appear under the story.
function KidsProducts() {
  const { data: products } = useSuspenseQuery(productsQueryOptions);
  const kids = products.filter((p) => p.category.toLowerCase() === "kids");
  if (kids.length === 0) return null;
  return (
    <section className="site-width pb-20" aria-labelledby="kids-products">
      <h2 id="kids-products" className="mb-8 text-3xl">
        Shop Roots &amp; Play
      </h2>
      <div className="product-grid">
        {kids.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
      <Button asChild variant="outline" className="mt-8 rounded-none">
        <Link to="/shop" search={{ category: "Kids" }}>
          See all kids' pieces
        </Link>
      </Button>
    </section>
  );
}

function Page() {
  return (
    <>
      <BrandPage pageKey="kids" />
      <KidsProducts />
    </>
  );
}
