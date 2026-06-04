import { Redis } from "@upstash/redis";
import {
  DEFAULT_OWNER_NOTIFICATION_SETTINGS,
  type OwnerActivity,
  type OwnerActivityReport,
  type OwnerActivityType,
  type OwnerNotificationSettingKey,
  type OwnerNotificationSettings,
} from "@/lib/owner-notification-types";
import {
  notifyOwnerSafely,
  ownerNotificationConfigStatus,
  ownerUrl,
  type OwnerNotificationResult,
} from "@/lib/owner-notifications";

type OwnerNotificationInput = Parameters<typeof notifyOwnerSafely>[0];

type ActivityInput = {
  type: OwnerActivityType;
  event?: string | null;
  path: string;
  label?: string | null;
  placement?: string | null;
  href?: string | null;
  referrer?: string | null;
  anonymousId?: string | null;
};

export type ActivityNotificationResult =
  | {
      attempted: false;
      reason:
        | "marketing_click_alerts_disabled"
        | "site_visit_alerts_disabled"
        | "cooldown_active";
      message: string;
    }
  | ({ attempted: true } & OwnerNotificationResult);

const SETTINGS_KEY = "studioos:owner-notifications:settings";
const ACTIVITY_KEY = "studioos:owner-activity:recent";
const ACTIVITY_LIMIT = 500;
const HIGH_INTENT_PATH_PREFIXES = [
  "/pricing",
  "/prices",
  "/sign-up",
  "/signup",
  "/sign-in",
  "/studio-os/download",
  "/sample-galleries",
  "/pixieset-alternative",
  "/online-photo-gallery-ordering-software",
  "/school-photography-software",
  "/high-volume-photography-software",
  "/gotphoto-alternative",
];
const HIGH_INTENT_EVENTS = new Set([
  "cta_download_app",
  "cta_photographer_sign_in",
  "cta_start_trial",
  "cta_view_pricing",
  "cta_sample_galleries",
]);
const EXCLUDED_PATH_PREFIXES = [
  "/api",
  "/_next",
  "/dashboard",
  "/parents",
  "/g/",
  "/m",
  "/schools/",
];

let cachedRedis: Redis | null = null;
let redisInitFailed = false;
let redisLastError: string | null = null;
let memorySettings: OwnerNotificationSettings | null = null;
const memoryActivities: OwnerActivity[] = [];
const memoryDedupe = new Map<string, number>();

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function markRedisFailed(error: unknown) {
  redisLastError = errorMessage(error);
  redisInitFailed = true;
  cachedRedis = null;
}

function cleanEnv(value: string | null | undefined) {
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

function hasUpstashEnv() {
  const { url, token } = upstashCredentials();
  return Boolean(url && token);
}

function getRedis(): Redis | null {
  if (!hasUpstashEnv() || redisInitFailed) return null;
  if (!cachedRedis) {
    try {
      const { url, token } = upstashCredentials();
      cachedRedis = new Redis({ url, token });
    } catch (error) {
      console.warn("[admin-notification-center] Redis.fromEnv() failed:", error);
      markRedisFailed(error);
      return null;
    }
  }
  return cachedRedis;
}

function clean(value: unknown, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizePath(path: string) {
  const value = clean(path, 260) || "/";
  try {
    const parsed = value.startsWith("http")
      ? new URL(value)
      : new URL(value, "https://www.studiooscloud.com");
    return parsed.pathname || "/";
  } catch {
    return value.startsWith("/") ? value.split("?")[0] || "/" : `/${value}`;
  }
}

function parseJsonValue<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  if (typeof value === "object") return value as T;
  return null;
}

function mergeSettings(value: Partial<OwnerNotificationSettings> | null) {
  return {
    ...DEFAULT_OWNER_NOTIFICATION_SETTINGS,
    ...(value ?? {}),
    visitAlertCooldownMinutes: Math.max(
      1,
      Math.min(
        1440,
        Number(
          value?.visitAlertCooldownMinutes ??
            DEFAULT_OWNER_NOTIFICATION_SETTINGS.visitAlertCooldownMinutes,
        ),
      ),
    ),
  };
}

export async function getOwnerNotificationSettings(): Promise<OwnerNotificationSettings> {
  const redis = getRedis();
  if (redis) {
    const stored = await redis.get(SETTINGS_KEY).catch((error) => {
      console.warn("[admin-notification-center] settings read failed:", error);
      markRedisFailed(error);
      return null;
    });
    return mergeSettings(parseJsonValue<Partial<OwnerNotificationSettings>>(stored));
  }
  return mergeSettings(memorySettings);
}

export async function saveOwnerNotificationSettings(
  patch: Partial<OwnerNotificationSettings>,
) {
  const current = await getOwnerNotificationSettings();
  const next = mergeSettings({ ...current, ...patch });
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(SETTINGS_KEY, JSON.stringify(next));
      memorySettings = next;
      return next;
    } catch (error) {
      console.warn("[admin-notification-center] settings write failed:", error);
      markRedisFailed(error);
    }
  }
  memorySettings = next;
  return next;
}

