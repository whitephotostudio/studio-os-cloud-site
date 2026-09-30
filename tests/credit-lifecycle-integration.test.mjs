import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import sharp from 'sharp';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false },
  }).outputText;
  new Function('require', 'exports', compiled)(name => name in overrides ? overrides[name]
    : name.startsWith('@/') ? {} : require(name), exports);
  return exports;
}
const migrations = ['20260930010000_atomic_credit_accounting.sql', '20260930012000_protect_photographer_billing.sql',
  '20260930013000_cloud_credit_jobs.sql', '20260930100000_order_usage_fee_ledger.sql', '20260930120000_paid_cutout_entitlements.sql'];
const rowFunctions = new Set(['apply_credit_adjustment', 'reverse_credit_purchase', 'get_studio_credit_balance', 'reserve_cloud_credit_job']);
const identifier = value => {
  assert.match(value, /^[a-z_][a-z_0-9]*$/);
  return `"${value}"`;
};

async function fixture(run) {
  const db = new PGlite();
  const savedFetch = globalThis.fetch;
  const changedEnv = ['STRIPE_SECRET_KEY', 'STRIPE_BILLING_CURRENCY', 'PHOTOROOM_API_KEY', 'STUDIO_CREDIT_MAINTENANCE'];
  const savedEnv = Object.fromEntries(changedEnv.map(key => [key, process.env[key]]));
  process.env.STRIPE_SECRET_KEY = 'sk_test_lifecycle_fixture';
  process.env.STRIPE_BILLING_CURRENCY = 'cad';
  process.env.PHOTOROOM_API_KEY = 'prod_lifecycle_fixture';
  process.env.STUDIO_CREDIT_MAINTENANCE = '0';
  try {
    await db.exec(`set timezone='UTC'; create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create table photographers(id uuid primary key,user_id uuid not null unique,is_platform_admin boolean not null default false,
        stripe_platform_customer_id text,created_at timestamptz default now(),trial_starts_at timestamptz,
        subscription_current_period_start timestamptz,subscription_current_period_end timestamptz);
      create table credit_packages(id uuid primary key);
      create table studio_credits(id uuid primary key default gen_random_uuid(),studio_id uuid not null unique,photographer_id uuid,
        balance integer not null default 0 check(balance>=0),total_purchased integer not null default 0,total_used integer not null default 0,updated_at timestamptz default now());
      create table credit_transactions(id uuid primary key default gen_random_uuid(),studio_id uuid not null,photographer_id uuid,
        type text not null check(type in ('purchase','usage','refund','monthly_included')),amount integer not null,balance_after integer not null,
        description text,package_id uuid references credit_packages(id),created_at timestamptz default now(),credits_delta integer,
        credit_transaction_type text,source text,source_reference_id text,stripe_checkout_session_id text,stripe_payment_intent_id text,
        ai_operation text,processing_method text,photo_path text);
      create table orders(id uuid primary key,photographer_id uuid,paid_at timestamptz,payment_status text,refund_status text,
        is_test boolean,total_cents integer,counted_for_monthly_usage boolean default false,monthly_usage_billing_period text);
      grant select,update on photographers,orders to service_role;
      grant all on credit_packages,studio_credits,credit_transactions to service_role;`);
    for (const name of migrations) await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    const studio = randomUUID(), photographer = randomUUID(), packageId = randomUUID();
    const profile = (await db.query(`insert into photographers(id,user_id,stripe_platform_customer_id,
      subscription_current_period_start,subscription_current_period_end)
      values($1,$2,'cus_lifecycle',now()-interval '5 days',now()-interval '5 days'+interval '1 month') returning *`,
    [photographer, studio])).rows[0];
    await db.query('insert into credit_packages values($1)', [packageId]);
    const asRole = (role, action, userId) => db.transaction(async tx => {
      assert.ok(['authenticated', 'service_role'].includes(role));
      await tx.exec(`set local role ${role}`);
      if (userId) await tx.query("select set_config('test.uid',$1,true)", [userId]);
      return action(tx);
    });
    const queryService = (query, values = []) => asRole('service_role', tx => tx.query(query, values));
    const client = (query, values = [], userId = studio) => asRole('authenticated', tx => tx.query(query, values), userId);
    const rpcCalls = [];
    const service = {
      from(table) {
        assert.ok(['photographers', 'credit_cloud_jobs', 'orders', 'order_usage_fees'].includes(table));
        const predicates = [], values = [];
        let columns = '*', changes, sort = '', limit = '';
        const predicate = (key, operator, value) => { values.push(value); predicates.push(`${identifier(key)}${operator}$${values.length}`); return chain; };
        async function execute(single = false) {
          let query = `select ${columns} from ${identifier(table)}`;
          if (changes) {
            const sets = Object.entries(changes).map(([key, value]) => { values.push(value); return `${identifier(key)}=$${values.length}`; });
            query = `update ${identifier(table)} set ${sets.join(',')}`;
          }
          if (predicates.length) query += ` where ${predicates.join(' and ')}`;
          query += changes ? ' returning *' : sort + limit;
          try {
            const result = await queryService(query, values);
            return { data: single ? result.rows[0] ?? null : result.rows, error: null };
          } catch (error) { return { data: null, error }; }
        }
        const chain = {
          select(value = '*') { columns = value === '*' ? '*' : value.split(',').map(identifier).join(','); return chain; },
          eq(key, value) { return predicate(key, '=', value); },
          gte(key, value) { return predicate(key, '>=', value); },
          lt(key, value) { return predicate(key, '<', value); },
          in(key, choices) { predicates.push(`${identifier(key)} in (${choices.map(value => { values.push(value); return `$${values.length}`; }).join(',')})`); return chain; },
          or(value) { assert.equal(value, 'is_test.is.false,is_test.is.null'); predicates.push('(is_test is false or is_test is null)'); return chain; },
          order(key, options = {}) { sort = ` order by ${identifier(key)} ${options.ascending === false ? 'desc' : 'asc'}`; return chain; },
          limit(count) { assert.ok(Number.isInteger(count) && count > 0); limit = ` limit ${count}`; return chain; },
          update(value) { changes = value; return chain; },
          maybeSingle() { return execute(true); },
          then(resolve, reject) { return execute().then(resolve, reject); },
        };
        return chain;
      },
      async rpc(name, args) {
        rpcCalls.push({ name, args });
        const entries = Object.entries(args);
        try {
          const result = await queryService(`select * from public.${identifier(name)}(${entries.map(([key], index) => `${identifier(key)}=>$${index + 1}`).join(',')})`, entries.map(([, value]) => value));
          return { data: rowFunctions.has(name) ? result.rows : result.rows[0]?.[name] ?? null, error: null };
        } catch (error) { return { data: null, error }; }
      },
    };
    const stripeCalls = [], prices = new Map(), intents = new Map(), refunds = new Map(), sessions = [], acceptedMeterRequests = new Map();
    let providerCalls = 0, providerFailure = false, refundReadFailure = false;
    const inputImage = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#543210' } }).jpeg().toBuffer();
    const pixels = Buffer.alloc(32 * 24 * 4, 255); pixels[3] = 0;
    const outputImage = await sharp(pixels, { raw: { width: 32, height: 24, channels: 4 } }).png().toBuffer();
    const jsonResponse = data => ({ ok: true, text: async () => JSON.stringify(data) });
    globalThis.fetch = async (target, options) => {
      const url = new URL(target);
      if (url.href === 'https://sdk.photoroom.com/v1/segment') {
        providerCalls++;
        assert.equal(options.method, 'POST');
        assert.equal(options.headers['x-api-key'], 'prod_lifecycle_fixture');
        assert.equal(options.body.get('format'), 'png');
        assert.equal(options.body.get('channels'), 'rgba');
        assert.equal(options.body.get('size'), 'full');
        assert.deepEqual(Buffer.from(await options.body.get('image_file').arrayBuffer()), inputImage);
        return { ok: !providerFailure, status: providerFailure ? 402 : 200, arrayBuffer: async () => outputImage };
      }
      assert.equal(url.origin, 'https://api.stripe.com', 'the isolated harness must never fall back to real network');
      assert.equal(options.headers.Authorization, 'Bearer sk_test_lifecycle_fixture');
      assert.equal(options.headers['Stripe-Account'], undefined, 'credit packs and service fees belong to the owner platform');
      const path = url.pathname.replace('/v1/', '');
      const params = new URLSearchParams(options.body);
      stripeCalls.push({ path, method: options.method, params, key: options.headers['Idempotency-Key'] });
      if (options.method === 'GET' && ['prices', 'billing/meters'].includes(path)) return jsonResponse({ data: [], has_more: false });
      if (options.method === 'POST' && path === 'products') return jsonResponse({ id: `prod_${randomUUID()}` });
      if (options.method === 'POST' && path === 'billing/meters') return jsonResponse({ id: `meter_${randomUUID()}` });
      if (options.method === 'POST' && path === 'prices') {
        const id = `price_${randomUUID()}`;
        prices.set(id, { amount: Number(params.get('unit_amount')), currency: params.get('currency') });
        return jsonResponse({ id });
      }
      if (options.method === 'POST' && path === 'checkout/sessions') {
        const snapshot = prefix => Object.fromEntries([...params].filter(([key]) => key.startsWith(`${prefix}[`) && key.endsWith(']'))
          .map(([key, value]) => [key.slice(prefix.length + 1, -1), value]));
        const price = prices.get(params.get('line_items[0][price]'));
        assert.ok(price);
        const intent = { id: `pi_${randomUUID()}`, amount: price.amount, metadata: snapshot('payment_intent_data[metadata]') };
        intents.set(intent.id, intent);
        const session = { id: `cs_${randomUUID()}`, mode: params.get('mode'), customer: params.get('customer'), payment_status: 'unpaid',
          payment_intent: intent.id, amount_total: price.amount, currency: price.currency, metadata: snapshot('metadata') };
        sessions.push(session);
        return jsonResponse(session);
      }
      if (options.method === 'GET' && path.startsWith('payment_intents/')) {
        assert.ok(intents.has(path.slice('payment_intents/'.length)));
        return jsonResponse(intents.get(path.slice('payment_intents/'.length)));
      }
      if (options.method === 'GET' && path === 'refunds') {
        if (refundReadFailure) { refundReadFailure = false; throw new Error('simulated lost refund-query response'); }
        return jsonResponse({ data: refunds.get(url.searchParams.get('payment_intent')) ?? [], has_more: false });
      }
      if (options.method === 'POST' && ['billing/meter_events', 'billing/meter_event_adjustments'].includes(path)) {
        const key = options.headers['Idempotency-Key'];
        assert.ok(key);
        if (!acceptedMeterRequests.has(key)) acceptedMeterRequests.set(key, path === 'billing/meter_events'
          ? { identifier: params.get('identifier'), created: Math.floor(Date.now() / 1000) }
          : { event_name: params.get('event_name'), type: 'cancel', status: 'pending', cancel: { identifier: params.get('cancel[identifier]') } });
        return jsonResponse(acceptedMeterRequests.get(key));
      }
      assert.fail(`Unexpected isolated Stripe fixture request: ${options.method} ${path}`);
    };
    const payments = load('lib/payments.ts', { '@/lib/studio-pricing': load('lib/studio-pricing.ts'), '@/lib/trial-config': { FREE_TRIAL_DAYS: 30 } });
    const billing = load('lib/order-usage-billing.ts');
    const storage = new Map();
    const cloud = load('app/api/credits/background-removal/route.ts', {
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      sharp: { default: sharp },
      '@aws-sdk/client-s3': { GetObjectCommand: class { constructor(args) { this.args = args; } } },
      '@/lib/credit-maintenance': load('lib/credit-maintenance.ts'),
      '@/lib/dashboard-auth': { createDashboardServiceClient: () => service, resolveDashboardAuth: async () => ({ user: { id: studio }, mfaSatisfied: true }) },
      '@/lib/r2': { hasR2Config: () => true, R2_BUCKET: 'isolated',
        r2Upload: async (key, bytes, mime) => { assert.equal(mime, 'image/png'); storage.set(key, Buffer.from(bytes)); },
        getR2Client: () => ({ send: async command => {
          const stored = storage.get(command.args.Key);
          if (!stored) throw { $metadata: { httpStatusCode: 404 } };
          return { ContentType: 'image/png', ContentLength: stored.length, Body: { transformToByteArray: async () => stored } };
        } }),
      },
      '@/lib/r2-signed-urls': { r2PresignedGetUrl: key => `https://isolated.example.invalid/${key}?signature=fixture` },
    });
    const purchase = async () => payments.createCreditsCheckoutSession({ customerId: 'cus_lifecycle', photographerId: photographer, userId: studio,
      packCode: 'background_credits_250', creditPackageId: packageId, successUrl: 'https://example.invalid/credits?billing=credits_success',
      cancelUrl: 'https://example.invalid/credits?billing=credits_cancel' });
    const cloudRequest = id => ({ headers: new Headers(), formData: async () => {
      const body = new FormData(); body.set('job_id', id);
      body.set('original_sha256', createHash('sha256').update(inputImage).digest('hex'));
      body.set('image_file', new File([inputImage], 'fixture.jpeg', { type: 'image/jpeg' })); return body;
    } });
    const balance = async () => (await payments.getCreditBalanceDetails(service, studio, photographer));
    await run({ db, profile, studio, photographer, packageId, service, rpcCalls, client, payments, billing, purchase, balance,
      cloud, cloudRequest, stripeCalls, intents, refunds, sessions, storage, inputImage, outputImage, acceptedMeterRequests,
      providerCalls: () => providerCalls,
      providerFails: value => { providerFailure = value; },
      failRefundReadOnce: () => { refundReadFailure = true; },
    });
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of changedEnv) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
    await db.close();
  }
}

