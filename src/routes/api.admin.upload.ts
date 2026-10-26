import { createFileRoute } from "@tanstack/react-router";

import { MAX_UPLOAD_BYTES, saveMedia } from "@/backend/admin/media.server";
import { currentAdmin } from "@/backend/auth/session-cookie.server";
import { errorFields, log } from "@/backend/log.server";
import { tooManyRequests } from "@/backend/rate-limit.server";

const json = (body: unknown, status = 200) => Response.json(body, { status });

// Photo upload for the admin screens. It is a plain route rather than a server function because
// it receives multipart form data. Server functions get cross-site protection for free; this
// route does its own: the request must come from our own origin and carry the admin session
// cookie (which is SameSite=Strict, so other sites cannot send it).
export const Route = createFileRoute("/api/admin/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const origin = request.headers.get("origin");
          const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
          if (!origin || !host || new URL(origin).host !== host) {
            return json({ message: "Request not allowed." }, 403);
          }

          const admin = await currentAdmin();
          if (!admin || admin.status !== "active")
            return json({ message: "Please sign in again." }, 401);
          if (tooManyRequests("admin-upload", 200, 10 * 60 * 1000)) {
            return json({ message: "Too many uploads. Wait a few minutes." }, 429);
          }

          const declared = Number(request.headers.get("content-length") ?? 0);
          if (declared > MAX_UPLOAD_BYTES + 512 * 1024) {
            return json({ message: "Photos must be 5 MB or smaller." }, 413);
          }

          const form = await request.formData();
          const file = form.get("file");
          if (!(file instanceof File)) return json({ message: "Choose a photo to upload." }, 400);
          if (file.size > MAX_UPLOAD_BYTES)
            return json({ message: "Photos must be 5 MB or smaller." }, 413);

          const result = await saveMedia(admin, {
            bytes: Buffer.from(await file.arrayBuffer()),
            filename: file.name,
          });
          if (!result.ok)
            return json({ message: result.message }, result.code === "TOO_LARGE" ? 413 : 400);
          return json({ url: result.url });
        } catch (error) {
          log("error", "photo upload failed", errorFields(error));
          return json({ message: "The upload failed. Please try again." }, 500);
        }
      },
    },
  },
});
