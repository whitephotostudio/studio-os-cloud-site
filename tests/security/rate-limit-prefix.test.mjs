import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../../lib/rate-limit.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const config = { namespace: 'api-general', limit: 1, windowSeconds: 60, failClosed: true };

function fixture({ configured = true, production = true, failure = false, counters = new Map(), prefix } = {}) {
  const env = { NODE_ENV: production ? 'production' : 'test',
    ...(configured ? { UPSTASH_REDIS_REST_URL: 'https://fixture.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'synthetic' } : {}),
    ...(prefix === undefined ? {} : { RATE_LIMIT_KEY_PREFIX: prefix }) };
  const observed = { redis: 0, options: [], checks: 0 };
  class Redis { constructor() { observed.redis += 1; } }
  class Ratelimit {
    static fixedWindow(limit, duration) { return { limit, duration }; }
    constructor(options) { this.options = options; observed.options.push(options); }
    async limit(key) {
      observed.checks += 1;
      if (failure) throw Error('synthetic outage');
      const identity = `${this.options.prefix}:${key}`;
      const count = (counters.get(identity) ?? 0) + 1;
      counters.set(identity, count);
      return { success: count <= this.options.limiter.limit,
        remaining: Math.max(0, this.options.limiter.limit - count), reset: Date.now() + 60_000 };
    }
  }
  const exports = {};
  vm.runInNewContext(source, { exports, process: { env }, console: { warn() {} }, Date, Map, AbortSignal,
    require: name => {
      if (name === '@upstash/redis') return { Redis };
      if (name === '@upstash/ratelimit') return { Ratelimit };
      assert.fail(`Unexpected dependency ${name}`);
    } });
  return { ...exports, env, observed, counters };
}

test('unset and empty prefixes keep the exact existing Redis namespace and counter budget', async () => {
  const counters = new Map();
  const existing = fixture({ counters });
  const empty = fixture({ counters, prefix: '' });
  assert.equal((await existing.rateLimit('same-ip', config)).allowed, true);
  assert.equal((await empty.rateLimit('same-ip', config)).allowed, false);
  assert.deepEqual([...counters.keys()], ['rl:api-general:same-ip']);
  for (const f of [existing, empty]) {
    assert.equal(f.observed.options[0].prefix, 'rl:api-general');
    assert.equal(f.observed.options[0].timeout, 0);
    assert.equal(f.observed.options[0].analytics, false);
  }
});

test('a pilot prefix isolates otherwise identical Redis counters without resetting the default budget', async () => {
  const f = fixture();
  assert.equal((await f.rateLimit('same-ip', config)).allowed, true);
  f.env.RATE_LIMIT_KEY_PREFIX = 'lab-pilot_20261015';
  assert.equal((await f.rateLimit('same-ip', config)).allowed, true);
  assert.equal((await f.rateLimit('same-ip', config)).allowed, false);
  f.env.RATE_LIMIT_KEY_PREFIX = 'other-pilot';
  assert.equal((await f.rateLimit('same-ip', config)).allowed, true);
  delete f.env.RATE_LIMIT_KEY_PREFIX;
  assert.equal((await f.rateLimit('same-ip', config)).allowed, false);
  assert.equal(f.observed.redis, 1);
  assert.deepEqual(f.observed.options.map(option => option.prefix), [
    'rl:api-general', 'lab-pilot_20261015:rl:api-general', 'other-pilot:rl:api-general',
  ]);
  assert.equal(f.counters.get('rl:api-general:same-ip'), 2);
  assert.equal(f.counters.get('lab-pilot_20261015:rl:api-general:same-ip'), 2);
});

test('the bounded safe prefix accepts one through 64 ASCII letters, digits, underscores and hyphens', async () => {
  for (const prefix of ['a', 'A0_-', 'p'.repeat(64)]) {
    const f = fixture({ prefix });
    assert.equal((await f.rateLimit('same-ip', config)).allowed, true);
    assert.equal(f.observed.options[0].prefix, `${prefix}:rl:api-general`);
  }
});

test('invalid configured prefixes deny before Redis or fallback, including availability-oriented callers', async () => {
  for (const prefix of [' ', ' pilot', 'pilot ', 'pilot:prod', 'pilot/one', 'pilot\n', '"pilot"', 'é', 'p'.repeat(65)]) {
    for (const configured of [true, false]) {
      const f = fixture({ prefix, configured, production: false });
      for (const failClosed of [true, false]) {
        const result = await f.rateLimit('same-ip', { ...config, failClosed });
        assert.equal(result.allowed, false);
        assert.equal(result.remaining, 0);
        assert.equal(result.unavailable, true);
      }
      assert.equal(f.observed.redis, 0);
      assert.equal(f.observed.checks, 0);
      assert.equal(f.observed.options.length, 0);
      assert.equal(f.counters.size, 0);
      // Correcting configuration starts a fresh allowed budget, proving that
      // invalid requests never silently used the default in-memory namespace.
      delete f.env.RATE_LIMIT_KEY_PREFIX;
      assert.equal((await f.rateLimit('same-ip', config)).allowed, true);
    }
  }
});

test('custom prefixes retain production fail-closed behavior for missing Redis and provider outages', async () => {
  for (const options of [{ configured: false }, { failure: true }]) {
    const f = fixture({ ...options, prefix: 'lab-pilot' });
    const result = await f.rateLimit('same-ip', config);
    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
    assert.equal(result.unavailable, true);
  }
});

test('a valid prefix preserves the existing availability policy during a Redis outage', async () => {
  for (const prefix of [undefined, 'lab-pilot']) {
    const f = fixture({ prefix, failure: true });
    const result = await f.rateLimit('same-ip', { ...config, failClosed: false });
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, config.limit);
    assert.equal(result.unavailable, undefined);
  }
});

test('development memory budgets also remain separate per prefix', async () => {
  const f = fixture({ configured: false, production: false });
  assert.equal((await f.rateLimit('same-ip', config)).allowed, true);
  f.env.RATE_LIMIT_KEY_PREFIX = 'lab-pilot';
  assert.equal((await f.rateLimit('same-ip', config)).allowed, true);
  assert.equal((await f.rateLimit('same-ip', config)).allowed, false);
  delete f.env.RATE_LIMIT_KEY_PREFIX;
  assert.equal((await f.rateLimit('same-ip', config)).allowed, false);
});
