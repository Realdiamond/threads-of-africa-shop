import { and, eq, sql } from "drizzle-orm";

import type { ChecklistItem, LaunchChecklist } from "@/lib/admin-types";

import { getDb, type Db } from "../db/client.server";
import { productImages, products } from "../db/schema";
import { emailBacklog } from "../email/processor.server";
import { getEmailProvider } from "../email/provider.server";
import { listSitePages } from "../pages.server";
import { paymentMode, type PaymentMode } from "../payments.server";
import { getSettings } from "../settings.server";

type Env = Record<string, string | undefined>;

const paymentItem = (mode: PaymentMode): ChecklistItem => {
  switch (mode) {
    case "stripe-live":
      return {
        id: "payments",
        label: "Taking payments",
        status: "done",
        detail: "Stripe is connected with live keys: customers pay with real cards.",
      };
    case "stripe-test":
      return {
        id: "payments",
        label: "Taking payments",
        status: "warning",
        detail:
          "Stripe is connected in TEST mode: nobody can pay with a real card. When you are ready, switch to the live Stripe keys (STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Railway, or on the payments gateway together with PAYMENTS_GATEWAY_MODE=live).",
      };
    case "test-page":
      return {
        id: "payments",
        label: "Taking payments",
        status: "warning",
        detail:
          "The built-in TEST payment page is switched on, so anyone can 'pay' without money. Remove PAYMENTS_PROVIDER (and ALLOW_MOCK_PAYMENTS) in Railway before launch.",
      };
    default:
      return {
        id: "payments",
        label: "Taking payments",
        status: "todo",
        detail:
          "Checkout is closed. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Railway (or the PAYMENTS_GATEWAY_* variables; see the README for the addresses).",
      };
  }
};

export async function launchChecklist(
  db: Db = getDb(),
  env: Env = process.env,
): Promise<LaunchChecklist> {
  const [settings, pages, backlog, productRows, noPhoto] = await Promise.all([
    getSettings(db),
    listSitePages(db),
    emailBacklog(db),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(products)
      .where(eq(products.status, "active")),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(products)
      .where(
        and(
          eq(products.status, "active"),
          sql`not exists (select 1 from ${productImages} i where i.product_id = ${products.id})`,
        ),
      ),
  ]);

  const provider = getEmailProvider(env);
  const reviewed = pages.filter((page) => page.reviewedAt !== null).length;
  const live = productRows[0]?.total ?? 0;
  const withoutPhoto = noPhoto[0]?.total ?? 0;
  const socials = [
    settings.instagramUrl,
    settings.tiktokUrl,
    settings.facebookUrl,
    settings.pinterestUrl,
  ].filter(Boolean).length;

  const items: ChecklistItem[] = [
    paymentItem(paymentMode(env)),
    {
      id: "email",
      label: "Sending emails",
      status: provider?.name === "resend" ? "done" : provider ? "warning" : "todo",
      detail:
        provider?.name === "resend"
          ? "Receipts, shipping updates and contact-form messages are sent."
          : provider
            ? "Emails are only being printed to the server log, not sent."
            : "Receipts and shipping emails are queued but not sent. Add RESEND_API_KEY (and EMAIL_FROM) in Railway.",
    },
    {
      id: "site-url",
      label: "Website address set",
      status: env["SITE_URL"]?.trim() ? "done" : "todo",
      detail: env["SITE_URL"]?.trim()
        ? `Links in emails and Stripe use ${env["SITE_URL"].trim()}.`
        : "Set SITE_URL in Railway to your real address (for example https://thethreadsofafrica.com) so email links, share previews and the sitemap are right.",
    },
    {
      id: "products",
      label: "Products on sale",
      status: live > 0 ? "done" : "todo",
      detail:
        live > 0
          ? `${live} product${live === 1 ? "" : "s"} live.`
          : "Add a product and set it to Active.",
      href: "/admin/products",
    },
    {
      id: "photos",
      label: "Every product has a photo",
      status: live > 0 && withoutPhoto === 0 ? "done" : "todo",
      detail:
        live === 0
          ? "Nothing to check until a product is live."
          : withoutPhoto === 0
            ? "All live products have photos."
            : `${withoutPhoto} live product${withoutPhoto === 1 ? " has" : "s have"} no photo yet.`,
      href: "/admin/products",
    },
    {
      id: "shipping",
      label: "Delivery prices confirmed",
      status: settings.shippingConfirmedAt ? "done" : "todo",
      detail: settings.shippingConfirmedAt
        ? "An owner confirmed the delivery prices and tax."
        : "The starting delivery prices are placeholders. Check them, then press confirm.",
      href: "/admin/shipping",
    },
    {
      id: "policies",
      label: "Policy pages reviewed",
      status: reviewed === pages.length ? "done" : "todo",
      detail:
        reviewed === pages.length
          ? "Privacy, terms, shipping and returns have all been reviewed."
          : `${reviewed} of ${pages.length} reviewed. The starter wording is a draft: read it, adjust it, and mark each page reviewed.`,
      href: "/admin/pages",
    },
    {
      id: "social",
      label: "Social links",
      status: socials > 0 ? "done" : "todo",
      detail:
        socials > 0
          ? `${socials} social link${socials === 1 ? "" : "s"} shown in the footer.`
          : "Add your Instagram, TikTok, Facebook or Pinterest links so they appear in the footer.",
      optional: true,
      href: "/admin/settings",
    },
    {
      id: "whatsapp",
      label: "WhatsApp chat button",
      status: settings.whatsappNumber ? "done" : "todo",
      detail: settings.whatsappNumber
        ? "Visitors can message you on WhatsApp."
        : "Add a WhatsApp number to show a chat button on every page.",
      optional: true,
      href: "/admin/settings",
    },
  ];

  if (backlog.failed > 0) {
    items.push({
      id: "email-failed",
      label: "Emails that could not be sent",
      status: "warning",
      detail: `${backlog.failed} email${backlog.failed === 1 ? "" : "s"} failed permanently (a wrong key or unverified sending domain, usually). Fix that, then retry them.`,
    });
  }

  const required = items.filter((item) => !item.optional && item.id !== "email-failed");
  return {
    items,
    done: required.filter((item) => item.status === "done").length,
    required: required.length,
    emailBacklog: backlog,
  };
}
