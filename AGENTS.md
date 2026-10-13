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
- Keep catalog data in a shared browser-safe module and shopping state in a root-level React provider so route navigation preserves the current bag and favorites.
- Use dedicated content routes for the storefront, collections, product details, and brand story so navigation and page metadata remain distinct.
- Treat the catalog as an explicit sample preview: do not collect payments or claim newsletter subscriptions are saved until real commerce services are connected.
- Store supplied editorial page copy in a shared browser-safe content module, with thin dedicated route files and a reusable page layout to maintain consistent presentation and unique metadata.
