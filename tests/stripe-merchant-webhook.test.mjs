import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import * as orderPolicy from '../lib/order-payment-policy.ts';
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../lib/stripe-merchant-webhook.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const migration = readFileSync(new URL('../supabase/migrations/20261013012000_stripe_merchant_event_recovery.sql', import.meta.url), 'utf8');
const paymentsCompiled = ts.transpileModule(readFileSync(new URL('../lib/payments.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const studio = '10000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000001';
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}` : JSON.stringify(value);
const evt = (type, object = { id: 'ch_old', payment_intent: 'pi_old' }, account = 'acct_old', id = 'evt_fixture') => ({
  id, type, ...(account ? { account } : {}), livemode: false, data: { object },
});

async function fixture(t) {
  const previousKey=process.env.STRIPE_SECRET_KEY;process.env.STRIPE_SECRET_KEY='sk_test_merchant_proof_fixture';
  t.after(()=>{if(previousKey===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=previousKey;});
  const db = await PGlite.create(); t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table photographers(id uuid primary key,stripe_standard_migrated_at timestamptz);
    insert into photographers values('${studio}','2026-10-13');`);
  await db.exec(migration);
  const registry = new Map([
    ['acct_old', { photographerId: studio, accountId: 'acct_old', status: 'legacy', livemode: false, migratedAt: '2026-10-13', ready: true }],
    ['acct_new', { photographerId: studio, accountId: 'acct_new', status: 'active', livemode: false, migratedAt: '2026-10-13', ready: true }],
    ['acct_other', { photographerId: other, accountId: 'acct_other', status: 'active', livemode: false, migratedAt: null, ready: true }],
  ]);
  let activeAccount = 'acct_new', ready = true, queueFailure = false, recordFailure = false, finishFailure = false;
  let missingLedger = false, refundPending = false, latestDisputeStatus = 'won', legacyStateFailure=false;
  const unregisteredAccounts=new Set();
  const calls = [], emails = new Map(), disputes = new Map(), paymentOwners = new Map([['pi_old', 'acct_old'], ['pi_new', 'acct_new']]);
  const providerAccounts = new Map([...registry].map(([id]) => [id, { id, object: 'account', country: 'CA',
    charges_enabled: true, payouts_enabled: true, details_submitted: true }]));
  const intentMetadata = { order_id: 'order_old', photographer_id: studio, billing_flow: 'customer_order' };
  const providerPayment={id:'pi_old',status:'succeeded',amount:6000,amount_received:6000,currency:'cad',metadata:intentMetadata};
  const savedOrders=[{id:'order_old',photographer_id:studio,order_group_id:null,total_cents:6000,currency:'cad',
    stripe_payment_intent_id:null,stripe_checkout_session_id:'cs_old',status:'paid',payment_status:'paid',paid_at:'2026-10-13'}];
  const savedSession={id:'cs_old',mode:'payment',status:'complete',payment_status:'paid',payment_intent:'pi_old',amount_total:6000,
    currency:'cad',metadata:{...intentMetadata}};
  const service = {
    async rpc(name, input) {
      if (missingLedger) return { data: null, error: { code: '42883' } };
      if (name === 'claim_stripe_merchant_event') {
        try {
          const r = await db.query(`select claim_stripe_merchant_event($1,$2,$3,$4,$5,$6::jsonb,$7::uuid) as value`,
            [input.p_event_id, input.p_account, input.p_livemode, input.p_event_type, input.p_payload_hash, JSON.stringify(input.p_payload), input.p_token]);
          return { data: r.rows[0].value, error: null };
        } catch (error) { return { data: null, error }; }
      }
      if (name === 'finish_stripe_merchant_event') {
        if (finishFailure) { finishFailure = false; return { data: null, error: new Error('lost finish response') }; }
        const r = await db.query('select finish_stripe_merchant_event($1,$2::uuid,$3) as value', [input.p_event_id, input.p_token, input.p_result]);
        return { data: r.rows[0].value, error: null };
      }
      if(name==='sync_photographer_connect_state'){
        calls.push({action:'legacy-sync',account:input.p_account_id});
        if(legacyStateFailure){legacyStateFailure=false;return {data:null,error:new Error('legacy readiness write interrupted')};}
        assert.equal(input.p_photographer_id,studio);assert.equal(input.p_account_id,activeAccount,'Legacy fallback may only update the original current account');
        ready=input.p_charges_enabled&&input.p_payouts_enabled;return {data:true,error:null};
      }
      assert.fail(`Unexpected RPC ${name}`);
    },
    from(table) {
      if(table==='orders'){
        const predicates=[];const result=single=>({data:structuredClone(single?savedOrders.find(row=>predicates.every(p=>p(row)))??null
          :savedOrders.filter(row=>predicates.every(p=>p(row)))),error:null,count:savedOrders.filter(row=>predicates.every(p=>p(row))).length});
        const query={select(){return this;},eq(key,value){predicates.push(row=>row[key]===value);return this;},
          in(key,values){predicates.push(row=>values.includes(row[key]));return this;},maybeSingle:async()=>result(true),
          then(resolve,reject){return Promise.resolve(result(false)).then(resolve,reject);}};return query;
      }
      if (table === 'stripe_merchant_disputes') return { upsert: async value => { disputes.set(value.dispute_id, value); return { error: null }; } };
      let selectedColumns='';
      const query = { select(columns) { selectedColumns=columns;return this; }, eq(){return this;}, in() { return this; }, lte() { return this; }, order() { return this; }, not() { return this; },
        async limit(limit) {
          if (table === 'photographers') return { data: [...registry.values()].some(r => selectedColumns==='stripe_account_history_required'?r.historyRequired:r.migratedAt)
            ? [{ [selectedColumns]: selectedColumns==='stripe_account_history_required'?true:'2026-10-13' }] : [], error: null };
          assert.equal(table, 'stripe_merchant_events');
          if (missingLedger) return { data: null, error: { code: '42P01' } };
          return { data: (await db.query(`select payload from stripe_merchant_events where status in ('pending','processing')
            and next_attempt_at<=now() order by next_attempt_at limit $1`, [limit])).rows, error: null };
        },
      };
      return query;
    },
  };
  let signupUpdate = null, signupUpdateFailure = false;
  const deps = {
    '@/lib/stripe-standard-signup': { refreshStandardSignupFromAccount: async (_service,input) => {
      calls.push({action:'signup-refresh',...input});
      assert.equal((await db.query('select status from stripe_merchant_events where stripe_account_id=$1 order by created_at desc limit 1',[input.account.id])).rows[0]?.status,'processing','Signup effects must follow the durable event claim');
      if(signupUpdateFailure){signupUpdateFailure=false;throw new Error('signup provider GET interrupted');}
      return signupUpdate || {handled:false,activated:false,account:null};
    } },
    '@/lib/checkout-attempt': { canonicalCheckoutJson: canonical },
    '@/lib/stripe-connect-history': {
      findStripeAccountOwner: async (_service, accountId, { livemode }) => {
        const row = registry.get(accountId); if (row && row.livemode !== livemode) throw new Error('mode mismatch'); return row ?? null;
      },
      isStripeHistorySchemaMissing: error => ['42883', '42P01', '42703', 'PGRST202', 'PGRST205'].includes(error?.code),
      syncStripeAccountHistory: async (_service, { account }) => {
        if(unregisteredAccounts.has(account.id))return false;
        const row = registry.get(account.id); row.ready = account.charges_enabled && account.payouts_enabled;
        if (account.id === activeAccount) ready = row.ready;
        calls.push({ action: 'sync', account: account.id }); return { photographerId: studio, isActive: account.id === activeAccount };
      },
      markStripeAccountDeauthorized: async (_service, { accountId }) => {
        const row=registry.get(accountId);if(row){row.status = 'blocked';row.ready = false;}else assert.equal((await db.query("select status from stripe_merchant_events where stripe_account_id=$1",[accountId])).rows[0]?.status,'processing','Unknown deauthorization must be durable before its effect');
        if (activeAccount === accountId) ready = false; calls.push({ action: 'deauthorized', account: accountId });
      },
      resolveOrderPaymentAccount: async (_service, { photographerId, paymentIntentId, expectedAccount }) => {
        const bound = paymentOwners.get(paymentIntentId);
        if (!bound || (expectedAccount && bound !== expectedAccount) || registry.get(bound).photographerId !== photographerId) throw new Error('immutable payment account differs');
        return bound;
      },
    },
    '@/lib/payments': {
      retrieveStripeAccount: async account => { calls.push({ action: 'get-account', account }); return providerAccounts.get(account); },
      reconcileOrderRefundFromStripe: async (_service, account, payment) => {
        if (payment === 'pi_external') return null;
        assert.equal(paymentOwners.get(payment), account, 'refund must use original payment account');
        calls.push({ action: 'reconcile', account, payment });
        return refundPending ? null : { orderId: 'order_old', photographerId: studio,
          verifiedRefunds: [{ id: 're_old', status: 'succeeded', amount: 6000, currency: 'cad' }] };
      },
      recordStripeEvent: async (_service, event) => {
        calls.push({ action: 'record', id: event.id }); if (recordFailure) { recordFailure = false; throw new Error('lost record acknowledgement'); }
        return { inserted: true };
      },
      stripeRequest: async (path, options = {}) => {
        assert.ok(!options.method || options.method === 'GET', 'merchant webhooks must never move money');
        calls.push({ action: 'provider-get', path, account: options.account });
        if (path === 'application_fees/fee_old') { assert.equal(options.account, undefined); return { id: 'fee_old', account: 'acct_old', charge: 'ch_old', livemode: false }; }
        if (path === 'charges/ch_old') { assert.equal(options.account, 'acct_old'); return { id: 'ch_old', payment_intent: providerPayment.id }; }
        if (path === `payment_intents/${providerPayment.id}`) { assert.equal(options.account, 'acct_old'); return providerPayment; }
        if (['disputes/dp_old','disputes/du_current'].includes(path)) { assert.equal(options.account, 'acct_old'); return { id: path.slice('disputes/'.length), charge: 'ch_old', payment_intent: providerPayment.id,
          livemode: false, amount: 6000, currency: 'cad', status: latestDisputeStatus }; }
        assert.fail(`Unexpected provider GET ${path}`);
      },
    },
    '@/lib/order-refund-notifications': { scheduleOrderRefundEmails: async (_service, input) => {
      if (queueFailure) { queueFailure = false; throw new Error('email outbox unavailable'); }
      input.refunds.forEach(refund => emails.set(`${input.account}:${refund.id}`, input));
    } },
  };
  const proof={};new Function('require','exports','fetch',paymentsCompiled)(name=>name==='@/lib/order-payment-policy'?orderPolicy
    :name==='@/lib/stripe-connect-history'?deps[name]:name==='@/lib/stripe-connect-country'?{verifiedConnectCountry:account=>{assert.equal(account.country,'CA');return 'CA';}}:name.startsWith('@/')?{}:require(name),proof,async(target,options)=>{
      assert.equal(options.method,'GET','shared proof never moves money');assert.equal(options.headers['Stripe-Account'],'acct_old');
      const path=new URL(target).pathname.replace('/v1/','');assert.equal(path,'checkout/sessions/cs_old');
      calls.push({action:'provider-get',path,account:'acct_old'});return{ok:true,text:async()=>JSON.stringify(savedSession)};
    });
  deps['@/lib/payments'].verifySavedOrderPaymentFromStripe=proof.verifySavedOrderPaymentFromStripe;
  deps['@/lib/payments'].syncConnectState=proof.syncConnectState;
  const api = {}; new Function('require', 'exports', compiled)(name => deps[name] ?? require(name), api);
  return { db, api, service, registry, calls, emails, disputes, providerAccounts, paymentOwners, intentMetadata,providerPayment,savedOrders,savedSession,
    get ready() { return ready; }, get activeAccount() { return activeAccount; },
    failQueue() { queueFailure = true; }, failRecord() { recordFailure = true; }, failFinish() { finishFailure = true; },
    missingLedger(value = true) { missingLedger = value; }, pendingRefund(value = true) { refundPending = value; },
    latestDispute(value) { latestDisputeStatus = value; },
    unregisteredExpress(){activeAccount='acct_old';ready=false;unregisteredAccounts.add('acct_old');const row=registry.get('acct_old');row.migratedAt=null;row.status='active';row.ready=false;},
    failLegacyState(){legacyStateFailure=true;},
    signupUpdate(value){signupUpdate=value;},failSignupUpdate(){signupUpdateFailure=true;},
  };
}

