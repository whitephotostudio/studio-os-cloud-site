import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const helperSource = source("lib/school-photo-cover-repair.ts");
const captureDeleteSource = source("app/api/dashboard/capture/delete/route.ts");
const lightboxDeleteSource = source(
  "app/api/dashboard/schools/[schoolId]/students/[studentId]/photos/route.ts",
);

test("capture and lightbox removal share one cover-repair implementation", () => {
  for (const routeSource of [captureDeleteSource, lightboxDeleteSource]) {
    assert.match(
      routeSource,
      /import \{ repairSchoolPhotoCoverReferences \} from "@\/lib\/school-photo-cover-repair"/,
    );
    assert.match(routeSource, /await repairSchoolPhotoCoverReferences\(\{/);
  }

  assert.doesNotMatch(captureDeleteSource, /\.from\("collections"\)/);
  assert.doesNotMatch(lightboxDeleteSource, /\.from\("collections"\)/);
});

test("shared repair covers school, project, collection, and media representatives", () => {
  assert.match(helperSource, /\.from\("schools"\)[\s\S]*?cover_photo_url: nextCover/);
  assert.match(helperSource, /\.from\("projects"\)[\s\S]*?cover_photo_url: nextCover/);
  assert.match(helperSource, /\.from\("collections"\)[\s\S]*?cover_photo_url: nextCover/);
  assert.match(helperSource, /\.from\("media"\)[\s\S]*?is_cover: false/);
  assert.match(helperSource, /schoolPhotoReferenceMatchesFamily/);
  assert.match(helperSource, /projectMediaReferenceMatchesSchoolPhotoFamily/);
  assert.match(helperSource, /selectResolvedOwnedProjectSchool/);
  assert.match(helperSource, /linked_local_school_id/);
  assert.match(helperSource, /select\("id,project_id,title,cover_photo_url"\)/);
  assert.match(helperSource, /collection_id/);
  assert.doesNotMatch(helperSource, /family\.endsWith|basename/i);
});

test("mobile capture removal reports shared cover repair without deleting media bytes", () => {
  assert.match(captureDeleteSource, /removedFamilies: new Set\(\[family\]\)/);
  assert.match(captureDeleteSource, /fallbackKey: remainingAssets\[0\]\?\.key \?\? null/);
  assert.match(captureDeleteSource, /repairedReferences: repairedReferences\.length/);
  assert.doesNotMatch(captureDeleteSource, /deleteR2Objects|deleteR2Prefix/);
});
