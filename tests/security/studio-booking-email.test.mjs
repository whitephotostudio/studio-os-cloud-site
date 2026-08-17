import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildStudioBookingEmailDocument,
  buildStudioBookingMailtoUrl,
  buildStudioBookingMailBody,
  collectStudioBookingEmailRecipients,
  defaultStudioBookingEmailCopy,
  studioBookingRecipientFingerprint,
} from "../../lib/studio-booking-email.ts";
import { sendResendEmail } from "../../lib/resend.ts";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function detailFixture() {
  return {
    ok: true,
    checkedAt: "2026-08-17T12:00:00Z",
    event: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Example School",
      kind: "school",
      enabled: true,
      sourceStatus: "active",
      timezone: "America/Toronto",
      slotMinutes: 5,
      requirePayment: true,
      sittingFeeCents: 3000,
      currency: "CAD",
      includesDigitalImages: false,
      capacity: 2,
      booked: 2,
      remaining: 0,
      cancelled: 1,
      totalRecords: 3,
      percentFilled: 100,
      paidBookings: 2,
      failedPayments: 0,
      revenueCents: 6000,
      firstSlotAt: "2026-08-18T13:00:00Z",
      lastSlotAt: "2026-08-18T13:10:00Z",
      lastBookingAt: "2026-08-17T12:00:00Z",
      createdAt: "2026-08-01T12:00:00Z",
      updatedAt: "2026-08-17T12:00:00Z",
      days: [],
      publicUrl: "/book?event=11111111-1111-4111-8111-111111111111",
    },
    studio: {
      businessName: "White Photo",
      logoUrl: "https://example.com/logo.png",
      brandColor: "#123456",
      email: "studio@example.com",
      phone: "555-0100",
      address: "1 Studio Street",
    },
    schedule: {
      location: "Main campus",
      address: "10 Example Road",
      notes: "Staff contact: call the principal before setup.",
    },
    slots: [
      {
        id: "slot-1",
        startAt: "2026-08-18T13:00:00Z",
        endAt: "2026-08-18T13:05:00Z",
        status: "booked",
        capacity: 1,
        bookedCount: 1,
      },
      {
        id: "slot-2",
        startAt: "2026-08-18T13:05:00Z",
        endAt: "2026-08-18T13:10:00Z",
        status: "booked",
        capacity: 1,
        bookedCount: 1,
      },
    ],
    bookings: [
      {
        id: "booking-1",
        slotId: "slot-1",
        status: "confirmed",
        studentName: "First Student",
        className: "Class A",
        parentName: "Parent One",
        parentEmail: "Parent@Example.com ",
        parentPhone: null,
        notes: null,
        consentRecordedAt: null,
        createdAt: null,
        updatedAt: null,
        paymentStatus: "succeeded",
        paymentAmountCents: 3000,
        paymentCurrency: "CAD",
      },
      {
        id: "booking-2",
        slotId: "slot-2",
        status: "confirmed",
        studentName: "Second Student",
        className: "Class B",
        parentName: "Parent One",
        parentEmail: "parent@example.com",
        parentPhone: null,
        notes: null,
        consentRecordedAt: null,
        createdAt: null,
        updatedAt: null,
        paymentStatus: "succeeded",
        paymentAmountCents: 3000,
        paymentCurrency: "CAD",
      },
      {
        id: "booking-3",
        slotId: null,
        status: "cancelled",
        studentName: "Cancelled Student",
        className: null,
        parentName: null,
        parentEmail: "cancelled@example.com",
        parentPhone: null,
        notes: null,
        consentRecordedAt: null,
        createdAt: null,
        updatedAt: null,
        paymentStatus: "failed",
        paymentAmountCents: 3000,
        paymentCurrency: "CAD",
      },
    ],
  };
}

test("booking email recipients default to confirmed records and deduplicate case-insensitively", () => {
  const detail = detailFixture();
  detail.bookings.push(
    { ...detail.bookings[0], id: "missing", parentEmail: null },
    { ...detail.bookings[0], id: "invalid", parentEmail: "not-an-email" },
    { ...detail.bookings[0], id: "pending", status: "pending", parentEmail: "pending@example.com" },
    { ...detail.bookings[0], id: "orphan", slotId: "foreign-slot", parentEmail: "orphan@example.com" },
  );

  const summary = collectStudioBookingEmailRecipients(
    detail.bookings,
    "confirmed",
    new Set(detail.slots.map((slot) => slot.id)),
  );
  assert.equal(summary.recipients.length, 1);
  assert.equal(summary.recipients[0].bookings.length, 2);
  assert.equal(summary.duplicateEmailBookings, 1);
  assert.equal(summary.missingEmailBookings, 1);
  assert.equal(summary.invalidEmailBookings, 1);
  assert.equal(summary.excludedBookings, 2);
  assert.equal(summary.unusableSlotBookings, 1);
  assert.equal(studioBookingRecipientFingerprint(summary.recipients).length, 16);
});

