import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { r2PresignedGetUrl } from "@/lib/r2-signed-urls";
import { r2Download } from "@/lib/r2";
import { isServerOnlyR2Key, normalizeR2Key } from "@/lib/r2-access-security";
import { verifyR2MediaToken } from "@/lib/r2-media-token";
import { resolveR2MediaOwnership } from "@/lib/r2-media-ownership";
import { CreditCutoutAccessError, isManagedCutoutKey, readPaidCutout, signVerifiedCutout } from "@/lib/credit-cutout-access";
import {
  loadSchoolPhotoTombstones,
  schoolPhotoFamilyForKey,
  tombstoneFamilySet,
} from "@/lib/school-photo-deletions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Browser reads use dashboard MFA or an exact, expiring workflow capability.
// Both paths resolve retained namespace ownership before issuing an R2 URL.

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

async function loadTombstonedFamilies(
  service: ReturnType<typeof createDashboardServiceClient>,
  schoolId: string,
) {
  return tombstoneFamilySet(
    await loadSchoolPhotoTombstones(service, schoolId),
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await context.params;
    const rawStoragePath = (path ?? []).join("/");
    if (!rawStoragePath) {
      return NextResponse.json(
        { ok: false, message: "Missing storage path." },
        { status: 400 },
      );
    }

    const storagePath = normalizeR2Key(rawStoragePath, {
      allowQueryCharacters: true,
    });
    if (!storagePath) {
      return NextResponse.json(
        { ok: false, message: "Invalid storage path." },
        { status: 400 },
      );
    }
    if (isServerOnlyR2Key(storagePath)) {
      return NextResponse.json({ ok: false, message: "Not authorized for this image." }, { status: 403 });
    }

    const mediaToken = request.nextUrl.searchParams.get("mediaToken");
    const grantedOwner = mediaToken ? verifyR2MediaToken(mediaToken, storagePath) : null;
    if (mediaToken && !grantedOwner) return NextResponse.json({ ok: false, message: "Photo access expired or changed." }, { status: 403 });
    let userId: string | null = null;
    if (!grantedOwner) {
      const auth = await resolveDashboardAuth(request);
      if (auth.mfaSatisfied === false) return NextResponse.json({ ok: false, message: "Complete two-step verification before viewing photos." }, { status: 403 });
      if (!auth.user) return NextResponse.json({ ok: false, message: "Please sign in again." }, { status: 401 });
      userId = auth.user.id;
    }

    const service = createDashboardServiceClient();

    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq(grantedOwner ? "id" : "user_id", grantedOwner || userId)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    const photographerId = clean(photographerRow.id);
    const ownership = await resolveR2MediaOwnership(service, storagePath, photographerId);
    if (!ownership.owned) {
      return NextResponse.json({ ok: false, message: "Not authorized for this image." }, { status: 403 });
    }
    const authorizedSchoolId = ownership.schoolId;

    // A soft-removed school photo must stay unavailable even through an old
    // cached proxy URL. Match the whole logical family so preview/thumbnail
    // and no-background variants cannot bypass the tombstone.
    const storageFamily = schoolPhotoFamilyForKey(storagePath);
    if (storageFamily && authorizedSchoolId) {
      const deletedFamilies = await loadTombstonedFamilies(
        service,
        authorizedSchoolId,
      );
      if (deletedFamilies.has(storageFamily)) {
        return NextResponse.json(
          { ok: false, message: "This photo was removed from the gallery." },
          {
            status: 410,
            headers: { "Cache-Control": "private, no-store, max-age=0" },
          },
        );
      }
    }

    let verifiedCutout: Buffer | null = null;
    if (isManagedCutoutKey(storagePath)) {
      try { verifiedCutout = await readPaidCutout(service, photographerId, storagePath); }
      catch (error) {
        if (error instanceof CreditCutoutAccessError) return NextResponse.json({ ok: false, message: error.message }, { status: 403 });
        throw error;
      }
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
        const original = verifiedCutout ?? await r2Download(storagePath);
        const resized = await sharp(original)
          .rotate()
          .resize({ width: thumbWidth, withoutEnlargement: true })
          .jpeg({ quality: 78 })
          .toBuffer();
        return new NextResponse(new Uint8Array(resized), {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": grantedOwner || verifiedCutout ? "private, no-store" : "private, max-age=86400",
          },
        });
      } catch (resizeError) {
        console.error("[r2/img] thumbnail resize failed", resizeError);
        // fall through to the normal redirect below
      }
    }

    // ── Generate a short-lived signed URL (5 min — browser cache will
    //    hide the redirect on subsequent requests) and 302 to it. ──
    const signedUrl = verifiedCutout ? signVerifiedCutout(storagePath) : r2PresignedGetUrl(storagePath, 60 * 5);
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
    response.headers.set("Cache-Control", grantedOwner || verifiedCutout ? "private, no-store" : "private, max-age=300");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    console.error("[r2/img]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to resolve image URL." },
      { status: 500 },
    );
  }
}
