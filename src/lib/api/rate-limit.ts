import "server-only";
import { NextResponse, type NextRequest } from "next/server";

// Phase 5.1 — minimal token-bucket rate limiter for sensitive routes.
//
// Implementation note (READ BEFORE PROD):
//   This module keeps state in process memory. In a single-instance dev
//   server it's perfect; in a serverless / multi-replica deployment the
//   buckets won't be shared across instances, so the effective limit is
//   N_INSTANCES × the configured cap. Phase 5.2 should replace the backing
//   Map with Upstash Redis or Vercel KV. The call surface here is shaped to
//   make that swap a single-file change: only `bucket.consume()` needs to
//   become async and atomic.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Distinct namespace per route, e.g. "stripe:create-intent". */
  bucket: string;
  /** Max events allowed inside the window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Override the default key derivation. Default is IP. */
  keyFor?: (req: NextRequest) => string | null;
}

export interface RateLimitResult {
  ok: boolean;
  /** Optional NextResponse to return verbatim on rejection. */
  response?: NextResponse;
}

function ipFromRequest(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "anon";
}

export function rateLimit(req: NextRequest, opts: RateLimitOptions): RateLimitResult {
  const k = `${opts.bucket}:${(opts.keyFor?.(req) ?? ipFromRequest(req)) || "anon"}`;
  const now = Date.now();
  let b = buckets.get(k);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + opts.windowMs };
    buckets.set(k, b);
  }
  b.count += 1;
  if (b.count > opts.max) {
    const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    return {
      ok: false,
      response: NextResponse.json(
        { error: "محاولات كثيرة، حاول لاحقاً" },
        {
          status: 429,
          headers: {
            "retry-after": String(retryAfterSec),
            "x-ratelimit-bucket": opts.bucket,
            "x-ratelimit-reset": String(Math.floor(b.resetAt / 1000)),
          },
        },
      ),
    };
  }
  return { ok: true };
}

// Periodic cleanup so the Map doesn't grow forever in long-running processes.
// 1 hour interval is plenty since the most generous window we use is < 10min.
if (typeof setInterval !== "undefined" && process.env.NODE_ENV !== "test") {
  const CLEANUP_MS = 60 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (now >= b.resetAt) buckets.delete(k);
    }
  }, CLEANUP_MS).unref?.();
}
