import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { EmptyProducts, ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { productsQueryOptions, type Product } from "@/lib/catalog";
import { searchText } from "@/lib/search-params";

export const Route = createFileRoute("/shop")({
  validateSearch: (search: Record<string, unknown>) => ({
    category: searchText(search["category"]) ?? "All",
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(productsQueryOptions);
  },
  head: () => ({
    meta: [
      { title: "Shop the Collection — The Threads of Africa" },
      {
        name: "description",
        content:
          "Shop the Threads of Africa collection of Ankara dresses, heritage shirts, and expressive two-piece sets.",
      },
      { property: "og:title", content: "Shop the Collection — The Threads of Africa" },
      {
        property: "og:description",
        content: "Find your expression in contemporary African-inspired clothing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Shop,
});

const WOMEN =
  "The Threads of Africa women's collection celebrates confidence, individuality, and contemporary femininity. Discover expressive silhouettes, elevated everyday pieces, statement garments, and heritage influences.";
const MEN =
  "Contemporary menswear inspired by culture, craftsmanship, and modern living. Clean silhouettes, premium casualwear, tailoring, streetwear influence, and heritage-inspired detailing.";
const GENERAL =
  "Contemporary African fashion inspired by heritage, craftsmanship, culture, and modern living. Every collection is created to tell a story.";

const isNew = (p: Product) => p.tag.toLowerCase().includes("new");

function headingFor(category: string) {
  const key = category.toLowerCase();
  if (category === "All") return "All expressions.";
  if (category === "New") return "Freshly woven.";
  if (key === "women") return "Confidence in every detail.";
  if (key === "men") return "Modern style. Distinctive character.";
  if (key === "kids") return "Roots & Play.";
  return `${category}.`;
}

function Shop() {
  const { category } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [sort, setSort] = useState("featured");
  const { data: products } = useSuspenseQuery(productsQueryOptions);

  // The filters follow the categories the owner has set up, so a new one (Kids, Accessories…)
  // appears as soon as it has a live product. Women and Men stay first.
  const categories = useMemo(() => {
    const names = [...new Set(products.map((p) => p.category))];
    const first = ["Women", "Men"].filter((n) =>
      names.some((x) => x.toLowerCase() === n.toLowerCase()),
    );
    const rest = names
      .filter((n) => !["women", "men"].includes(n.toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
    return [
      ...names.filter((n) => first.some((f) => f.toLowerCase() === n.toLowerCase())),
      ...rest,
    ];
  }, [products]);
  const filters = ["All", ...categories, "New"];

  const list = products
    .filter(
      (p) =>
        category === "All" ||
        (category === "New" ? isNew(p) : p.category.toLowerCase() === category.toLowerCase()),
    )
    .sort((a, b) => (sort === "low" ? a.price - b.price : sort === "high" ? b.price - a.price : 0));

  const key = category.toLowerCase();
  return (
    <main className="site-width pb-20 pt-10">
      <p className="eyebrow mb-4 text-muted-foreground">The Heritage Collection</p>
      <h1 className="page-title">{headingFor(category)}</h1>
      <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
        {key === "women" ? WOMEN : key === "men" ? MEN : GENERAL}
      </p>
      <div className="mb-8 mt-10 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b pb-4">
        <nav aria-label="Filter by category" className="flex flex-wrap gap-1">
          {filters.map((c) => (
            <Button
              key={c}
              variant={c.toLowerCase() === key ? "default" : "ghost"}
              size="sm"
              aria-pressed={c.toLowerCase() === key}
              onClick={() => navigate({ search: { category: c }, resetScroll: false })}
            >
              {c === "New" ? "New arrivals" : c}
            </Button>
          ))}
        </nav>
        <select
          aria-label="Sort products"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="max-w-[125px] rounded-sm border bg-background p-2 text-xs"
        >
          <option value="featured">Featured</option>
          <option value="low">Price: low to high</option>
          <option value="high">Price: high to low</option>
        </select>
      </div>
      <p className="mb-5 text-xs text-muted-foreground" role="status">
        {list.length} {list.length === 1 ? "piece" : "pieces"}
      </p>
      <h2 className="sr-only">Products</h2>
      {list.length ? (
        <div className="product-grid">
          {list.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      ) : (
        <EmptyProducts />
      )}
    </main>
  );
}
