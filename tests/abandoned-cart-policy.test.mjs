import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../lib/abandoned-cart-reminders.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const policy = {};
new Function('require', 'exports', compiled)(() => ({}), policy);

const draft = (id, overrides = {}) => ({
  id, photographer_id: 'studio', project_id: null, school_id: 'school', student_id: 'child',
  customer_email: 'Buyer@Example.com', parent_email: 'old-contact@example.com',
  status: 'payment_pending', payment_status: 'pending', paid_at: null,
  stripe_payment_intent_id: null, stripe_checkout_session_id: 'cs_unpaid',
  created_at: '2026-10-01T12:00:00Z', ...overrides,
});
const paid = (id, overrides = {}) => draft(id, {
  created_at: '2026-10-02T12:00:00Z', paid_at: '2026-10-03T12:00:00Z',
  status: 'paid', payment_status: 'succeeded', stripe_payment_intent_id: 'pi_verified', ...overrides,
});

test('newer verified purchase suppresses old attempts even when packages and poses changed', () => {
  assert.deepEqual(policy.freshestCartReminderDrafts([draft('old-package'), draft('old-pose'), paid('new-purchase')]), []);
});
test('a new draft after the purchased checkout stays eligible despite delayed paid confirmation', () => {
  const after = draft('new-cart', { created_at: '2026-10-02T13:00:00Z' });
  assert.deepEqual(policy.freshestCartReminderDrafts([draft('old'), paid('purchase'), after]).map(o => o.id), ['new-cart']);
});
test('other children, galleries, photographers and purchase emails remain independent', () => {
  for (const changed of [{ student_id: 'other-child' }, { school_id: 'other-school' }, { photographer_id: 'other-studio' }, { customer_email: 'other@example.com' }]) {
    assert.deepEqual(policy.freshestCartReminderDrafts([draft('old'), paid('other-purchase', changed)]).map(o => o.id), ['old']);
  }
  const event = draft('event', { school_id: null, student_id: null, project_id: 'event-gallery' });
  assert.equal(policy.freshestCartReminderDrafts([event, paid('purchase', { school_id: null, student_id: null, project_id: 'another-event' })]).length, 1);
});
test('actual purchase email is trimmed and normalized without mixing the old parent email', () => {
  assert.deepEqual(policy.freshestCartReminderDrafts([draft('old'), paid('purchase', { customer_email: '  buyer@example.COM  ' })]), []);
  assert.equal(policy.cartReminderRecipient(draft('x', { customer_email: 'invalid-address' })), null);
  assert.equal(policy.cartReminderRecipient(draft('x', { customer_email: '  ' })), 'old-contact@example.com');
});
test('paid status labels and incomplete payment evidence do not suppress another draft', () => {
  for (const changed of [{ paid_at: null }, { payment_status: 'pending' }, { stripe_payment_intent_id: null, stripe_checkout_session_id: null }, { is_test: true }]) {
    assert.deepEqual(policy.freshestCartReminderDrafts([draft('old'), paid('not-verified', changed)]).map(o => o.id), ['old']);
  }
});
test('own paid proof, inconsistent payment state and closed statuses stop reminders', () => {
  for (const changed of [{ paid_at: '2026-10-02T12:00:00Z' }, { stripe_payment_intent_id: 'pi_possible_payment' }, { payment_status: 'succeeded' }, { status: 'cancelled' }, { status: 'refunded' }, { status: 'printed' }, { refund_status: 'pending' }, { refund_amount_cents: 1 }, { is_test: true }]) {
    assert.equal(policy.isUnpaidReminderDraft(draft('x', changed)), false);
  }
});
test('freshest redundant draft wins once per scope and sorting is stable for tied timestamps', () => {
  const list = [draft('a'), draft('b'), draft('c', { created_at: '2026-10-01T14:00:00Z' })];
  assert.deepEqual(policy.freshestCartReminderDrafts(list).map(o => o.id), ['c']);
  assert.deepEqual(policy.freshestCartReminderDrafts(list.reverse()).map(o => o.id), ['c']);
  assert.deepEqual(policy.freshestCartReminderDrafts([draft('a'), draft('b')]).map(o => o.id), ['b']);
});
test('missing child, ambiguous gallery, invalid date and invalid buyer fail closed', () => {
  for (const changed of [{ student_id: null }, { project_id: 'event' }, { school_id: null }, { created_at: 'invalid' }, { customer_email: 'invalid' }]) {
    assert.equal(policy.isUnpaidReminderDraft(draft('x', changed)), false);
  }
});
test('only two spaced reminders are due at 24 and 72 hours', () => {
  const createdAt = '2026-10-01T12:00:00Z';
  const at = hours => Date.parse(createdAt) + hours * 3_600_000;
  assert.equal(policy.cartReminderStageDue({ createdAt, now: at(23.9), sentCount: 0 }), null);
  assert.equal(policy.cartReminderStageDue({ createdAt, now: at(24), sentCount: 0 }), 1);
  assert.equal(policy.cartReminderStageDue({ createdAt, now: at(71.9), sentCount: 1, previousSentAt: new Date(at(24)).toISOString() }), null);
  assert.equal(policy.cartReminderStageDue({ createdAt, now: at(72), sentCount: 1, previousSentAt: new Date(at(24)).toISOString() }), 2);
  assert.equal(policy.cartReminderStageDue({ createdAt, now: at(80), sentCount: 1, previousSentAt: new Date(at(40)).toISOString() }), null);
  assert.equal(policy.cartReminderStageDue({ createdAt, now: at(200), sentCount: 2, previousSentAt: new Date(at(72)).toISOString() }), null);
  assert.equal(policy.cartReminderStageDue({ createdAt, now: at(200), sentCount: 0, blocked: true }), null);
});