export function isTrackableMarketingPath(path: string) {
  const normalized = normalizePath(path);
  return !EXCLUDED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isHighIntentActivity(path: string, event?: string | null) {
  const normalized = normalizePath(path);
  return (
    HIGH_INTENT_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    (event ? HIGH_INTENT_EVENTS.has(event) : false)
  );
}

function simplifyUserAgent(userAgent: string | null) {
  if (!userAgent) return null;
  const source = userAgent.toLowerCase();
  const browser = source.includes("edg/")
    ? "Edge"
    : source.includes("chrome/")
      ? "Chrome"
      : source.includes("safari/")
        ? "Safari"
        : source.includes("firefox/")
          ? "Firefox"
          : "Browser";
  const device = source.includes("mobile")
    ? "Mobile"
    : source.includes("ipad") || source.includes("tablet")
      ? "Tablet"
      : "Desktop";
  return `${browser} · ${device}`;
}

function locationFromRequest(request: Request) {
  const rawCity = request.headers.get("x-vercel-ip-city");
  return {
    country: clean(request.headers.get("x-vercel-ip-country"), 64) || null,
    region: clean(request.headers.get("x-vercel-ip-country-region"), 64) || null,
    city: rawCity ? decodeURIComponent(rawCity).slice(0, 80) : null,
  };
}

async function shouldNotifyOnce(key: string, seconds: number) {
  const redis = getRedis();
  if (redis) {
    try {
      const result = await redis.set(key, "1", { nx: true, ex: seconds });
      return result === "OK";
    } catch (error) {
      console.warn("[admin-notification-center] dedupe write failed:", error);
      markRedisFailed(error);
    }
  }

  const now = Date.now();
  const expiresAt = memoryDedupe.get(key);
  if (expiresAt && expiresAt > now) return false;
  memoryDedupe.set(key, now + seconds * 1000);
  return true;
}

async function maybeNotifyForActivity(
  activity: OwnerActivity,
  settings: OwnerNotificationSettings,
): Promise<ActivityNotificationResult> {
  if (activity.type === "marketing_click") {
    if (!settings.alertOnMarketingClick) {
      return {
        attempted: false,
        reason: "marketing_click_alerts_disabled",
        message: "Marketing click alerts are off.",
      };
    }
    const key = `studioos:owner-notifications:dedupe:click:${activity.anonymousId ?? "unknown"}:${activity.event ?? "click"}:${activity.path}`;
    if (!(await shouldNotifyOnce(key, 10 * 60))) {
      return {
        attempted: false,
        reason: "cooldown_active",
        message: "A recent matching click alert was already sent.",
      };
    }
    const result = await notifyOwnerSafely({
      title: "Studio OS marketing click",
      message: [
        activity.label || activity.event || "Marketing click",
        `Page: ${activity.path}`,
        activity.href ? `Destination: ${activity.href}` : null,
        activity.userAgentSummary,
      ]
        .filter(Boolean)
        .join("\n"),
      url: ownerUrl("/dashboard/admin/notifications"),
      urlTitle: "Open notification report",
      priority: 0,
    });
    return { attempted: true, ...result };
  }

  const shouldAlert =
    settings.alertOnEverySiteVisit ||
    (activity.isHighIntent && settings.alertOnHighIntentVisit);
  if (!shouldAlert) {
    return {
      attempted: false,
      reason: "site_visit_alerts_disabled",
      message: activity.isHighIntent
        ? "High-intent visit alerts are off."
        : "Every public site visit alerts are off.",
    };
  }

  const cooldownSeconds = settings.visitAlertCooldownMinutes * 60;
  const key = `studioos:owner-notifications:dedupe:visit:${activity.anonymousId ?? "unknown"}:${activity.path}`;
  if (!(await shouldNotifyOnce(key, cooldownSeconds))) {
    return {
      attempted: false,
      reason: "cooldown_active",
      message: "A recent matching site visit alert was already sent.",
    };
  }

  const result = await notifyOwnerSafely({
    title: activity.isHighIntent ? "High-intent Studio OS visit" : "Studio OS site visit",
    message: [
      `Page: ${activity.path}`,
      activity.referrer ? `From: ${activity.referrer}` : null,
      [activity.city, activity.region, activity.country].filter(Boolean).join(", ") || null,
      activity.userAgentSummary,
    ]
      .filter(Boolean)
      .join("\n"),
    url: ownerUrl("/dashboard/admin/notifications"),
    urlTitle: "Open notification report",
    priority: 0,
  });
  return { attempted: true, ...result };
}

export async function recordOwnerActivity(input: ActivityInput, request: Request) {
  const path = normalizePath(input.path);
  if (!isTrackableMarketingPath(path)) return { recorded: false as const };

  const settings = await getOwnerNotificationSettings();
  if (!settings.activityTrackingEnabled) return { recorded: false as const };

  const { country, region, city } = locationFromRequest(request);
  const activity: OwnerActivity = {
    id: crypto.randomUUID(),
    type: input.type,
    event: clean(input.event, 80) || null,
    path,
    label: clean(input.label, 140) || null,
    placement: clean(input.placement, 140) || null,
    href: clean(input.href, 500) || null,
    referrer: clean(input.referrer ?? request.headers.get("referer"), 500) || null,
    anonymousId: clean(input.anonymousId, 80) || null,
    userAgentSummary: simplifyUserAgent(request.headers.get("user-agent")),
    country,
    region,
    city,
    isHighIntent: isHighIntentActivity(path, input.event),
    receivedAt: new Date().toISOString(),
  };

  const redis = getRedis();
  if (redis) {
    try {
      await redis.lpush(ACTIVITY_KEY, JSON.stringify(activity));
      await redis.ltrim(ACTIVITY_KEY, 0, ACTIVITY_LIMIT - 1);
    } catch (error) {
      console.warn("[admin-notification-center] activity write failed:", error);
      markRedisFailed(error);
      memoryActivities.unshift(activity);
      memoryActivities.splice(ACTIVITY_LIMIT);
    }
  }

  if (!redis) {
    memoryActivities.unshift(activity);
    memoryActivities.splice(ACTIVITY_LIMIT);
  }

  const notification = await maybeNotifyForActivity(activity, settings);
  return { recorded: true as const, activity, notification };
}

export async function getOwnerActivityReport(limit = 100): Promise<OwnerActivityReport> {
  const redis = getRedis();
  const rows = redis
    ? await redis.lrange(ACTIVITY_KEY, 0, Math.max(0, limit - 1)).catch((error) => {
        console.warn("[admin-notification-center] activity read failed:", error);
        markRedisFailed(error);
        return memoryActivities.slice(0, limit);
      })
    : memoryActivities.slice(0, limit);

  const activities = rows
    .map((row) => parseJsonValue<OwnerActivity>(row))
    .filter((row): row is OwnerActivity => Boolean(row?.id && row.path));

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const last24 = activities.filter((activity) => {
    const time = new Date(activity.receivedAt).getTime();
    return !Number.isNaN(time) && time >= since;
  });

  const pageCounts = new Map<string, number>();
  for (const activity of last24) {
    if (activity.type !== "page_view") continue;
    pageCounts.set(activity.path, (pageCounts.get(activity.path) ?? 0) + 1);
  }

  return {
    activities,
    totals: {
      last24Hours: last24.length,
      pageViewsLast24Hours: last24.filter((activity) => activity.type === "page_view").length,
      marketingClicksLast24Hours: last24.filter((activity) => activity.type === "marketing_click").length,
      highIntentLast24Hours: last24.filter((activity) => activity.isHighIntent).length,
    },
    topPages: Array.from(pageCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([path, count]) => ({ path, count })),
  };
}

export async function notifyOwnerForSetting(
  setting: OwnerNotificationSettingKey,
  input: OwnerNotificationInput,
) {
  const settings = await getOwnerNotificationSettings();
  const enabled = settings[setting];
  if (typeof enabled !== "boolean" || !enabled) {
    return { sent: false as const, reason: "disabled" as const };
  }
  return notifyOwnerSafely(input);
}

export async function getOwnerNotificationDiagnostics() {
  const redis = getRedis();
  let redisAvailable = false;

  if (redis) {
    try {
      await redis.ping();
      redisAvailable = true;
      redisLastError = null;
    } catch (error) {
      console.warn("[admin-notification-center] Redis ping failed:", error);
      markRedisFailed(error);
    }
  }

  return {
    ...ownerNotificationConfigStatus(),
    store: {
      mode: redisAvailable ? "redis" : "memory",
      hasUpstashEnv: hasUpstashEnv(),
      redisAvailable,
      lastError: redisLastError,
    },
  };
}
