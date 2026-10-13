import {Link} from '@tanstack/react-router';
import {Heart} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useStore} from './store-context';
import {money,type Product} from '@/lib/catalog';
export function ProductCard({product}:{product:Product}) {
 const {favorites,favorite}=useStore();const selected=favorites.includes(product.id);
 return <article><div className="product-photo"><Link to="/product/$id" params={{id:product.id}}><img src={product.image} alt={product.name} width={512} height={1024} loading="lazy"/></Link>{product.tag&&<span className="product-tag">{product.tag}</span>}<Button variant="ghost" size="icon" className="favorite" title={selected?'Remove from favorites':'Save to favorites'} aria-label={`${selected?'Unsave':'Save'} ${product.name}`} onClick={()=>favorite(product.id)}><Heart className={selected?'fill-primary text-primary':''}/></Button></div><div className="product-info"><Link to="/product/$id" params={{id:product.id}}><h3>{product.name}</h3><p className="text-muted-foreground text-[11px] mt-1">{product.category} · {product.color}</p></Link><span>{money(product.price)}</span></div><div className="swatches" aria-label={`${product.color} color`}><span className={`swatch ${product.color==='Sunflower'?'gold':product.color==='Forest'?'':'neutral'}`}/><span className="swatch neutral"/></div></article>;
}
