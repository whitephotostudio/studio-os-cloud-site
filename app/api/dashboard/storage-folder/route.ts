import { NextRequest, NextResponse } from "next/server";
import { resolveDashboardAuth } from "@/lib/dashboard-auth";
import { listR2FolderImages } from "@/lib/r2";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
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
