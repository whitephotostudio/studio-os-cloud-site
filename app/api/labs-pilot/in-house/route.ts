import { NextRequest, NextResponse } from "next/server";
import { isLabPilot } from "@/lib/labs/pilot";
import { performInHouseTestParentAction } from "@/lib/labs/in-house-orders-server";
import { IN_HOUSE_TEST_BODY_BYTES, parseInHouseTestParentAction } from "@/lib/labs/in-house-orders-validation";
import { readBoundedLabBody } from "@/lib/labs/orders-http";
import { LabError } from "@/lib/labs/validation";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
export async function POST(request: NextRequest) {
  if (!isLabPilot()) return NextResponse.json({ ok: false }, { status: 404, headers });
  try {
    const bytes = await readBoundedLabBody(request, IN_HOUSE_TEST_BODY_BYTES);
    let body: unknown; try { body = JSON.parse(bytes.toString("utf8")); } catch { throw new LabError("Use a complete private test request.", 400, "IN_HOUSE_TEST_INVALID"); }
    return NextResponse.json({ ok: true, ...await performInHouseTestParentAction(request, parseInHouseTestParentAction(body)) }, { headers });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof LabError ? error.message : "The private in-house test is temporarily unavailable.", code: error instanceof LabError ? error.code : "IN_HOUSE_TEST_UNAVAILABLE" }, { status: error instanceof LabError ? error.status : 503, headers });
  }
}
