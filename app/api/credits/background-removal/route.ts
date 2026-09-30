import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { createDashboardServiceClient, resolveDashboardAuth } from "@/lib/dashboard-auth";
import { getR2Client, hasR2Config, R2_BUCKET, r2Upload } from "@/lib/r2";
import { r2PresignedGetUrl } from "@/lib/r2-signed-urls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;
const MAX_UPLOAD = 3 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Job = { claimed: boolean; state: string; token: string; output_key: string; lease_expired: boolean };

function configured() { return Boolean(process.env.PHOTOROOM_API_KEY?.trim()) && hasR2Config(); }
function unavailable() {
  return NextResponse.json({ ok: false, configured: false, processing: false, message: "Premium Cloud is not available yet. No credits were charged. Use local removal or try again later." }, { status: 503 });
}
async function authenticate(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) return { response: NextResponse.json({ ok: false, message: "Please sign in to Studio OS." }, { status: 401 }) };
  if (auth.mfaSatisfied === false) return { response: NextResponse.json({ ok: false, message: "Complete two-step verification before processing photos." }, { status: 403 }) };
  return { user: auth.user };
}
function completed(jobId: string, key: string) {
  const outputUrl = r2PresignedGetUrl(key, 900, { allowCloudCreditOutput: true });
  if (!outputUrl) throw new Error("Cloud output is unavailable.");
  return NextResponse.json({ ok: true, jobId, outputUrl, creditsUsed: 4 }, { headers: { "Cache-Control": "no-store" } });
}
function failed() {
  return NextResponse.json({ ok: false, failed: true, message: "Premium Cloud could not finish this photo. Its reserved credits were returned where still valid. You can start a new attempt." }, { status: 422 });
}
async function outputExists(key: string) {
  try {
    const result = await getR2Client().send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return result.ContentType === "image/png" && Number(result.ContentLength) > 0;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw new Error("Cannot verify saved cloud output.");
  }
}

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth.response) return auth.response;
  if (!configured()) return unavailable();
  return NextResponse.json({ ok: true, configured: true, costPerPhoto: 4 }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  let job: Job | undefined;
  let jobId: string | undefined;
  let service: ReturnType<typeof createDashboardServiceClient> | undefined;
  let saved = false;
  let outputUncertain = false;
  try {
    const auth = await authenticate(request);
    if (auth.response) return auth.response;
    // Configuration and input validation precede the reservation. A missing
    // provider, corrupt image or oversized request must never spend credits.
    if (Number(request.headers.get("content-length") || 0) > MAX_UPLOAD + 16 * 1024) {
      return NextResponse.json({ ok: false, message: "Use a JPEG smaller than 3 MB." }, { status: 413 });
    }
    const form = await request.formData();
    const image = form.get("image_file");
    const requestedId = form.get("job_id");
    if (!(image instanceof File) || !image.size || image.size > MAX_UPLOAD ||
        typeof requestedId !== "string" || !UUID.test(requestedId)) {
      return NextResponse.json({ ok: false, message: "A photo smaller than 3 MB and a valid processing reference are required." }, { status: 400 });
    }
    const input = Buffer.from(await image.arrayBuffer());
    let metadata;
    try { metadata = await sharp(input, { limitInputPixels: 2048 * 2048 }).metadata(); }
    catch { return NextResponse.json({ ok: false, message: "This photo could not be read. Export a JPEG and try again." }, { status: 400 }); }
    if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > 2048 ||
        !["jpeg", "png", "webp"].includes(metadata.format || "")) {
      return NextResponse.json({ ok: false, message: "Use a JPEG, PNG or WebP with a maximum size of 2048 pixels." }, { status: 400 });
    }
    jobId = requestedId.toLowerCase();
    service = createDashboardServiceClient();
    const { data: photographer, error: profileError } = await service.from("photographers").select("id").eq("user_id", auth.user!.id).maybeSingle();
    if (profileError || !photographer?.id) return NextResponse.json({ ok: false, message: "Your photographer account could not be verified." }, { status: 403 });
    const outputKey = `credits/${auth.user!.id}/${jobId}.png`;
    const inputHash = createHash("sha256").update(input).digest("hex");
    const existing = await service.from("credit_cloud_jobs")
      .select("studio_id,photographer_id,input_sha256,output_key,status,lease_token,lease_expires_at")
      .eq("id", jobId).eq("studio_id", auth.user!.id).maybeSingle();
    if (existing.error) throw new Error("Cannot verify previous processing.");
    if (existing.data) {
      if (existing.data.photographer_id !== photographer.id || existing.data.input_sha256 !== inputHash || existing.data.output_key !== outputKey) {
        return NextResponse.json({ ok: false, message: "This processing reference belongs to another photo. Start a new attempt." }, { status: 409 });
      }
      // A provider-key rotation must not strand a photo already paid for.
      // This owned lookup cannot reserve or charge any new credits.
      job = { claimed: false, state: existing.data.status, token: existing.data.lease_token,
        output_key: existing.data.output_key, lease_expired: Date.parse(existing.data.lease_expires_at) <= Date.now() };
    } else {
      if (!configured()) return unavailable();
      const { data, error } = await service.rpc("reserve_cloud_credit_job", {
        p_job_id: jobId, p_studio_id: auth.user!.id, p_photographer_id: photographer.id,
        p_input_sha256: inputHash, p_output_key: outputKey, p_token: randomUUID(),
      });
      if (error) {
        if (/Insufficient (?:unexpired )?credits/i.test(error.message)) return NextResponse.json({ ok: false, message: "You need 4 available credits for this photo." }, { status: 402 });
        if (/contents changed/i.test(error.message)) return NextResponse.json({ ok: false, message: "This processing reference belongs to another photo. Start a new attempt." }, { status: 409 });
        throw new Error("Cannot reserve processing credits.");
      }
      job = data?.[0] as Job | undefined;
    }
    if (!job) throw new Error("Missing processing reservation.");
    if (job.state === "succeeded") return completed(jobId, job.output_key);
    if (job.state === "failed") return failed();
    if (!job.claimed) {
      if (!job.lease_expired) return NextResponse.json({ ok: false, processing: true, message: "This photo is still processing. Retry with the same reference." }, { status: 409, headers: { "Retry-After": "3" } });
      // Recover a successful upload after an interrupted completion. Never
      // repeat a provider call for a reservation with an uncertain outcome.
      const exists = await outputExists(job.output_key);
      const finish = await service.rpc("finish_cloud_credit_job", { p_job_id: jobId, p_token: job.token, p_succeeded: exists, p_error: exists ? null : "Interrupted processing" });
      if (finish.error || finish.data !== true) throw new Error("Cannot reconcile interrupted processing.");
      return exists ? completed(jobId, job.output_key) : failed();
    }
    const providerBody = new FormData();
    const mime = metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`;
    providerBody.append("image_file", new Blob([new Uint8Array(input)], { type: mime }), `photo.${metadata.format}`);
    providerBody.set("format", "png");
    providerBody.set("channels", "rgba");
    providerBody.set("size", "full");
    const provider = await fetch("https://sdk.photoroom.com/v1/segment", {
      method: "POST", headers: { "x-api-key": process.env.PHOTOROOM_API_KEY!.trim(), Accept: "image/png" },
      body: providerBody, signal: AbortSignal.timeout(70000),
    });
    if (!provider.ok) throw new Error(`Cloud provider rejected processing (HTTP ${provider.status}).`);
    const output = Buffer.from(await provider.arrayBuffer());
    if (output.length > 20 * 1024 * 1024) throw new Error("Cloud output was too large.");
    const outputImage = sharp(output, { limitInputPixels: 2048 * 2048 });
    const verified = await outputImage.metadata();
    const orientationSwapsDimensions = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
    const expectedWidth = orientationSwapsDimensions ? metadata.height : metadata.width;
    const expectedHeight = orientationSwapsDimensions ? metadata.width : metadata.height;
    if (verified.format !== "png" || !verified.hasAlpha || verified.width !== expectedWidth || verified.height !== expectedHeight) {
      throw new Error("Cloud output did not contain the expected transparent photo.");
    }
    const alpha = (await outputImage.stats()).channels.at(-1);
    if (!alpha || !Number.isFinite(alpha.min) || alpha.min >= 255) throw new Error("Cloud output was fully opaque.");
    outputUncertain = true;
    try {
      await r2Upload(job.output_key, output, "image/png", "private, no-store", { allowCloudCreditOutput: true });
    } catch (uploadError) {
      // PUT can succeed remotely while its acknowledgement is lost. Verify the
      // immutable output before deciding whether this job should be refunded.
      if (!(await outputExists(job.output_key))) { outputUncertain = false; throw uploadError; }
    }
    saved = true;
    outputUncertain = false;
    const finish = await service.rpc("finish_cloud_credit_job", { p_job_id: jobId, p_token: job.token, p_succeeded: true });
    if (finish.error || finish.data !== true) throw new Error("Cannot finish processing receipt.");
    return completed(jobId, job.output_key);
  } catch {
    // Never expose API keys, signed URLs, file names or provider error bodies.
    // Saved outputs remain paid and replayable; only unsaved claimed jobs fail.
    if (service && job?.claimed && jobId && !saved && !outputUncertain) {
      try {
        const outcome = await service.rpc("finish_cloud_credit_job", { p_job_id: jobId, p_token: job.token, p_succeeded: false, p_error: "Processing did not complete" });
        if (!outcome.error && outcome.data === true) return failed();
      } catch { /* Leave the durable reservation available for reconciliation. */ }
    }
    return NextResponse.json({ ok: false, processing: Boolean(job), message: "Unable to verify this processing attempt. Retry with the same reference to recover its result or credit balance." }, { status: 503 });
  }
}
