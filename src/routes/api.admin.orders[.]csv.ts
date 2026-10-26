import { createFileRoute } from "@tanstack/react-router";

import { recordAudit } from "@/backend/admin/audit.server";
import { ordersCsv } from "@/backend/admin/order-admin.server";
import { currentAdmin } from "@/backend/auth/session-cookie.server";
import { getDb } from "@/backend/db/client.server";
import { errorFields, log } from "@/backend/log.server";
import { tooManyRequests } from "@/backend/rate-limit.server";
import { ORDER_STATUSES, type OrderStatus } from "@/lib/order-types";

// Downloads the orders (or the filtered view of them). A plain GET is safe from cross-site tricks
// here because the admin cookie is SameSite=Strict, so another site's link cannot carry it.
export const Route = createFileRoute("/api/admin/orders.csv")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const admin = await currentAdmin();
          if (!admin || admin.status !== "active")
            return new Response("Please sign in again.", { status: 401 });
          if (tooManyRequests("order-export", 20, 10 * 60 * 1000)) {
            return new Response("Too many downloads. Wait a few minutes.", { status: 429 });
          }
          const params = new URL(request.url).searchParams;
          const status = params.get("status");
          const csv = await ordersCsv({
            status: ORDER_STATUSES.includes(status as OrderStatus)
              ? (status as OrderStatus)
              : undefined,
            search: params.get("search")?.slice(0, 100) || undefined,
          });
          await recordAudit(
            getDb(),
            admin,
            "orders_exported",
            "order",
            "",
            "Downloaded the orders list",
          );
          return new Response(csv, {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": 'attachment; filename="orders.csv"',
              "Cache-Control": "no-store",
            },
          });
        } catch (error) {
          log("error", "order export failed", errorFields(error));
          return new Response("Something went wrong.", { status: 500 });
        }
      },
    },
  },
});
