import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const exports = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../lib/school-visitor-email-client.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(exports);
const { runVisitorEmailCampaign: run, visitorEmailProgress: progress } = exports;

const addresses = count => Array.from({ length: count }, (_, index) => `parent-${index}@example.test`);
function batch(recipients, offset, overrides = {}) {
  const selected = recipients.slice(offset, offset + 100);
  return { ok: true, total: recipients.length, offset, sent: selected.length, failed: 0, pending: 0,
    outcomes: selected.map(recipientEmail => ({ recipientEmail, status: 'sent', providerId: `proof-${recipientEmail}` })),
    nextOffset: offset + selected.length < recipients.length ? offset + selected.length : null, paused: false, ...overrides };
}
const noWait = async () => {};

test('campaign advances only through acknowledged batches and aggregates every accepted contact', async () => {
  const recipients = addresses(221), requested = [], pauses = [], outcomes = new Map();
  const final = await run({ offset: 0, recipients, requestBatch: async offset => { requested.push(offset); return batch(recipients, offset); },
    onBatch: result => result.outcomes.forEach(outcome => outcomes.set(outcome.recipientEmail, outcome)), wait: async delay => { pauses.push(delay); } });
  assert.deepEqual(requested, [0, 100, 200]);
  assert.deepEqual(pauses, [1000, 1000]);
  assert.equal(final.nextOffset, null);
  assert.deepEqual(progress(outcomes.values(), recipients.length), { sent: 221, failed: 0, pending: 0, total: 221 });
});

test('a lost request leaves the saved cursor at the failed batch and resumes from that exact position', async () => {
  const recipients = addresses(221), requested = [];
  let savedOffset = 0;
  const onBatch = result => { if (result.nextOffset !== null) savedOffset = result.nextOffset; };
  await assert.rejects(run({ offset: savedOffset, recipients, requestBatch: async offset => {
    requested.push(offset); if (offset === 100) throw new Error('Connection lost after request'); return batch(recipients, offset);
  }, onBatch, wait: noWait }), /Connection lost/);
  assert.deepEqual(requested, [0, 100]);
  assert.equal(savedOffset, 100);
  await run({ offset: savedOffset, recipients, requestBatch: async offset => { requested.push(offset); return batch(recipients, offset); }, onBatch, wait: noWait });
  assert.deepEqual(requested, [0, 100, 100, 200]);
});

test('provider pause retains the same cursor and replay replaces failed outcomes without duplicate totals', async () => {
  const recipients = addresses(151), outcomes = new Map(), requested = [];
  let savedOffset = 0;
  const onBatch = result => {
    if (result.nextOffset !== null) savedOffset = result.nextOffset;
    result.outcomes.forEach(outcome => outcomes.set(outcome.recipientEmail, outcome));
  };
  const paused = await run({ offset: 0, recipients, requestBatch: async offset => {
    requested.push(offset);
    if (offset === 100) return batch(recipients, offset, { sent: 0, failed: 51, nextOffset: 100, paused: true, retryAllowed: true, retryAfterMs: 60000,
      outcomes: recipients.slice(100).map(recipientEmail => ({ recipientEmail, status: 'failed', error: 'Quota reached' })) });
    return batch(recipients, offset);
  }, onBatch, wait: noWait });
  assert.equal(paused.retryAfterMs, 60000);
  assert.equal(savedOffset, 100);
  assert.deepEqual(progress(outcomes.values(), 151), { sent: 100, failed: 51, pending: 0, total: 151 });
  await run({ offset: savedOffset, recipients, requestBatch: async offset => { requested.push(offset); return batch(recipients, offset); }, onBatch, wait: noWait });
  assert.deepEqual(requested, [0, 100, 100]);
  assert.deepEqual(progress(outcomes.values(), 151), { sent: 151, failed: 0, pending: 0, total: 151 });
});

test('replayed aggregate outcomes count each normalized address once, using its latest outcome', () => {
  assert.deepEqual(progress([
    { recipientEmail: 'Parent@Example.test', status: 'failed' },
    { recipientEmail: 'other@example.test', status: 'pending' },
    { recipientEmail: ' parent@example.test ', status: 'sent', providerId: 'proof-1' },
    { recipientEmail: 'parent@example.test', status: 'sent', providerId: 'proof-1' },
  ], 3), { sent: 1, failed: 0, pending: 2, total: 3 });
});

test('more than 5000 contacts continue automatically through bounded requests with no campaign selection cap', async () => {
  const recipients = addresses(5101), requested = [], outcomes = new Map();
  await run({ offset: 0, recipients, requestBatch: async offset => {
    requested.push(offset); return batch(recipients, offset);
  }, onBatch: result => result.outcomes.forEach(outcome => outcomes.set(outcome.recipientEmail, outcome)), wait: noWait });
  assert.equal(requested.length, 52);
  assert.equal(requested[0], 0);
  assert.equal(requested.at(-1), 5100);
  assert.equal(outcomes.size, 5101);
  assert.deepEqual(progress(outcomes.values(), 5101), { sent: 5101, failed: 0, pending: 0, total: 5101 });
});

test('unconfirmed, stale, skipped, truncated or foreign batch responses never advance saved progress', async () => {
  const recipients = addresses(151);
  const corruptions = [
    { ok: false }, { offset: 100 }, { nextOffset: 0 }, { nextOffset: 101 }, { nextOffset: 0.5 }, { nextOffset: null },
    { total: 99 }, { outcomes: [] }, { outcomes: null }, { sent: 99 }, { paused: true, nextOffset: null },
    { retryAfterMs: -1 }, { retryAllowed: 'yes' },
    { outcomes: batch(recipients, 0).outcomes.map(outcome => ({ ...outcome, recipientEmail: 'foreign@example.test' })) },
    { outcomes: batch(recipients, 0).outcomes.map(outcome => ({ ...outcome, providerId: '' })) },
  ];
  for (const corruption of corruptions) {
    let acknowledged = 0;
    await assert.rejects(run({ offset: 0, recipients, requestBatch: async () => batch(recipients, 0, corruption),
      onBatch: () => { acknowledged++; }, wait: noWait }), /progress could not be confirmed/);
    assert.equal(acknowledged, 0, JSON.stringify(corruption));
  }
});

test('a changed campaign total after an acknowledged chunk pauses at the existing saved position', async () => {
  const recipients = addresses(201);
  let savedOffset = 0;
  await assert.rejects(run({ offset: 0, requestBatch: async offset => batch(recipients, offset, offset ? { total: 202 } : {}),
    onBatch: result => { savedOffset = result.nextOffset; }, wait: noWait }), /progress could not be confirmed/);
  assert.equal(savedOffset, 100);
});
