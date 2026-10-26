import { createFileRoute } from "@tanstack/react-router";
import { sql } from "drizzle-orm";

import { getDb } from "@/backend/db/client.server";
import { errorFields, log } from "@/backend/log.server";

// Railway's health check: healthy means the app can actually reach its database.
export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await getDb().execute(sql`select 1`);
          return Response.json({ status: "ok" });
        } catch (error) {
          log("error", "health check failed", errorFields(error));
          return Response.json({ status: "unavailable" }, { status: 503 });
        }
      },
    },
  },
});
