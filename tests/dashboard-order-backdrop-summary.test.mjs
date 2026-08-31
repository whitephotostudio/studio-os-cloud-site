import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ordersPageSource = readFileSync(
  new URL("../app/dashboard/orders/page.tsx", import.meta.url),
  "utf8",
);

test("each composite row labels itself from its own saved backdrop", () => {
  assert.match(
    ordersPageSource,
    /function photoGroupBackdropLabel\(group: OrderedPhotoGroup\)[\s\S]*?group\.items[\s\S]*?item\.backdrop[\s\S]*?item\.backdrop\.name/,
  );
  assert.match(
    ordersPageSource,
    /Backdrop: \{photoGroupBackdropLabel\(photoGroup\)\} applied/,
  );
  assert.match(
    ordersPageSource,
    /Backdrop: \{clean\(item\.backdrop\.name\) \|\| "Backdrop"\}/,
  );
  assert.doesNotMatch(ordersPageSource, /selectedBackdropAddOns\[0\]\.label/);
});

test("backdrop summary groups snapshot items by backdrop and counts each saved assignment", () => {
  assert.match(
    ordersPageSource,
    /const snapshotGroups = new Map<string, BackdropAddOnSummary>\(\)/,
  );
  assert.match(
    ordersPageSource,
    /const key = backdropSummaryKey\(item\.backdrop\)/,
  );
  assert.match(
    ordersPageSource,
    /if \(clean\(item\.sku\)\) existing\.appliedPhotoCount \+= 1/,
  );
  assert.match(
    ordersPageSource,
    /for \(const entry of cartSnapshotEntries\(order\.cart_snapshot\)\)[\s\S]*?summary\.cents \+= Math\.round\(cents\)/,
  );
});
