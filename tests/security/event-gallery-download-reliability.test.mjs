import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const batchRouteSource = source("app/api/portal/event-download-batch/route.ts");
const readyRouteSource = source("app/api/portal/event-download-ready/route.ts");
const downloadsPageSource = source("app/parents/[pin]/downloads/page.tsx");

test("large event ZIP streams have a long enough server window", () => {
  assert.match(batchRouteSource, /export const maxDuration = 1800/);
  assert.match(readyRouteSource, /6 \* 60 \* 60 \* 1000/);
});

test("multi-part galleries start one ZIP at a time", () => {
  assert.match(downloadsPageSource, /Download one ZIP at a time/);
  assert.match(downloadsPageSource, /Download \$\{nextBatch\.label\}/);
  assert.doesNotMatch(downloadsPageSource, /handleDownloadAllBatches/);
  assert.doesNotMatch(downloadsPageSource, /await wait\(1400\)/);
});
