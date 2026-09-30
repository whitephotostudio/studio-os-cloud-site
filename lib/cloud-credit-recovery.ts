import { GetObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { getR2Client, R2_BUCKET } from "@/lib/r2";

/** A crashed worker must return credits even when its photographer never retries. */
export async function recoverInterruptedCloudCredits(service: ReturnType<typeof createDashboardServiceClient>) {
  const { data, error } = await service.from("credit_cloud_jobs")
    .select("id,lease_token,original_sha256,output_sha256,output_key").eq("status", "processing")
    .lte("lease_expires_at", new Date().toISOString()).order("lease_expires_at", { ascending: true }).limit(25);
  if (error) throw error;
  const jobs = data ?? [];
  let recovered = 0;
  let refunded = 0;
  let failed = 0;
  for (let index = 0; index < jobs.length; index += 5) {
    await Promise.all(jobs.slice(index, index + 5).map(async job => {
      try {
        let exists;
        try {
          const object = await getR2Client().send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: job.output_key }), { abortSignal: AbortSignal.timeout(15000) });
          if (object.ContentType !== "image/png" || !object.ContentLength || object.ContentLength > 20 * 1024 * 1024 || !object.Body) throw new Error("Cannot verify saved output.");
          // An unknown legacy saved file stays paid for review. It must not be
          // refunded merely because the new source proof is not yet attached.
          if (!job.original_sha256 || !job.output_sha256) throw new Error("Saved output needs source proof.");
          const bytes = Buffer.from(await object.Body.transformToByteArray());
          if (bytes.length !== object.ContentLength || createHash("sha256").update(bytes).digest("hex") !== job.output_sha256) throw new Error("Saved output changed.");
          exists = true;
        } catch (issue) {
          if ((issue as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw issue;
          exists = false;
        }
        const result = await service.rpc("finish_cloud_credit_job", { p_job_id: job.id, p_token: job.lease_token,
          p_succeeded: exists, p_error: exists ? null : "Worker interrupted before saving output" });
        if (result.error || result.data !== true) throw new Error("Cloud recovery could not be verified.");
        if (exists) recovered += 1;
        else refunded += 1;
      } catch { failed += 1; }
    }));
  }
  return { processed: jobs.length, recovered, refunded, failed };
}
