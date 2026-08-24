import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schoolDashboardSource = readFileSync(
  new URL(
    "../app/dashboard/projects/schools/[schoolId]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("school activity labels the representative-photo count accurately", () => {
  assert.match(schoolDashboardSource, /totalPeopleWithPhotos:/);
  assert.match(schoolDashboardSource, /\["People with photos", grouped\.totalPeopleWithPhotos\]/);
  assert.doesNotMatch(schoolDashboardSource, /\["Synced Photos",/);
});

test("empty classes use a neutral explicit placeholder instead of an error-like red tile", () => {
  assert.match(schoolDashboardSource, /const isEmptyClass = studentCount === 0;/);
  assert.match(schoolDashboardSource, /linear-gradient\(135deg,#f8fafc,#e2e8f0\)/);
  assert.match(schoolDashboardSource, /Empty \$\{groupLabelSingular\.toLowerCase\(\)\}/);
  assert.match(schoolDashboardSource, /No students assigned/);
});
