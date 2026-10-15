import { NextRequest, NextResponse } from "next/server";
import { CollageAccessError, collageDashboardAccess, readCollageJson } from "@/lib/collage-server";
import { MAX_TEMPLATE_BYTES } from "@/lib/collage-template";
import { commerceCatalogue, commerceHash, commercePublicationResponse, loadCommerceState, parseCommerceRequest, prepareCommerceArtwork, validateCommercePublication } from "@/lib/collage-commerce";
import { rateLimit } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function failure(error: unknown) {
  return NextResponse.json({ ok: false, message: error instanceof CollageAccessError ? error.message : "Collage commerce is temporarily unavailable. Keep the pending publication and retry after the reviewed migrations are available." }, { status: error instanceof CollageAccessError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
}
export async function GET(request: NextRequest) {
  try {
    const { service, photographerId } = await collageDashboardAccess(request);
    return NextResponse.json({ ok: true, preview: true, ...commerceCatalogue(await loadCommerceState(service, photographerId)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const { service, photographerId, user } = await collageDashboardAccess(request, true);
    const budget = await rateLimit(user.id, { namespace: "collage-commerce", limit: 60, windowSeconds: 3600 });
    if (!budget.allowed) throw new CollageAccessError("Please wait before publishing more collage products.", 429);
    const input = parseCommerceRequest(await readCollageJson(request, MAX_TEMPLATE_BYTES + 65536)), payloadHash = commerceHash(input);
    // A lost-response retry must replay before its own successful transaction
    // makes the previous catalogue revision stale.
    const replay = async () => {
      const attempt = await service.from("collage_commerce_attempts").select("payload_hash,response").eq("photographer_id", photographerId).eq("request_id", input.requestId).maybeSingle();
      if (attempt.error) throw attempt.error;
      if (!attempt.data) return null;
      if (attempt.data.payload_hash !== payloadHash) throw new CollageAccessError("This publication request ID was already used for different contents. Refresh before starting a new publication.", 409);
      return NextResponse.json({ ...commercePublicationResponse(attempt.data.response, String(attempt.data.response.currency), input.requestId), replayed: true }, { headers: { "Cache-Control": "private, no-store" } });
    };
    const previous = await replay(); if (previous) return previous;
    const state = await loadCommerceState(service, photographerId), catalogue = commerceCatalogue(state);
    try { validateCommercePublication(state, input); }
    catch (error) {
      // An identical request may have committed between the first receipt read
      // and catalogue loading. Return its durable success rather than a false
      // stale-catalogue failure caused by that very publication.
      if (error instanceof CollageAccessError && error.status === 409) { const concurrent = await replay(); if (concurrent) return concurrent; }
      throw error;
    }
    if (input.templateId) {
      const template = await service.from("collage_templates").select("photographer_id").eq("id", input.templateId).maybeSingle();
      if (template.error) throw template.error;
      if (template.data && template.data.photographer_id !== photographerId) throw new CollageAccessError("This template belongs to another studio.", 403);
    }
    const artwork = await prepareCommerceArtwork(input.design, photographerId);
    const result = await service.rpc("publish_collage_commerce", { p_photographer_id: photographerId, p_request_id: input.requestId, p_payload_hash: payloadHash,
      p_expected_state: state, p_template_id: input.templateId, p_design: artwork.design, p_artwork_key: artwork.artworkKey, p_content_hash: artwork.contentHash,
      p_galleries: input.galleries, p_product: input.product, p_currency: catalogue.currency });
    if (result.error?.code === "40001") { const concurrent = await replay(); if (concurrent) return concurrent; throw new CollageAccessError("The catalogue changed during publication. Refresh and review the current prices and package contents.", 409); }
    if (result.error?.code === "42501") throw new CollageAccessError("A selected template, gallery or price sheet is not owned by this studio.", 403);
    if (result.error?.code === "22023" || result.error?.code === "23514") throw new CollageAccessError("The product or gallery configuration is invalid. Refresh before publishing.", 409);
    if (result.error?.code === "23505") throw new CollageAccessError("This publication request conflicts with an existing product. Refresh before publishing.", 409);
    if (result.error) throw result.error;
    return NextResponse.json(commercePublicationResponse(result.data, catalogue.currency, input.requestId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
