import { Link, useNavigate } from "@tanstack/react-router";
import emblemUrl from "@/assets/threads-of-africa-emblem.png";
import { useEffect, useState } from "react";
import {
  Search,
  ShoppingBag,
  Heart,
  User,
  Menu,
  ArrowRight,
  Plus,
  Minus,
  Trash2,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useStore } from "./store-context";
import { useCartStore } from "@/stores/cart-store";
import { useQuery } from "@tanstack/react-query";
import { money, productsQueryOptions } from "@/lib/catalog";
import { ProductCard } from "./product-card";
import type { PublicSettings } from "@/lib/store-types";

export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`brand ${className}`}>
      <img src={emblemUrl} alt="" className="brand-mark" />
      <span className="brand-text">
        <span className="brand-the">THE</span> THREADS <span className="brand-of">OF AFRICA</span>
      </span>
    </span>
  );
}

const SHOP_LINKS = [
  { label: "Shop all", category: "All" },
  { label: "Women", category: "Women" },
  { label: "Men", category: "Men" },
  { label: "New in", category: "New" },
] as const;

export function StoreHeader({ announcement }: { announcement: string }) {
  const store = useStore();
  const cart = useCartStore();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [term, setTerm] = useState("");
  const [saved, setSaved] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();

  // The header stays put while scrolling; a hairline and soft shadow appear once the page moves.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const checkout = () => {
    if (!cart.cartId) return;
    cart.setBagOpen(false);
    void navigate({ to: "/checkout" });
  };
  const { data: catalog = [] } = useQuery({ ...productsQueryOptions, enabled: search || saved });
  const matches = catalog.filter((p) =>
    (p.name + " " + p.category + " " + p.color).toLowerCase().includes(term.trim().toLowerCase()),
  );
  const bagCount = cart.items.reduce((a, x) => a + x.quantity, 0);
  const bagTotal = cart.items.reduce((a, x) => a + Number(x.price.amount) * x.quantity, 0);
  const currency = cart.items[0]?.price.currencyCode ?? "USD";
  const closeMenu = () => setMenu(false);

  return (
    <>
      {announcement && (
        <div className="announcement" role="region" aria-label="Announcement">
          {announcement}
        </div>
      )}
      <header className="site-header" data-scrolled={scrolled}>
        <div className="site-width main-nav">
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open menu"
              className="menu-toggle -ml-2 min-[1151px]:hidden [&_svg]:size-5"
              onClick={() => setMenu(true)}
            >
              <Menu />
            </Button>
            <nav className="nav-links" aria-label="Shop">
              {SHOP_LINKS.map((l) => (
                <Link key={l.category} to="/shop" search={{ category: l.category }}>
                  {l.label}
                </Link>
              ))}
              <Link to="/kids">Kids</Link>
            </nav>
          </div>
          <Link to="/" aria-label="The Threads of Africa home">
            <Brand />
          </Link>
          <div className="nav-icons">
            <nav className="nav-links mr-4" aria-label="Brand">
              <Link to="/heritage">Heritage</Link>
              <Link to="/story">Our story</Link>
            </nav>
            <Button
              variant="ghost"
              size="icon"
              title="Search"
              aria-label="Search"
              onClick={() => setSearch(true)}
              className="[&_svg]:size-5"
            >
              <Search />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Favorites"
              aria-label="Favorites"
              onClick={() => setSaved(true)}
              className="relative max-[760px]:hidden [&_svg]:size-5"
            >
              <Heart />
              {store.favorites.length > 0 && (
                <span className="count-badge">{store.favorites.length}</span>
              )}
            </Button>
            <Button
              asChild
              variant="ghost"
              size="icon"
              title="Account"
              aria-label="Account"
              className="max-[760px]:hidden [&_svg]:size-5"
            >
              <Link to="/account">
                <User />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Shopping bag"
              aria-label="Shopping bag"
              onClick={() => cart.setBagOpen(true)}
              className="relative [&_svg]:size-5"
            >
              <ShoppingBag />
              {bagCount > 0 && <span className="count-badge">{bagCount}</span>}
            </Button>
          </div>
        </div>
      </header>

      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="left" className="menu-panel w-full sm:max-w-sm p-0 flex flex-col">
          <div className="px-6 pt-6">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">Browse the collection.</SheetDescription>
            <Link to="/" onClick={closeMenu} aria-label="The Threads of Africa home">
              <Brand />
            </Link>
          </div>
          <nav className="px-6 mt-8" aria-label="Menu">
            {SHOP_LINKS.map((l) => (
              <Link
                key={l.category}
                to="/shop"
                search={{ category: l.category }}
                onClick={closeMenu}
              >
                {l.category === "New" ? "New arrivals" : l.label} <ArrowRight />
              </Link>
            ))}
            <Link to="/kids" onClick={closeMenu}>
              Kids <ArrowRight />
            </Link>
            <Link to="/heritage" onClick={closeMenu}>
              Heritage <ArrowRight />
            </Link>
          </nav>
          <div className="menu-secondary px-6 mt-8 grid grid-cols-2 gap-x-6">
            <Link to="/story" onClick={closeMenu}>
              Our story
            </Link>
            <Link to="/craft" onClick={closeMenu}>
              Our craft
            </Link>
            <Link to="/account" onClick={closeMenu}>
              Account
            </Link>
            <button
              type="button"
              className="text-left py-[7px] text-[13px] text-muted-foreground"
              onClick={() => {
                closeMenu();
                setSaved(true);
              }}
            >
              Favorites{store.favorites.length ? ` (${store.favorites.length})` : ""}
            </button>
            <Link to="/contact" onClick={closeMenu}>
              Contact
            </Link>
            <Link to="/faq" onClick={closeMenu}>
              FAQ
            </Link>
          </div>
          <div className="mt-auto">
            <div className="weave-band" aria-hidden="true" />
            <p className="px-6 py-5 serif text-xl italic text-muted-foreground">
              Every thread tells a story.
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={search} onOpenChange={setSearch}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto rounded-none">
          <DialogTitle className="serif text-3xl font-medium">Search the collection</DialogTitle>
          <DialogDescription>Dresses, shirts, sets, colours…</DialogDescription>
          <div className="flex items-center border-b border-foreground/30 py-3 gap-3">
            <Search className="size-5 text-muted-foreground" />
            <input
              autoFocus
              aria-label="Search products"
              placeholder="What are you looking for?"
              className="bg-transparent outline-none flex-1 min-w-0 text-lg"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
          </div>
          <div
            className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-8"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) setSearch(false);
            }}
          >
            {matches.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          {catalog.length > 0 && matches.length === 0 && (
            <p className="py-10 text-center text-muted-foreground">
              No pieces found. Try “dress” or “shirt”.
            </p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={saved} onOpenChange={setSaved}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto rounded-none">
          <DialogTitle className="serif text-3xl font-medium">Your favorites</DialogTitle>
          <DialogDescription>The pieces you keep coming back to.</DialogDescription>
          {store.favorites.length ? (
            <div
              className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-8"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a")) setSaved(false);
              }}
            >
              {catalog
                .filter((p) => store.favorites.includes(p.id))
                .map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
            </div>
          ) : (
            <div className="py-14 text-center">
              <Heart className="mx-auto mb-4 size-8 text-gold" />
              <p>No favorites yet.</p>
              <button type="button" className="cta cta-solid mt-6" onClick={() => setSaved(false)}>
                Keep exploring <ArrowRight />
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Sheet
        open={cart.bagOpen}
        onOpenChange={(open) => {
          cart.setBagOpen(open);
        }}
      >
        <SheetContent className="w-full sm:max-w-md flex flex-col">
          <SheetTitle className="serif text-3xl font-medium">
            Your bag{bagCount ? ` (${bagCount})` : ""}
          </SheetTitle>
          <SheetDescription>A little culture. A lot of style.</SheetDescription>
          <div className="flex-1 overflow-y-auto">
            {cart.items.length ? (
              cart.items.map((item) => (
                <div className="bag-row" key={item.variantId}>
                  <img src={item.product.image} alt={item.product.name} />
                  <div>
                    <div className="flex justify-between gap-3">
                      <h3 className="text-sm font-medium">{item.product.name}</h3>
                      <p className="text-sm whitespace-nowrap">
                        {money(Number(item.price.amount) * item.quantity, item.price.currencyCode)}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground my-2">
                      {item.selectedOptions.map((o) => o.value).join(" / ")}
                    </p>
                    <div className="flex items-center justify-between mt-3">
                      <div className="flex items-center border">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Decrease quantity"
                          disabled={cart.isLoading}
                          onClick={() => cart.updateQuantity(item.variantId, item.quantity - 1)}
                        >
                          <Minus />
                        </Button>
                        <span className="text-xs w-5 text-center">{item.quantity}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Increase quantity"
                          disabled={cart.isLoading}
                          onClick={() => cart.updateQuantity(item.variantId, item.quantity + 1)}
                        >
                          <Plus />
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${item.product.name}`}
                        disabled={cart.isLoading}
                        onClick={() => cart.removeItem(item.variantId)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-20 text-center">
                <ShoppingBag className="mx-auto mb-5 size-10 text-gold" />
                <p className="serif text-2xl">Your bag is waiting for a story.</p>
                <button
                  type="button"
                  onClick={() => cart.setBagOpen(false)}
                  className="cta cta-solid mt-7"
                >
                  Continue exploring <ArrowRight />
                </button>
              </div>
            )}
          </div>
          {cart.items.length > 0 && (
            <div className="border-t pt-5">
              <div className="flex justify-between mb-2">
                <span className="text-sm">Subtotal</span>
                <strong>{money(bagTotal, currency)}</strong>
              </div>
              {cart.notice && (
                <p role="alert" className="text-xs text-destructive mb-4">
                  {cart.notice}
                </p>
              )}
              <p className="text-xs text-muted-foreground mb-5">
                Delivery and any taxes are calculated at checkout.
              </p>
              <button
                type="button"
                className="cta cta-solid w-full disabled:opacity-60"
                disabled={cart.isLoading || cart.isSyncing}
                onClick={checkout}
              >
                Checkout <ArrowRight />
              </button>
              <p className="mt-3 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
                <Lock className="size-3" /> Secure payment by Stripe
              </p>
              <Button variant="link" className="w-full mt-1" onClick={() => cart.setBagOpen(false)}>
                Continue shopping
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

export function StoreFooter({ settings }: { settings: PublicSettings }) {
  const socials = [
    ["Instagram", settings.instagramUrl],
    ["TikTok", settings.tiktokUrl],
    ["Facebook", settings.facebookUrl],
    ["Pinterest", settings.pinterestUrl],
  ].filter(([, u]) => u);
  return (
    <footer className="site-footer">
      <div className="weave-band" aria-hidden="true" />
      <div className="site-width">
        <div className="footer-grid">
          <div>
            <Link to="/" aria-label="The Threads of Africa home">
              <Brand className="footer-brand" />
            </Link>
            <p className="serif text-2xl italic mt-6 max-w-[300px] text-primary-foreground">
              Rooted in heritage. Designed for now.
            </p>
            <p className="text-xs mt-3 opacity-70">Every thread tells a story.</p>
            {socials.length > 0 && (
              <p className="social-links mt-6 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                {socials.map(([label, url]) => (
                  <a
                    key={label}
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline underline-offset-4"
                  >
                    {label}
                  </a>
                ))}
              </p>
            )}
          </div>
          <div>
            <h2>Shop</h2>
            <Link to="/shop" search={{ category: "New" }}>
              New arrivals
            </Link>
            <Link to="/shop" search={{ category: "Women" }}>
              Women
            </Link>
            <Link to="/shop" search={{ category: "Men" }}>
              Men
            </Link>
            <Link to="/kids">Kids — Roots & Play</Link>
            <Link to="/heritage">Heritage</Link>
          </div>
          <div>
            <h2>About</h2>
            <Link to="/story">Our story</Link>
            <Link to="/craft">Our craft</Link>
            <Link to="/responsibility">Responsibility</Link>
            <Link to="/wholesale">Wholesale</Link>
            <Link to="/collaborations">Collaborations</Link>
          </div>
          <div>
            <h2>Help</h2>
            <Link to="/contact">Contact</Link>
            <Link to="/faq">FAQ</Link>
            <Link to="/size-guide">Size guide</Link>
            <Link to="/shipping">Shipping & delivery</Link>
            <Link to="/returns">Returns & exchanges</Link>
          </div>
        </div>
        <div className="footer-bottom">
          <p>
            © {new Date().getFullYear()} {settings.storeName}. All rights reserved.
          </p>
          <span>
            <a href={`mailto:${settings.contactEmail}`}>{settings.contactEmail}</a> ·{" "}
            <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
