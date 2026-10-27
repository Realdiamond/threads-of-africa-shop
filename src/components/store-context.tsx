import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const KEY = "toa-favorites";
const StoreContext = createContext<{ favorites: string[]; favorite: (id: string) => void } | null>(
  null,
);

// Saved pieces are kept in the browser so they are still there after a refresh or a return visit.
// They are loaded after the first render (never during it) so the server and browser agree.
export function StoreProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<string[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(saved)) {
        const ids = saved.filter((id): id is string => typeof id === "string").slice(0, 200);
        // Anything saved in this tab before the load finished is kept too.
        setFavorites((now) => [...new Set([...ids, ...now])]);
      }
    } catch {
      // Storage unavailable or corrupted: start empty.
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(favorites));
    } catch {
      // Private browsing or a full disk: favorites still work for this visit.
    }
  }, [favorites]);

  return (
    <StoreContext.Provider
      value={{
        favorites,
        favorite: (id) =>
          setFavorites((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id])),
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error("StoreProvider is required");
  return value;
}
