import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const primaryId = '11111111-1111-4111-8111-111111111111';
const photographerId = '22222222-2222-4222-8222-222222222222';
const groupId = '33333333-3333-4333-8333-333333333333';
const siblingId = '44444444-4444-4444-8444-444444444444';
const schoolId = '55555555-5555-4555-8555-555555555555';
const studentId = '66666666-6666-4666-8666-666666666666';
const otherSchoolId = '77777777-7777-4777-8777-777777777777';
const otherStudentId = '88888888-8888-4888-8888-888888888888';
const projectId = '99999999-9999-4999-8999-999999999999';
const eventLaneId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const laneId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', returnId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', cookieHash = 'a'.repeat(64);

/** The actual POST handler, quote, snapshot payload and Stripe form builder run against isolated dependencies. */
function fixture(options = {}) {
  const sequence = [], quoteInputs = [], freezeCalls = [], checkoutInputs = [], stripeRequests = [];
  let locked = false;
  const row = {id: primaryId, order_group_id: options.combined ? groupId : null, photographer_id: photographerId,
    school_id: schoolId, project_id: null, student_id: studentId, parent_email: 'buyer@example.invalid', customer_email: null,
    package_id: null, package_name: '8x10 print', cart_snapshot: [], subtotal_cents: 1000, tax_cents: 0,
    total_cents: 1000, total_amount: 10, currency: options.currency ?? 'cad', status: 'payment_pending', payment_status: 'pending',
    stripe_checkout_session_id: options.legacySession ? 'cs_legacy' : null, stripe_payment_intent_id: null,
    paid_at: null, is_test: false, counted_for_monthly_usage: false, platform_fee_collection_method: null,
    platform_fee_amount_cents: null, platform_fee_currency: null, platform_fee_rate_cents: null};
  const rows = [row];
  if (options.combined) rows.push({...row, id: siblingId, ...(options.crossSchool ? {school_id: otherSchoolId, student_id: otherStudentId} : {})});
  if (options.event) Object.assign(row, {school_id: null, student_id: null, project_id: projectId});
  if (options.mixed) Object.assign(rows[1],{school_id:null,student_id:null,project_id:projectId});
  if (options.storedSnapshot) rows.forEach(member => Object.assign(member, {
    status: 'checkout_starting', platform_fee_collection_method: 'connect_application_fee',
    platform_fee_amount_cents: 25, platform_fee_currency: row.currency, platform_fee_rate_cents: 25,
  }));
  const now = Date.now();
  const photographer = {id: photographerId, business_name: 'Fixture Studio', stripe_connected_account_id: 'acct_fixture',
    stripe_account_id: null, stripe_connect_onboarding_complete: true, stripe_connect_charges_enabled: true,
    stripe_connect_payouts_enabled: true, subscription_status: 'active', subscription_plan_code: options.planCode ?? 'core',
    is_platform_admin: false, created_at: new Date(now - 86_400_000).toISOString(), trial_starts_at: null, trial_ends_at: null};
  if (options.trial || options.expiredTrial) Object.assign(photographer, {
    subscription_status: 'trial', subscription_plan_code: 'core', trial_starts_at: new Date(now - 86_400_000).toISOString(),
    trial_ends_at: new Date(now + (options.expiredTrial ? -1 : 1) * 86_400_000).toISOString(),
  });
  if (options.subscriptionProfile) Object.assign(photographer, {stripe_subscription_id:'sub_fixture', stripe_platform_customer_id:'cus_fixture'});
  if (options.trialCreatedAt) photographer.created_at = options.trialCreatedAt;
  if (options.owner) Object.assign(photographer, {is_platform_admin: true, subscription_status: null, subscription_plan_code: null});
  const tables = {orders: rows, photographers: [photographer], schools: [{id: schoolId, photographer_id: photographerId, school_name: 'Fixture school'}],
    students: [{id: studentId, school_id: schoolId, pin: 'PIN123'}],
    projects: [{id: projectId, photographer_id: photographerId, title: 'Fixture event', workflow_type: options.workflowType ?? 'event', linked_school_id: null}],
    order_items: rows.map(member => ({order_id: member.id, line_total_cents: 1000, unit_price_cents: 1000, quantity: 1, product_name: '8x10 print', sku: null})), packages: []};
  if (options.crossSchool) {
    tables.schools.push({id: otherSchoolId, photographer_id: options.foreignReturnSchool ? 'foreign-studio' : photographerId, school_name: 'Other school'});
    tables.students.push({id: otherStudentId, school_id: options.movedStudent ? schoolId : otherSchoolId, pin: 'OTHER456'});
  }
  tables.parent_order_session_access = options.provenance ? rows.map(member => ({order_id: member.id, token_hash: cookieHash,
    photographer_id: photographerId, order_group_id: member.order_group_id, school_id:member.school_id, project_id:member.project_id, student_id:member.student_id,lane_ids:[options.mixed&&member.project_id?eventLaneId:laneId]})) : [];
  tables.parent_checkout_returns = options.storedSnapshot && !options.ambiguousLegacy ? [{id:returnId, anchor_order_id:primaryId, attempt_key:'initial'}] : [];
  let authenticatedScope;
  const service = {
    from(table) {
      assert.ok(table in tables, `unexpected table ${table}`);
      let predicate = () => true, changes, sortKey;
      const chain = {
        select() {return chain;},
        eq(key, value) {const before = predicate; predicate = member => before(member) && member[key] === value; return chain;},
        in(key, values) {const before = predicate; predicate = member => before(member) && values.includes(member[key]); return chain;},
        order(key) {sortKey = key; return chain;},
        update(value) {changes = value; return chain;},
        maybeSingle() {return run(true);},
        then(resolve, reject) {return run(false).then(resolve, reject);},
      };
      async function run(single) {
        let matching = tables[table].filter(predicate);
        if (sortKey) matching = [...matching].sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])));
        if (changes) {
          assert.equal(locked, true, 'checkout writes require the payment lock');
          sequence.push(`write:${changes.status}`);
          matching.forEach(member => Object.assign(member, changes));
        }
        return {data: structuredClone(single ? matching[0] ?? null : matching), error: null, count: matching.length};
      }
      return chain;
    },
    async rpc(name, args) {
      assert.equal(locked, true);
      if (name === 'register_parent_checkout_return') {
        sequence.push('register-return');
        assert.deepEqual(args.p_order_ids,[...rows.map(member=>member.id)].sort());
        const saved={returnId,laneId,sessionId:null,expiresAt:new Date(Date.now()+86400000).toISOString()};
        tables.parent_checkout_returns=[{id:returnId,anchor_order_id:primaryId,attempt_key:args.p_attempt_key}];
        return {data:saved,error:null};
      }
      if (name === 'bind_parent_checkout_return') {sequence.push('bind-return');assert.equal(args.p_return_id,returnId);assert.equal(args.p_session_id,'cs_created');return{data:null,error:null};}
      assert.equal(name, 'freeze_order_platform_fees');
      assert.equal(args.p_photographer_id, photographerId);
      sequence.push('freeze'); freezeCalls.push(structuredClone(args));
      assert.ok(rows.every(member => member.status === 'payment_pending'), 'snapshots precede checkout_starting');
      if (options.freezeError) return {data: null, error: new Error('fixture snapshot RPC unavailable')};
      assert.equal(args.p_snapshots.length, rows.length);
      for (const snapshot of args.p_snapshots) Object.assign(rows.find(member => member.id === snapshot.id), snapshot);
      return {data: structuredClone(rows), error: null};
    },
  };
  const cache = new Map();
  const safeProcess = {env: {STRIPE_SECRET_KEY: 'sk_test_routeFixture', STRIPE_BILLING_CURRENCY: 'cad',
    ...(options.pricingV2 ? {STUDIO_GALLERY_PRICING_V2_ENABLED:'1'} : {}),
    ...(options.pricingV3 ? {STUDIO_GALLERY_PRICING_V3_ENABLED:'1'} : {}),
    ...(options.launchAt ? {STUDIO_GALLERY_PRICING_V2_LAUNCH_AT:options.launchAt} : {})}};
  async function provider(target, request) {
    if (new URL(target).pathname === '/v1/subscriptions/sub_fixture') {
      assert.equal(request.method, 'GET');
      assert.equal(request.headers['Stripe-Account'], undefined, 'subscription belongs to platform');
      sequence.push('subscription-get');
      const plan = options.planCode ?? 'core';
      const newProfile = options.subscriptionProfile === 'gallery_v2' || options.subscriptionProfile === 'gallery_v3';
      const version=options.subscriptionProfile==='gallery_v3'?'gallery-v3':newProfile?'gallery-v2':'v2';
      const amount = plan === 'starter' ? newProfile ? 5900 : 4900 : plan === 'core' ? 9900 : 19900;
      return Response.json({id:'sub_fixture',customer:options.subscriptionCustomer ?? 'cus_fixture',status:'active',
        metadata:{photographer_id:photographerId,plan_code:plan,billing_interval:'month',
          pricing_profile:options.subscriptionProfile,...options.subscriptionMetadata},
        items:{data:[{id:'si_base',quantity:1,price:{id:'price_base',currency:'cad',unit_amount:options.subscriptionAmount ?? amount,
          lookup_key:`studio-os-${plan}-monthly-${version}`,recurring:{interval:'month',interval_count:options.intervalCount??1,usage_type:options.subscriptionUsageType??'licensed'}}},
          ...(!newProfile ? [{id:'si_usage',price:{id:'price_usage',currency:'cad',unit_amount:options.legacyRate ?? 40,
            lookup_key:`studio-os-${plan}-order-usage-monthly-v2`,recurring:{interval:'month',usage_type:'metered'}}}] : [])]}});
    }
    assert.equal(target, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(request.method, 'POST'); assert.equal(locked, true);
    sequence.push('provider-checkout');
    stripeRequests.push({headers: request.headers, params: new URLSearchParams(request.body)});
    if(options.providerError)throw new Error('Synthetic lost provider response');
    return Response.json({id: 'cs_created', url: 'https://checkout.stripe.invalid/fixture'});
  }
  const pure = new Set(['studio-pricing', 'trial-config', 'subscription-access', 'order-payment-policy', 'order-checkout-totals', 'order-currency', 'school-parent-gallery-link', 'online-backdrop-policy']);
  function load(path, overrides = {}) {
    if (cache.has(path)) return cache.get(path);
    const exports = {}; cache.set(path, exports);
    const compiled = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText;
    new Function('require', 'exports', 'process', 'fetch', 'console', compiled)(name => {
      if (name in overrides) return overrides[name];
      if (name.startsWith('@/lib/')) {
        const moduleName = name.slice('@/lib/'.length);
        return pure.has(moduleName) ? load(`lib/${moduleName}.ts`) : {};
      }
      return require(name);
    }, exports, safeProcess, provider, {error() {}, warn() {}, log() {}});
    return exports;
  }
  const actualPayments = load('lib/payments.ts');
  class SessionError extends Error {constructor(status,message='Invalid gallery credentials.'){super(message);this.status=status;}}
  const foundation={ParentGallerySessionError:SessionError,parentSessionCookieBinding:request=>request.headers.get('cookie')?.includes('session_fixture')?cookieHash:null,
    bootstrapParentGallerySession:async(_request,input)=>{
      if(!input.pin || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))throw new SessionError(400);
      const gallery=tables[input.kind==='school'?'schools':'projects'].find(g=>g.id===input.galleryId);
      if(!gallery || (input.kind==='school'&&!tables.students.some(st=>st.school_id===input.galleryId&&st.pin===input.pin)))throw new SessionError(403);
      authenticatedScope={laneId,...input,email:input.email.trim().toLowerCase(),photographerId:gallery.photographer_id,expiresAt:new Date(Date.now()+86400000).toISOString()};
      return{grant:authenticatedScope,applyCookie:async response=>{response.headers.append('set-cookie','__Host-studio_os_parent_session=session_fixture; Path=/; HttpOnly; Secure');return response;}};
    },resolveParentGallerySession:async(_request,id)=>options.mixed&&id===eventLaneId
      ? {...authenticatedScope,laneId:eventLaneId,kind:'event',galleryId:projectId}
      : authenticatedScope};
  const checkoutHelper=load('lib/parent-checkout-return.ts',{'server-only':{},'@/lib/dashboard-auth':{createDashboardServiceClient:()=>service},'@/lib/parent-gallery-session':foundation,
    '@/lib/payments':actualPayments,'@/lib/order-checkout-totals':load('lib/order-checkout-totals.ts')});
  const dependencies = {
    'next/server': {NextResponse: {json: (value, init) => Response.json(value, init)}},
    '@/lib/dashboard-auth': {createDashboardServiceClient: () => service},
    '@/lib/parent-gallery-session-request':{getParentGalleryRequestScope:()=>null,runParentGallerySessionRoute:()=>assert.fail('Legacy fixture never selects adapter')},
    '@/lib/parent-gallery-session':foundation,'@/lib/parent-checkout-return':checkoutHelper,
    '@/lib/order-payment-lock': {lockOrderPayment: async () => {
      assert.equal(locked, false); locked = true; sequence.push('lock');
      return async () => {sequence.push('unlock'); locked = false;};
    }},
    '@/lib/stored-order-backdrop-preflight': {assertStoredOrderBackdropCutouts: async () => {sequence.push('preflight');}},
    '@/lib/parent-cutout-preflight': {ParentCutoutPreflightError: class extends Error {}},
    '@/lib/retouching': {retouchPrintPurchaseIssue: () => null},
    '@/lib/order-checkout-totals': load('lib/order-checkout-totals.ts'),
    '@/lib/school-parent-gallery-link': load('lib/school-parent-gallery-link.ts'),
    '@/lib/payments': {...actualPayments,
      retrieveStripeAccount: async () => ({id: 'acct_fixture', details_submitted: true, charges_enabled: true, payouts_enabled: true}),
      syncConnectState: async () => {},
      retrieveCheckoutSession: async id => ({id, status: options.legacySession === 'expired' ? 'expired' : 'open', url: 'https://checkout.stripe.invalid/legacy'}),
      quoteDirectOrderPlatformFees: async input => {sequence.push('quote'); quoteInputs.push(structuredClone(input)); return actualPayments.quoteDirectOrderPlatformFees(input);},
      createDirectOrderCheckoutSession: async input => {
        sequence.push('create-checkout'); checkoutInputs.push(structuredClone(input));
        return actualPayments.createDirectOrderCheckoutSession(input);
      },
    },
  };
  const handler = load('app/api/stripe/checkout/route.ts', dependencies);
  const invoke = extra => handler.POST(new Request('https://gallery.example.invalid/api/stripe/checkout', {
    method:'POST',headers:{origin:'https://gallery.example.invalid','content-type':'application/json'},
    body:JSON.stringify({orderId:primaryId,pin:'PIN123',email:'viewer@example.invalid',...extra})}));
  return {invoke, rows, sequence, quoteInputs, freezeCalls, checkoutInputs, stripeRequests, photographer, tables, getScope:()=>authenticatedScope};
}

