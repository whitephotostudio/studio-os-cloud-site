import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { proxiedPhotoUrl } from "../lib/photo-url.ts";

const schoolsDashboardSource = readFileSync(
  new URL("../app/dashboard/schools/page.tsx", import.meta.url),
  "utf8",
);
const mobileSchoolsSource = readFileSync(
  new URL("../app/m/schools/page.tsx", import.meta.url),
  "utf8",
);

test("school card covers route durable R2 keys through the authenticated image proxy", () => {
  assert.equal(
    proxiedPhotoUrl("schools/local-london/student-1/photo_thumbnail.jpg"),
    "/api/r2/img/schools/local-london/student-1/photo_thumbnail.jpg",
  );
  assert.match(
    schoolsDashboardSource,
    /const rawCoverUrl = proxiedPhotoUrl\(school\.coverUrl\)/,
  );
  assert.match(schoolsDashboardSource, /v=school-cover-2/);
  assert.match(schoolsDashboardSource, /src=\{coverUrl\}/);
  assert.doesNotMatch(schoolsDashboardSource, /src=\{school\.coverUrl\}/);
});

test("manual web covers and already-proxied covers keep their selected source", () => {
  assert.equal(
    proxiedPhotoUrl("https://cdn.example.com/manual covers/london.jpg"),
    "https://cdn.example.com/manual%20covers/london.jpg",
  );
  assert.equal(
    proxiedPhotoUrl("/api/r2/img/schools/local-london/manual.jpg"),
    "/api/r2/img/schools/local-london/manual.jpg",
  );
});

test("school card cover selection resolves both campus links as one identity", () => {
  assert.match(
    schoolsDashboardSource,
    /selectSyncedSchoolProjectCandidate\([\s\S]*?schoolId: school\.id,[\s\S]*?localSchoolId: school\.local_school_id/,
  );
  assert.doesNotMatch(schoolsDashboardSource, /schoolCoverByLocalId/);
  assert.doesNotMatch(schoolsDashboardSource, /schoolCoverBySchoolId/);
});

test("mobile school cards proxy stored keys and resize only same-origin proxy URLs", () => {
  assert.match(
    mobileSchoolsSource,
    /const cover = proxiedPhotoUrl\(coversBySchool\[school\.id\]\)/,
  );
  assert.match(
    mobileSchoolsSource,
    /cover\.startsWith\("\/api\/r2\/img\/"\)/,
  );
  assert.match(mobileSchoolsSource, /w=320&v=school-cover-2/);
  assert.match(mobileSchoolsSource, /src=\{thumbnailCover\}/);
  assert.doesNotMatch(mobileSchoolsSource, /src=\{`\$\{cover\}\?w=320`\}/);
});

test("empty schools keep the intentional placeholder instead of requesting an image", () => {
  assert.equal(proxiedPhotoUrl(null), "");
  assert.match(
    schoolsDashboardSource,
    /background: coverUrl \? "#0f172a" : gradientForSchool\(school\.school_name\)/,
  );
  assert.match(schoolsDashboardSource, /\{coverUrl \? \(/);
});
