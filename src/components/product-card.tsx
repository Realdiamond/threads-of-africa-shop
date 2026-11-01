import { Link } from "@tanstack/react-router";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "./store-context";
import { money, sizeOf, type Product } from "@/lib/catalog";

export function ProductCard({ product }: { product: Product }) {
  const { favorites, favorite } = useStore();
  const selected = favorites.includes(product.id);
  // A second photo, when there is one, fades in on hover so shoppers see another angle.
  const second = product.images[1];
  const sizes = product.variants.filter((v) => v.availableForSale).map(sizeOf);
  const soldOut = sizes.length === 0;
  return (
    <article>
      <div className="product-photo">
        <Link to="/product/$id" params={{ id: product.id }} aria-label={product.name}>
          <img src={product.image} alt={product.imageAlt} width={512} height={683} loading="lazy" />
          {second && (
            <img
              className="alt-photo"
              src={second.url}
              alt=""
              width={512}
              height={683}
              loading="lazy"
            />
          )}
          {!soldOut && sizes.length > 1 && (
            <span className="size-peek" aria-hidden="true">
              {sizes.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </span>
          )}
        </Link>
        {soldOut ? (
          <span className="product-tag sold-out">Sold out</span>
        ) : (
          product.tag && <span className="product-tag">{product.tag}</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="favorite rounded-full size-[38px] max-[760px]:size-[34px] [&_svg]:size-[18px]"
          title={selected ? "Remove from favorites" : "Save to favorites"}
          aria-label={`${selected ? "Unsave" : "Save"} ${product.name}`}
          onClick={() => favorite(product.id)}
        >
          <Heart className={selected ? "fill-primary text-primary" : ""} />
        </Button>
      </div>
      <div className="product-info">
        <Link to="/product/$id" params={{ id: product.id }}>
          <h3>{product.name}</h3>
          <p className="text-muted-foreground text-xs mt-1">
            {product.category}
            {product.color ? ` · ${product.color}` : ""}
          </p>
        </Link>
        <span>{money(product.price, product.currencyCode)}</span>
      </div>
    </article>
  );
}

export function EmptyProducts() {
  return (
    <div className="py-20 text-center">
      <p className="page-title serif">No products found.</p>
      <p className="text-sm text-muted-foreground mt-4 max-w-md mx-auto leading-7">
        The collection is being prepared. New pieces will appear here as soon as they are added to
        the store.
      </p>
    </div>
  );
}
