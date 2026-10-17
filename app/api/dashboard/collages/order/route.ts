import { NextRequest, NextResponse } from "next/server";
import { CollageAccessError, COLLAGE_UUID, collageDashboardAccess } from "@/lib/collage-server";
import { parseCollageOrderSnapshot } from "@/lib/collage-production";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const { service, photographerId } = await collageDashboardAccess(request);
    const orderId = request.nextUrl.searchParams.get("orderId") || "";
    if (!COLLAGE_UUID.test(orderId)) throw new CollageAccessError("Choose an exact collage order.");
    // Recipes are owner-visible for review before payment. Original image
    // rendering remains behind the separate paid production endpoint.
    const order = await service.from("orders").select("id").eq("id", orderId).eq("photographer_id", photographerId).maybeSingle();
    if (order.error) throw order.error;
    if (!order.data) throw new CollageAccessError("Order not found for this studio.", 404);
    const items = await service.from("order_items").select("id,collage_snapshot").eq("order_id", orderId);
    if (items.error && ["42703", "PGRST204"].includes(items.error.code) && (!items.error.message || /collage_snapshot/i.test(items.error.message))) {
      return NextResponse.json({ ok: true, preview: true, prints: [] }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (items.error) throw items.error;
    const prints = (items.data ?? []).filter(item => item.collage_snapshot != null).map(item => {
      const selection = parseCollageOrderSnapshot(item.collage_snapshot);
      if (selection.photographerId !== photographerId) throw new CollageAccessError("An order collage recipe belongs to another studio.", 409);
      return { id: item.id as string, selection };
    });
    return NextResponse.json({ ok: true, preview: true, prints }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof CollageAccessError ? error.message : "Order collage recipes are temporarily unavailable." }, { status: error instanceof CollageAccessError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
