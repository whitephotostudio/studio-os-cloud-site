import * as stripeHistory from '../lib/stripe-connect-history.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const orderId = '11111111-1111-4111-8111-111111111111';
const photographerId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const siblingId = '44444444-4444-4444-8444-444444444444';
const schoolId = '55555555-5555-4555-8555-555555555555';
const studentId = '66666666-6666-4666-8666-666666666666';
const otherSchoolId = '77777777-7777-4777-8777-777777777777';
const otherStudentId = '88888888-8888-4888-8888-888888888888';
const sessionId = 'cs_test_opaque_fixture';

function load(path, dependencies = {}) {
  const output = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  const exports = {};
  new Function('require', 'exports', 'fetch', 'console', output)(name => {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, exports, () => assert.fail('Recovery fixtures must never contact a provider'), {error() {}});
  return exports;
}

function fixture(options = {}) {
  const sequence = [], reads = [], finalized = [];
  const base = {id: orderId, photographer_id: photographerId, order_group_id: options.combined ? groupId : null,
    school_id: schoolId, student_id: studentId, parent_email: 'saved@example.invalid', customer_email: 'buyer@example.invalid',
    total_cents: options.free ? 0 : 1000, currency: 'usd', status: options.alreadyPaid ? 'paid' : 'payment_pending',
    payment_status: options.alreadyPaid ? 'paid' : 'pending', paid_at: options.alreadyPaid ? '2026-10-08T12:00:00Z' : null,
    stripe_checkout_session_id: sessionId};
  if (options.event) Object.assign(base, {school_id: null, student_id: null});
  const orders = [base];
  if (options.combined) orders.push({...base, id: siblingId, school_id: otherSchoolId, student_id: otherStudentId});
  const tables = {
    orders, photographers: [{id: photographerId, stripe_connected_account_id: 'acct_owned'}],
    schools: [{id: schoolId, photographer_id: photographerId}, {id: otherSchoolId, photographer_id: photographerId}],
    students: [{id: studentId, school_id: schoolId, pin: '50123'}, {id: otherStudentId, school_id: otherSchoolId, pin: '60123'}],
  };
  const session = {id: sessionId, mode: 'payment', status: 'complete', payment_status: options.free ? 'no_payment_required' : 'paid',
    payment_intent: options.free ? null : 'pi_paid', amount_total: orders.reduce((sum, row) => sum + row.total_cents, 0), currency: 'usd',
    client_reference_id: orderId, customer_details: {email: 'stripe-billing@example.invalid'},
    metadata: {billing_flow: 'customer_order', photographer_id: photographerId, order_id: orderId,
      ...(options.combined ? {order_group_id: groupId} : {}),
      ...(options.captured ? {portal_return_order_id: options.combined ? siblingId : orderId, portal_return_email: 'Viewer+Child@Example.invalid'} : {})}};
  const service = {async rpc(name){assert.equal(name,'resolve_order_payment_account');return {data:null,error:{code:'PGRST202'}};},from(table) {
    assert.ok(table in tables);
    let predicate = () => true, maximum = Infinity;
    const chain = {
      select() {return chain;},
      eq(key, value) {const prior = predicate; predicate = row => prior(row) && row[key] === value; return chain;},
      in(key, values) {const prior = predicate; predicate = row => prior(row) && values.includes(row[key]); return chain;},
      limit(value) {maximum = value; return chain;},
      maybeSingle() {return run(true);},
      then(resolve, reject) {return run(false).then(resolve, reject);},
    };
    async function run(single) {
      const found = tables[table].filter(predicate);
      reads.push(table);
      return {data: structuredClone(single ? found[0] ?? null : found.slice(0, maximum)), error: null,
        count: options.incompleteGroup && table === 'orders' && !single ? found.length + 1 : found.length};
    }
    return chain;
  }};
  const helper = load('lib/school-parent-gallery-link.ts');
  const route = load('app/api/stripe/checkout/confirm/route.ts', {
    '@/lib/stripe-connect-history':stripeHistory,
    'next/server': {NextResponse: {json: (body, init) => Response.json(body, init)}},
    '@/lib/dashboard-auth': {createDashboardServiceClient: () => service},
    '@/lib/parent-gallery-session-request':{getParentGalleryRequestScope:()=>options.mappedScope??null,runParentGallerySessionRoute:()=>assert.fail('Direct confirm fixture never adapts')},
    '@/lib/parent-gallery-session':{ParentGallerySessionError:class extends Error{}},
    '@/lib/parent-checkout-return':{parentCheckoutPrivateHeaders:{'Cache-Control':'private, no-store'},
      ParentCheckoutReturnError:class extends Error{constructor(status){super('Reopen gallery');this.status=status;}},
      hasMappedParentCheckout:async()=>!!options.mapped,
      resolveParentCheckoutReturn:async(_request,returnId,laneId)=>{assert.equal(returnId,options.returnId);assert.equal(laneId,options.mappedScope.laneId);return{returnId,laneId,status:'success',sessionId};}},
    '@/lib/school-parent-gallery-link': helper,
    '@/lib/payments': {
      getConnectedAccountId: profile => profile.stripe_connected_account_id,
      retrieveCheckoutSession: async (id, account) => {
        assert.equal(id, sessionId); assert.equal(account, 'acct_owned'); sequence.push('stripe-get');
        if (options.providerError) throw new Error('Stripe unavailable');
        return structuredClone(session);
      },
      finalizePaidOrderOrGroup: async (_service, args) => {sequence.push('finalize'); finalized.push(args);},
    },
  });
  return {session, tables, sequence, reads, finalized,
    invoke: body => route.POST(new Request('https://fixture.test/api/stripe/checkout/confirm',{method:'POST',headers:{origin:'https://fixture.test','content-type':'application/json'},body:JSON.stringify(body??{sessionId})}))};
}

function gallery(body) {assert.ok(body.galleryUrl); return new URL(body.galleryUrl, 'https://www.studiooscloud.com');}

test('verified paid session restores complete context in a fresh browser without request email', async () => {
  const f = fixture(), response = await f.invoke(), body = await response.json();
  assert.equal(response.status, 200); const url = gallery(body);
  assert.equal(url.pathname, '/parents/50123'); assert.equal(url.searchParams.get('school'), schoolId);
  assert.equal(url.searchParams.get('email'), 'buyer@example.invalid'); assert.equal(url.searchParams.get('mode'), 'school');
  assert.equal(url.searchParams.get('checkout'), 'success'); assert.equal(url.searchParams.get('session_id'), sessionId);
  assert.deepEqual(f.sequence, ['stripe-get', 'finalize']);
  assert.ok(body.galleryUrl.startsWith('/parents/'), 'recovery is an internal relative link');
});

test('already-paid session is read from its connected account before revealing gallery context', async () => {
  const f = fixture({alreadyPaid: true}), response = await f.invoke();
  assert.equal(response.status, 200); gallery(await response.json());
  assert.deepEqual(f.sequence, ['stripe-get', 'finalize']); assert.match(f.finalized[0].note, /already marked paid/);
});

test('orderId-only confirmation never returns a PIN, email or gallery URL', async () => {
  for (const alreadyPaid of [false, true]) {
    const f = fixture({alreadyPaid}), response = await f.invoke({orderId});
    assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.galleryUrl, undefined); assert.equal(body.customerEmail, undefined);
    assert.doesNotMatch(JSON.stringify(body), /50123|buyer@|stripe-billing@|saved@/);
    assert.equal(f.reads.includes('students'), false); assert.equal(f.finalized.length, 1);
    if (alreadyPaid) assert.deepEqual(f.sequence, ['finalize']);
  }
});

