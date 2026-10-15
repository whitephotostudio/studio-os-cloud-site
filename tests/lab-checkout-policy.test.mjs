import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, id } from './helpers/event-gallery-harness.mjs';

const owner = id(900), school = id(901), student = id(902), packageId = id(903);

function fixture(marker = { labId: id(904), catalogProductId: id(905), sku: 'LOCAL-TEST' }) {
  const h = harness();
  h.tables.photographers.push({ id: owner, subscription_status: 'active', billing_currency: 'CAD' });
  h.tables.schools.push({ id: school, school_name: 'Local fixture school', photographer_id: owner, status: 'active', portal_status: 'active', gallery_settings: null });
  h.tables.students.push({ id: student, school_id: school, first_name: 'Example', last_name: 'Student', pin: '12345', photo_url: null });
  h.tables.packages.push({ id: packageId, photographer_id: owner, name: 'Lab print', category: 'print', price_cents: 1000, active: true, items: [{ name: '5x7', size: '5x7', qty: 1, lab: marker }] });
  return h;
}
const entry = { packageId, quantity: 1, slots: [] };
const parent = { name: 'Fixture parent', email: 'parent@example.test' };

test('single and sibling order handlers reject server-owned lab markers before writing any order', async () => {
  for (const route of ['app/api/portal/orders/create/route.ts', 'app/api/portal/orders/create-combined/route.ts']) {
    for (const marker of [{ labId: id(904) }, null, {}, 'invalid-marker']) {
      const h = fixture(marker);
      const body = route.includes('create-combined')
        ? { groups: [{ schoolId: school, pin: '12345', email: parent.email, entries: [entry] }], parent, delivery: { method: 'pickup' } }
        : { mode: 'school', schoolId: school, pin: '12345', entries: [entry], parent, delivery: { method: 'pickup' } };
      const result = await h.post(route, body);
      assert.equal(result.status, 409, JSON.stringify(result));
      assert.match(result.body.message, /lab price sheet is being prepared/);
      assert.equal(h.writes.length, 0);
    }
  }
});

test('guard leaves older ordinary print, digital and class-composite products eligible', () => {
  const h = harness(), { labCheckoutIssue } = h.load('lib/lab-checkout-policy.ts');
  assert.equal(labCheckoutIssue([{ items: ['5x7', { name: 'Digital', type: 'digital' }, { name: 'Class Photo', composite: true }] }]), null);
  assert.equal(labCheckoutIssue([{ items: null }, {}]), null);
  assert.equal(typeof labCheckoutIssue([{ items: [{ name: 'Print' }, { lab: null }] }]), 'string');
});