test("booking email document is branded, personalized, escaped, and supports CID photos", () => {
  const detail = detailFixture();
  const recipient = collectStudioBookingEmailRecipients(
    detail.bookings,
    "confirmed",
    new Set(detail.slots.map((slot) => slot.id)),
  ).recipients[0];
  const document = buildStudioBookingEmailDocument({
    detail,
    recipient,
    headline: "Arrival <details>",
    message: "Please use the east entrance & check in.",
    location: "Updated main campus",
    address: "20 Updated Road",
    directions: "Use the east entrance.",
    directionPhotoContentIds: ["booking-direction-1"],
  });

  assert.match(document.html, /White Photo/);
  assert.match(document.html, /https:\/\/example\.com\/logo\.png/);
  assert.match(document.html, /Arrival &lt;details&gt;/);
  assert.doesNotMatch(document.html, /Arrival <details>/);
  assert.match(document.html, /First Student/);
  assert.match(document.html, /Second Student/);
  assert.match(document.html, /Use the east entrance\./);
  assert.match(document.html, /Updated main campus/);
  assert.match(document.html, /20 Updated Road/);
  assert.doesNotMatch(document.html, /call the principal/);
  assert.match(document.html, /cid:booking-direction-1/);
  assert.match(document.text, /YOUR BOOKINGS/);
  assert.match(document.text, /Updated main campus/);
});

test("booking Mail draft body includes shared event, directions, and studio information", () => {
  const detail = detailFixture();
  const defaults = defaultStudioBookingEmailCopy(detail);
  const body = buildStudioBookingMailBody(detail, defaults.message, {
    location: "Main campus",
    address: "10 Example Road",
    directions: "Use the east entrance.",
  });
  assert.match(defaults.subject, /Example School/);
  assert.match(body, /EVENT DETAILS/);
  assert.match(body, /Use the east entrance/);
  assert.match(body, /studio@example\.com/);
  assert.match(body, /individual appointment time/i);
  assert.doesNotMatch(body, /call the principal/);
});

test("booking Mail draft URL uses percent-encoded spaces and CRLF line breaks", () => {
  const body = [
    "Your photography appointment details",
    "",
    "Hello,",
    "",
    "Location: 100 City Centre Dr Mississauga ON L5B 2C9 Canada",
    "Address: https://maps.apple/p/Yn7u3np-y3pU8_",
  ].join("\n");
  const mailto = buildStudioBookingMailtoUrl({
    to: "studio+bookings@example.com",
    bcc: ["parent+one@example.com", "parent.two@example.com"],
    subject: "Your photography +\nappointment details",
    body,
  });

  assert.ok(mailto);
  assert.doesNotMatch(mailto, /\+/);
  assert.match(mailto, /^mailto:studio%2Bbookings@example\.com\?/);
  assert.match(mailto, /bcc=parent%2Bone@example\.com,parent\.two@example\.com&/);
  assert.match(mailto, /subject=Your%20photography%20%2B%20appointment%20details/);
  assert.match(mailto, /%0D%0A%0D%0AHello%2C/);

  const rawFields = Object.fromEntries(
    mailto.slice(mailto.indexOf("?") + 1).split("&").map((field) => {
      const splitAt = field.indexOf("=");
      return [field.slice(0, splitAt), field.slice(splitAt + 1)];
    }),
  );
  assert.equal(decodeURIComponent(rawFields.bcc), "parent+one@example.com,parent.two@example.com");
  assert.equal(decodeURIComponent(rawFields.subject), "Your photography + appointment details");
  assert.equal(decodeURIComponent(rawFields.body), body.replace(/\n/g, "\r\n"));
  assert.equal(buildStudioBookingMailtoUrl({ to: null, bcc: ["parent@example.com"], subject: "Details", body: "Hello" }), null);
});

