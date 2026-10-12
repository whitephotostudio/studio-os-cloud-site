#!/usr/bin/env node
// iOS-only replacement for the unmaintained @capacitor/assets tool. Keep the
// existing Xcode filenames, source precedence, resize and logo fallback rules.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const mobileDirectory = fileURLToPath(new URL('../', import.meta.url));
const formats = ['.png', '.webp', '.jpg', '.jpeg', '.svg'];
const info = { author: 'xcode', version: 1 };

async function sourceFile(directory, stems) {
  for (const stem of stems) for (const format of formats) {
    const file = path.join(directory, `${stem}${format}`);
    try {
      if ((await fs.stat(file)).isFile()) return file;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return null;
}

async function contentsInfo(directory) {
  try { return JSON.parse(await fs.readFile(path.join(directory, 'Contents.json'), 'utf8')).info ?? info; }
  catch (error) { if (error.code !== 'ENOENT') throw error; return info; }
}

export async function generateIosAssets({
  assetsDirectory = path.join(mobileDirectory, 'assets'),
  outputDirectory = path.join(mobileDirectory, 'ios/App/App/Assets.xcassets'),
  iconBackgroundColor = '#ffffff',
  splashBackgroundColor = '#ffffff',
  splashBackgroundColorDark = '#111111',
} = {}) {
  const logo = await sourceFile(assetsDirectory, ['logo', 'icon']);
  const logoDark = await sourceFile(assetsDirectory, ['logo-dark']);
  const icon = await sourceFile(assetsDirectory, ['ios/icon', 'icon-only']) ?? logo;
  const light = await sourceFile(assetsDirectory, ['ios/splash', 'splash']);
  const dark = await sourceFile(assetsDirectory, ['ios/splash-dark', 'splash-dark']);
  if (!icon || (!light && !logo) || (!dark && !logoDark && !logo)) {
    throw new Error('An icon or logo and light/dark splash sources are required.');
  }

  // Decode and render before writing so an invalid source cannot leave a
  // partially generated catalog. Sharp bounds decompressed input pixels.
  const iconBytes = await sharp(icon).resize(1024, 1024).png()
    .flatten({ background: iconBackgroundColor }).toBuffer();
  async function splash(source, fallback, background) {
    if (source) return sharp(source).resize(2732, 2732).png().toBuffer();
    const metadata = await sharp(fallback).metadata();
    const targetWidth = Math.floor(metadata.width * 0.2);
    const resized = await sharp(fallback).resize(targetWidth).toBuffer();
    return sharp({ create: { width: 2732, height: 2732, channels: 4, background } })
      .composite([{ input: resized, gravity: 'centre' }]).png().toBuffer();
  }
  const lightBytes = await splash(light, logo, splashBackgroundColor);
  const darkBytes = await splash(dark, logoDark ?? logo, splashBackgroundColorDark);
  const iconDirectory = path.join(outputDirectory, 'AppIcon.appiconset');
  const splashDirectory = path.join(outputDirectory, 'Splash.imageset');
  const iconInfo = await contentsInfo(iconDirectory);
  const splashInfo = await contentsInfo(splashDirectory);
  await fs.mkdir(iconDirectory, { recursive: true });
  await fs.mkdir(splashDirectory, { recursive: true });
  await fs.writeFile(path.join(iconDirectory, 'AppIcon-512@2x.png'), iconBytes);
  const images = [];
  for (const isDark of [false, true]) for (const scale of [1, 2, 3]) {
    const filename = `Default@${scale}x~universal~anyany${isDark ? '-dark' : ''}.png`;
    await fs.writeFile(path.join(splashDirectory, filename), isDark ? darkBytes : lightBytes);
    images.push({ ...(isDark ? { appearances: [{ appearance: 'luminosity', value: 'dark' }] } : {}),
      idiom: 'universal', scale: `${scale}x`, filename });
  }
  await fs.writeFile(path.join(iconDirectory, 'Contents.json'), JSON.stringify({
    images: [{ idiom: 'universal', size: '1024x1024', filename: 'AppIcon-512@2x.png', platform: 'ios' }], info: iconInfo,
  }, null, 2));
  await fs.writeFile(path.join(splashDirectory, 'Contents.json'), JSON.stringify({ images, info: splashInfo }, null, 2));
  return { ok: true, platform: 'ios', icons: 1, splashes: 6 };
}

function argumentsFor(args) {
  const options = {};
  const names = { '--asset-path': 'assetsDirectory', '--output-dir': 'outputDirectory',
    '--iconBackgroundColor': 'iconBackgroundColor', '--splashBackgroundColor': 'splashBackgroundColor',
    '--splashBackgroundColorDark': 'splashBackgroundColorDark' };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--ios') continue;
    // The old tool accepted this option, but its iOS icon output has no dark
    // variant. Retain the documented argument without changing that behavior.
    if (args[index] === '--iconBackgroundColorDark' && args[index + 1]) { index++; continue; }
    const name = names[args[index]];
    if (!name || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Unsupported asset generation argument.');
    options[name] = args[++index];
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  Promise.resolve().then(() => generateIosAssets(argumentsFor(process.argv.slice(2)))).then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error('iOS asset generation failed; check source artwork and arguments.'); process.exitCode = 1; });
}
