import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

let _client: S3Client | null = null;

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

export const R2_BUCKET = process.env.R2_BUCKET_NAME || "whitephoto-media";
export const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");

/**
 * Returns the public URL for a given storage key in R2.
 */
export function r2PublicUrl(key: string) {
  if (!R2_PUBLIC_URL || !key) return "";
  const encodedKey = key
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `${R2_PUBLIC_URL}/${encodedKey}`;
}

/**
 * Upload a file (Buffer) to R2.
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
  return r2PublicUrl(key);
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
  // @ts-ignore — transformToByteArray exists on the SDK stream
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
