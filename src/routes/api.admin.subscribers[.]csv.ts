import { createFileRoute } from "@tanstack/react-router";

import { recordAudit } from "@/backend/admin/audit.server";
import { currentAdmin } from "@/backend/auth/session-cookie.server";
import { getDb } from "@/backend/db/client.server";
import { errorFields, log } from "@/backend/log.server";
import { subscribersCsv } from "@/backend/newsletter.server";
import { tooManyRequests } from "@/backend/rate-limit.server";

// Downloads the subscriber list. A plain GET is safe from cross-site tricks here because the
// admin cookie is SameSite=Strict, so another site's link or form cannot carry it.
export const Route = createFileRoute("/api/admin/subscribers.csv")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const admin = await currentAdmin();
          if (!admin || admin.status !== "active")
            return new Response("Please sign in again.", { status: 401 });
          if (tooManyRequests("subscriber-export", 20, 10 * 60 * 1000)) {
            return new Response("Too many downloads. Wait a few minutes.", { status: 429 });
          }
          const csv = await subscribersCsv();
          // Exporting personal data is worth a line in the activity log.
          await recordAudit(
            getDb(),
            admin,
            "subscribers_exported",
            "subscriber",
            "",
            "Downloaded the subscriber list",
          );
          return new Response(csv, {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": 'attachment; filename="subscribers.csv"',
              "Cache-Control": "no-store",
            },
          });
        } catch (error) {
          log("error", "subscriber export failed", errorFields(error));
          return new Response("Something went wrong.", { status: 500 });
        }
      },
    },
  },
});
