import { NextRequest, NextResponse } from "next/server";
import { MAX_PARENT_GALLERY_ENTRY_TOKEN_LENGTH, readParentGalleryEntryToken } from "@/lib/parent-gallery-entry";
import { bootstrapParentGallerySession } from "@/lib/parent-gallery-session";
import { pinRecoveryOrigin } from "@/lib/pin-recovery";

export const dynamic = "force-dynamic";
function redirect(target: URL) {
  const response = NextResponse.redirect(target);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function GET(request: NextRequest) {
  const origin = pinRecoveryOrigin();
  const fallback = () => redirect(new URL("/parents?entry=unavailable", origin));
  const tokens = request.nextUrl.searchParams.getAll("token");
  if (tokens.length !== 1 || !tokens[0] || tokens[0].length > MAX_PARENT_GALLERY_ENTRY_TOKEN_LENGTH ||
    Array.from(request.nextUrl.searchParams.keys()).some(key => key !== "token")) return fallback();
  try {
    const entry = readParentGalleryEntryToken(tokens[0]);
    // A host-only session must be minted on the configured gallery origin.
    // This hop carries only opaque ciphertext and performs no DB/cookie work.
    if (request.nextUrl.origin !== origin) {
      const canonical = new URL("/api/portal/session/entry", origin);
      canonical.searchParams.set("token", tokens[0]);
      return redirect(canonical);
    }
    const session = await bootstrapParentGallerySession(request, entry, { expectedPhotographerId: entry.photographerId });
    const target = new URL(session.grant.galleryUrl, origin);
    if (entry.tab) target.searchParams.set("tab", entry.tab);
    return await session.applyCookie(redirect(target));
  } catch { return fallback(); }
}
