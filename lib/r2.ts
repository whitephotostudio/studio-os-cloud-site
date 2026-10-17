import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { signedR2MediaUrl } from "@/lib/r2-media-token";
import { schoolPhotoFamilyForKey } from "@/lib/school-photo-deletions";
import {
  currentStorageRegion,
  defaultStorageRegion,
  hasStorageCredentials,
  type StorageRegion,
} from "@/lib/storage-regions";

export type { StorageRegion } from "@/lib/storage-regions";

const clients = new Map<string, S3Client>();
let _missingConfigWarned = false;

/**
 * Returns a cached S3-compatible client for a storage region.
 *
 * Without an argument this is the DEFAULT region's client (matching the
 * `R2_BUCKET` constant), not the request-context region: raw command call
 * sites that pair `getR2Client()` with `R2_BUCKET` therefore stay consistent.
 * Region-aware code passes the photographer's region explicitly (or uses the
 * higher-level helpers below, which honour the request context).
 * Server-side only — do not import in client components.
 */
export function getR2Client(region: StorageRegion = defaultStorageRegion()) {
  let client = clients.get(region.code);
  if (!client) {
    client =
      region.provider === "r2"
        ? new S3Client({
            region: "auto",
            endpoint: region.endpoint,
            credentials: { accessKeyId: region.accessKeyId, secretAccessKey: region.secretAccessKey },
          })
        : new S3Client({
            region: region.signingRegion,
            endpoint: region.endpoint,
            forcePathStyle: region.pathStyle,
            credentials: { accessKeyId: region.accessKeyId, secretAccessKey: region.secretAccessKey },
            // Backblaze/Wasabi do not accept the SDK's newer default request
            // checksums (x-amz-checksum-crc32 / aws-chunked trailers).
            requestChecksumCalculation: "WHEN_REQUIRED",
            responseChecksumValidation: "WHEN_REQUIRED",
          });
    clients.set(region.code, client);
  }
  return client;
}

/** Client plus bucket for one region, for raw SDK commands. */
export function storageClientFor(region: StorageRegion = currentStorageRegion()) {
  return { client: getR2Client(region), bucket: region.bucket, region };
}

export function hasR2Config(region: StorageRegion = defaultStorageRegion()) {
  return hasStorageCredentials(region);
}

function warnMissingR2ConfigOnce() {
  if (_missingConfigWarned) return;
  _missingConfigWarned = true;
  console.warn("R2 cleanup skipped because R2 env vars are missing.");
}

/** Bucket of the default storage region (pairs with `getR2Client()`). */
export const R2_BUCKET = defaultStorageRegion().bucket;

/** Bucket of the request-context region (or default). */
export function storageBucket(region: StorageRegion = currentStorageRegion()) {
  return region.bucket;
}

