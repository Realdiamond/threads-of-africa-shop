# Launch guide

> Hosting step by step (Railway, domain, Stripe, email) is in **[railway-deployment.md](railway-deployment.md)**. This page is the shorter checklist version and the things only a person can decide.

Everything needed to take the shop from "deployed" to "taking real orders". Work through it in order; the **launch checklist on the admin dashboard** shows what is still open at any time.

You need accounts at: **Railway** (hosting), **Stripe** (payments), **Resend** (email), and wherever the domain is registered.

## 1. Railway

1. Create a project from the GitHub repository. Add a **PostgreSQL** database service to the same project.
2. On the web service, open **Variables** and add:
   - `DATABASE_URL` → "Add reference" to the Postgres service's `DATABASE_URL`.
   - `SITE_URL` → the final address, e.g. `https://thethreadsofafrica.com` (no trailing slash). Until the domain is connected, use the `*.up.railway.app` address Railway gives you.
3. Deploy. The build runs `bun run build`; the service starts with `bun run start`, which applies database migrations and then launches the server. Railway checks `/healthz` (healthy = the app can reach the database).
4. From a computer with the repo and Bun, using the Postgres service's **public** address (`DATABASE_PUBLIC_URL`; the private `DATABASE_URL` does not connect from outside Railway), run, **once**:
   ```sh
   export DATABASE_URL='<the public url>'
   bun run db:seed            # the starter products and categories
   bun run admin:create -- --email owner@yourdomain.com --name "Owner Name" --role owner
   ```
   The second command prints a one-time password. Sign in at `/admin` and you will be asked to choose your own.
5. In **Networking** attach the custom domain. Add both `thethreadsofafrica.com` and `www.thethreadsofafrica.com`, and create the DNS records Railway shows. The shop redirects `www.` and `http://` to `SITE_URL` by itself.

> One web service is enough: emails, releasing unpaid orders and housekeeping run inside it. Do not scale it to several copies unless you also set `DISABLE_JOBS=true` on all but one (the jobs are safe to overlap, but there is no need).

## 2. Stripe (payments)

Stripe has two completely separate worlds, **test mode** and **live mode**, each with its own keys *and its own webhook*. Do test mode first.

### Test mode

1. In the Stripe dashboard, switch on **Test mode** (top right). Open **Developers → API keys** and copy the **Secret key** (`sk_test_…`).
2. **Developers → Webhooks → Add endpoint**:
   - Endpoint URL: `https://YOUR-DOMAIN/api/stripe/webhook`
   - Events to send (select exactly these):
     `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`
   - Create it, then reveal the **Signing secret** (`whsec_…`).
3. In Railway add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Redeploy. **Checkout stays closed unless both are set** — that is deliberate: taking money that could never be confirmed would be worse than not opening.
4. Place a test order on the live site address with card `4242 4242 4242 4242`, any future expiry, any CVC. You should land on a "Thank you" page, receive the receipt email, and see the order as **Paid — to ship** in `/admin/orders`. Try a refund from the order page too.
5. The dashboard checklist will say **"Stripe is connected in TEST mode"** — that is correct for now.

### Live mode (go-live day)

1. Complete Stripe's account activation (business details, bank account for payouts).
2. Switch Test mode **off**. Copy the **live** secret key (`sk_live_…`).
3. Create a **new webhook endpoint in live mode** with the same URL and the same six events; copy its signing secret. (The test webhook's secret does not work for live events.)
4. Replace `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Railway with the live values and redeploy. The checklist now says **"Taking payments — Stripe is connected with live keys"**.
5. Make one real purchase of the cheapest item with your own card, check it arrives in the admin and by email, then refund it from the order page.

The shop ignores webhook events from the other mode, so a stray test event can never mark a live order paid.

## 3. Email (Resend)

1. Create a Resend account, **add and verify your domain** (they show DNS records to add at your registrar — this is what stops receipts landing in spam).
2. Create an API key. In Railway add `RESEND_API_KEY` and `EMAIL_FROM` (for example `The Threads of Africa <orders@thethreadsofafrica.com>` — the domain must be the verified one).
3. Redeploy and send a message through the contact form: it should reach the shop's contact email. The dashboard checklist item "Sending emails" turns green.

If emails were queued before the key was added, or failed because of a wrong key, fix the cause and press **Retry them** on the dashboard.

## 4. Things only a person can decide (admin dashboard)

- **Delivery prices and tax** (`Shipping & tax`): the starting prices are placeholders. Replace them with real courier prices, check the tax rate per country, then press **confirm**.
- **Policy pages** (`Policy pages`): privacy, terms, shipping and returns start with sensible draft text. Read each, change what does not match how the shop really works, and mark it reviewed. Have a lawyer look at the terms and privacy pages if you can.
- **Products**: real photos, prices, sizes and stock; the long **Details & fit** and **Fabric & care** texts are shown on each product page.
- **Settings**: shop name, contact email, WhatsApp number, social links, announcement bar.

## 5. Search engines and Google

- Search Console: add the site, then submit `https://YOUR-DOMAIN/sitemap.xml`.
- Google Merchant Center (free product listings): add a product feed → scheduled fetch → `https://YOUR-DOMAIN/feeds/google.xml`.
- Share previews: paste a product link into WhatsApp or Instagram to check the picture and title.

## 6. Backups

In Railway, open the Postgres service and **enable backups**. Orders and customers live only in this database. Decide who checks that backups are running and practise one restore before launch (see the runbook for what to do afterwards).

## 7. Day-of checklist

- [ ] Dashboard checklist: every required item is green, none amber.
- [ ] Live Stripe keys and live webhook in place; one real purchase made and refunded.
- [ ] `SITE_URL` is the real address; `http://` and `www.` redirect to it.
- [ ] `PAYMENTS_PROVIDER` is **not** set.
- [ ] Receipt, shipping and contact emails arrive and are not in spam.
- [ ] Delivery prices confirmed; policy pages reviewed.
- [ ] Backups on.
- [ ] Someone knows where the [operations runbook](operations.md) is.