test('old Express refund after Standard activation uses original account and acknowledges one completed event', async t => {
  const f = await fixture(t), event = evt('charge.refunded');
  assert.equal((await f.api.processStripeMerchantEvent(f.service, event)).status, 200);
  assert.equal((await f.api.processStripeMerchantEvent(f.service, event)).duplicate, true);
  assert.equal(f.calls.filter(c => c.action === 'reconcile').length, 1); assert.equal(f.emails.size, 1);
  assert.equal(f.calls.find(c => c.action === 'reconcile').account, 'acct_old'); assert.equal(f.activeAccount, 'acct_new');
});

test('refund handler failure leaves durable retry and does not consume the Stripe delivery', async t => {
  const f = await fixture(t), event = evt('refund.updated'); f.failQueue();
  assert.equal((await f.api.processStripeMerchantEvent(f.service, event)).status, 503);
  assert.equal((await f.db.query('select status from stripe_merchant_events')).rows[0].status, 'pending');
  assert.equal((await f.api.processStripeMerchantEvent(f.service, event)).status, 200); assert.equal(f.emails.size, 1);
});

test('lost completion acknowledgement retries idempotent effects and completes its lease', async t => {
  const f = await fixture(t), event = evt('refund.updated'); f.failFinish();
  assert.equal((await f.api.processStripeMerchantEvent(f.service, event)).status, 503);
  assert.equal((await f.api.processStripeMerchantEvent(f.service, event)).status, 200); assert.equal(f.emails.size, 1);
  assert.equal((await f.db.query('select status from stripe_merchant_events')).rows[0].status, 'processed');
});

