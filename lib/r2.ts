import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { r2PresignedGetUrl } from "@/lib/r2-signed-urls";
import { schoolPhotoFamilyForKey } from "@/lib/school-photo-deletions";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

let _client: S3Client | null = null;
let _missingConfigWarned = false;

/**
 * Returns a singleton S3-compatible client configured for Cloudflare R2.
 * Server-side only — do not import in client components.
 */
export function getR2Client() {
  if (!_client) {
    _client = new S3Client({
      region: "auto",
      endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env("R2_ACCESS_KEY_ID"),
        secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return _client;
}

export function hasR2Config() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
}

function warnMissingR2ConfigOnce() {
  if (_missingConfigWarned) return;
  _missingConfigWarned = true;
  console.warn("R2 cleanup skipped because R2 env vars are missing.");
}

export const R2_BUCKET = process.env.R2_BUCKET_NAME || "whitephoto-media";

type R2FolderImage = {
  key: string;
  name: string;
  url: string;
};

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function normalizePrefix(prefix: string) {
  return prefix
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function isImageKey(key: string) {
  return /\.(png|jpe?g|webp|gif|avif)$/i.test(key);
}

function isDerivedVariantKey(key: string) {
  return /_(thumbnail|preview)\.(png|jpe?g|webp|gif|avif)$/i.test(key);
}

/**
 * Upload a file (Buffer) to R2 and return its durable object key.
 *
 * Never return a permanent public URL here. New database rows must remain
 * usable after the bucket's r2.dev public-access switch is disabled.
 */
export async function r2Upload(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
  cacheControl = "public, max-age=31536000",
) {
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
  return key;
}

/**
 * Server-side copy of one object to a new key (no download/upload round-trip).
 * `CopySource` must be the URL-encoded `{bucket}/{key}` — keys can contain
 * spaces (e.g. class "SK A"), so each path segment is percent-encoded.
 */
export async function r2Copy(srcKey: string, destKey: string) {
  const client = getR2Client();
  const encodedSource = `${R2_BUCKET}/${srcKey
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  await client.send(
    new CopyObjectCommand({
      Bucket: R2_BUCKET,
      CopySource: encodedSource,
      Key: destKey,
    }),
  );
}

/**
 * Download a file from R2.  Returns the body as a Buffer.
 */
export async function r2Download(key: string): Promise<Buffer> {
  const client = getR2Client();
  const res = await client.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    }),
  );
  const stream = res.Body;
  if (!stream) throw new Error("Empty response body from R2");
  const bytes = await stream.transformToByteArray();
  return Buffer.from(bytes);
}

/**
 * Delete a file from R2.
 */
export async function r2Delete(key: string) {
  const client = getR2Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    }),
  );
}

/**
 * Delete ALL files under a given prefix (folder) in R2.
 * R2 supports up to 1000 deletes per batch request.
 */
export async function r2DeletePrefix(prefix: string) {
  const client = getR2Client();
  let continuationToken: string | undefined;
  let totalDeleted = 0;

  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }),
    );

    const objects = list.Contents;
    if (!objects || objects.length === 0) break;

    await client.send(
      new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: {
          Objects: objects.map((o) => ({ Key: o.Key! })),
          Quiet: true,
        },
      }),
    );

    totalDeleted += objects.length;
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);

  return totalDeleted;
}

export function r2VariantKeys(key: string) {
  const normalized = normalizePrefix(key);
  if (!normalized) return [];
  const extMatch = normalized.match(/(\.[^.]+)$/);
  const ext = extMatch?.[1] ?? "";
  const base = ext ? normalized.slice(0, -ext.length) : normalized;
  return Array.from(
    new Set([
      normalized,
      `${base}_thumbnail.jpg`,
      `${base}_preview.jpg`,
    ]),
  );
}

export async function r2DeleteWithVariants(keys: string[]) {
  const normalizedKeys = Array.from(
    new Set(
      keys
        .flatMap((key) => r2VariantKeys(key))
        .map((key) => normalizePrefix(key))
        .filter(Boolean),
    ),
  );

  if (!normalizedKeys.length) return 0;

  const client = getR2Client();
  let totalDeleted = 0;

  for (let index = 0; index < normalizedKeys.length; index += 1000) {
    const batch = normalizedKeys.slice(index, index + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: {
          Objects: batch.map((key) => ({ Key: key })),
          Quiet: true,
        },
      }),
    );
    totalDeleted += batch.length;
  }

  return totalDeleted;
}

export async function r2DeleteWithVariantsBestEffort(keys: string[]) {
  if (!keys.length) return 0;
  if (!hasR2Config()) {
    warnMissingR2ConfigOnce();
    return 0;
  }

  try {
    return await r2DeleteWithVariants(keys);
  } catch (error) {
    console.warn("Failed to delete R2 files with variants:", error);
    return 0;
  }
}

export async function listR2FolderImages(prefix: string): Promise<R2FolderImage[]> {
  const normalizedPrefix = normalizePrefix(prefix);
  if (!normalizedPrefix) return [];

  const client = getR2Client();
  const results: R2FolderImage[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: `${normalizedPrefix}/`,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of page.Contents ?? []) {
      const key = normalizePrefix(item.Key ?? "");
      if (!key || key === normalizedPrefix) continue;
      const name = key.split("/").pop() ?? "";
      if (!name || name.startsWith(".") || !isImageKey(name) || isDerivedVariantKey(name)) {
        continue;
      }

      results.push({
        key,
        name,
        url: r2PresignedGetUrl(key, 60 * 60),
      });
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return results.sort((a, b) => naturalCompare(a.name, b.name));
}

/** Count original images under an R2 prefix without generating signed URLs or
 * materializing/sorting every object. Intended for lightweight dashboard
 * rollups; preview and thumbnail derivatives are excluded. */
export async function countR2FolderImages(
  prefix: string,
  options?: { excludedFamilies?: ReadonlySet<string> },
): Promise<number> {
  const normalizedPrefix = normalizePrefix(prefix);
  if (!normalizedPrefix) return 0;

  const client = getR2Client();
  let count = 0;
  let continuationToken: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: `${normalizedPrefix}/`,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of page.Contents ?? []) {
      const key = normalizePrefix(item.Key ?? "");
      if (!key || key === normalizedPrefix) continue;
      const name = key.split("/").pop() ?? "";
      if (!name || name.startsWith(".") || !isImageKey(name) || isDerivedVariantKey(name)) {
        continue;
      }
      const family = schoolPhotoFamilyForKey(key);
      if (family && options?.excludedFamilies?.has(family)) continue;
      count += 1;
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  return count;
}
