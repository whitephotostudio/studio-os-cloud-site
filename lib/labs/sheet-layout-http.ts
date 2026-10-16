import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isLabPilot } from "./pilot";
import { productionImageFailure, productionPrivateHeaders } from "./production-image-server";
import { readBoundedLabBody } from "./orders-http";
import { requireLabOrderAgreement } from "./orders-server";
import { LabError } from "./validation";
import { loadSheetWorkspace, parsePrivateSheetAction, performSheetAction, sheetAccess, sheetExportFile, sheetSourcePreview } from "./sheet-layout-server";
const uuid = z.string().uuid();
function parameter(request: NextRequest, name: string, required = false) {
  const value = request.nextUrl.searchParams.get(name);
  if (required && !value || value !== null && !uuid.safeParse(value).success) throw new LabError("Choose the exact saved sheet, job and photograph.", 400, "SHEET_INVALID");
  return value;
}
export async function sheetGet(request: NextRequest, audience: "studio" | "lab") {
  if (!isLabPilot()) return NextResponse.json({ ok: false }, { status: 404, headers: productionPrivateHeaders });
  try {
    const access = await sheetAccess(request, audience), file = request.nextUrl.searchParams.get("file");
    const allowed = file === "preview" ? ["file", "assetId", "jobId"] : file ? ["file", "draftId", "renderId"] : ["jobId", "draftId"];
    if ([...request.nextUrl.searchParams.keys()].some(k => !allowed.includes(k)) || [...new Set(request.nextUrl.searchParams.keys())].some(k => request.nextUrl.searchParams.getAll(k).length !== 1)) throw new LabError("Use the exact private sheet request.", 400, "SHEET_INVALID");
    if (file === "preview") return new Response(new Uint8Array(await sheetSourcePreview(access, parameter(request, "assetId", true)!, parameter(request, "jobId"))), { headers: { ...productionPrivateHeaders, "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff" } });
    if (file === "proof" || file === "jpeg" || file === "manifest") return await sheetExportFile(access, parameter(request, "draftId", true)!, parameter(request, "renderId", true)!, file);
    if (file !== null) throw new LabError("Choose a supported private sheet file.", 400, "SHEET_INVALID");
    return NextResponse.json({ ok: true, workspace: await loadSheetWorkspace(access, parameter(request, "jobId"), parameter(request, "draftId")) }, { headers: productionPrivateHeaders });
  } catch (error) { return productionImageFailure(error); }
}
export async function sheetPost(request: NextRequest, audience: "studio" | "lab") {
  if (!isLabPilot()) return NextResponse.json({ ok: false }, { status: 404, headers: productionPrivateHeaders });
  try {
    const access = await sheetAccess(request, audience);
    await requireLabOrderAgreement(access);
    const bytes = await readBoundedLabBody(request, 16_000);
    let body: unknown; try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new LabError("Use a complete sheet request.", 400, "SHEET_INVALID"); }
    return NextResponse.json({ ok: true, ...await performSheetAction(access, parsePrivateSheetAction(body)) }, { headers: productionPrivateHeaders });
  } catch (error) { return productionImageFailure(error); }
}