test('isolated paid checkout → local/cloud spend → cash refunds/debt → monthly expiry keeps one authoritative ledger', () => fixture(async f => {
  const session = await f.purchase();
  assert.deepEqual(session.metadata, f.intents.get(session.payment_intent).metadata, 'Checkout and PaymentIntent must snapshot the same paid offer');
  assert.equal(session.metadata.user_id, f.studio);
  assert.equal(session.metadata.photographer_id, f.photographer);
  assert.equal(session.metadata.credits, '250');
  assert.equal(session.metadata.price_cents, String(session.amount_total));
  assert.equal(session.metadata.currency, 'cad');
  assert.equal(await f.payments.handleCreditPackCheckoutCompleted(f.service, session), null);
  assert.equal((await f.db.query('select count(*)::integer as n from credit_transactions')).rows[0].n, 0);
  const paid = { ...session, payment_status: 'paid' };
  for (const change of [{ amount_total: 1 }, { currency: 'usd' }, { metadata: { ...paid.metadata, user_id: randomUUID() } }]) {
    await assert.rejects(f.payments.handleCreditPackCheckoutCompleted(f.service, { ...paid, ...change }), /credit checkout/);
  }
  f.failRefundReadOnce();
  await assert.rejects(f.payments.handleCreditPackCheckoutCompleted(f.service, paid), /lost refund-query/);
  assert.equal((await f.balance()).balance, 250, 'committed grants must survive an uncertain fulfillment acknowledgement');
  assert.equal((await f.payments.handleCreditPackCheckoutCompleted(f.service, paid)).creditsGranted, 0, 'retry must not grant the pack twice');
  const originalLot = (await f.db.query('select * from credit_lots')).rows[0];
  assert.equal(originalLot.expires_at.getTime(), f.profile.subscription_current_period_end.getTime());

  const localRef = 'local-three-photo-batch';
  const reserveLocal = () => f.client("select deduct_studio_credits(3,'bg_removal_local','photoshop_reservation',null,'Local photos',$1) as ok", [localRef]);
  assert.equal((await reserveLocal()).rows[0].ok, true);
  assert.equal((await reserveLocal()).rows[0].ok, true);
  assert.equal((await f.balance()).balance, 247);
  assert.equal((await f.client("select refund_studio_credits(1,$1,'One failed',null,null) as ok", [localRef])).rows[0].ok, true);
  await f.client("select refund_studio_credits(1,$1,'Replay',null,null)", [localRef]);
  assert.equal((await f.balance()).balance, 248);
  await f.client('select finalize_background_credit_job($1)', [localRef]);
  assert.equal((await f.client("select refund_studio_credits(3,$1,'Forged late refund',null,null) as ok", [localRef])).rows[0].ok, false);

  const success = randomUUID();
  assert.equal((await f.cloud.POST(f.cloudRequest(success))).status, 200);
  assert.equal((await f.cloud.POST(f.cloudRequest(success))).status, 200);
  assert.equal(f.providerCalls(), 1);
  assert.equal(f.storage.size, 1);
  assert.equal((await f.balance()).balance, 244);
  const paidProof = (await f.db.query('select c.receipt_id,c.original_sha256,e.cutout_sha256 from credit_cutout_claims c join credit_cutout_entitlements e on e.claim_id=c.id')).rows;
  assert.equal(paidProof.length, 1, 'successful cloud replay must not mint a second paid photo entitlement');
  assert.equal(paidProof[0].original_sha256, createHash('sha256').update(f.inputImage).digest('hex'));
  assert.equal(paidProof[0].cutout_sha256, createHash('sha256').update(f.outputImage).digest('hex'));
  assert.equal((await f.db.query('select amount from credit_transactions where id=$1', [paidProof[0].receipt_id])).rows[0].amount, -4);
  assert.equal((await f.client('select get_studio_cutout_entitlement($1,$2) as ok', [paidProof[0].original_sha256, paidProof[0].cutout_sha256])).rows[0].ok, true);
  f.providerFails(true);
  const failed = randomUUID();
  assert.equal((await f.cloud.POST(f.cloudRequest(failed))).status, 422);
  assert.equal((await f.cloud.POST(f.cloudRequest(failed))).status, 422);
  assert.equal(f.providerCalls(), 2);
  assert.equal((await f.balance()).balance, 244);
  assert.equal((await f.db.query('select expires_at from credit_lots')).rows[0].expires_at.getTime(), originalLot.expires_at.getTime(),
    'a processing refund must retain the original monthly deadline');

  const interrupted = randomUUID(), token = randomUUID();
  const reservation = await f.service.rpc('reserve_cloud_credit_job', { p_job_id: interrupted, p_studio_id: f.studio, p_photographer_id: f.photographer,
    p_input_sha256: createHash('sha256').update(f.inputImage).digest('hex'), p_output_key: `credits/${f.studio}/${interrupted}.png`, p_token: token });
  assert.equal(reservation.error, null);
  assert.equal(reservation.data[0].claimed, true);
  assert.equal((await f.balance()).balance, 240);
  const partialCents = Math.floor(session.amount_total / 5);
  f.refunds.set(session.payment_intent, [{ id: 're_partial', amount: partialCents, status: 'succeeded' },
    { id: 're_pending', amount: 10, status: 'pending' }, { id: 're_failed', amount: 10, status: 'failed' }]);
  await f.payments.reconcileCreditRefundFromStripe(f.service, session.payment_intent);
  const proportional = Math.floor(250 * partialCents / session.amount_total);
  assert.equal((await f.balance()).balance, 240 - proportional);
  await f.payments.reconcileCreditRefundFromStripe(f.service, session.payment_intent);
  assert.equal((await f.balance()).balance, 240 - proportional);
  await f.payments.handleCreditChargeRefunded(f.service, { payment_intent: session.payment_intent, amount: session.amount_total, amount_refunded: 1 });
  assert.equal((await f.balance()).balance, 240 - proportional, 'older smaller cumulative refund cannot reverse credits again');
  f.refunds.set(session.payment_intent, [{ id: 're_full', amount: session.amount_total, status: 'succeeded' }]);
  await f.payments.reconcileCreditRefundFromStripe(f.service, session.payment_intent);
  assert.deepEqual({ balance: (await f.balance()).balance, debt: (await f.balance()).creditDebt }, { balance: 0, debt: 10 });

  const second = { ...await f.purchase(), payment_status: 'paid' };
  assert.equal((await f.payments.handleCreditPackCheckoutCompleted(f.service, second)).creditsGranted, 250);
  assert.deepEqual({ balance: (await f.balance()).balance, debt: (await f.balance()).creditDebt }, { balance: 240, debt: 0 });
  const finished = await f.service.rpc('finish_cloud_credit_job', { p_job_id: interrupted, p_token: token, p_succeeded: false, p_error: 'Interrupted fixture' });
  assert.equal(finished.error, null); assert.equal(finished.data, true);
  assert.equal((await f.balance()).balance, 244, 'late failed work returns the credits used to repay its already-refunded purchase');
  await f.service.rpc('finish_cloud_credit_job', { p_job_id: interrupted, p_token: token, p_succeeded: false, p_error: 'Replay' });
  await f.payments.handleCreditPackCheckoutCompleted(f.service, paid);
  assert.equal((await f.balance()).balance, 244);
  assert.deepEqual((await f.db.query('select balance,credit_debt,total_purchased,total_used from studio_credits')).rows[0],
    { balance: 244, credit_debt: 0, total_purchased: 500, total_used: 6 });
  assert.equal((await f.db.query("select count(*)::integer as n from credit_transactions where source='purchase'")).rows[0].n, 2);

  // Seed the due monthly boundary locally; do not change a real clock/account.
  await f.db.exec("update credit_lots set expires_at=now()-interval '1 second'");
  const expired = await f.service.rpc('expire_due_credit_accounts', { p_limit: 1 });
  assert.equal(expired.error, null); assert.equal(expired.data, 1);
  assert.equal((await f.service.rpc('expire_due_credit_accounts', { p_limit: 1 })).data, 0);
  assert.equal((await f.balance()).balance, 0);
  assert.equal((await f.cloud.POST(f.cloudRequest(success))).status, 200, 'paid output remains replayable after balance expiry');
  assert.equal(f.providerCalls(), 2);
  assert.equal((await f.db.query("select count(*)::integer as n from credit_transactions where source='expiry'")).rows[0].n, 1);
}));

