import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { POLICY_SLUGS } from "@/lib/policy-defaults";

import { guarded } from "./guarded.server";
import { createMessage } from "./messages.server";
import { subscribe, unsubscribeByToken } from "./newsletter.server";
import { getSitePage } from "./pages.server";
import { tooManyRequests } from "./rate-limit.server";
import { getPublicSettings } from "./settings.server";

const TEN_MINUTES = 10 * 60 * 1000;
const SLOW_DOWN = "Too many attempts. Please wait a few minutes and try again.";

// Every visitor-facing form has a hidden "website" field that people never see or fill in. Bots
// that fill in every field give themselves away, and get a normal-looking "thanks" that does nothing.
const honeypot = z.string().max(200);

export const getPublicSettingsFn = createServerFn({ method: "GET" }).handler(() =>
  guarded("publicSettings", () => getPublicSettings()),
);

export const getSitePageFn = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.enum(POLICY_SLUGS) }))
  .handler(({ data }) => guarded("sitePage", () => getSitePage(data.slug)));

export const submitMessageFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      topic: z.string().max(40),
      name: z.string().max(200),
      email: z.string().max(300),
      body: z.string().max(6000),
      website: honeypot,
    }),
  )
  .handler(({ data }) =>
    guarded("submitMessage", async () => {
      if (data.website) return { ok: true as const };
      if (tooManyRequests("contact-form", 5, TEN_MINUTES))
        return { ok: false as const, message: SLOW_DOWN };
      return createMessage(data);
    }),
  );

export const subscribeFn = createServerFn({ method: "POST" })
  .validator(
    z.object({ email: z.string().max(300), source: z.string().max(40), website: honeypot }),
  )
  .handler(({ data }) =>
    guarded("subscribe", async () => {
      if (data.website) return { ok: true as const };
      if (tooManyRequests("newsletter", 10, TEN_MINUTES))
        return { ok: false as const, message: SLOW_DOWN };
      return subscribe(data.email, data.source);
    }),
  );

export const unsubscribeFn = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().max(100) }))
  .handler(({ data }) =>
    guarded("unsubscribe", async () => {
      if (tooManyRequests("unsubscribe", 30, TEN_MINUTES)) return { ok: false as const };
      return { ok: await unsubscribeByToken(data.token) };
    }),
  );
