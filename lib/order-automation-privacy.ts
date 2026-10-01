import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { getR2Client, R2_BUCKET } from "@/lib/r2";
import {
  writeProduction,
  readProduction,
} from "@/lib/order-automation-storage";
let verifiedUntil = 0;
/** A private namespace in a publicly readable bucket is not private storage.
 * Prove an existing dummy object is not readable through configured public
 * endpoints. Never upload customer data if this check is uncertain. */
export async function ensureProductionStoragePrivate() {
  if (Date.now() < verifiedUntil) return;
  const urls = [
    ...new Set(
      [process.env.R2_PUBLIC_URL, process.env.NEXT_PUBLIC_R2_PUBLIC_URL].filter(
        (v): v is string => Boolean(v),
      ),
    ),
  ];
  if (!urls.length)
    throw Error(
      "Private lab storage needs its public-access setting verified.",
    );
  const key = `order-automation/privacy-probe/${randomUUID()}`;
  const bytes = Buffer.from(`private-${randomUUID()}`);
  try {
    await writeProduction(key, bytes, "application/octet-stream", {
      create: true,
    });
    if (!(await readProduction(key, 1024)).bytes.equals(bytes))
      throw Error("Private storage verification failed.");
    for (const base of urls) {
      const url = new URL(base);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw Error("Invalid storage privacy configuration.");
      url.pathname = url.pathname.replace(/\/$/, "") + "/" + key;
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      await response.body?.cancel();
      if (![401, 403, 404].includes(response.status))
        throw Error(
          "R2 public access must be disabled before private lab delivery. Orders remain on hold.",
        );
    }
    verifiedUntil = Date.now() + 5 * 60 * 1000;
  } finally {
    await getR2Client()
      .send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }))
      .catch(() => {});
  }
}
