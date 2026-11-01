import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { brandValues } from "@/lib/brand-content";
import story from "@/assets/story.jpg";
import heritage from "@/assets/heritage.jpg";
export const Route = createFileRoute("/story")({
  head: () => ({
    meta: [
      { title: "Our Story — The Threads of Africa" },
      {
        name: "description",
        content:
          "The Threads of Africa connects African heritage with contemporary fashion. Discover the people, ideas, and values behind the threads.",
      },
      { property: "og:title", content: "Our Story — The Threads of Africa" },
      {
        property: "og:description",
        content:
          "Every thread connects a person, a place, a culture, a generation. Discover our story.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Story,
});
function Story() {
  return (
    <main>
      <header className="page-hero">
        <img
          src={story}
          alt="Contemporary African-inspired fashion by The Threads of Africa"
          width={1536}
          height={1024}
          fetchPriority="high"
        />
        <div className="site-width page-hero-copy">
          <p className="eyebrow eyebrow-gold">The story behind the threads</p>
          <h1>
            The Threads of Africa. <em className="text-gold">Every thread tells a story.</em>
          </h1>
          <p>
            Every thread connects something — a person, a place, a culture, a generation. The
            Threads of Africa was created to connect African heritage with contemporary fashion.
          </p>
        </div>
      </header>

      <section className="site-width section grid md:grid-cols-[1fr_1.4fr] gap-8 md:gap-20">
        <div>
          <p className="eyebrow text-muted-foreground mb-5">01 · Beginnings</p>
          <h2 className="text-5xl leading-[1.02]">How it began.</h2>
        </div>
        <div>
          <p className="lede">
            The Threads of Africa grew from a love of fashion, creativity, craftsmanship, and
            African cultural expression. African fashion has always been rich in storytelling.
            Textiles can communicate celebration, family, identity, heritage, status, community, and
            history.
          </p>
          <p className="lede mt-5">
            We wanted to create a brand that respects those traditions while allowing them to evolve
            within modern fashion. We explore traditional influences through relaxed tailoring,
            streetwear, statement garments, childrenswear, and everyday essentials.
          </p>
          <p className="serif text-3xl italic mt-8">
            To preserve the story while creating something new.
          </p>
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
          <span className="eyebrow eyebrow-gold">02 · Our name</span>
          <h2>Why “The Threads of Africa”?</h2>
          <p>
            Every thread carries a story. A thread can connect generations, cultures, craftsmanship,
            creativity, the past, and the future. Our name represents the many traditions, textiles,
            people, ideas, and creative expressions that make African fashion so rich.
          </p>
        </div>
      </section>

      <section className="site-width section grid md:grid-cols-[1fr_1.4fr] gap-8 md:gap-20">
        <div>
          <p className="eyebrow text-muted-foreground mb-5">03 · Beliefs</p>
          <h2 className="text-5xl leading-[1.02]">What we believe.</h2>
        </div>
        <ul className="grid gap-5">
          {[
            "Heritage can evolve without being forgotten.",
            "Traditional craftsmanship deserves new opportunities.",
            "African creativity belongs on a global stage.",
            "Clothing can carry meaning while remaining beautiful, comfortable, and relevant.",
          ].map((belief) => (
            <li key={belief} className="flex gap-4 border-b pb-5 text-[15px] leading-7">
              <span className="text-gold" aria-hidden="true">
                ◆
              </span>
              {belief}
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-sand">
        <div className="site-width section">
          <div className="section-heading">
            <div>
              <p className="eyebrow text-muted-foreground">04 · Values</p>
              <h2>The values in every thread.</h2>
            </div>
          </div>
          <div className="values-grid lg:grid-cols-3">
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

      <section className="site-width section grid md:grid-cols-2 gap-12 md:gap-20">
        <div>
          <p className="eyebrow text-muted-foreground mb-5">05 · Mission</p>
          <h2 className="text-4xl mb-5">Our mission.</h2>
          <p className="lede">
            Our mission is to create modern fashion inspired by African heritage while celebrating
            craftsmanship, individuality, quality, and cultural storytelling. We want our customers
            to wear pieces that feel beautiful, relevant, expressive, and meaningful.
          </p>
        </div>
        <div>
          <p className="eyebrow text-muted-foreground mb-5">06 · Future</p>
          <h2 className="text-4xl mb-5">Our future.</h2>
          <p className="lede">
            Our vision is to grow into a globally recognized contemporary African fashion brand — a
            platform where African textiles, artisanship, modern design, and new generations of
            creatives can meet. As we grow, we hope to expand our collections, collaborate with
            skilled artisans, explore responsible production and upcycling, and share African
            creativity with the world.
          </p>
        </div>
      </section>

      <section className="newsletter">
        <div className="site-width max-w-4xl text-center">
          <p className="eyebrow eyebrow-gold mb-6">Founder’s note</p>
          <blockquote className="serif text-3xl sm:text-5xl leading-tight italic">
            “I wanted to create a brand that could celebrate where we come from while designing for
            where we are going.”
          </blockquote>
          <p className="mt-8 text-sm leading-8 opacity-80 max-w-2xl mx-auto">
            This journey is about more than clothing. It is about preserving craftsmanship, creating
            opportunities, allowing traditional textiles to live in new forms, and showing our
            children that culture can evolve without being forgotten. The Threads of Africa is still
            growing. Every collection will represent another chapter of the story. Thank you for
            becoming part of it.
          </p>
          <p className="eyebrow mt-6 opacity-80">Founder, The Threads of Africa</p>
          <Link to="/shop" search={{ category: "All" }} className="cta cta-light mt-10">
            Find your expression <ArrowRight />
          </Link>
        </div>
      </section>
    </main>
  );
}
