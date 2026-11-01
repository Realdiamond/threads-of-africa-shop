import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import campaign from "@/assets/campaign.jpg";
import kids from "@/assets/kids.jpg";
import lineup from "@/assets/products.jpg";
import story from "@/assets/story.jpg";
import { EmptyProducts, ProductCard } from "@/components/product-card";
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

// A wide photo for the top of each collection; any other category uses the campaign photo.
function bannerFor(category: string): [string, string] {
  const key = category.toLowerCase();
  if (key === "men") return [story, "A couple in heritage-inspired outfits"];
  if (key === "kids") return [kids, "Children in playful African-print outfits"];
  if (key === "new") return [lineup, "New pieces from the collection"];
  return [campaign, "Models wearing the Threads of Africa collection"];
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
  const [banner, bannerAlt] = bannerFor(category);
  return (
    <main className="pb-24">
      <header className="shop-banner">
        <img src={banner} alt={bannerAlt} width={1600} height={900} fetchPriority="high" />
        <div className="site-width shop-banner-copy">
          <p className="eyebrow eyebrow-gold mb-4">The Heritage Collection</p>
          <h1 className="page-title">{headingFor(category)}</h1>
          <p className="mt-4">{key === "women" ? WOMEN : key === "men" ? MEN : GENERAL}</p>
        </div>
      </header>
      <div className="shop-toolbar">
        <div className="site-width flex items-center gap-4 py-3">
          <nav
            aria-label="Filter by category"
            className="flex gap-2 overflow-x-auto flex-1 min-w-0 [scrollbar-width:none]"
          >
            {filters.map((c) => (
              <button
                key={c}
                type="button"
                className="filter-chip"
                aria-pressed={c.toLowerCase() === key}
                onClick={() => navigate({ search: { category: c }, resetScroll: false })}
              >
                {c === "New" ? "New arrivals" : c}
              </button>
            ))}
          </nav>
          <select
            aria-label="Sort products"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="h-9 shrink-0 border bg-background px-3 text-xs"
          >
            <option value="featured">Featured</option>
            <option value="low">Price: low to high</option>
            <option value="high">Price: high to low</option>
          </select>
        </div>
      </div>
      <div className="site-width pt-8">
        <p className="mb-6 text-xs uppercase tracking-[0.16em] text-muted-foreground" role="status">
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
      </div>
    </main>
  );
}
