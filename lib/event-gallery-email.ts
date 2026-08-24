import {
  EventGalleryShareSettings,
  defaultEventGalleryShareSettings,
} from "@/lib/event-gallery-settings";
import { signedPrivateMediaReference } from "@/lib/private-media-references";

const EMAIL_COVER_MEDIA_TTL_SECONDS = 7 * 24 * 60 * 60;

export type EventEmailProject = {
  id: string;
  title?: string | null;
  client_name?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  email_required?: boolean | null;
  cover_photo_url?: string | null;
  gallery_slug?: string | null;
};

export type SchoolEmailGallery = {
  id: string;
  school_name?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  email_required?: boolean | null;
  cover_photo_url?: string | null;
  gallery_slug?: string | null;
};

export type EventEmailPhotographer = {
  business_name?: string | null;
  studio_email?: string | null;
};

type EventEmailContentInput = {
  project: EventEmailProject;
  photographer?: EventEmailPhotographer | null;
  share?: Partial<EventGalleryShareSettings> | null;
  origin: string;
  previewText?: string;
  overrideSubject?: string | null;
  overrideMessage?: string | null;
  ctaLabel?: string | null;
};

type SchoolEmailContentInput = {
  school: SchoolEmailGallery;
  photographer?: EventEmailPhotographer | null;
  share?: Partial<EventGalleryShareSettings> | null;
  origin: string;
  previewText?: string;
  overrideSubject?: string | null;
  overrideMessage?: string | null;
  ctaLabel?: string | null;
  studentName?: string | null;
  studentPin?: string | null;
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
    .replaceAll("'", "&#39;");
}

function normalizedAccessMode(value: string | null | undefined) {
  const raw = clean(value).toLowerCase();
  if (!raw) return "public";
  if (raw === "pin" || raw === "protected" || raw === "private") return "pin";
  return raw;
}

export function eventProjectName(project: EventEmailProject) {
  return clean(project.title) || clean(project.client_name) || "Your gallery";
}

// Branded host for all client-facing gallery links. Using this (instead of the
// request origin) guarantees preview hosts like *.vercel.app never leak into
// the emails we send to clients.
const PUBLIC_GALLERY_HOST = "https://www.studiooscloud.com";

// Resolve the base URL for a client-facing link. Always the branded host in
// production; local development (localhost) keeps its own origin so links work
// while testing.
function publicLinkBase(origin: string) {
  const trimmed = clean(origin).replace(/\/$/, "");
  if (/^https?:\/\/localhost(:\d+)?$/i.test(trimmed)) return trimmed;
  return PUBLIC_GALLERY_HOST;
}

export function eventGalleryEntryUrl(
  origin: string,
  projectId: string,
  slug?: string | null,
) {
  const base = publicLinkBase(origin);
  const cleanSlug = clean(slug).toLowerCase();
  // Short, clean link (no internal IDs) when a slug exists; long form otherwise.
  if (cleanSlug) return `${base}/g/${encodeURIComponent(cleanSlug)}`;
  return `${base}/parents?mode=event&project=${encodeURIComponent(projectId)}`;
}

export function schoolGalleryEntryUrl(
  origin: string,
  schoolId: string,
  slug?: string | null,
) {
  const base = publicLinkBase(origin);
  const cleanSlug = clean(slug).toLowerCase();
  if (cleanSlug) return `${base}/g/${encodeURIComponent(cleanSlug)}`;
  return `${base}/parents?mode=school&school=${encodeURIComponent(schoolId)}`;
}

export function eventAccessSummary(project: EventEmailProject) {
  const accessPin = clean(project.access_pin);
  if (normalizedAccessMode(project.access_mode) === "pin" && accessPin) {
    return `Access PIN: ${accessPin}`;
  }
  return "Access PIN: Use the PIN provided by your photographer.";
}

export function eventEmailRequirementSummary(project: EventEmailProject) {
  return project.email_required === false
    ? "Email required: Optional unless your photographer asks for it."
    : "Email required: Enter the invited email address when opening the gallery.";
}

export function schoolGalleryName(school: SchoolEmailGallery) {
  return clean(school.school_name) || "Your gallery";
}

export function schoolAccessSummary(
  studentPin?: string | null,
  studentName?: string | null,
) {
  const pin = clean(studentPin);
  const name = clean(studentName);
  if (pin) {
    return name
      ? `${name}'s private gallery PIN: ${pin}`
      : `Your private student gallery PIN: ${pin}`;
  }
  return "Access PIN: Use the PIN from your photo envelope or the one provided by your photographer.";
}

export function schoolEmailRequirementSummary() {
  return "Email required: Enter your email when opening the gallery.";
}

export function eventReplyTo(photographer?: EventEmailPhotographer | null) {
  const studioEmail = clean(photographer?.studio_email);
  return studioEmail || null;
}

export function eventFromName(photographer?: EventEmailPhotographer | null) {
  return clean(photographer?.business_name) || "WhitePhoto";
}

