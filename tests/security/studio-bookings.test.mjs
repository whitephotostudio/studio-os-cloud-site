import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import { buildBookingEventSummary } from "../../lib/studio-bookings-server.ts";
import { createStudioBookingsPdf, safeBookingPdfFilename } from "../../lib/studio-bookings-pdf.ts";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const overviewRoute = source("app/api/dashboard/admin/bookings/route.ts");
const detailRoute = source("app/api/dashboard/admin/bookings/[eventId]/route.ts");
const exportRoute = source("app/api/dashboard/admin/bookings/[eventId]/export/route.ts");
const overviewPage = source("app/dashboard/admin/bookings/page.tsx");
const exportControl = source("components/studio-booking-pdf-export.tsx");
const sidebarSource = source("components/dashboard-sidebar.tsx");

test("Studio Bookings calculates booked, remaining, cancelled, and paid totals", () => {
  const summary = buildBookingEventSummary({
    event: {
      id: "11111111-1111-4111-8111-111111111111",
      enabled: true,
      timezone: "America/Toronto",
      slot_duration_minutes: 5,
      require_payment: true,
      sitting_fee_cents: 3000,
      currency: "cad",
    },
    source: { school_name: "Test School", status: "active" },
    kind: "school",
    slots: [
      { id: "slot-1", start_at: "2026-08-18T13:00:00Z", end_at: "2026-08-18T13:05:00Z", capacity: 1 },
      { id: "slot-2", start_at: "2026-08-18T13:05:00Z", end_at: "2026-08-18T13:10:00Z", capacity: 1 },
    ],
    bookings: [
      { id: "booking-1", slot_id: "slot-1", status: "confirmed", created_at: "2026-07-20T12:00:00Z" },
      { id: "booking-2", slot_id: "slot-2", status: "cancelled", created_at: "2026-07-20T13:00:00Z" },
    ],
    payments: [
      { booking_id: "booking-1", status: "succeeded", amount_cents: 3000 },
    ],
  });

  assert.equal(summary.name, "Test School");
  assert.equal(summary.capacity, 2);
  assert.equal(summary.booked, 1);
  assert.equal(summary.remaining, 1);
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.paidBookings, 1);
  assert.equal(summary.revenueCents, 3000);
  assert.equal(summary.days[0]?.booked, 1);
});

test("Studio Bookings APIs require the platform owner", () => {
  for (const route of [overviewRoute, detailRoute, exportRoute]) {
    assert.match(route, /resolveDashboardAuth\(request\)/);
    assert.match(route, /if \(!user\)/);
    assert.match(route, /photographer\.is_platform_admin/);
    assert.match(route, /status: 401|, 401\)/);
    assert.match(route, /status: 403|\n\s*403,/);
  }
});

test("Studio Bookings APIs remain read-only and private", () => {
  for (const route of [overviewRoute, detailRoute, exportRoute]) {
    assert.doesNotMatch(route, /\.insert\s*\(/);
    assert.doesNotMatch(route, /\.update\s*\(/);
    assert.doesNotMatch(route, /\.upsert\s*\(/);
    assert.doesNotMatch(route, /\.delete\s*\(/);
    assert.match(route, /Cache-Control["']:\s*["']private, no-store/);
  }
  assert.doesNotMatch(detailRoute, /access_pin|public_token|stripe_payment_intent_id|stripe_charge_id/);
  assert.doesNotMatch(exportRoute, /access_pin|public_token|stripe_payment_intent_id|stripe_charge_id/);
  assert.match(exportRoute, /Content-Type["']:\s*["']application\/pdf/);
  assert.match(exportRoute, /Content-Disposition/);
  assert.match(exportRoute, /X-Content-Type-Options["']:\s*["']nosniff/);
});

test("Studio Bookings keeps service credentials out of owner pages", () => {
  assert.doesNotMatch(overviewPage, /SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY/);
  assert.match(overviewPage, /\/api\/dashboard\/admin\/bookings/);
  assert.match(exportControl, /Authorization:\s*`Bearer/);
  assert.match(exportControl, /blob\.type !== "application\/pdf"/);
});

test("Studio Bookings creates a real paginated PDF with safe filenames", async () => {
  const detail = {
    ok: true,
    checkedAt: "2026-07-24T20:00:00Z",
    event: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Example School / Campus",
      kind: "school",
      enabled: true,
      sourceStatus: "active",
      timezone: "America/Toronto",
      slotMinutes: 5,
      requirePayment: true,
      sittingFeeCents: 3000,
      currency: "CAD",
      includesDigitalImages: false,
      capacity: 1,
      booked: 1,
      remaining: 0,
      cancelled: 0,
      totalRecords: 1,
      percentFilled: 100,
      paidBookings: 1,
      failedPayments: 0,
      revenueCents: 3000,
      firstSlotAt: "2026-08-18T13:00:00Z",
      lastSlotAt: "2026-08-18T13:05:00Z",
      lastBookingAt: "2026-07-20T13:00:00Z",
      createdAt: "2026-07-01T12:00:00Z",
      updatedAt: "2026-07-20T13:00:00Z",
      days: [],
      publicUrl: "/book?event=11111111-1111-4111-8111-111111111111",
    },
    slots: [{ id: "slot-1", startAt: "2026-08-18T13:00:00Z", endAt: "2026-08-18T13:05:00Z", status: "booked", capacity: 1, bookedCount: 1 }],
    bookings: [{
      id: "booking-1",
      slotId: "slot-1",
      status: "confirmed",
      studentName: "Example Student",
      className: "Class A",
      parentName: "Example Parent",
      parentEmail: "parent@example.com",
      parentPhone: null,
      notes: null,
      consentRecordedAt: "2026-07-20T13:00:00Z",
      createdAt: "2026-07-20T13:00:00Z",
      updatedAt: null,
      paymentStatus: "succeeded",
      paymentAmountCents: 3000,
      paymentCurrency: "CAD",
    }],
  };
  const bytes = await createStudioBookingsPdf(detail, "confirmed");
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
  assert.match(document.getTitle() ?? "", /Confirmed bookings/);
  assert.equal(safeBookingPdfFilename(detail.event.name, "confirmed"), "example-school-campus-confirmed-bookings.pdf");
});

test("Studio Bookings appears only inside the owner navigation section", () => {
  const ownerSection = sidebarSource.slice(sidebarSource.indexOf("{isAdmin && ("));
  assert.match(ownerSection, /href="\/dashboard\/admin\/bookings"/);
  assert.match(ownerSection, /Studio Bookings/);
});
