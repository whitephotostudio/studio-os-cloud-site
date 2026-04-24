import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createDashboardServiceClient,
  resolveDashboardAuth,
} from "@/lib/dashboard-auth";
import { parseJson } from "@/lib/api-validation";
import { resendConfigured, sendResendEmail } from "@/lib/resend";
import { guardAgreement } from "@/lib/require-agreement";

export const dynamic = "force-dynamic";

function clean(v: string | null | undefined) {
  return (v ?? "").trim();
}

const NotifyBodySchema = z.object({
  orderId: z.string().min(1, "orderId is required."),
  recipientEmail: z
    .string()
    .min(1, "recipientEmail is required.")
    .email("recipientEmail must be a valid email."),
  subject: z.string().min(1, "subject is required.").max(200),
  headline: z.string().max(200).default(""),
  message: z.string().max(5000).default(""),
  newStatus: z.string().max(64).default(""),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await resolveDashboardAuth(request);
    if (!user) {
      return NextResponse.json({ ok: false, message: "Please sign in again." }, { status: 401 });
    }

    const parsed = await parseJson(request, NotifyBodySchema);
    if (!parsed.ok) return parsed.response;
    const { orderId, recipientEmail, subject, headline, message, newStatus } = parsed.data;

    if (!resendConfigured()) {
      return NextResponse.json({ ok: false, message: "Email sending is not configured." }, { status: 500 });
    }

    const service = createDashboardServiceClient();

    // Agreement gate — refuse to act for users who haven't accepted the
    // Studio OS Cloud legal agreement. Defense in depth behind the client
    // modal. Same pattern as upload-to-r2 / generate-thumbnails.
    {
      const guard = await guardAgreement({ service, userId: user.id });
      if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
    }

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

    // Build HTML email with photographer's branding
    const statusLabel = newStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
    <!-- Header with logo -->
    <div style="background:#111;padding:32px 40px;text-align:center;">
      ${logoHtml}
    </div>
    <!-- Icon -->
    <div style="text-align:center;padding:32px 40px 16px;">
      <div style="display:inline-block;width:48px;height:48px;border:2px solid #ddd;border-radius:8px;line-height:48px;font-size:20px;color:#999;">&#9993;</div>
    </div>
    <!-- Headline -->
    <div style="text-align:center;padding:0 40px 24px;">
      <div style="font-size:22px;font-weight:800;color:#111;">${escHtml(headline)}</div>
    </div>
    <!-- Message box -->
    <div style="margin:0 40px 32px;padding:20px 24px;background:#f9fafb;border-left:3px solid #111;border-radius:2px;">
      <div style="font-size:14px;color:#333;line-height:1.6;white-space:pre-wrap;">${escHtml(message)}</div>
    </div>
    <!-- Status badge -->
    <div style="text-align:center;padding:0 40px 32px;">
      <span style="display:inline-block;padding:6px 20px;background:#111;color:#fff;border-radius:4px;font-size:13px;font-weight:700;letter-spacing:0.04em;">${escHtml(statusLabel)}</span>
    </div>
    <!-- Footer with studio info -->
    <div style="padding:20px 40px;background:#f5f5f5;text-align:center;">
      <div style="font-size:11px;color:#999;">&copy; ${new Date().getFullYear()} ${escHtml(businessName)}</div>
      ${footerParts.length > 0 ? `<div style="font-size:11px;color:#aaa;margin-top:6px;line-height:1.5;">${footerParts.join("<br/>")}</div>` : ""}
    </div>
  </div>
</body>
</html>`;

    await sendResendEmail({
      to: recipientEmail,
      subject,
      html,
      fromName: businessName,
      replyTo: replyTo || null,
      tags: [
        { name: "type", value: "order-status" },
        { name: "order_id", value: orderId },
      ],
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Order notify error:", error);
    return NextResponse.json(
      { ok: false, message: "Failed to send email." },
      { status: 500 }
    );
  }
}

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
