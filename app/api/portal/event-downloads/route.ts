import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { validateUuidArray } from "@/lib/request-validation";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  workflow_type: string | null;
  status: string | null;
  email_required: boolean | null;
  access_mode: string | null;
  access_pin: string | null;
  gallery_settings: unknown;
};

type CollectionAccessRow = {
  id: string;
  slug: string | null;
  access_mode: string | null;
  access_pin: string | null;
};

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

type DownloadLogRow = {
  download_count: number | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizedAccessMode(value: string | null | undefined) {
  const raw = clean(value).toLowerCase();
  if (!raw) return "public";
  if (raw === "pin" || raw === "protected" || raw === "private") return "pin";
  if (raw === "inherit" || raw === "inherit_project" || raw === "project") {
    return "inherit_project";
  }
  return raw;
}

function isInactive(value: string | null | undefined) {
  return clean(value).toLowerCase() === "inactive";
}

function isEventProject(row: Pick<ProjectRow, "workflow_type">) {
  return clean(row.workflow_type).toLowerCase() === "event";
}

function matchesProjectPin(
  row: Pick<ProjectRow, "access_mode" | "access_pin">,
  pin: string,
) {
  return normalizedAccessMode(row.access_mode) === "pin" && clean(row.access_pin) === pin;
}

function matchesCollectionPin(row: CollectionAccessRow, pin: string) {
  return (
    clean(row.slug) === pin ||
    (normalizedAccessMode(row.access_mode) === "pin" && clean(row.access_pin) === pin)
  );
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

async function validateEventAccess(params: {
  projectId: string;
  email: string;
  pin: string;
}) {
  const service = createDashboardServiceClient();
  const selectedProjectId = clean(params.projectId);
  const normalizedEmail = clean(params.email).toLowerCase();
  const pinValue = clean(params.pin);

  const { data: projectRow, error: projectError } = await service
    .from("projects")
    .select("id,workflow_type,status,email_required,access_mode,access_pin,gallery_settings")
    .eq("id", selectedProjectId)
    .maybeSingle<ProjectRow>();

  if (projectError) throw projectError;
  if (!projectRow || !isEventProject(projectRow) || isInactive(projectRow.status)) {
    return { ok: false as const, status: 404, message: "Event gallery not found." };
  }

  const { data: whitelistRows, error: whitelistError } = await service
    .from("pre_release_emails")
    .select("id")
    .eq("project_id", selectedProjectId)
    .eq("email", normalizedEmail)
    .limit(1);

  if (whitelistError) throw whitelistError;

  const emailRequired = projectRow.email_required !== false;
  if (emailRequired && (whitelistRows?.length ?? 0) === 0) {
    const { data: anyWhitelist, error: anyWhitelistError } = await service
      .from("pre_release_emails")
      .select("id")
      .eq("project_id", selectedProjectId)
      .limit(1);

    if (anyWhitelistError) throw anyWhitelistError;

    if ((anyWhitelist?.length ?? 0) > 0) {
      return {
        ok: false as const,
        status: 403,
        message: "That email is not approved for this event gallery.",
      };
    }
  }

  const [matchingSubjectResult, collectionAccessResult] = await Promise.all([
    service
      .from("subjects")
      .select("id")
      .eq("project_id", selectedProjectId)
      .eq("external_ref", pinValue)
      .limit(1)
      .maybeSingle(),
    service
      .from("collections")
      .select("id,slug,access_mode,access_pin")
      .eq("project_id", selectedProjectId),
  ]);

  if (matchingSubjectResult.error) throw matchingSubjectResult.error;
  if (collectionAccessResult.error) throw collectionAccessResult.error;

  const matchingCollection = ((collectionAccessResult.data ?? []) as CollectionAccessRow[]).find(
    (row) => matchesCollectionPin(row, pinValue),
  );
  const projectPinMatch = matchesProjectPin(projectRow, pinValue);

  if (!projectPinMatch && !matchingSubjectResult.data && !matchingCollection) {
    return {
      ok: false as const,
      status: 404,
      message: "No event gallery was found for that email and PIN.",
    };
  }

  return {
    ok: true as const,
    service,
    project: projectRow,
    projectId: selectedProjectId,
    email: normalizedEmail,
  };
}

export async function POST(request: NextRequest) {
  try {
    // Cap per-IP download prep rate. Each call validates access, reads orders,
    // reads packages, reads download logs, and writes a download row — an
    // expensive path. 20/min is well above any plausible human interaction.
    const limitResult = rateLimit(getClientIp(request), {
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
      collectionId?: string;
      mediaIds?: string[];
      downloadType?: "gallery" | "favorites";
    };

    const access = await validateEventAccess({
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
    const mediaIds = mediaIdsResult.value;

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
