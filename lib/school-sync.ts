import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEventGallerySettings } from "@/lib/event-gallery-settings";
import { buildStoredMediaUrls } from "@/lib/storage-images";

type SupabaseClientLike = SupabaseClient;

type SchoolSyncTarget = {
  school_name?: string | null;
  local_school_id?: string | null;
  photographer_id?: string | null;
  portal_status?: string | null;
  status?: string | null;
};

type CollectionKind = "class" | "gallery" | "composite";

type UploadedSchoolAsset = {
  storagePath: string;
  publicUrl: string;
  filename: string;
  mimeType: string | null;
};

type ProjectCoverContext = {
  cover_photo_url?: string | null;
  gallery_settings?: unknown;
};

type CollectionCoverContext = {
  cover_photo_url?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function slugify(value: string, fallback = "collection") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function chooseSchoolCoverCandidate(
  assets: UploadedSchoolAsset[],
  source: "first_valid" | "newest" | "oldest" | "manual",
) {
  if (!assets.length || source === "manual") return null;
  const ordered = source === "newest" ? [...assets].reverse() : assets;
  return ordered.find((asset) => clean(asset.publicUrl)) ?? null;
}

async function applySchoolAutoCovers(
  supabase: SupabaseClientLike,
  params: {
    projectId: string;
    collectionId: string;
    assets: UploadedSchoolAsset[];
  },
) {
  if (!params.assets.length) return;

  const [{ data: projectRow, error: projectError }, { data: collectionRow, error: collectionError }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("cover_photo_url,gallery_settings")
        .eq("id", params.projectId)
        .maybeSingle<ProjectCoverContext>(),
      supabase
        .from("collections")
        .select("cover_photo_url")
        .eq("id", params.collectionId)
        .maybeSingle<CollectionCoverContext>(),
    ]);

  if (projectError) throw projectError;
  if (collectionError) throw collectionError;

  const settings = normalizeEventGallerySettings(projectRow?.gallery_settings);
  const coverSource = settings.extras.coverSource;
  if (coverSource === "manual") return;

  const candidate = chooseSchoolCoverCandidate(params.assets, coverSource);
  const candidateUrl = clean(candidate?.publicUrl);
  if (!candidateUrl) return;

  if (settings.extras.autoChooseAlbumCover && !clean(collectionRow?.cover_photo_url)) {
    const { error } = await supabase
      .from("collections")
      .update({
        cover_photo_url: candidateUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.collectionId)
      .eq("project_id", params.projectId);

    if (error) throw error;
  }

  if (settings.extras.autoChooseProjectCover && !clean(projectRow?.cover_photo_url)) {
    const { error } = await supabase
      .from("projects")
      .update({
        cover_photo_url: candidateUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.projectId);

    if (error) throw error;
  }
}

export async function findSyncedSchoolProjectId(
  supabase: SupabaseClientLike,
  schoolId: string,
  options?: {
    localSchoolId?: string | null;
  }
) {
  const schoolProjectByLinkedSchoolId = await supabase
    .from("projects")
    .select("id")
    .eq("workflow_type", "school")
    .eq("linked_school_id", schoolId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (schoolProjectByLinkedSchoolId.data?.id) {
    return schoolProjectByLinkedSchoolId.data.id;
  }

  const localSchoolId = clean(options?.localSchoolId);
  if (localSchoolId) {
    const schoolProjectByLinkedLocalSchoolId = await supabase
      .from("projects")
      .select("id")
      .eq("workflow_type", "school")
      .eq("linked_local_school_id", localSchoolId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (schoolProjectByLinkedLocalSchoolId.data?.id) {
      return schoolProjectByLinkedLocalSchoolId.data.id;
    }
  }

  return null;
}

export async function ensureSyncedSchoolProjectId(
  supabase: SupabaseClientLike,
  schoolId: string,
  school: SchoolSyncTarget | null
) {
  const existingId = await findSyncedSchoolProjectId(supabase, schoolId, {
    localSchoolId: school?.local_school_id,
  });

  if (existingId) return existingId;

  const photographerId = clean(school?.photographer_id);
  if (!photographerId) {
    return null;
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({
      photographer_id: photographerId,
      workflow_type: "school",
      source_type: "cloud_only",
      title: clean(school?.school_name) || "School Gallery",
      linked_school_id: schoolId,
      linked_local_school_id: clean(school?.local_school_id) || null,
      status: clean(school?.portal_status) || clean(school?.status) || "active",
    })
    .select("id")
    .single();

  if (error) {
    const fallbackId = await findSyncedSchoolProjectId(supabase, schoolId, {
      localSchoolId: school?.local_school_id,
    });
    if (fallbackId) return fallbackId;
    throw error;
  }

  return clean(data?.id) || null;
}

export async function ensureSchoolCollectionId(
  supabase: SupabaseClientLike,
  params: {
    schoolId: string;
    school: SchoolSyncTarget | null;
    kind: CollectionKind;
    title: string;
    slugFallback?: string;
  }
) {
  const projectId = await ensureSyncedSchoolProjectId(supabase, params.schoolId, params.school);
  if (!projectId) {
    return { projectId: null, collectionId: null };
  }

  const normalizedTitle = clean(params.title);
  const slug = slugify(params.title, params.slugFallback || params.kind);

  const { data: collectionRows, error: collectionError } = await supabase
    .from("collections")
    .select("id,title,slug,sort_order")
    .eq("project_id", projectId)
    .eq("kind", params.kind)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (collectionError) throw collectionError;

  const rows = (collectionRows ?? []) as Array<{
    id: string;
    title: string | null;
    slug: string | null;
    sort_order?: number | null;
  }>;

  const existing = rows.find(
    (row) => clean(row.slug) === slug || clean(row.title).toLowerCase() === normalizedTitle.toLowerCase()
  );

  if (existing?.id) {
    return { projectId, collectionId: existing.id };
  }

  const nextSortOrder = rows.length
    ? Math.max(...rows.map((row) => Number(row.sort_order ?? 0))) + 1
    : 0;

  const { data: insertedCollection, error: insertError } = await supabase
    .from("collections")
    .insert({
      project_id: projectId,
      kind: params.kind,
      title: normalizedTitle || "Untitled",
      slug,
      sort_order: nextSortOrder,
      visibility: "public",
    })
    .select("id")
    .single();

  if (insertError) throw insertError;

  return {
    projectId,
    collectionId: clean(insertedCollection?.id) || null,
  };
}

export async function appendSchoolMediaRows(
  supabase: SupabaseClientLike,
  params: {
    projectId: string;
    collectionId: string;
    assets: UploadedSchoolAsset[];
  }
) {
  if (!params.assets.length) return;

  const { data: lastMediaRow, error: lastMediaError } = await supabase
    .from("media")
    .select("sort_order")
    .eq("project_id", params.projectId)
    .eq("collection_id", params.collectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastMediaError) throw lastMediaError;

  let nextSortOrder = Number(lastMediaRow?.sort_order ?? -1) + 1;

  const payload = params.assets.map((asset) => {
    const mediaUrls = buildStoredMediaUrls({
      storagePath: asset.storagePath,
      previewUrl: asset.publicUrl,
      thumbnailUrl: asset.publicUrl,
    });

    return {
      project_id: params.projectId,
      collection_id: params.collectionId,
      storage_path: asset.storagePath,
      filename: asset.filename,
      mime_type: asset.mimeType,
      preview_url: mediaUrls.previewUrl || null,
      thumbnail_url: mediaUrls.thumbnailUrl || null,
      sort_order: nextSortOrder++,
      is_cover: false,
    };
  });

  const { error } = await supabase.from("media").insert(payload);
  if (error) throw error;

  await applySchoolAutoCovers(supabase, params);
}
