import { NextRequest, NextResponse } from "next/server";
import { labOrderAccess, labOrdersWorkspace, performLabOrderAction } from "@/lib/labs/orders-server";
import { labOrderFailure, readLabOrderRequest } from "@/lib/labs/orders-http";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  try { const access = await labOrderAccess(request, "studio"); return NextResponse.json({ ok: true, ...await labOrdersWorkspace(access, request) }, { headers }); }
  catch (error) { return labOrderFailure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const access = await labOrderAccess(request, "studio");
    const order = await performLabOrderAction(access, await readLabOrderRequest(request));
    return NextResponse.json({ ok: true, order, ...await labOrdersWorkspace(access, request) }, { headers });
  } catch (error) { return labOrderFailure(error); }
}