test('recording failure after effects cannot permanently swallow a processed refund', async t => {
  const f = await fixture(t), event = evt('charge.refunded'); f.failRecord();
  assert.equal((await f.api.processStripeMerchantEvent(f.service, event)).status, 503);
  assert.equal((await f.api.processStripeMerchantEvent(f.service, event)).status, 200); assert.equal(f.emails.size, 1);
});

test('process termination lease is recovered from its stored signed payload after expiry', async t => {
  const f = await fixture(t), event = evt('refund.updated');
  const hash = require('node:crypto').createHash('sha256').update(canonical(event)).digest('hex');
  await f.service.rpc('claim_stripe_merchant_event', { p_event_id: event.id, p_account: event.account, p_livemode: false,
    p_event_type: event.type, p_payload_hash: hash, p_payload: event, p_token: '30000000-0000-4000-8000-000000000001' });
  assert.equal((await f.api.processStripeMerchantEvent(f.service, event)).status, 503, 'active lease prevents parallel effects');
  assert.equal(f.calls.length, 0);
  await f.db.exec("update stripe_merchant_events set lease_until=now()-interval '1 minute',next_attempt_at=now()-interval '1 minute'");
  const recovered = await f.api.recoverStripeMerchantEvents(f.service);
  assert.equal(recovered.recovered, 1); assert.equal(f.emails.size, 1);
});

