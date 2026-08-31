import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIndependentRosterEmailRows,
  buildSchoolGalleryEmailDeliveries,
  excludeCancelledOnlyRecipientEmails,
} from "../lib/school-gallery-email-personalization.ts";

test("booking rows remain authoritative over synced roster duplicates", () => {
  const rows = buildIndependentRosterEmailRows(
    [
      {
        id: "manual-student",
        first_name: "Manual",
        last_name: "Student",
        pin: "11111",
        parent_email: "wrong@example.com",
        role: "Student",
      },
      {
        id: "walkin-student",
        first_name: "Walk",
        last_name: "In",
        pin: "22222",
        parent_email: "walkin@example.com",
        role: "Student",
      },
      {
        id: "teacher-row",
        first_name: "School",
        last_name: "Staff",
        pin: "33333",
        parent_email: "staff@example.com",
        role: "Teacher",
      },
    ],
    [{ access_pin: "11111", status: "cancelled" }],
  );

  assert.deepEqual(rows, [
    {
      id: null,
      student_id: "walkin-student",
      parent_email: "walkin@example.com",
      access_pin: "22222",
      student_first_name: "Walk",
      student_last_name: "In",
      class_name: undefined,
      status: "manual",
    },
  ]);
});

test("creates one isolated delivery per student PIN", () => {
  const deliveries = buildSchoolGalleryEmailDeliveries(
    ["parent@example.com", "visitor@example.com"],
    [
      {
        id: "booking-one",
        parent_email: "parent@example.com",
        access_pin: "11111",
        student_first_name: "First",
        student_last_name: "Student",
        status: "confirmed",
      },
      {
        id: "booking-two",
        parent_email: "PARENT@example.com",
        access_pin: "22222",
        student_first_name: "Second",
        student_last_name: "Student",
        status: "confirmed",
      },
      {
        id: "booking-cancelled",
        parent_email: "parent@example.com",
        access_pin: "33333",
        student_first_name: "Cancelled",
        student_last_name: "Student",
        status: "cancelled",
      },
    ],
    true,
  );

  assert.deepEqual(deliveries, [
    {
      recipientEmail: "parent@example.com",
      bookingId: "booking-one",
      studentName: "First Student",
      studentPin: "11111",
    },
    {
      recipientEmail: "parent@example.com",
      bookingId: "booking-two",
      studentName: "Second Student",
      studentPin: "22222",
    },
    {
      recipientEmail: "visitor@example.com",
      bookingId: null,
      studentName: "",
      studentPin: "",
    },
  ]);
});

test("custom recipients never receive a looked-up student PIN", () => {
  const deliveries = buildSchoolGalleryEmailDeliveries(
    ["parent@example.com"],
    [{ parent_email: "parent@example.com", access_pin: "11111" }],
    false,
  );
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].studentPin, "");
});

test("manual roster students receive an isolated PIN delivery", () => {
  const deliveries = buildSchoolGalleryEmailDeliveries(
    ["walkin-parent@example.com"],
    [
      {
        student_id: "student-walkin",
        parent_email: "walkin-parent@example.com",
        access_pin: "44556",
        student_first_name: "Walk",
        student_last_name: "In",
        status: "manual",
      },
    ],
    true,
  );

  assert.deepEqual(deliveries, [
    {
      recipientEmail: "walkin-parent@example.com",
      bookingId: null,
      studentId: "student-walkin",
      studentName: "Walk In",
      studentPin: "44556",
    },
  ]);
});

test("cancelled-only booking addresses are excluded from visitor campaigns", () => {
  const recipients = excludeCancelledOnlyRecipientEmails(
    ["cancelled@example.com", "shared@example.com", "visitor@example.com"],
    [
      { parent_email: "cancelled@example.com", status: "cancelled" },
      { parent_email: "shared@example.com", status: "canceled" },
      { parent_email: "SHARED@example.com", status: "confirmed" },
    ],
  );

  assert.deepEqual(recipients, ["shared@example.com", "visitor@example.com"]);
});
