import { NextRequest, NextResponse } from "next/server";
import { labDashboardAccess, loadLabWorkspace, performLabAction } from "@/lib/labs/server";
import { LabError, parseLabAction } from "@/lib/labs/validation";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

function failure(error: unknown) {
  if (error instanceof LabError) return NextResponse.json({ ok: false, message: error.message, code: error.code }, { status: error.status, headers });
  return NextResponse.json({ ok: false, message: "The lab workspace is temporarily unavailable. Try again shortly.", code: "LAB_UNAVAILABLE" }, { status: 503, headers });
}

export async function GET(request: NextRequest) {
  try {
    const access = await labDashboardAccess(request);
    return NextResponse.json({ ok: true, workspace: await loadLabWorkspace(access) }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const access = await labDashboardAccess(request);
    if (Number(request.headers.get("content-length") || 0) > 256_000) throw new LabError("This price sheet is too large.", 413);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 256_000) throw new LabError("This price sheet is too large.", 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new LabError("Use a valid lab workspace request."); }
    const action = parseLabAction(body);
    return NextResponse.json({ ok: true, ...await performLabAction(access, action) }, { headers });
  } catch (error) { return failure(error); }
}
