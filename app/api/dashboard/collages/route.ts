import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { CollageAccessError, COLLAGE_UUID, collageArtworkKey, collageContentHash, collageDashboardAccess, collageVersionFields, storedCollageVersion, readCollageJson, type CollageVersionRow } from "@/lib/collage-server";
import { parseCollageTemplate, MAX_TEMPLATE_BYTES } from "@/lib/collage-template";
import { writeProduction, readProduction, digest } from "@/lib/order-automation-storage";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function failure(error: unknown) {
  if (!(error instanceof CollageAccessError)) console.error("[collage:owner]", error);
  return NextResponse.json({ ok: false, message: error instanceof CollageAccessError ? error.message : "Collage storage is unavailable. Keep your exported template and retry after the preview migration is reviewed." }, { status: error instanceof CollageAccessError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
}
export async function GET(request: NextRequest) {
  try {
    const { service, photographerId } = await collageDashboardAccess(request);
    const result = await service.from("collage_template_versions").select(collageVersionFields).eq("photographer_id", photographerId).order("created_at", { ascending: false }).limit(500);
    if (result.error) throw result.error;
    return NextResponse.json({ ok: true, preview: true, versions: (result.data as CollageVersionRow[]).map(storedCollageVersion) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const { service, photographerId, user } = await collageDashboardAccess(request, true);
    const limit = await rateLimit(user.id, { namespace: "collage-save", limit: 60, windowSeconds: 3600 });
    if (!limit.allowed) throw new CollageAccessError("Please wait before saving more collage versions.", 429);
    const body = await readCollageJson(request, MAX_TEMPLATE_BYTES + 65536);
    let design;
    try { design = parseCollageTemplate(body.design); } catch (error) { throw new CollageAccessError(error instanceof Error ? error.message : "Invalid collage design."); }
    const templateId = body.templateId ?? randomUUID();
    if (typeof templateId !== "string" || !COLLAGE_UUID.test(templateId)) throw new CollageAccessError("Invalid collage template.");
    // Verify an existing identity before accepting or uploading any artwork.
    const existing = await service.from("collage_templates").select("photographer_id").eq("id", templateId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data && existing.data.photographer_id !== photographerId) throw new CollageAccessError("This collage belongs to another studio.", 403);
    const galleries = (value: unknown) => {
      if (value === undefined) return [] as string[];
      if (!Array.isArray(value) || value.length > 100 || value.some(id => typeof id !== "string" || !COLLAGE_UUID.test(id))) throw new CollageAccessError("Choose valid galleries for this collage.");
      return [...new Set(value)] as string[];
    };
    const schoolIds = galleries(body.schoolIds), projectIds = galleries(body.projectIds);
    if (body.publish !== undefined && typeof body.publish !== "boolean") throw new CollageAccessError("Choose a valid publication state.");
    // Reject foreign assignments before uploading bytes, then check ownership
    // again inside the atomic save to protect concurrent resource changes.
    const ownedGalleries = await Promise.all([
      schoolIds.length ? service.from("schools").select("id").eq("photographer_id", photographerId).in("id", schoolIds) : Promise.resolve({ data: [], error: null }),
      projectIds.length ? service.from("projects").select("id").eq("photographer_id", photographerId).in("id", projectIds) : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of ownedGalleries) if (result.error) throw result.error;
    if (ownedGalleries[0].data?.length !== schoolIds.length || ownedGalleries[1].data?.length !== projectIds.length) throw new CollageAccessError("A selected gallery belongs to another studio.", 403);
    let artworkKey: string | null = null;
    if (design.overlay) {
      const encoded = design.overlay.split(",")[1];
      const input = Buffer.from(encoded, "base64");
      if (input.length > 9 * 1024 * 1024 || input.toString("base64") !== encoded) throw new CollageAccessError("Use PNG/JPEG artwork smaller than 9 MB.");
      const image = sharp(input, { limitInputPixels: 40_000_000 });
      const metadata = await image.metadata();
      if (!["png", "jpeg"].includes(metadata.format || "")) throw new CollageAccessError("Use clean PNG or JPEG design artwork.");
      const bytes = await image.rotate().png().toBuffer();
      if (bytes.length > MAX_TEMPLATE_BYTES) throw new CollageAccessError("The decoded artwork is too large.");
      artworkKey = collageArtworkKey(photographerId, createHash("sha256").update(bytes).digest("hex"));
      try { await writeProduction(artworkKey, bytes, "image/png", { create: true }); }
      catch (error) {
        const previous = await readProduction(artworkKey, MAX_TEMPLATE_BYTES).catch(() => null);
        if (!previous || digest(previous.bytes) !== digest(bytes)) throw error;
      }
    }
    design = { ...design, overlay: null };
    const result = await service.rpc("save_collage_template_version", { p_template_id: templateId, p_photographer_id: photographerId, p_name: design.name,
      p_design: design, p_artwork_key: artworkKey, p_content_hash: collageContentHash(design, artworkKey), p_published: body.publish === true, p_school_ids: schoolIds, p_project_ids: projectIds });
    if (result.error?.code === "42501") throw new CollageAccessError("A selected gallery or template belongs to another studio.", 403);
    if (result.error) throw result.error;
    const savedRow = Array.isArray(result.data) && result.data.length === 1 ? result.data[0] : result.data;
    const version = storedCollageVersion(savedRow as CollageVersionRow);
    return NextResponse.json({ ok: true, preview: true, version }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
