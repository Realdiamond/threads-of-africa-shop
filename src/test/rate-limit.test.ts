// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import {
  clientAddress,
  resetRateLimitsForTests,
  withinRateLimit,
} from "@/backend/rate-limit.server";

beforeEach(resetRateLimitsForTests);

describe("withinRateLimit", () => {
  it("allows up to the limit, then blocks, then recovers when the window ends", () => {
    const t0 = 1_000_000;
    expect(withinRateLimit("a", 3, 60_000, t0)).toBe(true);
    expect(withinRateLimit("a", 3, 60_000, t0 + 1)).toBe(true);
    expect(withinRateLimit("a", 3, 60_000, t0 + 2)).toBe(true);
    expect(withinRateLimit("a", 3, 60_000, t0 + 3)).toBe(false);
    expect(withinRateLimit("a", 3, 60_000, t0 + 60_000)).toBe(true);
  });

  it("counts each key separately", () => {
    for (let i = 0; i < 5; i++) withinRateLimit("noisy", 2, 60_000, 0);
    expect(withinRateLimit("noisy", 2, 60_000, 1)).toBe(false);
    expect(withinRateLimit("quiet", 2, 60_000, 1)).toBe(true);
  });

  it("stays bounded when flooded with distinct keys", () => {
    for (let i = 0; i < 25_000; i++) withinRateLimit(`ip-${i}`, 5, 60_000, 0);
    // Still functional afterwards: a fresh key is allowed, a repeat offender is blocked.
    expect(withinRateLimit("fresh", 1, 60_000, 1)).toBe(true);
    expect(withinRateLimit("fresh", 1, 60_000, 2)).toBe(false);
  });
});

describe("clientAddress", () => {
  const request = (headers: Record<string, string>) => new Request("http://x", { headers });

  it("uses the last forwarded address, which a client cannot forge", () => {
    expect(clientAddress(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe(
      "203.0.113.9",
    );
  });

  it("falls back to a shared bucket when there is no forwarded address", () => {
    expect(clientAddress(request({}))).toBe("unknown");
  });
});