test('combined recovery retains captured viewer/lane rather than charge anchor or Stripe billing email', async () => {
  const f = fixture({combined: true, captured: true}), response = await f.invoke();
  assert.equal(response.status, 200); const url = gallery(await response.json());
  assert.equal(url.pathname, '/parents/60123'); assert.equal(url.searchParams.get('school'), otherSchoolId);
  assert.equal(url.searchParams.get('email'), 'viewer+child@example.invalid');
});

test('legacy combined session without return metadata uses the authoritative checkout anchor consistently', async () => {
  const f = fixture({combined: true}), response = await f.invoke();
  assert.equal(response.status, 200); const url = gallery(await response.json());
  assert.equal(url.pathname, '/parents/50123'); assert.equal(url.searchParams.get('school'), schoolId);
  assert.equal(url.searchParams.get('email'), 'buyer@example.invalid');
});

test('current verified student PIN is used if it changed since the session was created', async () => {
  const f = fixture({captured: true}); f.tables.students[0].pin = '50234';
  const response = await f.invoke(); assert.equal(response.status, 200);
  assert.equal(gallery(await response.json()).pathname, '/parents/50234');
});

test('no-payment-required session remains valid for an exact zero-total order', async () => {
  const f = fixture({free: true}), response = await f.invoke();
  assert.equal(response.status, 200); const body = await response.json(); gallery(body);
  assert.equal(body.paymentStatus, 'no_payment_required'); assert.equal(f.finalized.length, 1);
});

test('legacy saved amounts must be present and finite, including free orders', async () => {
  for (const free of [false, true]) {
    const valid = fixture({free}); valid.tables.orders[0].total_cents = null;
    valid.tables.orders[0].total_amount = free ? 0 : 10;
    const response = await valid.invoke(); assert.equal(response.status, 200); gallery(await response.json());
  }
  for (const total_amount of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -0.001]) {
    const f = fixture({free: true}); f.tables.orders[0].total_cents = null; f.tables.orders[0].total_amount = total_amount;
    const response = await f.invoke(); assert.equal(response.status, 500);
    assert.equal((await response.json()).galleryUrl, undefined); assert.equal(f.finalized.length, 0);
  }
  const nonzero = fixture(); nonzero.session.payment_status = 'no_payment_required';
  const response = await nonzero.invoke(); assert.equal(response.status, 500); assert.equal(nonzero.finalized.length, 0);
});

