import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storageSource = readFileSync(
  new URL("../../lib/storage-images.ts", import.meta.url),
  "utf8",
);
const thumbnailRouteSource = readFileSync(
  new URL(
    "../../app/api/dashboard/generate-thumbnails/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const albumSource = readFileSync(
  new URL(
    "../../app/dashboard/projects/[id]/albums/[albumId]/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const captureMoveSource = readFileSync(
  new URL("../../app/api/dashboard/capture/move/route.ts", import.meta.url),
  "utf8",
);
const recoverMediaSource = readFileSync(
  new URL(
    "../../app/api/dashboard/events/desktop-recover-media/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("bare media references are routed through the authenticated image proxy", () => {
  assert.match(storageSource, /function isBareMediaKey/);
  assert.match(storageSource, /publicStorageUrl\(candidate\.split/);
  assert.match(storageSource, /return `\/api\/r2\/img\//);
});

test("new album uploads persist object keys rather than permanent public URLs", () => {
  assert.match(thumbnailRouteSource, /thumbnailKey:/);
  assert.match(thumbnailRouteSource, /previewKey:/);
  assert.match(albumSource, /generated\.previewKey \|\| uploadedStoragePath/);
  assert.match(albumSource, /generated\.thumbnailKey \|\| previewReference/);
  assert.doesNotMatch(albumSource, /preview_url: previewUrl \|\| null/);
});

test("capture move and recovery metadata persist R2 keys", () => {
  assert.match(captureMoveSource, /update\(\{ photo_url: destKey \}\)/);
  assert.doesNotMatch(captureMoveSource, /r2PublicUrl/);
  assert.match(recoverMediaSource, /preview_url: previewKey/);
  assert.match(recoverMediaSource, /thumbnail_url: thumbKey/);
  assert.doesNotMatch(recoverMediaSource, /r2PublicUrl/);
});
