import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const parentGallerySource = readFileSync(
  new URL("../app/parents/[pin]/page.tsx", import.meta.url),
  "utf8",
);

test("backdrop picker explains that different backdrops require separate basket items", () => {
  assert.match(
    parentGallerySource,
    /One backdrop applies to every pose and size in one basket item\./,
  );
  assert.match(
    parentGallerySource,
    /For different backdrops, add each size or pose as a separate basket item\./,
  );
  assert.match(
    parentGallerySource,
    /Items already in your basket keep their chosen backdrop\./,
  );
});

test("saved physical basket items show the backdrop and its print-slot scope", () => {
  assert.match(
    parentGallerySource,
    /item\.backdrop && item\.category !== "digital"/,
  );
  assert.match(parentGallerySource, /Backdrop: \{item\.backdrop\.name\}/);
  assert.match(
    parentGallerySource,
    /Applies to \{item\.slots\.length === 1 \? "the" : "all"\} \{item\.slots\.length\} print slot/,
  );
});