test('isolated failed cloud work after monthly expiry does not mint a new credit deadline', () => fixture(async f => {
  const paid = { ...await f.purchase(), payment_status: 'paid' };
  await f.payments.handleCreditPackCheckoutCompleted(f.service, paid);
  const id = randomUUID(), token = randomUUID();
  const reservation = await f.service.rpc('reserve_cloud_credit_job', { p_job_id: id, p_studio_id: f.studio, p_photographer_id: f.photographer,
    p_input_sha256: 'a'.repeat(64), p_output_key: `credits/${f.studio}/${id}.png`, p_token: token });
  assert.equal(reservation.error, null);
  await f.db.exec("update credit_lots set expires_at=now()-interval '1 second'");
  const deadline = (await f.db.query('select expires_at from credit_lots')).rows[0].expires_at;
  await f.service.rpc('expire_due_credit_accounts', { p_limit: 100 });
  assert.equal((await f.balance()).balance, 0);
  for (let replay = 0; replay < 2; replay++) {
    const finish = await f.service.rpc('finish_cloud_credit_job', { p_job_id: id, p_token: token, p_succeeded: false, p_error: 'Late failure' });
    assert.equal(finish.error, null); assert.equal(finish.data, true);
  }
  const account = await f.balance();
  assert.equal(account.balance, 0); assert.equal(account.creditDebt, 0); assert.equal(account.expiresAt, null);
  const lot = (await f.db.query('select * from credit_lots')).rows[0];
  assert.equal(lot.expires_at.getTime(), deadline.getTime());
  assert.equal(lot.remaining_credits, 0); assert.equal(lot.expired_credits, 250);
  assert.equal((await f.db.query("select count(*)::integer as n from credit_transactions where source='cloud_processing_refund'")).rows[0].n, 1);
  assert.equal((await f.db.query('select total_used from studio_credits')).rows[0].total_used, 0);
  await assert.rejects(f.client('update studio_credits set balance=100000'), /permission denied/);
  await assert.rejects(f.client('select finish_cloud_credit_job($1,$2,true,null)', [id, token]), /permission denied/);
  const otherUser = randomUUID();
  await assert.rejects(f.client('select * from get_studio_credit_balance($1)', [f.studio], otherUser), /Unauthorized/);
  assert.equal(f.providerCalls(), 0);
}));

