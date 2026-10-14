import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { harness, projectId, albumA, id } from './helpers/event-gallery-harness.mjs';

const require = createRequire(import.meta.url);
const historyRoute = 'app/api/portal/orders/history/route.ts';
const deliveryStubs = {
  '@/lib/resend': {},
  '@/lib/backdrop-composites': { hasBackdropCompositeSelection: () => false },
};
function paidOrder(packageName, productName = packageName) {
  return {
    id: id(990), project_id: projectId, photographer_id: null,
    parent_email: 'viewer@example.test', customer_email: 'viewer@example.test',
    status: 'paid', payment_status: 'paid', paid_at: '2026-10-01', package_name: packageName,
    cart_snapshot: [{ packageName, quantity: 1, selectedImageUrl: 'fixture/a.jpg',
      slots: [{ label: productName, assignedImageUrl: 'fixture/a.jpg' }],
      purchasedEventScope: { version: 1, projectId, collectionIds: [albumA] } }],
    order_items: [{ product_name: productName, quantity: 1, sku: 'fixture/a.jpg' }],
  };
}

for (const label of ['Profile portrait prints', 'Portfolio Print', 'Digitalis flower print', 'Downloaded receipt frame']) {
  test(`print-only ${label} cannot gain an original-file delivery or history download`, async () => {
    const h = harness({ overrides: deliveryStubs });
    h.tables.event_gallery_visitors = [{ project_id: projectId, viewer_email: 'viewer@example.test' }];
    const order = paidOrder(label, '8x10 Lustre');
    h.tables.orders.push(order);
    h.tables.order_items = order.order_items;
    await assert.rejects(h.load('lib/digital-delivery.ts').resolveDigitalDeliveryContext(h.service, order.id), /No online high-resolution files/);
    const history = await h.post(historyRoute, { projectId, email: 'viewer@example.test', pin: 'project-pin' });
    assert.equal(history.status, 200);
    assert.equal(history.body.orders[0].digitalDownload?.available ?? false, false);
    assert.equal(history.body.orders[0].digitalDownload?.url ?? null, null);
    assert.equal(h.fetched.length, 0);
    assert.equal(h.writes.length, 0);
  });
}

for (const label of ['Digital Image', 'Download photo', 'JPEG file', 'USB images', 'All Files']) {
  test(`paid ${label} keeps digital resolution and the matching history download`, async () => {
    const h = harness({ overrides: deliveryStubs });
    h.tables.event_gallery_visitors = [{ project_id: projectId, viewer_email: 'viewer@example.test' }];
    const order = paidOrder(label);
    h.tables.orders.push(order);
    h.tables.order_items = order.order_items;
    const context = await h.load('lib/digital-delivery.ts').resolveDigitalDeliveryContext(h.service, order.id);
    assert.equal(context.files.length, 1);
    assert.equal(context.files[0].key, 'fixture/a.jpg');
    const history = await h.post(historyRoute, { projectId, email: 'viewer@example.test', pin: 'project-pin' });
    assert.equal(history.status, 200);
    assert.equal(history.body.orders[0].digitalDownload.available, true);
    assert.equal(h.fetched.length, 0);
    assert.equal(h.writes.length, 0);
  });
}

function notificationFixture(productName, packageName = 'Portrait package') {
  const scheduled = [], emails = [], errors = [], writes = [];
  const order = { id: 'fixture-order', photographer_id: 'studio', package_name: packageName, status: 'payment_pending',
    payment_status: 'pending', paid_at: null, notes: '', customer_email: 'buyer@example.test', total_cents: 1200, currency: 'cad' };
  const item = { product_name: productName, quantity: 1, sku: 'fixture/a.jpg' };
  const photographer = { id: 'studio', business_name: 'Fixture studio', studio_email: 'studio@example.test' };
  const service = { from(table) {
    let update;
    const rows = () => table === 'orders' ? [order] : table === 'order_items' ? [item] : table === 'photographers' ? [photographer] : assert.fail(`Unexpected table ${table}`);
    const result = single => { if (update) { writes.push(structuredClone(update)); Object.assign(order, update); } return { data: single ? rows()[0] : rows(), error: null }; };
    const q = { select() { return q; }, eq() { return q; }, update(value) { update = value; return q; },
      maybeSingle() { return Promise.resolve(result(true)); }, then(resolve, reject) { return Promise.resolve(result(false)).then(resolve, reject); } };
    return q;
  } };
  const emailBody = { subject: 'fixture', html: 'fixture', text: 'fixture' };
  const modules = {
    // This fixture exercises the unchanged legacy payment notification path.
    '@/lib/studio-pricing': { isGalleryPricingV2Enabled: () => false },
    '@/lib/credit-maintenance': { creditMaintenanceActive: () => true },
    '@/lib/resend': { resendConfigured: () => true, resolveReplyTo: value => value, sendResendEmail: async value => emails.push(value) },
    '@/lib/order-notification-email': { buildOrderNotificationEmail: () => emailBody },
    '@/lib/order-receipt-email': { buildOrderReceiptEmail: () => emailBody },
    '@/lib/order-push': { sendNewOrderPush: async () => {} },
    '@/lib/digital-delivery': { sendDigitalDeliveryEmailForOrder: async () => assert.fail('Payment finalization must leave digital sending to the outbox worker') },
    '@/lib/paid-order-emails': { schedulePaidOrderEmails: async (queuedService, orderId) => {
      assert.equal(queuedService, service); assert.equal(orderId, order.id);
      assert.ok(order.paid_at && order.payment_status === 'paid', 'Scheduling follows the committed paid transition');
      scheduled.push(orderId);
    } },
  };
  function load(file) {
    const exports = {};
    const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'exports', 'console', 'fetch', code)(name => {
      if (name in modules) return modules[name];
      if (name === '@/lib/digital-product-label') return load('lib/digital-product-label.ts');
      return name.startsWith('@/') ? {} : require(name);
    }, exports, { error: (...args) => errors.push(args), log() {}, warn() {} }, () => assert.fail('No provider or real email calls'));
    return exports;
  }
  return { service, scheduled, order, item, emails, errors, writes, payments: load('lib/payments.ts') };
}

