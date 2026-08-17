import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isUuid,
  normalizeR2Key,
  scopeForR2Key,
} from "../../lib/r2-access-security.ts";

const routeSource = readFileSync(
  new URL("../../app/api/dashboard/r2-access/route.ts", import.meta.url),
  "utf8",
);

test("normalizes valid Studio OS keys without changing spaces", () => {
  assert.equal(
    normalizeR2Key("school-local-id/SK A/Smith Jane 12345/photo 1.jpg"),
    "school-local-id/SK A/Smith Jane 12345/photo 1.jpg",
  );
  assert.equal(normalizeR2Key("school-local-id/", { prefix: true }), "school-local-id/");
});

test("rejects traversal, URLs, controls, query strings, and malformed prefixes", () => {
  const invalid = [
    "../secret.jpg",
    "school/../secret.jpg",
    "https://example.com/photo.jpg",
    "/absolute/photo.jpg",
    "school//photo.jpg",
    "school/photo.jpg?token=secret",
    "school\\photo.jpg",
    "school/\u0000photo.jpg",
  ];
  for (const key of invalid) assert.equal(normalizeR2Key(key), null, key);
  assert.equal(normalizeR2Key("school//", { prefix: true }), null);
});

test("maps every desktop storage namespace to an owned resource", () => {
  assert.deepEqual(scopeForR2Key("projects/project-1/albums/a/photo.jpg"), {
    kind: "project",
    id: "project-1",
  });
  assert.deepEqual(scopeForR2Key("probes/project-1/_probe.txt"), {
    kind: "project",
    id: "project-1",
  });
  assert.deepEqual(scopeForR2Key("schools/school-1/composites/a.jpg"), {
    kind: "school",
    id: "school-1",
  });
  assert.deepEqual(scopeForR2Key("photos/school-1/student-1/a.jpg"), {
    kind: "school",
    id: "school-1",
  });
  assert.deepEqual(scopeForR2Key("nobg-photos/local-school/a.png"), {
    kind: "school",
    id: "local-school",
  });
  assert.deepEqual(scopeForR2Key("local-school/SK A/student/a.jpg"), {
    kind: "school",
    id: "local-school",
  });
});

test("distinguishes database UUIDs from legacy local identifiers", () => {
  assert.equal(isUuid("11111111-1111-4111-8111-111111111111"), true);
  assert.equal(isUuid("local-school-id"), false);
  assert.equal(isUuid("id.eq.anything"), false);
});

test("route authenticates, scopes ownership, limits use, and keeps credentials server-side", () => {
  assert.match(routeSource, /resolveDashboardAuth\(request\)/);
  assert.match(routeSource, /eq\("photographer_id", photographerId\)/);
  assert.doesNotMatch(routeSource, /\.or\(`/);
  assert.match(routeSource, /rateLimit\(photographer\.id/);
  assert.match(routeSource, /r2PresignedPutUrl/);
  assert.match(routeSource, /r2PresignedGetUrl/);
  assert.doesNotMatch(routeSource, /R2_SECRET_ACCESS_KEY/);
});
