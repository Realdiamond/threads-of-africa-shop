import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { CartResult, CartView } from "@/lib/cart-types";
import type { Product } from "@/lib/catalog";
import {
  addCartLineFn,
  createCartFn,
  getCartFn,
  removeCartLineFn,
  updateCartLineFn,
} from "@/backend/store.functions";

export interface CartItem {
  lineId: string;
  product: Product;
  variantId: string;
  variantTitle: string;
  price: { amount: string; currencyCode: string };
  quantity: number;
  selectedOptions: Array<{ name: string; value: string }>;
}

export type CartActionResult = { ok: true } | { ok: false; message: string };

interface CartStore {
  items: CartItem[];
  cartId: string | null;
  isLoading: boolean;
  isSyncing: boolean;
  bagOpen: boolean;
  notice: string | null;
  setBagOpen: (open: boolean) => void;
  addItem: (item: Omit<CartItem, "lineId">) => Promise<CartActionResult>;
  updateQuantity: (variantId: string, quantity: number) => Promise<void>;
  removeItem: (variantId: string) => Promise<void>;
  clearCart: () => void;
  syncCart: () => Promise<void>;
}

const GENERIC_ERROR = "We couldn't update your bag. Please try again.";

// The server owns line ids, quantities and prices; the browser only keeps the product
// details (name, image) it needs to draw each line.
function itemsFromCart(cart: CartView, known: Array<Omit<CartItem, "lineId">>): CartItem[] {
  const byVariant = new Map(known.map((item) => [item.variantId, item]));
  return cart.lines.flatMap((line) => {
    const base = byVariant.get(line.variantId);
    return base
      ? [{ ...base, lineId: line.lineId, quantity: line.quantity, price: line.price }]
      : [];
  });
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => {
      const applyCart = (
        result: Extract<CartResult, { ok: true }>,
        extra?: Omit<CartItem, "lineId">,
      ) => {
        const known = extra ? [...get().items, extra] : get().items;
        if (result.cart.lines.length === 0) set({ items: [], cartId: null });
        else set({ items: itemsFromCart(result.cart, known), cartId: result.cart.cartId });
      };

      // A bag the server no longer has (expired) is dropped; any other failure is shown in the bag.
      const handleFailure = (result: Extract<CartResult, { ok: false }>) => {
        if (result.code === "CART_NOT_FOUND") get().clearCart();
        set({ notice: result.message });
      };

      return {
        items: [],
        cartId: null,
        isLoading: false,
        isSyncing: false,
        bagOpen: false,
        notice: null,
        setBagOpen: (open) => set({ bagOpen: open, notice: null }),

        addItem: async (item) => {
          set({ isLoading: true, notice: null });
          try {
            const input = { variantId: item.variantId, quantity: item.quantity };
            const { cartId } = get();
            let result = cartId
              ? await addCartLineFn({ data: { cartId, ...input } })
              : await createCartFn({ data: input });
            if (!result.ok && result.code === "CART_NOT_FOUND" && cartId) {
              // The saved bag expired on the server: start a fresh one with this item.
              set({ items: [], cartId: null });
              result = await createCartFn({ data: input });
            }
            if (!result.ok) return { ok: false, message: result.message };
            applyCart(result, item);
            return { ok: true };
          } catch (error) {
            console.error("Failed to add item:", error);
            return { ok: false, message: GENERIC_ERROR };
          } finally {
            set({ isLoading: false });
          }
        },

        updateQuantity: async (variantId, quantity) => {
          if (quantity <= 0) {
            await get().removeItem(variantId);
            return;
          }
          const { items, cartId } = get();
          const item = items.find((i) => i.variantId === variantId);
          if (!item || !cartId) return;

          set({ isLoading: true, notice: null });
          try {
            const result = await updateCartLineFn({
              data: { cartId, lineId: item.lineId, quantity },
            });
            if (result.ok) applyCart(result);
            else handleFailure(result);
          } catch (error) {
            console.error("Failed to update quantity:", error);
            set({ notice: GENERIC_ERROR });
          } finally {
            set({ isLoading: false });
          }
        },

        removeItem: async (variantId) => {
          const { items, cartId } = get();
          const item = items.find((i) => i.variantId === variantId);
          if (!item || !cartId) {
            set({ items: items.filter((i) => i.variantId !== variantId) });
            return;
          }

          set({ isLoading: true, notice: null });
          try {
            const result = await removeCartLineFn({ data: { cartId, lineId: item.lineId } });
            if (result.ok) applyCart(result);
            else handleFailure(result);
          } catch (error) {
            console.error("Failed to remove item:", error);
            set({ notice: GENERIC_ERROR });
          } finally {
            set({ isLoading: false });
          }
        },

        clearCart: () => set({ items: [], cartId: null }),

        syncCart: async () => {
          const { cartId, isSyncing, isLoading } = get();
          if (!cartId || isSyncing || isLoading) return;

          set({ isSyncing: true });
          try {
            const result = await getCartFn({ data: { cartId } });
            // A bag action that started while we were fetching is newer than this snapshot.
            if (get().isLoading) return;
            if (result.ok) applyCart(result);
            else if (result.code === "CART_NOT_FOUND") get().clearCart();
          } catch (error) {
            console.error("Failed to sync cart:", error);
          } finally {
            set({ isSyncing: false });
          }
        },
      };
    },
    {
      name: "toa-cart",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ items: state.items, cartId: state.cartId }),
    },
  ),
);

export function useCartSync() {
  const syncCart = useCartStore((state) => state.syncCart);

  useEffect(() => {
    syncCart(); // Sync on initial page load (picks up stock/price changes and expired bags)
    // Sync when the shopper returns to the tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") syncCart();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [syncCart]);
}
