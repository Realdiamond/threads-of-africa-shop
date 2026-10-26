import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight, Check, ChevronDown, Heart } from "lucide-react";
import { useState } from "react";

import { ProductCard } from "@/components/product-card";
import { useStore } from "@/components/store-context";
import { Button } from "@/components/ui/button";
import { money, productsQueryOptions, sizeOf, type Product } from "@/lib/catalog";
import { useCartStore } from "@/stores/cart-store";

const BRAND = "The Threads of Africa";

const shorten = (text: string, max = 155) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

// Search engines read this to show price and availability next to the listing. `<` is escaped so
// nothing in a product's text can close the script tag.
function productJsonLd(product: Product, siteUrl: string) {
  const absolute = (url: string) => (url.startsWith("/") ? `${siteUrl}${url}` : url);
  const prices = product.variants.map((v) => Number(v.price.amount));
  const inStock = product.variants.some((v) => v.availableForSale);
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.images.map((i) => absolute(i.url)),
    brand: { "@type": "Brand", name: BRAND },
    category: product.category,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: product.currencyCode,
      lowPrice: Math.min(...prices).toFixed(2),
      highPrice: Math.max(...prices).toFixed(2),
      offerCount: product.variants.length,
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: `${siteUrl}/product/${product.id}`,
    },
  }).replace(/</g, "\\u003c");
}

export const Route = createFileRoute("/product/$id")({
  loader: async ({ context, params }) => {
    const products = await context.queryClient.ensureQueryData(productsQueryOptions);
    const product = products.find((p) => p.id === params.id);
    // A real "not found" answer (404), so search engines drop pieces that no longer exist.
    if (!product) throw notFound();
    return product;
  },
  head: ({ loaderData, matches }) => {
    // The root route is always the first match; its loader knows the shop's public address.
    const root = matches[0]?.loaderData as { siteUrl?: string } | undefined;
    const siteUrl = root?.siteUrl ?? "";
    if (!loaderData) return { meta: [{ title: `Piece unavailable — ${BRAND}` }] };
    const title = `${loaderData.name} — ${BRAND}`;
    const description = shorten(
      loaderData.description || "Discover contemporary African-inspired clothing.",
    );
    const photo = loaderData.images[0]?.url;
    const image = photo && siteUrl ? (photo.startsWith("/") ? `${siteUrl}${photo}` : photo) : null;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "product" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(image
          ? [
              { property: "og:image", content: image },
              { name: "twitter:image", content: image },
            ]
          : []),
      ],
      links: siteUrl ? [{ rel: "canonical", href: `${siteUrl}/product/${loaderData.id}` }] : [],
      scripts: siteUrl
        ? [{ type: "application/ld+json", children: productJsonLd(loaderData, siteUrl) }]
        : [],
    };
  },
  notFoundComponent: PieceMissing,
  component: ProductPage,
});

function PieceMissing() {
  return (
    <main className="site-width py-20">
      <h1 className="page-title">This piece isn’t here.</h1>
      <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">
        It may have sold out for good or moved. Have a look at what is in the collection now.
      </p>
      <Button asChild className="mt-6">
        <Link to="/shop" search={{ category: "All" }}>
          Explore the collection
        </Link>
      </Button>
    </main>
  );
}

