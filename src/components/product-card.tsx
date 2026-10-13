import {Link} from '@tanstack/react-router';
import {Heart, ShoppingBag, Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useStore} from './store-context';
import {useCartStore} from '@/stores/cart-store';
import {money, type ShopifyProduct} from '@/lib/shopify';

export function ProductCard({product}: {product: ShopifyProduct}) {
  const {favorites, favorite} = useStore();
  const addItem = useCartStore(state => state.addItem);
  const isLoading = useCartStore(state => state.isLoading);
  const node = product.node;
  const image = node.images?.edges?.[0]?.node;
  const variant = node.variants.edges[0]?.node;
  const saved = favorites.includes(node.id);

  const handleAddToCart = async () => {
    if (!variant) return;
    await addItem({
      product: {id: node.id, title: node.title, handle: node.handle, image: image?.url ?? ''},
      variantId: variant.id,
      variantTitle: variant.title,
      price: variant.price,
      quantity: 1,
      selectedOptions: variant.selectedOptions ?? [],
    });
  };

  return <article>
    <div className="product-photo">
      <Link to="/product/$handle" params={{handle: node.handle}}>
        <img src={image?.url ?? ''} alt={image?.altText ?? node.title} width={512} height={1024} loading="lazy"/>
      </Link>
      {node.tags.includes('new') && <span className="product-tag">New arrival</span>}
      <Button variant="ghost" size="icon" className="favorite" title={saved ? 'Remove from favorites' : 'Save to favorites'} aria-label={`${saved ? 'Unsave' : 'Save'} ${node.title}`} onClick={() => favorite(node.id)}>
        <Heart className={saved ? 'fill-primary text-primary' : ''}/>
      </Button>
    </div>
    <div className="product-info">
      <Link to="/product/$handle" params={{handle: node.handle}}>
        <h3>{node.title}</h3>
        <p className="text-muted-foreground text-[11px] mt-1">{node.productType}{variant?.selectedOptions.find(o => o.name.toLowerCase() === 'color' || o.name.toLowerCase() === 'colour') ? ` · ${variant.selectedOptions.find(o => o.name.toLowerCase() === 'color' || o.name.toLowerCase() === 'colour')!.value}` : ''}</p>
      </Link>
      <span>{money(node.priceRange.minVariantPrice.amount, node.priceRange.minVariantPrice.currencyCode)}</span>
    </div>
    <Button size="sm" variant="outline" className="w-full rounded-none h-10 mt-2 text-xs" disabled={isLoading || !variant || !variant.availableForSale} onClick={handleAddToCart}>
      {isLoading ? <Loader2 className="size-4 animate-spin"/> : <><ShoppingBag className="size-4"/> Add to bag</>}
    </Button>
  </article>;
}

export function ProductGrid({products, columns}:{products:ShopifyProduct[];columns?:number}) {
  if (products.length === 0) return (
    <div className="py-16 text-center">
      <p className="text-lg">No products found</p>
      <p className="text-sm text-muted-foreground mt-3 max-w-md mx-auto leading-7">The collection hasn’t been stocked yet. Tell us in the chat what your first piece is — name and price — and we’ll add it to the store.</p>
    </div>
  );
  return <div className="product-grid" style={columns ? {gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`} : undefined}>
    {products.map(p => <ProductCard key={p.node.id} product={p}/>)}
  </div>;
}
