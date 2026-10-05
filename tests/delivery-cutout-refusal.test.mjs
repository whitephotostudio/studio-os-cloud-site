import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(path, modules = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'process', code)(name => name in modules ? modules[name] : name.startsWith('@/') ? assert.fail(`Missing fixture: ${name}`) : require(name), exports,
    { env: { DIGITAL_DELIVERY_TOKEN_SECRET: 'isolated-delivery-secret', NEXT_PUBLIC_SITE_URL: 'https://example.invalid' } });
  return exports;
}
const display = load('lib/order-display.ts');
class FixtureResponse extends Response {
  static json(body, init) { return Response.json(body, init); }
}
function fixture({ composite = null, selected = true, throwComposite = false } = {}) {
  const studio = randomUUID(), photographer = randomUUID(), orderId = randomUUID();
  const key = `projects/${randomUUID()}/albums/main/portrait.jpg`;
  const backdrop = { name: 'Blue', image_url: `backdrops/${photographer}/blue.jpg` };
  const item = { product_name: 'Digital photo', quantity: 1, sku: key, ...(selected ? { backdrop } : {}) };
  const order = { id: orderId, photographer_id: photographer, status: 'digital_paid', payment_status: 'paid', paid_at: new Date().toISOString(),
    parent_email: 'fixture@example.invalid', package_name: 'Digital photo', notes: '', created_at: new Date().toISOString(),
    cart_snapshot: [{ selectedImageUrl: key, packageName: 'Digital photo', quantity: 1, ...(selected ? { backdrop } : {}) }], items: [item] };
  const calls = [];
  const service = { from(table) {
    let update = null;
    const rows = () => table === 'orders' ? [order] : table === 'photographers' ? [{ id: photographer, business_name: 'Fixture Studio' }]
      : table === 'order_items' ? [item] : assert.fail(`Unexpected table: ${table}`);
    const execute = single => { if (update) calls.push({ update: table, value: update }); return { data: single ? rows()[0] : rows(), error: null }; };
    const chain = { select() { return chain; }, eq() { return chain; }, in() { return chain; }, update(value) { update = value; return chain; },
      maybeSingle: async () => execute(true), then: resolve => resolve(execute(false)) };
    return chain;
  } };
  const compositeModule = {
    composeBackdropImage: async args => { calls.push({ composite: args }); if (throwComposite) throw new Error('Temporary verification failure'); return composite; },
    hasBackdropCompositeSelection: value => Boolean(value?.image_url), backdropCompositeFileName: () => 'portrait_Blue_backdrop.jpg',
  };
  const modules = {
    'next/server': { NextResponse: FixtureResponse }, '@/lib/order-display': display,
    '@/lib/digital-entitlement-payment': load('lib/digital-entitlement-payment.ts'),
    '@/lib/backdrop-composites': compositeModule,
    '@/lib/dashboard-auth': { resolveDashboardAuth: async () => ({ user: { id: studio }, mfaSatisfied: true }), createDashboardServiceClient: () => service },
    '@/lib/event-gallery-downloads': { buildArchiveBaseName: (value, fallback) => value || fallback },
    '@/lib/storage-folder': { buildSchoolCandidateFolders: () => [], loadFolderMediaRows: async () => [] },
    '@/lib/r2-signed-urls': { r2KeyFromAnyUrl: value => value || '', r2PresignedGetUrl: value => { calls.push({ signed: value }); return `https://fixture.invalid/${value}`; } },
    '@/lib/private-media-references': { privateMediaKeyFromReference: value => value?.startsWith('projects/') ? value : '',
      signedPrivateMediaReference: value => { calls.push({ signed: value }); return `https://fixture.invalid/${value}`; } },
    '@/lib/resend': { resendConfigured: () => true, resolveReplyTo: value => value || '', sendResendEmail: async value => calls.push({ email: value }) },
    '@/lib/zip': load('lib/zip.ts'),
  };
  const digital = load('lib/digital-delivery.ts', modules);
  const admin = load('app/api/dashboard/orders/download/route.ts', modules);
  const portal = load('app/api/portal/digital-delivery/route.ts', { ...modules, '@/lib/digital-delivery': digital });
  const files = [{ key, fileName: selected ? 'portrait_Blue_backdrop.jpg' : 'portrait.jpg', ...(selected ? { composite: {
    originalUrlOrKey: key, photographerId: photographer, backdrop, orientation: 'portrait' } } : {}) }];
  return { digital, admin, portal, service, studio, photographer, orderId, order, files, calls };
}