export function buildGalleryShareEmail(input: EventEmailContentInput) {
  const projectName = eventProjectName(input.project);
  const subject =
    clean(input.overrideSubject) ||
    clean(input.share?.emailSubject) ||
    defaultEventGalleryShareSettings.emailSubject;
  const headline =
    clean(input.share?.emailHeadline) ||
    projectName;
  const buttonLabel =
    clean(input.ctaLabel) ||
    clean(input.share?.emailButtonLabel) ||
    defaultEventGalleryShareSettings.emailButtonLabel;
  const message =
    clean(input.overrideMessage) ||
    clean(input.share?.emailMessage) ||
    defaultEventGalleryShareSettings.emailMessage;
  const galleryUrl = eventGalleryEntryUrl(
    input.origin,
    input.project.id,
    input.project.gallery_slug,
  );
  const accessSummary = eventAccessSummary(input.project);
  const emailRequirement = eventEmailRequirementSummary(input.project);
  const studioName = eventFromName(input.photographer);
  const previewText = clean(input.previewText);
  const coverUrl = signedPrivateMediaReference(
    input.project.cover_photo_url,
    EMAIL_COVER_MEDIA_TTL_SECONDS,
  );
  const textLines = [
    headline,
    "",
    message,
    "",
    `Gallery link: ${galleryUrl}`,
    accessSummary,
    emailRequirement,
    "",
    `${buttonLabel}: ${galleryUrl}`,
  ].filter(Boolean);

  const messageHtml = escapeHtml(message).replaceAll("\n", "<br />");
  const accessHtml = escapeHtml(accessSummary);
  const emailRequirementHtml = escapeHtml(emailRequirement);
  const galleryUrlHtml = escapeHtml(galleryUrl);

  return {
    subject,
    text: textLines.join("\n"),
    html: `<!doctype html>
<html>
  <body style="margin:0;background:#f5f5f5;font-family:Inter,Arial,sans-serif;color:#111111;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(previewText || subject)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:24px;overflow:hidden;">
            ${coverUrl ? `<tr><td><img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(projectName)}" style="display:block;width:100%;height:auto;max-height:280px;object-fit:cover;" /></td></tr>` : ""}
            <tr>
              <td style="padding:36px 36px 32px;">
                <div style="font-size:12px;letter-spacing:0.24em;text-transform:uppercase;color:#6b7280;font-weight:700;">${escapeHtml(studioName)}</div>
                <h1 style="margin:16px 0 12px;font-size:32px;line-height:1.1;color:#111111;">${escapeHtml(headline)}</h1>
                <div style="font-size:16px;line-height:1.7;color:#374151;">${messageHtml}</div>
                <div style="margin-top:18px;padding:16px 18px;border-radius:18px;background:#f8fafc;border:1px solid #e5e7eb;color:#374151;font-size:14px;line-height:1.7;">
                  <div><strong>${accessHtml}</strong></div>
                  <div style="margin-top:6px;">${emailRequirementHtml}</div>
                  <div style="margin-top:6px;word-break:break-all;">${galleryUrlHtml}</div>
                </div>
                <div style="margin-top:28px;">
                  <a href="${galleryUrlHtml}" style="display:inline-block;border-radius:999px;background:#111111;color:#ffffff;text-decoration:none;font-weight:800;padding:14px 24px;">${escapeHtml(buttonLabel)}</a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

export function buildAbandonedCartEmail(input: EventEmailContentInput & {
  orderTotalLabel: string;
}) {
  return buildGalleryShareEmail({
    ...input,
    overrideSubject:
      clean(input.overrideSubject) || `You still have a photo order waiting in ${eventProjectName(input.project)}`,
    previewText: `Finish your photo order for ${eventProjectName(input.project)}`,
    overrideMessage:
      clean(input.overrideMessage) ||
      `Hi,\n\nYou still have a photo order waiting in ${eventProjectName(input.project)}.\n\nCurrent cart total: ${input.orderTotalLabel}\n\nReturn to the gallery to complete your checkout.\n\nThanks,\n${eventFromName(input.photographer)}`,
    ctaLabel: clean(input.ctaLabel) || "Resume Order",
  });
}

export function buildSchoolShareEmail(input: SchoolEmailContentInput) {
  const schoolName = schoolGalleryName(input.school);
  const subject =
    clean(input.overrideSubject) ||
    clean(input.share?.emailSubject) ||
    defaultEventGalleryShareSettings.emailSubject;
  const headline =
    clean(input.share?.emailHeadline) ||
    schoolName;
  const buttonLabel =
    clean(input.ctaLabel) ||
    clean(input.share?.emailButtonLabel) ||
    defaultEventGalleryShareSettings.emailButtonLabel;
  const message =
    clean(input.overrideMessage) ||
    clean(input.share?.emailMessage) ||
    defaultEventGalleryShareSettings.emailMessage;
  const galleryUrl = schoolGalleryEntryUrl(
    input.origin,
    input.school.id,
    input.school.gallery_slug,
  );
  const studentPin = clean(input.studentPin);
  const studentName = clean(input.studentName);
  const accessSummary = schoolAccessSummary(
    studentPin,
    studentName,
  );
  const emailRequirement = schoolEmailRequirementSummary();
  const studioName = eventFromName(input.photographer);
  const previewText = clean(input.previewText);
  const coverUrl = signedPrivateMediaReference(
    input.school.cover_photo_url,
    EMAIL_COVER_MEDIA_TTL_SECONDS,
  );
  const textLines = [
    headline,
    "",
    message,
    "",
    `Gallery link: ${galleryUrl}`,
    accessSummary,
    emailRequirement,
    "",
    `${buttonLabel}: ${galleryUrl}`,
  ].filter(Boolean);

  const messageHtml = escapeHtml(message).replaceAll("\n", "<br />");
  const accessHtml = escapeHtml(accessSummary);
  const emailRequirementHtml = escapeHtml(emailRequirement);
  const galleryUrlHtml = escapeHtml(galleryUrl);
  const accessBlockHtml = studentPin
    ? `<div style="margin-top:18px;padding:22px 20px;border-radius:18px;background:#fff7ed;border:2px solid #fb923c;text-align:center;color:#111827;">
                  <div style="font-size:13px;line-height:1.35;letter-spacing:0.06em;text-transform:uppercase;color:#9a3412;font-weight:800;">${studentName ? `${escapeHtml(studentName)}&#39;s private gallery PIN` : "Your private gallery PIN"}</div>
                  <div style="margin-top:10px;font-family:Arial,sans-serif;font-size:44px;line-height:1;font-weight:900;letter-spacing:0.16em;color:#111827;font-variant-numeric:tabular-nums;-webkit-text-size-adjust:100%;">${escapeHtml(studentPin)}</div>
                  <div style="margin-top:10px;font-size:14px;line-height:1.5;color:#7c2d12;font-weight:700;">Use this PIN to open your private photos.</div>
                  <div style="margin-top:16px;padding-top:14px;border-top:1px solid #fdba74;font-size:14px;line-height:1.6;color:#374151;">${emailRequirementHtml}</div>
                  <div style="margin-top:6px;font-size:14px;line-height:1.6;word-break:break-all;"><a href="${galleryUrlHtml}" style="color:#0369a1;text-decoration:underline;">${galleryUrlHtml}</a></div>
                </div>`
    : `<div style="margin-top:18px;padding:16px 18px;border-radius:18px;background:#f8fafc;border:1px solid #e5e7eb;color:#374151;font-size:14px;line-height:1.7;">
                  <div><strong>${accessHtml}</strong></div>
                  <div style="margin-top:6px;">${emailRequirementHtml}</div>
                  <div style="margin-top:6px;word-break:break-all;">${galleryUrlHtml}</div>
                </div>`;

  return {
    subject,
    text: textLines.join("\n"),
    html: `<!doctype html>
<html>
  <body style="margin:0;background:#f5f5f5;font-family:Inter,Arial,sans-serif;color:#111111;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(previewText || subject)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:24px;overflow:hidden;">
            ${coverUrl ? `<tr><td><img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(schoolName)}" style="display:block;width:100%;height:auto;max-height:280px;object-fit:cover;" /></td></tr>` : ""}
            <tr>
              <td style="padding:36px 36px 32px;">
                <div style="font-size:12px;letter-spacing:0.24em;text-transform:uppercase;color:#6b7280;font-weight:700;">${escapeHtml(studioName)}</div>
                <h1 style="margin:16px 0 12px;font-size:32px;line-height:1.1;color:#111111;">${escapeHtml(headline)}</h1>
                <div style="font-size:16px;line-height:1.7;color:#374151;">${messageHtml}</div>
                ${accessBlockHtml}
                <div style="margin-top:28px;">
                  <a href="${galleryUrlHtml}" style="display:inline-block;border-radius:999px;background:#111111;color:#ffffff;text-decoration:none;font-weight:800;padding:14px 24px;">${escapeHtml(buttonLabel)}</a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

export function buildSchoolAbandonedCartEmail(input: {
  school: SchoolEmailGallery;
  photographer?: EventEmailPhotographer | null;
  origin: string;
  orderTotalLabel: string;
}) {
  const schoolName = schoolGalleryName(input.school);
  return buildSchoolShareEmail({
    school: input.school,
    photographer: input.photographer,
    origin: input.origin,
    previewText: `Finish your photo order for ${schoolName}`,
    overrideSubject: `You still have a photo order waiting in ${schoolName}`,
    overrideMessage: `Hi,\n\nYou still have a photo order waiting in ${schoolName}.\n\nCurrent cart total: ${input.orderTotalLabel}\n\nReturn to the gallery to complete your checkout.\n\nThanks,\n${eventFromName(input.photographer)}`,
    ctaLabel: "Resume Order",
  });
}
