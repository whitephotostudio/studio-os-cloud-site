import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { guardAgreement } from "@/lib/require-agreement";
import {
  normalizeEventGallerySettings,
  type EventGalleryLinkedContact,
} from "@/lib/event-gallery-settings";

export const dynamic = "force-dynamic";

const AlbumPayloadSchema = z.object({
  name: z.string().max(500).nullable().optional(),
  localId: z.string().max(128).nullable().optional(),
  accessMode: z.string().max(64).nullable().optional(),
  accessPin: z.string().max(64).nullable().optional(),
  accessUpdatedAt: z.string().max(64).nullable().optional(),
});

const DesktopAccessBodySchema = z.object({
  localProjectId: z.string().max(128).nullable().optional(),
  cloudProjectId: z.string().max(128).nullable().optional(),
  title: z.string().max(500).nullable().optional(),
  clientName: z.string().max(500).nullable().optional(),
  clientEmail: z.string().max(500).nullable().optional(),
  createdAt: z.string().max(64).nullable().optional(),
  shootDate: z.string().max(64).nullable().optional(),
  eventDate: z.string().max(64).nullable().optional(),
  accessMode: z.string().max(64).nullable().optional(),
  accessPin: z.string().max(64).nullable().optional(),
  accessUpdatedAt: z.string().max(64).nullable().optional(),
  galleryStatus: z.string().max(64).nullable().optional(),
  albums: z.array(AlbumPayloadSchema).max(1000).nullable().optional(),
});

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizeEmail(value: string | null | undefined) {
  const email = clean(value).toLowerCase();
  if (!email || !email.includes("@")) return "";
  return email;
}

function slugify(value: string, fallback = "gallery") {
  const base = clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) return fallback;
  // Cap length so an oversized title can never produce a monster slug.
  // Trim back to the last word boundary (dash) to avoid cutting mid-word.
  const MAX = 60;
  if (base.length <= MAX) return base;
  const trimmed = base.slice(0, MAX).replace(/-+[^-]*$/, "").replace(/-+$/g, "");
  return trimmed || base.slice(0, MAX).replace(/-+$/g, "") || fallback;
}

// Valid gallery statuses matching the web dashboard
const VALID_STATUSES = ["active", "inactive", "pre_released", "closed"];

function normalizeGalleryStatus(value: string | null | undefined): string {
  const raw = clean(value).toLowerCase().replace("-", "_");
  return VALID_STATUSES.includes(raw) ? raw : "active";
}

function normalizeAccessMode(value: string | null | undefined): string {
  const raw = clean(value).toLowerCase();
  if (raw === "pin" || raw === "protected" || raw === "private") return "pin";
  return "public";
}