test('new App order freezes the actual40c CAD quote before marking or sending Stripe Checkout', async () => {
  const f = fixture(); assert.equal((await f.invoke()).status, 200);
  assert.equal(f.freezeCalls.length, 1); assert.equal(f.freezeCalls[0].p_snapshots[0].platform_fee_amount_cents, 40);
  assert.ok(f.sequence.indexOf('freeze') < f.sequence.indexOf('write:checkout_starting'));
  assert.ok(f.sequence.indexOf('write:checkout_starting') < f.sequence.indexOf('provider-checkout'));
  assert.equal(f.checkoutInputs[0].platformFee.amountCents, 40);
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'), '40');
  assert.equal(f.stripeRequests[0].headers['Stripe-Account'], 'acct_fixture');
  assert.equal(f.sequence.at(-1), 'unlock');
});

test('combined checkout freezes both orders once and collects80c through one charge', async () => {
  const f = fixture({combined: true}); assert.equal((await f.invoke()).status, 200);
  assert.equal(f.freezeCalls.length, 1); assert.equal(f.freezeCalls[0].p_snapshots.length, 2);
  assert.ok(f.rows.every(member => member.platform_fee_amount_cents === 40));
  assert.equal(f.stripeRequests.length, 1); assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'), '80');
  assert.equal(f.stripeRequests[0].params.get('line_items[0][price_data][unit_amount]'), '2000');
});

