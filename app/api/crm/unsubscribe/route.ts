import { NextRequest, NextResponse } from "next/server";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import {
  crmUnsubscribeEmailMatches,
  verifyCrmUnsubscribeToken,
} from "@/lib/crm-unsubscribe";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function htmlPage(title: string, message: string, form = "") {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,sans-serif;max-width:640px;margin:64px auto;padding:0 20px;color:#172033"><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${form}</main></body></html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function invalidPage() {
  return htmlPage(
    "Link unavailable",
    "This unsubscribe link is invalid or has expired. Please contact the photographer directly.",
  );
}

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!verifyCrmUnsubscribeToken(token)) return invalidPage();
  const form = `<form method="post" action="/api/crm/unsubscribe"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit" style="border:0;border-radius:8px;background:#172033;color:white;padding:12px 18px;font:inherit;cursor:pointer">Unsubscribe</button></form>`;
  return htmlPage(
    "Stop these emails?",
    "Confirm to stop relationship and promotional CRM emails from this photographer.",
    form,
  );
}

async function requestToken(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
    return typeof body?.token === "string" ? body.token : "";
  }
  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  return typeof token === "string" ? token : "";
}

export async function POST(request: NextRequest) {
  const wantsJson = (request.headers.get("content-type") ?? "").includes("application/json");
  const token = await requestToken(request);
  const payload = verifyCrmUnsubscribeToken(token);
  if (!payload) {
    if (wantsJson) {
      return NextResponse.json({ ok: false, message: "Invalid or expired link." }, { status: 400 });
    }
    return invalidPage();
  }

  try {
    const service = createDashboardServiceClient();
    const { data: contact, error: contactError } = await service
      .from("crm_contacts")
      .select("id,email,email_normalized")
      .eq("id", payload.c)
      .eq("photographer_id", payload.p)
      .maybeSingle();
    if (contactError) throw contactError;
    const email = typeof contact?.email_normalized === "string"
      ? contact.email_normalized
      : typeof contact?.email === "string"
        ? contact.email.trim().toLowerCase()
        : "";
    if (!contact || !email || !crmUnsubscribeEmailMatches(email, payload.h)) {
      if (wantsJson) {
        return NextResponse.json({ ok: false, message: "Invalid or expired link." }, { status: 400 });
      }
      return invalidPage();
    }

    const { data: applied, error: unsubscribeError } = await service.rpc(
      "crm_apply_signed_unsubscribe",
      {
        p_photographer_id: payload.p,
        p_contact_id: payload.c,
        p_email: email,
      },
    );
    if (unsubscribeError) throw unsubscribeError;
    if (applied !== true) {
      if (wantsJson) {
        return NextResponse.json({ ok: false, message: "Invalid or expired link." }, { status: 400 });
      }
      return invalidPage();
    }

    if (wantsJson) return NextResponse.json({ ok: true, unsubscribed: true });
    return htmlPage(
      "You are unsubscribed",
      "Relationship and promotional emails from this photographer have been stopped.",
    );
  } catch (error) {
    console.error("[crm:unsubscribe]", error);
    if (wantsJson) {
      return NextResponse.json({ ok: false, message: "Unable to unsubscribe right now." }, { status: 500 });
    }
    return htmlPage(
      "Please try again",
      "We could not save your request right now. No confirmation was recorded.",
    );
  }
}
