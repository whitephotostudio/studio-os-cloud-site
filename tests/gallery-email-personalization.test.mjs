import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSchoolGalleryEmailDeliveries,
  excludeCancelledOnlyRecipientEmails,
  matchSchoolGalleryBookingsToRoster,
  resolveSchoolGalleryStudentRecipient,
} from "../lib/school-gallery-email-personalization.ts";

test("matches exact name and class, then only a unique exact name fallback", () => {
  const students = [
    {
      id: "student-a",
      first_name: "Alex",
      last_name: "Lee",
      class_name: "Grade 1",
      pin: "11111",
    },
    {
      id: "student-b",
      first_name: "Alex",
      last_name: "Lee",
      class_name: "Grade 2",
      pin: "22222",
    },
    {
      id: "student-c",
      first_name: "Sam",
      last_name: "Green",
      class_name: "Grade 3",
      pin: "33333",
    },
  ];
  const matched = matchSchoolGalleryBookingsToRoster(
    [
      {
        id: "booking-a",
        parent_email: "alex@example.com",
        student_first_name: " alex ",
        student_last_name: "LEE",
        class_name: "grade 2",
        status: "confirmed",
      },
      {
        id: "booking-c",
        parent_email: "sam@example.com",
        student_first_name: "Sam",
        student_last_name: "Green",
        class_name: "Old class label",
        status: "confirmed",
      },
      {
        id: "booking-ambiguous",
        parent_email: "unknown@example.com",
        student_first_name: "Alex",
        student_last_name: "Lee",
        class_name: "",
        status: "confirmed",
      },
    ],
    students,
  );

  assert.deepEqual(
    matched.map((row) => [row.id, row.student_id, row.access_pin]),
    [
      ["booking-a", "student-b", "22222"],
      ["booking-c", "student-c", "33333"],
    ],
  );
});

test("creates one isolated delivery per email and immutable student id", () => {
  const deliveries = buildSchoolGalleryEmailDeliveries(
    ["parent@example.com", "visitor@example.com"],
    [
      {
        id: "booking-one",
        student_id: "student-one",
        parent_email: "parent@example.com",
        access_pin: "11111",
        roster_parent_email: "",
        student_first_name: "First",
        student_last_name: "Student",
        status: "confirmed",
      },
      {
        id: "booking-two",
        student_id: "student-two",
        parent_email: "PARENT@example.com",
        access_pin: "11111",
        roster_parent_email: "",
        student_first_name: "Second",
        student_last_name: "Student",
        status: "confirmed",
      },
      {
        id: "booking-duplicate",
        student_id: "student-one",
        parent_email: "parent@example.com",
        access_pin: "11111",
        roster_parent_email: "",
        student_first_name: "First",
        student_last_name: "Student",
        status: "confirmed",
      },
    ],
    true,
  );

  assert.deepEqual(deliveries, [
    {
      recipientEmail: "parent@example.com",
      bookingId: "booking-one",
      studentId: "student-one",
      studentName: "First Student",
      studentPin: "11111",
    },
    {
      recipientEmail: "parent@example.com",
      bookingId: "booking-two",
      studentId: "student-two",
      studentName: "Second Student",
      studentPin: "11111",
    },
    {
      recipientEmail: "visitor@example.com",
      bookingId: null,
      studentId: null,
      studentName: "",
      studentPin: "",
    },
  ]);
});

test("custom recipients never receive a looked-up student PIN", () => {
  const deliveries = buildSchoolGalleryEmailDeliveries(
    ["parent@example.com"],
    [],
    false,
  );
  assert.deepEqual(deliveries, [
    {
      recipientEmail: "parent@example.com",
      bookingId: null,
      studentId: null,
      studentName: "",
      studentPin: "",
    },
  ]);
});

test("uses the owned roster parent email only when the booking email is missing", () => {
  const deliveries = buildSchoolGalleryEmailDeliveries(
    ["roster-parent@example.com"],
    [
      {
        id: "booking-one",
        student_id: "student-one",
        parent_email: "",
        roster_parent_email: "ROSTER-PARENT@example.com",
        access_pin: "11111",
        student_first_name: "First",
        student_last_name: "Student",
        status: "confirmed",
      },
    ],
    true,
  );

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].recipientEmail, "roster-parent@example.com");
  assert.equal(deliveries[0].studentId, "student-one");
  assert.equal(deliveries[0].studentPin, "11111");
});

test("uses a valid roster email when the booking email is malformed", () => {
  const deliveries = buildSchoolGalleryEmailDeliveries(
    ["roster-parent@example.com"],
    [
      {
        id: "booking-one",
        student_id: "student-one",
        parent_email: "not-an-email",
        roster_parent_email: "roster-parent@example.com",
        access_pin: "11111",
        student_first_name: "First",
        student_last_name: "Student",
        status: "confirmed",
      },
    ],
    true,
  );

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].recipientEmail, "roster-parent@example.com");
  assert.equal(deliveries[0].studentPin, "11111");
});

test("does not personalize when one student has conflicting registered emails", () => {
  const deliveries = buildSchoolGalleryEmailDeliveries(
    ["booking-parent@example.com", "roster-parent@example.com"],
    [
      {
        id: "booking-one",
        student_id: "student-one",
        parent_email: "booking-parent@example.com",
        roster_parent_email: "roster-parent@example.com",
        access_pin: "11111",
        student_first_name: "First",
        student_last_name: "Student",
        status: "confirmed",
      },
      {
        id: "booking-two",
        student_id: "student-one",
        parent_email: "",
        roster_parent_email: "roster-parent@example.com",
        access_pin: "11111",
        student_first_name: "First",
        student_last_name: "Student",
        status: "confirmed",
      },
    ],
    true,
  );

  assert.equal(deliveries.length, 2);
  assert.ok(deliveries.every((delivery) => delivery.studentPin === ""));
  assert.ok(deliveries.every((delivery) => delivery.studentId === null));
});

test("resolves one student across every confirmed row and blocks a stale roster conflict", () => {
  const rows = [
    {
      id: "booking-without-email",
      student_id: "student-one",
      parent_email: "",
      roster_parent_email: "old@example.com",
      access_pin: "11111",
      status: "confirmed",
    },
    {
      id: "booking-with-current-email",
      student_id: "student-one",
      parent_email: "current@example.com",
      roster_parent_email: "old@example.com",
      access_pin: "11111",
      status: "confirmed",
    },
  ];

  assert.deepEqual(
    resolveSchoolGalleryStudentRecipient(rows, "old@example.com"),
    { recipientEmail: "", conflict: true },
  );
  assert.deepEqual(
    resolveSchoolGalleryStudentRecipient(
      rows.map((row) => ({ ...row, roster_parent_email: "current@example.com" })),
      "current@example.com",
    ),
    { recipientEmail: "current@example.com", conflict: false },
  );
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
