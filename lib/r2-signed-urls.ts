import { createHash, createHmac } from "crypto";
import { currentStorageRegion, hasStorageCredentials, type StorageRegion } from "@/lib/storage-regions";

// 2026-04-30 — SigV4 query-string presigner for S3-compatible storage.
//
// We migrated off public R2 URLs after the bucket's public dev URL
// (pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev) stopped serving
// `whitephoto-media` content.  Every gallery image now resolves
// through a short-lived presigned GET URL generated server-side by
// this helper.
//
// 2026-10-17 — URLs are signed against the photographer's storage region
// (Cloudflare R2, Backblaze B2, Wasabi or AWS S3; see lib/storage-regions.ts).
// Callers pass `region` explicitly or rely on the request context.
//
// Why hand-rolled and not @aws-sdk/s3-request-presigner: keeping the
// dependency surface tight.  The presigner package would be ~20MB of
// extra bundle on the server runtime for a function that's ~50 LOC.
// AWS SigV4 is well-specified and stable; we already use the same
// algorithm in the desktop Dart client (R2StorageService).
//
// Server-side ONLY.  Never import from a client component — the
// secret access key would leak into the browser bundle.

export type PresignRegionOption = { region?: StorageRegion };

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
function r2PresignedUrl(
  method: "GET" | "PUT",
  key: string,
  expiresInSeconds: number,
  uploadHeaders?: { contentLength: number; contentType: string },
  region: StorageRegion = currentStorageRegion(),
): string {
  if (!key) return "";
  if (!hasStorageCredentials(region)) {
    console.error(
      `[r2-signed-urls] Storage secrets missing for region "${region.code}" — cannot presign URL.  ` +
        "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (or the STORAGE_REGION_* variables).",
    );
    return "";
  }

  const now = new Date();
  const stamp = amzDate(now);
  const date = dateStamp(now);
  const credentialScope = `${date}/${region.signingRegion}/s3/aws4_request`;
  const credential = `${region.accessKeyId}/${credentialScope}`;

  const host = region.host;
  const canonicalUri = `/${region.bucket}/${encodePath(key)}`;
  const headerEntries: Array<[string, string]> = uploadHeaders
    ? [["content-length", String(uploadHeaders.contentLength)], ["content-type", uploadHeaders.contentType], ["host", host]]
    : [["host", host]];
  const signedHeaders = headerEntries.map(([name]) => name).join(";");

  // Query parameters, alphabetically sorted by key per SigV4 rules.
  const queryParams: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(expiresInSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  const canonicalQuery = queryParams
    .map(([k, v]) => `${uriEncodeSegment(k)}=${uriEncodeSegment(v)}`)
    .join("&");

  const canonicalHeaders = headerEntries.map(([name, value]) => `${name}:${value}\n`).join("");
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    method,
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

  const kDate = hmac("AWS4" + region.secretAccessKey, date);
  const kRegion = hmac(kDate, region.signingRegion);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function r2PresignedGetUrl(
  key: string,
  expiresInSeconds = 60 * 60,
  options: { allowCloudCreditOutput?: boolean; allowVerifiedCutout?: boolean; allowOrderAutomation?: boolean } & PresignRegionOption = {},
): string {
  // Generic galleries and legacy user-controlled metadata cannot grant access
  // to platform AI outputs. Only the gateway enables this after job ownership.
  if (key.split("/").filter(Boolean)[0] === "order-automation" && !options.allowOrderAutomation) return "";
  if (key.split("/").filter(Boolean)[0] === "credits" && !options.allowCloudCreditOutput) return "";
  if (key.split("/").filter(Boolean)[0] === "nobg-photos" && !options.allowVerifiedCutout) return "";
  if (key.split("/").filter(Boolean)[0] === "credit-staging") return "";
  return r2PresignedUrl("GET", key, expiresInSeconds, undefined, options.region);
}

/**
 * Generate a short-lived direct-upload URL. Every grant binds its validated
 * Content-Length and Content-Type;
 * a client cannot upload a larger body than its server-validated ticket.
 */
export function r2PresignedPutUrl(
  key: string,
  expiresInSeconds = 15 * 60,
  options: { allowCutoutStaging?: boolean; allowOrderAutomation?: boolean; contentLength?: number; contentType?: string } & PresignRegionOption = {},
): string {
  if (["credits", "nobg-photos"].includes(key.split("/").filter(Boolean)[0])) return "";
  if (key.split("/").filter(Boolean)[0] === "order-automation") {
    if (!options.allowOrderAutomation || !Number.isSafeInteger(options.contentLength) || !options.contentLength || options.contentLength < 1 || options.contentLength > 256*1024*1024 || !["image/jpeg", "application/zip"].includes(options.contentType || "")) return "";
    return r2PresignedUrl("PUT", key, Math.min(expiresInSeconds, 120), { contentLength: options.contentLength, contentType: options.contentType! }, options.region);
  }
  if (key.split("/").filter(Boolean)[0] === "credit-staging") {
    if (!options.allowCutoutStaging || !Number.isSafeInteger(options.contentLength) || !options.contentLength ||
      options.contentLength < 1 || options.contentLength > 25 * 1024 * 1024 || !options.contentType || !/^[a-z0-9-]+\/[a-z0-9.+-]+$/.test(options.contentType)) return "";
    return r2PresignedUrl("PUT", key, Math.min(expiresInSeconds, 120), { contentLength: options.contentLength, contentType: options.contentType }, options.region);
  }
  if (!Number.isSafeInteger(options.contentLength) || !options.contentLength ||
      options.contentLength < 1 || options.contentLength > 250 * 1024 * 1024 ||
      !options.contentType || !/^[a-z0-9-]+\/[a-z0-9.+-]+$/.test(options.contentType)) return "";
  return r2PresignedUrl("PUT", key, expiresInSeconds, {
    contentLength: options.contentLength, contentType: options.contentType,
  }, options.region);
}


// `r2KeyFromAnyUrl` lives in the client-safe module so browser bundles never
// pull this server-only signer (and its request-context dependency) in.
export { r2KeyFromAnyUrl } from "@/lib/storage-hosts";

/**
 * Batch-presign helper.  Useful for galleries where we generate
 * dozens of URLs at once.  Returns a record keyed by the original
 * input.  Empty strings stay empty.
 */
export function r2PresignBatch(
  keys: Array<string | null | undefined>,
  expiresInSeconds = 60 * 60,
  options: PresignRegionOption = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of keys) {
    const key = (raw ?? "").trim();
    if (!key) continue;
    if (out[key]) continue; // dedup
    out[key] = r2PresignedGetUrl(key, expiresInSeconds, { region: options.region });
  }
  return out;
}
