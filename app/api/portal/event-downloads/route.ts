import { NextRequest, NextResponse } from "next/server";
import { reserveGalleryDownload } from "@/lib/gallery-download-quota";
import { validateEventGalleryAccess } from "@/lib/event-gallery-access";
import { authorizedEventMediaIds, eventGalleryDownloadsUsed, resolveEventDownloadScope } from "@/lib/event-download-scope";
import { buildEventFileDeliveries, hasEventAllDigitalsPurchase, eventRequestedCollectionIds } from "@/lib/event-media-delivery";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { validateUuid, validateUuidArray } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

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

export async function POST(request: NextRequest) {
  try {
    // Cap per-IP download prep rate. Each call validates access, reads orders,
    // reads packages, reads download logs, and writes a download row — an
    // expensive path. 20/min is well above any plausible human interaction.
    const limitResult = await rateLimit(getClientIp(request), {
      namespace: "event-downloads",
      limit: 20,
      windowSeconds: 60,
    });
    if (!limitResult.allowed) {
      return NextResponse.json(
        { ok: false, message: "Too many download requests. Please slow down." },
        {
          status: 429,
          headers: {
            "Retry-After": Math.max(
              1,
              Math.ceil((limitResult.resetAt - Date.now()) / 1000),
            ).toString(),
          },
        },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      projectId?: string;
      email?: string;
      pin?: string;
      downloadPin?: string;
      collectionId?: string | null;
      mediaIds?: string[];
      downloadType?: "gallery" | "favorites";
    };

    const validatedProjectId = validateUuid(body.projectId, "projectId");
    if (!validatedProjectId.ok) {
      return NextResponse.json({ ok: false, message: validatedProjectId.message }, { status: 400 });
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

    // Hard cap + UUID format: without this, a caller shipping an array of
    // 100k non-UUID strings would fan out into a massive IN() query.
    const mediaIdsResult = validateUuidArray(body.mediaIds, "mediaIds", {
      min: 1,
      max: 2000,
    });
    if (!mediaIdsResult.ok) {
      return NextResponse.json(
        { ok: false, message: mediaIdsResult.message },
        { status: 400 },
      );
    }
    const scope = await resolveEventDownloadScope({
      service: access.service, projectId: access.projectId,
      collectionIds: access.collectionIds, pin: body.pin ?? "", collectionId: body.collectionId,
    });
    if (!scope.ok) {
      return NextResponse.json({ ok: false, message: scope.message }, { status: scope.status });
    }
    const collectionId = scope.collectionId;
    const mediaIds = await authorizedEventMediaIds(
      access.service, access.projectId, mediaIdsResult.value, scope.collectionIds,
    );
    if (!mediaIds.length) {
      return NextResponse.json({ ok: false, message: "No gallery photos are available for that download." }, { status: 403 });
    }

    const settings = normalizeEventGallerySettings(access.project.gallery_settings);
    const downloadType = body.downloadType === "favorites" ? "favorites" : "gallery";
    const providedDownloadPin = clean(body.downloadPin);
    const expectedDownloadPin = clean(settings.extras.downloadPin);

    if (downloadType === "favorites") {
      if (!settings.extras.allowClientFavoriteDownloads) {
        return NextResponse.json(
          { ok: false, message: "Favorites download is turned off for this gallery." },
          { status: 403 },
        );
      }

      if (settings.extras.favoriteDownloadsRequireAllDigitalsPurchase) {
        const paidAllDigitalsOrder = await hasEventAllDigitalsPurchase(access.service, access.projectId, access.email, access.project.photographer_id, await eventRequestedCollectionIds(access.service, access.projectId, mediaIds));

        if (!paidAllDigitalsOrder) {
          return NextResponse.json(
            {
              ok: false,
              message:
                "Favorites download unlocks after the full digital package is purchased.",
            },
            { status: 403 },
          );
        }
      }

      const deliveries = await buildEventFileDeliveries({ service: access.service, project: access.project, email: access.email, mediaIds, collections: scope.collections, deliveryType: "favorites" });
      const { error: insertError } = await access.service
        .from("event_gallery_downloads")
        .insert({
          project_id: access.projectId,
          collection_id: collectionId || null,
          viewer_email: access.email,
          download_type: "favorites",
          download_count: mediaIds.length,
          media_ids: mediaIds,
        });

      if (insertError && !isMissingDownloadsTable(insertError)) {
        throw insertError;
      }

      return NextResponse.json({ ok: true, allowedMediaIds: mediaIds, deliveries });
    }

    if (!settings.extras.freeDigitalRuleEnabled || !settings.extras.showDownloadAllButton) {
      return NextResponse.json(
        { ok: false, message: "Gallery downloads are turned off for this event." },
        { status: 403 },
      );
    }

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

    if (settings.extras.freeDigitalAudience === "album" && !collectionId) {
      return NextResponse.json(
        { ok: false, message: "Open the album you want to download first." },
        { status: 400 },
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

    const requestedAllowedMediaIds =
      downloadsRemaining === null ? mediaIds : mediaIds.slice(0, downloadsRemaining);

    if (!requestedAllowedMediaIds.length) {
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

    const reservation = await reserveGalleryDownload({ service: access.service, galleryKind: "event", galleryId: access.projectId,
      photographerId: access.project.photographer_id, viewerEmail: access.email, collectionId,
      mediaIds: requestedAllowedMediaIds, gallerySettings: access.project.gallery_settings });
    const allowedMediaIds = reservation.allowedMediaIds;
    if (!allowedMediaIds.length) return NextResponse.json({ ok: false, message: "This gallery's free download limit has been reached.",
      downloadsUsed: reservation.downloadsUsed, downloadsRemaining: reservation.downloadsRemaining }, { status: 403 });
    const deliveries = await buildEventFileDeliveries({ service: access.service, project: access.project, email: access.email, mediaIds: allowedMediaIds, collections: scope.collections, deliveryType: "gallery" });

    return NextResponse.json({
      ok: true,
      allowedMediaIds,
      deliveries,
      downloadsUsed: reservation.downloadsUsed,
      downloadsRemaining: reservation.downloadsRemaining,
    });
  } catch (error) {
    console.error("[event-downloads]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to prepare event downloads." },
      { status: 500 },
    );
  }
}