type RegionOption = { region?: StorageRegion };

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
  options?: { allowCloudCreditOutput?: boolean; allowVerifiedCutout?: boolean } & RegionOption,
) {
  if (key.split("/").filter(Boolean)[0] === "credits" && !options?.allowCloudCreditOutput) {
    throw new Error("Cloud credit outputs require their owned processing job.");
  }
  if (key.split("/").filter(Boolean)[0] === "nobg-photos" && !options?.allowVerifiedCutout) throw new Error("Managed cutout uploads require verified paid access.");
  if (key.split("/").filter(Boolean)[0] === "credit-staging") throw new Error("Cutout staging requires its private upload ticket.");
  if (key.split("/")[0] === "order-automation") throw new Error("Order production storage requires its private adapter.");
  const { client, bucket } = storageClientFor(options?.region);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
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
export async function r2Copy(srcKey: string, destKey: string, options: RegionOption = {}) {
  if ([srcKey,destKey].some(key=>key.split("/")[0]==="order-automation")) throw new Error("Private production objects cannot be copied by generic storage.");
  if ([srcKey,destKey].some(key=>key.split("/").filter(Boolean)[0]==="credits")) throw new Error("Cloud credit outputs cannot be moved by generic storage operations.");
  if ([srcKey,destKey].some(key=>key.split("/").filter(Boolean)[0]==="credit-staging")) throw new Error("Cutout staging cannot be copied by generic storage operations.");
  if ([srcKey,destKey].some(key=>key.split("/").filter(Boolean)[0]==="nobg-photos")) throw new Error("Managed cutouts must be uploaded with their paid photo proof when moving to a new folder.");
  const { client, bucket } = storageClientFor(options.region);
  const encodedSource = `${bucket}/${srcKey
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: encodedSource,
      Key: destKey,
    }),
  );
}

/**
 * Download a file from R2.  Returns the body as a Buffer.
 */
export async function r2Download(key: string, options: { allowVerifiedCutout?: boolean; allowCutoutStaging?: boolean; maxBytes?: number } & RegionOption = {}): Promise<Buffer> {
  if (key.split("/")[0] === "order-automation") throw new Error("Private production storage requires its adapter.");
  if (key.split("/").filter(Boolean)[0]==="credits") throw new Error("Cloud credit outputs require their owned job result.");
  if (key.split("/").filter(Boolean)[0]==="nobg-photos" && !options.allowVerifiedCutout) throw new Error("Managed cutouts require verified paid access.");
  if (key.split("/").filter(Boolean)[0]==="credit-staging" && !options.allowCutoutStaging) throw new Error("Cutout staging is private and cannot be used as a photo.");
  const { client, bucket } = storageClientFor(options.region);
  const res = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }), { abortSignal: AbortSignal.timeout(30000) },
  );
  const stream = res.Body;
  if (options.maxBytes && Number(res.ContentLength) > options.maxBytes) throw new Error("Managed cutout exceeds the image size limit.");
  if (!stream) throw new Error("Empty response body from R2");
  const bytes = await stream.transformToByteArray();
  if (options.maxBytes && bytes.byteLength > options.maxBytes) throw new Error("Managed cutout exceeds the image size limit.");
  return Buffer.from(bytes);
}

/**
 * Delete a file from R2.
 */
export async function r2Delete(key: string, options: { allowCutoutStaging?: boolean } & RegionOption = {}) {
  if (key.split("/")[0] === "order-automation") throw new Error("Private production storage requires its adapter.");
  if (key.split("/").filter(Boolean)[0]==="credits") throw new Error("Cloud credit outputs cannot be deleted by generic storage operations.");
  if (key.split("/").filter(Boolean)[0]==="credit-staging" && !options.allowCutoutStaging) throw new Error("Cutout staging cleanup requires its owner.");
  const { client, bucket } = storageClientFor(options.region);
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

/**
 * Delete ALL files under a given prefix (folder) in R2.
 * R2 supports up to 1000 deletes per batch request.
 */
export async function r2DeletePrefix(prefix: string, options: RegionOption = {}) {
  if (prefix.split("/")[0] === "order-automation") throw new Error("Private production storage cannot be deleted generically.");
  if (prefix.split("/").filter(Boolean)[0]==="credits") throw new Error("Cloud credit outputs cannot be deleted by generic storage operations.");
  if (prefix.split("/").filter(Boolean)[0]==="credit-staging") throw new Error("Cutout staging cleanup requires its owner.");
  const { client, bucket } = storageClientFor(options.region);
  let continuationToken: string | undefined;
  let totalDeleted = 0;

  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }),
    );

    const objects = list.Contents;
    if (!objects || objects.length === 0) break;

    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
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

export async function r2DeleteWithVariants(keys: string[], options: RegionOption = {}) {
  const normalizedKeys = Array.from(
    new Set(
      keys
        .flatMap((key) => r2VariantKeys(key))
        .map((key) => normalizePrefix(key))
        .filter(Boolean),
    ),
  );

  if (!normalizedKeys.length) return 0;
  if (normalizedKeys.some(key=>key.split("/")[0]==="credits")) throw new Error("Cloud credit outputs cannot be deleted by generic storage operations.");
  if (normalizedKeys.some(key=>key.split("/")[0]==="credit-staging")) throw new Error("Cutout staging cleanup requires its owner.");

  const { client, bucket } = storageClientFor(options.region);
  let totalDeleted = 0;

  for (let index = 0; index < normalizedKeys.length; index += 1000) {
    const batch = normalizedKeys.slice(index, index + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
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

export async function r2DeleteWithVariantsBestEffort(keys: string[], options: RegionOption = {}) {
  if (!keys.length) return 0;
  const region = options.region ?? currentStorageRegion();
  if (!hasR2Config(region)) {
    warnMissingR2ConfigOnce();
    return 0;
  }

  try {
    return await r2DeleteWithVariants(keys, { region });
  } catch (error) {
    console.warn("Failed to delete R2 files with variants:", error);
    return 0;
  }
}

export async function listR2FolderImages(
  prefix: string,
  options?: { ttlSeconds?: number; photographerId?: string | null } & RegionOption,
): Promise<R2FolderImage[]> {
  const normalizedPrefix = normalizePrefix(prefix);
  if (!normalizedPrefix) return [];
  const ttlSeconds = options?.ttlSeconds ?? 60 * 60;

  const { client, bucket } = storageClientFor(options?.region);
  const results: R2FolderImage[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
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
        url: options?.photographerId
          ? signedR2MediaUrl(key, ttlSeconds, options.photographerId)
          : `/api/r2/img/${key.split("/").map(encodeURIComponent).join("/")}`,
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
  options?: { excludedFamilies?: ReadonlySet<string> } & RegionOption,
): Promise<number> {
  const normalizedPrefix = normalizePrefix(prefix);
  if (!normalizedPrefix) return 0;

  const { client, bucket } = storageClientFor(options?.region);
  let count = 0;
  let continuationToken: string | undefined;

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
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
