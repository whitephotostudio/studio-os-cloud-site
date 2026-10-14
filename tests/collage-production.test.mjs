import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import ts from "typescript";
import sharp from "sharp";
const nativeRequire = createRequire(import.meta.url), cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const exports = {}; cache.set(name, exports);
  new Function("exports", "require", ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText)(exports,
    id => id.startsWith("@/lib/") ? load(id.slice(6)) : nativeRequire(id));
  return exports;
}
const { collageContentHash, collageArtworkKey } = load("collage-server");
const { renderCollageProduction, parseCollageOrderSnapshot } = load("collage-production");
const owner = "11111111-1111-4111-8111-111111111111";
const template = () => ({ version: 1, name: "Test print", widthInches: 4, heightInches: 4, background: "#ffffff", ink: "#000000", overlay: null,
  slots: [{ id: "main", label: "Main", x: 0, y: 0, width: 1, height: 1 }], caption: { x: .5, y: .82, size: .028 } });
function snapshot(design = template(), changes = {}) {
  return { version: 1, templateVersionId: "22222222-2222-4222-8222-222222222222", templateId: "33333333-3333-4333-8333-333333333333", photographerId: owner, versionNumber: 1,
    design, artworkKey: null, contentHash: collageContentHash(design, null), caption: { studentName: "", schoolName: "", year: "" },
    placements: design.slots.map(slot => ({ slotId: slot.id, mediaId: "source", mediaKey: "schools/original.jpg", zoom: 1, x: .5, y: .5 })), ...changes };
}
const solid = color => sharp({ create: { width: 1200, height: 1200, channels: 3, background: color } }).png().toBuffer();
async function pixel(bytes, x, y) { const p = await sharp(bytes).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer(); return [...p]; }
test("original-resolution renderer produces trim plus bleed at 300ppi and accurate source warnings", async () => {
  const design = { ...template(), bleedInches: .125 };
  const image = await sharp({ create: { width: 1000, height: 2000, channels: 3, background: "#ff0000" } }).png().toBuffer();
  const result = await renderCollageProduction({ snapshot: snapshot(design), loadMedia: async () => image });
  assert.equal(result.width, 1275); assert.equal(result.height, 1275); assert.equal(result.bleedPixels, 37.5);
  assert.deepEqual(result.trim, { width: 1200, height: 1200 });
  assert.deepEqual(result.warnings, [{ slotId: "main", ppi: 250 }]);
  const metadata = await sharp(result.bytes).metadata(); assert.equal(metadata.density, 300);
  assert.deepEqual(await pixel(result.bytes, 5, 5), [255, 255, 255]); assert.deepEqual(await pixel(result.bytes, 600, 600), [255, 0, 0]);
});
test("EXIF orientation is normalized before cover cropping and independent copies retain independent crops", async () => {
  const red = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#ff0000" } }).png().toBuffer();
  const original = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#0000ff" } }).composite([{ input: red, left: 0, top: 0 }]).jpeg({ quality: 100 }).withMetadata({ orientation: 6 }).toBuffer();
  const first = snapshot(), second = snapshot(); first.placements[0].y = 0; second.placements[0].y = 1;
  const a = await renderCollageProduction({ snapshot: first, loadMedia: async () => original });
  const b = await renderCollageProduction({ snapshot: second, loadMedia: async () => original });
  assert.notEqual(a.sha256, b.sha256); const pa = await pixel(a.bytes, 600, 600), pb = await pixel(b.bytes, 600, 600);
  assert.ok(pa[0] > 240 && pa[2] < 15); assert.ok(pb[2] > 240 && pb[0] < 15);
});
test("overlap, repeated photos, inside borders and private artwork layer correctly", async () => {
  const design = template(); design.slots.push({ id: "inset", label: "Inset", x: .5, y: .5, width: .5, height: .5, border: { color: "#000000", widthInches: .05 } });
  let loads = 0;
  const recipe = snapshot(design), red = await solid("#ff0000");
  const repeated = await renderCollageProduction({ snapshot: recipe, loadMedia: async () => { loads++; return red; } });
  assert.equal(loads, 1); assert.deepEqual(await pixel(repeated.bytes, 605, 605), [0, 0, 0]);
  recipe.placements[1].mediaId = "other"; recipe.placements[1].mediaKey = "schools/other.jpg";
  const blue = await solid("#0000ff");
  const green = await sharp({ create: { width: 600, height: 600, channels: 4, background: "#00ff00" } }).png().toBuffer();
  const art = await sharp({ create: { width: 1200, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: green, left: 0, top: 0 }]).png().toBuffer();
  recipe.artworkKey = collageArtworkKey(owner, createHash("sha256").update(art).digest("hex")); recipe.contentHash = collageContentHash(design, recipe.artworkKey);
  const result = await renderCollageProduction({ snapshot: recipe, loadMedia: async key => key.includes("other") ? blue : red, loadArtwork: async () => art });
  assert.deepEqual(await pixel(result.bytes, 100, 100), [0, 255, 0]); assert.deepEqual(await pixel(result.bytes, 100, 900), [255, 0, 0]); assert.deepEqual(await pixel(result.bytes, 900, 900), [0, 0, 255]);
});
test("production rejects URLs, reduced proofs, invalid crops, missing selections and modified snapshots", async () => {
  const recipe = snapshot();
  for (const mediaKey of ["https://other.example/photo.jpg", "schools/../other.jpg", "schools/test_preview.jpg", "order-automation/not-a-photo"]) {
    const changed = structuredClone(recipe); changed.placements[0].mediaKey = mediaKey;
    assert.throws(() => parseCollageOrderSnapshot(changed), /authorized original/);
  }
  assert.throws(() => parseCollageOrderSnapshot({ ...recipe, design: { ...recipe.design, background: "#000000" } }), /changed/);
  assert.throws(() => parseCollageOrderSnapshot({ ...recipe, placements: [] }), /every collage space/);
  const changed = structuredClone(recipe); changed.placements[0].zoom = 10; assert.throws(() => parseCollageOrderSnapshot(changed), /crop/);
});
test("caption XML is escaped and the exact same recipe produces the same print pixels", async () => {
  const recipe = snapshot(); recipe.caption = { studentName: "A & B <2026>", schoolName: "School", year: "2026" };
  const image = await solid("#ffffff");
  const a = await renderCollageProduction({ snapshot: recipe, loadMedia: async () => image });
  const b = await renderCollageProduction({ snapshot: recipe, loadMedia: async () => image });
  assert.equal(a.sha256, b.sha256); assert.ok(a.bytes.length > 10000);
});
test("screen previews bound raster size while preserving original PPI, trim, bleed and crop geometry", async () => {
  const design = { ...template(), widthInches: 10, heightInches: 8, bleedInches: .125 };
  const image = await solid("#ff0000");
  const full = await renderCollageProduction({ snapshot: snapshot(design), loadMedia: async () => image });
  const preview = await renderCollageProduction({ snapshot: snapshot(design), previewMaxDimension: 1200, loadMedia: async () => image });
  const meta = await sharp(preview.bytes).metadata(); assert.equal(meta.width, 1200); assert.ok(meta.height < 1200);
  assert.deepEqual(preview.warnings, full.warnings); assert.equal(preview.width, full.width); assert.equal(preview.height, full.height);
  assert.deepEqual(preview.trim, full.trim); assert.equal(preview.bleedPixels, full.bleedPixels);
  assert.deepEqual(await pixel(preview.bytes, 600, 400), await pixel(full.bytes, 1500, 1200));
});
