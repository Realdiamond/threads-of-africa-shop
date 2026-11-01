import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronDown } from "lucide-react";
import kids from "@/assets/kids.jpg";
import heritage from "@/assets/heritage.jpg";
import craft from "@/assets/craft.jpg";
import campaign from "@/assets/campaign.jpg";
import story from "@/assets/story.jpg";
import products from "@/assets/products.jpg";
import amara from "@/assets/amara.jpg";
import zuri from "@/assets/zuri.jpg";
import kofi from "@/assets/kofi.jpg";
import { contentPages, type ContentPageKey } from "@/lib/brand-content";
import { useLoaderData, rootRouteId } from "@tanstack/react-router";
import { ContactForm } from "@/components/contact-form";
import type { MessageTopic } from "@/lib/store-types";
const pageImages: Record<string, [string, string]> = {
  kids: [kids, "Children wearing Roots & Play pieces with African-inspired prints"],
  heritage: [heritage, "Folded Adire and Aso-Oke inspired textiles"],
  craft: [craft, "Design studio with print fabrics, thread and sketches"],
  responsibility: [story, "Textiles from The Threads of Africa"],
  contact: [campaign, "The Threads of Africa campaign"],
  wholesale: [products, "Pieces from the collection"],
  collaborations: [craft, "Design sketches and fabrics"],
  shipping: [products, "Pieces ready to ship"],
  returns: [zuri, "Zuri set"],
  "size-guide": [amara, "Amara dress fit"],
  faq: [kofi, "Kofi shirt"],
};
export function brandHead(key: ContentPageKey) {
  const page = contentPages[key];
  return {
    meta: [
      { title: `${page.title} — The Threads of Africa` },
      { name: "description", content: page.intro },
      { property: "og:title", content: `${page.title} — The Threads of Africa` },
      { property: "og:description", content: page.intro },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  };
}
const formTopics: Partial<Record<ContentPageKey, MessageTopic>> = {
  contact: "general",
  wholesale: "wholesale",
  collaborations: "collaboration",
};
export function BrandPage({ pageKey }: { pageKey: ContentPageKey }) {
  const { settings } = useLoaderData({ from: rootRouteId }) as {
    settings: { contactEmail: string };
  };
  const fill = (t?: string) => (t ?? "").replaceAll("{{email}}", settings.contactEmail);
  const p = contentPages[pageKey];
  const image = pageImages[pageKey];
  return (
    <main>
      {image ? (
        <header className="page-hero">
          <img src={image[0]} alt={image[1]} width={1600} height={912} fetchPriority="high" />
          <div className="site-width page-hero-copy">
            <p className="eyebrow eyebrow-gold">{p.eyebrow}</p>
            <h1>{p.headline}</h1>
            <p>{fill(p.intro)}</p>
          </div>
        </header>
      ) : (
        <header className="site-width section-tight">
          <p className="eyebrow text-muted-foreground mb-5">{p.eyebrow}</p>
          <h1 className="page-title max-w-3xl">{p.headline}</h1>
          <p className="lede mt-6 max-w-2xl">{fill(p.intro)}</p>
        </header>
      )}
      <section className="site-width section-tight">
        {pageKey === "faq" ? (
          <div className="max-w-4xl">
            {p.sections.map(([title, text]) => (
              <details key={title} className="group border-b py-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 serif text-2xl">
                  {title}
                  <ChevronDown className="size-5 shrink-0 text-gold transition-transform group-open:rotate-180" />
                </summary>
                <p className="lede mt-4 max-w-3xl">{fill(text)}</p>
              </details>
            ))}
          </div>
        ) : (
          p.sections.map(([title, text], i) => (
            <div key={title} className="chapter">
              <span className="feature-num">{String(i + 1).padStart(2, "0")}</span>
              <h2>{title}</h2>
              <p>{fill(text)}</p>
            </div>
          ))
        )}
      </section>
      {formTopics[pageKey] && (
        <section className="bg-sand">
          <div className="site-width section-tight max-w-3xl">
            <ContactForm defaultTopic={formTopics[pageKey]} />
          </div>
        </section>
      )}
      <div className="weave-band" aria-hidden="true" />
      <div className="site-width section-tight flex flex-wrap items-center justify-between gap-6">
        <p className="serif text-3xl">Every thread tells a story.</p>
        <div className="flex flex-wrap gap-3">
          <Link to="/shop" search={{ category: "All" }} className="cta cta-solid">
            Explore the collection <ArrowRight />
          </Link>
          <Link to="/story" className="cta cta-outline">
            Discover our story
          </Link>
        </div>
      </div>
    </main>
  );
}
