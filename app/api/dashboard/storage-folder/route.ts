import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { listR2FolderImages } from "@/lib/r2";

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

  if (first === "projects" && segments.length >= 2) {
    const { data } = await service
      .from("projects")
      .select("id")
      .eq("id", second)
      .eq("photographer_id", photographerId)
      .maybeSingle();
    return !!data?.id;
  }

  if (first === "backdrops") {
    const { data } = await service
      .from("backdrops")
      .select("id")
      .eq("photographer_id", photographerId)
      .limit(1)
      .maybeSingle();
    return !!data?.id;
  }

  const { data } = await service
    .from("schools")
    .select("id")
    .eq("photographer_id", photographerId)
    .or(`id.eq.${first},local_school_id.eq.${first}`)
    .limit(1)
    .maybeSingle();
  return !!data?.id;
}

export async function GET(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) {
    return NextResponse.json({ ok: false, message: "Please sign in again." }, { status: 401 });
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
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to list storage folder.",
      },
      { status: 500 },
    );
  }
}
