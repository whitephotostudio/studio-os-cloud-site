import { NextRequest, NextResponse } from "next/server";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { composeBackdropImage, type BackdropCompositeSelection } from "@/lib/backdrop-composites";
import { cartSnapshotToOrderItems } from "@/lib/order-display";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

async function resolveBackdrop(
  service: { from: (table: string) => any },
  photographerId: string,
  backdrop: BackdropCompositeSelection | null | undefined,
) {
  if (clean(backdrop?.image_url) || clean(backdrop?.imageUrl)) return backdrop ?? null;
  const id = clean(backdrop?.id);
  if (!id) return backdrop ?? null;

  const { data, error } = await service
    .from("backdrop_catalog")
    .select("id,name,image_url,tier,price_cents")
    .eq("photographer_id", photographerId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return backdrop ?? null;
  return {
    ...backdrop,
    id: clean((data as Record<string, unknown>).id as string),
    name: clean((data as Record<string, unknown>).name as string),
    image_url: clean((data as Record<string, unknown>).image_url as string),
    tier: clean((data as Record<string, unknown>).tier as string),
    price_cents: Number((data as Record<string, unknown>).price_cents ?? 0) || 0,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json({ ok: false, message: "Please sign in again." }, { status: 401 });
    }

    const orderId = clean(request.nextUrl.searchParams.get("orderId"));
    const itemIndex = Number(request.nextUrl.searchParams.get("item"));
    if (!orderId || !Number.isInteger(itemIndex) || itemIndex < 0) {
      return NextResponse.json({ ok: false, message: "Missing order item." }, { status: 400 });
    }

    const service = createDashboardServiceClient();
    const { data: pgRow } = await service
      .from("photographers")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    const photographerId = clean((pgRow as Record<string, unknown> | null)?.id as string);
    if (!photographerId) {
      return NextResponse.json({ ok: false, message: "Photographer not found." }, { status: 404 });
    }

    const { data: order, error: orderError } = await service
      .from("orders")
      .select("id,photographer_id,cart_snapshot")
      .eq("id", orderId)
      .eq("photographer_id", photographerId)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) {
      return NextResponse.json({ ok: false, message: "Order not found." }, { status: 404 });
    }

    const items = cartSnapshotToOrderItems((order as { cart_snapshot?: unknown }).cart_snapshot);
    const item = items[itemIndex];
    if (!item?.sku || !item.backdrop) {
      return NextResponse.json({ ok: false, message: "Composite unavailable." }, { status: 404 });
    }

    const backdrop = await resolveBackdrop(service, photographerId, item.backdrop);
    const composite = await composeBackdropImage({
      originalUrlOrKey: item.sku,
      backdrop,
      orientation: item.orientation,
    });
    if (!composite) {
      return NextResponse.json({ ok: false, message: "Composite unavailable." }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(composite.buffer), {
      status: 200,
      headers: {
        "content-type": composite.contentType,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[dashboard:orders:composite]", error);
    return NextResponse.json(
      { ok: false, message: "Failed to build backdrop preview." },
      { status: 500 },
    );
  }
}
