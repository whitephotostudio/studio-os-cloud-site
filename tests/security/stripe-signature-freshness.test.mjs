import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../../lib/payments.ts', import.meta.url), 'utf8');
const functionSource = source.slice(source.indexOf('export async function verifyStripeSignature('), source.indexOf('export async function recordStripeEvent('));
const code = ts.transpileModule(functionSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const now = 1_800_000_000;
const exports = {};
new Function('exports', 'createHmac', 'timingSafeEqual', 'Date', code)(exports, createHmac, timingSafeEqual, { now: () => now * 1000 });
const verify = exports.verifyStripeSignature;
const secret = 'synthetic-webhook-secret', payload = '{"id":"evt_local_fixture","type":"local.test"}';
const signature = (timestamp, value = payload, key = secret) => createHmac('sha256', key).update(`${timestamp}.${value}`).digest('hex');
const header = timestamp => `t=${timestamp},v1=${signature(timestamp)}`;

test('fresh Stripe signatures work across clock skew and secret rotation', async () => {
  for (const timestamp of [now, now - 300, now + 300]) {
    assert.equal(await verify(payload, header(timestamp), [secret]), true);
  }
  assert.equal(await verify(payload, `t=${now},v1=${'0'.repeat(64)}, v1=${signature(now)}`, ['retired-fixture', secret]), true);
});

test('validly signed stale, future and malformed timestamps fail closed', async () => {
  for (const timestamp of [now - 301, now + 301, 1, 'NaN', '1e9', '-1', '1800000000.1', '9007199254740992', '']) {
    assert.equal(await verify(payload, header(timestamp), [secret]), false, String(timestamp));
  }
  assert.equal(await verify(payload, `t=${now},t=${now},v1=${signature(now)}`, [secret]), false);
});

test('modified bodies, invalid signatures and missing signing credentials are rejected', async () => {
  assert.equal(await verify(`${payload} `, header(now), [secret]), false);
  assert.equal(await verify(payload, `t=${now},v1=invalid`, [secret]), false);
  assert.equal(await verify(payload, `t=${now},v1=${'f'.repeat(64)}`, [secret]), false);
  assert.equal(await verify(payload, header(now), []), false);
  assert.equal(await verify(payload, `v1=${signature(now)}`, [secret]), false);
});