test('historical account update reads current provider state without overwriting active Standard readiness', async t => {
  const f = await fixture(t); f.providerAccounts.get('acct_old').charges_enabled = false;
  assert.equal((await f.api.processStripeMerchantEvent(f.service, evt('account.updated', { id: 'acct_old', charges_enabled: true }))).status, 200);
  assert.equal(f.registry.get('acct_old').ready, false); assert.equal(f.ready, true); assert.equal(f.activeAccount, 'acct_new');
  assert.equal(f.calls.filter(call=>call.action==='legacy-sync').length,0,'A historical update must never fall back to current-pointer mutation');
});

test('deauthorization blocks only its account, retains immutable payment history and cannot be undone by late update', async t => {
  const f = await fixture(t);
  assert.equal((await f.api.processStripeMerchantEvent(f.service, evt('account.application.deauthorized', { id: 'ca_app' }))).status, 200);
  assert.equal(f.ready, true); assert.equal(f.registry.get('acct_old').status, 'blocked'); assert.equal(f.paymentOwners.get('pi_old'), 'acct_old');
  assert.equal((await f.api.processStripeMerchantEvent(f.service, evt('account.updated', { id: 'acct_old' }, 'acct_old', 'evt_late'))).status, 200);
  assert.equal(f.calls.filter(c => c.action === 'get-account').length, 0);
  assert.equal((await f.api.processStripeMerchantEvent(f.service, evt('account.application.deauthorized', { id: 'ca_app' }, 'acct_new', 'evt_revoke'))).status, 200);
  assert.equal(f.ready, false); assert.equal(f.paymentOwners.get('pi_new'), 'acct_new');
});

test('metadata cannot route another studio payment through a registered account', async t => {
  const f = await fixture(t);
  const result = await f.api.processStripeMerchantEvent(f.service, evt('refund.updated', { id: 're_fake', payment_intent: 'pi_old',
    metadata: { photographer_id: other } }, 'acct_other'));
  assert.equal(result.ok, false); assert.equal(f.emails.size, 0); assert.equal(f.calls.filter(c => c.action === 'reconcile').length, 0);
});

