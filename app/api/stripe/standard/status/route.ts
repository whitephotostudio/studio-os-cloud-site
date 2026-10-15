import { NextRequest, NextResponse } from "next/server";
import { standardConnectionStatus, standardConnectErrorResponse } from "@/lib/stripe-standard-connect";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { return NextResponse.json(await standardConnectionStatus(request), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { const failure = standardConnectErrorResponse(error); return NextResponse.json(failure.body, { status: failure.status, headers: { "Cache-Control": "no-store" } }); }
}
