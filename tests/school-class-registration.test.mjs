import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const registration = readFileSync(new URL("../app/api/portal/pre-release-register/route.ts", import.meta.url), "utf8");
const directForm = readFileSync(new URL("../app/parents/SchoolDirectLoginForm.tsx", import.meta.url), "utf8");
const form = readFileSync(new URL("../app/parents/LoginForm.tsx", import.meta.url), "utf8");
const selector = readFileSync(new URL("../app/parents/SchoolRegistrationClasses.tsx", import.meta.url), "utf8");

test("school prerelease registration requires a roster-backed class", () => {
  assert.match(registration, /schoolRegistrationClasses/);
  assert.match(registration, /Please select your child.s class or grade/);
  assert.match(registration, /schoolRegistrationClasses\(service, selectedSchoolId\)/);
  assert.match(directForm, /<SchoolRegistrationClasses/);
  assert.match(form, /<SchoolRegistrationClasses/);
  assert.match(selector, /<select required/);
  assert.doesNotMatch(selector, /optional/);
});
