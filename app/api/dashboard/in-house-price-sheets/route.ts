import { NextRequest, NextResponse } from "next/server";
import { labDashboardAccess, loadInHousePriceSheets } from "@/lib/labs/server";
import { performInHousePriceSheetAction } from "@/lib/labs/in-house-server";
import { IN_HOUSE_MAX_BODY_BYTES, parseInHousePriceSheetAction } from "@/lib/labs/in-house-validation";
import { LabError } from "@/lib/labs/validation";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  if (error instanceof LabError) return NextResponse.json({ ok: false, message: error.message, code: error.code }, { status: error.status, headers });
  return NextResponse.json({ ok: false, message: "The private studio price-copy service is temporarily unavailable.", code: "IN_HOUSE_UNAVAILABLE" }, { status: 503, headers });
}

export async function GET(request: NextRequest) {
  try { const access = await labDashboardAccess(request); return NextResponse.json({ ok: true, sheets: await loadInHousePriceSheets(access) }, { headers }); }
  catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const access = await labDashboardAccess(request);
    if (Number(request.headers.get("content-length") || 0) > IN_HOUSE_MAX_BODY_BYTES) throw new LabError("This studio price sheet is too large.", 413, "IN_HOUSE_TOO_LARGE");
    const reader = request.body?.getReader();
    if (!reader) throw new LabError("Choose a complete studio price copy.");
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const result = await reader.read(); if (result.done) break;
      bytes += result.value.length;
      if (bytes > IN_HOUSE_MAX_BODY_BYTES) { await reader.cancel(); throw new LabError("This studio price sheet is too large.", 413, "IN_HOUSE_TOO_LARGE"); }
      chunks.push(result.value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new LabError("Use a complete JSON copy of the studio prices.", 400, "IN_HOUSE_INVALID"); }
    const action = parseInHousePriceSheetAction(body);
    return NextResponse.json({ ok: true, ...await performInHousePriceSheetAction(access, action) }, { headers });
  } catch (error) { return failure(error); }
}