test('an ordinary active trial uses the server-derived Studio35c rate', async () => {
  const f = fixture({trial: true}); assert.equal((await f.invoke({freeTrialActive: false, planCode: 'starter'})).status, 200);
  assert.equal(f.quoteInputs[0].freeTrialActive, true); assert.equal(f.quoteInputs[0].planCode, 'studio');
  assert.equal(f.freezeCalls[0].p_snapshots[0].platform_fee_rate_cents, 35);
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'), '35');
});

test('expired trial rejects a client trial claim with403 before fee or provider mutations', async () => {
  const f = fixture({expiredTrial: true}); assert.equal((await f.invoke({freeTrialActive: true, isPlatformAdmin: true})).status, 403);
  assert.equal(f.quoteInputs.length, 0); assert.equal(f.freezeCalls.length, 0); assert.equal(f.checkoutInputs.length, 0);
  assert.equal(f.stripeRequests.length, 0); assert.equal(f.sequence.at(-1), 'unlock');
});

test('persisted platform owner gets a waived snapshot and no Stripe application fee', async () => {
  const f = fixture({owner: true}); assert.equal((await f.invoke()).status, 200);
  assert.equal(f.freezeCalls[0].p_snapshots[0].platform_fee_collection_method, 'waived');
  assert.equal(f.rows[0].platform_fee_amount_cents, 0); assert.equal(f.checkoutInputs[0].platformFee.amountCents, 0);
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'), null);
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[metadata][platform_fee_collection_method]'), 'waived');
});

