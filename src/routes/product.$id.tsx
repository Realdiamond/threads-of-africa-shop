import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Heart,
  RefreshCw,
  ShieldCheck,
  Truck,
  ZoomIn,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ProductCard } from "@/components/product-card";
import { useStore } from "@/components/store-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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

type Photo = { url: string; alt: string };

// Full-screen view of the photos, with arrows (and the keyboard's arrow keys) to move between them.
function Lightbox({
  photos,
  index,
  onIndex,
  open,
  onOpenChange,
  name,
}: {
  photos: Photo[];
  index: number;
  onIndex: (i: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
}) {
  const go = (step: number) => onIndex((index + step + photos.length) % photos.length);
  const photo = photos[index];
  if (!photo) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-none w-screen h-[100svh] p-0 rounded-none border-0 bg-background sm:rounded-none flex items-center justify-center"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(1);
          if (e.key === "ArrowLeft") go(-1);
        }}
      >
        <DialogTitle className="sr-only">{name} photos</DialogTitle>
        <DialogDescription className="sr-only">
          Photo {index + 1} of {photos.length}
        </DialogDescription>
        <img
          src={photo.url}
          alt={photo.alt}
          className="max-h-[92svh] max-w-[94vw] object-contain"
        />
        {photos.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => go(-1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 size-12 grid place-items-center bg-background/90 border"
            >
              <ChevronLeft />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => go(1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 size-12 grid place-items-center bg-background/90 border"
            >
              <ChevronRight />
            </button>
            <p className="absolute bottom-5 left-1/2 -translate-x-1/2 text-xs tracking-[0.16em]">
              {index + 1} / {photos.length}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Desktop: a large photo with small ones underneath. Phones: swipe between full-width photos.
// Tapping any photo opens it full screen.
function Gallery({ product }: { product: Product }) {
  const photos: Photo[] = product.images.length
    ? product.images
    : [{ url: product.image, alt: product.imageAlt }];
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const current = photos[Math.min(active, photos.length - 1)];
  if (!current) return null;

  const onSwipe = () => {
    const el = track.current;
    if (el) setActive(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1)));
  };

  return (
    <div>
      <div className="gallery-desktop">
        <button
          type="button"
          className="gallery-main"
          onClick={() => setZoom(true)}
          aria-label="Zoom in on the photo"
        >
          <img src={current.url} alt={current.alt} width={640} height={800} fetchPriority="high" />
          <span className="zoom-hint" aria-hidden="true">
            <ZoomIn className="size-3.5" /> Zoom
          </span>
        </button>
        {photos.length > 1 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="More photos">
            {photos.map((photo, index) => (
              <li key={photo.url}>
                <button
                  type="button"
                  onClick={() => setActive(index)}
                  aria-label={`Show photo ${index + 1} of ${photos.length}`}
                  aria-pressed={index === active}
                  className={`block border ${index === active ? "border-foreground" : "border-transparent opacity-70 hover:opacity-100"}`}
                >
                  <img
                    src={photo.url}
                    alt=""
                    width={72}
                    height={90}
                    loading="lazy"
                    className="h-[90px] w-[72px] object-contain bg-muted"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="gallery-track" ref={track} onScroll={onSwipe}>
        {photos.map((photo, index) => (
          <button
            key={photo.url}
            type="button"
            onClick={() => {
              setActive(index);
              setZoom(true);
            }}
            aria-label={`Zoom in on photo ${index + 1} of ${photos.length}`}
          >
            <img
              src={photo.url}
              alt={photo.alt}
              width={640}
              height={800}
              loading={index === 0 ? "eager" : "lazy"}
            />
          </button>
        ))}
      </div>
      {photos.length > 1 && (
        <div className="gallery-dots" aria-hidden="true">
          {photos.map((photo, index) => (
            <span
              key={photo.url}
              className={`h-[3px] w-6 ${index === active ? "bg-foreground" : "bg-border"}`}
            />
          ))}
        </div>
      )}
      <Lightbox
        photos={photos}
        index={Math.min(active, photos.length - 1)}
        onIndex={setActive}
        open={zoom}
        onOpenChange={setZoom}
        name={product.name}
      />
    </div>
  );
}

const FALLBACK_DETAILS =
  "A considered silhouette with an expressive African-inspired print. Choose your usual size for the best fit.";
const FALLBACK_CARE =
  "Gentle cold wash and air dry. Full material and care details are listed with each garment.";

function Info({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group border-b py-5 text-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between text-[13px] font-medium uppercase tracking-[0.12em]">
        {title}
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-4 whitespace-pre-line text-sm leading-7 text-muted-foreground">
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
  const [showBar, setShowBar] = useState(false);
  const buyRef = useRef<HTMLDivElement>(null);
  const sizesRef = useRef<HTMLDivElement>(null);
  const store = useStore();
  const cart = useCartStore();

  const p = product;
  const sizes = p.variants.filter((v) => v.availableForSale).map(sizeOf);
  const saved = store.favorites.includes(p.id);

  // On phones, once the main "Add to bag" button has scrolled up out of view a slim bar keeps it
  // at hand (the bar itself is hidden on wider screens by the stylesheet).
  useEffect(() => {
    const update = () => {
      const el = buyRef.current;
      setShowBar(el ? el.getBoundingClientRect().bottom < 0 : false);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

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
    <main className="site-width pb-24 pt-6 sm:pt-10">
      <nav aria-label="Breadcrumb" className="mb-6 text-xs text-muted-foreground">
        <Link to="/shop" search={{ category: "All" }} className="hover:text-foreground">
          Shop
        </Link>
        <span className="mx-2">/</span>
        <Link to="/shop" search={{ category: p.category }} className="hover:text-foreground">
          {p.category}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{p.name}</span>
      </nav>
      <div className="product-detail">
        <Gallery key={p.id} product={p} />
        <div className="buy-box">
          <p className="eyebrow mb-4 text-muted-foreground">
            {p.tag ? `${p.tag} · ` : ""}The Heritage Collection
          </p>
          <h1 className="text-5xl leading-[1.02]">{p.name}</h1>
          <p className="mt-4 text-xl">{money(p.price, p.currencyCode)}</p>
          <p className="mb-7 mt-6 text-[15px] leading-7 text-muted-foreground">{p.description}</p>
          {p.color && (
            <p className="mb-6 text-sm">
              Colour: <span className="text-muted-foreground">{p.color}</span>
            </p>
          )}
          {sizes.length > 0 && (
            <div ref={sizesRef} className="scroll-mt-28">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm">Size{size ? `: ${size}` : ""}</p>
                <Link to="/size-guide" className="text-xs underline underline-offset-4">
                  Size guide
                </Link>
              </div>
              <div className="size-buttons">
                {sizes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="size-btn"
                    aria-pressed={size === s}
                    onClick={() => {
                      setSize(s);
                      setError(false);
                      setAddError("");
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {error && (
                <p role="alert" className="mt-3 text-xs text-destructive">
                  Please select a size.
                </p>
              )}
            </div>
          )}
          <div ref={buyRef} className="mt-7 flex gap-3">
            <button
              type="button"
              className="cta cta-solid h-[54px] flex-1 disabled:opacity-60"
              disabled={cart.isLoading || sizes.length === 0}
              onClick={addToBag}
            >
              {sizes.length === 0 ? (
                "Sold out"
              ) : (
                <>
                  Add to bag <ArrowRight />
                </>
              )}
            </button>
            <Button
              variant="outline"
              size="icon"
              className="h-[54px] w-[54px] rounded-none"
              aria-label={saved ? "Remove from favorites" : "Save to favorites"}
              aria-pressed={saved}
              onClick={() => store.favorite(p.id)}
            >
              <Heart className={saved ? "fill-primary" : ""} />
            </Button>
          </div>
          {addError && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {addError}
            </p>
          )}
          <ul className="assurance">
            <li>
              <Truck />
              <span>
                Delivery to your country — options and costs are shown at checkout.{" "}
                <Link to="/shipping" className="underline underline-offset-4">
                  Shipping
                </Link>
              </span>
            </li>
            <li>
              <ShieldCheck />
              <span>Secure checkout, powered by Stripe.</span>
            </li>
            <li>
              <RefreshCw />
              <span>
                Exchanges and returns —{" "}
                <Link to="/returns" className="underline underline-offset-4">
                  how they work
                </Link>
                .
              </span>
            </li>
          </ul>
          <Info title="Details & fit">{p.details || FALLBACK_DETAILS}</Info>
          <Info title="Fabric & care">{p.materialsCare || FALLBACK_CARE}</Info>
        </div>
      </div>
      <section className="pt-20">
        <div className="section-heading">
          <div>
            <p className="eyebrow text-muted-foreground">Complete the look</p>
            <h2>You may also like.</h2>
          </div>
          <Link to="/shop" search={{ category: "All" }} className="text-link shrink-0">
            Shop all <ArrowRight />
          </Link>
        </div>
        <RelatedGrid currentId={p.id} category={p.category} />
      </section>
      {sizes.length > 0 && (
        <div className="sticky-buy" data-visible={showBar} aria-hidden={!showBar}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{p.name}</p>
            <p className="text-xs text-muted-foreground">
              {money(p.price, p.currencyCode)}
              {size ? ` · ${size}` : ""}
            </p>
          </div>
          <button
            type="button"
            tabIndex={showBar ? 0 : -1}
            className="cta cta-solid h-12 px-5 disabled:opacity-60"
            disabled={cart.isLoading}
            onClick={() => {
              if (size) void addToBag();
              else sizesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {size ? "Add to bag" : "Select size"}
          </button>
        </div>
      )}
    </main>
  );
}

// Pieces from the same category first, then the rest of the collection; four at most.
function RelatedGrid({ currentId, category }: { currentId: string; category: string }) {
  const { data: products } = useSuspenseQuery(productsQueryOptions);
  const others = products.filter((x) => x.id !== currentId);
  const ordered = [
    ...others.filter((x) => x.category === category),
    ...others.filter((x) => x.category !== category),
  ].slice(0, 4);
  return ordered.length ? (
    <div className="product-row">
      {ordered.map((x) => (
        <ProductCard key={x.id} product={x} />
      ))}
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">More pieces are coming soon.</p>
  );
}
