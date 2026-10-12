import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import sharp from 'sharp';
import { generateIosAssets } from '../../mobile/scripts/generate-ios-assets.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mobile = path.join(root, 'mobile');
const pixels = async file => createHash('sha256').update(await sharp(file).ensureAlpha().raw().toBuffer()).digest('hex');
async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-ios-assets-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('real Studio OS artwork preserves the old generation pipeline and Xcode catalogs without rewriting tracked assets', async t => {
  const outputDirectory = await temporary(t);
  const result = await generateIosAssets({ outputDirectory });
  assert.deepEqual(result, { ok: true, platform: 'ios', icons: 1, splashes: 6 });
  const current = path.join(mobile, 'ios/App/App/Assets.xcassets');
  for (const [folder, dimension] of [['AppIcon.appiconset', 1024], ['Splash.imageset', 2732]]) {
    const generated = JSON.parse(await fs.readFile(path.join(outputDirectory, folder, 'Contents.json'), 'utf8'));
    const existing = JSON.parse(await fs.readFile(path.join(current, folder, 'Contents.json'), 'utf8'));
    assert.deepEqual(generated, existing);
    for (const image of generated.images) {
      const file = path.join(outputDirectory, folder, image.filename);
      const metadata = await sharp(file).metadata();
      assert.equal(metadata.width, dimension); assert.equal(metadata.height, dimension);
      assert.equal(metadata.format, 'png');
      if (folder === 'AppIcon.appiconset') assert.equal(metadata.hasAlpha, false);
      // The checked-in icon predates current source art. Compare the icon to
      // the original generator's current-art pipeline, not that older icon.
      // Existing splash art does match the checked-in splash pixels.
      const reference = folder === 'AppIcon.appiconset'
        ? await sharp(path.join(mobile, 'assets/icon-only.png')).resize(1024, 1024).png().flatten({ background: '#ffffff' }).toBuffer()
        : path.join(current, folder, image.filename);
      assert.equal(await pixels(file), await pixels(reference), image.filename);
    }
  }
});

test('explicit iOS source art overrides shared icon/splash and keeps dark appearances', async t => {
  const directory = await temporary(t), assetsDirectory = path.join(directory, 'assets');
  await fs.mkdir(path.join(assetsDirectory, 'ios'), { recursive: true });
  const art = async (name, background) => sharp({ create: { width: 32, height: 32, channels: 4, background } }).png().toFile(path.join(assetsDirectory, name));
  await art('logo.png', '#ff0000'); await art('icon-only.png', '#00ff00');
  await art('splash.png', '#00ff00'); await art('splash-dark.png', '#00ff00');
  await art('ios/icon.png', '#0000ff'); await art('ios/splash.png', '#0000ff'); await art('ios/splash-dark.png', '#111111');
  const outputDirectory = path.join(directory, 'output');
  await generateIosAssets({ assetsDirectory, outputDirectory });
  const firstPixel = async file => [...(await sharp(file).removeAlpha().raw().toBuffer()).subarray(0, 3)];
  assert.deepEqual(await firstPixel(path.join(outputDirectory, 'AppIcon.appiconset/AppIcon-512@2x.png')), [0, 0, 255]);
  assert.deepEqual(await firstPixel(path.join(outputDirectory, 'Splash.imageset/Default@1x~universal~anyany.png')), [0, 0, 255]);
  assert.deepEqual(await firstPixel(path.join(outputDirectory, 'Splash.imageset/Default@1x~universal~anyany-dark.png')), [17, 17, 17]);
});

test('logo-only fallback retains centered 20-percent logo and light/dark backgrounds', async t => {
  const directory = await temporary(t), assetsDirectory = path.join(directory, 'assets');
  await fs.mkdir(assetsDirectory);
  await sharp({ create: { width: 100, height: 100, channels: 4, background: '#ff0000' } }).png().toFile(path.join(assetsDirectory, 'logo.png'));
  const outputDirectory = path.join(directory, 'output');
  await generateIosAssets({ assetsDirectory, outputDirectory });
  const sample = async (name, left, top) => [...await sharp(path.join(outputDirectory, 'Splash.imageset', name)).removeAlpha().extract({ left, top, width: 1, height: 1 }).raw().toBuffer()];
  assert.deepEqual(await sample('Default@1x~universal~anyany.png', 0, 0), [255, 255, 255]);
  assert.deepEqual(await sample('Default@1x~universal~anyany-dark.png', 0, 0), [17, 17, 17]);
  assert.deepEqual(await sample('Default@1x~universal~anyany.png', 1366, 1366), [255, 0, 0]);
  assert.deepEqual(await sample('Default@1x~universal~anyany.png', 1380, 1366), [255, 255, 255]);
});

test('missing art and unsupported CLI options fail without rewriting native catalogs', async t => {
  const directory = await temporary(t), outputDirectory = path.join(directory, 'output');
  await assert.rejects(generateIosAssets({ assetsDirectory: directory, outputDirectory }), /required/);
  await assert.rejects(fs.stat(outputDirectory), { code: 'ENOENT' });
  const result = spawnSync(process.execPath, ['scripts/generate-ios-assets.mjs', '--android'], { cwd: mobile, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
});

test('documented icons CLI generates only temporary assets with existing background arguments', async t => {
  const outputDirectory = await temporary(t);
  const result = spawnSync('npm', ['run', 'icons', '--', '--output-dir', outputDirectory, '--iconBackgroundColor', '#ffffff', '--iconBackgroundColorDark', '#ffffff', '--splashBackgroundColor', '#ffffff', '--splashBackgroundColorDark', '#111111'], { cwd: mobile, timeout: 30000, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout.trim().split('\n').at(-1)).splashes, 6);
});
