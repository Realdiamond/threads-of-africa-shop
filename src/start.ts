import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// No Content-Security-Policy yet: it needs a nonce rollout that also covers fonts and Stripe.
const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    try {
      result.response.headers.set(name, value);
    } catch {
      // Immutable response (e.g. proxied): headers are best-effort, never fail the request.
    }
  }
  return result;
});

// One address for the shop: www.<domain> and plain http both send visitors (and search engines)
// to SITE_URL, so there are no duplicate copies of every page. Only the shop's own hostnames are
// touched, so the platform's health checks and preview addresses are left alone.
const canonicalAddressMiddleware = createMiddleware().server(async ({ next, request }) => {
  const configured = process.env["SITE_URL"]?.trim();
  if (!configured || (request.method !== "GET" && request.method !== "HEAD")) return next();
  let site: URL;
  try {
    site = new URL(configured);
  } catch {
    return next();
  }
  const url = new URL(request.url);
  const first = (value: string | null) => value?.split(",")[0]?.trim().toLowerCase() ?? "";
  const host = first(request.headers.get("x-forwarded-host")) || first(request.headers.get("host"));
  const proto = first(request.headers.get("x-forwarded-proto")) || url.protocol.replace(":", "");
  const bare = (name: string) => name.replace(/^www\./, "");
  const ours = bare(host) === bare(site.host.toLowerCase());
  if (
    ours &&
    (host !== site.host.toLowerCase() || (site.protocol === "https:" && proto === "http"))
  ) {
    return new Response(null, {
      status: 301,
      headers: { Location: `${site.origin}${url.pathname}${url.search}` },
    });
  }
  return next();
});

// Pages and data travel as gzip when the browser accepts it: a few kilobytes instead of tens, which
// is most of the difference on a slow phone connection. Files already served pre-compressed, images
// and anything small are left as they are.
const MIN_COMPRESS_BYTES = 1024;
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg\+xml)/;
const compressionMiddleware = createMiddleware().server(async ({ next, request }) => {
  const result = await next();
  const { response } = result;
  const type = response.headers.get("content-type") ?? "";
  if (
    request.method === "HEAD" ||
    !response.body ||
    response.headers.has("content-encoding") ||
    !COMPRESSIBLE.test(type) ||
    !/\bgzip\b/.test(request.headers.get("accept-encoding") ?? "") ||
    typeof CompressionStream === "undefined"
  ) {
    return result;
  }
  try {
    // The whole page is read first: pages are small, and this keeps compression out of the
    // framework's streaming internals.
    const bytes = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    const init = { status: response.status, statusText: response.statusText, headers };
    if (bytes.byteLength < MIN_COMPRESS_BYTES) {
      return { ...result, response: new Response(bytes, init) };
    }
    const compressed = await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    headers.set("Content-Encoding", "gzip");
    headers.append("Vary", "Accept-Encoding");
    return { ...result, response: new Response(compressed, init) };
  } catch {
    // The body could not be read: nothing more can be done with this response.
    return result;
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [
    canonicalAddressMiddleware,
    securityHeadersMiddleware,
    compressionMiddleware,
    errorMiddleware,
    csrfMiddleware,
  ],
}));
