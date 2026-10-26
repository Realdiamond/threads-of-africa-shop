import { eq } from "drizzle-orm";

import { centsToAmount } from "./catalog.server";
import { getDb, type Db } from "./db/client.server";
import { products } from "./db/schema";
import { siteUrl } from "./site-url.server";

// Pages anyone may visit and search engines should know about.
const STATIC_PAGES = [
  "/",
  "/shop",
  "/kids",
  "/story",
  "/heritage",
  "/craft",
  "/responsibility",
  "/wholesale",
  "/collaborations",
  "/faq",
  "/size-guide",
  "/contact",
  "/shipping",
  "/returns",
  "/privacy",
  "/terms",
];

export const xmlEscape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const absolute = (base: string, url: string) => (url.startsWith("/") ? `${base}${url}` : url);

async function liveProducts(db: Db) {
  // A product with no variants cannot be bought, so it stays out of every listing.
  const rows = await db.query.products.findMany({
    where: eq(products.status, "active"),
    with: {
      category: true,
      variants: { orderBy: (v, { asc: a }) => [a(v.position), a(v.sku)] },
      images: { orderBy: (i, { asc: a }) => [a(i.position), a(i.createdAt)] },
    },
    orderBy: (p, { asc: a }) => [a(p.sortOrder), a(p.handle)],
    limit: 500,
  });
  return rows.filter((row) => row.variants.length > 0);
}

export async function sitemapXml(db: Db = getDb(), base = siteUrl()): Promise<string> {
  const items = await liveProducts(db);
  const urls = [
    ...STATIC_PAGES.map((path) => ({
      loc: `${base}${path === "/" ? "" : path}` || base,
      lastmod: "",
    })),
    ...items.map((p) => ({
      loc: `${base}/product/${p.handle}`,
      lastmod: p.updatedAt.toISOString().slice(0, 10),
    })),
  ];
  const body = urls
    .map(
      (u) =>
        `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export function robotsTxt(base = siteUrl()): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /api/",
    "Disallow: /checkout",
    "Disallow: /account",
    "Disallow: /orders/",
    "",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");
}

// A product feed for Google Merchant Center (free listings and Shopping ads). Each size is its own
// item, grouped under the product so Google shows them together.
export async function googleFeedXml(
  db: Db = getDb(),
  base = siteUrl(),
  storeName = "The Threads of Africa",
): Promise<string> {
  const items = await liveProducts(db);
  const entries = items.flatMap((p) => {
    const image = p.images[0]?.url;
    return p.variants.map((v) => {
      const size = v.selectedOptions.find((o) => o.name.toLowerCase() === "size")?.value;
      const color = v.selectedOptions.find((o) =>
        ["color", "colour"].includes(o.name.toLowerCase()),
      )?.value;
      const fields: Array<[string, string | undefined]> = [
        ["g:id", v.sku],
        ["g:item_group_id", p.handle],
        ["title", `${p.title}${v.title && v.title !== "Default" ? ` — ${v.title}` : ""}`],
        ["description", p.description || p.title],
        ["link", `${base}/product/${p.handle}`],
        ["g:image_link", image ? absolute(base, image) : undefined],
        ["g:availability", v.stock > 0 ? "in_stock" : "out_of_stock"],
        ["g:price", `${centsToAmount(v.priceCents)} ${v.currency}`],
        ["g:brand", storeName],
        ["g:condition", "new"],
        ["g:google_product_category", "Apparel & Accessories > Clothing"],
        ["g:product_type", p.category.name],
        ["g:size", size],
        ["g:color", color],
      ];
      return `    <item>\n${fields
        .filter(([, value]) => value)
        .map(([tag, value]) => `      <${tag}>${xmlEscape(value ?? "")}</${tag}>`)
        .join("\n")}\n    </item>`;
    });
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n  <channel>\n    <title>${xmlEscape(storeName)}</title>\n    <link>${xmlEscape(base)}</link>\n    <description>${xmlEscape(storeName)} products</description>\n${entries.join("\n")}\n  </channel>\n</rss>\n`;
}
