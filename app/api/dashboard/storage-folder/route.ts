import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { listR2FolderImages } from "@/lib/r2";
import { guardAgreement } from "@/lib/require-agreement";
import { isUuid } from "@/lib/r2-access-security";
import {
  filterTombstonedSchoolPhotoAssets,
  loadSchoolPhotoTombstones,
  safeLocalSchoolStorageId,
  tombstoneFamilySet,
} from "@/lib/school-photo-deletions";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

async function photographerOwnsFolder(
  service: ReturnType<typeof createDashboardServiceClient>,
  photographerId: string,
  folderPath: string,
): Promise<{ allowed: boolean; schoolId: string | null }> {
  if (!folderPath || folderPath.includes("..") || folderPath.startsWith("/")) {
    return { allowed: false, schoolId: null };
  }
  const segments = folderPath.split("/").filter(Boolean);
  if (segments.length === 0) return { allowed: false, schoolId: null };
  const [first, second, third] = segments;

  async function ownedSchoolId(schoolIdOrLocalId: string | undefined) {
    const candidate = safeLocalSchoolStorageId(schoolIdOrLocalId);
    if (!candidate) return null;

    const [byIdResult, byLocalIdResult] = await Promise.all([
      isUuid(candidate)
        ? service
        .from("schools")
        .select("id,photographer_id")
        .eq("id", candidate)
        .limit(2)
        : Promise.resolve({ data: [], error: null }),
      service
        .from("schools")
        .select("id,photographer_id")
        .eq("local_school_id", candidate)
        .limit(2),
    ]);
    if (byIdResult.error) throw byIdResult.error;
    if (byLocalIdResult.error) throw byLocalIdResult.error;
    const matches = Array.from(
      new Map(
        [...(byIdResult.data ?? []), ...(byLocalIdResult.data ?? [])].map(
          (row) => [row.id, row],
        ),
      ).values(),
    );
    if (matches.length !== 1) return null;
    return matches[0]?.photographer_id === photographerId
      ? matches[0].id
      : null;
  }

  if (first === "projects" && segments.length >= 2) {
    const { data } = await service
      .from("projects")
      .select("id")
      .eq("id", second)
      .eq("photographer_id", photographerId)
      .maybeSingle();
    return { allowed: !!data?.id, schoolId: null };
  }

  // backdrops/{photographerId}/...  — authorize purely on the path shape; the
  // frontend always writes uploads under the photographer's own id, and the
  // previous DB lookup targeted a non-existent `backdrops` table, which
  // silently rejected every folder list and made the desktop app bail before
  // ever attempting an upload.
  if (first === "backdrops") {
    return { allowed: second === photographerId, schoolId: null };
  }

  // Current uploads can be rooted at schools/<school-id>/... or
  // photos/<school-id>/..., while older desktop builds used the database or
  // local school id directly as the first segment. Keep folder enumeration in
  // lockstep with the authenticated image proxy for all three shapes.
  if (first === "schools" || first === "photos") {
    const schoolId = await ownedSchoolId(second);
    return { allowed: !!schoolId, schoolId };
  }
  if (first === "nobg-photos") {
    if (second === "projects") {
      const { data } = await service
        .from("projects")
        .select("id")
        .eq("id", third)
        .eq("photographer_id", photographerId)
        .maybeSingle();
      return { allowed: !!data?.id, schoolId: null };
    }
    const schoolId = await ownedSchoolId(second === "schools" ? third : second);
    return { allowed: !!schoolId, schoolId };
  }
  const schoolId = await ownedSchoolId(first);
  return { allowed: !!schoolId, schoolId };
}

export async function GET(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) {
    return NextResponse.json({ ok: false, message: "Please sign in again." }, { status: 401 });
  }
  // Agreement gate — refuse to expose storage contents to users who
  // haven't accepted the current Studio OS Cloud legal agreement.
  {
    const service = createDashboardServiceClient();
    const guard = await guardAgreement({ service, userId: auth.user.id });
    if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
  }

  const folderPath = clean(request.nextUrl.searchParams.get("path"));
  if (!folderPath) {
    return NextResponse.json({ ok: false, message: "Folder path is required." }, { status: 400 });
  }

  // Verify the caller owns a resource rooted at this folder before letting
  // them enumerate R2 contents for that path.
  try {
    const service = createDashboardServiceClient();
    const { data: photographerRow } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (!photographerRow?.id) {
      return NextResponse.json(
        { ok: false, message: "Photographer profile not found." },
        { status: 403 },
      );
    }

    const ownership = await photographerOwnsFolder(
      service,
      photographerRow.id,
      folderPath,
    );
    if (!ownership.allowed) {
      console.warn(
        `[storage-folder] rejected path for photographer ${photographerRow.id}: ${folderPath}`,
      );
      return NextResponse.json(
        { ok: false, message: "You cannot list that folder." },
        { status: 403 },
      );
    }

    const files = await listR2FolderImages(folderPath);
    if (!ownership.schoolId) {
      return NextResponse.json({ ok: true, files });
    }

    const tombstones = await loadSchoolPhotoTombstones(
      service,
      ownership.schoolId,
    );
    return NextResponse.json({
      ok: true,
      files: filterTombstonedSchoolPhotoAssets(
        files,
        tombstoneFamilySet(tombstones),
      ),
    });
  } catch (error) {
    console.error("storage-folder request failed:", error);
    return NextResponse.json(
      { ok: false, message: "Could not load this storage folder." },
      { status: 500 },
    );
  }
}