test('wrong envelope scope and missing live-mode proof fail before any claim or provider action', async t => {
  const f = await fixture(t);
  assert.equal((await f.api.processStripeMerchantEvent(f.service, evt('account.updated', { id: 'acct_new' }, 'acct_old'))).status, 400);
  assert.equal((await f.api.processStripeMerchantEvent(f.service, evt('application_fee.refunded', { id: 'fee_old' }))).status, 400);
  const noMode = evt('refund.updated'); delete noMode.livemode;
  assert.equal((await f.api.processStripeMerchantEvent(f.service, noMode)).status, 400);
  assert.equal(f.calls.length, 0); assert.equal((await f.db.query('select count(*) as count from stripe_merchant_events')).rows[0].count, 0);
});

test('platform application-fee refund verifies its platform fee then reconciles the original connected customer payment', async t => {
  const f = await fixture(t);
  assert.equal((await f.api.processStripeMerchantEvent(f.service, evt('application_fee.refunded', { id: 'fee_old' }, null))).status, 200);
  assert.deepEqual(f.calls.filter(c => c.action === 'provider-get').map(c => [c.path, c.account]),
    [['application_fees/fee_old', undefined], ['charges/ch_old', 'acct_old'], ['payment_intents/pi_old', 'acct_old'],['checkout/sessions/cs_old','acct_old']]);
  assert.equal(f.calls.find(c => c.action === 'reconcile').account, 'acct_old'); assert.equal(f.emails.size, 1);
});

test('dispute stores latest verified status for old account without moving money or changing its active account', async t => {
  const f = await fixture(t);
  assert.equal((await f.api.processStripeMerchantEvent(f.service, evt('charge.dispute.created', { id: 'dp_old', status: 'needs_response' }))).status, 200);
  const row = f.disputes.get('dp_old'); assert.equal(row.status, 'won'); assert.equal(row.stripe_account_id, 'acct_old');
  assert.equal(row.payment_intent_id, 'pi_old'); assert.equal(row.photographer_id, studio); assert.equal(f.ready, true); assert.equal(f.emails.size, 0);
});

test('current Stripe du dispute IDs require original-account provider and immutable payment proof', async t => {
  const f=await fixture(t);
  const result=await f.api.processStripeMerchantEvent(f.service,evt('charge.dispute.created',{id:'du_current',status:'needs_response'}));
  assert.equal(result.status,200);assert.equal(result.ok,true);
  const row=f.disputes.get('du_current');
  assert.equal(row.dispute_id,'du_current');assert.equal(row.status,'won');assert.equal(row.stripe_account_id,'acct_old');
  assert.equal(row.payment_intent_id,'pi_old');assert.equal(row.photographer_id,studio);
  assert.ok(f.calls.some(call=>call.action==='provider-get'&&call.path==='disputes/du_current'&&call.account==='acct_old'));
  assert.ok(f.calls.some(call=>call.action==='provider-get'&&call.path==='checkout/sessions/cs_old'&&call.account==='acct_old'));
  assert.equal(f.activeAccount,'acct_new');
  f.paymentOwners.set('pi_old','acct_new');
  const forged=await f.api.processStripeMerchantEvent(f.service,evt('charge.dispute.updated',{id:'du_current'},'acct_old','evt_du_forged_ownership'));
  assert.equal(forged.ok,false);assert.equal(forged.status,503);assert.equal(f.disputes.size,1);
});

test('a dispute whose charge does not match immutable payment ownership cannot create a record', async t => {
  const f = await fixture(t); f.paymentOwners.set('pi_old', 'acct_other');
  assert.equal((await f.api.processStripeMerchantEvent(f.service, evt('charge.dispute.created', { id: 'dp_old' }))).ok, false);
  assert.equal(f.disputes.size, 0);
});

test('copied order metadata on an unrelated charge cannot create a dispute when the initial attempt has no PI yet',async t=>{
  const f=await fixture(t);f.providerPayment.id='pi_forged';f.paymentOwners.set('pi_forged','acct_old');
  assert.equal(f.savedOrders[0].stripe_payment_intent_id,null);
  assert.equal((await f.api.processStripeMerchantEvent(f.service,evt('charge.dispute.created',{id:'dp_old'}))).ok,false);
  assert.equal(f.disputes.size,0);assert.equal(f.emails.size,0);assert.equal(f.savedSession.payment_intent,'pi_old');
});

