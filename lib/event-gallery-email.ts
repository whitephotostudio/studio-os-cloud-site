import {
  EventGalleryShareSettings,
  defaultEventGalleryShareSettings,
} from "@/lib/event-gallery-settings";

export type EventEmailProject = {
  id: string;
  title?: string | null;
  client_name?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  email_required?: boolean | null;
  cover_photo_url?: string | null;
};

export type SchoolEmailGallery = {
  id: string;
  school_name?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  email_required?: boolean | null;
  cover_photo_url?: string | null;
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

export function eventGalleryEntryUrl(origin: string, projectId: string) {
  const base = origin.replace(/\/$/, "");
  return `${base}/parents?mode=event&project=${encodeURIComponent(projectId)}`;
}

export function schoolGalleryEntryUrl(origin: string, schoolId: string) {
  const base = origin.replace(/\/$/, "");
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

export function schoolAccessSummary() {
  return "Access PIN: Use the PIN from your photo envelope or the one provided by your photographer.";
}

export function schoolEmailRequirementSummary(school: SchoolEmailGallery) {
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
  const galleryUrl = eventGalleryEntryUrl(input.origin, input.project.id);
  const accessSummary = eventAccessSummary(input.project);
  const emailRequirement = eventEmailRequirementSummary(input.project);
  const studioName = eventFromName(input.photographer);
  const previewText = clean(input.previewText);
  const coverUrl = clean(input.project.cover_photo_url);
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
  const galleryUrl = schoolGalleryEntryUrl(input.origin, input.school.id);
  const accessSummary = schoolAccessSummary();
  const emailRequirement = schoolEmailRequirementSummary(input.school);
  const studioName = eventFromName(input.photographer);
  const previewText = clean(input.previewText);
  const coverUrl = clean(input.school.cover_photo_url);
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
            ${coverUrl ? `<tr><td><img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(schoolName)}" style="display:block;width:100%;height:auto;max-height:280px;object-fit:cover;" /></td></tr>` : ""}
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
