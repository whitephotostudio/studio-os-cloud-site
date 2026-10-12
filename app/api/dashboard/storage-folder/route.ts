import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { listR2FolderImages } from "@/lib/r2";
import { guardAgreement } from "@/lib/require-agreement";
import { isServerOnlyR2Key } from "@/lib/r2-access-security";
import { resolveR2MediaOwnership } from "@/lib/r2-media-ownership";
import { filterPaidCutoutFiles } from "@/lib/credit-cutout-access";
import {
  filterTombstonedSchoolPhotoAssets,
  loadSchoolPhotoTombstones,
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
  if (!folderPath || isServerOnlyR2Key(folderPath)) return { allowed: false, schoolId: null };
  // Retained first-owner claims preserve old local-school roots after relabeling.
  // The shared resolver also rejects foreign, ambiguous and deleted resources.
  const ownership = await resolveR2MediaOwnership(service, folderPath, photographerId, { prefix: true });
  return { allowed: ownership.owned, schoolId: ownership.schoolId };
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
    const { data: photographerRow, error: photographerError } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (photographerError) throw photographerError;

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

    const files = await filterPaidCutoutFiles(await listR2FolderImages(folderPath), {
      service, photographerId: photographerRow.id,
    });
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