test('event confirmation retains its existing result without exposing school credentials', async () => {
  const f = fixture({event: true}), response = await f.invoke();
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.galleryUrl, undefined); assert.equal(body.customerEmail, 'stripe-billing@example.invalid');
  assert.equal(f.reads.includes('students'), false); assert.equal(f.finalized.length, 1);
});

test('legacy event confirmations do not inherit new school metadata or amount requirements', async () => {
  const f = fixture({event: true}); f.session.metadata = {}; f.session.amount_total = null; f.session.currency = null;
  const response = await f.invoke(); assert.equal(response.status, 200);
  assert.equal((await response.json()).galleryUrl, undefined); assert.equal(f.finalized.length, 1);
  const paid = fixture({event: true, alreadyPaid: true, providerError: true});
  const paidResponse = await paid.invoke(); assert.equal(paidResponse.status, 200);
  assert.equal((await paidResponse.json()).galleryUrl, undefined); assert.deepEqual(paid.sequence, ['finalize']);
});

test('unknown or mismatched opaque session cannot recover by adding an orderId', async () => {
  const f = fixture(), response = await f.invoke({sessionId: 'cs_not_saved', orderId});
  assert.equal(response.status, 404); assert.equal(f.sequence.length, 0);
  assert.equal((await response.json()).galleryUrl, undefined);
});

test('incorrect Stripe session identity, amount, currency, ownership or metadata fails before finalization/access', async () => {
  for (const alter of [
    f => f.session.id = 'cs_other', f => f.session.amount_total++, f => f.session.currency = 'cad',
    f => f.session.metadata.photographer_id = 'another-studio', f => f.session.metadata.order_id = siblingId,
    f => f.session.client_reference_id = siblingId, f => f.session.metadata.billing_flow = 'booking',
    f => f.session.metadata.order_group_id = groupId, f => f.session.mode = 'subscription',
    f => f.session.status = 'open', f => f.session.metadata.portal_return_order_id = siblingId,
    f => f.session.metadata.portal_return_email = 'not-an-email',
  ]) {
    const f = fixture({alreadyPaid: true}); alter(f); const response = await f.invoke();
    assert.equal(response.status, 500); assert.equal((await response.json()).galleryUrl, undefined);
    assert.equal(f.finalized.length, 0);
  }
});

test('unpaid sessions and provider failures reveal no gallery context for already-paid database rows', async () => {
  for (const providerError of [false, true]) {
    const f = fixture({alreadyPaid: true, providerError}); f.session.payment_status = 'unpaid';
    const response = await f.invoke(); assert.equal(response.status, providerError ? 500 : 400);
    assert.equal((await response.json()).galleryUrl, undefined); assert.equal(f.finalized.length, 0);
  }
});

test('foreign group member, incomplete group, moved student and school-owner mismatch block recovery', async () => {
  for (const alter of [
    f => f.tables.orders[1].photographer_id = 'another-studio',
    f => f.tables.orders[1].stripe_checkout_session_id = 'cs_another',
    f => f.tables.students[1].school_id = schoolId,
    f => f.tables.schools[1].photographer_id = 'another-studio',
  ]) {
    const f = fixture({combined: true, captured: true}); alter(f); const response = await f.invoke();
    assert.equal(response.status, 500); assert.equal((await response.json()).galleryUrl, undefined);
    assert.equal(f.finalized.length, 0);
  }
  const f = fixture({combined: true, incompleteGroup: true}), response = await f.invoke();
  assert.equal(response.status, 500); assert.equal(f.finalized.length, 0);
});


test('new mapped checkout denies sessionId/orderId-only confirmation before provider or finalization',async()=>{
  for(const body of [{sessionId},{orderId}]){const f=fixture({mapped:true}),response=await f.invoke(body);assert.equal(response.status,403);assert.equal(f.sequence.length,0);assert.equal(f.finalized.length,0);assert.equal((await response.json()).galleryUrl,undefined);}
});
test('new mapped checkout returns a clean lane URL and never derives school PIN or viewer email',async()=>{
  const laneId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',returnId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const f=fixture({mapped:true,mappedScope:{laneId},returnId}),response=await f.invoke({sessionId,returnId});assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.galleryUrl,`/parents/view/${laneId}?checkout=success&return=${returnId}`);assert.equal(body.customerEmail,undefined);
  assert.ok(!JSON.stringify(body).includes('50123'));assert.equal(f.reads.includes('students'),false);assert.equal(f.finalized.length,1);
});