test("multi-day booking emails use an event date range and each recipient's real appointment", () => {
  const detail = detailFixture();
  detail.event.days = [
    { date: "2026-08-18", startAt: "2026-08-18T13:00:00Z", endAt: "2026-08-18T13:10:00Z", capacity: 2, booked: 2, remaining: 0, slotCount: 2 },
    { date: "2026-08-19", startAt: "2026-08-19T14:00:00Z", endAt: "2026-08-19T14:05:00Z", capacity: 1, booked: 1, remaining: 0, slotCount: 1 },
  ];
  detail.event.lastSlotAt = "2026-08-19T14:05:00Z";
  detail.slots.push({ id: "slot-3", startAt: "2026-08-19T14:00:00Z", endAt: "2026-08-19T14:05:00Z", status: "booked", capacity: 1, bookedCount: 1 });
  detail.bookings = [{ ...detail.bookings[0], id: "booking-day-2", slotId: "slot-3", parentEmail: "day2@example.com" }];

  const recipient = collectStudioBookingEmailRecipients(
    detail.bookings,
    "confirmed",
    new Set(detail.slots.map((slot) => slot.id)),
  ).recipients[0];
  const defaults = defaultStudioBookingEmailCopy(detail);
  const document = buildStudioBookingEmailDocument({
    detail,
    recipient,
    headline: defaults.headline,
    message: defaults.message,
  });

  assert.match(defaults.subject, /August 18, 2026.*August 19, 2026/);
  assert.match(document.text, /Event dates:/);
  assert.doesNotMatch(document.text, /Session hours:/);
  assert.match(document.text, /Wednesday, August 19, 2026/);
});

test("booking email API is owner-only, event-scoped, private, and never trusts client recipients", () => {
  const route = source("app/api/dashboard/admin/bookings/[eventId]/email/route.ts");
  assert.match(route, /resolveDashboardAuth\(request\)/);
  assert.match(route, /photographer\.is_platform_admin/);
  assert.match(route, /loadStudioBookingDetail\(service, photographer\.id, eventId\)/);
  assert.match(route, /collectStudioBookingEmailRecipients/);
  assert.match(route, /studioBookingRecipientFingerprint/);
  assert.match(route, /status: 409/);
  assert.match(route, /status: 401/);
  assert.match(route, /status: 403/);
  assert.match(route, /Cache-Control": "private, no-store/);
  assert.doesNotMatch(route, /recipients:\s*z\./);
  assert.doesNotMatch(route, /audience:\s*z\./);
  assert.doesNotMatch(route, /access_pin|public_token|stripe_payment_intent_id|stripe_charge_id/);
  assert.match(route, /photos:\s*z\.array\(DirectionPhotoSchema\)\.max\(4\)/);
  assert.match(route, /MAX_TOTAL_PHOTO_BASE64/);
  assert.match(route, /sendResendEmail/);
  assert.match(route, /idempotencyKey/);
  assert.match(route, /studio-booking-email-campaign/);
  assert.match(route, /STUDIO_BOOKING_EMAIL_MAX_RECIPIENTS/);
  assert.match(route, /limitInputPixels: MAX_INPUT_PIXELS/);
  assert.match(route, /sendResendEmailWithRetry/);
  assert.match(route, /booking-update-\$\{eventId\}/);
  assert.match(route, /directions:\s*z\.string/);
  assert.match(route, /location:\s*z\.string/);
  assert.match(route, /address:\s*z\.string/);
});

test("Resend REST payload uses the provider's reply_to field", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFromEmail = process.env.RESEND_FROM_EMAIL;
  let payload = null;
  process.env.RESEND_API_KEY = "test-key";
  process.env.RESEND_FROM_EMAIL = "sender@example.com";
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ id: "email-id" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await sendResendEmail({
      to: "parent@example.com",
      subject: "Details",
      html: "<p>Details</p>",
      replyTo: "studio@example.com",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalApiKey;
    if (originalFromEmail === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = originalFromEmail;
  }

  assert.equal(payload.reply_to, "studio@example.com");
  assert.equal("replyTo" in payload, false);
});

test("booking composer provides private branded send and BCC Mail fallback", () => {
  const component = source("components/studio-booking-email-composer.tsx");
  assert.match(component, /Send branded email/);
  assert.match(component, /Open in Mail app/);
  assert.match(component, /buildStudioBookingMailtoUrl/);
  assert.match(component, /navigator\.clipboard\.writeText/);
  assert.match(component, /Each client will receive a separate email/);
  assert.match(component, /Mail drafts cannot include the branded logo/);
  assert.match(component, /window\.confirm/);
  assert.match(component, /Confirmed bookings only/);
  assert.match(component, /Use saved schedule notes/);
  assert.match(component, /Location \(leave blank to omit\)/);
  assert.match(component, /Branded email preview/);
  assert.match(component, /recipientFingerprint/);
  assert.doesNotMatch(component, /AUDIENCE_OPTIONS/);
});
