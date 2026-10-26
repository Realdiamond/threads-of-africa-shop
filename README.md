# The Threads of Africa — shop

The online shop for The Threads of Africa: catalog, bag, checkout with Stripe, customer accounts, an admin dashboard for the team, and the brand pages — all in one app backed by its own Postgres database.

**Stack:** TanStack Start (React 19, server-rendered) · Tailwind CSS 4 · shadcn/ui · Postgres + Drizzle ORM · Stripe · Resend (email) · Vitest · runs as a plain Node server on Railway.

| You are… | Start here |
| --- | --- |
| **The owner** (running the shop day to day) | [Admin guide](docs/admin-guide.md) |
| **DevOps / deploying it** | [Launch guide](docs/launch-guide.md) |
| **Something is wrong in production** | [Operations runbook](docs/operations.md) |
| **A developer** | the rest of this page, and [`AGENTS.md`](AGENTS.md) |

## What is built

- **Storefront** — home, shop (filters follow the categories you create), product pages with photo gallery, kids' section, brand story pages, size guide, FAQ, contact form (also reaches WhatsApp), newsletter, privacy / terms / shipping / returns pages you can edit.
- **Checkout** — own checkout page (guest or signed in), delivery options and tax by country, Stripe-hosted payment page. Orders are confirmed only by Stripe's signed webhook.
- **Orders** — stock is held while a customer pays and released if they don't; shipping with tracking, refunds, receipts and shipping emails.
- **Customer accounts** — optional: order history, saved details at checkout, password reset. Guests are never forced to register.
- **Admin dashboard** (`/admin`) — products and photos, categories, orders, messages, subscribers, delivery prices and tax, policy pages, settings, team, activity log, and a **launch checklist** on the dashboard.
- **Search and sharing** — sitemap, robots, product data for Google, share previews, compressed pages, self-hosted fonts.

## Local development

You need Node.js 22+, [Bun](https://bun.sh) and a local Postgres.

```sh
bun install
cp .env.example .env          # then point DATABASE_URL at your local database
bun run db:migrate            # create the tables
bun run db:seed               # load the 4 starter products (first time only)
bun run admin:create -- --email you@example.com --name "Your Name" --role owner
bun run dev
```

To try the whole purchase without Stripe keys, add `PAYMENTS_PROVIDER=mock` to `.env`: checkout then uses a clearly-labelled test payment page (development only — see below).

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server with hot reload |
| `bun run build` / `bun run start` | Production build / run it (applies migrations first) |
| `bun run db:generate` | Generate a SQL migration after editing `src/backend/db/schema.ts` |
| `bun run db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `bun run db:seed` | Load starter products; refuses if products already exist (`-- --force` overwrites) |
| `bun run admin:create` | Create an admin account (prints a one-time password) |
| `bun run test` | Unit tests, plus database tests when `TEST_DATABASE_URL` is set |
| `bun run lint` / `bun run format` | ESLint / Prettier |

Database tests truncate their tables, so `TEST_DATABASE_URL` must point at a database whose name contains `test` (for example `toa_test`).

## Environment variables

Set these on the Railway web service (locally, in `.env`). Secrets are server-side only — never commit them.

| Variable | Needed | What it is |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** | Postgres connection string. On Railway, reference the Postgres service's `DATABASE_URL`. |
| `SITE_URL` | **Yes, in production** | The shop's public address, e.g. `https://thethreadsofafrica.com` (no trailing slash). Used in email links, Stripe return links, share previews, the sitemap, and to redirect `www.` and `http://` to this address. |
| `STRIPE_SECRET_KEY` | To take payments | `sk_test_…` while testing, `sk_live_…` to go live. |
| `STRIPE_WEBHOOK_SECRET` | To take payments | `whsec_…` from the Stripe webhook you create (see the launch guide). Checkout stays closed unless **both** Stripe variables are set. |
| `RESEND_API_KEY` | For emails | Receipts, shipping updates, contact-form and account emails. Without it emails queue up but are not sent. |
| `EMAIL_FROM` | Recommended | Sender, e.g. `The Threads of Africa <orders@thethreadsofafrica.com>`. Must be on a domain verified in Resend. |
| `PAYMENTS_PROVIDER=mock` | Testing only | Swaps Stripe for a fake "pay" page. Works only in development, or when `ALLOW_MOCK_PAYMENTS=true` is also set (staging copies). **Never** set it on the live shop; it is refused next to a live Stripe key. |
| `ALLOW_MOCK_PAYMENTS` | Staging only | See above. |
| `EMAIL_PROVIDER=console` | Testing only | Prints emails to the log instead of sending them. |
| `DISABLE_JOBS=true` | Optional | Turns off the in-process background jobs (email sending, releasing unpaid orders, cleanup). Leave unset. |
| `TEST_DATABASE_URL` | Tests only | A throwaway database whose name contains `test`. |

Railway sets `PORT` and `NODE_ENV` for you; `bun run start` sets `NODE_ENV=production`.

## Deploying on Railway (short version)

1. Create a Railway project from this repo and add a **Postgres** service.
2. On the web service add `DATABASE_URL` (reference to the Postgres service) and `SITE_URL`.
3. Deploy. `railway.json` builds with `bun run build`, starts with `bun run start` (applies migrations, then launches the server) and health-checks `/healthz`.
4. First deploy only: `railway run bun run db:seed` (starter products) and `railway run bun run admin:create -- --email … --name … --role owner`.
5. Attach the custom domain in Networking, then follow the **[launch guide](docs/launch-guide.md)** for Stripe, email and the final checks.

## How the pieces fit

- Everything the browser asks of the backend goes through TanStack server functions in `src/backend/*.functions.ts`; they call plain `*.server.ts` modules next to them. Nothing server-only is importable from client code.
- **Money is always worked out on the server** from the database. The browser only sends ids, quantities and the delivery choice.
- **An order becomes paid only from Stripe's verified webhook** (`src/routes/api.stripe.webhook.ts` → `src/backend/order-payments.server.ts`). Events are recorded by id so replays do nothing.
- Stock is taken when an order is placed (`orders.server.ts`) and returned exactly once if it is cancelled, expires or is refunded.
- Background jobs run inside the web process (`src/backend/jobs.server.ts`): email outbox every 15 s, release of unpaid orders every minute, housekeeping hourly. One Railway service is enough.

## Known limits (by design, for now)

- **One currency: US dollars.** Prices, delivery and tax are all in USD (Stripe charges USD). Selling in another currency means changing the catalog and checkout; ask a developer.
- Refunds from the admin are **full refunds**. A partial refund can be made in Stripe; it is noted on the order's history but the order stays "paid".
- No discount codes, gift cards or wishlists-per-account (favorites are kept in the browser).
- Tax is a percentage of the items per delivery zone; it is not calculated per state or product type.
- One web instance: the in-memory rate limiter and background jobs assume a single process (the order logic itself is safe with several).

## Project layout

- `src/routes/` — pages and server routes (file-based routing); `admin.*` is the dashboard, `account.*` customer accounts, `api.*` raw endpoints (Stripe webhook, uploads, CSV exports)
- `src/backend/` — database schema, catalog/cart/order/payment/customer logic, server functions, admin logic, email
- `src/components/`, `src/stores/`, `src/lib/` — UI, bag state, shared types and brand copy
- `db/migrations/`, `db/seed/` — SQL migrations and starter data
- `docs/` — guides for the owner, the launch and operations
- `AGENTS.md` — architecture rules for contributors
