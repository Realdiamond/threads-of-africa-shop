import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { BrandPage, brandHead } from "@/components/brand-page";
import { ProductCard } from "@/components/product-card";
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
    <section className="site-width section-tight" aria-labelledby="kids-products">
      <h2 id="kids-products" className="mb-8 text-4xl">
        Shop Roots &amp; Play
      </h2>
      <div className="product-grid">
        {kids.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
      <Link to="/shop" search={{ category: "Kids" }} className="cta cta-outline mt-10">
        See all kids' pieces
      </Link>
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
