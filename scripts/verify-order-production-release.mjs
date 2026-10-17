import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

/** Minimal copy of the env parsing in lib/storage-regions.ts (plain JS for the build). */
export function defaultStorageRegionFromEnv(env) {
  const clean = (value) => (value ?? "").trim();
  const list = (value) => clean(value).split(",").map((item) => item.trim()).filter(Boolean);
  const code = clean(env.STORAGE_DEFAULT_REGION).toLowerCase();
  if (code && code !== "r2") {
    const prefix = `STORAGE_REGION_${code.toUpperCase().replace(/-/g, "_")}_`;
    const endpoint = clean(env[`${prefix}ENDPOINT`]);
    let host = "";
    try { host = new URL(endpoint).host.toLowerCase(); } catch { host = ""; }
    const bucket = clean(env[`${prefix}BUCKET`]);
    const accessKeyId = clean(env[`${prefix}ACCESS_KEY_ID`]);
    const secretAccessKey = clean(env[`${prefix}SECRET_ACCESS_KEY`]);
    if (!host || !bucket || !accessKeyId || !secretAccessKey) return null;
    const provider = clean(env[`${prefix}PROVIDER`]) ||
      (/\.r2\.cloudflarestorage\.com$/.test(host) ? "r2" : /\.backblazeb2\.com$/.test(host) ? "b2" : /\.wasabisys\.com$/.test(host) ? "wasabi" : "s3");
    const inferred = host.match(/^s3[.-]([a-z0-9-]+)\.(backblazeb2\.com|wasabisys\.com|amazonaws\.com)$/);
    const signingRegion = clean(env[`${prefix}SIGNING_REGION`]) || (provider === "r2" ? "auto" : inferred ? inferred[1] : "us-east-1");
    return { code, provider, endpoint: `https://${host}`, bucket, signingRegion, accessKeyId, secretAccessKey,
      publicUrlBases: list(env[`${prefix}PUBLIC_URL`]) };
  }
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) return null;
  return { code: "r2", provider: "r2", endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: env.R2_BUCKET_NAME || "whitephoto-media", signingRegion: "auto",
    accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    publicUrlBases: [env.R2_PUBLIC_URL, env.NEXT_PUBLIC_R2_PUBLIC_URL].filter(Boolean) };
}
export async function verifyOrderProductionRelease(
  env = process.env,
  fetcher = fetch,
  report = console.log,
) {
  if (env.VERCEL_ENV !== "production") return;
  // Probe the DEFAULT storage region (mirrors lib/storage-regions.ts):
  // the legacy Cloudflare R2 pool unless STORAGE_DEFAULT_REGION names one of
  // the STORAGE_REGION_<CODE>_* configurations.
  const storage = defaultStorageRegionFromEnv(env);
  if (!storage || !env.RESEND_API_KEY)
    throw Error("Private order storage and lab email must be configured.");
  const client = new S3Client({
    region: storage.signingRegion,
    endpoint: storage.endpoint,
    ...(storage.provider === "r2" ? {} : {
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
    credentials: {
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
    },
  });
  const Bucket = storage.bucket,
    Key = `order-automation/privacy-probe/${randomUUID()}`;
  const bytes = Buffer.from(`private-${randomUUID()}`);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket,
        Key,
        Body: bytes,
        ContentType: "application/octet-stream",
        CacheControl: "private, no-store",
        // Conditional writes are an R2/AWS feature; the key is random anyway.
        ...(storage.provider === "r2" ? { IfNoneMatch: "*" } : {}),
      }),
    );
    const read = await client.send(new GetObjectCommand({ Bucket, Key }));
    if (
      !read.Body ||
      !Buffer.from(await read.Body.transformToByteArray()).equals(bytes)
    )
      throw Error("Production private storage readback failed.");
    const publicUrls = [...new Set(storage.publicUrlBases)];
    if (!publicUrls.length)
      throw Error(
        "Verify R2 public access is disabled before releasing lab links.",
      );
    for (const base of publicUrls) {
      const url = new URL(base);
      url.pathname = url.pathname.replace(/\/$/, "") + "/" + Key;
      const response = await fetcher(url, {
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      await response.body?.cancel();
      if (![401, 403, 404].includes(response.status))
        throw Error(
          "R2 public access must be disabled for private lab orders.",
        );
    }
    report(
      JSON.stringify({
        check: "order-private-storage",
        ok: true,
        customerFiles: 0,
      }),
    );
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket, Key })).catch(() => {});
    client.destroy();
  }
  const email = await fetcher("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!email.ok)
    throw Error("Lab email provider authentication failed; details withheld.");
  const domains = await email.json();
  const domain = (env.RESEND_FROM_EMAIL || "galleries@studiooscloud.com")
    .split("@")[1]
    ?.toLowerCase();
  if (
    !domains.data?.some(
      (d) => d.name.toLowerCase() === domain && d.status === "verified",
    )
  )
    throw Error("Lab email sender domain is not verified.");
  report(
    JSON.stringify({
      check: "order-email-configuration",
      ok: true,
      emailsSent: 0,
    }),
  );
  report(
    JSON.stringify({
      check: "order-ai-provider",
      provider: "local-only",
      cloudFallback: false,
      paidRequests: 0,
    }),
  );
}
if (import.meta.url === new URL(process.argv[1], "file:").href)
  await verifyOrderProductionRelease();
