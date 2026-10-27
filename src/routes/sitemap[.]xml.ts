import { createFileRoute } from "@tanstack/react-router";

import { errorFields, log } from "@/backend/log.server";
import { sitemapXml } from "@/backend/seo.server";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return new Response(await sitemapXml(), {
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
              "Cache-Control": "public, max-age=600",
            },
          });
        } catch (error) {
          log("error", "sitemap failed", errorFields(error));
          return new Response("Unavailable", { status: 503 });
        }
      },
    },
  },
});
