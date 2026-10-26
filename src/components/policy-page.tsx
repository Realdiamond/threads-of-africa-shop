import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

import { SimpleMarkdown } from "@/components/simple-markdown";
import { Button } from "@/components/ui/button";
import type { SitePageView } from "@/lib/store-types";

const updated = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function policyHead(page: Pick<SitePageView, "title" | "body">) {
  const description = page.body
    .replace(/[#*[\]()_-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 155);
  return {
    meta: [
      { title: `${page.title} — The Threads of Africa` },
      { name: "description", content: description },
      { property: "og:title", content: `${page.title} — The Threads of Africa` },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
    ],
  };
}

export function PolicyPage({ page, eyebrow }: { page: SitePageView; eyebrow: string }) {
  return (
    <main>
      <header className="site-width py-12 sm:py-16">
        <p className="eyebrow mb-5 text-muted-foreground">{eyebrow}</p>
        <h1 className="page-title max-w-3xl leading-tight">{page.title}</h1>
        {page.updatedAt && (
          <p className="mt-4 text-xs text-muted-foreground">
            Last updated {updated(page.updatedAt)}
          </p>
        )}
      </header>
      <section className="bg-secondary">
        <div className="site-width max-w-3xl py-10 sm:py-14">
          <SimpleMarkdown text={page.body} />
        </div>
      </section>
      <div className="site-width flex flex-wrap gap-4 py-12">
        <Button asChild className="rounded-none">
          <Link to="/shop" search={{ category: "All" }}>
            Explore the collection <ArrowUpRight />
          </Link>
        </Button>
        <Button asChild variant="outline" className="rounded-none">
          <Link to="/contact">Contact us</Link>
        </Button>
      </div>
    </main>
  );
}
