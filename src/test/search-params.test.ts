// @vitest-environment node
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { newAccessToken } from "@/backend/orders.server";
import { safeNext, searchFlag, searchText } from "@/lib/search-params";

describe("reading values from the address bar", () => {
  it("gives back the text that was typed even when the router parsed it as a number", () => {
    expect(searchText("abc")).toBe("abc");
    expect(searchText(1)).toBe("1"); // ?placed=1
    expect(searchText(1001)).toBe("1001"); // ?search=1001
    expect(searchText(true)).toBe("true");
    expect(searchText(undefined)).toBeUndefined();
    expect(searchText({ a: 1 })).toBeUndefined();
    expect(searchText(null)).toBeUndefined();
  });
});

describe("yes/no flags in the address bar", () => {
  it('reads 1, true and "1" as set, and anything else as not set', () => {
    for (const on of [1, true, "1", "true"]) expect(searchFlag(on)).toBe(true);
    for (const off of [0, false, "0", "no", "", undefined, null, 2]) {
      expect(searchFlag(off)).toBeUndefined();
    }
  });
});

describe("order access tokens", () => {
  it("can never be mistaken for a number, boolean or JSON by the router", () => {
    for (let i = 0; i < 2000; i += 1) {
      const token = newAccessToken();
      expect(token).toMatch(/^t[A-Za-z0-9_-]{32}$/);
      expect(() => JSON.parse(token)).toThrow();
    }
    // Without the prefix, an all-digit token would be turned into a number and lose its value.
    expect(typeof JSON.parse("123456789012345678901234567890")).toBe("number");
    expect(randomBytes(24).toString("base64url")).toHaveLength(32);
  });
});

describe("where to go after signing in", () => {
  it("only follows addresses on this site", () => {
    expect(safeNext("/checkout")).toBe("/checkout");
    expect(safeNext("/orders/abc?x=1")).toBe("/orders/abc?x=1");
    for (const bad of [
      undefined,
      "",
      "https://evil.test",
      "//evil.test",
      "javascript:alert(1)",
      "evil",
    ]) {
      expect(safeNext(bad)).toBe("/account");
    }
  });
});