test('Standard payments outside Studio OS are acknowledged without order changes or orphan retries', async t => {
  const f = await fixture(t); delete f.intentMetadata.order_id;
  const dispute = await f.api.processStripeMerchantEvent(f.service, evt('charge.dispute.created', { id: 'dp_old' }));
  assert.equal(dispute.ignored, true); assert.equal(f.disputes.size, 0);
  assert.equal((await f.api.processStripeMerchantEvent(f.service, evt('refund.updated', { id: 're_external', payment_intent: 'pi_external' }, 'acct_old', 'evt_external'))).status, 200);
  assert.equal(f.emails.size, 0); assert.ok((await f.db.query('select status from stripe_merchant_events')).rows.every(row => row.status === 'processed'));
});

test('missing recovery schema allows unmigrated legacy path but fails closed after cutover', async t => {
  const f = await fixture(t); f.missingLedger();
  await assert.rejects(f.api.processStripeMerchantEvent(f.service, evt('refund.updated')), e => e.code === '42883');
  await assert.rejects(f.api.recoverStripeMerchantEvents(f.service), e => e.code === '42P01');
  for (const row of f.registry.values()) row.migratedAt = null;
  assert.equal(await f.api.processStripeMerchantEvent(f.service, evt('refund.updated')), null);
  assert.equal((await f.api.recoverStripeMerchantEvents(f.service)).schemaMissing, true);
});

test('born-Standard merchant recovery cannot hide missing history when new-account creation is off and no pilot migration exists',async t=>{
  const f=await fixture(t);f.missingLedger();for(const row of f.registry.values())row.migratedAt=null;
  f.registry.get('acct_new').historyRequired=true;
  const previous=process.env.STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED;process.env.STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED='false';
  t.after(()=>{if(previous===undefined)delete process.env.STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED;else process.env.STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED=previous;});
  await assert.rejects(f.api.recoverStripeMerchantEvents(f.service),e=>e.code==='42P01');
  assert.equal(f.calls.length,0);
});

test('turning new onboarding off does not disable historical refund recovery', async t => {
  const f = await fixture(t); const previous = process.env.STRIPE_STANDARD_MIGRATION_ENABLED;
  process.env.STRIPE_STANDARD_MIGRATION_ENABLED = 'false'; t.after(() => {
    if (previous === undefined) delete process.env.STRIPE_STANDARD_MIGRATION_ENABLED; else process.env.STRIPE_STANDARD_MIGRATION_ENABLED = previous;
  });
  assert.equal((await f.api.processStripeMerchantEvent(f.service, evt('refund.updated'))).status, 200); assert.equal(f.emails.size, 1);
});

test('pending customer/platform refund balances do not generate successful refund mail', async t => {
  const f = await fixture(t); f.pendingRefund();
  assert.equal((await f.api.processStripeMerchantEvent(f.service, evt('refund.updated'))).status, 200); assert.equal(f.emails.size, 0);
});

test('event ID reuse with a different owner or payload fails closed', async t => {
  const f = await fixture(t); assert.equal((await f.api.processStripeMerchantEvent(f.service, evt('refund.updated'))).status, 200);
  await assert.rejects(f.api.processStripeMerchantEvent(f.service, evt('refund.failed')), /identity changed/);
  assert.equal(f.calls.filter(c => c.action === 'reconcile').length, 1);
});

test('merchant ledger and dispute tables/RPCs are inaccessible to authenticated clients', async t => {
  const f = await fixture(t); await f.db.exec('set role authenticated');
  await assert.rejects(f.db.query('select * from stripe_merchant_events'), /permission denied/);
  await assert.rejects(f.db.query('select * from stripe_merchant_disputes'), /permission denied/);
  await assert.rejects(f.db.query("select finish_stripe_merchant_event('evt_fixture','30000000-0000-4000-8000-000000000001','processed')"), /permission denied/);
});

test('verified dispute updates preserve ownership and decision ordering while accepting Stripe late wins', async t => {
  const f = await fixture(t);
  await f.db.query(`insert into stripe_merchant_disputes(stripe_account_id,dispute_id,photographer_id,payment_intent_id,charge_id,
    livemode,status,amount_cents,currency,observed_at,verified_at) values('acct_old','dp_old',$1,'pi_old','ch_old',false,
    'under_review',6000,'cad','2026-10-13T12:00:00Z','2026-10-13T12:00:01Z')`, [studio]);
  await f.db.exec("update stripe_merchant_disputes set status='needs_response',observed_at='2026-10-13T11:59:00Z'");
  assert.equal((await f.db.query('select status from stripe_merchant_disputes')).rows[0].status, 'under_review');
  await f.db.exec("update stripe_merchant_disputes set status='lost',observed_at='2026-10-13T12:01:00Z'");
  await f.db.exec("update stripe_merchant_disputes set status='needs_response',observed_at='2026-10-13T12:02:00Z'");
  assert.equal((await f.db.query('select status from stripe_merchant_disputes')).rows[0].status, 'lost');
  await f.db.exec("update stripe_merchant_disputes set status='won',observed_at='2026-10-13T12:03:00Z'");
  assert.equal((await f.db.query('select status from stripe_merchant_disputes')).rows[0].status, 'won');
  await assert.rejects(f.db.exec("update stripe_merchant_disputes set payment_intent_id='pi_other'"), /ownership is immutable/);
});

