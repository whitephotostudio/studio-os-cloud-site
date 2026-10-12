import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { recordAudit } from "@/lib/audit";
import { guardAgreement } from "@/lib/require-agreement";
import {
  buildSignedMediaUrls,
  publicStorageUrl,
  SIGNED_URL_TTL_DASHBOARD_SECONDS,
} from "@/lib/storage-images";

import { buildSchoolVisitorAudience, loadSchoolVisitorData } from "@/lib/school-visitor-audience";
import { visitorEmail } from "@/lib/school-visitor-filters";

export const dynamic = "force-dynamic";

const VisitorPatchBodySchema = z.object({
  visitorId: z.string().min(1).max(128),
  newEmail: z.string().email().max(320),
});

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type MediaRow = {
  id: string;
  storage_path: string | null;
  preview_url: string | null;
  thumbnail_url: string | null;
  filename: string | null;
};

type OrderItemRow = {
  id?: string | null;
  product_name?: string | null;
  quantity?: number | null;
  price?: number | null;
  unit_price_cents?: number | null;
  line_total_cents?: number | null;
  sku?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function mediaIdsFromRaw(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];
}

function looksLikeUuid(value: string) {
  return UUID_REGEX.test(value);
}

function mediaUuidFromSchoolMediaId(mediaId: string) {
  const stripped = clean(mediaId).replace(/^composite-/, "");
  return looksLikeUuid(stripped) ? stripped : "";
}

