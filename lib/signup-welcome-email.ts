import { FREE_TRIAL_DAYS } from "@/lib/trial-config";

type SignupWelcomeEmailInput = {
  fullName?: string | null;
  businessName?: string | null;
  campaignSource?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resolveFirstName(fullName: string | null | undefined) {
  const first = clean(fullName).split(/\s+/)[0];
  return first || "there";
}

export function buildSignupWelcomeEmail(input: SignupWelcomeEmailInput) {
  const firstName = resolveFirstName(input.fullName);
  const businessName = clean(input.businessName);
  const founding100 = clean(input.campaignSource).toLowerCase() === "founding-100";
  const escapedFirstName = escapeHtml(firstName);
  const escapedBusinessName = escapeHtml(businessName);
  const businessSentence = businessName
    ? ` I’m glad to welcome ${businessName} to the platform.`
    : "";
  const businessSentenceHtml = businessName
    ? ` I’m glad to welcome <strong>${escapedBusinessName}</strong> to the platform.`
    : "";
  const trialSentence = founding100
    ? `You’re registered for the Founding 100 and eligible for the full ${FREE_TRIAL_DAYS}-day trial with personal setup help.`
    : `Your full ${FREE_TRIAL_DAYS}-day trial begins after you confirm your email and sign in.`;

  const subject = "Welcome to Studio OS Cloud — let’s get your trial started";
  const text = [
    `Hi ${firstName},`,
    "",
    `Welcome to Studio OS Cloud! I saw that you created your account, and I wanted to personally reach out and help you get started.${businessSentence}`,
    "",
    trialSentence,
    "",
    "First, confirm your email using the verification message from Studio OS Cloud. Then sign in to open your dashboard and start setting up your workflow.",
    "",
    "If you’d like personal onboarding, reply to this email with a good time to connect—or tell me which part of your photography workflow you’d like to improve first.",
    "",
    "Best,",
    "Harout",
    "Studio OS Cloud",
    "https://www.studiooscloud.com",
  ].join("\n");

  const html = `
    <div style="margin:0;background:#f5f7fb;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#111827">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden">
        <div style="background:#0f172a;padding:24px 28px;color:#ffffff">
          <div style="font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#cbd5e1">Studio OS Cloud</div>
          <div style="margin-top:8px;font-size:26px;font-weight:700;line-height:1.25">Welcome—let’s get your trial started</div>
        </div>
        <div style="padding:30px 28px;font-size:16px;line-height:1.7">
          <p style="margin:0 0 18px">Hi ${escapedFirstName},</p>
          <p style="margin:0 0 18px">Welcome to Studio OS Cloud! I saw that you created your account, and I wanted to personally reach out and help you get started.${businessSentenceHtml}</p>
          <p style="margin:0 0 18px"><strong>${escapeHtml(trialSentence)}</strong></p>
          <p style="margin:0 0 22px">First, confirm your email using the verification message from Studio OS Cloud. Then sign in to open your dashboard and start setting up your workflow.</p>
          <p style="margin:0 0 24px">
            <a href="https://www.studiooscloud.com/sign-in" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Sign in to Studio OS Cloud</a>
          </p>
          <p style="margin:0 0 18px">If you’d like personal onboarding, reply to this email with a good time to connect—or tell me which part of your photography workflow you’d like to improve first.</p>
          <p style="margin:24px 0 0">Best,<br><strong>Harout</strong><br>Studio OS Cloud</p>
        </div>
      </div>
    </div>
  `.trim();

  return { subject, text, html };
}
