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
  /** Authentication must not proceed without its shared production counter. */
  failClosed?: boolean;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  unavailable?: boolean;
};

// ------------------------------------------------------------------
// Upstash-backed limiter (preferred)
// ------------------------------------------------------------------

function cleanEnv(value: string | null | undefined): string {
  let next = (value ?? "").trim();
  while (
    next.length >= 2 &&
    ((next.startsWith('"') && next.endsWith('"')) ||
      (next.startsWith("'") && next.endsWith("'")))
  ) {
    next = next.slice(1, -1).trim();
  }
  return next;
}

function upstashCredentials() {
  return {
    url: cleanEnv(process.env.UPSTASH_REDIS_REST_URL),
    token: cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN),
  };
}

function hasUpstashEnv(): boolean {
  const { url, token } = upstashCredentials();
  return Boolean(url && token);
}

let cachedRedis: Redis | null = null;
let redisInitFailed = false;
function getRedis(): Redis | null {
  if (!hasUpstashEnv()) return null;
  if (redisInitFailed) return null;
  if (!cachedRedis) {
    try {
      const { url, token } = upstashCredentials();
      cachedRedis = new Redis({ url, token, signal: () => AbortSignal.timeout(5000), retry: { retries: 1 } });
    } catch {
      // Malformed env vars (wrong URL shape, bad token, etc.) would
      // otherwise throw synchronously at first request and 500 the route.
      // Fall back to the in-memory limiter instead of taking the whole
      // handler down.
      console.warn("[rate-limit] Shared counter initialization failed.");
      redisInitFailed = true;
      return null;
    }
  }
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

  try {
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(
        config.limit,
        `${config.windowSeconds} s` as const,
      ),
      prefix: `rl:${config.namespace}`,
      // analytics off — we don't want extra commands against the free tier
      analytics: false,
      // Disable the library's success-on-timeout behavior. Security-sensitive
      // callers handle outages explicitly below instead of silently bypassing.
      timeout: 0,
    });
    ratelimitCache.set(cacheKey, limiter);
    return limiter;
  } catch {
    console.warn("[rate-limit] Shared limiter initialization failed.");
    return null;
  }
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
 * Authentication callers opt into failClosed. A shared-counter outage then
 * pauses new authentication, while already authorized gallery image reads
 * retain their separate availability-oriented budgets.
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
    } catch {
      console.warn("[rate-limit] Shared counter check failed.");
      return {
        allowed: !config.failClosed,
        remaining: config.failClosed ? 0 : config.limit,
        resetAt: Date.now() + config.windowSeconds * 1000,
        ...(config.failClosed ? { unavailable: true } : {}),
      };
    }
  }

  if (config.failClosed && (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production")) {
    return { allowed: false, remaining: 0, resetAt: Date.now() + 30_000, unavailable: true };
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
