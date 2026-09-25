import assert from "node:assert/strict";
import test from "node:test";
import { buildSchoolClassEmailAudience } from "../lib/school-gallery-email-personalization.ts";

test("class audience sends only selected classes with uploaded photos", () => {
  const result = buildSchoolClassEmailAudience({
    students: [
      { id: "s7", first_name: "Seven", last_name: "Student", pin: "70001", class_name: "Grade 7", photo_url: "schools/demo/Grade 7/Seven.jpg", role: "Student" },
      { id: "s8", first_name: "Eight", last_name: "Student", pin: "80001", class_name: "Grade 8", photo_url: null, role: "Student" },
    ],
    bookings: [],
    contacts: [{ student_id: "s7", email: "parent@example.com" }, { student_id: "s8", email: "other@example.com" }],
    visitorEmails: ["parent@example.com", "unlinked@example.com"],
    classNames: ["Grade 7", "Grade 8"],
    onlyWithPhotos: true,
  });
  assert.deepEqual(result.classOptions, ["Grade 7", "Grade 8"]);
  assert.equal(result.deliveries.length, 1);
  assert.equal(result.deliveries[0].studentPin, "70001");
  assert.equal(result.summary.withoutPhotos, 1);
  assert.equal(result.summary.unlinkedRegistrations, 0);
});

test("class audience includes an unlinked preregistration without exposing a PIN", () => {
  const result = buildSchoolClassEmailAudience({
    students: [{ id: "s7", first_name: "Seven", last_name: "Student", pin: "70001", class_name: "Grade 7", photo_url: "ready.jpg", role: "Student" }],
    bookings: [], contacts: [], visitorEmails: ["waiting@example.com"],
    prereleaseRegistrations: [{ email: "waiting@example.com", class_names: ["Grade 7"] }],
    classNames: ["Grade 7"], onlyWithPhotos: true,
  });
  assert.equal(result.deliveries.length, 1);
  assert.equal(result.deliveries[0].recipientEmail, "waiting@example.com");
  assert.equal(result.deliveries[0].studentPin, "");
  assert.equal(result.summary.unlinkedRegistrations, 1);
});

test("class audience can include a selected class before photos are uploaded", () => {
  const result = buildSchoolClassEmailAudience({
    students: [{ id: "s7", first_name: "Seven", last_name: "Student", pin: "70001", class_name: "Grade 7", photo_url: null, role: "Student" }],
    bookings: [], contacts: [], visitorEmails: [], classNames: ["Grade 7"], onlyWithPhotos: false,
  });
  assert.equal(result.deliveries.length, 0);
  assert.equal(result.summary.withoutPhotos, 0);
  assert.equal(result.summary.missingEmail, 1);
});
