import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ProductCard, EmptyProducts } from "@/components/product-card";
import { productsQueryOptions } from "@/lib/catalog";
import campaign from "@/assets/campaign.jpg";
import heritage from "@/assets/heritage.jpg";
import craft from "@/assets/craft.jpg";
import amara from "@/assets/amara.jpg";
import kofi from "@/assets/kofi.jpg";
import kids from "@/assets/kids.jpg";
import { brandValues, contentPages } from "@/lib/brand-content";
import { NewsletterForm } from "@/components/newsletter-form";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(productsQueryOptions);
  },
  head: () => ({
    meta: [
      { title: "The Threads of Africa — Every Thread Tells a Story" },
      {
        name: "description",
        content:
          "Discover contemporary African-inspired clothing at Threads of Africa. Expressive prints, considered silhouettes, and a story in every thread.",
      },
      { property: "og:title", content: "The Threads of Africa — Every Thread Tells a Story" },
      { property: "og:description", content: "Rooted in Heritage. Designed for Now." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const MARQUEE = [
  "Rooted in heritage",
  "Designed for now",
  "Every thread tells a story",
  "Aso-Oke",
  "Adire",
  "Made for everyday expression",
];

const CATEGORIES = [
  {
    title: "For her",
    note: "Bold. Beautiful. Unapologetic.",
    image: amara,
    alt: "Women’s Ankara dress collection",
    link: { to: "/shop", search: { category: "Women" } },
  },
  {
    title: "For him",
    note: "Considered. Confident. Original.",
    image: kofi,
    alt: "Men’s heritage shirt collection",
    link: { to: "/shop", search: { category: "Men" } },
  },
  {
    title: "Roots & Play",
    note: "Culture made playful.",
    image: kids,
    alt: "Children in playful African-print outfits",
    link: { to: "/kids" },
  },
] as const;

function Home() {
  const { data: products } = useSuspenseQuery(productsQueryOptions);
  // The three textile stories; the heritage page's last note is about sample products, not for here.
  const textiles = contentPages.heritage.sections.slice(0, 3);
  return (
    <main>
      <section className="hero">
        <img
          className="hero-photo"
          src={campaign}
          alt="Threads of Africa Heritage Collection — three models in contemporary African-inspired designs"
          width={1920}
          height={1024}
          fetchPriority="high"
        />
        <div className="hero-shade" aria-hidden="true" />
        <div className="site-width hero-copy">
          <span className="eyebrow eyebrow-gold">The Threads of Africa</span>
          <h1>
            Rooted in heritage. <em>Designed for now.</em>
          </h1>
          <p className="hero-sub">
            Contemporary African fashion connecting heritage, craftsmanship, culture, and modern
            living.
          </p>
          <div className="hero-actions">
            <Link to="/shop" search={{ category: "Women" }} className="cta cta-light">
              Shop women <ArrowRight />
            </Link>
            <Link to="/shop" search={{ category: "Men" }} className="cta cta-outline-light">
              Shop men <ArrowRight />
            </Link>
          </div>
        </div>
        <div className="site-width hero-foot" aria-hidden="true">
          <span className="hide-sm">Every thread tells a story</span>
          <span className="scroll-cue">Scroll</span>
        </div>
      </section>

      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          {[...MARQUEE, ...MARQUEE].map((word, i) => (
            <span key={i}>{word}</span>
          ))}
        </div>
      </div>

      <section className="site-width section grid md:grid-cols-[1fr_1.2fr] gap-8 md:gap-20 items-start">
        <div>
          <p className="eyebrow text-muted-foreground mb-5">Our story</p>
          <h2 className="text-5xl md:text-6xl leading-[1.02]">Every thread tells a story.</h2>
        </div>
        <div>
          <p className="lede">
            The Threads of Africa is a contemporary fashion brand inspired by the richness of
            African culture, craftsmanship, textiles, and creative expression. We reinterpret
            heritage for modern life through thoughtfully designed clothing for women, men, and
            children.
          </p>
          <p className="lede mt-5">
            From culturally inspired statement pieces to elevated everyday essentials, every
            collection celebrates the connection between where we come from and where we are going.
          </p>
          <Link to="/story" className="text-link mt-8">
            Discover our story <ArrowRight />
          </Link>
        </div>
      </section>

      <section className="site-width pb-[88px] max-md:pb-[60px]">
        <div className="section-heading">
          <div>
            <p className="eyebrow text-muted-foreground">Shop by collection</p>
            <h2>Find your expression.</h2>
          </div>
        </div>
        <div className="category-grid">
          {CATEGORIES.map((c) => (
            <Link key={c.title} {...c.link} className="category-tile">
              <img src={c.image} alt={c.alt} loading="lazy" width={512} height={683} />
              <div className="category-label">
                <p className="eyebrow opacity-85">{c.note}</p>
                <h3>{c.title}</h3>
                <span className="text-link text-primary-foreground">
                  Shop now <ArrowRight />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="bg-sand">
        <div className="site-width section">
          <div className="section-heading">
            <div>
              <p className="eyebrow text-muted-foreground">Discover the collection</p>
              <h2>New arrivals &amp; the edit.</h2>
            </div>
            <Link to="/shop" search={{ category: "All" }} className="text-link shrink-0">
              Shop all <ArrowRight />
            </Link>
          </div>
          {products.length ? (
            <div className="product-row">
              {products.slice(0, 8).map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <EmptyProducts />
          )}
        </div>
      </section>

      <section className="split dark">
        <div className="split-media">
          <img
            src={heritage}
            alt="Handwoven Aso-Oke and Adire textiles"
            width={1600}
            height={912}
            loading="lazy"
          />
        </div>
        <div className="split-copy">
          <span className="eyebrow eyebrow-gold">Heritage, reimagined</span>
          <h2>Wear the story.</h2>
          <p>
            African textiles carry generations of craftsmanship, identity, and creativity. From
            Aso-Oke accents to Adire-inspired designs, our Heritage Collection celebrates tradition
            while creating something new.
          </p>
          <Link to="/heritage" className="cta cta-light">
            Explore our heritage <ArrowRight />
          </Link>
        </div>
      </section>

      <section className="site-width section">
        <div className="section-heading">
          <div>
            <p className="eyebrow text-muted-foreground">The textiles behind the pieces</p>
            <h2>Textiles with a story.</h2>
          </div>
        </div>
        <div className="feature-grid">
          {textiles.map(([title, text], i) => (
            <article key={title} className="feature-card">
              <span className="feature-num">0{i + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="split sand reverse">
        <div className="split-media">
          <img
            src={craft}
            alt="A designer refining the details of a garment"
            width={1600}
            height={912}
            loading="lazy"
          />
        </div>
        <div className="split-copy">
          <span className="eyebrow text-muted-foreground">Our craft</span>
          <h2>Designed with intention.</h2>
          <p>
            Every Threads of Africa piece begins with an idea. From selecting materials to refining
            the fit and finishing the smallest details, we believe good design should feel
            considered.
          </p>
          <Link to="/craft" className="cta cta-solid">
            From idea to garment <ArrowRight />
          </Link>
        </div>
      </section>

      <section className="site-width section">
        <div className="grid md:grid-cols-[1fr_2fr] gap-10 md:gap-20">
          <div>
            <p className="eyebrow text-muted-foreground mb-5">What we stand for</p>
            <h2 className="text-5xl leading-[1.02]">A new chapter in African creativity.</h2>
            <Link to="/responsibility" className="text-link mt-8">
              Responsible growth <ArrowRight />
            </Link>
          </div>
          <div className="values-grid">
            {brandValues.map(([title, text], i) => (
              <div key={title}>
                <h3>
                  <span>0{i + 1}</span>
                  {title}
                </h3>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="newsletter">
        <div className="site-width newsletter-inner">
          <div>
            <span className="eyebrow eyebrow-gold">Join the story</span>
            <h2>Every thread. Every new chapter.</h2>
            <p>
              Receive collection releases, styling inspiration, early access, and stories from The
              Threads of Africa.
            </p>
          </div>
          <NewsletterForm />
        </div>
      </section>
    </main>
  );
}
