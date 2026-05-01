import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { r2PresignedGetUrl } from "@/lib/r2-signed-urls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 2026-04-30 — R2 image redirect endpoint.
//
// Purpose: client-rendered photographer dashboard pages (school class
// detail, school role detail) query Supabase directly from the browser
// and need image URLs derived from `storage_path`.  They cannot call
// the server-only signed-URL helper because it would leak the R2
// secret into the client bundle.
//
// This endpoint sits in front of every gallery image:
//   GET /api/r2/img/<storage_path>
//
// Flow:
//   1. Verify the request has a valid photographer auth cookie.
//   2. Verify the photographer is allowed to view this path (either
//      it lives under their own photographer_id, or it lives under
//      one of their cloud projects).
//   3. Generate a short-lived signed R2 GET URL.
//   4. Return a 302 redirect.  The browser then fetches the image
//      directly from R2.  Cache-Control allows the browser to skip
//      the redirect roundtrip for ~5 minutes.
//
// Server-side renders (parents portal, dashboard album/event pages)
// continue to use the in-process signed URL helper directly — they
// don't need to go through this proxy.

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await context.params;
    const storagePath = (path ?? []).map(decodeURIComponent).join("/");
    if (!storagePath) {
      return NextResponse.json(
        { ok: false, message: "Missing storage path." },
        { status: 400 },
      );
    }

    // Reject path traversal attempts before doing any work.
    if (storagePath.includes("..") || storagePath.startsWith("/")) {
      return NextResponse.json(
        { ok: false, message: "Invalid storage path." },
        { status: 400 },
      );
    }

    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const service = createDashboardServiceClient();

    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    const photographerId = clean(photographerRow.id);

    // ── Authorization: confirm the photographer is allowed to view this path ──
    //
    // Allowed shapes:
    //   1. <photographerId>/...                       — school-mode photos
    //   2. nobg-photos/<photographerId>/...           — background-removed PNGs
    //   3. projects/<projectId>/...  where the project belongs to this photographer
    //   4. thumbs/<photographerId>/...                — old thumbnails bucket
    let authorized = false;

    const firstSegment = storagePath.split("/")[0] ?? "";
    if (firstSegment === photographerId) {
      authorized = true;
    } else if (
      storagePath.startsWith(`nobg-photos/${photographerId}/`) ||
      storagePath.startsWith(`thumbs/${photographerId}/`)
    ) {
      authorized = true;
    } else if (storagePath.startsWith("projects/")) {
      // projects/<projectId>/...  — verify the project belongs to this photographer
      const projectId = storagePath.split("/")[1] ?? "";
      if (projectId) {
        const { data: projectRow, error: projectError } = await service
          .from("projects")
          .select("id")
          .eq("id", projectId)
          .eq("photographer_id", photographerId)
          .maybeSingle();
        if (projectError) throw projectError;
        if (projectRow) authorized = true;
      }
    }

    if (!authorized) {
      console.warn(
        "[r2/img] photographer %s tried to access unauthorized path: %s",
        photographerId,
        storagePath,
      );
      return NextResponse.json(
        { ok: false, message: "Not authorized for this image." },
        { status: 403 },
      );
    }

    // ── Generate a short-lived signed URL (5 min — browser cache will
    //    hide the redirect on subsequent requests) and 302 to it. ──
    const signedUrl = r2PresignedGetUrl(storagePath, 60 * 5);
    if (!signedUrl) {
      return NextResponse.json(
        { ok: false, message: "R2 not configured." },
        { status: 500 },
      );
    }

    const response = NextResponse.redirect(signedUrl, { status: 302 });
    // Tell the browser it can reuse the redirect for ~5 minutes.
    // Setting `private` ensures shared caches (e.g., Vercel edge) do
    // not cache the redirect, since the signed URL is per-request.
    response.headers.set("Cache-Control", "private, max-age=300");
    return response;
  } catch (error) {
    console.error("[r2/img]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to resolve image URL." },
      { status: 500 },
    );
  }
}
