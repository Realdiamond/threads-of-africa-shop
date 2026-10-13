import {createFileRoute,Link} from '@tanstack/react-router';
import {useState} from 'react';
import {useSuspenseQuery} from '@tanstack/react-query';
import {ArrowRight,Heart,Check,ChevronDown,Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useStore} from '@/components/store-context';
import {ProductCard} from '@/components/product-card';
import {useCartStore} from '@/stores/cart-store';
import {productQueryOptions,productsQueryOptions,money,type ShopifyProduct} from '@/lib/shopify';

export const Route=createFileRoute('/product/$handle')({
  head:({params,loaderData})=>{
    const p=loaderData?.product as ShopifyProduct['node']|null|undefined;
    return {meta:[
      {title:`${p?.title??'Piece unavailable'} — The Threads of Africa`},
      {name:'description',content:p?.description?.slice(0,150)??'Explore the Threads of Africa collection.'},
      {property:'og:title',content:`${p?.title??'Collection'} — The Threads of Africa`},
      {property:'og:description',content:p?.description?.slice(0,150)??'Discover contemporary African-inspired clothing.'},
      {property:'og:type',content:'website'},
      {name:'twitter:card',content:'summary_large_image'},
    ]};
  },
  loader:({context,params})=>{context.queryClient.ensureQueryData(productQueryOptions(params.handle)).catch(()=>undefined)},
  component:ProductPage,
});

function ProductPage(){
  const {handle}=Route.useParams();
  const {data}=useSuspenseQuery(productQueryOptions(handle));
  const p=data as ShopifyProduct['node']|null;
  const {data:all=[]}=useSuspenseQuery(productsQueryOptions);
  const {favorites,favorite}=useStore();
  const addItem=useCartStore(state=>state.addItem);
  const isLoading=useCartStore(state=>state.isLoading);
  const [selected,setSelected]=useState<Record<string,string>>({});
  const [error,setError]=useState(false);

  if(!p)return <main className="site-width py-20"><h1 className="page-title">This piece isn’t here.</h1><Button asChild className="mt-6"><Link to="/shop" search={{category:'All'}}>Explore the collection</Link></Button></main>;

  const image=p.images?.edges?.[0]?.node;
  const price=p.priceRange.minVariantPrice;
  const sizeOption=p.options.find(o=>['size','sizes'].includes(o.name.toLowerCase()));
  const chosen=sizeOption?selected[sizeOption.name]:undefined;
  const variant=p.variants.edges.map(e=>e.node).find(v=>v.selectedOptions.every(o=>!selected[o.name]||selected[o.name]===o.value));

  const add=async()=>{
    if(sizeOption&&!chosen){setError(true);return;}
    if(!variant||!variant.availableForSale)return;
    await addItem({
      product:{id:p.id,title:p.title,handle:p.handle,image:image?.url??''},
      variantId:variant.id,
      variantTitle:variant.title,
      price:variant.price,
      quantity:1,
      selectedOptions:variant.selectedOptions??[],
    });
  };

  return <main className="site-width py-8 sm:py-12">
    <div className="text-xs text-muted-foreground mb-7"><Link to="/shop" search={{category:'All'}}>Collection</Link><span className="mx-3">/</span>{p.title}</div>
    <div className="product-detail">
      <img className="detail-photo" src={image?.url??''} alt={image?.altText??p.title} width={512} height={1024}/>
      <div className="py-4">
        <p className="eyebrow text-muted-foreground mb-5">The Heritage Collection</p>
        <h1 className="text-4xl leading-tight">{p.title}</h1>
        <p className="text-xl mt-5">{money(price.amount,price.currencyCode)}</p>
        <p className="text-sm leading-7 text-muted-foreground mt-7 mb-7">{p.description}</p>
        <p className="text-sm mb-6">Color: <span className="text-muted-foreground">{variant?.selectedOptions.find(o=>o.name.toLowerCase().startsWith('col'))?.value??'As shown'}</span></p>
        {sizeOption&&<>
          <div className="flex justify-between items-center mb-3"><p className="text-sm">Select size{chosen?`: ${chosen}`:''}</p><Button asChild variant="link" className="text-xs p-0 h-auto"><Link to="/size-guide">Size guide</Link></Button></div>
          <div className="size-buttons">{sizeOption.values.map(s=><Button key={s} variant={chosen===s?'default':'outline'} className="w-12 h-11 rounded-none" onClick={()=>{setSelected(old=>({...old,[sizeOption.name]:s}));setError(false)}}>{s}</Button>)}</div>
        </>}
        {error&&<p role="alert" className="text-destructive text-xs mt-3">Please select a size.</p>}
        <div className="flex gap-3 mt-7">
          <Button className="flex-1 h-12 rounded-none" disabled={isLoading||!variant||!variant.availableForSale} onClick={add}>{isLoading?<Loader2 className="size-4 animate-spin"/>:<>Add to bag <ArrowRight className="ml-4"/></>}</Button>
          <Button variant="outline" size="icon" className="h-12 w-12 rounded-none" aria-label="Save to favorites" onClick={()=>favorite(p.id)}><Heart className={favorites.includes(p.id)?'fill-primary':''}/></Button>
        </div>
        <p className="flex gap-2 items-center text-xs text-muted-foreground my-6"><Check className="size-4"/>A statement you can make your own.</p>
        {[['Details & fit','A considered silhouette with an expressive African-inspired print. Choose your usual size for the best fit.'],['Fabric & care','Gentle cold wash and air dry. Full fabric and care details are listed with each piece.'],['Shipping & returns','Delivery options and timelines are described on our shipping page. Returns are accepted within our published return window.']].map(([title,text])=><details className="border-t py-4 text-sm" key={title}><summary className="cursor-pointer list-none flex justify-between">{title}<ChevronDown className="size-4"/></summary><p className="text-xs leading-6 text-muted-foreground mt-4">{text}</p></details>)}
      </div>
    </div>
    <section className="pt-16 pb-8"><h2 className="text-3xl mb-8">A little more expression.</h2><ProductGrid products={(all as ShopifyProduct[]).filter(x=>x.node.id!==p.id).slice(0,4)}/></section>
  </main>;
}
