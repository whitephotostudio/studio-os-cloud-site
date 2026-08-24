import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { listR2FolderImages } from "@/lib/r2";
import { guardAgreement } from "@/lib/require-agreement";
import { isUuid } from "@/lib/r2-access-security";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

async function photographerOwnsFolder(
  service: ReturnType<typeof createDashboardServiceClient>,
  photographerId: string,
  folderPath: string,
): Promise<boolean> {
  if (!folderPath || folderPath.includes("..") || folderPath.startsWith("/")) return false;
  const segments = folderPath.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  const [first, second] = segments;

  async function ownsSchool(schoolIdOrLocalId: string | undefined) {
    if (!schoolIdOrLocalId) return false;

    if (isUuid(schoolIdOrLocalId)) {
      const { data: byId, error: byIdError } = await service
        .from("schools")
        .select("id")
        .eq("id", schoolIdOrLocalId)
        .eq("photographer_id", photographerId)
        .maybeSingle();
      if (byIdError) throw byIdError;
      if (byId?.id) return true;
    }

    const { data: byLocalId, error: byLocalIdError } = await service
      .from("schools")
      .select("id")
      .eq("local_school_id", schoolIdOrLocalId)
      .eq("photographer_id", photographerId)
      .maybeSingle();
    if (byLocalIdError) throw byLocalIdError;
    return Boolean(byLocalId?.id);
  }

  if (first === "projects" && segments.length >= 2) {
    const { data } = await service
      .from("projects")
      .select("id")
      .eq("id", second)
      .eq("photographer_id", photographerId)
      .maybeSingle();
    return !!data?.id;
  }

  // backdrops/{photographerId}/...  — authorize purely on the path shape; the
  // frontend always writes uploads under the photographer's own id, and the
  // previous DB lookup targeted a non-existent `backdrops` table, which
  // silently rejected every folder list and made the desktop app bail before
  // ever attempting an upload.
  if (first === "backdrops") {
    return second === photographerId;
  }

  // Current uploads can be rooted at schools/<school-id>/... or
  // photos/<school-id>/..., while older desktop builds used the database or
  // local school id directly as the first segment. Keep folder enumeration in
  // lockstep with the authenticated image proxy for all three shapes.
  if (first === "schools" || first === "photos") {
    return ownsSchool(second);
  }
  return ownsSchool(first);
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

    const allowed = await photographerOwnsFolder(service, photographerRow.id, folderPath);
    if (!allowed) {
      console.warn(
        `[storage-folder] rejected path for photographer ${photographerRow.id}: ${folderPath}`,
      );
      return NextResponse.json(
        { ok: false, message: "You cannot list that folder." },
        { status: 403 },
      );
    }
  } catch (error) {
    console.error("storage-folder ownership check failed:", error);
    return NextResponse.json(
      { ok: false, message: "Could not verify folder permissions." },
      { status: 500 },
    );
  }

  try {
    const files = await listR2FolderImages(folderPath);
    return NextResponse.json({ ok: true, files });
  } catch (error) {
    console.error("[dashboard:storage-folder]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to list storage folder." },
      { status: 500 },
    );
  }
}
