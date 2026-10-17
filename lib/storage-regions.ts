import { AsyncLocalStorage } from "node:async_hooks";
import { isKnownStorageHost } from "@/lib/storage-hosts";

// Storage regions — where a photographer's photos physically live.
//
// Studio OS stores photos in S3-compatible object storage. The original
// deployment used one Cloudflare R2 bucket (region code `r2`). Photographers
// can now be homed in a regional bucket so Canadian photos stay in Canada, US
// photos in the US, and so on. Each region is configured purely through env
// vars, so adding a country is a configuration change, not a code change:
//
//   STORAGE_REGION_<CODE>_ENDPOINT            https://s3.ca-east-006.backblazeb2.com
//   STORAGE_REGION_<CODE>_BUCKET              studioos-ca
//   STORAGE_REGION_<CODE>_ACCESS_KEY_ID       …
//   STORAGE_REGION_<CODE>_SECRET_ACCESS_KEY   …
//   STORAGE_REGION_<CODE>_SIGNING_REGION      (optional; inferred from the endpoint)
//   STORAGE_REGION_<CODE>_PROVIDER            (optional; b2 | wasabi | s3 | r2, inferred)
//   STORAGE_REGION_<CODE>_LABEL               (optional; "Canada (Toronto)")
//   STORAGE_REGION_<CODE>_COUNTRIES           (optional; "CA" — ISO codes this region serves)
//   STORAGE_REGION_<CODE>_PUBLIC_URL          (optional; public base URLs that must stay disabled)
//   STORAGE_DEFAULT_REGION                    region used when a photographer has none recorded
//
// The legacy R2 configuration (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME) keeps defining the `r2` region, so an
// existing deployment behaves exactly as before until STORAGE_DEFAULT_REGION
// points somewhere else.
//
// Every object key is identical across regions; only the bucket differs. The
// `photographers.storage_region` column records a photographer's home region.
// Server-side only — never import from a client component.

export type StorageProvider = "r2" | "b2" | "wasabi" | "s3";

export type StorageRegion = {
  /** Short code stored on `photographers.storage_region` (`r2`, `ca`, `us`, `uk`, `au`). */
  code: string;
  provider: StorageProvider;
  label: string;
  /** ISO 3166-1 alpha-2 codes this region is the home for. */
  countries: string[];
  /** S3 endpoint, e.g. https://s3.ca-east-006.backblazeb2.com */
  endpoint: string;
  /** Host of the endpoint, used for presigned URLs and URL validation. */
  host: string;
  bucket: string;
  /** SigV4 signing region (`auto` for R2, `ca-east-006` for Backblaze, …). */
  signingRegion: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Legacy/public base URLs that release checks verify stay disabled. */
  publicUrlBases: string[];
  /** Whether presigned and SDK requests address the bucket in the path. */
  pathStyle: boolean;
};

const DEFAULT_COUNTRIES: Record<string, string[]> = {
  ca: ["CA"],
  us: ["US"],
  uk: ["GB", "IE"],
  gb: ["GB", "IE"],
  au: ["AU", "NZ"],
  eu: [],
};

