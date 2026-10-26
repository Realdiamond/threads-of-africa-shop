import { eq, sql } from "drizzle-orm";

import {
  POLICY_DEFAULTS,
  POLICY_SLUGS,
  isPolicySlug,
  type PolicySlug,
} from "@/lib/policy-defaults";
import type { SitePageView } from "@/lib/store-types";

import { recordAudit, type Actor } from "./admin/audit.server";
import { getDb, type Db } from "./db/client.server";
import { sitePages } from "./db/schema";

export type PageFailure = { ok: false; code: "INVALID" | "NOT_FOUND"; message: string };

const fail = (code: PageFailure["code"], message: string): PageFailure => ({
  ok: false,
  code,
  message,
});

function toView(slug: PolicySlug, row: typeof sitePages.$inferSelect | undefined): SitePageView {
  if (!row) {
    const starter = POLICY_DEFAULTS[slug];
    return {
      slug,
      title: starter.title,
      body: starter.body,
      isStarter: true,
      reviewedAt: null,
      updatedAt: null,
      updatedBy: "",
    };
  }
  return {
    slug,
    title: row.title,
    body: row.body,
    isStarter: false,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

export async function getSitePage(slug: PolicySlug, db: Db = getDb()): Promise<SitePageView> {
  const [row] = await db.select().from(sitePages).where(eq(sitePages.slug, slug));
  return toView(slug, row);
}

export async function listSitePages(db: Db = getDb()): Promise<SitePageView[]> {
  const rows = await db.select().from(sitePages);
  return POLICY_SLUGS.map((slug) =>
    toView(
      slug,
      rows.find((row) => row.slug === slug),
    ),
  );
}

export async function saveSitePage(
  actor: Actor,
  input: { slug: string; title: string; body: string },
  db: Db = getDb(),
): Promise<{ ok: true } | PageFailure> {
  if (!isPolicySlug(input.slug)) return fail("NOT_FOUND", "That page does not exist.");
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || title.length > 100)
    return fail("INVALID", "Give the page a title (up to 100 characters).");
  if (!body)
    return fail("INVALID", 'The page cannot be empty. Use "Restore the starter text" instead.');
  if (body.length > 50_000)
    return fail("INVALID", "The page is too long (50,000 characters at most).");

  await db.transaction(async (tx) => {
    await tx
      .insert(sitePages)
      .values({ slug: input.slug, title, body, updatedBy: actor.email })
      .onConflictDoUpdate({
        target: sitePages.slug,
        // Any edit means someone needs to read it over again.
        set: { title, body, reviewedAt: null, updatedBy: actor.email, updatedAt: sql`now()` },
      });
    await recordAudit(tx, actor, "page_updated", "page", input.slug, `Edited the "${title}" page`);
  });
  return { ok: true };
}

// "Reviewed" adopts whatever the page says now, including the starter text.
export async function reviewSitePage(
  actor: Actor,
  slug: string,
  db: Db = getDb(),
): Promise<{ ok: true } | PageFailure> {
  if (!isPolicySlug(slug)) return fail("NOT_FOUND", "That page does not exist.");
  const starter = POLICY_DEFAULTS[slug];
  await db.transaction(async (tx) => {
    await tx
      .insert(sitePages)
      .values({
        slug,
        title: starter.title,
        body: starter.body,
        updatedBy: actor.email,
        reviewedAt: sql`now()`,
      })
      .onConflictDoUpdate({ target: sitePages.slug, set: { reviewedAt: sql`now()` } });
    await recordAudit(
      tx,
      actor,
      "page_reviewed",
      "page",
      slug,
      `Marked the "${slug}" page as reviewed`,
    );
  });
  return { ok: true };
}

export async function resetSitePage(
  actor: Actor,
  slug: string,
  db: Db = getDb(),
): Promise<{ ok: true } | PageFailure> {
  if (!isPolicySlug(slug)) return fail("NOT_FOUND", "That page does not exist.");
  await db.transaction(async (tx) => {
    await tx.delete(sitePages).where(eq(sitePages.slug, slug));
    await recordAudit(
      tx,
      actor,
      "page_reset",
      "page",
      slug,
      `Restored the starter text for "${slug}"`,
    );
  });
  return { ok: true };
}
