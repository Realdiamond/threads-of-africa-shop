# The Threads of Africa — shop

Contemporary African fashion storefront: catalog, bag, brand story and information pages, backed by our own Postgres database. Payments (Stripe) are not connected yet; checkout shows "opening soon" until they are.

**Stack:** TanStack Start (React 19, SSR) · Tailwind CSS 4 · shadcn/ui · Postgres + Drizzle ORM · Vitest · runs as a plain Node server.

## Local development

You need Node.js 22+, [Bun](https://bun.sh) and a local Postgres.

```sh
bun install
cp .env.example .env          # then point DATABASE_URL at your local database
bun run db:migrate            # create the tables
bun run db:seed               # load the 4 starter products (first time only)
bun run dev
```

| Command | What it does |
| --- | --- |
| `bun run dev` | Dev server with hot reload |
| `bun run build` / `bun run start` | Production build / run it (applies migrations first) |
| `bun run db:generate` | Generate a SQL migration after editing `src/backend/db/schema.ts` |
| `bun run db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `bun run db:seed` | Load starter products; refuses if products already exist (`-- --force` overwrites) |
| `bun run test` | Unit tests, plus database tests when `TEST_DATABASE_URL` is set |
| `bun run lint` / `bun run format` | ESLint / Prettier |

Database tests truncate their tables, so `TEST_DATABASE_URL` must point at a database whose name contains `test` (for example `toa_test`).

## Deploying on Railway

1. Create a Railway project from this repo and add a **Postgres** service.
2. On the web service, add the variable `DATABASE_URL` as a reference to the Postgres service's `DATABASE_URL`.
3. Deploy. `railway.json` builds with `bun run build`, starts with `bun run start` (which applies migrations, then launches the server) and health-checks `/healthz`.
4. First deploy only: load the starter products with `railway run bun run db:seed`.
5. Attach the custom domain in the service's Networking settings and update DNS.

Later, add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` once the Stripe account exists. Secrets are server-side environment variables only — never commit them.

## Project layout

- `src/routes/` — pages (file-based routing) and the `/healthz` route
- `src/backend/` — database schema, catalog and cart logic, server functions
- `src/components/`, `src/stores/`, `src/lib/` — UI, bag state, shared types and brand copy
- `db/migrations/`, `db/seed/` — SQL migrations and starter data
- `AGENTS.md` — architecture rules for contributors