async function assertDeferredNotificationAndEligibility(f, expectedDigitalFiles) {
  assert.deepEqual(f.scheduled, ['fixture-order'], 'The exact paid order queues one durable notification dispatch');
  assert.equal(f.emails.length, 0, 'Payment completion does not synchronously send receipts or wait for the provider');
  assert.deepEqual(f.errors, []);
  // The SQL outbox/integration suites verify the two ordinary email jobs.
  // Here use the actual delivery resolver, not a mock label classifier, to
  // retain the purchased-original eligibility boundary after deferring sends.
  const h = harness({ overrides: deliveryStubs });
  const order = paidOrder(f.order.package_name, f.item.product_name);
  order.status = f.order.status;
  h.tables.orders.push(order);
  h.tables.order_items = order.order_items;
  const resolution = h.load('lib/digital-delivery.ts').resolveDigitalDeliveryContext(h.service, order.id);
  if (expectedDigitalFiles) {
    const context = await resolution;
    assert.deepEqual(Array.from(context.files, file => file.key), ['fixture/a.jpg']);
  } else await assert.rejects(resolution, /No online high-resolution files/);
  assert.equal(h.fetched.length, 0);
  assert.equal(h.writes.length, 0, 'Eligibility verification cannot change the paid order');
}

for (const [label, expected] of [['Profile portrait prints', 0], ['Digitalis flower print', 0], ['Digital portrait', 1], ['All Files', 1], ['8x10 + digital file', 1], ['Digital retouching service', 0]]) {
  test(`payment for ${label} defers notifications and preserves ${expected} digital original eligibility`, async () => {
    const f = notificationFixture(label);
    const result = await f.payments.finalizePaidOrder(f.service, { orderId: 'fixture-order', paymentStatus: 'paid', note: 'fixture verified payment' });
    assert.equal(result.status, 'paid');
    assert.equal(f.writes.length, 1);
    await assertDeferredNotificationAndEligibility(f, expected);
  });
}

test('a Digitalis print package cannot gain the digital_paid status that would bypass item eligibility', async () => {
  const f = notificationFixture('8x10 Lustre', 'Digitalis flower print');
  const result = await f.payments.finalizePaidOrder(f.service, { orderId: 'fixture-order', paymentStatus: 'paid', note: 'fixture verified payment' });
  assert.equal(result.status, 'paid');
  await assertDeferredNotificationAndEligibility(f, 0);
});

test('a genuine digital package keeps its paid status and deferred delivery when its component has a plain portrait label', async () => {
  const f = notificationFixture('Selected portrait', 'Digital portrait package');
  const result = await f.payments.finalizePaidOrder(f.service, { orderId: 'fixture-order', paymentStatus: 'paid', note: 'fixture verified payment' });
  assert.equal(result.status, 'digital_paid');
  await assertDeferredNotificationAndEligibility(f, 1);
});

test('a mixed paid package delivers its purchased digital component without granting the print original', async () => {
  const h = harness({ overrides: deliveryStubs });
  const order = paidOrder('Portrait package', '8x10 Lustre');
  order.cart_snapshot.push({ packageName: 'Digital image', quantity: 1, slots: [{ label: 'Digital image', assignedImageUrl: 'fixture/b.jpg' }] });
  h.tables.orders.push(order);
  h.tables.order_items = order.order_items;
  const context = await h.load('lib/digital-delivery.ts').resolveDigitalDeliveryContext(h.service, order.id);
  assert.deepEqual(Array.from(context.files, file => file.key), ['fixture/b.jpg']);
  assert.equal(h.fetched.length, 0);
  assert.equal(h.writes.length, 0);
});
