import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Temporary diagnostic endpoint: the mobile push-register component beacons its
// progress here so we can see in the Vercel runtime logs exactly where APNs
// registration succeeds or fails. No auth (we want the beacon regardless of auth
// state) and it only logs — safe to remove once push is verified working.
export async function POST(request: NextRequest) {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    /* ignore */
  }
  console.log("[push-debug]", JSON.stringify(body));
  return NextResponse.json({ ok: true });
}
