import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { proxiedPhotoUrl } from "../lib/photo-url.ts";

const schoolsPageSource = readFileSync(
  new URL("../app/dashboard/schools/page.tsx", import.meta.url),
  "utf8",
);

test("school card covers turn durable R2 keys into working browser URLs", () => {
  assert.equal(
    proxiedPhotoUrl(
      "417r7ahlcaqr/2025-2026/Medical Office Assistant/Cover Photo 0001.jpg",
    ),
    "/api/r2/img/417r7ahlcaqr/2025-2026/Medical%20Office%20Assistant/Cover%20Photo%200001.jpg",
  );
});

test("the schools dashboard resolves cover references while building cards", () => {
  assert.match(
    schoolsPageSource,
    /import\s+\{\s*proxiedPhotoUrl\s*\}\s+from\s+["']@\/lib\/photo-url["']/,
  );
  assert.match(
    schoolsPageSource,
    /coverUrl:\s*proxiedPhotoUrl\(cover\?\.url\)/,
  );
  assert.match(
    schoolsPageSource,
    /coverUrl:\s*proxiedPhotoUrl\(cover\?\.url\s*\|\|\s*stat\?\.firstPhotoUrl\)/,
  );
  assert.doesNotMatch(
    schoolsPageSource,
    /coverUrl:\s*schoolCoverBy(?:SchoolId|LocalId)/,
  );
});