test('isolated refund arriving before Checkout fulfillment grants only the unrefunded credits on every retry', () => fixture(async f => {
  const paid = { ...await f.purchase(), payment_status: 'paid' };
  const refundCents = Math.floor(paid.amount_total / 2);
  await assert.rejects(f.payments.handleCreditChargeRefunded(f.service, {
    payment_intent: paid.payment_intent, amount: paid.amount_total, amount_refunded: refundCents,
  }), /purchase not yet recorded/);
  assert.equal((await f.db.query('select count(*)::integer as n from credit_transactions')).rows[0].n, 0);
  f.refunds.set(paid.payment_intent, [{ id: 're_before_checkout', amount: refundCents, status: 'succeeded' },
    { id: 're_pending', amount: paid.amount_total - refundCents, status: 'pending' }]);
  const expected = 250 - Math.floor(250 * refundCents / paid.amount_total);
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await f.payments.handleCreditPackCheckoutCompleted(f.service, paid);
    assert.equal(result.creditsGranted, attempt === 0 ? 250 : 0);
    assert.equal((await f.balance()).balance, expected);
  }
  assert.equal((await f.db.query("select count(*)::integer as n from credit_transactions where source='purchase'")).rows[0].n, 1);
  assert.equal((await f.db.query("select count(*)::integer as n from credit_transactions where source='refund'")).rows[0].n, 1);
  assert.equal((await f.balance()).creditDebt, 0);
}));