const DEFAULT_LABELS: Record<string, string> = {
  r2: "Studio OS original storage",
  ca: "Canada",
  us: "United States",
  uk: "United Kingdom",
  gb: "United Kingdom",
  au: "Australia",
  eu: "Europe",
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function splitList(value: string | null | undefined) {
  return clean(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function inferStorageProvider(host: string): StorageProvider {
  const value = host.toLowerCase();
  if (/\.r2\.cloudflarestorage\.com$/.test(value)) return "r2";
  if (/\.backblazeb2\.com$/.test(value)) return "b2";
  if (/\.wasabisys\.com$/.test(value)) return "wasabi";
  return "s3";
}

export function inferSigningRegion(host: string, provider: StorageProvider): string {
  const value = host.toLowerCase();
  if (provider === "r2") return "auto";
  const match = value.match(/^s3[.-]([a-z0-9-]+)\.(backblazeb2\.com|wasabisys\.com|amazonaws\.com)$/);
  if (match && !/^(dualstack|accelerate|external)$/.test(match[1])) return match[1];
  return "us-east-1";
}

function parseRegion(
  code: string,
  input: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    signingRegion?: string;
    provider?: string;
    label?: string;
    countries?: string[];
    publicUrlBases?: string[];
  },
): StorageRegion | null {
  const normalizedCode = code.toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,15}$/.test(normalizedCode)) return null;
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(clean(input.endpoint));
  } catch {
    return null;
  }
  if (endpointUrl.protocol !== "https:" || endpointUrl.username || endpointUrl.password || endpointUrl.search || endpointUrl.hash) return null;
  const host = endpointUrl.host.toLowerCase();
  if (!isKnownStorageHost(host)) return null;
  const bucket = clean(input.bucket);
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) return null;
  const provider = (["r2", "b2", "wasabi", "s3"].includes(clean(input.provider)) ? clean(input.provider) : inferStorageProvider(host)) as StorageProvider;
  const signingRegion = clean(input.signingRegion) || inferSigningRegion(host, provider);
  const countries = (input.countries?.length ? input.countries : DEFAULT_COUNTRIES[normalizedCode] ?? [])
    .map((country) => country.toUpperCase())
    .filter((country) => /^[A-Z]{2}$/.test(country));
  return {
    code: normalizedCode,
    provider,
    label: clean(input.label) || DEFAULT_LABELS[normalizedCode] || normalizedCode.toUpperCase(),
    countries,
    endpoint: `https://${host}`,
    host,
    bucket,
    signingRegion,
    accessKeyId: clean(input.accessKeyId),
    secretAccessKey: clean(input.secretAccessKey),
    publicUrlBases: (input.publicUrlBases ?? []).map((base) => base.replace(/\/+$/, "")).filter(Boolean),
    pathStyle: true,
  };
}

type Env = Record<string, string | undefined>;

function legacyR2Region(env: Env): StorageRegion | null {
  const accountId = clean(env.R2_ACCOUNT_ID);
  // The legacy region is always present so unconfigured environments (tests,
  // local development) keep the historical behaviour: presigning reports the
  // missing secrets instead of crashing at import time.
  return parseRegion("r2", {
    endpoint: `https://${/^[a-z0-9][a-z0-9-]{0,62}$/i.test(accountId) ? accountId.toLowerCase() : "unconfigured"}.r2.cloudflarestorage.com`,
    bucket: clean(env.R2_BUCKET_NAME) || "whitephoto-media",
    accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
    signingRegion: "auto",
    provider: "r2",
    label: DEFAULT_LABELS.r2,
    countries: [],
    publicUrlBases: [env.R2_PUBLIC_URL, env.NEXT_PUBLIC_R2_PUBLIC_URL].map(clean).filter(Boolean),
  });
}

/** Parse every configured region from an env object. Exported for tests. */
export function parseStorageRegions(env: Env): { regions: Map<string, StorageRegion>; defaultCode: string } {
  const regions = new Map<string, StorageRegion>();
  const legacy = legacyR2Region(env);
  if (legacy) regions.set(legacy.code, legacy);
  for (const name of Object.keys(env)) {
    const match = name.match(/^STORAGE_REGION_([A-Z0-9_]+)_ENDPOINT$/);
    if (!match) continue;
    const prefix = `STORAGE_REGION_${match[1]}_`;
    const region = parseRegion(match[1].toLowerCase().replace(/_/g, "-"), {
      endpoint: env[`${prefix}ENDPOINT`] ?? "",
      bucket: env[`${prefix}BUCKET`] ?? "",
      accessKeyId: env[`${prefix}ACCESS_KEY_ID`] ?? "",
      secretAccessKey: env[`${prefix}SECRET_ACCESS_KEY`] ?? "",
      signingRegion: env[`${prefix}SIGNING_REGION`],
      provider: env[`${prefix}PROVIDER`],
      label: env[`${prefix}LABEL`],
      countries: splitList(env[`${prefix}COUNTRIES`]),
      publicUrlBases: splitList(env[`${prefix}PUBLIC_URL`]),
    });
    if (!region || !region.accessKeyId || !region.secretAccessKey) {
      console.warn(`[storage-regions] Ignoring incomplete storage region configuration for ${match[1]}.`);
      continue;
    }
    regions.set(region.code, region);
  }
  const requestedDefault = clean(env.STORAGE_DEFAULT_REGION).toLowerCase();
  const defaultCode = requestedDefault && regions.has(requestedDefault) ? requestedDefault : "r2";
  if (requestedDefault && defaultCode !== requestedDefault) {
    console.warn(`[storage-regions] STORAGE_DEFAULT_REGION "${requestedDefault}" is not configured; using "${defaultCode}".`);
  }
  return { regions, defaultCode };
}

