import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { proxiedPhotoUrl } from "../../lib/photo-url.ts";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const r2Source = source("lib/r2.ts");
const thumbnailSource = source("app/api/dashboard/generate-thumbnails/route.ts");
const imageProxySource = source("app/api/r2/img/[...path]/route.ts");
const schoolPhotoDeletionSource = source("lib/school-photo-deletions.ts");
const downloadProxySource = source("app/api/portal/download-file/route.ts");
const schoolAccessSource = source("app/api/portal/school-access/route.ts");
const galleryContextSource = source("app/api/portal/gallery-context/route.ts");
const backdropDashboardSource = source("app/dashboard/backdrops/page.tsx");
const orderHistorySource = source("app/api/portal/orders/history/route.ts");
const orderCreateSource = source("app/api/portal/orders/create/route.ts");
const combinedOrderCreateSource = source("app/api/portal/orders/create-combined/route.ts");
const galleryEmailSource = source("lib/event-gallery-email.ts");
const privateMediaSource = source("lib/private-media-references.ts");
const nextConfigSource = source("next.config.ts");

test("new R2 uploads persist object keys and folder lists return signed URLs", () => {
  assert.match(r2Source, /return key;/);
  assert.match(r2Source, /url: r2PresignedGetUrl\(key/);
  assert.doesNotMatch(r2Source, /function r2PublicUrl/);
  assert.doesNotMatch(thumbnailSource, /r2PublicUrl/);
  assert.match(thumbnailSource, /const originalReference = storageKey/);
});

test("browser references route private backdrops and historical R2 URLs through the auth proxy", () => {
  assert.equal(
    proxiedPhotoUrl("backdrops/photographer-1/spring 1.jpg"),
    "/api/r2/img/backdrops/photographer-1/spring%201.jpg",
  );
  assert.equal(
    proxiedPhotoUrl("https://pub-example.r2.dev/backdrops/p1/spring%201.jpg"),
    "/api/r2/img/backdrops/p1/spring%201.jpg",
  );
  assert.equal(
    proxiedPhotoUrl("https://cdn.example.com/public/logo.png"),
    "https://cdn.example.com/public/logo.png",
  );
  assert.match(backdropDashboardSource, /proxiedPhotoUrl\(bd\.thumbnail_url \|\| bd\.image_url\)/);
});

test("authenticated image proxy covers every active owned R2 namespace", () => {
  for (const namespace of ["backdrops", "projects", "probes", "schools", "photos", "nobg-photos"]) {
    assert.match(imageProxySource, new RegExp(`firstSegment === ["']${namespace}["']`));
  }
  assert.match(imageProxySource, /secondSegment === photographerId/);
  assert.match(imageProxySource, /ownsProject\(thirdSegment\)/);
  assert.match(imageProxySource, /ownedSchoolId\(thirdSegment\)/);
  assert.match(
    schoolPhotoDeletionSource,
    /\.eq\("school_id", normalizedSchoolId\)/,
  );
  assert.match(
    imageProxySource,
    /loadTombstonedFamilies\([\s\S]*authorizedSchoolId/,
  );
  assert.match(imageProxySource, /normalizeR2Key\(rawStoragePath,/);
  assert.doesNotMatch(imageProxySource, /unauthorized path: %s/);
});

test("image proxy loads optional Sharp only for an authorized resize request", () => {
  assert.doesNotMatch(
    imageProxySource,
    /^import\s+sharp\s+from\s+["']sharp["'];/m,
  );
  assert.match(
    imageProxySource,
    /if \(thumbWidth > 0\) \{\s*try \{[\s\S]*?await import\(["']sharp["']\)/,
  );
  assert.ok(
    imageProxySource.indexOf("if (!authorized)") <
      imageProxySource.indexOf('await import("sharp")'),
    "authorization must complete before the native image runtime is loaded",
  );
});

test("immutable static-asset caching never captures image-shaped API responses", () => {
  assert.match(
    nextConfigSource,
    /source: "\/\(\(\?!api\/\)\.\*\)\\\\\.\(js\|css\|woff2\?\|png\|jpg/,
  );
});

test("parent portal signs backdrop references and generic downloads reject public R2 origins", () => {
  assert.match(schoolAccessSource, /backdrops: signBackdropRows\(/);
  assert.match(galleryContextSource, /backdropRows = signBackdropRows\(/);
  assert.match(schoolAccessSource, /studentCandidates: signedStudentCandidates/);
  assert.match(galleryContextSource, /studentCandidates: signedStudentCandidates/);
  assert.match(schoolAccessSource, /primaryStudent: signedPrimaryStudent/);
  assert.match(galleryContextSource, /primaryStudent: signedPrimaryStudent/);
  assert.doesNotMatch(downloadProxySource, /R2_PUBLIC_URL/);
  assert.match(downloadProxySource, /isAllowedSignedR2Url\(target\)/);
});

test("order history refreshes legacy media while new orders store durable keys", () => {
  assert.match(privateMediaSource, /\.r2\\\.dev\$\/i/);
  assert.match(privateMediaSource, /\.r2\\\.cloudflarestorage\\\.com\$\/i/);
  assert.match(privateMediaSource, /r2KeyFromAnyUrl\(value\)/);
  assert.match(privateMediaSource, /return safeR2Key\(raw\) \|\| raw/);
  assert.match(orderHistorySource, /signPrivateMediaReferencesDeep\(/);
  assert.match(orderHistorySource, /signedPrivateMediaReference\(/);
  assert.doesNotMatch(orderHistorySource, /cartSnapshot: row\.cart_snapshot/);
  assert.match(orderHistorySource, /specialNotes: signedSpecialNotes/);
  assert.doesNotMatch(orderHistorySource, /specialNotes: row\.special_notes/);
  assert.match(orderCreateSource, /durablePrivateMediaReference\(/);
  assert.match(combinedOrderCreateSource, /durablePrivateMediaReference\(/);
  assert.match(galleryEmailSource, /EMAIL_COVER_MEDIA_TTL_SECONDS/);
  assert.match(galleryEmailSource, /signedPrivateMediaReference\(/);
});
