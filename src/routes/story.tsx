import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brandValues } from "@/lib/brand-content";
import story from "@/assets/story.jpg";
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
      <section className="site-width text-center pt-12 pb-12">
        <p className="eyebrow text-muted-foreground mb-5">The story behind the threads</p>
        <h1 className="page-title">
          The Threads of Africa.
          <br />
          Every thread tells a story.
        </h1>
        <p className="max-w-2xl mx-auto text-sm leading-7 text-muted-foreground mt-6">
          Every thread connects something — a person, a place, a culture, a generation. The Threads
          of Africa was created to connect African heritage with contemporary fashion.
        </p>
      </section>
      <img
        src={story}
        alt="Contemporary African-inspired fashion by The Threads of Africa"
        width={1536}
        height={1024}
        className="w-full max-h-[650px] object-cover"
      />
      <section className="site-width py-16 grid md:grid-cols-2 gap-10">
        <h2 className="text-4xl leading-tight">How it began.</h2>
        <div className="text-sm leading-8 text-muted-foreground">
          <p>
            The Threads of Africa grew from a love of fashion, creativity, craftsmanship, and
            African cultural expression. African fashion has always been rich in storytelling.
            Textiles can communicate celebration, family, identity, heritage, status, community, and
            history.
          </p>
          <p className="mt-5">
            We wanted to create a brand that respects those traditions while allowing them to evolve
            within modern fashion. We explore traditional influences through relaxed tailoring,
            streetwear, statement garments, childrenswear, and everyday essentials.
          </p>
          <p className="mt-5 text-foreground">
            To preserve the story while creating something new.
          </p>
        </div>
      </section>
      <section className="bg-secondary">
        <div className="site-width py-14 grid md:grid-cols-2 gap-10">
          <div>
            <h2 className="text-3xl mb-5">Why “The Threads of Africa”?</h2>
            <p className="text-sm leading-8 text-muted-foreground">
              Every thread carries a story. A thread can connect generations, cultures,
              craftsmanship, creativity, the past, and the future. Our name represents the many
              traditions, textiles, people, ideas, and creative expressions that make African
              fashion so rich.
            </p>
          </div>
          <div>
            <h2 className="text-3xl mb-5">What we believe.</h2>
            <ul className="text-sm leading-8 text-muted-foreground list-disc pl-5">
              <li>Heritage can evolve without being forgotten.</li>
              <li>Traditional craftsmanship deserves new opportunities.</li>
              <li>African creativity belongs on a global stage.</li>
              <li>
                Clothing can carry meaning while remaining beautiful, comfortable, and relevant.
              </li>
            </ul>
          </div>
        </div>
      </section>
      <section className="site-width py-14">
        <h2 className="text-3xl mb-8">The values in every thread.</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {brandValues.map(([title, text]) => (
            <div key={title}>
              <h3 className="text-xl mb-3">{title}</h3>
              <p className="text-sm text-muted-foreground leading-7">{text}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="bg-secondary">
        <div className="site-width py-14 grid md:grid-cols-2 gap-10">
          <div>
            <h2 className="text-3xl mb-5">Our mission.</h2>
            <p className="text-sm leading-8 text-muted-foreground">
              Our mission is to create modern fashion inspired by African heritage while celebrating
              craftsmanship, individuality, quality, and cultural storytelling. We want our
              customers to wear pieces that feel beautiful, relevant, expressive, and meaningful.
            </p>
          </div>
          <div>
            <h2 className="text-3xl mb-5">Our future.</h2>
            <p className="text-sm leading-8 text-muted-foreground">
              Our vision is to grow into a globally recognized contemporary African fashion brand —
              a platform where African textiles, artisanship, modern design, and new generations of
              creatives can meet. As we grow, we hope to expand our collections, collaborate with
              skilled artisans, explore responsible production and upcycling, and share African
              creativity with the world.
            </p>
          </div>
        </div>
      </section>
      <section className="site-width py-14 max-w-4xl">
        <p className="eyebrow text-muted-foreground mb-5">Founder’s note</p>
        <blockquote className="text-lg sm:text-xl leading-9 font-display">
          “I wanted to create a brand that could celebrate where we come from while designing for
          where we are going.”
        </blockquote>
        <p className="text-sm leading-8 text-muted-foreground mt-6">
          This journey is about more than clothing. It is about preserving craftsmanship, creating
          opportunities, allowing traditional textiles to live in new forms, and showing our
          children that culture can evolve without being forgotten. The Threads of Africa is still
          growing. Every collection will represent another chapter of the story. Thank you for
          becoming part of it.
        </p>
        <p className="text-xs mt-5">Founder, The Threads of Africa</p>
        <Button asChild className="mt-8 rounded-none">
          <Link to="/shop" search={{ category: "All" }}>
            Find your expression <ArrowUpRight />
          </Link>
        </Button>
      </section>
    </main>
  );
}
