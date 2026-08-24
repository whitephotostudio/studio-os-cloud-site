import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const lightboxSource = source("components/student-photo-lightbox.tsx");
const classPageSource = source(
  "app/dashboard/projects/schools/[schoolId]/classes/[classId]/page.tsx",
);
const rolePageSource = source(
  "app/dashboard/projects/schools/[schoolId]/roles/[role]/page.tsx",
);

test("photo viewer keeps normal browsing simple and exposes an explicit selection mode", () => {
  assert.match(lightboxSource, /Select photos/);
  assert.match(lightboxSource, /Remove selected \(\{selectedCount\}\)/);
  assert.match(lightboxSource, /aria-pressed=\{selecting \? selected : active\}/);
  assert.match(lightboxSource, /selected \? <Check/);
  assert.match(lightboxSource, /Cancel/);
  assert.match(lightboxSource, /Previous photo/);
  assert.match(lightboxSource, /Next photo/);
});

test("photo removal requires a second confirmation and accurately explains sync behavior", () => {
  assert.match(lightboxSource, /Remove from online gallery\?/);
  assert.match(lightboxSource, /Originals remain on the photographer&apos;s computer/);
  assert.match(lightboxSource, /Cloud Sync will honor this choice/);
  assert.match(lightboxSource, /Keep photos/);
  assert.match(lightboxSource, /Removing\.\.\./);
  assert.match(lightboxSource, /role="alert"/);
  assert.match(lightboxSource, /await onRemoveSelected\(selectedKeys\)/);
});

for (const [galleryKind, pageSource] of [
  ["class", classPageSource],
  ["role", rolePageSource],
]) {
  test(`${galleryKind} viewer sends stable keys to the owner-scoped photo endpoint`, () => {
    assert.match(pageSource, /StudentPhotoLightbox/);
    assert.match(
      pageSource,
      /\/api\/dashboard\/schools\/\$\{encodeURIComponent\(schoolId\)\}\/students\/\$\{encodeURIComponent\(lightbox\.id\)\}\/photos/,
    );
    assert.match(pageSource, /method: "DELETE"/);
    assert.match(pageSource, /body: JSON\.stringify\(\{ keys: uniqueKeys \}\)/);
    assert.match(pageSource, /remainingPhotos\?: GalleryPhotoAsset\[\]/);
    assert.match(pageSource, /setPhotoAssetsMap/);
    assert.match(pageSource, /folderImageAssetsCacheRef\.current\.set/);
    assert.match(pageSource, /onRemoveSelected=\{removeLightboxPhotos\}/);
  });

  test(`${galleryKind} folder results remain authoritative after online removal`, () => {
    assert.match(pageSource, /authoritative/i);
    assert.match(pageSource, /successful (?:folder response|load)/i);
    assert.doesNotMatch(
      pageSource,
      /const mergedUrls = \[(?:student|person)\.photo_url, \.\.\.urls\]/,
    );
    assert.match(
      pageSource,
      /catch \{[\s\S]*?photoAssetFromStoredReference\((?:student|person)\.photo_url\)/,
    );
  });
}

test("representative preview variants normalize to the stable original photo key", () => {
  assert.ok(
    lightboxSource.includes(
      'return key.replace(/_(preview|thumbnail|cutout|nobg)\\.[^./]+$/i, ".jpg");',
    ),
  );
  assert.match(lightboxSource, /logicalPhotoKey/);
  assert.match(lightboxSource, /dedupeGalleryPhotoAssets/);
});
