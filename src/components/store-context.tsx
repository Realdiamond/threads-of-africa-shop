import {createContext,useContext,useState,type ReactNode} from 'react';
type Store = {bagOpen:boolean;setBagOpen:(v:boolean)=>void;favorites:string[];favorite:(id:string)=>void};
const StoreContext=createContext<Store | null>(null);
export function StoreProvider({children}:{children:ReactNode}) {
  const [bagOpen,setBagOpen]=useState(false);
  const [favorites,setFavorites]=useState<string[]>([]);
  return <StoreContext.Provider value={{bagOpen,setBagOpen,favorites,favorite:(id)=>setFavorites(old=>old.includes(id)?old.filter(x=>x!==id):[...old,id])}}>{children}</StoreContext.Provider>;
}
export function useStore(){const value=useContext(StoreContext);if(!value)throw new Error('StoreProvider is required');return value;}
