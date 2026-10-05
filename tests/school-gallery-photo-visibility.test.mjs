import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const gallerySource = readFileSync(new URL("../app/parents/[pin]/page.tsx", import.meta.url), "utf8");
const galleryAst = ts.createSourceFile("parent-gallery.tsx", gallerySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = galleryAst.statements.find((statement) =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "ParentGalleryPage");
assert.ok(component?.body, "Find the actual parent gallery component");

const declarations = new Map(component.body.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => statement.declarationList.declarations)
  .filter((declaration) => ts.isIdentifier(declaration.name))
  .map((declaration) => [declaration.name.text, declaration]));
function declarationSource(name) {
  const declaration = declarations.get(name);
  assert.ok(declaration?.initializer, `Find the actual ${name} declaration`);
  return `const ${name} = ${declaration.initializer.getText(galleryAst)};`;
}
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function loadHelpers(relativePath) {
  const exports = {};
  new Function("exports", compile(readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8")))(exports);
  return exports;
}
const { usableParentCutouts, canOfferParentBackdrops } = loadHelpers("lib/parent-backdrop-access.ts");
const { imagesInEventAlbum } = loadHelpers("lib/event-album-navigation.ts");
const compositePredicate = galleryAst.statements.find((statement) =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "isCompositeGalleryImage");
assert.ok(compositePredicate, "Use the actual composite predicate");

// Include the old prerequisite while reproducing the regression, then evaluate
// the same visibleImages declaration after the visibility filter is removed.
const projectionSource = [
  compositePredicate.getText(galleryAst),
  ...(declarations.has("schoolModeVisibleImages") ? [declarationSource("schoolModeVisibleImages")] : []),
  ...["visibleImages", "selectedImage", "isCompositeSelection", "currentNobgUrl", "hasBackdrops"].map(declarationSource),
  "return { visibleImages, selectedImage, hasBackdrops };",
].join("\n");
const project = new Function(
  "images", "nobgUrls", "isSchoolMode", "activeEventCollectionId", "selectedImageIndex", "backdrops",
  "imagesInEventAlbum", "canOfferParentBackdrops", compile(projectionSource),
);
function view(images, nobgUrls = {}, options = {}) {
  return project(images, nobgUrls, options.schoolMode ?? true, options.album ?? null,
    options.index ?? 0, options.backdrops ?? [{ id: "background" }], imagesInEventAlbum, canOfferParentBackdrops);
}

const photos = Array.from({ length: 6 }, (_, index) => ({
  id: `photo-${index + 1}`, source: "photo", url: `/portrait-${index + 1}.jpg`,
  collectionId: index < 3 ? "album-a" : "album-b",
}));
const photoIds = photos.map((photo) => photo.id);
const allCutouts = Object.fromEntries(photos.map((photo) => [photo.id, `/ready-${photo.id}.png`]));

for (const [scenario, candidates, load] of [
  ["no authorized cutouts", {}, async () => assert.fail("No public filename discovery")],
  ["one usable cutout", { "photo-1": "/ready.png" }, async () => true],
  ["all usable cutouts", allCutouts, async () => true],
  ["one expired cutout alongside a usable cutout", { "photo-1": "/ready.png", "photo-2": "/expired.png" }, async (url) => url !== "/expired.png"],
  ["one rejected load alongside a usable cutout", { "photo-1": "/ready.png", "photo-2": "/offline.png" }, async (url) => {
    if (url === "/offline.png") throw new Error("offline");
    return true;
  }],
  ["every cutout load fails", allCutouts, async () => false],
]) {
  test(`all six poses remain visible before and after asynchronous readiness: ${scenario}`, async () => {
    let release;
    const loading = new Promise((resolve) => { release = resolve; });
    const pending = usableParentCutouts(candidates, photoIds, async (url) => {
      await loading;
      return load(url);
    });
    const before = view(photos, {}, { index: 4 });
    assert.deepEqual(before.visibleImages.map((photo) => photo.id), photoIds);
    assert.equal(before.selectedImage, photos[4]);
    release();
    const usable = await pending;
    const after = view(photos, usable, { index: 4 });
    assert.deepEqual(after.visibleImages.map((photo) => photo.id), photoIds);
    assert.equal(after.selectedImage, photos[4], "Completing cutout checks must preserve the selected pose");
    assert.equal(after.hasBackdrops, !!usable[photos[4].id], "Readiness only controls background options for the selected pose");
  });
}

test("selecting the final pose before one cutout finishes keeps that pose selected", async () => {
  const usable = await usableParentCutouts({ "photo-1": "/ready.png" }, photoIds, async () => true);
  assert.equal(view(photos, {}, { index: 5 }).selectedImage, photos[5]);
  assert.equal(view(photos, usable, { index: 5 }).selectedImage, photos[5]);
});

test("composites and originals coexist when only one portrait has background options", async () => {
  const composite = { id: "composite-class", source: "composite", url: "/class.jpg" };
  const images = [...photos, composite];
  const usable = await usableParentCutouts({ "photo-1": "/ready.png" }, photoIds, async () => true);
  const expectedIds = images.map((photo) => photo.id);
  assert.deepEqual(view(images).visibleImages.map((photo) => photo.id), expectedIds);
  const after = view(images, usable, { index: 6 });
  assert.deepEqual(after.visibleImages.map((photo) => photo.id), expectedIds);
  assert.equal(after.selectedImage, composite);
  assert.equal(after.hasBackdrops, false, "A class composite never offers portrait backdrops");
});

test("the actual selected-photo chooser remains gated to a usable portrait and configured catalog", () => {
  const usable = { "photo-1": "/ready.png" };
  assert.equal(view(photos, usable).hasBackdrops, true);
  for (let index = 1; index < photos.length; index += 1) {
    assert.equal(view(photos, usable, { index }).hasBackdrops, false, `Pose ${index + 1} has no cutout`);
  }
  assert.equal(view(photos, usable, { backdrops: [] }).hasBackdrops, false);
  const composite = { id: "composite-class", source: "composite", url: "/class.jpg" };
  assert.equal(view([composite], { [composite.id]: "/unexpected.png" }).hasBackdrops, false);
  assert.equal(view(photos, usable, { schoolMode: false }).hasBackdrops, false);
});

test("event album scopes remain unchanged by portrait cutout readiness", () => {
  const usable = { "photo-1": "/ready.png" };
  for (const [album, expected] of [[null, photoIds], ["album-a", photoIds.slice(0, 3)], ["album-b", photoIds.slice(3)], ["missing", []]]) {
    for (const cutouts of [{}, usable]) {
      const state = view(photos, cutouts, { schoolMode: false, album });
      assert.deepEqual(state.visibleImages.map((photo) => photo.id), expected);
      assert.equal(state.hasBackdrops, false);
    }
  }
  assert.deepEqual(view(photos, usable, { album: "album-a" }).visibleImages.map((photo) => photo.id), photoIds,
    "Event album selection does not filter a school gallery");
});
