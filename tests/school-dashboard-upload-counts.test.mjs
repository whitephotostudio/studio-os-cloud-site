import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const schoolsPageSource = source("app/dashboard/schools/page.tsx");
const photoCountsRouteSource = source(
  "app/api/dashboard/schools/photo-counts/route.ts",
);
const r2Source = source("lib/r2.ts");

test("school cards distinguish people with photos from original uploads", () => {
  assert.match(schoolsPageSource, /\{school\.imagesCount\} with photos/);
  assert.doesNotMatch(schoolsPageSource, /\{school\.imagesCount\} photos/);
  assert.match(schoolsPageSource, /\{school\.uploadedPhotoCount\} uploaded/);
  assert.match(schoolsPageSource, /uploadedPhotoCountVerified/);
});

test("school counts load after the grid in bounded batches", () => {
  assert.match(
    schoolsPageSource,
    /const batchSize = 25/,
  );
  assert.match(schoolsPageSource, /method: "POST"/);
  assert.match(schoolsPageSource, /body: JSON\.stringify\(\{ schoolIds \}\)/);
  assert.match(schoolsPageSource, /cache: "no-store"/);
  assert.match(
    schoolsPageSource,
    /setSchools\(cards\);\s*void loadUploadedPhotoCounts\(cards\);/,
  );
  assert.match(
    schoolsPageSource,
    /uploaded photo counts unavailable:/,
  );
});

test("photo-count API is authenticated, agreement-gated, and owner-scoped", () => {
  assert.match(photoCountsRouteSource, /resolveDashboardAuth\(request\)/);
  assert.match(photoCountsRouteSource, /guardAgreement\(/);
  assert.match(
    photoCountsRouteSource,
    /\.from\("schools"\)[\s\S]*\.eq\("photographer_id", photographer\.id\)[\s\S]*\.in\("id", requestedSchoolIds\)/,
  );
  assert.match(photoCountsRouteSource, /MAX_SCHOOLS_PER_REQUEST = 100/);
  assert.match(photoCountsRouteSource, /namespace: "school-photo-counts"/);
  assert.match(photoCountsRouteSource, /if \(!limit\.allowed\)/);
  assert.match(photoCountsRouteSource, /private, no-store, max-age=0/);
});

test("uploaded totals use the count-only R2 path with bounded concurrency", () => {
  assert.match(photoCountsRouteSource, /pooledForEach\([\s\S]*, 4,/);
  assert.match(
    photoCountsRouteSource,
    /countR2FolderImages\(prefix, \{[\s\S]*excludedFamilies:/,
  );
  assert.match(photoCountsRouteSource, /loadSchoolPhotoTombstones/);
  assert.doesNotMatch(photoCountsRouteSource, /findSyncedSchoolProjectId\(/);
  assert.doesNotMatch(photoCountsRouteSource, /\.from\("media"\)/);
  assert.match(
    r2Source,
    /export async function countR2FolderImages[\s\S]*isDerivedVariantKey\(name\)[\s\S]*count \+= 1/,
  );
});
