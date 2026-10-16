import { NextRequest, NextResponse } from "next/server";
import { isLabPilot } from "@/lib/labs/pilot";
import { productionAccess } from "@/lib/labs/production-server";
import { productionPrivateHeaders } from "@/lib/labs/production-image-server";
import { loadLabSetupWorkspace, performLabSetupAction } from "@/lib/labs/setup-server";
import { LAB_SETUP_BODY_BYTES, parseLabSetupAction } from "@/lib/labs/setup-validation";
import { readBoundedLabBody } from "@/lib/labs/orders-http";
import { LabError } from "@/lib/labs/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function failure(error: unknown) {
  return NextResponse.json({ ok: false, message: error instanceof LabError ? error.message : "Lab setup is temporarily unavailable.", code: error instanceof LabError ? error.code : "LAB_SETUP_UNAVAILABLE" }, { status: error instanceof LabError ? error.status : 503, headers: productionPrivateHeaders });
}
export async function GET(request: NextRequest) {
  if (!isLabPilot()) return NextResponse.json({ ok: false }, { status: 404, headers: productionPrivateHeaders });
  try { return NextResponse.json({ ok: true, workspace: await loadLabSetupWorkspace(await productionAccess(request, "lab"), request.nextUrl.searchParams.get("labId")) }, { headers: productionPrivateHeaders }); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  if (!isLabPilot()) return NextResponse.json({ ok: false }, { status: 404, headers: productionPrivateHeaders });
  try {
    const access = await productionAccess(request, "lab"), bytes = await readBoundedLabBody(request, LAB_SETUP_BODY_BYTES);
    let body: unknown; try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new LabError("Use a complete setup request.", 400, "LAB_SETUP_INVALID"); }
    return NextResponse.json({ ok: true, ...await performLabSetupAction(access, parseLabSetupAction(body)) }, { headers: productionPrivateHeaders });
  } catch (error) { return failure(error); }
}
