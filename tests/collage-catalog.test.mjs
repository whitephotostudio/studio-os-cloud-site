import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(name) {
  const exports = {};
  new Function("exports", "require", ts.transpileModule(readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(exports,
    id => load(id.replace(/^\.\//, "")));
  return exports;
}
const { galleryCollagePackageAvailable, collageVersionBatches } = load("collage-catalog");
const id = n => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000001`;
const collage = n => ({ qty: 2, collage: { templateVersionId: id(n) } });
test("a shared price sheet exposes only designs authorized for the current gallery while preserving ordinary products", () => {
  const available = { [id(1)]: { design: "School A" } };
  assert.equal(galleryCollagePackageAvailable({ items: [collage(1)] }, available), true);
  assert.equal(galleryCollagePackageAvailable({ items: [collage(2)] }, available), false);
  assert.equal(galleryCollagePackageAvailable({ items: ["5x7", { composite: true }] }, available), true);
  assert.equal(galleryCollagePackageAvailable({ items: ["5x7", collage(1)] }, available), true);
  assert.equal(galleryCollagePackageAvailable({ items: [collage(1), collage(2)] }, available), false);
  assert.equal(galleryCollagePackageAvailable({ items: [{ collage: { templateVersionId: "invalid" } }] }, available), false);
});
test("large catalogues request every distinct version in bounded batches without changing copy selections", () => {
  const ids = Array.from({ length: 51 }, (_, n) => id(n));
  const batches = collageVersionBatches([...ids, ids[0], ids[1]]);
  assert.deepEqual(batches.map(batch => batch.length), [20, 20, 11]);
  assert.deepEqual(batches.flat(), ids);
  assert.deepEqual(collageVersionBatches([]), []);
});