test('stored snapshot retry skips requoting and freezing and preserves its original25c rate', async () => {
  const f = fixture({storedSnapshot: true}); assert.equal((await f.invoke()).status, 200);
  assert.equal(f.quoteInputs.length, 0); assert.equal(f.freezeCalls.length, 0);
  assert.equal(f.checkoutInputs[0].platformFee.amountCents, 25); assert.equal(f.checkoutInputs[0].platformFee.rateCents, 25);
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'), '25');
});

test('owner fee-bearing historical checkout retries are refused before session reuse or payment writes', async () => {
  for (const legacySession of [undefined, 'open', 'expired']) {
    const f = fixture({owner: true, storedSnapshot: true, legacySession});
    const before = structuredClone(f.rows);
    const response = await f.invoke();
    assert.equal(response.status, 409);
    assert.match((await response.json()).message, /owner exemption/i);
    assert.equal(f.quoteInputs.length, 0);
    assert.equal(f.freezeCalls.length, 0);
    assert.equal(f.checkoutInputs.length, 0);
    assert.equal(f.stripeRequests.length, 0);
    assert.deepEqual(f.rows, before, 'an existing nonzero snapshot or session is never silently repriced');
    assert.equal(f.sequence.at(-1), 'unlock');
  }
});

test('open legacy checkout is reused without freezing, quoting or creating another session', async () => {
  const f = fixture({legacySession: 'open'}), response = await f.invoke();
  assert.equal(response.status, 200); assert.equal((await response.json()).sessionId, 'cs_legacy');
  assert.equal(f.quoteInputs.length, 0); assert.equal(f.freezeCalls.length, 0); assert.equal(f.checkoutInputs.length, 0);
  assert.equal(f.stripeRequests.length, 0); assert.equal(f.rows[0].platform_fee_collection_method, null);
});

