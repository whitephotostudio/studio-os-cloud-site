/**
 * Rate limiter for API routes.
 *
 * Uses Upstash Redis (via @upstash/ratelimit) when the env vars are set,
 * so limits survive Vercel cold starts and are shared across serverless
 * instances. Falls back to an in-memory map when Upstash isn't configured
 * (local dev, preview deploys without the env vars wired up) so the app
 * still functions — just with per-instance limits like before.
 *
 * Behavior matches the previous implementation: fixed-window counter,
 * keyed by `<namespace>:<key>` with a TTL equal to the window size.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitConfig = {
  /** A unique name for this limiter (e.g. "api-general", "pin-auth") */
  namespace: string;
  /** Max requests allowed within the window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

// ------------------------------------------------------------------
// Upstash-backed limiter (preferred)
// ------------------------------------------------------------------

function hasUpstashEnv(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

let cachedRedis: Redis | null = null;
function getRedis(): Redis | null {
  if (!hasUpstashEnv()) return null;
  if (!cachedRedis) cachedRedis = Redis.fromEnv();
  return cachedRedis;
}

// One Ratelimit instance per (namespace, limit, windowSeconds) combo.
// @upstash/ratelimit caches its own Lua script hashes per-instance, so
// reusing instances across requests matters for performance.
const ratelimitCache = new Map<string, Ratelimit>();

function getUpstashLimiter(config: RateLimitConfig): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;

  const cacheKey = `${config.namespace}:${config.limit}:${config.windowSeconds}`;
  const cached = ratelimitCache.get(cacheKey);
  if (cached) return cached;

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(
      config.limit,
      `${config.windowSeconds} s` as const,
    ),
    prefix: `rl:${config.namespace}`,
    // analytics off — we don't want extra commands against the free tier
    analytics: false,
  });
  ratelimitCache.set(cacheKey, limiter);
  return limiter;
}

// ------------------------------------------------------------------
// In-memory fallback (local dev / missing env vars)
// ------------------------------------------------------------------

type InMemoryEntry = { count: number; resetAt: number };
const memoryStores = new Map<string, Map<string, InMemoryEntry>>();

function getMemoryStore(namespace: string) {
  let store = memoryStores.get(namespace);
  if (!store) {
    store = new Map();
    memoryStores.set(namespace, store);
  }
  return store;
}

function inMemoryRateLimit(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  const store = getMemoryStore(config.namespace);
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + config.windowSeconds * 1000;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: config.limit - 1, resetAt };
  }

  entry.count += 1;

  if (entry.count > config.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return {
    allowed: true,
    remaining: config.limit - entry.count,
    resetAt: entry.resetAt,
  };
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------

/**
 * Check whether `key` is within the limits defined by `config`.
 *
 * Returns the result synchronously if we're falling back to memory,
 * asynchronously if we're talking to Upstash. Either way, callers
 * should `await` this — the signature is stable.
 *
 * If Upstash is unreachable (network hiccup, credentials revoked, etc.),
 * we fail-open: the request is allowed through. This matches the
 * previous behavior where a crashed in-memory map would also allow
 * everything. An attacker can't exploit it without also taking down
 * Upstash, at which point they have bigger problems.
 */
export async function rateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const upstash = getUpstashLimiter(config);
  if (upstash) {
    try {
      const result = await upstash.limit(key);
      return {
        allowed: result.success,
        remaining: result.remaining,
        resetAt: result.reset,
      };
    } catch (error) {
      console.warn("[rate-limit] Upstash check failed, failing open:", error);
      return {
        allowed: true,
        remaining: config.limit,
        resetAt: Date.now() + config.windowSeconds * 1000,
      };
    }
  }

  return inMemoryRateLimit(key, config);
}

/** Extract a usable IP from a Next.js request */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/**
 * Periodic cleanup for the in-memory fallback. No-op when Upstash is
 * in use (TTLs handle expiry). Kept exported for backward compatibility
 * with any callers that imported it.
 */
export function cleanupExpiredEntries() {
  if (hasUpstashEnv()) return;
  const now = Date.now();
  for (const store of memoryStores.values()) {
    for (const [key, entry] of store.entries()) {
      if (now > entry.resetAt) store.delete(key);
    }
  }
}

// Auto-cleanup every 5 minutes for the in-memory fallback.
if (typeof setInterval !== "undefined" && !hasUpstashEnv()) {
  setInterval(cleanupExpiredEntries, 5 * 60 * 1000);
}
