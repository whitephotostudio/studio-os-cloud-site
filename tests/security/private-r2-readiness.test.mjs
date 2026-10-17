import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { proxiedPhotoUrl } from "../../lib/photo-url.ts";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const r2Source = source("lib/r2.ts");
const thumbnailSource = source("app/api/dashboard/generate-thumbnails/route.ts");
const imageProxySource = source("app/api/r2/img/[...path]/route.ts");
const downloadProxySource = source("app/api/portal/download-file/route.ts");
const schoolAccessSource = source("app/api/portal/school-access/route.ts");
const galleryContextSource = source("app/api/portal/gallery-context/route.ts");
const backdropDashboardSource = source("app/dashboard/backdrops/page.tsx");
const orderHistorySource = source("app/api/portal/orders/history/route.ts");
const orderCreateSource = source("app/api/portal/orders/create/route.ts");
const combinedOrderCreateSource = source("app/api/portal/orders/create-combined/route.ts");
const galleryEmailSource = source("lib/event-gallery-email.ts");
const privateMediaSource = source("lib/private-media-references.ts");
const schoolDashboardSource = source("app/dashboard/projects/schools/[schoolId]/page.tsx");

test("new R2 uploads persist object keys and folder lists return owner checked proxy URLs", () => {
  assert.match(r2Source, /return key;/);
  assert.match(r2Source, /signedR2MediaUrl\(key, ttlSeconds, options.photographerId\)/);
  assert.match(r2Source, /`\/api\/r2\/img\//);
  assert.doesNotMatch(r2Source, /r2PresignedGetUrl/);
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
  assert.match(imageProxySource, /await resolveR2MediaOwnership\(service, storagePath, photographerId\)/);
  assert.match(imageProxySource, /if \(!ownership.owned\)/);
  assert.match(imageProxySource, /const authorizedSchoolId = ownership.schoolId/);
  assert.doesNotMatch(imageProxySource, /resolveSchoolNamespace|ownsProject\(/);
  assert.match(imageProxySource, /normalizeR2Key\(rawStoragePath,/);
  assert.doesNotMatch(imageProxySource, /unauthorized path: %s/);
  assert.doesNotMatch(imageProxySource, /^import sharp from ["']sharp["'];/m);
  assert.match(imageProxySource, /await import\(["']sharp["']\)/);
});

test("school cover pickers use durable R2 keys and real image elements", () => {
  assert.match(schoolDashboardSource, /url: clean\(file\.key\) \|\| clean\(file\.url\)/);
  assert.match(schoolDashboardSource, /<img src=\{coverDisplayUrl\(item\.url\)\}/);
  assert.doesNotMatch(schoolDashboardSource, /background: item\.url \? `url\(\$\{item\.url\}\)/);
});

test("parent portal signs backdrop references and generic downloads reject public R2 origins", () => {
  assert.match(schoolAccessSource, /backdrops: signBackdropRows\(/);
  const parsed = ts.createSourceFile("gallery-context.ts", galleryContextSource, ts.ScriptTarget.Latest, true);
  const assignments = [];
  function visit(node) {
    if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && node.left.text === "backdropRows" &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken) assignments.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(assignments.length, 1, "One authoritative parent catalogue assignment");
  const assignment = assignments[0];
  assert.ok(ts.isConditionalExpression(assignment.right));
  assert.equal(assignment.right.condition.getText(parsed), "onlineBackdropsEnabled");
  assert.ok(ts.isCallExpression(assignment.right.whenTrue));
  assert.equal(assignment.right.whenTrue.expression.getText(parsed), "signBackdropRows");
  const compiled = ts.transpileModule(`let backdropRows = []; ${assignment.getText(parsed)}; return backdropRows;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  for (const enabled of [true, false]) {
    const signedCalls = [];
    const rawRows = [{ image_url: "backdrops/studio/blue.jpg", thumbnail_url: "backdrops/studio/blue-thumb.jpg" }];
    const resolve = new Function("onlineBackdropsEnabled", "signBackdropRows", "backdropsResult", "SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS", "photographerId", compiled);
    const rows = resolve(enabled, (rows, ttl, photographerId) => {
      signedCalls.push({ rows, ttl, photographerId });
      return rows.map((row) => ({ image_url: `signed:${row.image_url}`, thumbnail_url: `signed:${row.thumbnail_url}` }));
    }, { data: rawRows }, 3600, "fixture-studio");
    assert.deepEqual(signedCalls, enabled ? [{ rows: rawRows, ttl: 3600, photographerId: "fixture-studio" }] : []);
    assert.deepEqual(rows, enabled ? [{ image_url: "signed:backdrops/studio/blue.jpg", thumbnail_url: "signed:backdrops/studio/blue-thumb.jpg" }] : []);
  }
  assert.match(schoolAccessSource, /studentCandidates: signedStudentCandidates/);
  assert.match(galleryContextSource, /studentCandidates: signedStudentCandidates/);
  assert.match(schoolAccessSource, /primaryStudent: signedPrimaryStudent/);
  assert.match(galleryContextSource, /primaryStudent: signedPrimaryStudent/);
  assert.doesNotMatch(downloadProxySource, /R2_PUBLIC_URL/);
  assert.match(downloadProxySource, /isAllowedSignedR2Url\(target\)/);
});

test("order history refreshes legacy media while new orders store durable keys", () => {
  // Direct storage references cover every configured provider host
  // (Cloudflare R2, Backblaze B2, Wasabi, AWS S3), not only the original R2 pool.
  assert.match(privateMediaSource, /r2\\\.dev\|backblazeb2\\\.com\|wasabisys\\\.com\|amazonaws\\\.com/);
  assert.match(privateMediaSource, /r2\\\.cloudflarestorage\\\.com/);
  assert.match(privateMediaSource, /DIRECT_STORAGE_HOST\.test\(parsed\.host\)/);
  assert.match(privateMediaSource, /r2KeyFromAnyUrl\(value\)/);
  assert.match(privateMediaSource, /return safeR2Key\(raw\) \|\| raw/);
  assert.match(orderHistorySource, /canonicalPortalOrderSnapshot\(/);
  assert.match(orderHistorySource, /canonicalPortalOrderReference\(/);
  assert.doesNotMatch(orderHistorySource, /cartSnapshot: row\.cart_snapshot/);
  assert.match(orderHistorySource, /specialNotes: canonicalSpecialNotes/);
  assert.doesNotMatch(orderHistorySource, /specialNotes: row\.special_notes/);
  assert.match(orderCreateSource, /durablePrivateMediaReference\(/);
  assert.match(combinedOrderCreateSource, /durablePrivateMediaReference\(/);
  assert.match(galleryEmailSource, /EMAIL_COVER_MEDIA_TTL_SECONDS/);
  assert.match(galleryEmailSource, /signedPrivateMediaReference\(/);
});
