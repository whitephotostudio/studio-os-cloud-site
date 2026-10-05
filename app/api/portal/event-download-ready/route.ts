import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { validateEventGalleryAccess } from "@/lib/event-gallery-access";
import {
  buildArchiveBaseName,
  galleryZipBatchSize,
  splitIntoBatches,
  type EventGalleryDownloadManifest,
} from "@/lib/event-gallery-downloads";
import { createEventGalleryBatchToken, createEventCollectionDownloadGrant, createEventProjectDownloadGrant, createEventDownloadPolicyGrant } from "@/lib/event-gallery-download-tokens";
import { authorizedEventMediaIds, eventGalleryDownloadsUsed, resolveEventDownloadScope } from "@/lib/event-download-scope";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { validateUuid, validateUuidArray } from "@/lib/request-validation";
import { signedPrivateMediaReference } from "@/lib/private-media-references";
import { SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS } from "@/lib/storage-images";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DOWNLOAD_TOKEN_TTL_MS = 45 * 60 * 1000;
type PhotographerRow = {
  id: string;
  business_name: string | null;
  studio_email: string | null;
  watermark_logo_url: string | null;
  logo_url: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function looksLikeImageAssetUrl(value: string | null | undefined) {
  const candidate = clean(value);
  if (!candidate) return false;
  return (
    /^https?:\/\//i.test(candidate) &&
    (
      /(png|jpe?g|webp|gif|svg|avif)(\?|#|$)/i.test(candidate) ||
      candidate.includes("/storage/v1/object/") ||
      candidate.includes("/studio-logos/")
    )
  );
}

function uniqueMediaIds(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const nextValue = clean(value);
    if (!nextValue || seen.has(nextValue)) continue;
    seen.add(nextValue);
    out.push(nextValue);
  }
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      projectId?: string;
      email?: string;
      pin?: string;
      downloadPin?: string;
      collectionId?: string | null;
      mediaIds?: string[];
    };

    const validatedProjectId = validateUuid(body.projectId, "projectId");
    if (!validatedProjectId.ok) {
      return NextResponse.json(
        { ok: false, message: validatedProjectId.message },
        { status: 400 },
      );
    }

    const access = await validateEventGalleryAccess({
      projectId: validatedProjectId.value,
      email: body.email ?? "",
      pin: body.pin ?? "",
    });

    if (!access.ok) {
      return NextResponse.json(
        { ok: false, message: access.message },
        { status: access.status },
      );
    }

    // Validate shape + cap before dedup: ensures `mediaIds` is an array of
    // UUIDs no bigger than 5000 entries (which is also the safety cap the
    // gallery context query uses).
    const validatedMediaIds = validateUuidArray(body.mediaIds, "mediaIds", {
      min: 1,
      max: 5000,
    });
    if (!validatedMediaIds.ok) {
      return NextResponse.json(
        { ok: false, message: validatedMediaIds.message },
        { status: 400 },
      );
    }
    const requestedMediaIds = uniqueMediaIds(validatedMediaIds.value);
    if (!requestedMediaIds.length) {
      return NextResponse.json(
        { ok: false, message: "No photos were selected for download." },
        { status: 400 },
      );
    }

    const settings = normalizeEventGallerySettings(access.project.gallery_settings);
    if (!settings.extras.freeDigitalRuleEnabled || !settings.extras.showDownloadAllButton) {
      return NextResponse.json(
        { ok: false, message: "Gallery downloads are turned off for this event." },
        { status: 403 },
      );
    }

    const providedDownloadPin = clean(body.downloadPin);
    const expectedDownloadPin = clean(settings.extras.downloadPin);
    if (settings.extras.downloadPinEnabled) {
      if (!expectedDownloadPin) {
        return NextResponse.json(
          {
            ok: false,
            message: 'A "Download All" PIN has not been configured for this gallery yet.',
          },
          { status: 403 },
        );
      }

      if (providedDownloadPin !== expectedDownloadPin) {
        return NextResponse.json(
          { ok: false, message: "The download PIN is incorrect." },
          { status: 403 },
        );
      }
    }

    if (settings.extras.freeDigitalAudience === "person") {
      const targetEmail = clean(settings.extras.freeDigitalTargetEmail).toLowerCase();
      if (!targetEmail) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Choose the approved person email in Gallery Settings to enable this rule.",
          },
          { status: 403 },
        );
      }

      if (targetEmail !== access.email) {
        return NextResponse.json(
          {
            ok: false,
            message: "Free downloads are reserved for a specific invited person.",
          },
          { status: 403 },
        );
      }
    }

    const scope = await resolveEventDownloadScope({
      service: access.service, projectId: access.projectId,
      collectionIds: access.collectionIds, pin: body.pin ?? "", collectionId: body.collectionId,
    });
    if (!scope.ok) {
      return NextResponse.json({ ok: false, message: scope.message }, { status: scope.status });
    }
    const collectionId = scope.collectionId;
    if (settings.extras.freeDigitalAudience === "album" && !collectionId) {
      return NextResponse.json(
        { ok: false, message: "Open the album you want to download first." },
        { status: 400 },
      );
    }

    const eligibleMediaIds = await authorizedEventMediaIds(
      access.service, access.projectId, requestedMediaIds, scope.collectionIds,
    );
    if (!eligibleMediaIds.length) {
      return NextResponse.json(
        { ok: false, message: "No gallery photos are available for that download." },
        { status: 403 },
      );
    }
    const downloadsUsed = await eventGalleryDownloadsUsed(access.service, access.projectId, access.email);
    const numericLimit =
      settings.extras.freeDigitalDownloadLimit === "unlimited"
        ? null
        : Math.max(0, Number.parseInt(settings.extras.freeDigitalDownloadLimit, 10) || 0);
    const downloadsRemaining =
      numericLimit === null ? null : Math.max(0, numericLimit - downloadsUsed);

    if (downloadsRemaining !== null && downloadsRemaining <= 0) {
      return NextResponse.json(
        {
          ok: false,
          message: "This gallery's free download limit has been reached.",
          downloadsUsed,
          downloadsRemaining: 0,
        },
        { status: 403 },
      );
    }

    const allowedMediaIds =
      downloadsRemaining === null
        ? eligibleMediaIds
        : eligibleMediaIds.slice(0, downloadsRemaining);

    if (!allowedMediaIds.length) {
      return NextResponse.json(
        {
          ok: false,
          message: "There are no free downloads remaining for this gallery.",
          downloadsUsed,
          downloadsRemaining,
        },
        { status: 403 },
      );
    }

    const confirmedMediaIds = allowedMediaIds;

    let studioName = "";
    let studioEmail = "";
    let watermarkLogoUrl = "";
    if (access.project.photographer_id) {
      const { data: photographerRow, error: photographerError } = await access.service
        .from("photographers")
        .select("id,business_name,studio_email,watermark_logo_url,logo_url")
        .eq("id", access.project.photographer_id)
        .maybeSingle<PhotographerRow>();

      if (photographerError) throw photographerError;

      if (photographerRow) {
        studioName = clean(photographerRow.business_name);
        studioEmail = clean(photographerRow.studio_email);
        const watermarkLogoCandidate = signedPrivateMediaReference(
          photographerRow.watermark_logo_url,
          SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
        );
        const studioLogoCandidate = signedPrivateMediaReference(
          photographerRow.logo_url,
          SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS,
        );
        watermarkLogoUrl = looksLikeImageAssetUrl(watermarkLogoCandidate)
          ? watermarkLogoCandidate
          : looksLikeImageAssetUrl(studioLogoCandidate)
            ? studioLogoCandidate
            : "";
      }
    }

    const galleryName = clean(access.project.title) || "Event Gallery";
    const archiveBaseName = buildArchiveBaseName(
      scope.collectionName ? `${galleryName} - ${scope.collectionName}` : galleryName, "event-gallery",
    );
    const collectionGrants = Object.fromEntries(scope.collections.map(row => [
      row.id, createEventCollectionDownloadGrant(access.projectId, row),
    ]));
    const applyWatermark = settings.extras.watermarkDownloads;
    const batchSize = galleryZipBatchSize(
      settings.extras.freeDigitalResolution,
      applyWatermark,
    );
    const expiresAt = new Date(Date.now() + DOWNLOAD_TOKEN_TTL_MS).toISOString();
    const splitMediaIds = splitIntoBatches(confirmedMediaIds, batchSize);
    const watermarkText = studioName || galleryName || "PROOF";

    const batches = splitMediaIds.map((mediaIds, index) => {
      const downloadLogId = randomUUID();
      const label = `File ${index + 1} of ${splitMediaIds.length}`;
      const fileName =
        splitMediaIds.length === 1
          ? `${archiveBaseName}.zip`
          : `${archiveBaseName} part ${index + 1} of ${splitMediaIds.length}.zip`;
      const token = createEventGalleryBatchToken({
        v: 1,
        kind: "event-gallery-download-batch",
        projectId: access.projectId,
        viewerEmail: access.email,
        galleryName,
        archiveBaseName,
        resolution: settings.extras.freeDigitalResolution,
        applyWatermark,
        includePrintRelease: settings.extras.includePrintRelease && index === 0,
        watermarkText,
        watermarkLogoUrl,
        studioName,
        studioEmail,
        fileName,
        mediaIds,
        downloadLogId,
        collectionId: collectionId || null,
        collectionIds: scope.collectionIds,
        collectionGrants,
        photographerId: access.project.photographer_id,
        projectAccessGrant: createEventProjectDownloadGrant(access.project),
        downloadPolicyGrant: createEventDownloadPolicyGrant(access.project.gallery_settings),
        deliveryType: "gallery",
        exp: Date.parse(expiresAt),
      });

      return {
        id: downloadLogId,
        label,
        fileName,
        photoCount: mediaIds.length,
        token,
      };
    });

    const manifest: EventGalleryDownloadManifest = {
      id: randomUUID(),
      galleryName,
      archiveBaseName,
      collectionId,
      collectionName: scope.collectionName,
      requestedPhotoCount: eligibleMediaIds.length,
      photoCount: confirmedMediaIds.length,
      batchCount: batches.length,
      createdAt: new Date().toISOString(),
      expiresAt,
      // Preparing signed ZIP links is not a completed download. The batch
      // endpoint records the exact successfully streamed media IDs, so a
      // failed preparation never consumes quota or inflates activity reports.
      downloadsUsed,
      downloadsRemaining,
      batches,
    };

    return NextResponse.json({
      ok: true,
      manifest,
    });
  } catch (error) {
    console.error("[event-download-ready]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to prepare gallery downloads." },
      { status: 500 },
    );
  }
}
