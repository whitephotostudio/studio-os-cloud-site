import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { resendConfigured, sendResendEmail } from "@/lib/resend";

export const dynamic = "force-dynamic";

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const EmailBodySchema = z.object({
  recipients: z.array(z.string().email().max(320)).max(5000),
  subject: z.string().min(1).max(500),
  headline: z.string().min(1).max(500),
  message: z.string().max(10_000).default(""),
});

type EmailBody = z.infer<typeof EmailBodySchema>;

/**
 * POST /api/dashboard/visitors/email
 * Send a mass promotional email to selected visitor emails.
 * Uses the photographer's branding.
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json({ ok: false, message: "Please sign in again." }, { status: 401 });
    }

    const parsed = await parseJson(request, EmailBodySchema);
    if (!parsed.ok) return parsed.response;
    const { recipients, subject, headline, message } = parsed.data;

    if (!recipients?.length || !subject || !headline) {
      return NextResponse.json({ ok: false, message: "Missing required fields." }, { status: 400 });
    }

    if (!resendConfigured()) {
      return NextResponse.json({ ok: false, message: "Email sending is not configured." }, { status: 500 });
    }

    const service = createDashboardServiceClient();

    // Get photographer branding
    const { data: pgRow } = await service
      .from("photographers")
      .select("id, business_name, studio_email, billing_email, logo_url, studio_phone, studio_address")
      .eq("user_id", user.id)
      .maybeSingle();

    const pg = pgRow as Record<string, unknown> | null;
    const businessName = clean(pg?.business_name as string) || "Studio OS";
    const replyTo = clean(pg?.studio_email as string) || clean(pg?.billing_email as string) || "";
    const logoUrl = clean(pg?.logo_url as string);
    const studioPhone = clean(pg?.studio_phone as string);
    const studioEmail = clean(pg?.studio_email as string) || clean(pg?.billing_email as string) || "";
    const studioAddress = clean(pg?.studio_address as string);

    const logoHtml = logoUrl
      ? `<img src="${escHtml(logoUrl)}" alt="${escHtml(businessName)}" style="max-height:60px;max-width:220px;" />`
      : `<div style="font-size:24px;font-weight:900;color:#fff;letter-spacing:0.02em;">${escHtml(businessName)}</div>`;

    const footerParts: string[] = [];
    if (studioAddress) footerParts.push(escHtml(studioAddress));
    if (studioPhone) footerParts.push(escHtml(studioPhone));
    if (studioEmail) footerParts.push(escHtml(studioEmail));

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:4px;overflow:hidden;">
    <div style="background:#111;padding:32px 40px;text-align:center;">
      ${logoHtml}
    </div>
    <div style="text-align:center;padding:32px 40px 16px;">
      <div style="font-size:22px;font-weight:800;color:#111;">${escHtml(headline)}</div>
    </div>
    <div style="margin:0 40px 32px;padding:20px 24px;background:#f9fafb;border-left:3px solid #111;border-radius:2px;">
      <div style="font-size:14px;color:#333;line-height:1.6;white-space:pre-wrap;">${escHtml(message)}</div>
    </div>
    <div style="padding:20px 40px;background:#f5f5f5;text-align:center;">
      <div style="font-size:11px;color:#999;">&copy; ${new Date().getFullYear()} ${escHtml(businessName)}</div>
      ${footerParts.length > 0 ? `<div style="font-size:11px;color:#aaa;margin-top:6px;line-height:1.5;">${footerParts.join("<br/>")}</div>` : ""}
    </div>
  </div>
</body>
</html>`;

    // Send emails in batches of 10
    const BATCH = 10;
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < recipients.length; i += BATCH) {
      const batch = recipients.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map((email) =>
          sendResendEmail({
            to: email,
            subject,
            html,
            fromName: businessName,
            replyTo: replyTo || null,
            tags: [{ name: "type", value: "mass-promo" }],
          }),
        ),
      );
      for (const r of results) {
        if (r.status === "fulfilled") sent++;
        else failed++;
      }
    }

    return NextResponse.json({ ok: true, sent, failed, total: recipients.length });
  } catch (error) {
    console.error("Mass email error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to send emails." },
      { status: 500 },
    );
  }
}
