import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";
import { getPublicSettingsFn, getSiteUrlFn } from "@/backend/site.functions";
import { StoreProvider } from "@/components/store-context";
import { StoreHeader, StoreFooter } from "@/components/store-shell";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { FALLBACK_SETTINGS } from "@/lib/store-types";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Shop details (announcement, contact, social links) come from the admin settings. If they
  // cannot be loaded, the pages still render with the built-in defaults.
  loader: async () => {
    const [settings, siteUrl] = await Promise.all([
      getPublicSettingsFn().catch(() => FALLBACK_SETTINGS),
      getSiteUrlFn().catch(() => ""),
    ]);
    return { settings, siteUrl };
  },
  head: ({ loaderData }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "The Threads of Africa" },
      {
        name: "description",
        content: "Rooted in Heritage. Designed for Now. Every Thread Tells a Story.",
      },
      { property: "og:title", content: "The Threads of Africa" },
      { property: "og:description", content: "African roots. Contemporary expression." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      // Link previews (WhatsApp, Instagram, iMessage...) need an absolute address. Pages with
      // their own picture (products) override this one.
      ...(loaderData?.siteUrl
        ? [
            { property: "og:image", content: `${loaderData.siteUrl}/og-default.jpg` },
            { property: "og:image:width", content: "1200" },
            { property: "og:image:height", content: "630" },
            { property: "og:site_name", content: "The Threads of Africa" },
            { name: "twitter:image", content: `${loaderData.siteUrl}/og-default.jpg` },
          ]
        : []),
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { settings } = Route.useLoaderData();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // The admin area has its own layout; the shop's header and footer would get in the way.
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  useCartSync();

  return (
    <QueryClientProvider client={queryClient}>
      <StoreProvider>
        {!isAdmin && <StoreHeader announcement={settings.announcement} />}
        <Outlet />
        {!isAdmin && <StoreFooter settings={settings} />}
        {!isAdmin && settings.whatsappNumber && (
          <>
            {/* Room below the footer so the floating button never covers its links. */}
            <div className="h-16" aria-hidden="true" />
            <WhatsAppButton number={settings.whatsappNumber} storeName={settings.storeName} />
          </>
        )}
      </StoreProvider>
    </QueryClientProvider>
  );
}
import { useCartSync } from "@/stores/cart-store";
