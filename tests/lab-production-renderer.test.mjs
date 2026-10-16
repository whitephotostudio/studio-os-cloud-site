import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import ts from 'typescript';
import sharp from 'sharp';
import { z } from 'zod';
function load(file, deps = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {}; new Function('require', 'exports', code)(name => { if (!(name in deps)) throw Error('Missing ' + name); return deps[name]; }, exports); return exports;
}
const money = load('lib/labs/money.ts');
const validation = load('lib/labs/validation.ts', { zod: { z }, './money': money });
const r = load('lib/labs/production-renderer.ts', { 'node:crypto': crypto, sharp, './validation': validation });
const hash = r.productionHash;
async function fixture(orientation = 1) {
  const bytes = await sharp({ create: { width: 2400, height: 3000, channels: 3, background: '#b12626' } })
    .composite([{ input: await sharp({ create: { width: 1200, height: 3000, channels: 3, background: '#2169bc' } }).png().toBuffer(), left: 1200, top: 0 }])
    .withMetadata({ orientation }).jpeg({ quality: 95 }).toBuffer();
  return { bytes, asset: { ...await r.inspectProductionImage(bytes), id: crypto.randomUUID(), kind: 'original', filename: 'synthetic.jpg' } };
}
test('complete image decode, EXIF orientation, byte limits and valid crop detail are checked', async () => {
  const { asset, bytes } = await fixture(6);
  assert.equal(asset.widthPixels, 3000); assert.equal(asset.heightPixels, 2400);
  await assert.rejects(r.inspectProductionImage(Buffer.alloc(4_000_001)), /4 MB/);
  await assert.rejects(r.inspectProductionImage(bytes.subarray(0, 350)), /complete/);
  assert.throws(() => r.validateProductionCrop(asset, '8x10', { x: 2000, y: 0, width: 1600, height: 2000, rotation: 0 }), /inside/);
  assert.throws(() => r.validateProductionCrop(asset, '8x10', { x: 0, y: 0, width: 800, height: 1000, rotation: 0 }), /200 pixels/);
  assert.throws(() => r.validateProductionCrop(asset, '5x7', { x: 0, y: 0, width: 1600, height: 2000, rotation: 0 }), /shape/);
  assert.doesNotThrow(() => r.validateProductionCrop(asset, '8x10', { x: 0, y: 0, width: 2000, height: 1600, rotation: 90 }));
});
test('crop uses upright original coordinates before explicit rotation and produces metadata-safe 300ppi sRGB output', async () => {
  const { bytes, asset } = await fixture();
  const rect = { x: 0, y: 0, width: 2000, height: 2800, rotation: 0 };
  const crop = await r.renderProductionCrop(bytes, asset, '5x7', rect);
  const m = await sharp(crop).metadata();
  assert.equal(m.width, 1500); assert.equal(m.height, 2100); assert.equal(m.density, 300); assert.ok(m.icc); assert.equal(m.exif, undefined);
  assert.equal(hash(crop), hash(await r.renderProductionCrop(bytes, asset, '5x7', rect)));
  await assert.rejects(r.renderProductionCrop(Buffer.from('wrong'), asset, '5x7', rect), /integrity/);
  const phone = await fixture(6);
  const uprightCrop = await r.renderProductionCrop(phone.bytes, phone.asset, '8x10', { x: 0, y: 0, width: 1600, height: 2000, rotation: 0 });
  assert.equal((await sharp(uprightCrop).metadata()).width, 2400);
  // EXIF 6 rotates blue/right half to the bottom; upright source top is red.
  const top = await sharp(uprightCrop).extract({ left: 100, top: 100, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(top[0] > top[2]);
});
test('two approved 5x7 cells fill exactly one 10x7 sheet, without a second crop', async () => {
  const { bytes, asset } = await fixture();
  const crop = await r.renderProductionCrop(bytes, asset, '5x7', { x: 0, y: 0, width: 2000, height: 2800, rotation: 0 });
  const finalAsset = { ...await r.inspectProductionImage(crop), id: crypto.randomUUID(), kind: 'crop', filename: 'crop.jpg' };
  const pair = await r.packProductionPair(crop, finalAsset), m = await sharp(pair).metadata();
  assert.equal(m.width, 3000); assert.equal(m.height, 2100); assert.equal(m.density, 300); assert.equal(m.exif, undefined);
  const pixel = async x => [...await sharp(pair).extract({ left: x, top: 1000, width: 1, height: 1 }).raw().toBuffer()];
  assert.deepEqual(await pixel(100), await pixel(1600)); assert.deepEqual(await pixel(1300), await pixel(2800));
  assert.ok((await pixel(100))[0] > (await pixel(100))[2]); assert.ok((await pixel(1300))[2] > (await pixel(1300))[0]);
  await assert.rejects(r.packProductionPair(crop, { ...finalAsset, sha256: 'f'.repeat(64) }), /integrity/);
});
test('automatic order approval cannot bypass crop, colour, acceptance or final file review', () => {
  const line = size => ({ size, cropApproved: true, cropAsset: {}, finalAsset: {}, finalReviewedAt: new Date().toISOString(), colourAsset: {}, colourCompletedAt: new Date().toISOString() });
  const ready = { holds: [], status: 'accepted', photographerApproved: true, policy: { autoApprove: true, labColourCorrection: true }, lines: [line('8x10'), line('5x7')] };
  assert.doesNotThrow(() => r.requireProductionReady(ready));
  for (const patch of [{ status: 'submitted' }, { photographerApproved: false }, { holds: ['crop_5x7'] }, { lines: [line('8x10'), { ...line('5x7'), finalReviewedAt: null }] }, { lines: [line('8x10'), { ...line('5x7'), colourCompletedAt: null }] }]) assert.throws(() => r.requireProductionReady({ ...ready, ...patch }), /Complete/);
});

test('independent 5x7 revisions stay in their own left/right cells until the final 10x7 is assembled', async () => {
  const make = async color => {
    const bytes = r.productionJpegDensity(await sharp({ create: { width: 1500, height: 2100, channels: 3, background: color } }).jpeg().toBuffer());
    return { bytes, asset: { ...await r.inspectProductionImage(bytes), id: crypto.randomUUID(), kind: 'crop', filename: 'reviewed.jpg' } };
  };
  const a=await make('#e00000'), b=await make('#0000e0'), changedB=await make('#00b000');
  const first=await r.packProductionDistinctPair(a,b), revised=await r.packProductionDistinctPair(a,changedB);
  const pixel=async(bytes,x)=>[...await sharp(bytes).extract({left:x,top:1000,width:1,height:1}).raw().toBuffer()];
  assert.deepEqual(await pixel(first,700),await pixel(revised,700));
  assert.ok((await pixel(first,2200))[2]>180);assert.ok((await pixel(revised,2200))[1]>150);
  const m=await sharp(revised).metadata();assert.equal(m.width,3000);assert.equal(m.height,2100);assert.equal(m.density,300);assert.equal(m.exif,undefined);
  await assert.rejects(r.packProductionDistinctPair(a,{bytes:changedB.bytes,asset:b.asset}),/integrity/);
});