test('recovery endpoint authenticates before creating a service client or processing events', async () => {
  const code = ts.transpileModule(readFileSync(new URL('../app/api/cron/stripe-merchant-event-recovery/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const api = {}; let calls = 0; const old = process.env.CRON_SECRET; process.env.CRON_SECRET = 'local-test-cron';
  const deps = { 'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => { calls++; return {}; } },
    '@/lib/stripe-merchant-webhook': { recoverStripeMerchantEvents: async (_service, limit) => { assert.equal(limit, 25); return { checked: 1, recovered: 1, retry: 0 }; } },
  };
  new Function('require', 'exports', code)(name => deps[name] ?? {}, api);
  try {
    assert.equal((await api.GET({ headers: new Headers() })).status, 401); assert.equal(calls, 0);
    assert.equal((await api.GET({ headers: new Headers({ authorization: 'Bearer local-test-cron' }) })).status, 200); assert.equal(calls, 1);
  } finally { if (old === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = old; }
});

test('signed HTTP refund delivery delegates to durable historical processing and advertises retry after a failure', async t => {
  const f = await fixture(t); f.failQueue();
  const code = ts.transpileModule(readFileSync(new URL('../app/api/stripe/webhook/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const api = {}; let serviceCalls = 0; const previous = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = 'local-merchant-signature';
  t.after(() => { if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = previous; });
  const deps = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => { serviceCalls++; return f.service; } },
    '@/lib/credit-maintenance': { pausePlatformCreditEvent: () => false },
    '@/lib/customer-order-webhook': { isCustomerOrderStripeEvent: () => false },
    '@/lib/stripe-merchant-webhook': f.api,
    '@/lib/payments': { verifyStripeSignature: async (_raw, signature) => signature === 'fixture-valid' },
  };
  new Function('require', 'exports', code)(name => deps[name] ?? {}, api);
  const request = signature => ({ headers: new Headers({ 'stripe-signature': signature }), text: async () => JSON.stringify(evt('charge.refunded')) });
  assert.equal((await api.POST(request('wrong'))).status, 400); assert.equal(serviceCalls, 0);
  const failed = await api.POST(request('fixture-valid'));
  assert.equal(failed.status, 503); assert.equal(failed.headers.get('Retry-After'), '60'); assert.equal(f.emails.size, 0);
  assert.equal((await api.POST(request('fixture-valid'))).status, 200); assert.equal(f.emails.size, 1);
  assert.equal((await api.POST(request('fixture-valid'))).status, 200);
  assert.equal(f.calls.filter(c => c.action === 'reconcile').length, 2, 'one failed attempt and one completion, then duplicate acknowledgement');
});


test('installed merchant ledger updates unregistered Express readiness with migration flags off',async t=>{
  const f=await fixture(t);f.unregisteredExpress();
  const previous=process.env.STRIPE_STANDARD_MIGRATION_ENABLED;process.env.STRIPE_STANDARD_MIGRATION_ENABLED='false';
  t.after(()=>{if(previous===undefined)delete process.env.STRIPE_STANDARD_MIGRATION_ENABLED;else process.env.STRIPE_STANDARD_MIGRATION_ENABLED=previous;});
  assert.equal(f.ready,false);
  const result=await f.api.processStripeMerchantEvent(f.service,evt('account.updated',{id:'acct_old',charges_enabled:false}));
  assert.equal(result.status,200);assert.equal(f.ready,true,'Fresh provider readiness must update the current legacy photographer');
  assert.equal(f.activeAccount,'acct_old');assert.equal(f.calls.filter(call=>call.action==='legacy-sync').length,1);
  assert.equal((await f.db.query('select status from stripe_merchant_events')).rows[0].status,'processed');
});

test('failed original Express readiness update keeps the merchant event retryable until effects succeed',async t=>{
  const f=await fixture(t);f.unregisteredExpress();f.failLegacyState();
  const event=evt('account.updated',{id:'acct_old'});
  assert.equal((await f.api.processStripeMerchantEvent(f.service,event)).status,503);assert.equal(f.ready,false);
  assert.equal((await f.db.query('select status from stripe_merchant_events')).rows[0].status,'pending');
  assert.equal(f.calls.filter(call=>call.action==='record').length,0);
  assert.equal((await f.api.processStripeMerchantEvent(f.service,event)).status,200);assert.equal(f.ready,true);
  assert.equal((await f.db.query('select status from stripe_merchant_events')).rows[0].status,'processed');
});


test('an unrelated Standard charge with a generic order_id is ignored before Studio order proof or mutation',async t=>{
  const f=await fixture(t);f.intentMetadata.order_id='external-cart-123';f.intentMetadata.billing_flow='other_checkout';delete f.intentMetadata.photographer_id;
  const result=await f.api.processStripeMerchantEvent(f.service,evt('charge.dispute.created',{id:'dp_old'}));
  assert.equal(result.status,200);assert.equal(result.ignored,true);assert.equal(f.disputes.size,0);assert.equal(f.emails.size,0);
  assert.equal(f.calls.filter(call=>call.action==='provider-get'&&call.path.startsWith('checkout/sessions/')).length,0);
  assert.equal((await f.db.query('select status from stripe_merchant_events')).rows[0].status,'processed');
});

test('signed deauthorization racing account registration is durably retained before an owner exists',async t=>{const f=await fixture(t),event=evt('account.application.deauthorized',{id:'ca_app'},'acct_notYetRegistered','evt_unregistered_deauth');const result=await f.api.processStripeMerchantEvent(f.service,event);assert.equal(result.status,200);const row=(await f.db.query('select * from stripe_merchant_events where event_id=$1',[event.id])).rows[0];assert.equal(row.stripe_account_id,event.account);assert.equal(row.event_type,'account.application.deauthorized');assert.equal(row.status,'processed');assert.deepEqual(row.payload,event);assert.equal(row.attempts,1);assert.equal(f.calls.filter(call=>call.action==='deauthorized').length,1);assert.equal(f.activeAccount,'acct_new');assert.equal((await f.api.processStripeMerchantEvent(f.service,event)).duplicate,true);assert.equal(f.calls.filter(call=>call.action==='deauthorized').length,1);});
test('unknown deauthorization cannot be acknowledged when its durable inbox is absent',async t=>{const f=await fixture(t);f.missingLedger();await assert.rejects(f.api.processStripeMerchantEvent(f.service,evt('account.application.deauthorized',{id:'ca_app'},'acct_notYetRegistered','evt_missing_deauth')));assert.equal(f.calls.some(call=>call.action==='deauthorized'),false);assert.equal(f.activeAccount,'acct_new');});

test('first owned Standard account.updated reaches signup first-activation only after the durable claim',async t=>{const f=await fixture(t);f.signupUpdate({handled:true,activated:true,account:{id:'acct_pendingSignup'}});const event=evt('account.updated',{id:'acct_pendingSignup',charges_enabled:false},'acct_pendingSignup','evt_signup_first');const result=await f.api.processStripeMerchantEvent(f.service,event);assert.equal(result.status,200);assert.equal(f.calls.filter(c=>c.action==='signup-refresh').length,1);assert.equal(f.calls.filter(c=>c.action==='get-account'||c.action==='legacy-sync').length,0);assert.equal((await f.db.query('select status from stripe_merchant_events where event_id=$1',[event.id])).rows[0].status,'processed');assert.equal(f.activeAccount,'acct_new');});
test('signup account.updated provider failure stays retryable and unrelated updates cannot create account mappings',async t=>{const f=await fixture(t);f.failSignupUpdate();const event=evt('account.updated',{id:'acct_pendingSignup'},'acct_pendingSignup','evt_signup_retry');assert.equal((await f.api.processStripeMerchantEvent(f.service,event)).status,503);assert.equal((await f.db.query('select status from stripe_merchant_events where event_id=$1',[event.id])).rows[0].status,'pending');f.signupUpdate({handled:true,activated:false,account:{id:'acct_pendingSignup'}});assert.equal((await f.api.processStripeMerchantEvent(f.service,event)).status,200);f.signupUpdate({handled:false,activated:false,account:null});const external=await f.api.processStripeMerchantEvent(f.service,evt('account.updated',{id:'acct_unrelated'},'acct_unrelated','evt_unrelated_signup'));assert.equal(external.ignored,true);assert.equal(f.calls.filter(c=>c.action==='legacy-sync').length,0);assert.equal(f.activeAccount,'acct_new');});
