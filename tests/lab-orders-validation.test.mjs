import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { z } from 'zod';
function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => { if (!(name in dependencies)) throw Error(`Missing dependency ${name}`); return dependencies[name]; }, exports);
  return exports;
}
class LabError extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
const validation = load('lib/labs/orders-validation.ts', { zod: { z }, './validation': { LabError } });
const mapping = load('lib/labs/orders-types.ts');
const id = value => `60000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const submit = () => ({ action: 'submit', requestId: id(1), labId: id(2), reference: 'Studio job 101', notes: '', delivery: { mode: 'pickup', name: 'Example studio', address: '' }, items: [{ catalogProductId: id(3), assetId: id(4), quantity: 2 }] });
const transition = overrides => ({ action: 'transition', requestId: id(5), orderId: id(6), expectedVersion: 1, status: 'accepted', reason: '', carrier: '', trackingNumber: '', ...overrides });

test('order requests accept selections only, reject client prices/owners/snapshots and preserve explicit quantity semantics', () => {
  assert.equal(validation.parseLabOrderAction(submit()).items[0].quantity, 2);
  for (const extra of [{ photographerId: id(9) }, { totalMinor: 1 }, { snapshot: {} }, { status: 'accepted' }]) assert.throws(() => validation.parseLabOrderAction({ ...submit(), ...extra }));
  for (const extra of [{ unitCostMinor: 1 }, { sku: 'SPOOF' }, { storageKey: 'foreign.jpg' }]) assert.throws(() => validation.parseLabOrderAction({ ...submit(), items: [{ ...submit().items[0], ...extra }] }));
  for (const quantity of [0, -1, 1.5, 101]) assert.throws(() => validation.parseLabOrderAction({ ...submit(), items: [{ ...submit().items[0], quantity }] }));
  assert.throws(() => validation.parseLabOrderAction({ ...submit(), items: [submit().items[0], submit().items[0]] }), error => error.code === 'LAB_ORDER_DUPLICATE_LINE');
  assert.throws(() => validation.parseLabOrderAction({ ...submit(), items: Array.from({ length: 51 }, (_, index) => ({ ...submit().items[0], assetId: id(index + 100) })) }));
  assert.throws(() => validation.parseLabOrderAction({ ...submit(), delivery: { mode: 'ship_to_studio', name: 'Studio', address: ' ' } }), error => error.code === 'LAB_ORDER_ADDRESS_REQUIRED');
  assert.throws(() => validation.parseLabOrderAction({ ...submit(), reference: 'Job\nHeader' }));
});

test('declining and shipping require durable reasons and tracking values', () => {
  assert.throws(() => validation.parseLabOrderAction(transition({ status: 'declined' })), error => error.code === 'LAB_ORDER_REASON_REQUIRED');
  assert.throws(() => validation.parseLabOrderAction(transition({ status: 'shipped', carrier: 'Carrier' })), error => error.code === 'LAB_ORDER_TRACKING_REQUIRED');
  assert.equal(validation.parseLabOrderAction(transition({ status: 'shipped', carrier: 'Carrier', trackingNumber: 'TRACK-101' })).trackingNumber, 'TRACK-101');
});

test('aspect checks allow normalized portrait/landscape swaps and the exact two-percent boundary, never arbitrary crops', () => {
  for (const [width, height] of [[600, 400], [400, 600]]) assert.equal(validation.labOrderAspectMatches(width, height, 6, 4), true);
  assert.equal(validation.labOrderAspectMatches(1020, 1000, 1, 1), true);
  assert.equal(validation.labOrderAspectMatches(1021, 1000, 1, 1), false);
  assert.equal(validation.labOrderAspectMatches(400, 400, 6, 4), false);
  assert.equal(validation.labOrderAspectMatches(0, 400, 6, 4), false);
});

test('client affordances follow role and shipping/pickup branches, including immutable terminal states', () => {
  const next = validation.allowedLabOrderTransitions;
  assert.deepEqual(next('submitted', 'pickup', 'studio'), ['cancelled']);
  assert.deepEqual(next('accepted', 'pickup', 'studio'), []);
  assert.deepEqual(next('submitted', 'pickup', 'viewer'), []);
  assert.deepEqual(next('submitted', 'pickup', 'operator'), ['accepted', 'declined']);
  assert.deepEqual(next('accepted', 'pickup', 'owner'), ['in_production']);
  assert.deepEqual(next('in_production', 'pickup', 'owner'), ['ready']);
  assert.deepEqual(next('ready', 'pickup', 'owner'), ['completed']);
  assert.deepEqual(next('ready', 'ship_to_studio', 'operator'), ['shipped']);
  assert.deepEqual(next('shipped', 'ship_to_studio', 'operator'), ['completed']);
  for (const status of ['declined', 'cancelled', 'completed']) assert.deepEqual(next(status, 'pickup', 'owner'), []);
});

test('order mapping embeds the frozen snapshot and chronological persisted events', () => {
  const snapshot = { reference: 'Job 101', items: [] };
  const result = mapping.orderFromRow({ id: id(1), photographer_id: id(2), lab_id: id(3), status: 'accepted', version: 2, currency: 'JPY', total_minor: 2500, snapshot, created_at: 'created', updated_at: 'updated' },
    [{ id: id(5), order_id: id(1), actor_user_id: id(7), request_id: id(8), from_status: 'submitted', to_status: 'accepted', version: 2, created_at: 'later' }, { id: id(4), order_id: id(1), actor_user_id: id(6), request_id: id(9), from_status: null, to_status: 'submitted', version: 1, created_at: 'earlier' }]);
  assert.equal(result.totalMinor, 2500);
  assert.equal(result.snapshot, snapshot);
  assert.equal(result.events[0].version, 1);
  assert.equal(result.events[0].fromStatus, null);
  assert.equal(result.events[1].toStatus, 'accepted');
});