test('isolated owner service-fee lifecycle is independent of credit spending and waived once on full order refund', () => fixture(async f => {
  const paid = { ...await f.purchase(), payment_status: 'paid' };
  await f.payments.handleCreditPackCheckoutCompleted(f.service, paid);
  const walletBefore = await f.balance();
  const id = randomUUID();
  await f.db.query("insert into orders(id,photographer_id,paid_at,payment_status,total_cents,is_test) values($1,$2,now()-interval '1 minute','paid',2900,false)", [id, f.photographer]);
  const input = { photographerId: f.photographer, customerId: 'cus_lifecycle', eventName: 'studio_os_core_order_usage', amountCents: 35, currency: 'cad',
    periodStart: f.profile.subscription_current_period_start.toISOString(), periodEnd: f.profile.subscription_current_period_end.toISOString(), billingPeriod: 'fixture-month' };
  await f.billing.syncOrderUsageFees(f.service, input, f.payments.stripeRequest);
  await f.billing.syncOrderUsageFees(f.service, input, f.payments.stripeRequest);
  assert.equal(f.stripeCalls.filter(call => call.path === 'billing/meter_events').length, 1);
  const fee = (await f.db.query('select * from order_usage_fees')).rows[0];
  assert.equal(fee.report_status, 'reported'); assert.equal(fee.amount_cents, 35); assert.equal(fee.currency, 'cad');
  assert.equal(fee.stripe_customer_id, 'cus_lifecycle');
  await f.db.query("update orders set payment_status='partially_refunded',refund_status='partially_refunded' where id=$1", [id]);
  await f.billing.reconcileOrderUsageFeeRefunds(f.service, f.photographer, f.payments.stripeRequest);
  assert.equal(f.stripeCalls.filter(call => call.path === 'billing/meter_event_adjustments').length, 0);
  await f.db.query("update orders set payment_status='refunded',refund_status='refunded' where id=$1", [id]);
  await f.billing.reconcileOrderUsageFeeRefunds(f.service, f.photographer, f.payments.stripeRequest);
  await f.billing.reconcileOrderUsageFeeRefunds(f.service, f.photographer, f.payments.stripeRequest);
  const cancellation = f.stripeCalls.filter(call => call.path === 'billing/meter_event_adjustments');
  assert.equal(cancellation.length, 1);
  assert.equal(cancellation[0].params.get('cancel[identifier]'), fee.event_identifier);
  assert.equal((await f.db.query('select refund_status from order_usage_fees')).rows[0].refund_status, 'completed');
  assert.equal(f.acceptedMeterRequests.size, 2);
  assert.deepEqual(await f.balance(), walletBefore, 'customer-order service fees must not debit or refund the AI credit wallet');
  await assert.rejects(f.client('select * from order_usage_fees'), /permission denied/);
}));
