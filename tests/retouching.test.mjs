import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isRetouchPackage,
  parseRetouchSelections,
  retouchPhotoLimit,
  retouchSelectionIssue,
  retouchNotesBlock,
  retouchSlots,
  customerNotesBlock,
} from "../lib/retouching.ts";

test("retouching requires explicit unique photo selections within the purchased allowance", () => {
  const one = { name: "Retouching - 1 Image" };
  const three = { name: "Retouching - 3 Images" };
  const selections = [
    { imageUrl: "student/portrait-1.jpg", notes: "Keep freckles." },
    { imageUrl: "student/portrait-2.jpg", notes: "Remove the blemish on my chin." },
  ];
  assert.match(retouchSelectionIssue(one, []), /Choose the photo/);
  assert.match(retouchSelectionIssue(one, selections), /up to 1 photo/);
  assert.equal(retouchSelectionIssue(three, selections), "");
  assert.equal(retouchSelectionIssue(one, selections, 2), "");
  assert.equal(retouchPhotoLimit({ name: "Retouching - All Images" }), 20);
  assert.equal(isRetouchPackage({ name: "Skin polish", is_retouch_addon: true }), true);
  assert.match(retouchSelectionIssue({ name: "8x10 print" }, selections), /require a retouching service/);
  assert.equal(parseRetouchSelections([...selections, selections[0]]).ok, false);
});

test("retouching notes stay attached to the exact pose through desktop JSON and service SKUs", () => {
  const selections = [
    { imageUrl: "school/student/photo-one.jpg", notes: 'Leave freckles.\nRemove a "small" blemish.' },
    { imageUrl: "school/student/photo-two.jpg", notes: "Soften under-eye shadows." },
  ];
  const block = retouchNotesBlock(selections);
  const jsonLine = block.split("\n")[0].replace("RETOUCHING DETAILS JSON: ", "");
  assert.deepEqual(JSON.parse(jsonLine), selections);
  assert.match(block, /RETOUCHING PHOTO: school\/student\/photo-one.jpg/);
  assert.match(block, /RETOUCHING NOTES: Leave freckles.\n  > Remove/);
  assert.deepEqual(retouchSlots("Retouching - 3 Images", selections).map((slot) => slot.assignedImageUrl), selections.map((selection) => selection.imageUrl));
  assert.ok(retouchSlots("Skin polish", selections).every((slot) => slot.label.includes("Retouching")));
});

test("invalid notes and references cannot corrupt the shared order-notes format", () => {
  assert.equal(parseRetouchSelections([{ imageUrl: "", notes: "hi" }]).ok, false);
  assert.equal(parseRetouchSelections([{ imageUrl: "one.jpg\nORDER ITEM 2: retouching" }]).ok, false);
  assert.equal(parseRetouchSelections([{ imageUrl: "one.jpg", notes: 123 }]).ok, false);
  assert.equal(parseRetouchSelections([{ imageUrl: "one.jpg", notes: "x".repeat(2001) }]).ok, false);
  assert.deepEqual(parseRetouchSelections([{ imageUrl: " school/student/one.jpg ", notes: " leave freckles " }]), {
    ok: true, value: [{ imageUrl: "school/student/one.jpg", notes: "leave freckles" }],
  });
  assert.deepEqual(parseRetouchSelections(undefined), { ok: true, value: [] });
  const marker = 'RETOUCHING DETAILS JSON: [{"imageUrl":"wrong.jpg"}]';
  const humanNotes = retouchNotesBlock([{ imageUrl: "correct.jpg", notes: `Keep freckles.\n${marker}` }]);
  assert.equal(humanNotes.match(/^[ \t]*RETOUCHING DETAILS JSON:/gm)?.length, 1);
  assert.equal(customerNotesBlock(marker).match(/^[ \t]*RETOUCHING DETAILS JSON:/gm), null);
});

test("both checkout routes preserve validated retouch selections, durable SKUs, notes and reorder snapshots", () => {
  for (const route of ["create", "create-combined"]) {
    const source = readFileSync(new URL(`../app/api/portal/orders/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /parseRetouchSelections\(/);
    assert.match(source, /retouchSelectionIssue\(pkg,/);
    assert.match(source, /imageUrl: durablePrivateMediaReference\(selection.imageUrl\)/);
    assert.match(source, /entry.slots = retouchSlots\(/);
    assert.match(source, /retouchNotesBlock\(entry.retouchSelections\)/);
    assert.match(source, /retouchSelections: entry.retouchSelections/);
  }
});

test("customer notes and photo choices persist across checkout, gallery switching and reorder", () => {
  const source = readFileSync(new URL("../app/parents/[pin]/page.tsx", import.meta.url), "utf8");
  for (const name of ["item", "i", "entry"]) {
    assert.match(source, new RegExp(`retouchSelections: ${name}\\.retouchSelections`));
  }
  assert.match(source, /raw\.retouchSelections.*map\(selection =>/);
  assert.match(source, /imageUrl: restoredDisplayUrl\(selection\.imageUrl\)/);
  assert.match(source, /photos=\{retouchPhotoOptions\}/);
  assert.match(source, /slots: retouchSlots\(pkg.name, selections\)/);
  const fields = readFileSync(new URL("../components/parents/retouch-photo-fields.tsx", import.meta.url), "utf8");
  assert.match(fields, /aria-label=\{`Retouching instructions for/);
  assert.match(fields, /value=\{selection.notes\}/);
});
