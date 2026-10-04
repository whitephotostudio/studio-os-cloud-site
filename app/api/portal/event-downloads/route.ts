import { NextRequest, NextResponse } from "next/server";
import { validateEventGalleryAccess } from "@/lib/event-gallery-access";
import { authorizedEventMediaIds, eventGalleryDownloadsUsed, resolveEventDownloadScope } from "@/lib/event-download-scope";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { validateUuid, validateUuidArray } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

type OrderRow = {
  package_id: string | null;
  package_name: string | null;
  status: string | null;
  parent_email: string | null;
  customer_email: string | null;
};

type PurchasedPackageRow = {
  id: string;
  name: string | null;
  description: string | null;
  category: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isPaidOrderStatus(status: string | null | undefined) {
  const value = clean(status).toLowerCase();
  return value === "paid" || value === "completed" || value === "fulfilled";
}

function isAllDigitalsText(...values: Array<string | null | undefined>) {
  return values.some((value) => {
    const text = clean(value).toLowerCase();
    return (
      text.includes("all digitals") ||
      text.includes("all digital") ||
      text.includes("full gallery") ||
      text.includes("full digital")
    );
  });
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
        const { data: orderRows, error: orderError } = await access.service
          .from("orders")
          .select("package_id,package_name,status,parent_email,customer_email")
          .eq("project_id", access.projectId);

        if (orderError) throw orderError;

        const matchingOrders = ((orderRows ?? []) as OrderRow[]).filter((row) => {
          if (!isPaidOrderStatus(row.status)) return false;
          const orderEmails = [
            clean(row.parent_email).toLowerCase(),
            clean(row.customer_email).toLowerCase(),
          ].filter(Boolean);
          return orderEmails.includes(access.email);
        });

        const packageIds = Array.from(
          new Set(
            matchingOrders
              .map((row) => clean(row.package_id))
              .filter((value) => value.length > 0),
          ),
        );

        const packageMap = new Map<string, PurchasedPackageRow>();
        if (packageIds.length > 0) {
          const { data: packageRows, error: packageError } = await access.service
            .from("packages")
            .select("id,name,description,category")
            .in("id", packageIds);

          if (packageError) throw packageError;

          for (const row of (packageRows ?? []) as PurchasedPackageRow[]) {
            packageMap.set(row.id, row);
          }
        }

        const paidAllDigitalsOrder = matchingOrders.find((row) => {
          const linkedPackage = packageMap.get(clean(row.package_id));
          return isAllDigitalsText(
            row.package_name,
            linkedPackage?.name,
            linkedPackage?.description,
          );
        });

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

      return NextResponse.json({ ok: true, allowedMediaIds: mediaIds });
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

    const allowedMediaIds =
      downloadsRemaining === null ? mediaIds : mediaIds.slice(0, downloadsRemaining);

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

    const { error: insertError } = await access.service
      .from("event_gallery_downloads")
      .insert({
        project_id: access.projectId,
        collection_id: collectionId || null,
        viewer_email: access.email,
        download_type: "gallery",
        download_count: allowedMediaIds.length,
        media_ids: allowedMediaIds,
      });

    if (insertError && !isMissingDownloadsTable(insertError)) {
      throw insertError;
    }

    return NextResponse.json({
      ok: true,
      allowedMediaIds,
      downloadsUsed: downloadsUsed + allowedMediaIds.length,
      downloadsRemaining:
        downloadsRemaining === null
          ? null
          : Math.max(0, downloadsRemaining - allowedMediaIds.length),
    });
  } catch (error) {
    console.error("[event-downloads]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to prepare event downloads." },
      { status: 500 },
    );
  }
}
