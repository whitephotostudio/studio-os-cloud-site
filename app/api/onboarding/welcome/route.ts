import { NextResponse } from "next/server";
import { z } from "zod";
import { createDashboardServiceClient } from "@/lib/dashboard-auth";
import { getClientIp, rateLimit } from "@/lib/rate-limit";
import { resendConfigured, sendResendEmail } from "@/lib/resend";
import { buildSignupWelcomeEmail } from "@/lib/signup-welcome-email";

const payloadSchema = z.object({
  userId: z.string().uuid(),
});

const SENT_AT_KEY = "studio_os_welcome_email_sent_at";
const MAX_SIGNUP_AGE_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const limit = await rateLimit(getClientIp(request), {
    namespace: "signup-welcome-email",
    limit: 8,
    windowSeconds: 60 * 60,
  });

  if (!limit.allowed) return new NextResponse(null, { status: 204 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success || !resendConfigured()) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const service = createDashboardServiceClient();
    const { data, error } = await service.auth.admin.getUserById(parsed.data.userId);
    const user = data.user;

    if (error || !user?.email) return new NextResponse(null, { status: 204 });

    const createdAt = Date.parse(user.created_at);
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > MAX_SIGNUP_AGE_MS) {
      return new NextResponse(null, { status: 204 });
    }

    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    if (typeof metadata[SENT_AT_KEY] === "string" && metadata[SENT_AT_KEY]) {
      return new NextResponse(null, { status: 204 });
    }

    const campaignSource =
      typeof metadata.campaign_source === "string" &&
      metadata.campaign_source.trim().toLowerCase() === "founding-100"
        ? "founding-100"
        : "organic";

    const email = buildSignupWelcomeEmail({
      fullName: typeof metadata.full_name === "string" ? metadata.full_name : null,
      businessName: typeof metadata.business_name === "string" ? metadata.business_name : null,
      campaignSource,
    });

    const sent = await sendResendEmail({
      to: user.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      fromName: "Harout at Studio OS Cloud",
      replyTo:
        process.env.WELCOME_REPLY_TO_EMAIL ||
        process.env.SUPPORT_EMAIL ||
        "harout@whitephoto.com",
      tags: [
        { name: "category", value: "signup-welcome" },
        { name: "campaign", value: campaignSource },
      ],
      idempotencyKey: `studio-os-signup-welcome-${user.id}`,
    });

    const sentAt = new Date().toISOString();
    const { error: updateError } = await service.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...metadata,
        [SENT_AT_KEY]: sentAt,
        studio_os_welcome_email_id: sent.id,
      },
    });

    if (updateError) {
      console.warn("[signup-welcome] sent but could not save delivery marker", updateError);
    }
  } catch (error) {
    console.warn("[signup-welcome]", error);
  }

  // Deliberately avoid exposing account existence or email delivery state.
  return new NextResponse(null, { status: 204 });
}