test('expired legacy checkout recreates a session without adding a prospective application fee', async () => {
  const f = fixture({legacySession: 'expired'}); assert.equal((await f.invoke()).status, 200);
  assert.equal(f.quoteInputs.length, 0); assert.equal(f.freezeCalls.length, 0);
  assert.equal(f.checkoutInputs[0].platformFee, undefined); assert.equal(f.checkoutInputs[0].previousExpiredSessionId, 'cs_legacy');
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'), null);
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[metadata][platform_fee_collection_method]'), null);
});

test('snapshot RPC failure stops before checkout_starting and every Stripe request', async () => {
  const f = fixture({freezeError: true}); assert.equal((await f.invoke()).status, 500);
  assert.equal(f.freezeCalls.length, 1); assert.equal(f.checkoutInputs.length, 0); assert.equal(f.stripeRequests.length, 0);
  assert.equal(f.rows[0].platform_fee_collection_method, null); assert.equal(f.rows[0].status, 'payment_pending');
  assert.equal(f.sequence.at(-1), 'unlock');
});

test('local-currency checkouts retain the nominal40/35/55 fee without CAD conversion metadata', async () => {
  for (const [currency, planCode, fee] of [['usd', 'core', 40], ['eur', 'studio', 35], ['gbp', 'starter', 55]]) {
    const f = fixture({currency, planCode}); assert.equal((await f.invoke()).status, 200);
    assert.equal(f.rows[0].platform_fee_amount_cents, fee); assert.equal(f.rows[0].platform_fee_rate_cents, fee);
    assert.equal(f.rows[0].platform_fee_currency, currency);
    assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'), String(fee));
    assert.equal(f.stripeRequests[0].params.get('line_items[0][price_data][currency]'), currency);
    assert.ok([...f.stripeRequests[0].params.keys()].every(key => !/fx_|cad_cents/.test(key)));
  }
});

test('new success and cancel URLs contain only an opaque return and no viewer credentials', async()=>{
  const f=fixture();assert.equal((await f.invoke({schoolId,email:'Viewer+Child@Example.invalid',customerEmail:'billing@example.invalid'})).status,200);
  for(const [which,result] of [['successUrl','success'],['cancelUrl','cancel']]){
    const url=new URL(f.checkoutInputs[0][which]);assert.equal(url.pathname,'/parents/checkout-return/'+returnId);
    assert.equal(url.searchParams.get('result'),result);assert.equal(url.searchParams.get('pin'),null);assert.equal(url.searchParams.get('email'),null);
    assert.ok(!url.href.includes('PIN123')&&!url.href.includes('Viewer'));
  }
  assert.equal(f.stripeRequests[0].params.get('metadata[portal_return_email]'),null);
  assert.ok(f.sequence.indexOf('register-return')<f.sequence.indexOf('provider-checkout'));
  assert.ok(f.sequence.indexOf('bind-return')>f.sequence.indexOf('provider-checkout'));
  assert.ok(f.sequence.indexOf('bind-return')<f.sequence.indexOf('write:payment_pending'));
});

test('orderId without explicit PIN/email cannot recover saved gallery credentials or create a payment',async()=>{
  const f=fixture();const before=structuredClone(f.rows);assert.equal((await f.invoke({pin:undefined,email:undefined,customerEmail:'untrusted@example.invalid'})).status,403);
  assert.equal(f.stripeRequests.length,0);assert.deepEqual(f.rows,before);
});

