import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, R2_BUCKET } from "@/lib/r2";
import { createHash } from "node:crypto";
export const digest = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
export function productionKey(owner: string, suffix: string) {
  if (
    !/^[0-9a-f-]{36}$/.test(owner) ||
    !/^[A-Za-z0-9/_.-]+$/.test(suffix) ||
    suffix.includes("..")
  )
    throw Error("Invalid private production identity");
  return `order-automation/${owner}/${suffix}`;
}
export async function readProduction(key: string, maximum: number) {
  if (!key.startsWith("order-automation/")) throw Error("Invalid namespace");
  const response = await getR2Client().send(
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    { abortSignal: AbortSignal.timeout(60000) },
  );
  if (
    !response.Body ||
    !response.ContentLength ||
    response.ContentLength > maximum
  )
    throw Error("Production object size needs review");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    size += chunk.length;
    if (size > maximum) throw Error("Production object size needs review");
    chunks.push(Buffer.from(chunk));
  }
  return { bytes: Buffer.concat(chunks), etag: response.ETag! };
}
export async function readProductionJson<T>(key: string) {
  try {
    const result = await readProduction(key, 1024 * 1024);
    return {
      value: JSON.parse(result.bytes.toString()) as T,
      etag: result.etag,
    };
  } catch (e) {
    if (
      (e as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404
    )
      return null;
    throw e;
  }
}
export async function writeProduction(
  key: string,
  bytes: Uint8Array,
  type: string,
  condition: { etag?: string; create?: boolean } = {},
) {
  if (!key.startsWith("order-automation/")) throw Error("Invalid namespace");
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: type,
      CacheControl: "private, no-store",
      ...(condition.create ? { IfNoneMatch: "*" } : {}),
      ...(condition.etag ? { IfMatch: condition.etag } : {}),
    }),
    { abortSignal: AbortSignal.timeout(60000) },
  );
}
export const writeProductionJson = (
  key: string,
  value: unknown,
  condition: { etag?: string; create?: boolean } = {},
) =>
  writeProduction(
    key,
    Buffer.from(JSON.stringify(value)),
    "application/json",
    condition,
  );
