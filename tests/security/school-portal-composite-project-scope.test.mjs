import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const galleryContextSource = source("app/api/portal/gallery-context/route.ts");
const schoolAccessSource = source("app/api/portal/school-access/route.ts");
const desktopCompositesSource = source(
  "app/api/dashboard/schools/desktop-composites/route.ts",
);
const schoolSyncSource = source("lib/school-sync.ts");

function compositeLoader(routeSource) {
  const start = routeSource.indexOf("async function loadSchoolCompositeMedia(");
  const end = routeSource.indexOf("export async function POST", start);
  assert.notEqual(start, -1, "composite loader must exist");
  assert.notEqual(end, -1, "composite loader must end before POST");
  return routeSource.slice(start, end);
}

test("portal composite loaders use the selected school's owner-scoped identity resolver", () => {
  for (const [label, routeSource] of [
    ["gallery context", galleryContextSource],
    ["school access", schoolAccessSource],
  ]) {
    const loader = compositeLoader(routeSource);
    assert.match(
      loader,
      /!school\?\.id \|\| !clean\(school\.photographer_id\)/,
      `${label} must fail closed without the selected school's owner`,
    );
    assert.match(
      loader,
      /findSyncedSchoolProjectId\(service, school\.id, \{[\s\S]*?localSchoolId: school\.local_school_id,[\s\S]*?photographerId: school\.photographer_id,[\s\S]*?\}\)/,
      `${label} must resolve composites through both exact school identities and owner`,
    );
    assert.doesNotMatch(
      loader,
      /\.from\("projects"\)/,
      `${label} must not keep an unscoped local-ID fallback`,
    );
  }
});

test("shared school-project resolution owner-scopes both identity queries before compatibility selection", () => {
  const resolverStart = schoolSyncSource.indexOf(
    "export async function findSyncedSchoolProjectId(",
  );
  const resolverEnd = schoolSyncSource.indexOf(
    "export async function ensureSyncedSchoolProjectId(",
    resolverStart,
  );
  assert.notEqual(resolverStart, -1);
  assert.notEqual(resolverEnd, -1);
  const resolver = schoolSyncSource.slice(resolverStart, resolverEnd);

  assert.match(resolver, /photographerId\?: string \| null/);
  assert.equal(
    (resolver.match(/\.eq\("photographer_id", photographerId\)/g) ?? []).length,
    2,
    "both linked_school_id and linked_local_school_id queries must use the owner",
  );
  assert.match(
    resolver,
    /selectSyncedSchoolProjectCandidate\(uniqueCandidates, \{[\s\S]*?schoolId,[\s\S]*?localSchoolId,[\s\S]*?\}\)/,
    "conflicting explicit school links must still be rejected by compatibility selection",
  );

  const ensureStart = schoolSyncSource.indexOf(
    "export async function ensureSyncedSchoolProjectId(",
  );
  const ensureEnd = schoolSyncSource.indexOf(
    "export async function ensureSchoolCollectionId(",
    ensureStart,
  );
  assert.notEqual(ensureStart, -1);
  assert.notEqual(ensureEnd, -1);
  const ensureResolver = schoolSyncSource.slice(ensureStart, ensureEnd);
  assert.match(
    ensureResolver,
    /const photographerId = clean\(school\?\.photographer_id\);[\s\S]*?if \(!photographerId\) \{[\s\S]*?return null;/,
    "sync must fail closed before looking up a project when school ownership is unknown",
  );
  assert.equal(
    (ensureResolver.match(/photographerId,/g) ?? []).length,
    3,
    "initial lookup, inserted project, and conflict fallback must share one owner",
  );
});

test("desktop composite recovery passes the verified school owner", () => {
  assert.match(
    desktopCompositesSource,
    /findSyncedSchoolProjectId\(service, schoolId, \{[\s\S]*?localSchoolId: school\.local_school_id,[\s\S]*?photographerId: school\.photographer_id/,
  );
});
