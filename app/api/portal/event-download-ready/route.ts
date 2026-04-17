import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { validateEventGalleryAccess } from "@/lib/event-gallery-access";
import {
  buildArchiveBaseName,
  galleryZipBatchSize,
  splitIntoBatches,
  type EventGalleryDownloadManifest,
} from "@/lib/event-gallery-downloads";
import { createEventGalleryBatchToken } from "@/lib/event-gallery-download-tokens";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DOWNLOAD_TOKEN_TTL_MS = 45 * 60 * 1000;

type DownloadLogRow = {
  download_count: number | null;
};

type MediaAccessRow = {
  id: string;
  collection_id: string | null;
};

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

function isMissingDownloadsTable(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
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

    const access = await validateEventGalleryAccess({
      projectId: body.projectId ?? "",
      email: body.email ?? "",
      pin: body.pin ?? "",
    });

    if (!access.ok) {
      return NextResponse.json(
        { ok: false, message: access.message },
        { status: access.status },
      );
    }

    const requestedMediaIds = uniqueMediaIds(body.mediaIds ?? []);
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

    const collectionId = clean(body.collectionId);
    if (settings.extras.freeDigitalAudience === "album" && !collectionId) {
      return NextResponse.json(
        { ok: false, message: "Open the album you want to download first." },
        { status: 400 },
      );
    }

    const { data: downloadRows, error: downloadError } = await access.service
      .from("event_gallery_downloads")
      .select("download_count")
      .eq("project_id", access.projectId)
      .eq("viewer_email", access.email)
      .eq("download_type", "gallery");

    if (downloadError && !isMissingDownloadsTable(downloadError)) {
      throw downloadError;
    }

    const downloadsUsed = ((downloadRows ?? []) as DownloadLogRow[]).reduce(
      (sum, row) => sum + Math.max(0, Number(row.download_count ?? 0)),
      0,
    );
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
        ? requestedMediaIds
        : requestedMediaIds.slice(0, downloadsRemaining);

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

    const { data: mediaRows, error: mediaError } = await access.service
      .from("media")
      .select("id,collection_id")
      .eq("project_id", access.projectId)
      .in("id", allowedMediaIds);

    if (mediaError) throw mediaError;

    const mediaMap = new Map<string, MediaAccessRow>();
    for (const row of (mediaRows ?? []) as MediaAccessRow[]) {
      if (settings.extras.freeDigitalAudience === "album" && row.collection_id !== collectionId) {
        continue;
      }
      mediaMap.set(row.id, row);
    }

    const confirmedMediaIds = allowedMediaIds.filter((mediaId) => mediaMap.has(mediaId));
    if (!confirmedMediaIds.length) {
      return NextResponse.json(
        { ok: false, message: "No gallery photos are available for that download." },
        { status: 403 },
      );
    }

    const { error: insertError } = await access.service
      .from("event_gallery_downloads")
      .insert({
        project_id: access.projectId,
        collection_id: collectionId || null,
        viewer_email: access.email,
        download_type: "gallery",
        download_count: confirmedMediaIds.length,
        media_ids: confirmedMediaIds,
      });

    if (insertError && !isMissingDownloadsTable(insertError)) {
      throw insertError;
    }

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
        watermarkLogoUrl = looksLikeImageAssetUrl(photographerRow.watermark_logo_url)
          ? clean(photographerRow.watermark_logo_url)
          : looksLikeImageAssetUrl(photographerRow.logo_url)
            ? clean(photographerRow.logo_url)
            : "";
      }
    }

    const galleryName = clean(access.project.title) || "Event Gallery";
    const archiveBaseName = buildArchiveBaseName(galleryName, "event-gallery");
    const applyWatermark = settings.extras.watermarkDownloads;
    const batchSize = galleryZipBatchSize(
      settings.extras.freeDigitalResolution,
      applyWatermark,
    );
    const expiresAt = new Date(Date.now() + DOWNLOAD_TOKEN_TTL_MS).toISOString();
    const splitMediaIds = splitIntoBatches(confirmedMediaIds, batchSize);
    const watermarkText = studioName || galleryName || "PROOF";

    const batches = splitMediaIds.map((mediaIds, index) => {
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
        exp: Date.parse(expiresAt),
      });

      return {
        id: randomUUID(),
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
      requestedPhotoCount: requestedMediaIds.length,
      photoCount: confirmedMediaIds.length,
      batchCount: batches.length,
      createdAt: new Date().toISOString(),
      expiresAt,
      downloadsUsed: downloadsUsed + confirmedMediaIds.length,
      downloadsRemaining:
        downloadsRemaining === null
          ? null
          : Math.max(0, downloadsRemaining - confirmedMediaIds.length),
      batches,
    };

    return NextResponse.json({
      ok: true,
      manifest,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to prepare gallery downloads.",
      },
      { status: 500 },
    );
  }
}
