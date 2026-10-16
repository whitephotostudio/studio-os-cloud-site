import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isLabPilot } from "@/lib/labs/pilot";
import { labDashboardAccess } from "@/lib/labs/server";
import { loadInHouseTestOrder } from "@/lib/labs/in-house-orders-server";
import { readInHouseSampleAsset } from "@/lib/labs/in-house-sample-assets";
import { LabError } from "@/lib/labs/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };

export async function GET(request: NextRequest) {
  if (!isLabPilot()) return NextResponse.json({ ok: false }, { status: 404, headers });
  try {
    const access = await labDashboardAccess(request);
    const orderId = request.nextUrl.searchParams.get("orderId") || "";
    const fileId = request.nextUrl.searchParams.get("file") || "";
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(orderId) ||
        !["sample-8x10", "sample-5x7", "manifest"].includes(fileId)) throw new LabError("Choose a saved test order and its sample file.", 400);
    const order = await loadInHouseTestOrder(access, orderId);
    if (order.snapshot.assets.length !== 2) throw new LabError("The saved sample print manifest is incomplete.", 409);
    const files = await Promise.all(order.snapshot.assets.map(async saved => {
      const fixed = await readInHouseSampleAsset(saved.id);
      const expected = { ...fixed.asset, quantity: fixed.asset.quantity * order.snapshot.quantity };
      if (Object.keys(expected).some(key => expected[key as keyof typeof expected] !== saved[key as keyof typeof saved])) {
        throw new LabError("This sample file no longer matches the saved order. Refresh before downloading.", 409);
      }
      return { ...fixed, saved };
    }));
    const reference = order.reference.replace(/[^a-zA-Z0-9_-]/g, "");
    if (fileId === "manifest") {
      const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, testOnly: true, reference: order.reference,
        status: order.status, gallery: order.snapshot.galleryName, studio: order.snapshot.studioName,
        package: order.snapshot.offer.name, packageQuantity: order.snapshot.quantity,
        currency: order.snapshot.currency, testSubtotalMinor: order.snapshot.subtotalMinor,
        paymentCollectedMinor: 0, fulfillment: "in_house", delivery: "pickup",
        totalPrintQuantity: files.reduce((sum, file) => sum + file.saved.quantity, 0),
        files: files.map(file => file.saved),
        note: "Synthetic sample artwork only. No physical printing or payment was performed.",
      }, null, 2) + "\n");
      return new Response(bytes, { headers: { ...headers, "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${reference}-sample-print-manifest.json"`, "Content-Length": String(bytes.length) } });
    }
    const selected = files.find(file => file.saved.id === fileId);
    if (!selected) throw new LabError("This sample print is not part of the saved order.", 404);
    return new Response(new Uint8Array(selected.bytes), { headers: { ...headers, "Content-Type": "image/jpeg",
      "Content-Length": String(selected.bytes.length),
      "Content-Disposition": `attachment; filename="${reference}-${selected.saved.quantity}x-${selected.saved.id}.jpg"` } });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof LabError ? error.message : "The verified sample file is temporarily unavailable." },
      { status: error instanceof LabError ? error.status : 503, headers });
  }
}
