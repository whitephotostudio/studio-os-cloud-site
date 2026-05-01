import { createHash, createHmac } from "crypto";

// 2026-04-30 — Cloudflare R2 SigV4 query-string presigner.
//
// We migrated off public R2 URLs after the bucket's public dev URL
// (pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev) stopped serving
// `whitephoto-media` content.  Every gallery image now resolves
// through a short-lived presigned GET URL generated server-side by
// this helper.
//
// Why hand-rolled and not @aws-sdk/s3-request-presigner: keeping the
// dependency surface tight.  The presigner package would be ~20MB of
// extra bundle on the server runtime for a function that's ~50 LOC.
// AWS SigV4 is well-specified and stable; we already use the same
// algorithm in the desktop Dart client (R2StorageService).
//
// Server-side ONLY.  Never import from a client component — the
// secret access key would leak into the browser bundle.

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_BUCKET = process.env.R2_BUCKET_NAME || "whitephoto-media";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_REGION = "auto";

function hasR2Secrets() {
  return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
}

function sha256Hex(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, data: string) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function uriEncodeSegment(segment: string) {
  // RFC 3986 unreserved set: A-Z a-z 0-9 - _ . ~  (everything else
  // gets percent-encoded).  This matches the canonicalization rules
  // AWS expects for SigV4 query-string signing of paths.
  return encodeURIComponent(segment).replace(
    /[!*'()]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodePath(key: string) {
  return key
    .split("/")
    .filter(Boolean)
    .map(uriEncodeSegment)
    .join("/");
}

function amzDate(date: Date) {
  // Format: 20260430T112233Z
  const iso = date.toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function dateStamp(date: Date) {
  return amzDate(date).slice(0, 8);
}

/**
 * Generate a presigned GET URL for an R2 object.
 *
 * @param key Object key (no leading slash). e.g. "projects/abc/albums/def/photo.jpg"
 * @param expiresInSeconds URL TTL.  Default 1 hour.  Max 7 days per AWS.
 */
export function r2PresignedGetUrl(
  key: string,
  expiresInSeconds = 60 * 60,
): string {
  if (!key) return "";
  if (!hasR2Secrets()) {
    // In dev / Vercel previews without R2 secrets we fall back to the
    // public URL so local rendering still works.  Production must set
    // the env vars or every gallery will return blank URLs.
    if (process.env.NODE_ENV !== "production") {
      const publicBase = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
      return publicBase ? `${publicBase}/${encodePath(key)}` : "";
    }
    console.error(
      "[r2-signed-urls] R2 secrets missing — cannot presign URL.  " +
        "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.",
    );
    return "";
  }

  const now = new Date();
  const stamp = amzDate(now);
  const date = dateStamp(now);
  const credentialScope = `${date}/${R2_REGION}/s3/aws4_request`;
  const credential = `${R2_ACCESS_KEY_ID}/${credentialScope}`;

  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${R2_BUCKET}/${encodePath(key)}`;

  // Query parameters, alphabetically sorted by key per SigV4 rules.
  const queryParams: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(expiresInSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = queryParams
    .map(([k, v]) => `${uriEncodeSegment(k)}=${uriEncodeSegment(v)}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac("AWS4" + R2_SECRET_ACCESS_KEY, date);
  const kRegion = hmac(kDate, R2_REGION);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Convenience: extract the storage key from any of the URL shapes we
 * historically stored — full R2 public URL, public Supabase URL, or
 * a bare object key.  Lets call sites pass whatever's in the DB.
 */
export function r2KeyFromAnyUrl(input: string | null | undefined): string {
  const value = (input ?? "").trim();
  if (!value) return "";

  // Already a bare key (no scheme)?  This includes our new
  // `/api/r2/img/<path>` proxy URLs — strip that prefix so the key
  // reflects the underlying storage path.
  if (!/^https?:\/\//i.test(value)) {
    const stripped = value.replace(/^\/+/, "");
    if (stripped.startsWith("api/r2/img/")) {
      return decodeURIComponent(stripped.slice("api/r2/img/".length));
    }
    return decodeURIComponent(stripped);
  }

  try {
    const parsed = new URL(value);
    // Our own proxy URL: <site>/api/r2/img/<key>
    if (parsed.pathname.startsWith("/api/r2/img/")) {
      return decodeURIComponent(parsed.pathname.slice("/api/r2/img/".length));
    }
    // R2 public dev URL: pub-XXXX.r2.dev/<key>
    if (/\.r2\.dev$/i.test(parsed.host)) {
      return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    }
    // R2 S3 endpoint (rare for stored URLs but supported): <accountId>.r2.cloudflarestorage.com/<bucket>/<key>
    if (/\.r2\.cloudflarestorage\.com$/i.test(parsed.host)) {
      const stripped = parsed.pathname.replace(/^\/+/, "");
      const slash = stripped.indexOf("/");
      return slash >= 0 ? decodeURIComponent(stripped.slice(slash + 1)) : "";
    }
    // Custom domain pointing at R2 bucket — assume path is the key.
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

/**
 * Batch-presign helper.  Useful for galleries where we generate
 * dozens of URLs at once.  Returns a record keyed by the original
 * input.  Empty strings stay empty.
 */
export function r2PresignBatch(
  keys: Array<string | null | undefined>,
  expiresInSeconds = 60 * 60,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of keys) {
    const key = (raw ?? "").trim();
    if (!key) continue;
    if (out[key]) continue; // dedup
    out[key] = r2PresignedGetUrl(key, expiresInSeconds);
  }
  return out;
}
