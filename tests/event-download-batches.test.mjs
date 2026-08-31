import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function sourceSection(contents, startMarker, endMarker) {
  const start = contents.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = contents.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return contents.slice(start, end);
}

const batchRoute = source("app/api/portal/event-download-batch/route.ts");
const readyRoute = source("app/api/portal/event-download-ready/route.ts");
const tokenSource = source("lib/event-gallery-download-tokens.ts");

test("ZIP JSON preflight and unwatermarked streaming do not initialize Sharp", () => {
  assert.doesNotMatch(batchRoute, /^import sharp from ["']sharp["'];/m);

  const printRelease = sourceSection(
    batchRoute,
    "async function buildPrintReleasePdf",
    "async function addWatermarkToImageBuffer",
  );
  const watermark = sourceSection(
    batchRoute,
    "async function addWatermarkToImageBuffer",
    "async function* buildDownloadZipEntries",
  );
  const getHandler = sourceSection(
    batchRoute,
    "export async function GET",
    "console.error(\"[event-download-batch]\"",
  );

  assert.match(printRelease, /await import\(["']sharp["']\)/);
  assert.match(watermark, /await import\(["']sharp["']\)/);
  assert.doesNotMatch(getHandler, /await import\(["']sharp["']\)/);
  assert.match(getHandler, /if \(wantsJson\)[\s\S]*return NextResponse\.json/);
});

test("preparing a manifest does not consume download quota", () => {
  assert.match(readyRoute, /validateUuid\(body\.projectId, ["']projectId["']\)/);
  assert.match(
    readyRoute,
    /if \(!validatedProjectId\.ok\)[\s\S]*status: 400/,
  );
  assert.doesNotMatch(
    readyRoute,
    /\.from\(["']event_gallery_downloads["']\)\s*\.insert\(/,
  );
  assert.match(readyRoute, /const downloadLogId = randomUUID\(\)/);
  assert.match(readyRoute, /downloadLogId,[\s\S]*collectionId: collectionId \|\| null/);
  assert.match(readyRoute, /downloadsUsed,\s*downloadsRemaining,\s*batches/);
});

test("a completed ZIP records only streamed media once per signed batch", () => {
  assert.match(tokenSource, /downloadLogId\?: string/);
  assert.match(tokenSource, /collectionId\?: string \| null/);
  assert.match(batchRoute, /onPhotoComplete\?\.\(mediaId\)/);
  assert.match(batchRoute, /function recordAfterZipCompletion/);
  assert.match(batchRoute, /const next = await reader\.read\(\)/);
  assert.match(batchRoute, /if \(!next\.done\)[\s\S]*controller\.enqueue\(next\.value\)/);
  assert.match(batchRoute, /await onComplete\(\)/);
  assert.match(batchRoute, /async cancel\(reason\)[\s\S]*await reader\.cancel\(reason\)/);
  assert.match(batchRoute, /\.upsert\([\s\S]*id: downloadLogId[\s\S]*download_count: options\.mediaIds\.length[\s\S]*\{ onConflict: ["']id["'], ignoreDuplicates: true \}/);
  assert.match(
    batchRoute,
    /if \(!downloadLogId \|\| !options\.mediaIds\.length\) return/,
  );
});
