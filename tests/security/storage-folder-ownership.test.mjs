import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isUuid } from "../../lib/r2-access-security.ts";

const routeSource = readFileSync(
  new URL("../../app/api/dashboard/storage-folder/route.ts", import.meta.url),
  "utf8",
);

test("desktop local school ids are not UUIDs", () => {
  assert.equal(isUuid("a1b2c3d4e5f6"), false);
  assert.equal(isUuid("school-local-id"), false);
  assert.equal(isUuid("11111111-1111-4111-8111-111111111111"), true);
});

test("non-UUID school roots never reach the UUID schools.id filter", () => {
  assert.match(
    routeSource,
    /isUuid\(candidate\)[\s\S]*?\.eq\("id", candidate\)[\s\S]*?: Promise\.resolve\(\{ data: \[\], error: null \}\)/,
  );
  assert.match(routeSource, /\.eq\("local_school_id", candidate\)/);
  assert.doesNotMatch(routeSource, /\.or\(`id\.eq\./);
});

test("school folder ownership fails closed for foreign or ambiguous local ids", () => {
  assert.match(routeSource, /\.select\("id,photographer_id"\)/);
  assert.match(routeSource, /\.limit\(2\)/);
  assert.match(routeSource, /if \(matches\.length !== 1\) return null/);
  assert.match(
    routeSource,
    /matches\[0\]\?\.photographer_id === photographerId/,
  );
  assert.match(routeSource, /if \(!ownership\.allowed\)/);
  assert.match(routeSource, /status: 403/);
});

test("database lookup failures remain visible instead of becoming false 403s", () => {
  assert.match(routeSource, /if \(byIdResult\.error\) throw byIdResult\.error/);
  assert.match(
    routeSource,
    /if \(byLocalIdResult\.error\) throw byLocalIdResult\.error/,
  );
  assert.match(routeSource, /if \(photographerError\) throw photographerError/);
  assert.match(routeSource, /status: 500/);
});

test("the route accepts legacy and namespaced school folders", () => {
  assert.match(routeSource, /first === "schools" \|\| first === "photos"/);
  assert.match(routeSource, /first === "nobg-photos"/);
  assert.match(routeSource, /await ownedSchoolId\(second\)/);
  assert.match(routeSource, /await ownedSchoolId\(first\)/);
  assert.match(routeSource, /filterTombstonedSchoolPhotoAssets/);
});
