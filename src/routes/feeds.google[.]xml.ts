import { createFileRoute } from "@tanstack/react-router";

import { errorFields, log } from "@/backend/log.server";
import { googleFeedXml } from "@/backend/seo.server";
import { getPublicSettings } from "@/backend/settings.server";

// The product feed for Google Merchant Center: add this address there as a scheduled fetch.
export const Route = createFileRoute("/feeds/google.xml")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const settings = await getPublicSettings();
          return new Response(await googleFeedXml(undefined, undefined, settings.storeName), {
            headers: {
              "Content-Type": "application/xml; charset=utf-8",
              "Cache-Control": "public, max-age=600",
            },
          });
        } catch (error) {
          log("error", "product feed failed", errorFields(error));
          return new Response("Unavailable", { status: 503 });
        }
      },
    },
  },
});
