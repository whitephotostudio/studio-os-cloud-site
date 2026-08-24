import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const schoolAccessSource = source("app/api/portal/school-access/route.ts");
const galleryContextSource = source("app/api/portal/gallery-context/route.ts");
const schoolDownloadsSource = source("app/api/portal/school-downloads/route.ts");

const portalRoutes = [
  ["school access", schoolAccessSource],
  ["gallery context", galleryContextSource],
  ["school downloads", schoolDownloadsSource],
];

test("portal PIN authorization never expands through a duplicate school name", () => {
  for (const [label, routeSource] of portalRoutes) {
    assert.doesNotMatch(routeSource, /\.ilike\("school_name"/, label);
    assert.doesNotMatch(routeSource, /sameName(?:Result|Schools|Full)/, label);
    assert.doesNotMatch(routeSource, /candidateSchoolIds|schoolIdsToSearch/, label);
    assert.doesNotMatch(routeSource, /\.in\(\s*"school_id"/, label);
  }
});

test("each portal path binds its student PIN query to selectedSchoolId", () => {
  for (const [label, routeSource] of portalRoutes) {
    assert.match(
      routeSource,
      /\.from\("students"\)[\s\S]*?\.eq\("pin", selectedPin\)[\s\S]*?\.eq\("school_id", selectedSchoolId\)/,
      label,
    );
  }

  assert.match(
    schoolAccessSource,
    /const resolvedSchoolId = selectedSchoolId;/,
  );
  assert.match(
    galleryContextSource,
    /const schoolRowsForMatch: SchoolRow\[\] = \[currentSchool\];/,
  );
  assert.match(galleryContextSource, /const activeSchool = currentSchool;/);
  assert.match(schoolDownloadsSource, /schoolId: selectedSchoolId,/);
  assert.match(schoolDownloadsSource, /school: schoolRow,/);
});

test("prefetched school access keeps the selected-school response shape", () => {
  assert.match(schoolAccessSource, /currentSchool: selectedSchool,/);
  assert.match(schoolAccessSource, /schoolRowsForMatch: \[gallerySchool\],/);
  assert.match(schoolAccessSource, /activeSchool: gallerySchool,/);
  assert.match(schoolAccessSource, /schoolId: resolvedSchoolId,/);
});
