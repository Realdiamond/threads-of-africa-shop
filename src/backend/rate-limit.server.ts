import { getRequest } from "@tanstack/react-start/server";

type Bucket = { count: number; resetAt: number };

const MAX_BUCKETS = 10_000;
const buckets = new Map<string, Bucket>();

// Fixed-window counter held in memory: enough for a single Railway instance, and it resets on
// deploy. Returns false once `key` has exceeded `limit` hits inside the current window.
export function withinRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  if (buckets.size >= MAX_BUCKETS) {
    for (const [k, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(k);
    // Still full of live entries (many distinct clients): drop the oldest half.
    for (const k of buckets.keys()) {
      if (buckets.size <= MAX_BUCKETS / 2) break;
      buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

// The proxy in front of the app appends the real client address, so the last entry is the one
// a client cannot forge; anything earlier in X-Forwarded-For is client-supplied.
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",").at(-1)?.trim() || "unknown";
}

// True when the current request's client has used up its allowance for `scope`.
export function tooManyRequests(scope: string, limit: number, windowMs: number): boolean {
  return !withinRateLimit(`${scope}:${clientAddress(getRequest())}`, limit, windowMs);
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
