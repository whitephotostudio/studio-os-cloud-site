import { NextRequest, NextResponse } from "next/server";
import { CollageAccessError, COLLAGE_UUID, collageDashboardAccess } from "@/lib/collage-server";
import { parseCollageOrderSnapshot, collageRecipeHash, renderCollageOrderSnapshot } from "@/lib/collage-production";
import { currentProductionOrders, productionFinancialRevision } from "@/lib/order-automation-auth";
import { rateLimit } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function GET(request: NextRequest) {
  try {
    const { service, user, photographerId } = await collageDashboardAccess(request);
    const limit = await rateLimit(user.id, { namespace: "collage-production-render", limit: 120, windowSeconds: 3600 });
    if (!limit.allowed) throw new CollageAccessError("Please wait before rendering more collage prints.", 429);
    const orderId = request.nextUrl.searchParams.get("orderId") || "", itemId = request.nextUrl.searchParams.get("itemId") || "";
    if (!COLLAGE_UUID.test(orderId) || !COLLAGE_UUID.test(itemId)) throw new CollageAccessError("Choose an exact collage order item.");
    const before = await currentProductionOrders(user.id, [orderId]);
    if (before.studio.id !== photographerId) throw new CollageAccessError("This order belongs to another studio.", 403);
    const item = await service.from("order_items").select("collage_snapshot").eq("order_id", orderId).eq("id", itemId).maybeSingle();
    if (item.error) throw item.error;
    if (!item.data?.collage_snapshot || item.data.collage_snapshot.photographerId !== photographerId) throw new CollageAccessError("This order item has no owned collage recipe.", 404);
    const recipe = parseCollageOrderSnapshot(item.data.collage_snapshot);
    const rendered = await renderCollageOrderSnapshot(recipe, service);
    const after = await currentProductionOrders(user.id, [orderId]);
    if (productionFinancialRevision(before.orders) !== productionFinancialRevision(after.orders)) throw new CollageAccessError("Payment changed during rendering. Refresh Orders before downloading.", 409);
    return new Response(new Uint8Array(rendered.bytes), { headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="collage-${orderId}-${itemId}.png"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Collage-Sha256": rendered.sha256,
      "X-Collage-Template-Hash": recipe.contentHash, "X-Collage-Recipe-Hash": collageRecipeHash(recipe), "X-Collage-Width": String(rendered.width), "X-Collage-Height": String(rendered.height), "X-Collage-Order-Id": orderId, "X-Collage-Item-Id": itemId, "X-Collage-Resolution-Warnings": String(rendered.warnings.length) } });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Collage output is temporarily unavailable." }, { status: error instanceof CollageAccessError ? error.status : 409, headers: { "Cache-Control": "private, no-store" } });
  }
}
