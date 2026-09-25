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
    classNames: ["Grade 7"], onlyWithPhotos: true, includeClassRegistrations: true,
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

const readyStudent = (id, className, email) => ({ id, first_name: id, pin: id, class_name: className, photo_url: 'ready.jpg', parent_email: email, role: 'Student' });
const audience = overrides => buildSchoolClassEmailAudience({ students: [], bookings: [], contacts: [], classNames: ['Grade 7'], onlyWithPhotos: true, ...overrides });
test('shared family email cannot pull in a sibling from an unselected class', () => {
  const result = audience({ students: [readyStudent('s7', 'Grade 7', 'family@example.com'), readyStudent('s12', 'Grade 12', 'family@example.com')] });
  assert.deepEqual(result.deliveries.map(row => row.studentPin), ['s7']);
});
test('one uploaded classmate cannot make unknown parents qualify for the uploaded-photo filter', () => {
  const result = audience({ students: [readyStudent('s7', 'Grade 7', 'linked@example.com')], prereleaseRegistrations: [{ email: 'unknown@example.com', class_names: ['Grade 7'] }] });
  assert.deepEqual(result.deliveries.map(row => row.recipientEmail), ['linked@example.com']);
  assert.equal(result.summary.classRegistrationsIncluded, 0);
});
test('explicit class registrations are PIN-free and cannot bypass a linked child with no photos or a cancelled booking', () => {
  const result = audience({
    students: [{ ...readyStudent('s7', 'Grade 7', 'waiting@example.com'), photo_url: null }, readyStudent('cancelled', 'Grade 7', 'cancelled@example.com')],
    bookings: [{ id: 'b1', access_pin: 'cancelled', class_name: 'Grade 7', parent_email: 'cancelled@example.com', status: 'cancelled' }],
    prereleaseRegistrations: [
      { email: 'waiting@example.com', class_names: ['Grade 7'] },
      { email: 'cancelled@example.com', class_names: ['Grade 7'] },
      { email: 'unlinked@example.com', class_names: ['Grade 7'] },
      { email: 'outside@example.com', class_names: ['Grade 12'] },
    ], includeClassRegistrations: true,
  });
  assert.deepEqual(result.deliveries.map(row => [row.recipientEmail, row.studentPin]), [['unlinked@example.com', '']]);
  assert.equal(result.summary.withoutPhotos, 1);
  assert.equal(result.summary.cancelledExcluded, 1);
});
test('duplicate PINs and conflicting bookings cannot send personalized student data', () => {
  for (const additions of [
    { students: [readyStudent('same', 'Grade 7', 'one@example.com'), { ...readyStudent('other', 'Grade 7', 'two@example.com'), pin: 'same' }] },
    { students: [readyStudent('same', 'Grade 7', 'one@example.com')], bookings: [
      { id: 'one', access_pin: 'same', parent_email: 'one@example.com' }, { id: 'two', access_pin: 'same', parent_email: 'two@example.com' },
    ] },
  ]) {
    const result = audience(additions);
    assert.equal(result.deliveries.length, 0); assert.equal(result.summary.ambiguous, 2);
  }
});
test('updating the recipient review detects new photos and class changes', () => {
  const row = readyStudent('s7', 'Grade 7', 'parent@example.com');
  assert.equal(audience({ students: [row] }).deliveries.length, 1);
  assert.equal(audience({ students: [{ ...row, class_name: 'Grade 12' }] }).deliveries.length, 0);
  assert.equal(audience({ students: [{ ...row, photo_url: null }] }).deliveries.length, 0);
});