test('selected backdrop missing proof refuses digital ZIP instead of original fallback or a partial archive', async () => {
  const f = fixture();
  await assert.rejects(async () => { for await (const entry of f.digital.buildDigitalDeliveryZipEntries(f.files)) assert.fail(`Unexpected delivery: ${entry.name}`); }, f.digital.DigitalDeliveryReviewError);
  assert.equal(f.calls.some(call => call.signed), false);
  await assert.rejects(f.digital.assertDigitalDeliveryReady(f.files), f.digital.DigitalDeliveryReviewError);
});
test('selected backdrop refusal sends no ready email or success note and leaves paid order available for retry', async () => {
  const f = fixture();
  await assert.rejects(f.digital.sendDigitalDeliveryEmailForOrder(f.service, f.orderId, { force: true }), f.digital.DigitalDeliveryReviewError);
  assert.equal(f.calls.some(call => call.email || call.update || call.signed), false);
  assert.equal(f.order.status, 'digital_paid'); assert.equal(f.order.notes, '');
});
test('portal preflights selected backdrops and returns review409 before sending any ZIP bytes', async () => {
  const f = fixture();
  const token = f.digital.createDigitalDeliveryToken({ v: 1, kind: 'digital-order-delivery', orderId: f.orderId,
    recipientEmail: 'fixture@example.invalid', exp: Date.now() + 60000 });
  const response = await f.portal.GET({ nextUrl: new URL(`https://example.invalid/download?token=${token}`) });
  assert.equal(response.status, 409); assert.match((await response.json()).message, /verified paid cutout/);
  assert.equal(f.calls.some(call => call.signed), false);
});
test('admin backdrop download refuses missing or failed verification without original fetch or misleading summary', async () => {
  for (const options of [{}, { throwComposite: true }]) {
    const f = fixture(options);
    const response = await f.admin.GET({ nextUrl: new URL(`https://example.invalid/download?ids=${f.orderId}`) });
    assert.equal(response.status, 409);
    assert.match((await response.json()).message, /verified|review/);
    assert.equal(f.calls.some(call => call.signed), false);
  }
});
test('verified selected backdrop downloads the composite and only then labels it print-ready', async () => {
  const rendered = Buffer.from('isolated rendered composite JPEG bytes');
  const f = fixture({ composite: { buffer: rendered, contentType: 'image/jpeg', extension: '.jpg' } });
  const response = await f.admin.GET({ nextUrl: new URL(`https://example.invalid/download?ids=${f.orderId}`) });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/zip');
  const zip = Buffer.from(await response.arrayBuffer());
  assert.ok(zip.includes(rendered)); assert.ok(zip.includes(Buffer.from('Backdrop applied')));
  assert.ok(zip.includes(Buffer.from('print-ready'))); assert.equal(f.calls.some(call => call.signed), false);
  let delivered;
  for await (const entry of f.digital.buildDigitalDeliveryZipEntries(f.files)) delivered = Buffer.from(await new Response(entry.stream).arrayBuffer());
  assert.deepEqual(delivered, rendered);
  await f.digital.sendDigitalDeliveryEmailForOrder(f.service, f.orderId, { force: true });
  assert.equal(f.calls.filter(call => call.email).length, 1);
  assert.equal(f.calls.filter(call => call.update).length, 1);
});
test('ordinary digital photo delivery preserves the original path when no backdrop was selected', async () => {
  const f = fixture({ selected: false });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('isolated original photo');
  try {
    const entries = [];
    for await (const entry of f.digital.buildDigitalDeliveryZipEntries(f.files)) entries.push(entry);
    assert.equal(entries.length, 1); assert.equal(entries[0].name, 'portrait.jpg');
    assert.equal(await new Response(entries[0].stream).text(), 'isolated original photo');
    assert.equal(f.calls.some(call => call.composite), false);
    assert.equal(f.calls.some(call => call.signed), true);
  } finally { globalThis.fetch = previousFetch; }
});

test('digital payload preparation keeps the current paid authorization and token without sending or writing notes', async () => {
  const f = fixture({ selected: false });
  const prepared = await f.digital.buildDigitalDeliveryEmailForOrder(f.service, f.orderId);
  assert.equal(prepared.skipped, false); assert.equal(prepared.fileCount, 1);
  assert.equal(prepared.payload.to, 'fixture@example.invalid');
  assert.equal(prepared.payload.idempotencyKey, `digital-delivery-${f.orderId}-fixture@example.invalid`);
  const link = prepared.payload.text.match(/^Download: (.+)$/m)[1];
  const token = new URL(link).searchParams.get('token');
  const decoded = f.digital.verifyDigitalDeliveryToken(token);
  assert.equal(decoded.orderId, f.orderId); assert.equal(decoded.recipientEmail, 'fixture@example.invalid');
  assert.equal(f.calls.some(call => call.email || call.update), false);
  f.order.payment_status = 'refunded';
  await assert.rejects(f.digital.buildDigitalDeliveryEmailForOrder(f.service, f.orderId), /not paid/);
  assert.equal(f.calls.some(call => call.email || call.update), false);
});

test('digital preparation respects the existing sent marker and does not mint a replacement provider payload', async () => {
  const f = fixture({ selected: false }); f.order.notes = 'Digital delivery link emailed by prior worker.';
  const prepared = await f.digital.buildDigitalDeliveryEmailForOrder(f.service, f.orderId);
  assert.equal(prepared.skipped, true); assert.equal(prepared.reason, 'already_sent');
  assert.equal('payload' in prepared, false);
  const manual = await f.digital.sendDigitalDeliveryEmailForOrder(f.service, f.orderId);
  assert.equal(manual.skipped, true); assert.equal(f.calls.some(call => call.email || call.update), false);
});
