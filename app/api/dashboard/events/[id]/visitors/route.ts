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

type DownloadMediaPreview = {
  id: string;
  thumbnailUrl: string | null;
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

function filenameFromStoragePath(storagePath: string) {
  const rawName = storagePath.split("/").filter(Boolean).pop() ?? storagePath;
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function usableImageUrl(value: string | null | undefined) {
  const candidate = clean(value);
  if (!candidate) return "";
  if (
    candidate.startsWith("/") ||
    candidate.startsWith("http://") ||
    candidate.startsWith("https://") ||
    candidate.startsWith("data:")
  ) {
    return candidate;
  }
  return publicStorageUrl(candidate);
}

function previewFromEventMediaRow(row: MediaRow): DownloadMediaPreview {
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
      usableImageUrl(row.thumbnail_url) ||
      usableImageUrl(row.preview_url) ||
      (storagePath ? publicStorageUrl(storagePath) : "") ||
      null,
    filename:
      clean(row.filename) ||
      (storagePath ? filenameFromStoragePath(storagePath) : row.id),
  };
}

/**
 * GET /api/dashboard/events/[projectId]/visitors
 * Returns visitors with their orders, downloads, favorites for an event gallery.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    const service = createDashboardServiceClient();

    const { data: pgRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    if (!pgRow) {
      return NextResponse.json({ error: "Photographer not found" }, { status: 403 });
    }

    const { data: project, error: projectError } = await service
      .from("projects")
      .select("id, photographer_id, title")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError) throw projectError;
    if (!project || project.photographer_id !== pgRow.id) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const [
      { data: visitors, error: visitorsError },
      { data: downloads, error: downloadsError },
      { data: favorites, error: favoritesError },
      { data: orders, error: ordersError },
    ] = await Promise.all([
      service
        .from("event_gallery_visitors")
        .select("*")
        .eq("project_id", projectId)
        .order("last_opened_at", { ascending: false }),
      service
        .from("event_gallery_downloads")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      service
        .from("event_gallery_favorites")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
      service
        .from("orders")
        .select(`
          id, status, total_cents, subtotal_cents, tax_cents, currency,
          created_at, parent_email, customer_email, customer_name, parent_name,
          package_name, cart_snapshot, special_notes,
          items:order_items(id, product_name, quantity, price, unit_price_cents, line_total_cents, sku)
        `)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false }),
    ]);

    if (visitorsError) throw visitorsError;
    if (downloadsError) throw downloadsError;
    if (favoritesError) throw favoritesError;
    if (ordersError) throw ordersError;

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
    const queryableMediaIds = Array.from(
      new Set([...downloadedMediaIds, ...favoriteMediaIds].filter(looksLikeUuid)),
    );
    const mediaRowsResult = queryableMediaIds.length
      ? await service
          .from("media")
          .select("id,storage_path,preview_url,thumbnail_url,filename")
          .eq("project_id", projectId)
          .in("id", queryableMediaIds)
      : { data: [] as MediaRow[], error: null };

    if (mediaRowsResult.error) throw mediaRowsResult.error;

    const mediaById = new Map(
      ((mediaRowsResult.data ?? []) as MediaRow[]).map((row) => [
        row.id,
        previewFromEventMediaRow(row),
      ] as const),
    );

    const visitorList = (visitors ?? []).map((v: Record<string, unknown>) => {
      const email = ((v.viewer_email as string) || "").toLowerCase();

      const visitorOrders = (orders ?? [])
        .filter((o: Record<string, unknown>) => {
          const pe = ((o.parent_email as string) || "").toLowerCase();
          const ce = ((o.customer_email as string) || "").toLowerCase();
          return pe === email || ce === email;
        })
        .map((o: Record<string, unknown>) => ({
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
        }));

      const visitorDownloads = (downloads ?? [])
        .filter((d: Record<string, unknown>) =>
          ((d.viewer_email as string) || "").toLowerCase() === email,
        )
        .map((d: Record<string, unknown>) => {
          const mediaIds = mediaIdsFromRaw(d.media_ids);
          return {
            id: d.id,
            downloadType: d.download_type,
            downloadCount: d.download_count,
            mediaIds,
            media: mediaIds.map(
              (mediaId) =>
                mediaById.get(mediaId) ?? {
                  id: mediaId,
                  thumbnailUrl: null,
                  filename: mediaId,
                },
            ),
            createdAt: d.created_at,
          };
        });

      const visitorFavorites = (favorites ?? [])
        .filter((f: Record<string, unknown>) =>
          ((f.viewer_email as string) || "").toLowerCase() === email,
        )
        .map((f: Record<string, unknown>) => ({
          id: f.id,
          mediaId: f.media_id,
          media: mediaById.get(clean(f.media_id as string | null)) ?? {
            id: clean(f.media_id as string | null),
            thumbnailUrl: null,
            filename: clean(f.media_id as string | null),
          },
          createdAt: f.created_at,
        }));

      return {
        id: v.id,
        email: v.viewer_email,
        firstVisit: v.created_at,
        lastVisit: v.last_opened_at,
        orders: visitorOrders,
        downloads: visitorDownloads,
        favorites: visitorFavorites,
        orderCount: visitorOrders.length,
        downloadCount: visitorDownloads.reduce(
          (sum, d) => sum + (Number(d.downloadCount) || 0),
          0 as number,
        ),
        favoriteCount: visitorFavorites.length,
      };
    });

    return NextResponse.json({
      projectName: project.title || "Event",
      visitors: visitorList,
      totalVisitors: visitorList.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load gallery visitors.",
      },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/dashboard/events/[projectId]/visitors
 * Update a visitor's email address.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;
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

  const { data: project } = await service
    .from("projects")
    .select("id, photographer_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project || project.photographer_id !== pgRow.id) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const parsed = await parseJson(request, VisitorPatchBodySchema);
  if (!parsed.ok) return parsed.response;
  const { visitorId, newEmail } = parsed.data;

  const normalizedEmail = newEmail.trim().toLowerCase();
  const { error } = await service
    .from("event_gallery_visitors")
    .update({ viewer_email: normalizedEmail })
    .eq("id", visitorId)
    .eq("project_id", projectId);

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
    metadata: { projectId, source: "event_gallery_visitors" },
    result: "ok",
  });

  return NextResponse.json({ ok: true });
}
