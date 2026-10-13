import {createContext,useContext,useState,type ReactNode} from 'react';
import type {Product} from '@/lib/catalog';
type BagItem = {product:Product;size:string;quantity:number};
type Store = {bag:BagItem[];bagOpen:boolean;setBagOpen:(v:boolean)=>void;add:(p:Product,s:string)=>void;change:(id:string,size:string,delta:number)=>void;favorites:string[];favorite:(id:string)=>void};
const StoreContext=createContext<Store | null>(null);
export function StoreProvider({children}:{children:ReactNode}) {
 const [bag,setBag]=useState<BagItem[]>([]);const [bagOpen,setBagOpen]=useState(false);const [favorites,setFavorites]=useState<string[]>([]);
 function add(product:Product,size:string){setBag(old=>{const found=old.find(x=>x.product.id===product.id&&x.size===size);return found?old.map(x=>x===found?{...x,quantity:x.quantity+1}:x):[...old,{product,size,quantity:1}];});setBagOpen(true);}
 function change(id:string,size:string,delta:number){setBag(old=>old.map(x=>x.product.id===id&&x.size===size?{...x,quantity:delta===0?0:x.quantity+delta}:x).filter(x=>x.quantity>0));}
 return <StoreContext.Provider value={{bag,bagOpen,setBagOpen,add,change,favorites,favorite:(id)=>setFavorites(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id])}}>{children}</StoreContext.Provider>;
}
export function useStore(){const value=useContext(StoreContext);if(!value)throw new Error('StoreProvider is required');return value;}
