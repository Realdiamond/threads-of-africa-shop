<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Storefront architecture
- Product catalog comes from the Shopify Storefront API (src/lib/shopify.ts, API version 2025-07) — never reintroduce a local sample catalog or mock products.
- Bag state lives in a zustand store (src/stores/cart-store.ts, persisted to localStorage) so route navigation preserves it; checkout always goes through a Storefront API cart checkout URL opened in a new tab.
- Favorites stay in the root-level React provider (src/components/store-context.tsx) so they survive navigation.
- Use dedicated content routes for the storefront, collections, product details, and brand story so navigation and page metadata remain distinct.
- Store supplied editorial page copy in a shared browser-safe content module (src/lib/brand-content.ts), with thin dedicated route files and a reusable page layout to maintain consistent presentation and unique metadata.
