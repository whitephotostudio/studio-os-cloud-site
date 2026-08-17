import type {
  StudioBookingDetail,
  StudioBookingRecord,
  StudioBookingSlot,
} from "@/lib/studio-bookings";

export const STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS = 200;

export type StudioBookingEmailAudience = "confirmed" | "cancelled" | "all";

export type StudioBookingEmailRecipient = {
  email: string;
  bookings: StudioBookingRecord[];
};

export type StudioBookingRecipientSummary = {
  recipients: StudioBookingEmailRecipient[];
  eligibleBookings: number;
  excludedBookings: number;
  unusableSlotBookings: number;
  missingEmailBookings: number;
  invalidEmailBookings: number;
  duplicateEmailBookings: number;
};

export type StudioBookingEmailCopy = {
  subject: string;
  headline: string;
  message: string;
};

export type StudioBookingEmailDocument = {
  html: string;
  text: string;
};

export type StudioBookingEmailEventDetails = {
  location?: string;
  address?: string;
  directions?: string;
};

export type StudioBookingMailtoInput = {
  to?: string | null;
  bcc: string[];
  subject: string;
  body: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export function buildStudioBookingMailtoUrl(input: StudioBookingMailtoInput) {
  const encodeAddress = (value: string | null | undefined) => {
    const address = clean(value);
    if (!EMAIL_RE.test(address)) return null;
    const at = address.lastIndexOf("@");
    return `${encodeURIComponent(address.slice(0, at))}@${encodeURIComponent(address.slice(at + 1))}`;
  };
  const to = encodeAddress(input.to);
  const bcc = input.bcc.map(encodeAddress);
  if (!to || !bcc.length || bcc.some((address) => !address)) return null;

  const body = input.body.replace(/\r\n|\r|\n/g, "\r\n");
  const subject = clean(input.subject).replace(/[\r\n]+/g, " ");
  return `mailto:${to}?bcc=${bcc.join(",")}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function cancelledStatus(value: string | null | undefined) {
  const status = clean(value).toLowerCase();
  return status === "cancelled" || status === "canceled";
}

function audienceIncludes(booking: StudioBookingRecord, audience: StudioBookingEmailAudience) {
  if (audience === "all") return true;
  const cancelled = cancelledStatus(booking.status);
  return audience === "cancelled"
    ? cancelled
    : clean(booking.status).toLowerCase() === "confirmed";
}

export function collectStudioBookingEmailRecipients(
  bookings: StudioBookingRecord[],
  audience: StudioBookingEmailAudience = "confirmed",
  validSlotIds?: ReadonlySet<string>,
): StudioBookingRecipientSummary {
  const byEmail = new Map<string, StudioBookingEmailRecipient>();
  let eligibleBookings = 0;
  let excludedBookings = 0;
  let unusableSlotBookings = 0;
  let missingEmailBookings = 0;
  let invalidEmailBookings = 0;
  let duplicateEmailBookings = 0;

  for (const booking of bookings) {
    if (!audienceIncludes(booking, audience)) {
      excludedBookings += 1;
      continue;
    }

    if (
      validSlotIds &&
      (!booking.slotId || !validSlotIds.has(booking.slotId))
    ) {
      unusableSlotBookings += 1;
      continue;
    }

    eligibleBookings += 1;
    const email = clean(booking.parentEmail);
    if (!email) {
      missingEmailBookings += 1;
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      invalidEmailBookings += 1;
      continue;
    }

    const key = email.toLowerCase();
    const existing = byEmail.get(key);
    if (existing) {
      existing.bookings.push(booking);
      duplicateEmailBookings += 1;
    } else {
      byEmail.set(key, { email, bookings: [booking] });
    }
  }

  return {
    recipients: Array.from(byEmail.values()),
    eligibleBookings,
    excludedBookings,
    unusableSlotBookings,
    missingEmailBookings,
    invalidEmailBookings,
    duplicateEmailBookings,
  };
}

export function studioBookingRecipientFingerprint(
  recipients: StudioBookingEmailRecipient[],
) {
  const normalized = recipients
    .map((recipient) => {
      const bookings = recipient.bookings
        .map((booking) =>
          [booking.id, booking.slotId ?? "", clean(booking.status).toLowerCase()].join(":"),
        )
        .sort();
      return `${recipient.email.toLowerCase()}|${bookings.join(",")}`;
    })
    .sort()
    .join("\n");

  const hash = (seed: number) => {
    let value = seed >>> 0;
    for (let index = 0; index < normalized.length; index += 1) {
      value ^= normalized.charCodeAt(index);
      value = Math.imul(value, 16_777_619);
    }
    return (value >>> 0).toString(16).padStart(8, "0");
  };

  return `${hash(2_166_136_261)}${hash(3_332_664_491)}`;
}

function safeDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function bookingEmailDate(value: string | null, timezone: string) {
  const parsed = safeDate(value);
  if (!parsed) return "Date to be confirmed";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(parsed);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(parsed);
  }
}

export function bookingEmailTime(value: string | null, timezone: string) {
  const parsed = safeDate(value);
  if (!parsed) return "Time to be confirmed";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(parsed);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      hour: "numeric",
      minute: "2-digit",
    }).format(parsed);
  }
}

function localDateKey(value: string, timezone: string) {
  const parsed = safeDate(value);
  if (!parsed) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(parsed);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((entry) => entry.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return parsed.toISOString().slice(0, 10);
  }
}

function eventDayStarts(detail: StudioBookingDetail) {
  const candidates = detail.event.days
    .map((day) => day.startAt)
    .filter((value): value is string => Boolean(safeDate(value)));
  const values = candidates.length
    ? candidates
    : detail.slots.map((slot) => slot.startAt).filter((value) => Boolean(safeDate(value)));
  if (!values.length && detail.event.firstSlotAt) values.push(detail.event.firstSlotAt);

  const byDate = new Map<string, string>();
  for (const value of values.sort((a, b) => (safeDate(a)?.getTime() ?? 0) - (safeDate(b)?.getTime() ?? 0))) {
    const key = localDateKey(value, detail.event.timezone);
    if (key && !byDate.has(key)) byDate.set(key, value);
  }
  return Array.from(byDate.values());
}

export function bookingEmailEventDate(detail: StudioBookingDetail) {
  const starts = eventDayStarts(detail);
  if (!starts.length) {
    return bookingEmailDate(detail.event.firstSlotAt, detail.event.timezone);
  }
  const first = bookingEmailDate(starts[0], detail.event.timezone);
  if (starts.length === 1) return first;
  const last = bookingEmailDate(starts[starts.length - 1], detail.event.timezone);
  return `${first} – ${last}`;
}

function sessionTime(detail: StudioBookingDetail) {
  const start = detail.event.firstSlotAt;
  const end = detail.event.lastSlotAt;
  if (!start && !end) return "Time to be confirmed";
  if (!end) return bookingEmailTime(start, detail.event.timezone);
  return `${bookingEmailTime(start, detail.event.timezone)}–${bookingEmailTime(end, detail.event.timezone)}`;
}

export function defaultStudioBookingEmailCopy(detail: StudioBookingDetail): StudioBookingEmailCopy {
  return {
    subject: `Important details for ${detail.event.name} — ${bookingEmailEventDate(detail)}`,
    headline: "Your photography appointment details",
    message:
      "Hello,\n\nPlease review the appointment and arrival details below before picture day. We look forward to seeing you.",
  };
}

function escapeHtml(value: string | null | undefined) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function htmlLines(value: string | null | undefined) {
  return escapeHtml(value).replace(/\r?\n/g, "<br />");
}

function safeHttpUrl(value: string | null | undefined) {
  const text = clean(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeBrandColor(value: string | null | undefined) {
  const color = clean(value);
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#17213f";
}

function slotById(slots: StudioBookingSlot[]) {
  return new Map(slots.map((slot) => [slot.id, slot]));
}

function appointmentText(
  booking: StudioBookingRecord,
  slot: StudioBookingSlot | undefined,
  timezone: string,
) {
  const time = slot
    ? `${bookingEmailDate(slot.startAt, timezone)} at ${bookingEmailTime(slot.startAt, timezone)}`
    : "Appointment time unavailable";
  const className = clean(booking.className);
  const status = cancelledStatus(booking.status)
    ? "CANCELLED"
    : clean(booking.status).toUpperCase() || "STATUS UNKNOWN";
  return `${clean(booking.studentName) || "Student"}${className ? ` · ${className}` : ""} — ${time} — ${status}`;
}

function detailRows(
  detail: StudioBookingDetail,
  overrides: StudioBookingEmailEventDetails = {},
) {
  const dayCount = eventDayStarts(detail).length;
  const location =
    overrides.location === undefined
      ? detail.schedule.location
      : clean(overrides.location) || null;
  const address =
    overrides.address === undefined
      ? detail.schedule.address
      : clean(overrides.address) || null;
  const rows: Array<[string, string]> = [
    ["Event", detail.event.name],
    [dayCount > 1 ? "Event dates" : "Date", bookingEmailEventDate(detail)],
  ];
  if (dayCount <= 1) rows.push(["Session hours", sessionTime(detail)]);
  if (location) rows.push(["Location", location]);
  if (address) rows.push(["Address", address]);
  if (clean(overrides.directions)) {
    rows.push(["Directions / arrival", clean(overrides.directions)]);
  }
  return rows;
}

export function buildStudioBookingMailBody(
  detail: StudioBookingDetail,
  message: string,
  eventDetails: StudioBookingEmailEventDetails = {},
) {
  const lines = [clean(message), "", "EVENT DETAILS"];
  for (const [label, value] of detailRows(detail, eventDetails)) lines.push(`${label}: ${value}`);
  lines.push("", "Your individual appointment time is in your booking confirmation.");

  const contact = [detail.studio.phone, detail.studio.email, detail.studio.address]
    .map(clean)
    .filter(Boolean);
  lines.push("", detail.studio.businessName);
  if (contact.length) lines.push(...contact);
  return lines.join("\n");
}

export function buildStudioBookingEmailDocument(input: {
  detail: StudioBookingDetail;
  recipient: StudioBookingEmailRecipient;
  headline: string;
  message: string;
  location?: string;
  address?: string;
  directions?: string;
  directionPhotoContentIds?: string[];
}): StudioBookingEmailDocument {
  const { detail, recipient } = input;
  const contentIds = input.directionPhotoContentIds ?? [];
  const studioName = clean(detail.studio.businessName) || "Studio OS";
  const logoUrl = safeHttpUrl(detail.studio.logoUrl);
  const brandColor = safeBrandColor(detail.studio.brandColor);
  const slots = slotById(detail.slots);
  const appointments = recipient.bookings
    .map((booking) => ({
      booking,
      slot: booking.slotId ? slots.get(booking.slotId) : undefined,
    }))
    .sort((left, right) => {
      const leftTime = safeDate(left.slot?.startAt ?? null)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const rightTime = safeDate(right.slot?.startAt ?? null)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime || left.booking.studentName.localeCompare(right.booking.studentName);
    });

  const logoHtml = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(studioName)}" style="display:block;max-height:64px;max-width:230px;margin:0 auto;object-fit:contain;" />`
    : `<div style="font-size:24px;font-weight:900;color:#ffffff;letter-spacing:-0.02em;">${escapeHtml(studioName)}</div>`;

  const eventRowsHtml = detailRows(detail, {
    location: input.location,
    address: input.address,
    directions: input.directions,
  })
    .map(
      ([label, value]) => `<tr>
        <td style="padding:8px 12px 8px 0;color:#748097;font-size:12px;font-weight:700;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>
        <td style="padding:8px 0;color:#202a3d;font-size:13px;font-weight:650;line-height:1.45;">${htmlLines(value)}</td>
      </tr>`,
    )
    .join("");

  const appointmentsHtml = appointments
    .map(({ booking, slot }) => {
      const when = slot
        ? `${bookingEmailDate(slot.startAt, detail.event.timezone)} at ${bookingEmailTime(slot.startAt, detail.event.timezone)}`
        : "Appointment time unavailable";
      const status = cancelledStatus(booking.status)
        ? "Cancelled"
        : clean(booking.status) || "Status unknown";
      const statusColor = cancelledStatus(booking.status) ? "#a43333" : "#187249";
      return `<tr>
        <td style="padding:10px 12px;border-top:1px solid #e8ebf1;color:#202a3d;font-size:13px;line-height:1.4;">
          <strong>${escapeHtml(booking.studentName || "Student")}</strong>${booking.className ? `<br /><span style="color:#748097;font-size:11px;">${escapeHtml(booking.className)}</span>` : ""}<br /><span style="color:${statusColor};font-size:10px;font-weight:800;text-transform:capitalize;">${escapeHtml(status)}</span>
        </td>
        <td style="padding:10px 12px;border-top:1px solid #e8ebf1;color:#33435f;font-size:12px;font-weight:700;line-height:1.4;text-align:right;">${escapeHtml(when)}</td>
      </tr>`;
    })
    .join("");

  const photosHtml = contentIds.length
    ? `<div style="padding:0 34px 30px;">
        <div style="margin:0 0 12px;color:#202a3d;font-size:16px;font-weight:850;">Direction photos</div>
        ${contentIds
          .map(
            (contentId, index) => `<div style="margin:0 0 12px;text-align:center;">
              <img src="cid:${escapeHtml(contentId)}" alt="Direction photo ${index + 1}" width="520" style="display:block;width:100%;max-width:520px;height:auto;margin:0 auto;border:1px solid #e1e5ed;border-radius:10px;" />
            </div>`,
          )
          .join("")}
      </div>`
    : "";

  const footerParts = [detail.studio.address, detail.studio.phone, detail.studio.email]
    .map(clean)
    .filter(Boolean);

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f2f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;color:transparent;">Appointment and location details for ${escapeHtml(detail.event.name)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f4f8;">
    <tr><td style="padding:28px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e6ee;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:28px 34px;text-align:center;background:${brandColor};">${logoHtml}</td></tr>
        <tr><td style="padding:30px 34px 14px;text-align:center;">
          <h1 style="margin:0;color:#172033;font-size:24px;line-height:1.2;letter-spacing:-0.03em;">${escapeHtml(input.headline)}</h1>
        </td></tr>
        <tr><td style="padding:8px 34px 24px;color:#445069;font-size:14px;line-height:1.65;">${htmlLines(input.message)}</td></tr>
        <tr><td style="padding:0 34px 24px;">
          <div style="padding:18px 20px;background:#f7f8fb;border:1px solid #e4e7ee;border-left:4px solid ${brandColor};border-radius:10px;">
            <div style="margin:0 0 8px;color:#202a3d;font-size:16px;font-weight:850;">Event details</div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${eventRowsHtml}</table>
          </div>
        </td></tr>
        <tr><td style="padding:0 34px 28px;">
          <div style="margin:0 0 10px;color:#202a3d;font-size:16px;font-weight:850;">Your booking${appointments.length === 1 ? "" : "s"}</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e3e7ef;border-radius:9px;overflow:hidden;">${appointmentsHtml}</table>
        </td></tr>
        <tr><td>${photosHtml}</td></tr>
        <tr><td style="padding:20px 34px;text-align:center;background:#f7f8fb;border-top:1px solid #e7eaf0;">
          <div style="color:#4d5870;font-size:11px;font-weight:800;">${escapeHtml(studioName)}</div>
          ${footerParts.length ? `<div style="margin-top:6px;color:#8992a3;font-size:10px;line-height:1.5;">${footerParts.map(escapeHtml).join(" · ")}</div>` : ""}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textLines = [clean(input.message), "", "EVENT DETAILS"];
  for (const [label, value] of detailRows(detail, {
    location: input.location,
    address: input.address,
    directions: input.directions,
  })) textLines.push(`${label}: ${value}`);
  textLines.push("", `YOUR BOOKING${appointments.length === 1 ? "" : "S"}`);
  for (const { booking, slot } of appointments) {
    textLines.push(appointmentText(booking, slot, detail.event.timezone));
  }
  if (contentIds.length) textLines.push("", `${contentIds.length} direction photo${contentIds.length === 1 ? " is" : "s are"} included with this email.`);
  textLines.push("", studioName, ...footerParts);

  return { html, text: textLines.join("\n") };
}
