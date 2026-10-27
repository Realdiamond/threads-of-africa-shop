# Hosting The Threads of Africa shop on Railway

**Who this is for:** the person hosting the shop. You do not need to know the code. Follow the steps in order; each one says what to click or type and how to tell it worked.

**What you will end up with:** the shop running on Railway with its own database, a custom domain with HTTPS, payments through Stripe (test mode first, then live), and emails through Resend — ready for the owner to log in to the admin and add real products.

**How long:** about 1–2 hours the first time, plus waiting for DNS.

---

## 0. The picture in one minute

- The shop is **one web service** (a Node.js server) plus **one PostgreSQL database**, both in one Railway project. Nothing else is needed: no Redis, no file storage, no separate worker (product photos live in the database; emails and housekeeping run inside the web service).
- Railway builds it from the GitHub repo using the settings already in `railway.json`: build with `bun run build`, start with `bun run start` (which first applies any database changes, then starts the server), health check at `/healthz`.
- Secrets (Stripe, email key, database address) live **only in Railway's Variables**. They are never put in the repo.

| Thing | Where it comes from |
| --- | --- |
| Code | GitHub repo `Realdiamond/threads-of-africa-shop` (branch `main` once the pull request is merged; until then `feature/own-postgres-backend`) |
| Database | Railway PostgreSQL service |
| Payments | Stripe account (client's) |
| Emails | Resend account + the shop's domain |
| Domain | Wherever the domain is registered |

---

## 1. Before you start

Gather these. Nothing below works without them.

- [ ] **Railway account** with a paid plan (the free trial is not suitable for a live shop). Ask the owner whose account/billing it should live under.
- [ ] **GitHub access** to the repo, and permission to connect Railway to it (Railway asks to install its GitHub app).
- [ ] **The code on the branch you will deploy.** The work is in pull request #1 on branch `feature/own-postgres-backend`. The owner should merge it into `main` first (note: merging breaks the old Lovable preview — that is expected). If you must start before the merge, deploy the feature branch and switch to `main` later (Step 3.6).
- [ ] **Stripe** account access (test keys now; the client's live keys at launch).
- [ ] **Resend** account (free tier is fine to start) and access to the **domain's DNS settings**.
- [ ] The **final website address**, for example `https://thethreadsofafrica.com`.
- [ ] On **your own computer** (only needed for Step 5 — the one-time setup commands): [Bun](https://bun.sh) and `git`. Optional but handy: the [Railway CLI](https://docs.railway.com/guides/cli) (`npm i -g @railway/cli`, then `railway login`).

---

## 2. Create the project and the database

1. Go to **railway.com → New Project → Deploy from GitHub repo**. Choose `threads-of-africa-shop`. (If the repo is not listed, click **Configure GitHub App** and grant access.)
2. Railway creates a **service** from the repo and starts a first build. **It will fail or crash for now — that is normal**, because the database does not exist yet. Carry on.
3. In the project canvas click **+ New → Database → Add PostgreSQL**. Wait until it shows as running. Rename the web service to something clear like `web` if you like (Service → Settings → Service Name). The database service is called `Postgres`.

> Keep the **web service and Postgres in the same project and environment** (`production`). They talk over Railway's private network.

---

## 3. Configure the web service

Open the `web` service.

### 3.1 Variables (Service → **Variables** tab)

Add these **now** (the others come later, in Steps 7–9):

| Variable | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Use **Add Variable Reference** and pick `Postgres → DATABASE_URL`, or paste exactly `${{Postgres.DATABASE_URL}}` (replace `Postgres` if you named the database service differently). This is the **private** address; it only works from inside Railway. |
| `SITE_URL` | `https://<the-railway-domain>` for now | You get the Railway domain in 3.3. Later (Step 6) change it to the real domain. **No trailing slash.** |

Do **not** set `PORT` or `NODE_ENV` (Railway and the start script handle them). Do **not** set `PAYMENTS_PROVIDER` or `ALLOW_MOCK_PAYMENTS` — those are for testing only and open the shop to free "payments".

Click **Deploy** (or the banner "Apply changes") after adding variables.

### 3.2 Check the build settings (Service → **Settings**)

Everything should already come from `railway.json`. Just confirm:

- **Build → Build Command:** `bun run build`
- **Deploy → Start Command:** `bun run start`
- **Deploy → Healthcheck Path:** `/healthz` (timeout 60 s)
- **Deploy → Restart policy:** On failure, 5 retries
- **Source → Branch:** the branch you chose in Step 1 (`main` after the merge)
- **Deploy → Replicas / Scaling: exactly 1.** Do not scale to several copies (the shop's rate limiting and background jobs assume a single process).
- **Region:** pick the one closest to the customers, and put the database in the **same region**.

The repo pins **Node 22** (`.node-version`, `engines` in `package.json`). If the build log shows a different major version, set the service variable `NODE_VERSION=22`.

### 3.3 Get a public address (Service → **Settings → Networking**)

Click **Generate Domain**. Railway gives you `something.up.railway.app`. Put `https://something.up.railway.app` into `SITE_URL` (Step 3.1) and redeploy.

### 3.4 First deploy — what success looks like

Open **Deployments → the latest → View logs**.

*Build log* ends without errors (about 1–3 minutes).

*Deploy log* shows, in order:

```
migrations applied
➜ Listening on: http://localhost:<port>/ (all interfaces)
{"level":"info","msg":"background jobs started", ...}
```

and the deployment turns **Active** (the health check passed). Then check from any computer:

```sh
curl https://something.up.railway.app/healthz          # → {"status":"ok"}
```

Open the address in a browser: the shop loads (with no products yet).

### 3.5 If it does not come up

See **Troubleshooting** at the end. The usual causes: `DATABASE_URL` missing or not a reference to the Postgres service; building the wrong branch; a typo in the Start Command.

### 3.6 Switching branches later

After the pull request is merged, change **Source → Branch** to `main`. Every push to that branch then deploys automatically. (Optional: turn on **Wait for CI** if you add CI checks later.)

---

## 4. Turn on database backups (do this early)

Orders, customers and product photos live **only** in this database.

1. Open the **Postgres** service → **Backups** (available on paid plans) and enable a **daily** schedule (add weekly/monthly if offered).
2. Write down who is responsible for checking the backups, and **practice one restore** into a spare database before launch.

---

## 5. One-time setup: starter products and the first admin account

These two commands fill the empty database. Run them **once**. They run from your computer, so they need the database's **public** address (the `DATABASE_URL` from Step 3 is private and will not connect from outside Railway).

1. In Railway open the **Postgres** service → **Variables** and copy **`DATABASE_PUBLIC_URL`**. (If it does not exist: Postgres → **Settings → Networking → Public Networking → enable TCP Proxy**, then it appears.)
2. On your computer:

```sh
git clone https://github.com/Realdiamond/threads-of-africa-shop.git
cd threads-of-africa-shop
git checkout main            # or feature/own-postgres-backend if not merged yet
bun install

# paste the PUBLIC url between the quotes
export DATABASE_URL='postgresql://postgres:…@….proxy.rlwy.net:…/railway'

bun run db:seed              # the 4 starter products — only ever run on an empty shop
bun run admin:create -- --email owner@theirdomain.com --name "Owner Name" --role owner
```

Expected: `seeded 4 products`, then `Created owner account for Owner Name <…>` and a **temporary password shown once**. Copy it and give it to the owner securely (a password manager or direct message — not a shared group chat). The owner is forced to choose their own password at first sign-in at `https://<address>/admin`.

3. Close the terminal (or `unset DATABASE_URL`). **Never run `db:seed` with `--force` on a live shop** — it overwrites products.

> Do not run `bun run db:seed` again after the owner starts editing products. The seed refuses to run if products exist, which protects against accidents.

Check: sign in at `/admin` with the temporary password → you are asked to set a new one → the dashboard opens with a **launch checklist**. Most items will be red/amber at this point; that is expected.

---

## 6. The real domain

1. Service → **Settings → Networking → Custom Domain → + Custom Domain**. Add the bare domain (`thethreadsofafrica.com`) **and** `www.thethreadsofafrica.com`.
2. Railway shows the DNS records to create. At the domain registrar's DNS settings add exactly those. Typically:
   - `www` → **CNAME** → the target Railway shows;
   - the bare/apex domain → **CNAME/ALIAS/ANAME** → the target Railway shows (some registrars call apex CNAME "flattening"; if yours cannot, move DNS to Cloudflare, which can).
3. Wait until Railway shows both domains with a green check (minutes to a few hours). HTTPS certificates are issued automatically.
4. **Change `SITE_URL`** to the final address, e.g. `https://thethreadsofafrica.com` (bare domain, no trailing slash, `https`). Redeploy.
5. Check:

```sh
curl -sI http://www.thethreadsofafrica.com/shop | head -3     # → 301, Location: https://thethreadsofafrica.com/shop
curl -sI https://www.thethreadsofafrica.com/    | head -3     # → 301 to the bare domain
curl -s  https://thethreadsofafrica.com/healthz               # → {"status":"ok"}
curl -s  https://thethreadsofafrica.com/robots.txt            # → ends with Sitemap: https://thethreadsofafrica.com/sitemap.xml
```

The shop redirects `www.` and plain `http://` to `SITE_URL` by itself; Railway's own health check address is never redirected.

---

## 7. Email (Resend)

Without this, receipts, shipping emails, contact-form messages and account emails are queued but never sent.

1. **resend.com → Domains → Add Domain** (use the shop's domain). Add the DNS records Resend shows (SPF/DKIM/…) at the registrar and wait for **Verified**. This step is what keeps receipts out of spam.
2. **API Keys → Create** (permission: *Sending access*). Copy the key.
3. In Railway → web service → Variables add:

| Variable | Example |
| --- | --- |
| `RESEND_API_KEY` | `re_…` |
| `EMAIL_FROM` | `The Threads of Africa <orders@thethreadsofafrica.com>` (must be on the verified domain) |

4. Redeploy. Check: on the live site use the **Contact** form; the message should arrive at the shop's contact email within a minute, and the admin dashboard item **Sending emails** turns green.

---

## 8. Stripe — test mode

(The owner/client's Stripe account. Do this in **test mode**: the "Test mode" switch is at the top right of the Stripe dashboard.)

1. **Developers → API keys** → copy the **Secret key** (`sk_test_…`). (The *Publishable key* is **not** used by this shop — customers pay on Stripe's own page.)
2. **Developers → Webhooks → Add endpoint** (in some versions "Event destinations"):
   - **Endpoint URL:** `https://<SITE_URL host>/api/stripe/webhook` — the **final** address, exactly as `SITE_URL` (not the `www.` or `http://` form; Stripe does not follow redirects).
   - **Events to send** — select exactly these six:
     `checkout.session.completed`
     `checkout.session.expired`
     `checkout.session.async_payment_succeeded`
     `checkout.session.async_payment_failed`
     `charge.refunded`
     `charge.dispute.created`
   - Create the endpoint, open it and **Reveal the Signing secret** (`whsec_…`).
3. In Railway → web service → Variables:

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (from the endpoint in step 2) |

4. Redeploy. **Checkout stays closed unless BOTH variables are set** — that is deliberate.
5. **Place a test order** (this proves the whole chain):
   1. On the live site, add a product to the bag → **Checkout**, fill the form (use a real email you can read), choose a delivery option → **Continue to payment**.
   2. On Stripe's page use card `4242 4242 4242 4242`, any future expiry, any 3-digit CVC, any postcode.
   3. You should land on **"Thank you — your order is confirmed"** within a few seconds, receive the receipt email, and see the order in `/admin/orders` as **Paid — to ship**.
   4. In Stripe → Webhooks → your endpoint → **Recent deliveries** the events should show **200**.
   5. In the admin open the order and press **Refund this order** → confirm it shows **Refunded** (and that Stripe → Payments shows the refund).
6. The admin dashboard now says **"Stripe is connected in TEST mode"** (amber). That is right until Step 10.

> Test and live mode in Stripe are separate worlds: **separate keys and a separate webhook with its own signing secret**. The shop ignores events from the other mode on purpose.

---

## 9. Final checks before telling anyone the shop is open

- [ ] `https://<domain>/healthz` → `{"status":"ok"}`; `www` and `http` redirect to the bare `https` address.
- [ ] Admin login works; the owner has their own password.
- [ ] Contact form email arrives; a test order produced a receipt email and an order in the admin; refund works.
- [ ] The **launch checklist on the admin dashboard** is all green except the Stripe test-mode warning (the owner completes: delivery prices confirmed, policy pages reviewed, real products/photos/stock, social links).
- [ ] Postgres **backups** are on.
- [ ] No `PAYMENTS_PROVIDER` / `ALLOW_MOCK_PAYMENTS` variables exist.
- [ ] Replicas = 1.

---

## 10. Going live with real payments

Only when the owner has confirmed prices, policies and products. Use the client's **activated** Stripe account (Stripe asks for business and bank details first).

1. Switch Stripe's **Test mode off**. **Developers → API keys** → copy the **live** secret key (`sk_live_…`).
2. **Developers → Webhooks → Add endpoint** in **live mode**: same URL and the same six events as Step 8. Reveal its **new** signing secret.
3. In Railway **replace** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` with the **live** values. Redeploy. (Enter them directly in Railway — do not paste live keys into chat or tickets.)
4. The admin dashboard now shows **"Taking payments — Stripe is connected with live keys"** (green).
5. Make **one real purchase** of the cheapest item with a real card, confirm the order, the receipt and the Stripe payment, then **refund it** from the order page.
6. Announce.

---

## 11. Day-to-day: deploys, logs, rollbacks

| I want to… | Do this |
| --- | --- |
| Deploy a change | Merge/push to the branch Railway watches. Railway builds and deploys; database changes apply automatically at start. |
| See what is happening | Web service → **Deployments → View logs** (live) or the **Logs** tab. Logs are one JSON object per line; search for words like `error`, `webhook`, `email`. Customer details are not written to logs. |
| Roll back a bad deploy | Web service → **Deployments** → pick the previous good one → **⋯ → Redeploy** (or *Rollback*). Database changes only ever add things, so older code keeps working. |
| Change a setting/key | Web service → **Variables** → edit → **Deploy**. |
| Look at the data | Postgres service → **Data** tab (or connect with `psql "$DATABASE_PUBLIC_URL"`). Read first; take a backup before changing anything. |
| Restart | Web service → **⋯ → Restart**. |

Everything else (stuck orders, missing emails, a webhook failing, restoring a backup) is in **[docs/operations.md](operations.md)**. The owner's own how-to is **[docs/admin-guide.md](admin-guide.md)**.

---

## 12. Troubleshooting the hosting itself

| Symptom | Likely cause → fix |
| --- | --- |
| Build fails with "bun: command not found" / wrong package manager | Railway picked the wrong builder. Service → Settings → **Build → Builder**: choose **Railpack** (or Nixpacks) and redeploy. The repo has `bun.lock`, so Bun should be detected. |
| Build fails on the Node version | Set variable `NODE_VERSION=22`. |
| Deploy log: `DATABASE_URL is not set` or `connection refused` | The variable is missing or is not the reference `${{Postgres.DATABASE_URL}}`. Re-add it as a reference. Make sure both services are in the same project/environment. |
| Deploy log: `migration failed` | Read the line above it. Most often the database is not reachable yet (redeploy) or someone changed the database by hand. Do not edit the migrations table; ask a developer. |
| Deployment stays "Deploying" then fails the health check | Open the deploy log. If you see `Listening on …` but the health check fails, the database is unreachable (`/healthz` returns 503). Check `DATABASE_URL`, the Postgres service status, and the region. |
| `bun run db:seed` from my laptop: connection error / `postgres.railway.internal` not found | You used the **private** URL. Use `DATABASE_PUBLIC_URL` (Step 5). |
| Site loads but checkout says "Checkout isn't open yet" | `STRIPE_SECRET_KEY` and/or `STRIPE_WEBHOOK_SECRET` is missing, malformed (must start `sk_`/`rk_` and `whsec_`), or `PAYMENTS_PROVIDER=mock` is set. Fix and redeploy. |
| Paid on Stripe but the order stays "waiting" | The webhook is not arriving or is rejected. Stripe → Webhooks → recent deliveries: 400 = wrong signing secret (test vs live mix-up); 404 = the endpoint is on the wrong address, or Stripe keys are not set; no deliveries = wrong URL. See operations.md. |
| Redirect loop or `ERR_TOO_MANY_REDIRECTS` | `SITE_URL` does not match the domain people use (for example it is `https://www…` while DNS points the bare domain, or it still has the railway.app address). Set it to the final bare `https://` address. |
| Emails not arriving | `RESEND_API_KEY`/`EMAIL_FROM` missing or the domain is not verified in Resend. Dashboard checklist → "Sending emails". After fixing, press **Retry them** on the dashboard. |
| Everything was fine, then nothing sends/expires | A background job stalled (rare). Restart the web service. |

---

## 13. Handover: who holds what

Write these down in the team's password manager, **not** in the repo or in chat:

| Secret / access | Lives in | Owner |
| --- | --- | --- |
| Railway project access | Railway → Project Settings → Members | invite devs/owner with the roles they need |
| `DATABASE_URL`, Stripe keys, Resend key | Railway variables only | rotate if anyone leaves or a key is exposed |
| Stripe dashboard login | Stripe | the client |
| Resend login, domain DNS login | Resend, registrar | the client / DevOps |
| First admin's temporary password | given once | the owner (forced to change it) |

If a key is ever exposed (pasted in chat, screenshot, committed): **roll it** — Stripe → API keys → *Roll key* (then update Railway); Resend → delete and recreate the key; for the webhook secret: Stripe → the endpoint → *Roll secret*.

---

## 14. What happens next (after hosting)

1. DevOps finishes Steps 1–9 and sends back: the **live address**, confirmation that a **test order** went through, and any problems.
2. The **owner** logs in, replaces the starter products with the real collection (photos, prices, sizes, stock, details and fabric/care text), sets real **delivery prices and tax**, reviews the **policy pages**, and adds social links and the WhatsApp number — the dashboard checklist tracks it. See [docs/admin-guide.md](admin-guide.md).
3. Switch to **live Stripe keys** (Step 10), one real test purchase and refund.
4. Go live. Keep [docs/operations.md](operations.md) handy for the first weeks, and check the dashboard daily for **orders that need attention**.
