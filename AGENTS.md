## Storefront architecture
- The backend lives in this repo (`src/backend/`): our own Postgres database (Drizzle schema in `src/backend/db/schema.ts`, SQL migrations in `db/migrations/`, generated with `bun run db:generate` and committed). The UI reaches it only through TanStack server functions in `src/backend/*.functions.ts`. Never reintroduce Shopify or a hardcoded/mock product catalog; starter data lives in `db/seed/`.
- Server-only code lives in `src/backend/` and in `*.server.ts` files. Never name a directory `server` inside client-reachable code: import protection denies `**/server/**` in the browser bundle.
- Prices, stock, delivery, tax and totals are always computed on the server from the database; the browser only sends ids, quantities and the chosen delivery option.
- Bag state lives in a zustand store (`src/stores/cart-store.ts`, persisted to localStorage as `toa-cart`) so route navigation preserves it. It keeps the cart id plus display snapshots; the server cart is the source of truth for line ids, quantities and prices. A cart id is a bearer credential: never log it or put it in a URL.
- Favorites stay in the root-level React provider (`src/components/store-context.tsx`) and are saved to localStorage (`toa-favorites`) so they survive navigation and reloads.
- Use dedicated content routes for the storefront, collections, product details, and brand story so navigation and page metadata remain distinct.
- Store supplied editorial page copy in a shared browser-safe content module (`src/lib/brand-content.ts`), with thin dedicated route files and a reusable page layout to maintain consistent presentation and unique metadata.
- Production is a plain Node server on Railway (Nitro `node-server` preset, set in `vite.config.ts`). Railway checks `/healthz`, and migrations run at start (`bun run start`, which also sets `NODE_ENV=production`). Background jobs (email outbox, releasing unpaid orders, housekeeping) run inside the web process.
- Database tests need a real Postgres: set `TEST_DATABASE_URL` to a database whose name contains `test`; without it those tests are skipped.

## Orders and payments (money rules — do not weaken)
- An order becomes **paid only from a signature-verified webhook** (`src/routes/api.stripe.webhook.ts` → `handlePaymentEvent` in `src/backend/order-payments.server.ts`), never from the browser redirect. Webhook events are claimed by id in `webhook_events` inside the same transaction as their effects; a payment whose amount/currency doesn't match the order is never marked paid.
- Checkout is open only when a payment provider is configured (`src/backend/payments.server.ts`): `STRIPE_SECRET_KEY` **and** `STRIPE_WEBHOOK_SECRET`. `PAYMENTS_PROVIDER=mock` (a fake pay page) is allowed only in development or with `ALLOW_MOCK_PAYMENTS=true`, never next to a live key; it must keep failing closed.
- Stock is taken when an order is placed (conditional `UPDATE … WHERE stock >= qty`) and given back exactly once via `order_lines.stock_held` and status-guarded transitions. Every status change is a guarded `UPDATE … WHERE status = …` (see `ORDER_TRANSITIONS` in `src/lib/order-types.ts`); never write to `orders.status` unguarded.
- Anything that calls Stripe or sends email happens **outside** database transactions (emails go through the `email_outbox`, queued inside the transaction). Provider calls that move money carry idempotency keys.
- The guest order link (`/orders/<id>?t=<token>`) is a bearer credential for reading that one order and cancelling it while unpaid. The token is stored as given (emails need it), compared in constant time, and always starts with a letter (see `newAccessToken`) so the router never reads it as a number. Never log it.
- Logs must not contain customer details, order tokens or cart ids: errors go through `errorFields` / `describeError`, which cut the values out of failed database queries (`src/lib/redact.ts`). Don't `console.log` request data.

## Customer accounts
- Guest checkout always works; accounts are optional (`src/backend/customers/`). Passwords are set only by following an emailed, single-use, hashed link (so an address can't be claimed by registering it first); responses never reveal whether an address has an account. Sessions are hashed tokens in an HttpOnly, SameSite=Lax cookie (`toa_session`); admin sessions are separate (`toa_admin_session`, SameSite=Strict).
- A customer sees an order only if `orders.customer_id` is theirs; guest orders are linked when the email address is proven.

## Routes and the address bar
- The router turns JSON-looking query values into numbers/booleans (`?placed=1` → `1`). Read search params with `searchText` / `searchFlag` from `src/lib/search-params.ts`, and redirect targets with `safeNext`.
- Pages that must not be indexed (admin, account, checkout, orders) say so in `robots.txt` (generated in `src/backend/seo.server.ts`) and set `noindex`.

## Admin
- Admin server functions use the middleware tiers in `src/backend/admin.functions.ts` (`anyAdmin` / `activeAdmin` / `ownerOnly`); refunds, exports of customer data, prices of delivery, policies and the team are owner-only. Admin actions that change anything worth auditing call `recordAudit`.
- The dashboard's launch checklist (`src/backend/admin/launch.server.ts`) must be updated when a new thing is required before launch.

## Style
- Legacy dense files (`src/components/store-shell.tsx`, `brand-page.tsx`, `product-card.tsx`, `src/routes/index.tsx`, `src/lib/brand-content.ts`) are left as they are unless a change is needed; run Prettier/ESLint on files you create or substantially change, not the whole tree.
