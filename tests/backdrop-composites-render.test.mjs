import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import sharp from 'sharp';
import ts from 'typescript';
import * as encryptedCapability from '../lib/encrypted-capability.ts';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../lib/backdrop-composites.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

async function fixture(width = 60, height = 100) {
  const pixels = Buffer.alloc(width * height * 4);
  // Transparent edges expose the background; a coloured subject makes its
  // enlargement, centering and clipped lower edge visible in the final JPEG.
  for (let y = 10; y < height; y++) {
    for (let x = 10; x < width - 10; x++) {
      const colour = y < 20 ? [0, 255, 0, 255] : y >= height - 15 ? [255, 255, 0, 255] : [255, 0, 0, 255];
      pixels.set(colour, (y * width + x) * 4);
    }
  }
  const foreground = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const background = await sharp({ create: { width: 200, height: 160, channels: 3, background: '#0040ff' } }).jpeg().toBuffer();
  const selections = [];
  const service = {};
  const exports = {};
  new Function('require', 'exports', 'fetch', code)(name => {
    if (name === '@/lib/credit-cutout-access') return { firstPaidCutoutBytes: async (keys, opts) => {
      selections.push({ keys, opts });
      return foreground;
    } };
    if (name === '@/lib/r2') return { r2Download: async key => {
      assert.equal(key, 'backdrops/studio/blue.jpg');
      return background;
    } };
    if (name === '@/lib/dashboard-auth') return { createDashboardServiceClient: () => service };
    if (name === '@/lib/private-media-references') return { privateMediaKeyFromReference: value => value?.startsWith('backdrops/') ? value : '' };
    if (name === '@/lib/photo-url') return { privateSupabaseStorageReference: () => null };
    if (name === '@/lib/authorized-media') return { authorizedMediaUrl: async (actualService, reference, owner) => {
      assert.equal(actualService, service); assert.equal(reference, 'backdrops/studio/blue.jpg'); assert.equal(owner, 'studio');
      return 'https://fixture.invalid/native/blue.jpg';
    } };
    return require(name);
  }, exports, async url => { assert.equal(url, 'https://fixture.invalid/native/blue.jpg'); return new Response(background); });
  async function render(orientation, extra = {}) {
    const result = await exports.composeBackdropImage({
      originalUrlOrKey: 'school/Class/Student/portrait.jpg',
      photographerId: 'studio',
      backdrop: { id: 'blue', image_url: 'backdrops/studio/blue.jpg', ...extra },
      orientation,
    });
    assert.equal(result.contentType, 'image/jpeg');
    assert.equal(result.extension, '.jpg');
    const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
    return { result, info, pixel };
  }
  return { render, selections, composeBackdropImage: exports.composeBackdropImage };
}

const mostly = (pixel, channel) => pixel[channel] > 210 && pixel.filter((_, i) => i !== channel).every(value => value < 55);
const blue = pixel => pixel[2] > 220 && pixel[0] < 35;

test('portrait delivery keeps source dimensions, subject detail and transparent background edges', async () => {
  const f = await fixture();
  const rendered = await f.render('portrait');
  assert.deepEqual([rendered.info.width, rendered.info.height], [60, 100]);
  assert.ok(blue(rendered.pixel(2, 2)));
  assert.ok(mostly(rendered.pixel(30, 15), 1));
  assert.ok(mostly(rendered.pixel(30, 50), 0));
  assert.equal(f.selections.length, 1);
  assert.equal(f.selections[0].opts.photographerId, 'studio');
  assert.ok(f.selections[0].keys.every(key => key.startsWith('nobg-photos/school/Class/Student/')));
});

test('landscape delivery clips the enlarged foreground to its canvas while preserving framing and alpha', async () => {
  const rendered = await (await fixture()).render('landscape');
  assert.deepEqual([rendered.info.width, rendered.info.height], [133, 100]);
  assert.ok(blue(rendered.pixel(3, 3)), 'left margin must show the backdrop');
  assert.ok(blue(rendered.pixel(129, 95)), 'right margin must show the backdrop');
  assert.ok(blue(rendered.pixel(66, 3)), 'the saved downward framing remains visible');
  assert.ok(mostly(rendered.pixel(66, 17), 1), 'upper subject detail stays in its intended position');
  assert.ok(mostly(rendered.pixel(66, 50), 0), 'the subject remains centred');
  const bottom = rendered.pixel(66, 97);
  assert.ok(bottom[0] > 210 && bottom[1] > 210 && bottom[2] < 55, 'lower subject is clipped at the page edge, not scaled down');
});

test('a wide landscape source clips negative horizontal placement without a composition error', async () => {
  const rendered = await (await fixture(240, 100)).render('landscape');
  assert.deepEqual([rendered.info.width, rendered.info.height], [240, 100]);
  assert.ok(mostly(rendered.pixel(120, 50), 0));
  assert.ok(blue(rendered.pixel(1, 3)), 'transparent upper border must survive clipping');
});

test('landscape backdrop blur does not blur the foreground subject', async () => {
  const rendered = await (await fixture()).render('landscape', { blurred: true, blurAmount: 24 });
  assert.deepEqual([rendered.info.width, rendered.info.height], [133, 100]);
  assert.ok(mostly(rendered.pixel(66, 17), 1));
  assert.ok(mostly(rendered.pixel(66, 50), 0));
});

test('paid landscape delivery produces a real JPEG entry in a complete ZIP without fetching an original fallback', async () => {
  const f = await fixture();
  const zip = {};
  const zipCode = ts.transpileModule(readFileSync(new URL('../lib/zip.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('exports', zipCode)(zip);
  const delivery = {};
  const deliveryCode = ts.transpileModule(readFileSync(new URL('../lib/digital-delivery.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const forbidden = () => assert.fail('Landscape delivery must not fetch an original fallback or mutate customer state');
  new Function('require', 'exports', deliveryCode)(name => {
    if (name === '@/lib/encrypted-capability') return encryptedCapability;
    if (name === '@/lib/backdrop-composites') return { composeBackdropImage: f.composeBackdropImage };
    if (name === '@/lib/zip') return zip;
    if (name.startsWith('@/')) return { r2PresignedGetUrl: forbidden };
    return require(name);
  }, delivery);
  const files = [{
    key: 'school/Class/Student/portrait.jpg',
    fileName: 'portrait_blue_backdrop.jpg',
    composite: {
      originalUrlOrKey: 'school/Class/Student/portrait.jpg',
      photographerId: 'studio',
      backdrop: { id: 'blue', image_url: 'backdrops/studio/blue.jpg' },
      orientation: 'landscape',
    },
  }];
  const snapshot = JSON.stringify(files);
  await delivery.assertDigitalDeliveryReady(files);
  const archive = Buffer.from(await new Response(zip.createZipStream(delivery.buildDigitalDeliveryZipEntries(files))).arrayBuffer());
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50, 'ZIP has a complete central directory');
  assert.equal(archive.readUInt16LE(end + 10), 1, 'only the purchased composite is delivered');
  const directory = archive.readUInt32LE(end + 16);
  assert.equal(archive.readUInt32LE(directory), 0x02014b50);
  const size = archive.readUInt32LE(directory + 24);
  const nameLength = archive.readUInt16LE(26);
  assert.equal(archive.subarray(30, 30 + nameLength).toString(), files[0].fileName);
  const image = archive.subarray(30 + nameLength, 30 + nameLength + size);
  const metadata = await sharp(image).metadata();
  assert.deepEqual([metadata.format, metadata.width, metadata.height], ['jpeg', 133, 100]);
  assert.equal(JSON.stringify(files), snapshot, 'paid selection and orientation remain immutable');
});
