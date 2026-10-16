import { NextRequest, NextResponse } from "next/server";
import { isLabPilot } from "@/lib/labs/pilot";
import { loadProductionV2Workspace, performProductionV2OwnerAction } from "@/lib/labs/production-v2-server";
import { productionAccess } from "@/lib/labs/production-server";
import { saveProductionV2Crop } from "@/lib/labs/production-v2-image-server";
import { productionImageFailure, productionPrivateHeaders } from "@/lib/labs/production-image-server";
import { parseProductionV2OwnerAction } from "@/lib/labs/production-v2-validation";
import { PRODUCTION_BODY_BYTES } from "@/lib/labs/production-validation";
import { readBoundedLabBody } from "@/lib/labs/orders-http";
import { requireLabOrderAgreement } from "@/lib/labs/orders-server";
import { LabError } from "@/lib/labs/validation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!isLabPilot()) return NextResponse.json({ ok: false }, { status: 404, headers: productionPrivateHeaders });
  try { return NextResponse.json({ ok: true, workspace: await loadProductionV2Workspace(await productionAccess(request, "studio")) }, { headers: productionPrivateHeaders }); }
  catch (error) { return productionImageFailure(error); }
}
export async function POST(request: NextRequest) {
  if (!isLabPilot()) return NextResponse.json({ ok: false }, { status: 404, headers: productionPrivateHeaders });
  try {
    const access = await productionAccess(request, "studio");
    await requireLabOrderAgreement(access);
    const bytes = await readBoundedLabBody(request, PRODUCTION_BODY_BYTES);
    let body: unknown; try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new LabError("Use a complete production request.", 400, "PRODUCTION_INVALID"); }
    const action = parseProductionV2OwnerAction(body);
    const result = action.action === "save_crop" ? { ...await saveProductionV2Crop(access, action), workspace: await loadProductionV2Workspace(access) } : await performProductionV2OwnerAction(access, action);
    return NextResponse.json({ ok: true, ...result }, { headers: productionPrivateHeaders });
  } catch (error) { return productionImageFailure(error); }
}
