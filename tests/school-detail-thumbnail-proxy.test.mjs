import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  proxiedPhotoUrl,
  versionedProxiedPhotoUrl,
} from "../lib/photo-url.ts";

const detailSource = readFileSync(
  new URL("../app/dashboard/projects/schools/[schoolId]/page.tsx", import.meta.url),
  "utf8",
);

test("school overview display URLs proxy durable keys with a replaceable revision", () => {
  assert.equal(
    versionedProxiedPhotoUrl(
      "local-london/class/student/photo_preview.jpg",
      "school-overview-1",
    ),
    "/api/r2/img/local-london/class/student/photo_preview.jpg?v=school-overview-1",
  );
  assert.equal(
    versionedProxiedPhotoUrl(
      "/api/r2/img/local-london/photo.jpg?v=old&w=320",
      "school-overview-1",
    ),
    "/api/r2/img/local-london/photo.jpg?v=school-overview-1&w=320",
  );
  assert.equal(
    versionedProxiedPhotoUrl(
      "https://cdn.example.com/manual cover.jpg",
      "school-overview-1",
    ),
    "https://cdn.example.com/manual%20cover.jpg",
  );
  assert.equal(proxiedPhotoUrl("not-an-image-key"), "");
});

test("school overview routes every photo surface through one display helper", () => {
  assert.match(detailSource, /function schoolOverviewPhotoUrl/);
  assert.match(detailSource, /const schoolCoverDisplayUrl = schoolOverviewPhotoUrl\(grouped\.schoolCover\)/);
  assert.match(detailSource, /const cover = schoolOverviewPhotoUrl\(classCard\.coverPhoto\)/);
  assert.match(detailSource, /const roleCover = schoolOverviewPhotoUrl\(roleCard\.coverPhoto\)/);
  assert.match(detailSource, /src=\{schoolOverviewPhotoUrl\(person\.photo_url\)\}/);
  assert.equal(
    (detailSource.match(/const displayUrl = schoolOverviewPhotoUrl\(item\.url\)/g) ?? []).length,
    3,
  );
  assert.doesNotMatch(detailSource, /src=\{person\.photo_url\}/);
  assert.doesNotMatch(detailSource, /url\(\$\{grouped\.schoolCover\}\)/);
});

test("cover picker persists durable object keys and keeps raw selection values", () => {
  assert.match(detailSource, /url: clean\(file\.key\) \|\| clean\(file\.url\)/);
  assert.match(detailSource, /body: JSON\.stringify\(\{ cover_photo_url: selectedSchoolCoverUrl \}\)/);
  assert.match(detailSource, /cover_photo_url: selectedClassCoverUrl/);
  assert.match(detailSource, /cover_photo_url: selectedRoleCoverUrl/);
  assert.doesNotMatch(detailSource, /cover_photo_url: schoolOverviewPhotoUrl/);
});

test("thumbnail repair preserves strict school identity and intentional empty classes", () => {
  assert.match(detailSource, /findSyncedSchoolProjectId/);
  assert.match(detailSource, /ensureSyncedSchoolProjectId/);
  assert.match(detailSource, /totalPeopleWithPhotos/);
  assert.match(detailSource, /No students assigned/);
});
