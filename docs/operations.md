# Operations runbook

What to do when something looks wrong. Logs are one JSON object per line (Railway → the web service → Logs; search for the words in **bold** below). Customer details, order links and bag ids are never written to the logs.

For SQL: Railway → Postgres service → Data/Connect, or `railway connect Postgres`. **Read first, change second**, and take a backup before changing anything.

## "Customers say they paid but have no order / no receipt"

Likely the Stripe webhook is not getting through. Check in order:

1. Stripe → Developers → Webhooks → your endpoint → recent deliveries. Failures (red) show the reason.
2. **`payment webhook with a bad signature refused`** in the logs → `STRIPE_WEBHOOK_SECRET` doesn't match this endpoint (or test/live mixed up). Copy the signing secret from the endpoint into Railway and redeploy.
3. **`a payment webhook arrived but Stripe is not set up on this server`** → a Stripe variable is missing, or `PAYMENTS_PROVIDER=mock` is set. Fix the variables.
4. The endpoint URL must be exactly `https://<SITE_URL host>/api/stripe/webhook` — Stripe does not follow redirects, so it must not be the `www.` or `http://` address that redirects.
5. After fixing, in Stripe press **Resend** on the failed events (or wait: Stripe retries for up to 3 days). Replays are safe — each event is applied once.

Orders left unconfirmed are cancelled about an hour after their hold expires; if the customer did pay, the late payment **restores the order automatically** when the event is delivered (and tells you if some items sold out meanwhile). Until then, check **Stripe → Payments** against **Orders** for anything missing. **Do not refund in Stripe before checking Orders** — if the paid event arrives afterwards the order would be marked paid for a refunded payment.

## An order is stuck "Awaiting payment" and won't release

The sweep runs every minute and releases orders past their hold, waiting up to an hour more if Stripe says the page might still be paid. A payment for the **wrong amount** is held for 7 days on purpose (the dashboard lists it); decide in Stripe, then:

```sql
-- cancel it and put its items back (replace the order number)
begin;
with o as (update orders set status='cancelled', cancelled_at=now(), expires_at=null
           where number = 1234 and status='pending_payment' returning id)
select id from o;
update variants v set stock = stock + l.stock_held
  from order_lines l join orders o on o.id = l.order_id
  where o.number = 1234 and l.variant_id = v.id and l.stock_held > 0;
update order_lines set stock_held = 0 where order_id = (select id from orders where number = 1234);
commit;
```

## Stock numbers look wrong

Stock is *taken* when an order is placed and returned when it is cancelled/expired/refunded. A product edited in the admin shows the number after current holds. Each order line records how many units it holds (`order_lines.stock_held`); compare against open orders before changing counts by hand.

## Emails aren't arriving

- Dashboard checklist → "Sending emails". No `RESEND_API_KEY` → emails queue (log line **`no email service is configured`**).
- A wrong key or unverified sending domain makes emails **fail permanently** (log **`email permanently failed`**). Fix Resend, then press **Retry them** on the dashboard — or:
  ```sql
  update email_outbox set status='pending', attempts=0, next_attempt_at=now() where status='failed';
  ```
- Receipts can be re-sent per order from the order page.

## Orders / emails / releases all stopped happening

Background jobs run inside the web process. Log line **`background job "…" has been running for over 5 minutes`** means one got stuck (usually a database connection that silently dropped). The next run restarts it automatically; if nothing recovers, **restart the Railway service**. `/healthz` only proves the database answers a query.

## Wrong keys in production

- Test keys (`sk_test_…`) on the live site mean customers can "pay" with test cards: the dashboard checklist shows an amber warning. Replace with live keys + the live webhook secret.
- `PAYMENTS_PROVIDER=mock` takes orders **without money**. It is refused unless the process is in development or `ALLOW_MOCK_PAYMENTS=true`; the dashboard shows a warning when it is active. Remove both variables.

## Rotating the Stripe webhook secret

Stripe → the endpoint → *Roll secret* (optionally keeping the old one valid for a while), then update `STRIPE_WEBHOOK_SECRET` in Railway and redeploy. Events signed with the old secret during the gap are retried by Stripe.

## Restoring the database from a backup

Orders paid after the backup are missing, but Stripe already told us "received", so they won't be re-sent on their own. After a restore: Stripe → Developers → Events → resend `checkout.session.completed` events from after the backup time (each resend is safe). Check Payments against Orders afterwards.

## A customer paid twice

Open the duplicate order → *Refund this order…*. (The checkout closes the earlier payment page before opening a new one, so this should only happen if someone pays in two browsers at once.)

## A chargeback (dispute)

You get an email and a note on the order. Reply with evidence in Stripe before the deadline; if the parcel hasn't shipped, hold it.

## Deploys

Migrations run automatically at start (`bun run start`). They only add things; to undo a deploy, redeploy the previous version in Railway. Old and new code overlap for a few seconds during a deploy; the order logic is safe for that (all state changes are guarded in the database).
