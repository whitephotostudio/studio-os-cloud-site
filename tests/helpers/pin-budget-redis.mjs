// Real Redis Lua execution, isolated to an ephemeral private UNIX socket.
import { promises as fs } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
const exec = promisify(execFile);

export async function localPinBudgetRedis() {
  const server = process.env.STUDIO_TEST_REDIS_SERVER || (await fs.access('/opt/homebrew/bin/redis-server').then(() => '/opt/homebrew/bin/redis-server', () => 'redis-server'));
  const cli = process.env.STUDIO_TEST_REDIS_CLI || (await fs.access('/opt/homebrew/bin/redis-cli').then(() => '/opt/homebrew/bin/redis-cli', () => 'redis-cli'));
  await exec(server, ['--version']);
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pin-redis-')));
  await fs.chmod(directory, 0o700);
  const socket = path.join(directory, 'redis.sock');
  const child = spawn(server, ['--port', '0', '--unixsocket', socket, '--unixsocketperm', '600',
    '--save', '', '--appendonly', 'no', '--dir', directory], { stdio: 'ignore' });
  const closed = new Promise(resolve => { child.once('close', resolve); child.once('error', resolve); });
  async function close() {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await closed; } finally { clearTimeout(timer); await fs.rm(directory, { recursive: true, force: true }); }
  }
  const command = async (...args) => {
    const { stdout } = await exec(cli, ['-s', socket, '--json', ...args.map(String)], { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
    if (stdout.startsWith('error:')) throw new Error('Synthetic Redis command failed');
    return JSON.parse(stdout);
  };
  try {
    const deadline = Date.now() + 5000;
    while (true) {
      if (child.exitCode !== null) throw new Error('Local Redis did not start');
      try { if (await command('PING') === 'PONG') break; } catch { /* Socket starts asynchronously. */ }
      if (Date.now() >= deadline) throw new Error('Local Redis did not start');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (((await fs.stat(socket)).mode & 0o777) !== 0o600) throw new Error('Local Redis socket is not private');
    return { command, eval: (script, keys, args) => command('EVAL', script, keys.length, ...keys, ...args), close };
  } catch (error) { await close(); throw error; }
}
