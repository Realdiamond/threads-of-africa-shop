import { createFileRoute } from "@tanstack/react-router";

import { getMedia } from "@/backend/admin/media.server";
import { errorFields, log } from "@/backend/log.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Public product photos. Each upload gets its own id, so a given URL never changes and can be
// cached for a year.
export const Route = createFileRoute("/media/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!UUID.test(params.id)) return new Response("Not found", { status: 404 });
        try {
          const row = await getMedia(params.id);
          if (!row) return new Response("Not found", { status: 404 });

          const etag = `"${row.sha256}"`;
          const headers = {
            ETag: etag,
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
          };
          if (request.headers.get("if-none-match") === etag) {
            return new Response(null, { status: 304, headers });
          }
          return new Response(new Uint8Array(row.data), {
            headers: { ...headers, "Content-Type": row.contentType },
          });
        } catch (error) {
          log("error", "media request failed", errorFields(error));
          return new Response("Something went wrong", { status: 500 });
        }
      },
    },
  },
});