test('combined legacy school checkout binds validated sibling return lane while keeping deterministic charge anchor',async()=>{
  const f=fixture({combined:true,crossSchool:true});assert.equal((await f.invoke({schoolId:otherSchoolId,pin:'OTHER456',email:'viewer@example.invalid'})).status,200);
  assert.equal(f.getScope().galleryId,otherSchoolId);assert.equal(f.checkoutInputs[0].orderId,primaryId);
  assert.equal(new URL(f.checkoutInputs[0].successUrl).pathname,'/parents/checkout-return/'+returnId);
});

test('split school/PIN, missing member, moved student and foreign owner fail before provider or payment writes',async()=>{
  for(const [options,input] of [
    [{combined:true,crossSchool:true},{schoolId,pin:'OTHER456'}],
    [{combined:true,crossSchool:true},{schoolId:projectId,pin:'PIN123'}],
    [{combined:true,crossSchool:true,movedStudent:true},{schoolId:otherSchoolId,pin:'OTHER456'}],
    [{combined:true,crossSchool:true,foreignReturnSchool:true},{schoolId:otherSchoolId,pin:'OTHER456'}],
    [{},{schoolId,pin:'PIN123',email:'invalid-email'}],
  ]){const f=fixture(options),before=structuredClone(f.rows);const response=await f.invoke(input);assert.ok([400,403].includes(response.status));assert.equal(f.stripeRequests.length,0);assert.deepEqual(f.rows,before);assert.equal(f.sequence.at(-1),'unlock');}
});

test('event checkout with creation provenance uses clean returns; unmapped draft keeps basket and never starts a charge',async()=>{
  const f=fixture({event:true,provenance:true});assert.equal((await f.invoke({mode:'event',projectId,email:'event+viewer@example.invalid'})).status,200);
  assert.equal(new URL(f.checkoutInputs[0].successUrl).pathname,'/parents/checkout-return/'+returnId);
  const legacy=fixture({event:true});const response=await legacy.invoke({mode:'event',projectId,customerEmail:'buyer@example.invalid'});
  assert.equal(response.status,409);assert.equal(legacy.stripeRequests.length,0);
});

test('ambiguous legacy checkout marker without durable return cannot change old provider idempotency payload',async()=>{
  const f=fixture({storedSnapshot:true,ambiguousLegacy:true}),before=structuredClone(f.rows);
  assert.equal((await f.invoke()).status,409);assert.equal(f.stripeRequests.length,0);assert.deepEqual(f.rows,before);
});


test('lost provider response keeps the browser binding and durable return while the payable attempt marker remains',async()=>{
 const f=fixture({providerError:true}),response=await f.invoke();assert.equal(response.status,500);
 assert.match(response.headers.get('set-cookie'),/__Host-studio_os_parent_session=session_fixture/);
 assert.equal(f.tables.parent_checkout_returns.length,1);assert.equal(f.rows[0].status,'checkout_starting');assert.equal(f.stripeRequests.length,1);
 assert.equal(f.sequence.includes('bind-return'),false);assert.equal(f.sequence.at(-1),'unlock');
});
test('combined retries naming another sibling keep exactly the same provider scope and URL payload',async()=>{
 const a=fixture({combined:true,crossSchool:true}),b=fixture({combined:true,crossSchool:true});
 assert.equal((await a.invoke({schoolId:otherSchoolId,pin:'OTHER456'})).status,200);
 assert.equal((await b.invoke({orderId:siblingId,schoolId:otherSchoolId,pin:'OTHER456'})).status,200);
 assert.deepEqual([...a.stripeRequests[0].params],[...b.stripeRequests[0].params]);
 assert.equal(a.stripeRequests[0].headers['Idempotency-Key'],b.stripeRequests[0].headers['Idempotency-Key']);
});

test('public new pricing keeps legacy subscriptions and unmarked trials at their verified old rates', async () => {
  const old = fixture({pricingV2:true,subscriptionProfile:'legacy',legacyRate:37});
  assert.equal((await old.invoke({pricingProfile:'gallery_v2',feeScope:'gallery'})).status,200);
  assert.equal(old.checkoutInputs[0].platformFee.amountCents,37);
  assert.equal(old.quoteInputs[0].pricingProfile,'legacy');
  assert.ok(old.sequence.indexOf('subscription-get')<old.sequence.indexOf('freeze'));
  const trial = fixture({pricingV2:true,trial:true});
  assert.equal((await trial.invoke({pricingProfile:'gallery_v2',feeScope:'gallery'})).status,200);
  assert.equal(trial.checkoutInputs[0].platformFee.amountCents,35);
});