let registry: { regions: Map<string, StorageRegion>; defaultCode: string } | null = null;

function loadRegistry() {
  if (!registry) registry = parseStorageRegions(process.env);
  return registry;
}

/** Test hook: forget the parsed configuration so a new env is read. */
export function resetStorageRegionRegistryForTests() {
  registry = null;
}

export function listStorageRegions(): StorageRegion[] {
  return Array.from(loadRegistry().regions.values());
}

export function getStorageRegion(code: string | null | undefined): StorageRegion | null {
  const normalized = clean(code).toLowerCase();
  return normalized ? loadRegistry().regions.get(normalized) ?? null : null;
}

export function defaultStorageRegion(): StorageRegion {
  const { regions, defaultCode } = loadRegistry();
  return regions.get(defaultCode)!;
}

export function isDefaultStorageRegion(region: StorageRegion) {
  return region.code === loadRegistry().defaultCode;
}

const warnedUnknownCodes = new Set<string>();

/**
 * Resolve the region recorded for a photographer. Unknown or unconfigured
 * codes fall back to the default region (and warn once) rather than failing a
 * request — a misconfiguration must degrade to the historical behaviour.
 */
export function storageRegionForCode(code: string | null | undefined): StorageRegion {
  const normalized = clean(code).toLowerCase();
  if (!normalized) return defaultStorageRegion();
  const region = getStorageRegion(normalized);
  if (region) return region;
  if (!warnedUnknownCodes.has(normalized)) {
    warnedUnknownCodes.add(normalized);
    console.warn(`[storage-regions] Photographer storage region "${normalized}" is not configured; using the default region.`);
  }
  return defaultStorageRegion();
}

/** The region new photographers from a country are homed in. */
export function storageRegionForCountry(country: string | null | undefined): StorageRegion {
  const iso = clean(country).toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso)) return defaultStorageRegion();
  for (const region of listStorageRegions()) {
    if (region.countries.includes(iso)) return region;
  }
  return defaultStorageRegion();
}

/** Regions a photographer may be offered at sign-up (never the legacy pool). */
export function selectableStorageRegions(): StorageRegion[] {
  return listStorageRegions().filter((region) => region.code !== "r2" && region.countries.length > 0);
}

export function hasStorageCredentials(region: StorageRegion = currentStorageRegion()) {
  return Boolean(region.accessKeyId && region.secretAccessKey && !region.host.startsWith("unconfigured."));
}

// ── Request context ───────────────────────────────────────────────────────
//
// Most storage helpers accept an explicit `region`. For the many call sites
// that only know the object key, the photographer's region is established
// once per request (after the photographer row is loaded) and picked up here.

const storageContext = new AsyncLocalStorage<StorageRegion>();

export function currentStorageRegion(): StorageRegion {
  return storageContext.getStore() ?? defaultStorageRegion();
}

export function runWithStorageRegion<T>(region: StorageRegion, fn: () => T): T {
  return storageContext.run(region, fn);
}

/** Bind the rest of the current async flow (request) to a region. */
export function enterStorageRegion(region: StorageRegion) {
  storageContext.enterWith(region);
  return region;
}

export type PhotographerStorageRow = { id?: string | null; storage_region?: string | null } | null | undefined;

/** Resolve and enter the region for a loaded photographer row. */
export function enterPhotographerStorageRegion(row: PhotographerStorageRow): StorageRegion {
  return enterStorageRegion(storageRegionForCode(row?.storage_region));
}

/** Non-secret description for logs and the Settings page. */
export function describeStorageRegion(region: StorageRegion) {
  return { code: region.code, provider: region.provider, label: region.label, countries: region.countries, host: region.host, bucket: region.bucket };
}

/**
 * Identify which configured region a direct storage URL belongs to, if any.
 * Returns null for unknown hosts; callers decide whether that is acceptable.
 */
export function storageRegionForUrl(value: string | URL | null | undefined): StorageRegion | null {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(clean(typeof value === "string" ? value : ""));
  } catch {
    return null;
  }
  const host = url.host.toLowerCase();
  for (const region of listStorageRegions()) {
    if (host === region.host) {
      const bucket = url.pathname.replace(/^\/+/, "").split("/")[0];
      if (decodeURIComponentSafe(bucket) === region.bucket) return region;
      continue;
    }
    if (host === `${region.bucket}.${region.host}`) return region;
  }
  return null;
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
