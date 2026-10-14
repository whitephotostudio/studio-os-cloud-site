import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const exports = {};
new Function('exports', ts.transpileModule(
  readFileSync(new URL('../lib/collage-template.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText)(exports);
const { collagePreset, parseCollageTemplate, collageCrop, collageResolution } = exports;

test('both sample layouts round-trip as portable templates at print dimensions', () => {
  for (const kind of ['triptych', 'graduation']) {
    const t = collagePreset(kind);
    assert.deepEqual(parseCollageTemplate(JSON.parse(JSON.stringify(t))), t);
    assert.equal(t.slots.length, kind === 'triptych' ? 3 : 2);
    assert.equal(t.widthInches * 300, kind === 'triptych' ? 3000 : 2400);
    assert.equal(t.heightInches * 300, kind === 'triptych' ? 2400 : 3000);
  }
});

test('cover crops fill a frame and zoom/pan stay inside the source photo', () => {
  assert.deepEqual(collageCrop(4000, 3000, 600, 900), { x: 1000, y: 0, width: 2000, height: 3000 });
  assert.deepEqual(collageCrop(4000, 3000, 600, 900, 2, 1, 1), { x: 3000, y: 1500, width: 1000, height: 1500 });
  for (const dims of [[4000, 3000], [1000, 4000]]) {
    for (const zoom of [1, 1.5, 3]) {
      const crop = collageCrop(...dims, 700, 500, zoom, 2, -1);
      assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= dims[0] + 1e-8 && crop.y + crop.height <= dims[1] + 1e-8);
      assert.ok(Math.abs(crop.width / crop.height - 1.4) < 1e-10);
    }
  }
  assert.throws(() => collageCrop(0, 10, 10, 10));
  assert.throws(() => collageCrop(10, 10, 10, 10, NaN));
});

test('resolution checks include the actual crop and zoom', () => {
  const t = collagePreset('triptych'), slot = t.slots[0];
  const p = { photo: { width: 2700, height: 4960, url: 'blob:test', filename: 'test.jpg' }, zoom: 1, x: .5, y: .5 };
  assert.equal(collageResolution(t, slot, p), 1000);
  assert.equal(collageResolution(t, slot, { ...p, zoom: 2 }), 500);
});

test('imports reject external assets, unsupported formats and malformed layout geometry', () => {
  const source = collagePreset('triptych');
  for (const patch of [{ version: 2 }, { widthInches: Infinity }, { widthInches: 30, heightInches: 30 },
    { overlay: 'https://example.com/portrait.jpg' }, { overlay: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { background: 'url(https://example.com)' }, { slots: [] }, { slots: Array(9).fill(source.slots[0]) },
    { slots: [source.slots[0], source.slots[0]] }, { slots: [{ ...source.slots[0], x: .9 }] },
    { slots: [{ ...source.slots[0], height: -1 }] }, { caption: { x: .5, y: .99, size: .02 } }]) {
    assert.throws(() => parseCollageTemplate({ ...source, ...patch }), JSON.stringify(patch));
  }
  const png = 'data:image/png;base64,aGVsbG8=';
  assert.equal(parseCollageTemplate({ ...source, overlay: png }).overlay, png);
});

test('template export discards student names, photo selections and unexpected fields', () => {
  const source = collagePreset('triptych');
  const imported = parseCollageTemplate({ ...source, studentName: 'Private name', placements: { left: 'private.jpg' },
    slots: source.slots.map(s => ({ ...s, assignedImageUrl: 'private.jpg' })) });
  assert.deepEqual(imported, source);
  assert.ok(!JSON.stringify(imported).includes('private.jpg'));
});
