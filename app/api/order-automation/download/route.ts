import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  productionKey,
  readProductionJson,
} from "@/lib/order-automation-storage";
import {
  currentProductionOrders,
  productionFinancialRevision,
} from "@/lib/order-automation-auth";
import { r2PresignedGetUrl } from "@/lib/r2-signed-urls";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const owner = request.nextUrl.searchParams.get("owner") || "",
      id = request.nextUrl.searchParams.get("batch") || "",
      token = request.nextUrl.searchParams.get("token") || "";
    if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(token))
      throw Error();
    const record = await readProductionJson<{
      owner: string;
      token: string;
      expiresAt: number;
      state: string;
      zipKey: string;
      financialRevision: string;
      orders: { cloudId: string }[];
    }>(productionKey(owner, `batches/${id}.json`));
    if (
      !record ||
      record.value.owner !== owner ||
      record.value.state !== "sent" ||
      record.value.expiresAt < Date.now() ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(record.value.token))
    )
      throw Error();
    const current = await currentProductionOrders(
      owner,
      record.value.orders.map((o) => o.cloudId),
    );
    if (
      productionFinancialRevision(current.orders) !==
      record.value.financialRevision
    )
      throw Error();
    const url = r2PresignedGetUrl(record.value.zipKey, 60, {
      allowOrderAutomation: true,
    });
    if (!url) throw Error();
    return NextResponse.redirect(url, {
      status: 302,
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message:
          "This private lab link is unavailable or expired. Contact the photographer.",
      },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
}
