import { NextRequest, NextResponse } from "next/server";
import { rollbackStandardConnection, standardConnectErrorResponse } from "@/lib/stripe-standard-connect";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try { return NextResponse.json(await rollbackStandardConnection(request)); }
  catch (error) { const failure = standardConnectErrorResponse(error); return NextResponse.json(failure.body, { status: failure.status }); }
}
