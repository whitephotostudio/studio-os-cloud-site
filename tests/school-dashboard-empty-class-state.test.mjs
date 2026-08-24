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

test("the eye toggle hides empty classes everywhere without deleting them", () => {
  assert.match(
    schoolDashboardSource,
    /const \[hideEmptyClasses, setHideEmptyClasses\] = useState\(false\);/,
  );
  assert.match(
    schoolDashboardSource,
    /studioos_hide_empty_classes_\$\{schoolId\}/,
  );
  assert.match(
    schoolDashboardSource,
    /hideEmptyClasses\s*\? orderedClasses\.filter\(\(row\) => row\.count > 0\)\s*: orderedClasses/,
  );
  assert.match(schoolDashboardSource, /visibleClasses\.map\(\(classCard\) =>/);
  assert.match(schoolDashboardSource, /aria-pressed=\{hideEmptyClasses\}/);
  assert.match(schoolDashboardSource, /<EyeOff size=\{16\}/);
  assert.match(schoolDashboardSource, /<Eye size=\{16\}/);
  assert.match(
    schoolDashboardSource,
    /previous\.filter\(\(id\) => visibleKeys\.has\(id\)\)/,
  );
  assert.match(
    schoolDashboardSource,
    /All empty \$\{groupLabelPlural\.toLowerCase\(\)\} are hidden/,
  );
});
