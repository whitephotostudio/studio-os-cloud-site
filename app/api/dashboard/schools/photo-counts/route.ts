import { NextRequest, NextResponse } from "next/server";

import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { guardAgreement } from "@/lib/require-agreement";
import { listR2FolderImages } from "@/lib/r2";
import { findSyncedSchoolProjectId } from "@/lib/school-sync";
import {
  filterTombstonedSchoolPhotoAssets,
  loadSchoolPhotoTombstones,
  tombstoneFamilySet,
} from "@/lib/school-photo-deletions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SchoolRow = {
  id: string;
  local_school_id: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

async function pooledForEach<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
}

// Returns the authoritative number of original image objects stored under
// each desktop school's R2 prefix. listR2FolderImages excludes generated
// _preview and _thumbnail variants, so this matches the desktop uploader's
// local photo total instead of counting one portal image per student.
export async function GET(request: NextRequest) {
  const { user } = await resolveDashboardAuth(request);
  if (!user) {
    return NextResponse.json({ ok: false, message: "Please sign in again." }, { status: 401 });
  }

  const service = createDashboardServiceClient();
  const agreement = await guardAgreement({ service, userId: user.id });
  if (!agreement.ok) {
    return NextResponse.json(agreement.body, { status: agreement.status });
  }

  const { data: photographer, error: photographerError } = await service
    .from("photographers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();

  if (photographerError || !photographer?.id) {
    return NextResponse.json(
      { ok: false, message: "Photographer profile not found." },
      { status: 403 },
    );
  }

  const { data: schoolRows, error: schoolsError } = await service
    .from("schools")
    .select("id,local_school_id")
    .eq("photographer_id", photographer.id);

  if (schoolsError) {
    console.error("[dashboard:school-photo-counts] school lookup failed", {
      photographerId: photographer.id,
      error: schoolsError.message,
    });
    return NextResponse.json(
      { ok: false, message: "Could not load school photo counts." },
      { status: 500 },
    );
  }

  const counts: Record<string, number | null> = {};
  const sources: Record<string, "r2" | "database" | "unavailable"> = {};
  await pooledForEach((schoolRows ?? []) as SchoolRow[], 4, async (school) => {
    const prefix = clean(school.local_school_id) || clean(school.id);
    if (!prefix) {
      counts[school.id] = null;
      sources[school.id] = "unavailable";
      return;
    }

    try {
      const [files, tombstones] = await Promise.all([
        listR2FolderImages(prefix),
        loadSchoolPhotoTombstones(service, school.id),
      ]);
      counts[school.id] = filterTombstonedSchoolPhotoAssets(
        files,
        tombstoneFamilySet(tombstones),
      ).length;
      sources[school.id] = "r2";
    } catch (error) {
      console.warn("[dashboard:school-photo-counts] R2 count unavailable", {
        schoolId: school.id,
        error: error instanceof Error ? error.name : "UnknownError",
      });

      // Keep the badge useful during a temporary R2 listing outage. Desktop
      // sync writes one media row per original (not per preview/thumbnail),
      // and the prefix constraint avoids counting school composites.
      try {
        const projectId = await findSyncedSchoolProjectId(service, school.id, {
          localSchoolId: school.local_school_id,
        });
        if (!projectId) {
          counts[school.id] = null;
          sources[school.id] = "unavailable";
          return;
        }

        const { count, error: mediaCountError } = await service
          .from("media")
          .select("id", { count: "exact", head: true })
          .eq("project_id", projectId)
          .like("storage_path", `${prefix}/%`);
        if (mediaCountError) throw mediaCountError;
        if ((count ?? 0) > 0) {
          counts[school.id] = count;
          sources[school.id] = "database";
        } else {
          // A zero-row fallback cannot distinguish an empty school from a
          // school whose older desktop upload never wrote media rows.
          counts[school.id] = null;
          sources[school.id] = "unavailable";
        }
      } catch (fallbackError) {
        counts[school.id] = null;
        sources[school.id] = "unavailable";
        console.warn("[dashboard:school-photo-counts] fallback count unavailable", {
          schoolId: school.id,
          error: fallbackError instanceof Error ? fallbackError.name : "UnknownError",
        });
      }
    }
  });

  return NextResponse.json(
    { ok: true, counts, sources },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
