import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createClient } from "@supabase/supabase-js";

function clean(value) {
  return String(value ?? "").trim();
}

function safeExportSegment(value) {
  const cleaned = clean(value)
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_");
  return cleaned || "composite";
}

function exportFileName(project, extension) {
  const safeClass = safeExportSegment(project.className);
  const safeSchool = safeExportSegment(project.schoolName);
  const safeYear = safeExportSegment(project.year || "current");
  return `composite_${safeSchool}_${safeClass}_${safeYear}.${extension}`;
}

function collectionSlug(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "composite";
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findSchoolRow(sb, project) {
  const localSchoolId = clean(project.schoolId);
  if (localSchoolId) {
    const { data, error } = await sb
      .from("schools")
      .select("id,school_name,local_school_id,photographer_id,status")
      .eq("local_school_id", localSchoolId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data;
  }

  const schoolName = clean(project.schoolName);
  if (!schoolName) return null;

  const { data, error } = await sb
    .from("schools")
    .select("id,school_name,local_school_id,photographer_id,status")
    .ilike("school_name", schoolName)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function ensureSchoolProjectId(sb, schoolRow, project) {
  const schoolId = clean(schoolRow?.id);
  const localSchoolId = clean(project.schoolId);
  if (!schoolId) return null;

  const { data: bySchool, error: bySchoolError } = await sb
    .from("projects")
    .select("id")
    .eq("workflow_type", "school")
    .eq("linked_school_id", schoolId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (bySchoolError) throw bySchoolError;
  if (clean(bySchool?.id)) return clean(bySchool.id);

  if (localSchoolId) {
    const { data: byLocal, error: byLocalError } = await sb
      .from("projects")
      .select("id")
      .eq("workflow_type", "school")
      .eq("linked_local_school_id", localSchoolId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byLocalError) throw byLocalError;
    if (clean(byLocal?.id)) return clean(byLocal.id);
  }

  const photographerId = clean(schoolRow?.photographer_id);
  if (!photographerId) {
    throw new Error(`Missing photographer_id for school ${schoolId}`);
  }

  const { data: inserted, error: insertError } = await sb
    .from("projects")
    .insert({
      photographer_id: photographerId,
      workflow_type: "school",
      source_type: "cloud_only",
      title: clean(project.schoolName) || clean(schoolRow?.school_name) || "School Gallery",
      linked_school_id: schoolId,
      linked_local_school_id: localSchoolId || null,
      status: clean(schoolRow?.status) || "active",
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return clean(inserted?.id) || null;
}

async function ensureCompositeCollectionId(sb, cloudProjectId, className) {
  const normalizedClass = clean(className);
  if (!normalizedClass) return null;
  const slug = collectionSlug(normalizedClass);

  const { data: rows, error } = await sb
    .from("collections")
    .select("id,title,slug,sort_order")
    .eq("project_id", cloudProjectId)
    .eq("kind", "composite")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;

  const existing = (rows ?? []).find((row) => {
    return clean(row.slug) === slug || clean(row.title).toLowerCase() === normalizedClass.toLowerCase();
  });
  if (clean(existing?.id)) return clean(existing.id);

  const nextSortOrder = (rows ?? []).length
    ? Math.max(...rows.map((row) => Number(row.sort_order ?? 0))) + 1
    : 0;

  const { data: inserted, error: insertError } = await sb
    .from("collections")
    .insert({
      project_id: cloudProjectId,
      kind: "composite",
      title: normalizedClass,
      slug,
      sort_order: nextSortOrder,
      visibility: "public",
    })
    .select("id")
    .single();
  if (insertError) throw insertError;
  return clean(inserted?.id) || null;
}

async function upsertCompositeMedia(sb, cloudProjectId, collectionId, objectPath, filename, publicUrl) {
  const { data: existing, error: existingError } = await sb
    .from("media")
    .select("id")
    .eq("project_id", cloudProjectId)
    .eq("collection_id", collectionId)
    .eq("storage_path", objectPath)
    .maybeSingle();
  if (existingError) throw existingError;

  const payload = {
    project_id: cloudProjectId,
    collection_id: collectionId,
    storage_path: objectPath,
    filename,
    mime_type: "image/jpeg",
    preview_url: publicUrl,
    thumbnail_url: publicUrl,
    is_cover: false,
    updated_at: new Date().toISOString(),
  };

  if (clean(existing?.id)) {
    const { error: updateError } = await sb.from("media").update(payload).eq("id", existing.id);
    if (updateError) throw updateError;
  } else {
    const { data: lastRow, error: lastError } = await sb
      .from("media")
      .select("sort_order")
      .eq("project_id", cloudProjectId)
      .eq("collection_id", collectionId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throw lastError;
    const nextSortOrder = Number(lastRow?.sort_order ?? -1) + 1;
    const { error: insertError } = await sb.from("media").insert({
      ...payload,
      sort_order: nextSortOrder,
    });
    if (insertError) throw insertError;
  }

  const { error: coverError } = await sb
    .from("collections")
    .update({
      cover_photo_url: publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", collectionId);
  if (coverError) throw coverError;
}

async function run() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase env vars.");
  }

  const sb = createClient(url, key);
  const appBase = path.join(os.homedir(), "Library", "Application Support", "com.whitephoto.studioos", "whitephoto");
  const compositeDir = path.join(appBase, "composites");
  const names = (await fs.readdir(compositeDir)).filter((name) => name.startsWith("composite_") && name.endsWith(".json"));

  const summary = [];

  for (const name of names) {
    const project = await readJson(path.join(compositeDir, name));
    const schoolId = clean(project.schoolId);
    const className = clean(project.className);
    const captureBasePath = path.join(appBase, `capture_base_${schoolId}.txt`);
    const captureBase = clean(await fs.readFile(captureBasePath, "utf8"));
    if (!captureBase || !className) {
      summary.push({ project: name, status: "skipped", reason: "missing capture base or class name" });
      continue;
    }

    const jpgPath = path.join(captureBase, className, exportFileName(project, "jpg"));
    if (!(await fileExists(jpgPath))) {
      summary.push({ project: name, status: "skipped", reason: `missing jpg ${jpgPath}` });
      continue;
    }

    const schoolRow = await findSchoolRow(sb, project);
    if (!schoolRow?.id) {
      summary.push({ project: name, status: "skipped", reason: "school row not found in Supabase" });
      continue;
    }

    const cloudProjectId = await ensureSchoolProjectId(sb, schoolRow, project);
    const collectionId = await ensureCompositeCollectionId(sb, cloudProjectId, className);
    if (!cloudProjectId || !collectionId) {
      summary.push({ project: name, status: "skipped", reason: "could not ensure project/collection" });
      continue;
    }

    const bytes = await fs.readFile(jpgPath);
    const objectPath = `schools/${cloudProjectId}/composites/${collectionId}/${path.basename(jpgPath)}`;
    const { error: uploadError } = await sb.storage
      .from("thumbs")
      .upload(objectPath, bytes, { upsert: true, contentType: "image/jpeg" });
    if (uploadError) throw uploadError;

    const { data: publicData } = sb.storage.from("thumbs").getPublicUrl(objectPath);
    const publicUrl = clean(publicData?.publicUrl);
    await upsertCompositeMedia(
      sb,
      cloudProjectId,
      collectionId,
      objectPath,
      path.basename(jpgPath),
      publicUrl,
    );

    summary.push({
      project: name,
      status: "uploaded",
      className,
      jpgPath,
      cloudProjectId,
      collectionId,
      publicUrl,
    });
  }

  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
