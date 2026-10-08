import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/parents/[pin]/page.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("gallery.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = (value) => ts.transpileModule(value, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loadHelpers = (file) => {
  const exports = {};
  new Function("exports", compile(readFileSync(new URL(file, import.meta.url), "utf8")))(exports);
  return exports;
};
const { usableParentCutouts, canOfferParentBackdrops } = loadHelpers("../lib/parent-backdrop-access.ts");
const { imagesInEventAlbum } = loadHelpers("../lib/event-album-navigation.ts");

// Execute the page's real visibility and selection declarations so this catches
// a late render dropping original poses, rather than testing a copied formula.
function declaration(name, required = true) {
  let found;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  if (required) assert.ok(found, `Missing gallery state declaration: ${name}`);
  return found ? `const ${found.getText(parsed)};` : "";
}
const resolveView = new Function(
  "images", "isSchoolMode", "nobgUrls", "activeEventCollectionId", "selectedImageIndex",
  "isCompositeGalleryImage", "imagesInEventAlbum",
  compile([
    declaration("schoolModeVisibleImages", false),
    declaration("visibleImages"),
    declaration("selectedImage"),
    "return { visibleImages, selectedImage };",
  ].join("\n")),
);
const view = (images, { cutouts = {}, schoolMode = true, album = null, selectedIndex = 0 } = {}) =>
  resolveView(images, schoolMode, cutouts, album, selectedIndex,
    (image) => image?.source === "composite", imagesInEventAlbum);
const portraits = Object.freeze(Array.from({ length: 8 }, (_, index) => Object.freeze({
  id: `pose-${index}`, source: "photo", url: `/current-child/pose-${index}_preview.jpg`,
  storagePath: `school-a/Class/current-child/pose-${index}.jpg`,
})));

test("eight original poses and the selected last pose survive delayed readiness for one cutout", async () => {
  let finishProbe;
  const probes = [];
  const pending = usableParentCutouts(
    { "pose-0": "/authorized-cutout.png", "foreign-child": "/foreign-cutout.png" },
    portraits.map((image) => image.id),
    (url) => { probes.push(url); return new Promise((resolve) => { finishProbe = resolve; }); },
  );
  const before = view(portraits, { selectedIndex: 7 });
  assert.equal(before.visibleImages.length, 8);
  assert.equal(before.selectedImage, portraits[7]);
  finishProbe(true);
  const cutouts = await pending;
  const after = view(portraits, { cutouts, selectedIndex: 7 });
  assert.deepEqual(probes, ["/authorized-cutout.png"], "foreign cutout is never probed or added");
  assert.deepEqual(cutouts, { "pose-0": "/authorized-cutout.png" });
  assert.deepEqual(after.visibleImages, before.visibleImages);
  assert.equal(after.selectedImage, before.selectedImage);
  assert.equal(canOfferParentBackdrops({ schoolMode: true, composite: false, catalogCount: 1, cutoutUrl: cutouts[portraits[0].id] }), true);
  assert.equal(canOfferParentBackdrops({ schoolMode: true, composite: false, catalogCount: 1, cutoutUrl: cutouts[portraits[7].id] }), false,
    "an original stays visible without acquiring backdrop access");
});

test("partial, missing, and failed cutouts never remove authorized originals or composites", async () => {
  const composite = Object.freeze({ id: "composite-class", source: "composite", url: "/class-preview.jpg" });
  const images = Object.freeze([...portraits, composite]);
  for (const cutouts of [{}, { "pose-3": "/paid.png" }, Object.fromEntries(portraits.map((image) => [image.id, `/${image.id}.png`]))]) {
    assert.deepEqual(view(images, { cutouts }).visibleImages, images);
  }
  const failed = await usableParentCutouts({ "pose-3": "/unavailable.png" }, portraits.map((image) => image.id), async () => false);
  assert.deepEqual(view(images, { cutouts: failed }).visibleImages, images);
  assert.equal(canOfferParentBackdrops({ schoolMode: true, composite: true, catalogCount: 1, cutoutUrl: "/paid.png" }), false);
});

test("cutout metadata cannot introduce another student's photo into the visible list", () => {
  const cutouts = { "foreign-child": "/foreign.png", "pose-0": "/authorized.png" };
  const visible = view(portraits, { cutouts }).visibleImages;
  assert.deepEqual(visible.map((image) => image.id), portraits.map((image) => image.id));
  assert.equal(visible.some((image) => image.id === "foreign-child"), false);
});

test("event album visibility remains scoped to the selected authorized album", () => {
  const images = [
    { id: "a-one", collectionId: "album-a", url: "/a-one.jpg" },
    { id: "b-one", collectionId: "album-b", url: "/b-one.jpg" },
    { id: "a-two", collectionId: "album-a", url: "/a-two.jpg" },
  ];
  assert.deepEqual(view(images, { schoolMode: false, album: "album-a", cutouts: { "b-one": "/b-cutout.png" } }).visibleImages.map((image) => image.id), ["a-one", "a-two"]);
  assert.deepEqual(view(images, { schoolMode: false }).visibleImages, images);
});