// The main photo with a row of small ones underneath to switch between them.
function Gallery({ product }: { product: Product }) {
  const photos = product.images.length
    ? product.images
    : [{ url: product.image, alt: product.imageAlt }];
  const [active, setActive] = useState(0);
  const current = photos[Math.min(active, photos.length - 1)];
  if (!current) return null;
  return (
    <div>
      <img
        className="detail-photo"
        src={current.url}
        alt={current.alt}
        width={512}
        height={1024}
        fetchPriority="high"
      />
      {photos.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="More photos">
          {photos.map((photo, index) => (
            <li key={photo.url}>
              <button
                type="button"
                onClick={() => setActive(index)}
                aria-label={`Show photo ${index + 1} of ${photos.length}`}
                aria-pressed={index === active}
                className={`block border-2 ${index === active ? "border-foreground" : "border-transparent"}`}
              >
                <img
                  src={photo.url}
                  alt=""
                  width={64}
                  height={80}
                  loading="lazy"
                  className="h-20 w-16 object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const FALLBACK_DETAILS =
  "A considered silhouette with an expressive African-inspired print. Choose your usual size for the best fit.";
const FALLBACK_CARE =
  "Gentle cold wash and air dry. Full material and care details are listed with each garment.";

function Info({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="border-t py-4 text-sm">
      <summary className="flex cursor-pointer list-none justify-between">
        {title}
        <ChevronDown className="size-4" />
      </summary>
      <div className="mt-4 whitespace-pre-line text-xs leading-6 text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

function ProductPage() {
  const product = Route.useLoaderData();
  const [size, setSize] = useState("");
  const [error, setError] = useState(false);
  const [addError, setAddError] = useState("");
  const store = useStore();
  const cart = useCartStore();

  const p = product;
  const sizes = p.variants.filter((v) => v.availableForSale).map(sizeOf);

  const addToBag = async () => {
    const variant = p.variants.find((v) => sizeOf(v) === size && v.availableForSale);
    if (!variant) {
      setError(true);
      return;
    }
    const result = await cart.addItem({
      product: p,
      variantId: variant.id,
      variantTitle: variant.title,
      price: variant.price,
      quantity: 1,
      selectedOptions: variant.selectedOptions,
    });
    if (result.ok) {
      setAddError("");
      cart.setBagOpen(true);
    } else setAddError(result.message);
  };

  return (
    <main className="site-width py-8 sm:py-12">
      <div className="mb-7 text-xs text-muted-foreground">
        <Link to="/shop" search={{ category: "All" }}>
          Collection
        </Link>
        <span className="mx-3">/</span>
        {p.name}
      </div>
      <div className="product-detail">
        <Gallery key={p.id} product={p} />
        <div className="py-4">
          <p className="eyebrow mb-5 text-muted-foreground">The Heritage Collection</p>
          <h1 className="text-4xl leading-tight">{p.name}</h1>
          <p className="mt-5 text-xl">{money(p.price, p.currencyCode)}</p>
          <p className="mb-7 mt-7 text-sm leading-7 text-muted-foreground">{p.description}</p>
          {p.color && (
            <p className="mb-6 text-sm">
              Color: <span className="text-muted-foreground">{p.color}</span>
            </p>
          )}
          {sizes.length > 0 && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm">Select size{size ? `: ${size}` : ""}</p>
                <Button asChild variant="link" className="h-auto p-0 text-xs">
                  <Link to="/size-guide">Size guide</Link>
                </Button>
              </div>
              <div className="size-buttons">
                {sizes.map((s) => (
                  <Button
                    key={s}
                    variant={size === s ? "default" : "outline"}
                    className="h-11 w-12 rounded-none"
                    aria-pressed={size === s}
                    onClick={() => {
                      setSize(s);
                      setError(false);
                      setAddError("");
                    }}
                  >
                    {s}
                  </Button>
                ))}
              </div>
              {error && (
                <p role="alert" className="mt-3 text-xs text-destructive">
                  Please select a size.
                </p>
              )}
            </>
          )}
          <div className="mt-7 flex gap-3">
            <Button
              className="h-12 flex-1 rounded-none"
              disabled={cart.isLoading || sizes.length === 0}
              onClick={addToBag}
            >
              {sizes.length === 0 ? (
                "Unavailable"
              ) : (
                <>
                  Add to bag <ArrowRight className="ml-4" />
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-12 w-12 rounded-none"
              aria-label={
                store.favorites.includes(p.id) ? "Remove from favorites" : "Save to favorites"
              }
              aria-pressed={store.favorites.includes(p.id)}
              onClick={() => store.favorite(p.id)}
            >
              <Heart className={store.favorites.includes(p.id) ? "fill-primary" : ""} />
            </Button>
          </div>
          {addError && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {addError}
            </p>
          )}
          <p className="my-6 flex items-center gap-2 text-xs text-muted-foreground">
            <Check className="size-4" />A statement you can make your own.
          </p>
          <Info title="Details & fit">{p.details || FALLBACK_DETAILS}</Info>
          <Info title="Fabric & care">{p.materialsCare || FALLBACK_CARE}</Info>
          <Info title="Shipping & returns">
            <p>
              See our{" "}
              <Link to="/shipping" className="underline underline-offset-4">
                shipping &amp; delivery
              </Link>{" "}
              and{" "}
              <Link to="/returns" className="underline underline-offset-4">
                returns &amp; exchanges
              </Link>{" "}
              pages for delivery options, costs and how exchanges work.
            </p>
          </Info>
        </div>
      </div>
      <section className="pb-8 pt-16">
        <h2 className="mb-8 text-3xl">A little more expression.</h2>
        <RelatedGrid currentId={p.id} />
      </section>
    </main>
  );
}

function RelatedGrid({ currentId }: { currentId: string }) {
  const { data: products } = useSuspenseQuery(productsQueryOptions);
  const others = products.filter((x) => x.id !== currentId);
  return others.length ? (
    <div className="product-grid">
      {others.map((x) => (
        <ProductCard key={x.id} product={x} />
      ))}
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">More pieces are coming soon.</p>
  );
}
