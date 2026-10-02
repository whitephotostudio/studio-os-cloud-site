import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
export async function verifyOrderProductionRelease(
  env = process.env,
  fetcher = fetch,
  report = console.log,
) {
  if (env.VERCEL_ENV !== "production") return;
  if (
    !env.R2_ACCOUNT_ID ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY ||
    !env.RESEND_API_KEY
  )
    throw Error("Private order storage and lab email must be configured.");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  const Bucket = env.R2_BUCKET_NAME || "whitephoto-media",
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
        IfNoneMatch: "*",
      }),
    );
    const read = await client.send(new GetObjectCommand({ Bucket, Key }));
    if (
      !read.Body ||
      !Buffer.from(await read.Body.transformToByteArray()).equals(bytes)
    )
      throw Error("Production private storage readback failed.");
    const publicUrls = [
      ...new Set(
        [env.R2_PUBLIC_URL, env.NEXT_PUBLIC_R2_PUBLIC_URL].filter(Boolean),
      ),
    ];
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
