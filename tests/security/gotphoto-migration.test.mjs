import assert from "node:assert/strict";
import test from "node:test";
import { parseMigrationCsv, previewGotphotoMigration, suggestMigrationMapping, migrationPhotoAssociationJson } from "../../lib/gotphoto-migration.ts";

const mapping = { sourceId: "GotPhoto child ID", firstName: "Firstname", lastName: "Lastname", className: "Group", parentEmail: "Email", photoFilename: "Filename" };
const csv = 'GotPhoto child ID,Firstname,Lastname,Group,Email,Filename\r\n00017,Alice,"Rivera, Jr.",12A, Parent@Example.com ,12A/00017.jpg\r\n00018,Bob,Chen,12B,,12B/00018.jpg';
const photos = [{ path: "12A/00017.jpg", sha256: "a".repeat(64), bytes: 321 }, { path: "12B/00018.jpg", sha256: "b".repeat(64), bytes: 654 }];

test("one-school sample retains leading-zero identity, quoted names and exact image paths", () => {
  const preview = previewGotphotoMigration({ kind: "roster", csv, mapping, photos });
  assert.equal(preview.issues.length, 0);
  assert.equal(preview.students.length, 2);
  assert.deepEqual(preview.students[0], { sourceId: "00017", externalId: "gotphoto:00017", firstName: "Alice", lastName: "Rivera, Jr.", className: "12A", parentEmail: "parent@example.com" });
  assert.deepEqual(preview.photoAssociations[1], { sourceId: "00018", externalId: "gotphoto:00018", ...photos[1] });
  assert.deepEqual(JSON.parse(migrationPhotoAssociationJson(preview)).associations[0], preview.photoAssociations[0]);
  assert.equal(JSON.parse(migrationPhotoAssociationJson(preview)).photosUploaded, false);
});

test("suggestions are exact and refuse ambiguous IDs or email headers", () => {
  assert.deepEqual(suggestMigrationMapping(["Firstname", "Lastname", "Identifier", "Student ID", "Email", "Parent email"], "roster"), { firstName: "Firstname", lastName: "Lastname" });
  assert.equal(suggestMigrationMapping(["GotPhoto child ID"], "roster").sourceId, "GotPhoto child ID");
});

test("CSV rejects duplicate/empty headers, malformed quoting, unequal rows and oversized data", () => {
  for (const input of ["First,first\nA,B", "A,\nX,Y", 'A,B\n"bad"text,B', 'A,B\n"unfinished,B', "A,B\nX,Y,Z", "A\n\u0000"]) assert.throws(() => parseMigrationCsv(input));
  assert.throws(() => parseMigrationCsv("X".repeat(2_000_001)), /2 MB/);
  assert.deepEqual(parseMigrationCsv('\uFEFFA,B\n"line\none","a""b"').rows, [["line\none", 'a"b']]);
});

test("existing students are skipped without names, addresses, photos or permissions being rewritten", () => {
  const preview = previewGotphotoMigration({ kind: "roster", csv, mapping, photos, existingStudentIds: ["gotphoto:00017"] });
  assert.equal(preview.students.length, 1);
  assert.equal(preview.skipped[0].identity, "00017");
  assert.match(preview.skipped[0].reason, /preserved/);
});

test("duplicate source identities, reused images and unsafe paths hold the import", () => {
  const source = "ID,First,Last,Photo\n1,A,One,A.jpg\n1,B,Two,B.jpg\n2,C,Three,A.jpg\n3,D,Four,../escape.jpg";
  const result = previewGotphotoMigration({ kind: "roster", csv: source, mapping: { sourceId: "ID", firstName: "First", lastName: "Last", photoFilename: "Photo" }, photos: [{ path: "A.jpg", sha256: "a".repeat(64), bytes: 1 }] });
  assert.equal(result.issues.length, 3);
  assert.match(result.issues[0].message, /Duplicate source/);
  assert.match(result.issues[1].message, /multiple students/);
  assert.match(result.issues[2].message, /safe/);
});

test("there is no basename or name fallback for missing photo associations", () => {
  const result = previewGotphotoMigration({ kind: "roster", csv, mapping, photos: photos.map((photo) => ({ ...photo, path: photo.path.split("/").at(-1) })) });
  assert.equal(result.students.length, 0);
  assert.equal(result.issues.length, 2);
  assert.match(result.issues[0].message, /exact selected path/);
});

test("customer emails deduplicate canonically; existing contact/consent data is never included for writes", () => {
  const result = previewGotphotoMigration({ kind: "contacts", csv: "Name,Email,Phone\nExisting, PARENT@example.com ,555\nNew Person,new@example.com,123", mapping: { fullName: "Name", email: "Email", phone: "Phone" }, existingContactEmails: ["parent@example.com"] });
  assert.equal(result.skipped.length, 1);
  assert.deepEqual(result.contacts, [{ fullName: "New Person", email: "new@example.com", phone: "123" }]);
  assert.equal("marketingConsent" in result.contacts[0], false);
});

test("invalid/multiple customer emails and duplicate mapped columns block import", () => {
  const result = previewGotphotoMigration({ kind: "contacts", csv: 'Name,Email\nA,"a@example.com,b@example.com"\nB,bad', mapping: { fullName: "Name", email: "Email" } });
  assert.equal(result.issues.length, 2);
  assert.throws(() => previewGotphotoMigration({ kind: "contacts", csv: "Name,Email\nA,a@example.com", mapping: { fullName: "Email", email: "Email" } }), /only one field/);
});

test("customer exports with separate first/last names have an explicit mapped import path", () => {
  const headers = ["Firstname", "Lastname", "Email"];
  const result = previewGotphotoMigration({ kind: "contacts", csv: "Firstname,Lastname,Email\nAna,Rivera,ana@example.com", mapping: suggestMigrationMapping(headers, "contacts") });
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.contacts, [{ fullName: "Ana Rivera", email: "ana@example.com", phone: null }]);
  assert.throws(() => previewGotphotoMigration({ kind: "contacts", csv: "Email\na@example.com", mapping: { email: "Email" } }), /customer full name/);
});
