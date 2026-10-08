import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { cartReminderLinkEmailMatches, verifyAbandonedCartStopToken } from "@/lib/abandoned-cart-reminder-links";
import { getClientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

function page(title: string, message: string, form = "", status = 200) {
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:580px;margin:64px auto;padding:0 24px;color:#172033;line-height:1.6"><main><h1>${escape(title)}</h1><p>${escape(message)}</p>${form}</main></body></html>`, {
    status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" },
  });
}

function reply(json: boolean, ok: boolean, title: string, message: string, status = 200) {
  return json ? NextResponse.json({ ok, message }, { status, headers }) : page(title, message, "", status);
}

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!verifyAbandonedCartStopToken(token)) return page("Link unavailable", "This link is invalid or has expired. You can discard an unfinished checkout in your gallery’s order history.", "", 400);
  // Email security scanners may follow links. Only an explicit POST stops mail.
  const form = `<form method="post" action="/api/portal/orders/stop-reminders"><input type="hidden" name="token" value="${escape(token)}"><input type="hidden" name="confirmed" value="true"><button type="submit" style="border:0;border-radius:8px;background:#172033;color:white;padding:12px 18px;font:inherit;cursor:pointer">Stop reminders</button></form>`;
  return page("Stop checkout reminders", "Confirm to stop reminder emails for this unfinished checkout and older attempts in the same gallery. Your completed orders stay available.", form);
}

export async function POST(request: NextRequest) {
  const json = (request.headers.get("content-type") ?? "").includes("application/json");
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return reply(json, false, "Request unavailable", "Invalid request origin.", 403);
  const limit = await rateLimit(getClientIp(request), { namespace: "cart-reminder-stop", limit: 8, windowSeconds: 60 });
  if (!limit.allowed) return reply(json, false, "Try again shortly", "Too many requests. Please try again shortly.", 429);
  let token = "";
  let confirmed = false;
  if (json) {
    const body = await request.json().catch(() => null);
    token = typeof body?.token === "string" ? body.token : "";
    confirmed = body?.confirmed === true;
  } else {
    const body = await request.formData().catch(() => null);
    token = typeof body?.get("token") === "string" ? body.get("token") as string : "";
    confirmed = body?.get("confirmed") === "true";
  }
  const payload = confirmed ? verifyAbandonedCartStopToken(token) : null;
  if (!payload) return reply(json, false, "Link unavailable", "This link is invalid or has expired.", 400);
  try {
    const service = createDashboardServiceClient();
    const { data: order, error } = await service.from("orders")
      .select("id,photographer_id,customer_email,parent_email,status")
      .eq("id", payload.o).eq("photographer_id", payload.p).maybeSingle();
    if (error) throw new Error("Order lookup unavailable");
    const email = (order?.customer_email?.trim() || order?.parent_email?.trim() || "").toLowerCase();
    if (!order || !email || !cartReminderLinkEmailMatches(email, payload.h)) {
      return reply(json, false, "Link unavailable", "This link is invalid or has expired.", 400);
    }
    const { data: stopped, error: stopError } = await service.rpc("stop_abandoned_cart_reminders", {
      p_order_id: order.id, p_recipient_email: email,
    });
    if (stopError) throw new Error("Stop request unavailable");
    if (stopped !== true) {
      return reply(json, false, "Checkout changed", "This checkout has changed. Please review its current status in your gallery.", 409);
    }
    return reply(json, true, "Reminders stopped", "You will no longer receive reminders for this checkout and older attempts in the same gallery. Your completed orders stay available.");
  } catch {
    return reply(json, false, "Please try again", "We could not save your request. Please try again shortly.", 503);
  }
}
