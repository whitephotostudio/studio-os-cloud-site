import { NextRequest, NextResponse } from "next/server";
import { resolveDashboardAuth } from "@/lib/dashboard-auth";
import { r2Upload, r2PublicUrl } from "@/lib/r2";

/**
 * Accepts a file upload via multipart form data and stores it in R2.
 * Returns the public URL and storage key.
 *
 * Form fields:
 *   file    — the file blob
 *   key     — the desired storage key (e.g. "projects/abc/albums/xyz/photo.jpg")
 */
export async function POST(request: NextRequest) {
  const auth = await resolveDashboardAuth(request);
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const key = formData.get("key") as string | null;

  if (!file || !key) {
    return NextResponse.json(
      { error: "file and key are required" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";

  try {
    const publicUrl = await r2Upload(key, buffer, contentType);
    return NextResponse.json({ publicUrl, key });
  } catch (err: any) {
    console.error("R2 upload error:", err);
    return NextResponse.json(
      { error: err.message || "Upload failed" },
      { status: 500 },
    );
  }
}

export const config = {
  api: { bodyParser: false },
};
