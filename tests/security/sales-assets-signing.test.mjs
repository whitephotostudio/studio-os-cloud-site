import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const upload = source("app/api/dashboard/sales-assets/sign-upload/route.ts");
const download = source("app/api/dashboard/sales-assets/sign-download/route.ts");
const bucket = source("scripts/ensure-sales-asset-bucket.mjs");

test("sales asset upload requires account and exact owned document status", () => {
  assert.match(upload, /resolveDashboardAuth\(request\)/);
  assert.match(upload, /!user \|\| !mfaSatisfied/);
  assert.match(upload, /\.eq\("user_id", user\.id\)/);
  assert.match(upload, /\.eq\("photographer_id", photographer\.id\)/);
  assert.match(upload, /\.eq\("kind", kind\)/);
  assert.match(upload, /\.eq\("client_request_id", documentId\)/);
  assert.match(upload, /\.is\("deleted_at", null\)/);
  assert.match(upload, /currentStatus\(document\.status\) !== status/);
  assert.match(upload, /SAFE_ID\.test\(documentId\)/);
  assert.match(upload, /createSignedUploadUrl\(key, \{ upsert: true \}\)/);
  assert.match(upload, /`\$\{user\.id\}\/\$\{kind\}\/\$\{documentId\}\//);
});

test("sales asset download signs only existing owned private objects", () => {
  assert.match(download, /resolveDashboardAuth\(request\)/);
  assert.match(download, /!user \|\| !mfaSatisfied/);
  assert.match(download, /\.eq\("user_id", user\.id\)/);
  assert.match(download, /\.eq\("photographer_id", photographer\.id\)/);
  assert.match(download, /\.eq\("kind", kind\)/);
  assert.match(download, /\.eq\("client_request_id", documentId\)/);
  assert.match(download, /\.is\("deleted_at", null\)/);
  assert.match(download, /SAFE_ID\.test\(documentId\)/);
  assert.match(download, /files\?\.some\(/);
  assert.match(download, /createSignedUrl\(key, 60\)/);
});

test("bucket bootstrap is idempotent and refuses a public bucket", () => {
  assert.match(bucket, /storage\.listBuckets\(\)/);
  assert.match(bucket, /if \(!bucket\)/);
  assert.match(bucket, /storage\.createBucket\(id, \{/);
  assert.match(bucket, /public: false/);
  assert.match(bucket, /if \(bucket\.public/);
  assert.doesNotMatch(bucket, /updateBucket|deleteBucket/);
});