function timeValue(value: string | null | undefined): number | null {
  const raw = clean(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldApplyIncomingAccess({
  incomingUpdatedAt,
  existingUpdatedAt,
  incomingMode,
  incomingPin,
  existingMode,
  existingPin,
}: {
  incomingUpdatedAt: string | null | undefined;
  existingUpdatedAt: string | null | undefined;
  incomingMode: string | null | undefined;
  incomingPin: string | null | undefined;
  existingMode: string | null | undefined;
  existingPin: string | null | undefined;
}) {
  const incomingTime = timeValue(incomingUpdatedAt);
  const existingTime = timeValue(existingUpdatedAt);
  if (incomingTime !== null && existingTime !== null) {
    return incomingTime >= existingTime;
  }

  // Safety for older desktop clients or stale local files: if Cloud already
  // has an explicit PIN and desktop is sending the untouched default Public
  // state, preserve the safer cloud setting.
  const cloudHasPin =
    normalizeAccessMode(existingMode) === "pin" &&
    clean(existingPin).length > 0;
  const incomingIsBlankPublic =
    normalizeAccessMode(incomingMode) === "public" &&
    clean(incomingPin).length === 0;
  if (cloudHasPin && incomingIsBlankPublic) return false;

  return true;
}

function buildGalleryUrl(
  projectId: string,
  slug?: string | null,
): string {
  const cleanSlug = clean(slug).toLowerCase();
  // Prefer the short, clean share link (no internal IDs) when a slug exists.
  if (cleanSlug) {
    return `https://www.studiooscloud.com/g/${encodeURIComponent(cleanSlug)}`;
  }
  const params = new URLSearchParams({
    mode: "event",
    project: projectId,
  });
  return `https://www.studiooscloud.com/parents?${params.toString()}`;
}

function clientContactId(email: string) {
  const safe = email.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `desktop-client-${safe || "contact"}`;
}

function withDesktopClientContact(
  gallerySettings: unknown,
  clientName: string,
  clientEmail: string,
) {
  if (!clientEmail) return undefined;
  const settings = normalizeEventGallerySettings(gallerySettings);
  const email = clientEmail.toLowerCase();
  const existingIndex = settings.linkedContacts.findIndex(
    (contact) => clean(contact.email).toLowerCase() === email,
  );
  const contact: EventGalleryLinkedContact = {
    id:
      existingIndex >= 0
        ? settings.linkedContacts[existingIndex].id
        : clientContactId(email),
    name:
      clientName ||
      (existingIndex >= 0 ? settings.linkedContacts[existingIndex].name : ""),
    email,
    role: "Client",
    labelPhotos:
      existingIndex >= 0 ? settings.linkedContacts[existingIndex].labelPhotos : false,
    hidePhotos:
      existingIndex >= 0 ? settings.linkedContacts[existingIndex].hidePhotos : false,
    isVip: existingIndex >= 0 ? settings.linkedContacts[existingIndex].isVip : true,
    note:
      existingIndex >= 0
        ? settings.linkedContacts[existingIndex].note
        : "Synced from Studio OS desktop client details.",
  };

  const linkedContacts =
    existingIndex >= 0
      ? settings.linkedContacts.map((item, index) =>
          index === existingIndex ? contact : item,
        )
      : [contact, ...settings.linkedContacts];

  return {
    ...settings,
    linkedContacts,
  };
}

// ─── POST: Sync access settings from desktop app to cloud ───────────
export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const parsed = await parseJson(request, DesktopAccessBodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const service = createDashboardServiceClient();

    // Agreement gate — refuse to act for users who haven't accepted the
    // Studio OS Cloud legal agreement. Defense in depth behind the client
    // modal. Same pattern as upload-to-r2 / generate-thumbnails.
    {
      const guard = await guardAgreement({ service, userId: user.id });
      if (!guard.ok)
        return NextResponse.json(guard.body, { status: guard.status });
    }

    // ── Resolve photographer ──
    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    const photographerId = clean(photographerRow?.id);
    if (!photographerId) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    // ── Find or create project ──
    const cloudProjectId = clean(body.cloudProjectId);
    const localProjectId = clean(body.localProjectId);
    const title = clean(body.title) || "Untitled Project";
    const clientName = clean(body.clientName);
    const clientEmail = normalizeEmail(body.clientEmail);
    const accessMode = normalizeAccessMode(body.accessMode);
    const accessPin = accessMode === "pin" ? clean(body.accessPin) : null;
    const galleryStatus = normalizeGalleryStatus(body.galleryStatus);
    const preRelease = galleryStatus === "pre_released";
    const shootDate = clean(body.shootDate) || clean(body.eventDate);
    const nowIso = new Date().toISOString();

    let projectId = cloudProjectId;
    let existingProjectAccess: {
      access_mode?: string | null;
      access_pin?: string | null;
      access_updated_at?: string | null;
      access_updated_source?: string | null;
      gallery_settings?: unknown;
    } | null = null;

    if (projectId) {
      // Verify the project belongs to this photographer
      const { data: existing } = await service
        .from("projects")
        .select(
          "id,access_mode,access_pin,access_updated_at,access_updated_source,gallery_settings",
        )
        .eq("id", projectId)
        .eq("photographer_id", photographerId)
        .is("deleted_at", null)
        .maybeSingle();

      if (!existing?.id) {
        projectId = "";
      } else {
        existingProjectAccess = existing;
      }
    }

    if (!projectId && localProjectId) {
      // Try to find by linked_local_school_id
      const { data: linked } = await service
        .from("projects")
        .select(
          "id,access_mode,access_pin,access_updated_at,access_updated_source,gallery_settings",
        )
        .eq("linked_local_school_id", localProjectId)
        .eq("photographer_id", photographerId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (linked?.id) {
        projectId = linked.id;
        existingProjectAccess = linked;
      }
    }

    const applyIncomingProjectAccess = shouldApplyIncomingAccess({
      incomingUpdatedAt: body.accessUpdatedAt,
      existingUpdatedAt: existingProjectAccess?.access_updated_at,
      incomingMode: accessMode,
      incomingPin: accessPin,
      existingMode: existingProjectAccess?.access_mode,
      existingPin: existingProjectAccess?.access_pin,
    });
    const effectiveProjectAccessMode = applyIncomingProjectAccess
      ? accessMode
      : normalizeAccessMode(existingProjectAccess?.access_mode);
    const effectiveProjectAccessPin =
      effectiveProjectAccessMode === "pin"
        ? applyIncomingProjectAccess
          ? accessPin
          : clean(existingProjectAccess?.access_pin)
        : null;
    const effectiveProjectAccessUpdatedAt = applyIncomingProjectAccess
      ? nowIso
      : existingProjectAccess?.access_updated_at || nowIso;
    const effectiveProjectAccessUpdatedSource = applyIncomingProjectAccess
      ? "desktop"
      : existingProjectAccess?.access_updated_source || "cloud";
    const desktopClientGallerySettings = withDesktopClientContact(
      existingProjectAccess?.gallery_settings,
      clientName,
      clientEmail,
    );

    if (!projectId) {
      // Create new project
      const slug = slugify(title);
      const { data: inserted, error: insertError } = await service
        .from("projects")
        .insert({
          photographer_id: photographerId,
          // DB check constraints:
          //   workflow_type ∈ {school, event}
          //   source_type   ∈ {local_school_sync, cloud_only, hybrid}
          // Desktop-synced galleries are recorded as cloud_only events.
          workflow_type: "event",
          source_type: "cloud_only",
          title,
          client_name: clientName || null,
          linked_local_school_id: localProjectId || null,
          shoot_date: shootDate || null,
          event_date: shootDate || null,
          access_mode: effectiveProjectAccessMode,
          access_pin: effectiveProjectAccessPin,
          access_updated_at: effectiveProjectAccessUpdatedAt,
          access_updated_source: effectiveProjectAccessUpdatedSource,
          portal_status: galleryStatus,
          pre_release: preRelease,
          gallery_slug: slug,
          ...(desktopClientGallerySettings
            ? { gallery_settings: desktopClientGallerySettings }
            : {}),
        })
        .select("id,gallery_slug")
        .single();

      if (insertError) throw insertError;
      projectId = clean(inserted?.id);
    } else {
      // Update existing project
      const { error: updateError } = await service
        .from("projects")
        .update({
          title,
          client_name: clientName || null,
          ...(shootDate
            ? { shoot_date: shootDate, event_date: shootDate }
            : {}),
          access_mode: effectiveProjectAccessMode,
          access_pin: effectiveProjectAccessPin,
          access_updated_at: effectiveProjectAccessUpdatedAt,
          access_updated_source: effectiveProjectAccessUpdatedSource,
          portal_status: galleryStatus,
          pre_release: preRelease,
          updated_at: nowIso,
          ...(desktopClientGallerySettings
            ? { gallery_settings: desktopClientGallerySettings }
            : {}),
        })
        .eq("id", projectId);

      if (updateError) throw updateError;
    }

    // ── Read back project for response ──
    const { data: projectRow, error: projectReadError } = await service
      .from("projects")
      .select(
        "id,title,client_name,shoot_date,event_date,order_due_date,expiration_date,portal_status,pre_release,gallery_slug,gallery_settings,cover_photo_url,access_mode,access_pin,access_updated_at,access_updated_source,updated_at",
      )
      .eq("id", projectId)
      .single();

    if (projectReadError) throw projectReadError;

    const galleryUrl = buildGalleryUrl(projectId, projectRow?.gallery_slug);

    let seededVisitor: Record<string, unknown> | null = null;
    if (clientEmail) {
      const openedAt = nowIso;
      const { data: visitorRow, error: visitorError } = await service
        .from("event_gallery_visitors")
        .upsert(
          {
            project_id: projectId,
            viewer_email: clientEmail,
            last_opened_at: openedAt,
          },
          { onConflict: "project_id,viewer_email" },
        )
        .select("viewer_email,created_at,last_opened_at")
        .single();

      if (visitorError && visitorError.code !== "42P01") throw visitorError;
      seededVisitor = {
        email: visitorRow?.viewer_email ?? clientEmail,
        createdAt: visitorRow?.created_at ?? openedAt,
        lastOpenedAt: visitorRow?.last_opened_at ?? openedAt,
      };
    }

    // ── Sync album/collection access ──
    const albums = Array.isArray(body.albums) ? body.albums : [];
    const collectionResults: Array<Record<string, unknown>> = [];

    for (const album of albums) {
      const albumName = clean(album.name);
      if (!albumName) continue;

      const albumLocalId = clean(album.localId);
      const albumSlug = slugify(albumName);
      const albumAccessMode = clean(album.accessMode) || "inherit_project";
      const albumAccessPin =
        albumAccessMode === "pin" ? clean(album.accessPin) : null;

      // Find existing collection by local_id or slug/title
      let collectionId = "";
      let existingCollectionAccess: {
        access_mode?: string | null;
        access_pin?: string | null;
        access_updated_at?: string | null;
        access_updated_source?: string | null;
      } | null = null;

      if (albumLocalId) {
        const { data: byLocalId } = await service
          .from("collections")
          .select(
            "id,cover_photo_url,access_mode,access_pin,access_updated_at,access_updated_source",
          )
          .eq("project_id", projectId)
          .eq("local_id", albumLocalId)
          .is("deleted_at", null)
          .maybeSingle();

        if (byLocalId?.id) {
          collectionId = byLocalId.id;
          existingCollectionAccess = byLocalId;
        }
      }

      if (!collectionId) {
        const { data: bySlug } = await service
          .from("collections")
          .select(
            "id,cover_photo_url,access_mode,access_pin,access_updated_at,access_updated_source",
          )
          .eq("project_id", projectId)
          .eq("kind", "gallery")
          .or(`slug.eq.${albumSlug},title.ilike.${albumName}`)
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (bySlug?.id) {
          collectionId = bySlug.id;
          existingCollectionAccess = bySlug;
        }
      }

      const applyIncomingAlbumAccess = shouldApplyIncomingAccess({
        incomingUpdatedAt: album.accessUpdatedAt,
        existingUpdatedAt: existingCollectionAccess?.access_updated_at,
        incomingMode: albumAccessMode,
        incomingPin: albumAccessPin,
        existingMode: existingCollectionAccess?.access_mode,
        existingPin: existingCollectionAccess?.access_pin,
      });
      const effectiveAlbumAccessMode = applyIncomingAlbumAccess
        ? albumAccessMode
        : clean(existingCollectionAccess?.access_mode) || "inherit_project";
      const effectiveAlbumAccessPin =
        effectiveAlbumAccessMode === "pin"
          ? applyIncomingAlbumAccess
            ? albumAccessPin
            : clean(existingCollectionAccess?.access_pin)
          : null;
      const effectiveAlbumAccessUpdatedAt = applyIncomingAlbumAccess
        ? nowIso
        : existingCollectionAccess?.access_updated_at || nowIso;
      const effectiveAlbumAccessUpdatedSource = applyIncomingAlbumAccess
        ? "desktop"
        : existingCollectionAccess?.access_updated_source || "cloud";

      if (!collectionId) {
        // Get next sort_order
        const { data: lastRow } = await service
          .from("collections")
          .select("sort_order")
          .eq("project_id", projectId)
          .is("deleted_at", null)
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextSort = Number(lastRow?.sort_order ?? -1) + 1;

        const { data: inserted, error: insertErr } = await service
          .from("collections")
          .insert({
            project_id: projectId,
            kind: "gallery",
            title: albumName,
            slug: albumSlug,
            sort_order: nextSort,
            visibility: "public",
            local_id: albumLocalId || null,
            sync_source: "desktop",
            access_mode: effectiveAlbumAccessMode,
            access_pin: effectiveAlbumAccessPin,
            access_updated_at: effectiveAlbumAccessUpdatedAt,
            access_updated_source: effectiveAlbumAccessUpdatedSource,
          })
          .select("id,cover_photo_url")
          .single();

        if (insertErr) throw insertErr;
        collectionId = clean(inserted?.id);
      } else {
        // Update existing collection
        const updatePayload: Record<string, unknown> = {
          title: albumName,
          access_mode: effectiveAlbumAccessMode,
          access_pin: effectiveAlbumAccessPin,
          access_updated_at: effectiveAlbumAccessUpdatedAt,
          access_updated_source: effectiveAlbumAccessUpdatedSource,
          updated_at: nowIso,
        };
        if (albumLocalId) updatePayload.local_id = albumLocalId;

        const { error: updateErr } = await service
          .from("collections")
          .update(updatePayload)
          .eq("id", collectionId);

        if (updateErr) throw updateErr;
      }

      const { data: collectionRow, error: collectionReadError } = await service
        .from("collections")
        .select("cover_photo_url")
        .eq("id", collectionId)
        .maybeSingle();

      if (collectionReadError) throw collectionReadError;

      collectionResults.push({
        id: collectionId,
        title: albumName,
        local_id: albumLocalId,
        cover_photo_url: collectionRow?.cover_photo_url ?? null,
        access_mode: effectiveAlbumAccessMode,
        access_pin: effectiveAlbumAccessPin,
        access_updated_at: effectiveAlbumAccessUpdatedAt,
        access_updated_source: effectiveAlbumAccessUpdatedSource,
      });
    }

    return NextResponse.json({
      ok: true,
      project: {
        id: projectId,
        title: projectRow?.title ?? title,
        client_name: projectRow?.client_name ?? clientName,
        shoot_date: projectRow?.shoot_date ?? "",
        event_date: projectRow?.event_date ?? "",
        order_due_date: projectRow?.order_due_date ?? "",
        expiration_date: projectRow?.expiration_date ?? "",
        portal_status: projectRow?.portal_status ?? galleryStatus,
        gallery_status: projectRow?.portal_status ?? galleryStatus,
        pre_release: projectRow?.pre_release ?? preRelease,
        gallery_url: galleryUrl,
        gallery_slug: projectRow?.gallery_slug ?? "",
        cover_photo_url: projectRow?.cover_photo_url ?? null,
        access_mode: projectRow?.access_mode ?? accessMode,
        access_pin: projectRow?.access_pin ?? "",
        access_updated_at: projectRow?.access_updated_at ?? "",
        access_updated_source: projectRow?.access_updated_source ?? "desktop",
        updated_at: projectRow?.updated_at ?? "",
      },
      collections: collectionResults,
      seededVisitor,
      message: `Access settings synced. Gallery is ${galleryStatus.replace("_", "-")}.`,
    });
  } catch (error: unknown) {
    console.error("[desktop-access POST]", error);
    return NextResponse.json(
      { ok: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}

// ─── GET: Pull access settings from cloud to desktop app ───────────
export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Please sign in again." },
        { status: 401 },
      );
    }

    const service = createDashboardServiceClient();

    // ── Resolve photographer ──
    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (photographerError) throw photographerError;
    const photographerId = clean(photographerRow?.id);
    if (!photographerId) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 404 },
      );
    }

    const url = new URL(request.url);
    const mode = url.searchParams.get("mode");

    // ── mode=all: return all projects ──
    if (mode === "all") {
      const { data: allProjects, error: allError } = await service
        .from("projects")
        .select(
          "id,title,client_name,shoot_date,event_date,order_due_date,expiration_date,portal_status,pre_release,gallery_slug,cover_photo_url,access_mode,access_pin,access_updated_at,access_updated_source,linked_local_school_id,updated_at",
        )
        .eq("photographer_id", photographerId)
        .eq("workflow_type", "event")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (allError) throw allError;

      const results = [];
      for (const proj of allProjects ?? []) {
        const { data: collections } = await service
          .from("collections")
          .select(
            "id,title,slug,local_id,cover_photo_url,access_mode,access_pin,access_updated_at,access_updated_source,sort_order",
          )
          .eq("project_id", proj.id)
          .is("deleted_at", null)
          .order("sort_order", { ascending: true });

        results.push({
          project: {
            ...proj,
            gallery_status: proj.portal_status,
            gallery_url: buildGalleryUrl(proj.id, proj.gallery_slug),
          },
          collections: collections ?? [],
        });
      }

      return NextResponse.json({ ok: true, projects: results });
    }

    // ── Single project pull ──
    const cloudProjectId = clean(url.searchParams.get("cloudProjectId"));
    const localProjectId = clean(url.searchParams.get("localProjectId"));

    let projectId = cloudProjectId;

    if (!projectId && localProjectId) {
      const { data: linked } = await service
        .from("projects")
        .select("id")
        .eq("linked_local_school_id", localProjectId)
        .eq("photographer_id", photographerId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (linked?.id) projectId = linked.id;
    }

    if (!projectId) {
      return NextResponse.json(
        { ok: false, message: "Cloud project not found." },
        { status: 404 },
      );
    }

    const { data: projectRow, error: projectError } = await service
      .from("projects")
      .select(
        "id,title,client_name,shoot_date,event_date,order_due_date,expiration_date,portal_status,pre_release,gallery_slug,cover_photo_url,access_mode,access_pin,access_updated_at,access_updated_source,linked_local_school_id,updated_at",
      )
      .eq("id", projectId)
      .eq("photographer_id", photographerId)
      .is("deleted_at", null)
      .single();

    if (projectError) throw projectError;

    const { data: collections, error: collError } = await service
      .from("collections")
      .select(
        "id,title,slug,local_id,cover_photo_url,access_mode,access_pin,access_updated_at,access_updated_source,sort_order",
      )
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });

    if (collError) throw collError;

    const galleryUrl = buildGalleryUrl(projectId, projectRow?.gallery_slug);

    return NextResponse.json({
      ok: true,
      project: {
        ...projectRow,
        gallery_status: projectRow?.portal_status,
        gallery_url: galleryUrl,
      },
      collections: collections ?? [],
    });
  } catch (error: unknown) {
    console.error("[desktop-access GET]", error);
    return NextResponse.json(
      { ok: false, message: "Internal server error" },
      { status: 500 },
    );
  }
}