function filenameFromStoragePath(storagePath: string) {
  const rawName = storagePath.split("/").filter(Boolean).pop() ?? storagePath;
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function previewFromSchoolMediaId(mediaId: string): DownloadMediaPreview {
  return {
    id: mediaId,
    thumbnailUrl: publicStorageUrl(mediaId) || null,
    filename: filenameFromStoragePath(mediaId),
  };
}

function previewFromMediaRow(row: MediaRow): DownloadMediaPreview {
  const signed = buildSignedMediaUrls(
    {
      storagePath: row.storage_path,
      previewUrl: row.preview_url,
      thumbnailUrl: row.thumbnail_url,
    },
    { ttlSeconds: SIGNED_URL_TTL_DASHBOARD_SECONDS },
  );
  const storagePath = clean(row.storage_path);
  return {
    id: row.id,
    thumbnailUrl:
      signed.thumbnailUrl ||
      signed.previewUrl ||
      clean(row.thumbnail_url) ||
      clean(row.preview_url) ||
      (storagePath ? publicStorageUrl(storagePath) : "") ||
      null,
    filename:
      clean(row.filename) ||
      (storagePath ? filenameFromStoragePath(storagePath) : row.id),
  };
}

/**
 * GET /api/dashboard/schools/[schoolId]/visitors
 * Returns visitors with their orders, downloads, favorites for a school gallery.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { schoolId } = await params;
  const service = createDashboardServiceClient();

  // Verify photographer owns this school
  const { data: pgRow } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!pgRow) {
    return NextResponse.json({ error: "Photographer not found" }, { status: 403 });
  }

  const { data: school } = await service
    .from("schools")
    .select("id, photographer_id, school_name")
    .eq("id", schoolId)
    .maybeSingle();

  if (!school || school.photographer_id !== pgRow.id) {
    return NextResponse.json({ error: "School not found" }, { status: 404 });
  }

  // Fail the report if any audience source cannot be read. A missing order
  // page must never make a purchasing family eligible for a reminder.
  const data = await loadSchoolVisitorData(service, schoolId);
  const { downloads, favorites } = data;
  const audience = buildSchoolVisitorAudience(data);

  const downloadedMediaIds = Array.from(
    new Set(
      (downloads ?? []).flatMap((d: Record<string, unknown>) =>
        mediaIdsFromRaw(d.media_ids),
      ),
    ),
  );
  const favoriteMediaIds = Array.from(
    new Set(
      (favorites ?? [])
        .map((f: Record<string, unknown>) => clean(f.media_id as string | null))
        .filter(Boolean),
    ),
  );
  const mediaUuids = Array.from(
    new Set([...downloadedMediaIds, ...favoriteMediaIds].map(mediaUuidFromSchoolMediaId).filter(Boolean)),
  );
  const mediaRowsResult = mediaUuids.length
    ? await service
        .from("media")
        .select("id,storage_path,preview_url,thumbnail_url,filename")
        .in("id", mediaUuids)
    : { data: [] as MediaRow[], error: null };

  if (mediaRowsResult.error) throw mediaRowsResult.error;

  const dashboardMediaById = new Map(
    ((mediaRowsResult.data ?? []) as MediaRow[]).map((row) => [
      row.id,
      previewFromMediaRow(row),
    ] as const),
  );
  const downloadedMediaById = new Map(
    downloadedMediaIds.map((mediaId) => [
      mediaId,
      dashboardMediaById.get(mediaUuidFromSchoolMediaId(mediaId)) ??
        previewFromSchoolMediaId(mediaId),
    ] as const),
  );
  const favoriteMediaById = new Map(
    favoriteMediaIds.map((mediaId) => [
      mediaId,
      dashboardMediaById.get(mediaUuidFromSchoolMediaId(mediaId)) ??
        previewFromSchoolMediaId(mediaId),
    ] as const),
  );

  const visitorList = audience.map((v) => {
    const email = v.email;
    const visitorOrders = v.rawOrders.map((o: Record<string, unknown>) => ({
      id: o.id,
      status: o.status,
      totalCents: o.total_cents,
      subtotalCents: o.subtotal_cents,
      taxCents: o.tax_cents,
      currency: o.currency,
      packageName: o.package_name,
      customerName: o.customer_name,
      parentName: o.parent_name,
      cartSnapshot: o.cart_snapshot ?? null,
      items: ((o.items ?? []) as OrderItemRow[]).map((item) => ({
        id: item.id ?? null,
        productName: item.product_name ?? "Item",
        quantity: item.quantity ?? 1,
        price: item.price ?? null,
        unitPriceCents: item.unit_price_cents ?? null,
        lineTotalCents: item.line_total_cents ?? null,
        sku: item.sku ?? null,
      })),
      createdAt: o.created_at,
      studentName: (() => {
        const s = o.student as Record<string, unknown> | null;
        if (!s) return "";
        return `${s.first_name ?? ""} ${s.last_name ?? ""}`.trim();
      })(),
      className: (() => {
        const s = o.student as Record<string, unknown> | null;
        return (s?.class_name as string) ?? "";
      })(),
    }));

    // Find downloads by this visitor
    const visitorDownloads = (downloads ?? []).filter((d: Record<string, unknown>) =>
      visitorEmail(d.viewer_email) === email
    ).map((d: Record<string, unknown>) => {
      const mediaIds = mediaIdsFromRaw(d.media_ids);
      return {
        id: d.id,
        downloadType: d.download_type,
        downloadCount: d.download_count,
        mediaIds,
        media: mediaIds.map(
          (mediaId) => downloadedMediaById.get(mediaId) ?? previewFromSchoolMediaId(mediaId),
        ),
        createdAt: d.created_at,
      };
    });

    const visitorFavorites = (favorites ?? [])
      .filter((f: Record<string, unknown>) =>
        visitorEmail(f.viewer_email) === email
      )
      .map((f: Record<string, unknown>) => {
        const mediaId = clean(f.media_id as string | null);
        return {
          id: f.id,
          mediaId,
          media: favoriteMediaById.get(mediaId) ?? previewFromSchoolMediaId(mediaId),
          createdAt: f.created_at,
        };
      });

    return {
      id: (v.id as string) ?? "",
      email: v.email,
      firstVisit: v.firstVisit,
      lastVisit: v.lastVisit,
      orders: visitorOrders,
      downloads: visitorDownloads,
      favorites: visitorFavorites,
      orderCount: visitorOrders.length,
      downloadCount: visitorDownloads.reduce((sum, d) => sum + (Number(d.downloadCount) || 0), 0 as number),
      favoriteCount: visitorFavorites.length,
      preRelease: v.preRelease,
      alsoPreRelease: v.alsoPreRelease,
      registrationClasses: v.registrationClasses,
      classNames: v.classNames,
      studentNames: v.studentNames,
      hasPaidOrder: v.hasPaidOrder,
      hasDigitalPurchase: v.hasDigitalPurchase,
    };
  });

  const combined = visitorList;

  return NextResponse.json({
    schoolName: school.school_name,
    visitors: combined,
    totalVisitors: combined.length,
    totalOrders: data.orders.length,
    preReleaseCount: combined.filter(visitor => visitor.preRelease).length,
  });
}

type DownloadMediaPreview = {
  id: string;
  thumbnailUrl: string | null;
  filename: string | null;
};

/**
 * PATCH /api/dashboard/schools/[schoolId]/visitors
 * Update a visitor's email address.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ schoolId: string }> },
) {
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { schoolId } = await params;
  const service = createDashboardServiceClient();

  // Agreement gate — refuse to act for users who haven't accepted the
  // Studio OS Cloud legal agreement. Defense in depth behind the client
  // modal. Same pattern as upload-to-r2 / generate-thumbnails.
  {
    const guard = await guardAgreement({ service, userId: user.id });
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
  }

  const { data: pgRow } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!pgRow) return NextResponse.json({ error: "Photographer not found" }, { status: 403 });

  const { data: school } = await service
    .from("schools")
    .select("id, photographer_id")
    .eq("id", schoolId)
    .maybeSingle();
  if (!school || school.photographer_id !== pgRow.id) {
    return NextResponse.json({ error: "School not found" }, { status: 404 });
  }

  const parsed = await parseJson(request, VisitorPatchBodySchema);
  if (!parsed.ok) return parsed.response;
  const { visitorId, newEmail } = parsed.data;

  if (visitorId.startsWith("order_")) {
    return NextResponse.json({ error: "Order contact details must be reviewed from the order." }, { status: 400 });
  }
  const normalizedEmail = newEmail.trim().toLowerCase();

  // ✅ Pre-release registrant IDs are returned from GET prefixed with `pre_`
  // so we can distinguish them from school_gallery_visitors rows. Route the
  // update to the right table.
  if (visitorId.startsWith("pre_")) {
    const realId = visitorId.slice("pre_".length);
    const { error } = await service
      .from("pre_release_registrations")
      .update({ email: normalizedEmail })
      .eq("id", realId)
      .eq("school_id", schoolId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await recordAudit({
      request,
      actorUserId: user.id,
      actorPhotographerId: pgRow.id,
      action: "visitor.email_update",
      entityType: "visitor",
      entityId: realId,
      targetPhotographerId: pgRow.id,
      after: { email: normalizedEmail },
      metadata: { schoolId, source: "pre_release_registrations" },
      result: "ok",
    });
    return NextResponse.json({ ok: true });
  }

  const { error } = await service
    .from("school_gallery_visitors")
    .update({ viewer_email: normalizedEmail })
    .eq("id", visitorId)
    .eq("school_id", schoolId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await recordAudit({
    request,
    actorUserId: user.id,
    actorPhotographerId: pgRow.id,
    action: "visitor.email_update",
    entityType: "visitor",
    entityId: visitorId,
    targetPhotographerId: pgRow.id,
    after: { email: normalizedEmail },
    metadata: { schoolId, source: "school_gallery_visitors" },
    result: "ok",
  });

  return NextResponse.json({ ok: true });
}