test('a verified new paid plan collects45c school fees and leaves ordinary galleries fee-free on Express', async () => {
  for (const event of [false,true]) {
    const f = fixture({pricingV2:true,subscriptionProfile:'gallery_v2',event,provenance:event});
    assert.equal((await f.invoke(event ? {mode:'event',projectId,email:'event+viewer@example.invalid'} : {})).status,200);
    assert.equal(f.checkoutInputs[0].platformFee.amountCents,event?0:45);
    assert.equal(f.quoteInputs[0].pricingProfile,'gallery_v2');
    assert.equal(f.stripeRequests[0].headers['Stripe-Account'],'acct_fixture');
    assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'),event?null:'45');
  }
});

test('provider ownership, metadata or exact plan price failure never reaches fee freezing or payment creation', async () => {
  for (const overrides of [{subscriptionCustomer:'cus_foreign'},
    {subscriptionMetadata:{photographer_id:'foreign-studio'}},
    {subscriptionMetadata:{pricing_profile:'legacy'}},
    {subscriptionMetadata:{plan_code:'studio'}},
    {subscriptionAmount:8800}]) {
    const f=fixture({pricingV2:true,subscriptionProfile:'gallery_v2',...overrides});
    assert.equal((await f.invoke()).status,409);
    assert.equal(f.freezeCalls.length,0);
    assert.equal(f.checkoutInputs.length,0);
  }
});

test('new Gallery subscriptions have no fee and frozen previous checkouts never read a new subscription policy', async () => {
  const gallery=fixture({pricingV2:true,subscriptionProfile:'gallery_v2',planCode:'starter'});
  assert.equal((await gallery.invoke()).status,200);
  assert.equal(gallery.checkoutInputs[0].platformFee.amountCents,0);
  const frozen=fixture({pricingV2:true,subscriptionProfile:'gallery_v2',storedSnapshot:true});
  assert.equal((await frozen.invoke()).status,200);
  assert.equal(frozen.checkoutInputs[0].platformFee.amountCents,25);
  assert.equal(frozen.sequence.includes('subscription-get'),false);
});

test('catalog rollback still honors already-paid new subscription fee policy', async () => {
  const f=fixture({subscriptionProfile:'gallery_v2'});
  assert.equal((await f.invoke()).status,200);
  assert.equal(f.checkoutInputs[0].platformFee.amountCents,45);
});

test('new USD school orders keep Express sales currency and collect45minorunits without CAD conversion', async () => {
  const f=fixture({pricingV2:true,subscriptionProfile:'gallery_v2',currency:'usd'});
  assert.equal((await f.invoke()).status,200);
  const fee=f.checkoutInputs[0].platformFee;
  assert.equal(fee.amountCents,45);
  assert.equal(fee.currency,'usd');
  assert.equal(f.rows[0].platform_fee_currency,'usd');
  const params=f.stripeRequests[0].params;
  assert.equal(params.get('line_items[0][price_data][currency]'),'usd');
  assert.equal(params.get('payment_intent_data[application_fee_amount]'),'45');
  assert.equal(params.get('metadata[platform_fee_currency]'),'usd');
  assert.equal(params.get('payment_intent_data[metadata][platform_fee_currency]'),'usd');
  assert.equal(params.get('metadata[platform_fee_fx_rate]'),null);
  assert.equal(f.stripeRequests[0].headers['Stripe-Account'],'acct_fixture');
});

test('every free trial keeps the disclosed35c fee even with a configured old cutoff and later signup date', async () => {
  const launchAt='2026-10-01T00:00:00.000Z';
  for(const trialCreatedAt of ['2026-09-30T23:59:59.000Z',launchAt,'2026-10-02T00:00:00.000Z']) {
    for(const event of [false,true]) {
      const f=fixture({pricingV2:true,trial:true,launchAt,trialCreatedAt,event,provenance:event});
      assert.equal((await f.invoke(event?{mode:'event',projectId,email:'event+viewer@example.invalid'}:{})).status,200);
      assert.equal(f.quoteInputs[0].pricingProfile,'legacy');
      assert.equal(f.checkoutInputs[0].platformFee.amountCents,35);
      assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'),'35');
    }
  }
});

