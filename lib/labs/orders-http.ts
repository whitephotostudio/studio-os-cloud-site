import { NextRequest, NextResponse } from "next/server";
import { parseLabOrderAction } from "./orders-validation";
import { LabError } from "./validation";

export function labOrderFailure(error: unknown) {
  return NextResponse.json({ ok: false, message: error instanceof LabError ? error.message : "The lab order service is temporarily unavailable.", code: error instanceof LabError ? error.code : "LAB_ORDERS_UNAVAILABLE" }, { status: error instanceof LabError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
}

export async function readBoundedLabBody(request: NextRequest, maximum: number) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maximum) throw new LabError("This lab request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new LabError("Use a valid lab request.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength; if (length > maximum) { await reader.cancel(); throw new LabError("This lab request is too large.", 413); } chunks.push(part.value); }
  return Buffer.concat(chunks);
}

export async function readLabOrderRequest(request: NextRequest) {
  const bytes = await readBoundedLabBody(request, 64_000);
  try { return parseLabOrderAction(JSON.parse(bytes.toString("utf8"))); }
  catch (error) { if (error instanceof LabError) throw error; throw new LabError("Use a valid lab order request."); }
}
