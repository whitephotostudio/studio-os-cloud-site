// PIN recovery email template.  Matches the look-and-feel of the existing
// gallery-share / order-notification emails (lib/event-gallery-email.ts,
// lib/order-notification-email.ts): dark header band, light card body,
// black CTA button, plain-text fallback for clients that block HTML.
//
// Sender + send mechanics live in lib/resend.ts.

export type PinRecoveryEmailInput = {
  studentName: string;
  schoolOrEventLabel: string;
  recoveryUrl: string;
  studioName: string;
  studioContactEmail?: string | null;
};

export function buildPinRecoveryEmail(input: PinRecoveryEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const studio = input.studioName?.trim() || "Studio OS Cloud";
  const studentName = input.studentName?.trim() || "your child";
  const galleryLabel = input.schoolOrEventLabel?.trim() || "the gallery";
  const contactLine = input.studioContactEmail
    ? `If you didn't request this, just ignore this email — nothing will change.  Reply to ${input.studioContactEmail} if you have questions.`
    : `If you didn't request this, just ignore this email — nothing will change.`;

  const subject = `Your gallery link — ${studentName} · ${galleryLabel}`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111111;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 4px 16px rgba(15,23,42,0.06);">
            <tr>
              <td style="background:#111111;color:#ffffff;padding:22px 24px;">
                <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:800;opacity:0.8;">${escapeHtml(studio)}</div>
                <div style="font-size:18px;font-weight:900;margin-top:4px;line-height:1.3;">Your gallery link is ready</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 12px 0;font-size:15px;line-height:1.55;color:#111827;">
                  Hi — you (or someone using your email) asked to recover access to
                  <strong>${escapeHtml(studentName)}</strong>'s gallery
                  for <strong>${escapeHtml(galleryLabel)}</strong>.
                </p>
                <p style="margin:0 0 18px 0;font-size:14px;line-height:1.55;color:#374151;">
                  Tap the button below to open the gallery directly.  This link
                  works once and expires in 24 hours.
                </p>
                <p style="margin:0 0 22px 0;">
                  <a href="${escapeAttr(input.recoveryUrl)}"
                     style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:800;font-size:14px;letter-spacing:0.02em;">
                    Open gallery →
                  </a>
                </p>
                <p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:#6b7280;">
                  If the button doesn't work, copy and paste this link into your browser:
                </p>
                <p style="margin:0 0 22px 0;font-size:12px;line-height:1.4;color:#6b7280;word-break:break-all;">
                  ${escapeHtml(input.recoveryUrl)}
                </p>
                <hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0;" />
                <p style="margin:0;font-size:12px;line-height:1.5;color:#6b7280;">
                  ${escapeHtml(contactLine)}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 24px 22px;background:#fafafa;">
                <p style="margin:0;font-size:11px;line-height:1.5;color:#9ca3af;text-align:center;">
                  Sent by <strong>${escapeHtml(studio)}</strong> via Studio OS Cloud
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Your gallery link — ${studentName} · ${galleryLabel}`,
    "",
    `Hi — you (or someone using your email) asked to recover access to ${studentName}'s gallery for ${galleryLabel}.`,
    "",
    "Open the gallery here (this link works once and expires in 24 hours):",
    input.recoveryUrl,
    "",
    contactLine,
    "",
    `— ${studio}`,
  ].join("\n");

  return { subject, html, text };
}

// ── Helpers ───────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
