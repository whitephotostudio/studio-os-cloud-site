import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeStudentRecipientEmail,
  studentRecipientEmailError,
} from "../../lib/student-recipient-email.ts";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("recipient email normalization is nullable, canonical, and validated", () => {
  assert.equal(normalizeStudentRecipientEmail(" Parent@Example.COM "), "parent@example.com");
  assert.equal(normalizeStudentRecipientEmail("   "), null);
  assert.equal(normalizeStudentRecipientEmail(null), null);
  assert.equal(studentRecipientEmailError("valid@example.com"), null);
  assert.match(studentRecipientEmailError("not-an-email"), /valid parent/i);
});

test("desktop sync preserves cloud email for omitted and blank legacy values", () => {
  const source = read("app/api/dashboard/schools/desktop-sync/route.ts");
  assert.match(source, /provided:\s*keyProvided\s*&&\s*value\s*!==\s*null/);
  assert.match(source, /email\.provided\s*\?\s*\{\s*parent_email:\s*email\.value\s*\}\s*:\s*\{\}/s);
  assert.match(source, /prepared\.filter\(\(item\) => !item\.emailProvided\)/);
  assert.match(source, /defaultToNull:\s*false/);
  assert.match(source, /defaultToNull:\s*batch\.defaultToNull/);
  assert.match(source, /onConflict:\s*["']school_id,external_student_id["']/);
  assert.match(source, /updated_at/);
  assert.match(source, /incomingExternalIdByPin/);
  assert.match(source, /existingByPin/);
  assert.match(source, /error\?\.code\s*===\s*["']23505["']/);
});

test("manual students receive stable identity and editable nullable email", () => {
  const createSource = read(
    "app/api/dashboard/schools/[schoolId]/classes/[classId]/students/route.ts",
  );
  const editSource = read(
    "app/api/dashboard/schools/[schoolId]/classes/[classId]/students/[studentId]/route.ts",
  );
  assert.match(createSource, /external_student_id:\s*`manual-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(createSource, /parent_email:\s*studentEmail/);
  assert.match(createSource, /insertError\?\.code\s*===\s*["']23505["']/);
  assert.match(editSource, /emailProvided\s*=\s*body\.studentEmail\s*!==\s*undefined/);
  assert.match(editSource, /emailProvided\s*\?\s*\{\s*parent_email:\s*nextEmail\s*\}\s*:\s*\{\}/s);
  assert.match(editSource, /updateError\?\.code\s*===\s*["']23505["']/);
});

test("migration provides a unique sync boundary and non-destructive booking merge", () => {
  const migration = read(
    "supabase/migrations/20260826190000_harden_student_recipient_sync.sql",
  );
  assert.match(migration, /unique index[\s\S]*students \(school_id, external_student_id\)/i);
  assert.match(migration, /unique index[\s\S]*students \(school_id, pin\)[\s\S]*where pin is not null/i);
  assert.match(migration, /new\.pin\s*:=\s*nullif\(btrim\(new\.pin\), ''\)/i);
  assert.match(migration, /create or replace function public\.merge_booking_roster_student/i);
  assert.match(
    migration,
    /parent_email\s*=\s*coalesce\([\s\S]*existing_student\.parent_email[\s\S]*excluded\.parent_email/i,
  );
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/i);
});
