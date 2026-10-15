/** Mount the real parent gallery against the isolated E2E server, then remove fixture routes on exit. */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, unlink, rmdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const argument = name => args[args.indexOf(name) + 1];
if (!args.includes('--origin')) throw Error('Pass --origin http://127.0.0.1:<isolated-fixture-port>.');
const origin = new URL(argument('--origin'));
if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(origin.hostname) || origin.pathname !== '/') throw Error('The fixture must use loopback HTTP.');
const port = Number(args.includes('--port') ? argument('--port') : 3114);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Choose a local port between 1024 and 65535.');
const mounted = [
  ['tests/fixtures/collage-e2e/browser-page.tsx', 'app/collage-e2e/page.tsx'],
  ['tests/fixtures/collage-e2e/browser-proxy.ts', 'app/api/collage-e2e/[...path]/route.ts'],
];
for (const [, target] of mounted) {
  try { await access(path.join(root, target)); throw Error(`Refusing to overwrite ${target}.`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
  try { await access(path.join(root, name)); throw Error(`Use the isolated worktree without ${name}; this runner must not load studio credentials.`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const created = [];
async function cleanup() {
  for (const target of created.reverse()) {
    await unlink(path.join(root, target)).catch(() => {});
    let directory = path.dirname(path.join(root, target));
    while (directory !== path.join(root, 'app') && directory !== root) {
      try { await rmdir(directory); } catch { break; }
      directory = path.dirname(directory);
    }
  }
}
try {
  for (const [source, target] of mounted) {
    await mkdir(path.dirname(path.join(root, target)), { recursive: true });
    await writeFile(path.join(root, target), await readFile(path.join(root, source)), { flag: 'wx' });
    created.push(target);
  }
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'USER', 'SHELL', 'LANG'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: `${origin.origin}/supabase`, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'isolated-collage-fixture-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'isolated-collage-fixture-service', COLLAGE_E2E_ORIGIN: origin.origin,
    STUDIO_OS_COLLAGE_CHECKOUT_ENABLED: '1', STUDIO_SECURITY_PHOTO_BACKUP_ENABLED: 'disabled' });
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: root, env, stdio: 'inherit' });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log(`Local parent acceptance: http://127.0.0.1:${port}/collage-e2e (runner PID ${process.pid})`);
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code)); });
  process.exitCode = code ?? 0;
} finally { await cleanup(); }
