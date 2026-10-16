import { NextRequest, NextResponse } from "next/server";
import { isLabPilot } from "@/lib/labs/pilot";
import { productionAccess, loadProductionWorkspace, performProductionOwnerAction } from "@/lib/labs/production-server";
import { saveProductionCrop, productionImageFailure, productionPrivateHeaders } from "@/lib/labs/production-image-server";
import { parseProductionOwnerAction, PRODUCTION_BODY_BYTES } from "@/lib/labs/production-validation";
import { readBoundedLabBody } from "@/lib/labs/orders-http";
import { LabError } from "@/lib/labs/validation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!isLabPilot()) return NextResponse.json({ ok: false }, { status: 404, headers: productionPrivateHeaders });
  try { return NextResponse.json({ ok: true, workspace: await loadProductionWorkspace(await productionAccess(request, "lab")) }, { headers: productionPrivateHeaders }); }
  catch (error) { return productionImageFailure(error); }
}
export async function POST(request: NextRequest) {
  if (!isLabPilot()) return NextResponse.json({ ok: false }, { status: 404, headers: productionPrivateHeaders });
  try {
    const access = await productionAccess(request, "lab"), bytes = await readBoundedLabBody(request, PRODUCTION_BODY_BYTES);
    let body: unknown; try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new LabError("Use a complete production request.", 400, "PRODUCTION_INVALID"); }
    const action = parseProductionOwnerAction(body);
    const result = action.action === "save_crop" ? { ...await saveProductionCrop(access, action), workspace: await loadProductionWorkspace(access) } : await performProductionOwnerAction(access, action);
    return NextResponse.json({ ok: true, ...result }, { headers: productionPrivateHeaders });
  } catch (error) { return productionImageFailure(error); }
}
