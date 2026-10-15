import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { LAB_ORDER_BUCKET, labOrderAccess, labOrderDatabaseError, requireLabOrderAgreement } from "@/lib/labs/orders-server";
import { labOrderFailure, readBoundedLabBody } from "@/lib/labs/orders-http";
import { LAB_ORDER_MAX_FILE_BYTES, LAB_ORDER_MAX_IMAGE_PIXELS } from "@/lib/labs/orders-validation";
import { labOrderAssetFromRow } from "@/lib/labs/orders-types";
import { LabError } from "@/lib/labs/validation";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const access = await labOrderAccess(request, "studio");
    await requireLabOrderAgreement(access);
    const quota = await rateLimit(access.userId, { namespace: "lab-order-image-upload", limit: 60, windowSeconds: 60, failClosed: true });
    if (!quota.allowed) throw new LabError("Too many production-file uploads. Try again shortly.", quota.unavailable ? 503 : 429);
    const contentType = request.headers.get("content-type") || "";
    if (!/^multipart\/form-data\s*;/i.test(contentType)) throw new LabError("Choose a JPEG or PNG production file.");
    const body = await readBoundedLabBody(request, LAB_ORDER_MAX_FILE_BYTES + 250_000);
    let form: FormData;
    try { form = await new Response(new Uint8Array(body), { headers: { "Content-Type": contentType } }).formData(); }
    catch { throw new LabError("The production upload could not be read."); }
    const labId = form.get("labId"), file = form.get("file");
    if (!z.string().uuid().safeParse(labId).success || !(file instanceof File)) throw new LabError("Choose a lab and a JPEG or PNG file.");
    if (file.size < 1 || file.size > LAB_ORDER_MAX_FILE_BYTES) throw new LabError("Use a production file up to 4 MB.", 413);
    const lab = await access.service.from("studio_labs").select("id,status,intake_enabled,catalog_verified").eq("id", labId).maybeSingle();
    if (lab.error) labOrderDatabaseError(lab.error);
    if (!lab.data || lab.data.status !== "active" || !lab.data.intake_enabled || !lab.data.catalog_verified) throw new LabError("This lab has not enabled verified production intake. Nothing was uploaded.", 409, "LAB_ORDER_NOT_READY");
    const bytes = Buffer.from(await file.arrayBuffer());
    let width: number, height: number, format: "jpeg" | "png";
    try {
      const image = sharp(bytes, { limitInputPixels: LAB_ORDER_MAX_IMAGE_PIXELS, failOn: "warning" });
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height || metadata.width < 16 || metadata.height < 16 || metadata.width > 30000 || metadata.height > 30000 || (metadata.pages || 1) !== 1 || (metadata.format !== "jpeg" && metadata.format !== "png")) throw Error();
      if (metadata.orientation !== undefined && metadata.orientation !== 1) throw new LabError("Export this photo upright with its orientation applied, then upload it again. The original file was not changed.", 400, "LAB_ORDER_FILE_ORIENTATION");
      // Decode before marking a production file ready; a valid header alone is
      // not proof that the lab will be able to open the entire file.
      await image.stats();
      width = metadata.width; height = metadata.height; format = metadata.format;
    } catch (error) {
      if (error instanceof LabError) throw error;
      throw new LabError("Use a complete, single-image JPEG or PNG with at least 16 pixels per side and no more than 100 megapixels.", 400, "LAB_ORDER_FILE_INVALID");
    }
    const suppliedName = file.name.split(/[\\/]/).at(-1)?.replace(/[\x00-\x1f\x7f]/g, "").trim() || "production";
    const stem = suppliedName.replace(/\.[^.]*$/, "").trim().slice(0, 176) || "production";
    const filename = `${stem}.${format === "jpeg" ? "jpg" : "png"}`;
    const sha256 = createHash("sha256").update(bytes).digest("hex"), id = randomUUID();
    const key = `${access.photographerId}/${labId}/${id}.${format}`;
    const mime = format === "jpeg" ? "image/jpeg" : "image/png";
    const bucket = await access.service.storage.getBucket(LAB_ORDER_BUCKET);
    if (bucket.error || !bucket.data || bucket.data.public !== false) throw new LabError("Private lab file storage is not ready. Nothing was sent.", 503, "LAB_ORDER_STORAGE_UNAVAILABLE");
    const uploaded = await access.service.storage.from(LAB_ORDER_BUCKET).upload(key, bytes, { contentType: mime, upsert: false, cacheControl: "0" });
    if (uploaded.error) throw new LabError("The file upload did not complete. Try again before sending the order.", 503, "LAB_ORDER_STORAGE_UNAVAILABLE");
    const metadata = { id, photographer_id: access.photographerId, lab_id: labId, storage_key: key, filename,
      sha256, width_pixels: width, height_pixels: height, content_type: mime, byte_size: bytes.length, ready: true };
    const stored = await access.service.from("lab_order_assets").insert(metadata).select("*").single();
    let storedRow = stored.data;
    if (stored.error || !stored.data) {
      // A lost database response can follow a committed insert. Deleting its
      // private object would leave an immutable ready asset pointing at no file.
      const reconciled = await access.service.from("lab_order_assets").select("*").eq("id", id).maybeSingle();
      if (!reconciled.error && reconciled.data && Object.entries(metadata).every(([field, value]) => reconciled.data[field] === value)) {
        storedRow = reconciled.data;
      } else {
        // Clean up only after an authoritative service-role read proves that
        // this generated asset ID did not commit. Uncertain blobs stay private.
        if (!reconciled.error && !reconciled.data) await access.service.storage.from(LAB_ORDER_BUCKET).remove([key]).catch(() => undefined);
        labOrderDatabaseError(stored.error || reconciled.error);
      }
    }
    return NextResponse.json({ ok: true, asset: labOrderAssetFromRow(storedRow) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return labOrderFailure(error); }
}
