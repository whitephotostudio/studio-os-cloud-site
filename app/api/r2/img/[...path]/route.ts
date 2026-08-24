import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { r2PresignedGetUrl } from "@/lib/r2-signed-urls";
import { r2Download } from "@/lib/r2";
import { isUuid, normalizeR2Key } from "@/lib/r2-access-security";

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
    const rawStoragePath = (path ?? []).map(decodeURIComponent).join("/");
    if (!rawStoragePath) {
      return NextResponse.json(
        { ok: false, message: "Missing storage path." },
        { status: 400 },
      );
    }

    const storagePath = normalizeR2Key(rawStoragePath);
    if (!storagePath) {
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
    // Keep this compatibility list aligned with the R2 gateway namespaces.
    // Historical rows can use a database school id, local school id, project
    // id, or a nested no-background namespace.
    let authorized = false;
    const segments = storagePath.split("/").filter(Boolean);
    const [firstSegment = "", secondSegment = "", thirdSegment = ""] = segments;

    async function ownsProject(projectId: string) {
      if (!isUuid(projectId)) return false;
      const { data, error } = await service
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .eq("photographer_id", photographerId)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data?.id);
    }

    async function ownsSchool(schoolIdOrLocalId: string) {
      if (!schoolIdOrLocalId) return false;
      if (isUuid(schoolIdOrLocalId)) {
        const { data: byId, error: byIdError } = await service
          .from("schools")
          .select("id")
          .eq("id", schoolIdOrLocalId)
          .eq("photographer_id", photographerId)
          .maybeSingle();
        if (byIdError) throw byIdError;
        if (byId?.id) return true;
      }

      const { data: byLocalId, error: byLocalIdError } = await service
        .from("schools")
        .select("id")
        .eq("local_school_id", schoolIdOrLocalId)
        .eq("photographer_id", photographerId)
        .maybeSingle();
      if (byLocalIdError) throw byLocalIdError;
      return Boolean(byLocalId?.id);
    }

    if (firstSegment === photographerId) {
      authorized = true;
    } else if (
      storagePath.startsWith(`nobg-photos/${photographerId}/`) ||
      storagePath.startsWith(`thumbs/${photographerId}/`)
    ) {
      authorized = true;
    } else if (firstSegment === "backdrops") {
      authorized = secondSegment === photographerId;
    } else if (firstSegment === "projects" || firstSegment === "probes") {
      authorized = await ownsProject(secondSegment);
    } else if (firstSegment === "schools" || firstSegment === "photos") {
      authorized = await ownsSchool(secondSegment);
    } else if (firstSegment === "nobg-photos") {
      if (secondSegment === "projects") {
        authorized = await ownsProject(thirdSegment);
      } else if (secondSegment === "schools") {
        authorized = await ownsSchool(thirdSegment);
      } else {
        authorized = await ownsSchool(secondSegment);
      }
    } else if (firstSegment) {
      authorized = await ownsSchool(firstSegment);
    }

    if (!authorized) {
      console.warn("[r2/img] rejected an unauthorized object path");
      return NextResponse.json(
        { ok: false, message: "Not authorized for this image." },
        { status: 403 },
      );
    }

    // ── On-demand thumbnail: ?w=<px> downloads the object, resizes it with
    //    sharp, and returns the bytes (cached a day). Lets the mobile grids
    //    show a 25-student page without pulling 25 full-size originals.
    //    Falls through to the normal redirect on any failure. ──
    const widthParam = request.nextUrl.searchParams.get("w");
    const thumbWidth = widthParam
      ? Math.max(16, Math.min(1600, Number.parseInt(widthParam, 10) || 0))
      : 0;
    if (thumbWidth > 0) {
      try {
        // Keep Sharp off the critical image-redirect path. If its optional
        // native runtime is unavailable, normal previews must still redirect
        // to the existing R2 object instead of failing while this route loads.
        const { default: sharp } = await import("sharp");
        const original = await r2Download(storagePath);
        const resized = await sharp(original)
          .rotate()
          .resize({ width: thumbWidth, withoutEnlargement: true })
          .jpeg({ quality: 78 })
          .toBuffer();
        return new NextResponse(new Uint8Array(resized), {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "private, max-age=86400",
          },
        });
      } catch (resizeError) {
        console.error("[r2/img] thumbnail resize failed", resizeError);
        // fall through to the normal redirect below
      }
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
