import { createContext, useContext, useState, type ReactNode } from 'react';
const StoreContext = createContext<{ favorites: string[]; favorite: (id: string) => void } | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<string[]>([]);
  return (
    <StoreContext.Provider
      value={{ favorites, favorite: (id) => setFavorites((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id])) }}
    >
      {children}
    </StoreContext.Provider>
  );
}
export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('StoreProvider is required');
  return value;
}