test('verified V3 Gallery/Core/Studio subscriptions charge55/45/45 for school and ordinary gallery purchases', async () => {
  for(const[planCode,rate]of[['starter',55],['core',45],['studio',45]]) {
    for(const event of [false,true]) {
      const f=fixture({pricingV3:true,subscriptionProfile:'gallery_v3',planCode,event,provenance:event,workflowType:'portrait'});
      const response=await f.invoke({...(event?{mode:'event',projectId,email:'event+viewer@example.invalid'}:{}),
        pricingProfile:'gallery_v2',feeScope:'gallery',planCode:'starter',platformFeeAmount:0});
      assert.equal(response.status,200);
      assert.equal(f.quoteInputs[0].pricingProfile,'gallery_v3');
      assert.equal(f.quoteInputs[0].planCode,planCode);
      assert.equal(f.checkoutInputs[0].platformFee.amountCents,rate);
      assert.equal(f.rows[0].platform_fee_rate_cents,rate);
      assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'),String(rate));
      assert.equal(f.stripeRequests[0].headers['Stripe-Account'],'acct_fixture');
    }
  }
});

test('V3 fees charge per persisted group member in the sales currency and do not depend on public offer flags',async()=>{
  for(const[planCode,rate]of[['starter',55],['core',45],['studio',45]]) {
    const f=fixture({subscriptionProfile:'gallery_v3',planCode,combined:true,currency:'usd'});
    assert.equal((await f.invoke()).status,200);
    assert.equal(f.checkoutInputs[0].platformFee.amountCents,rate*2);
    assert.deepEqual(f.rows.map(row=>[row.platform_fee_amount_cents,row.platform_fee_currency]),[[rate,'usd'],[rate,'usd']]);
    const params=f.stripeRequests[0].params;
    assert.equal(params.get('payment_intent_data[application_fee_amount]'),String(rate*2));
    assert.equal(params.get('metadata[platform_fee_currency]'),'usd');
    assert.equal(params.get('metadata[platform_fee_fx_rate]'),null);
  }
});

test('V3 offers preserve existing V2 gallery waivers/production45, legacy rates, trials and frozen fees',async()=>{
  for(const[planCode,event,expected]of[['starter',true,0],['starter',false,0],['core',true,0],['core',false,45],['studio',true,0],['studio',false,45]]) {
    const f=fixture({pricingV3:true,subscriptionProfile:'gallery_v2',planCode,event,provenance:event});
    assert.equal((await f.invoke(event?{mode:'event',projectId,email:'event+viewer@example.invalid'}:{})).status,200);
    assert.equal(f.checkoutInputs[0].platformFee.amountCents,expected);
  }
  const old=fixture({pricingV3:true,subscriptionProfile:'legacy',legacyRate:29});
  assert.equal((await old.invoke()).status,200);
  assert.equal(old.checkoutInputs[0].platformFee.amountCents,29);
  const trial=fixture({pricingV3:true,trial:true});
  assert.equal((await trial.invoke({pricingProfile:'gallery_v3'})).status,200);
  assert.equal(trial.checkoutInputs[0].platformFee.amountCents,35);
  const frozen=fixture({pricingV3:true,subscriptionProfile:'gallery_v3',storedSnapshot:true});
  assert.equal((await frozen.invoke()).status,200);
  assert.equal(frozen.checkoutInputs[0].platformFee.amountCents,25);
  assert.equal(frozen.sequence.includes('subscription-get'),false);
  const owner=fixture({pricingV3:true,subscriptionProfile:'gallery_v3',owner:true});
  assert.equal((await owner.invoke()).status,200);
  assert.equal(owner.checkoutInputs[0].platformFee.amountCents,0);
});

test('V3 provider lookup cannot be overridden by inconsistent metadata, cadence, amount or metered billing',async()=>{
  for(const options of [{subscriptionCustomer:'cus_foreign'},
    {subscriptionMetadata:{photographer_id:'foreign-studio'}},{subscriptionMetadata:{pricing_profile:'gallery_v2'}},
    {subscriptionMetadata:{plan_code:'starter'}},{subscriptionAmount:8800},{intervalCount:2},{subscriptionUsageType:'metered'}]) {
    const f=fixture({pricingV3:true,subscriptionProfile:'gallery_v3',...options});
    assert.equal((await f.invoke()).status,409);
    assert.equal(f.freezeCalls.length,0);
    assert.equal(f.checkoutInputs.length,0);
  }
});

test('actual V3 mixed school/ordinary gallery checkout collects both55c fees using independently proven gallery lanes',async()=>{
  const f=fixture({pricingV3:true,subscriptionProfile:'gallery_v3',planCode:'starter',combined:true,mixed:true,provenance:true,workflowType:'ordinary-portrait'});
  assert.equal((await f.invoke()).status,200);
  assert.equal(f.checkoutInputs[0].platformFee.amountCents,110);
  assert.deepEqual(f.rows.map(row=>row.platform_fee_amount_cents),[55,55]);
  assert.equal(f.stripeRequests[0].params.get('payment_intent_data[application_fee_amount]'),'110');
});
