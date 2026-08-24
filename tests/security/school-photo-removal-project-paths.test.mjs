import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const sharedHelperSource = source("lib/school-project-photo-mapping.ts");
const projectRouteSource = source("app/api/dashboard/events/[id]/route.ts");
const albumRouteSource = source(
  "app/api/dashboard/events/[id]/albums/[albumId]/route.ts",
);
const desktopMediaSource = source("app/api/dashboard/events/desktop-media/route.ts");

test("project routes share an owner-verified cloud or legacy-local school resolver", () => {
  assert.match(sharedHelperSource, /\.eq\("photographer_id", photographerId\)/);
  assert.match(sharedHelperSource, /\.eq\("id", linkedSchoolId\)/);
  assert.match(sharedHelperSource, /\.eq\("local_school_id", linkedLocalSchoolId\)/);
  assert.match(sharedHelperSource, /status: "unlinked"/);
  assert.match(sharedHelperSource, /status: "invalid"/);
  assert.match(sharedHelperSource, /workflowType !== "school"/);

  for (const routeSource of [
    projectRouteSource,
    albumRouteSource,
    desktopMediaSource,
  ]) {
    assert.match(routeSource, /resolveOwnedProjectLinkedSchool/);
    assert.match(routeSource, /linkedSchoolResolution\.status === "invalid"/);
    assert.doesNotMatch(routeSource, /projectRow\.school_id|currentProject\.school_id/);
  }
  assert.match(desktopMediaSource, /workflow_type,linked_school_id,linked_local_school_id/);
});

test("all project media reads and writes use the one exact tombstone matcher", () => {
  assert.match(
    sharedHelperSource,
    /schoolPhotoReferenceMatchesFamily\(params\.reference, params\.families\)/,
  );
  assert.match(sharedHelperSource, /projectAlbumSchoolPhotoReference/);
  assert.doesNotMatch(sharedHelperSource, /\.endsWith\(|path\.basename|p\.basename/);

  for (const routeSource of [
    projectRouteSource,
    albumRouteSource,
    desktopMediaSource,
  ]) {
    assert.match(routeSource, /projectMediaReferenceMatchesSchoolPhotoFamily/);
    assert.doesNotMatch(routeSource, /linkedProjectReferenceMatchesTombstone/);
    assert.doesNotMatch(routeSource, /family\.endsWith/);
  }

  assert.match(
    projectRouteSource,
    /visibleRows[\s\S]*?\.slice\(mediaFrom, mediaFrom \+ mediaLimit\)/,
  );
  assert.match(projectRouteSource, /mediaTotalCount: mediaCount/);
  assert.match(albumRouteSource, /cannot be renamed here/);
  assert.match(desktopMediaSource, /reason: "removed_from_school_gallery"/);
  assert.match(
    desktopMediaSource,
    /linkedSchoolResolution\.status === "resolved"[\s\S]*?reason: "stale_school_collection_mapping"[\s\S]*?status: 409/,
  );
  assert.ok(
    desktopMediaSource.indexOf('reason: "stale_school_collection_mapping"') <
      desktopMediaSource.indexOf("item.collection_id = fallbackId"),
    "linked-school stale collection mappings must stop before salvage rewrites collection ids",
  );
  assert.ok(
    desktopMediaSource.indexOf("normalizedItems = normalizedItems.filter") <
      desktopMediaSource.indexOf('.from("media")\n        .insert(inserts)'),
    "tombstoned items must be rejected before media rows are inserted",
  );
  assert.doesNotMatch(desktopMediaSource, /r2Delete|DeleteObjectsCommand/);
});
