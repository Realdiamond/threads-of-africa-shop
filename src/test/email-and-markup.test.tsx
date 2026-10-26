// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createConsoleProvider,
  createResendProvider,
  getEmailProvider,
} from "@/backend/email/provider.server";
import { escapeHtml, renderEmail } from "@/backend/email/templates.server";
import { siteUrl } from "@/backend/site-url.server";
import { SimpleMarkdown } from "@/components/simple-markdown";
import { COUNTRY_CODES, countryName, isCountryCode } from "@/lib/countries";
import { POLICY_DEFAULTS, POLICY_SLUGS } from "@/lib/policy-defaults";
import { formatTaxRate } from "@/lib/store-types";

afterEach(() => {
  vi.unstubAllGlobals();
});

const email = {
  from: "Shop <shop@example.com>",
  to: "buyer@example.com",
  replyTo: "visitor@example.com",
  subject: "Hello",
  text: "Hi",
  html: "<p>Hi</p>",
};

describe("Resend provider", () => {
  it("sends the right request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await createResendProvider("re_key").send(email)).toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_key");
    expect(JSON.parse(init.body)).toEqual({
      from: "Shop <shop@example.com>",
      to: ["buyer@example.com"],
      subject: "Hello",
      text: "Hi",
      html: "<p>Hi</p>",
      reply_to: "visitor@example.com",
    });
  });

  it("omits reply_to when there is none", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await createResendProvider("k").send({ ...email, replyTo: undefined });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).not.toHaveProperty("reply_to");
  });

  it("treats rejected requests as permanent and server trouble as temporary", async () => {
    const respond = (status: number) =>
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status })));

    respond(422);
    expect(await createResendProvider("k").send(email)).toMatchObject({
      ok: false,
      retryable: false,
    });
    respond(403);
    expect(await createResendProvider("k").send(email)).toMatchObject({
      ok: false,
      retryable: false,
    });
    respond(429);
    expect(await createResendProvider("k").send(email)).toMatchObject({
      ok: false,
      retryable: true,
    });
    respond(503);
    expect(await createResendProvider("k").send(email)).toMatchObject({
      ok: false,
      retryable: true,
    });
  });

  it("treats network failures as temporary", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    expect(await createResendProvider("k").send(email)).toEqual({
      ok: false,
      retryable: true,
      error: "ECONNRESET",
    });
  });
});

describe("choosing the email provider", () => {
  it("is off until a key is set, and the console provider is explicit", async () => {
    expect(getEmailProvider({})).toBeNull();
    expect(getEmailProvider({ RESEND_API_KEY: "re_x" })?.name).toBe("resend");
    expect(getEmailProvider({ EMAIL_PROVIDER: "console" })?.name).toBe("console");
    expect(await createConsoleProvider().send(email)).toEqual({ ok: true });
  });
});

describe("email templates", () => {
  it("escapes HTML in everything it is given", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
    const mail = renderEmail({
      storeName: "Shop <b>",
      contactEmail: "a@b.com",
      subject: "s",
      heading: "<h1>Hi</h1>",
      paragraphs: ["<script>x</script>\nsecond line"],
      details: ["Name: <i>Eve</i>"],
      button: { label: "Go", url: 'https://x.test/?a="b"' },
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<i>Eve</i>");
    expect(mail.html).toContain("&lt;script&gt;x&lt;/script&gt;<br>second line");
    expect(mail.html).toContain("https://x.test/?a=&quot;b&quot;");
  });

  it("includes a readable plain-text version", () => {
    const mail = renderEmail({
      storeName: "Shop",
      contactEmail: "a@b.com",
      subject: "Order",
      heading: "Thanks",
      paragraphs: ["Your order is confirmed."],
      details: ["Order TOA-1001"],
      button: { label: "View order", url: "https://x.test/o/1" },
    });
    expect(mail.text).toContain("Thanks");
    expect(mail.text).toContain("Order TOA-1001");
    expect(mail.text).toContain("View order: https://x.test/o/1");
    expect(mail.text).not.toContain("<");
  });
});

describe("site address", () => {
  it("prefers SITE_URL, then Railway's domain, then localhost", () => {
    expect(
      siteUrl({ SITE_URL: "https://shop.example/", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }),
    ).toBe("https://shop.example");
    expect(siteUrl({ RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" })).toBe("https://x.up.railway.app");
    expect(siteUrl({})).toBe("http://localhost:8080");
  });
});

describe("policy page formatting", () => {
  const render = (text: string) => renderToStaticMarkup(<SimpleMarkdown text={text} />);

  it("formats headings, lists, bold, italics and links", () => {
    const html = render(
      "## Heading\n\nA **bold** and *soft* word with a [link](https://example.com).\n\n- one\n- two",
    );
    expect(html).toContain("<h3");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>soft</em>");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain("<li>one</li>");
  });

  it("cannot be used to inject scripts or unsafe links", () => {
    const html = render(
      "<script>alert(1)</script>\n\n[bad](javascript:alert(1)) [worse](data:text/html,hi)\n\n<img src=x onerror=alert(1)>",
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/href="(javascript|data):/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("allows mail and same-site links", () => {
    const html = render("[Email us](mailto:a@b.com) or [see the shop](/shop)");
    expect(html).toContain('href="mailto:a@b.com"');
    expect(html).toContain('href="/shop"');
  });

  it("renders every starter policy page without errors", () => {
    for (const slug of POLICY_SLUGS) {
      expect(render(POLICY_DEFAULTS[slug].body).length).toBeGreaterThan(200);
    }
  });
});

describe("countries and tax display", () => {
  it("has 249 unique country codes with names", () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(isCountryCode("NG")).toBe(true);
    expect(isCountryCode("ZZ")).toBe(false);
    expect(isCountryCode("ng")).toBe(false);
    expect(countryName("NG")).toBe("Nigeria");
    expect(countryName("GB")).toBe("United Kingdom");
  });

  it("formats tax rates", () => {
    expect(formatTaxRate(0)).toBe("0%");
    expect(formatTaxRate(750)).toBe("7.50%");
    expect(formatTaxRate(2000)).toBe("20%");
  });
});
