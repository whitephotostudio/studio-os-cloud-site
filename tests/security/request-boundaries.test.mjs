import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, mocks = {}, env = {}) {
  const output = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: name => mocks[name] ?? require(name), process: { env }, console: { warn() {} }, Date, Map, AbortSignal });
  return exports;
}

test('production CSP authorizes one nonce and denies inline/eval script execution', () => {
  const { contentSecurityPolicy } = load('lib/content-security-policy.ts');
  const policy = contentSecurityPolicy('MDEyMzQ1Njc4OWFiY2RlZg==');
  const scripts = policy.split('; ').find(value => value.startsWith('script-src'));
  assert.match(scripts, /'nonce-MDEyMzQ1Njc4OWFiY2RlZg=='/);
  assert.match(scripts, /'strict-dynamic'/);
  assert.doesNotMatch(scripts, /unsafe-inline|unsafe-eval/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /upgrade-insecure-requests/);
  assert.throws(() => contentSecurityPolicy("bad'; script-src *"));
});

test('development CSP permits local HMR without weakening production', () => {
  const { contentSecurityPolicy } = load('lib/content-security-policy.ts');
  const policy = contentSecurityPolicy('MDEyMzQ1Njc4OWFiY2RlZg==', true);
  assert.match(policy, /unsafe-eval/);
  assert.match(policy, /ws:/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
});

function rateLimiter({ configured = true, failure = false, production = true } = {}) {
  const observed = [];
  class Redis { constructor(config) { observed.push(config); } }
  class Ratelimit {
    static fixedWindow(...args) { return args; }
    constructor(config) { observed.push(config); }
    async limit() { if (failure) throw new Error('provider secret must not be logged'); return { success: false, remaining: 0, reset: Date.now() + 60_000 }; }
  }
  return { ...load('lib/rate-limit.ts', { '@upstash/redis': { Redis }, '@upstash/ratelimit': { Ratelimit } }, { NODE_ENV: production ? 'production' : 'test', ...(configured ? { UPSTASH_REDIS_REST_URL: 'https://fixture.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'fixture' } : {}) }), observed };
}

test('authentication fails closed when shared counter errors or production configuration is absent', async () => {
  for (const options of [{ failure: true }, { configured: false }]) {
    const limiter = rateLimiter(options);
    const result = await limiter.rateLimit('fixture', { namespace: 'pin', limit: 10, windowSeconds: 60, failClosed: true });
    assert.equal(result.allowed, false);
    assert.equal(result.unavailable, true);
  }
});

test('durable limiter denial is honored and implicit timeout bypass is disabled', async () => {
  const limiter = rateLimiter();
  const result = await limiter.rateLimit('fixture', { namespace: 'pin', limit: 10, windowSeconds: 60, failClosed: true });
  assert.equal(result.allowed, false);
  assert.equal(result.unavailable, undefined);
  assert.equal(limiter.observed[1].timeout, 0);
  assert.equal(typeof limiter.observed[0].signal, 'function');
});

test('local isolated development retains finite in-memory authentication limits', async () => {
  const limiter = rateLimiter({ configured: false, production: false });
  const config = { namespace: 'pin', limit: 1, windowSeconds: 60, failClosed: true };
  assert.equal((await limiter.rateLimit('fixture', config)).allowed, true);
  assert.equal((await limiter.rateLimit('fixture', config)).allowed, false);
});
