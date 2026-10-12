import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const pluginRequire = createRequire(require.resolve('@next/eslint-plugin-next'));
const { getRootDirs } = pluginRequire('./utils/get-root-dirs.js');

test('the scoped Next lint glob substitution retains the real plugin rootDir API', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-next-rootdirs-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const name of ['alpha', 'beta']) await fs.mkdir(path.join(directory, 'packages', name), { recursive: true });
  await fs.writeFile(path.join(directory, 'packages', 'ordinary-file'), 'fixture');
  const pattern = `${directory}/packages/*`;
  const expected = ['alpha', 'beta'].map(name => `${directory}/packages/${name}`);
  const context = rootDir => ({ cwd: directory, settings: { next: { rootDir } } });
  assert.deepEqual(getRootDirs({ cwd: directory, settings: {} }), [directory]);
  assert.deepEqual(getRootDirs(context(process.cwd())), [process.cwd()]);
  assert.deepEqual(getRootDirs(context('.')), ['.']);
  assert.deepEqual(getRootDirs(context(pattern)).sort(), expected);
  const relativePattern = path.relative(process.cwd(), `${directory}/packages/*`).replaceAll('\\', '/');
  assert.deepEqual(getRootDirs(context(relativePattern)).sort(), expected.map(dir => path.relative(process.cwd(), dir).replaceAll('\\', '/')));
  assert.deepEqual(getRootDirs(context(`${directory}/packages/{alpha,beta}`)).sort(), expected);
  assert.deepEqual(getRootDirs(context([`${directory}/packages/alpha`, 42, `${directory}/packages/beta`])).sort(), expected);
  assert.deepEqual(getRootDirs(context(pattern.replaceAll('/', '\\'))).sort(), expected);
  assert.deepEqual(getRootDirs(context(`${directory}/missing-*`)), []);
  const globPackage = pluginRequire('fast-glob/package.json');
  assert.equal(globPackage.name, 'studio-next-eslint-glob');
  assert.equal(globPackage.dependencies.tinyglobby, '0.2.17');
});

test('the actual Next ESLint rule still finds pages through the substituted root glob', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-next-eslint-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'packages', 'site', 'pages'), { recursive: true });
  await fs.writeFile(path.join(directory, 'packages', 'site', 'pages', 'index.js'), 'export default function Page() { return null; }');
  const { ESLint } = require('eslint');
  const eslint = new ESLint({ cwd: directory, overrideConfigFile: true, overrideConfig: [{
    files: ['**/*.jsx'], languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { '@next/next': require('@next/eslint-plugin-next') },
    settings: { next: { rootDir: `${directory}/packages/*` } },
    rules: { '@next/next/no-html-link-for-pages': 'error' },
  }] });
  const [result] = await eslint.lintText('export default function Page() { return <a href="/">Home</a>; }', { filePath: 'test.jsx' });
  assert.equal(result.fatalErrorCount, 0);
  assert.ok(result.messages.some(message => message.ruleId === '@next/next/no-html-link-for-pages'));
});

test('the replacement glob handles deeply nested untrusted patterns without recursive braces walkers', () => {
  const script = `const glob=require(${JSON.stringify(pluginRequire.resolve('fast-glob'))});glob.globSync('{'.repeat(10000)+'missing'+ '}'.repeat(10000),{onlyDirectories:true});`;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: root, timeout: 5000, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('lockfiles retain patched native bindings and no legacy asset/brace chain', async () => {
  const site = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const mobile = JSON.parse(await fs.readFile(path.join(root, 'mobile/package-lock.json'), 'utf8'));
  assert.equal(site.packages['node_modules/next'].version, '16.4.0');
  assert.equal(site.packages['node_modules/eslint-config-next'].version, '16.4.0');
  assert.ok(!Object.keys(site.packages).some(key => /node_modules\/(braces|micromatch)$/.test(key)));
  for (const name of ['core', 'ios', 'cli']) assert.equal(mobile.packages[`node_modules/@capacitor/${name}`].version, '8.4.3');
  assert.equal(mobile.packages['node_modules/sharp'].version, '0.35.5');
  assert.ok(!Object.keys(mobile.packages).some(key => /node_modules\/(@capacitor\/assets|@trapezedev\/project|xcode|uuid)$/.test(key)));
});
