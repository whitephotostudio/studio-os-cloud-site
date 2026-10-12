import { NextRequest, NextResponse } from "next/server";
import { bootstrapParentGallerySession, ParentGallerySessionError, resolveParentGallerySession } from "@/lib/parent-gallery-session";
import type { ParentGalleryCredentials } from "@/lib/parent-gallery-session-access";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store", "Referrer-Policy": "no-referrer" };

function failure(error: unknown) {
  return NextResponse.json({ ok: false, message: error instanceof ParentGallerySessionError ? error.message : "Gallery access is temporarily unavailable. Please try again shortly." },
    { status: error instanceof ParentGallerySessionError ? error.status : 503,
      headers: { ...headers, ...(error instanceof ParentGallerySessionError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
}

async function bootstrapBody(request: Request): Promise<ParentGalleryCredentials> {
  const invalid = () => new ParentGallerySessionError(400, "invalid_request", "Invalid gallery access request.");
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw invalid(); }
      chunks.push(value);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      Object.keys(parsed).some(key => !["kind", "galleryId", "pin", "email"].includes(key)) ||
      ["kind", "galleryId", "pin", "email"].some(key => typeof parsed[key] !== "string")) throw invalid();
    return parsed;
  } catch (error) {
    if (error instanceof ParentGallerySessionError) throw error;
    throw invalid();
  } finally { reader.releaseLock(); }
}

export async function POST(request: NextRequest) {
  try {
    const session = await bootstrapParentGallerySession(request, await bootstrapBody(request));
    return await session.applyCookie(NextResponse.json(session.grant, { headers }));
  } catch (error) { return failure(error); }
}

export async function GET(request: NextRequest) {
  try {
    const query = new URL(request.url).searchParams;
    if (query.getAll("parentLaneId").length !== 1) {
      throw new ParentGallerySessionError(400, "invalid_request", "Invalid gallery access request.");
    }
    const session = await resolveParentGallerySession(request, query.get("parentLaneId")!);
    return NextResponse.json({ ok: true, laneId: session.laneId, kind: session.kind, galleryId: session.galleryId,
      photographerId: session.photographerId, viewerEmail: session.email, expiresAt: session.expiresAt,
      galleryUrl: `/parents/view/${session.laneId}` }, { headers });
  } catch (error) { return failure(error); }
}
