import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { resolveAuditedPaymentAccount } from '../scripts/verify-payment-release.mjs';

const emptyRequirements=()=>({currently_due:[],eventually_due:[],past_due:[],pending_verification:[],errors:[],disabled_reason:null});
const controller = { fees: { payer: 'account' }, losses: { payments: 'stripe' }, requirement_collection: 'stripe', stripe_dashboard: { type: 'full' } };
const account = (id, type='standard') => ({ id, type, country:'CA', controller, capabilities:{card_payments:'active',transfers:'active'},
  requirements:emptyRequirements(),future_requirements:emptyRequirements(),details_submitted:true,charges_enabled:true,payouts_enabled:true });

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table photographers(id uuid primary key,user_id uuid,business_country text,stripe_connect_country text,
      stripe_account_id text,stripe_connected_account_id text,stripe_connect_onboarding_complete boolean,
      stripe_connect_charges_enabled boolean,stripe_connect_payouts_enabled boolean);
    create table orders(id uuid primary key,photographer_id uuid,order_group_id uuid,total_cents integer,total_amount numeric,
      currency text,status text default 'pending',payment_status text default 'pending',paid_at timestamptz,
      stripe_checkout_session_id text,stripe_payment_intent_id text,platform_fee_collection_method text,
      platform_fee_amount_cents integer,platform_fee_currency text,platform_fee_rate_cents integer);
    grant select,insert,update on photographers,orders to authenticated;
  `);
  for (const file of ['20261013010000_stripe_account_history.sql','20261013011000_stripe_payment_account_attempts.sql']) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  }
  const photographer = randomUUID(), user = randomUUID();
  await db.query("insert into photographers values($1,$2,'CA','CA','acct_old','acct_old',true,true,true,null,0)",[photographer,user]);
  const register = (value,mode=false,owner=photographer,actor=user) => db.query('select register_photographer_stripe_account($1,$2,$3,$4) result',[owner,actor,value,mode]).then(r=>r.rows[0].result);
  await register(account('acct_old','express'));
  await register(account('acct_new'));
  const order = async ({group=null,session=null,intent=null,total=6000,owner=photographer}={}) => {
    const id = randomUUID();
    await db.query("insert into orders(id,photographer_id,order_group_id,total_cents,currency,stripe_checkout_session_id,stripe_payment_intent_id,platform_fee_collection_method,platform_fee_amount_cents,platform_fee_currency,platform_fee_rate_cents) values($1,$2,$3,$4,'cad',$5,$6,'connect_application_fee',35,'cad',35)",[id,owner,group,total,session,intent]);
    return id;
  };
  const activate = (expected='acct_old',mode=false,actor=user) => db.query('select activate_photographer_standard_account($1,$2,$3,$4,$5) result',[photographer,actor,'acct_new',expected,mode]).then(r=>r.rows[0].result);
  const routing = (id=null,expired=null) => db.query('select get_photographer_checkout_routing($1,$2,$3,$4) result',[photographer,'cad',id,expired]).then(r=>r.rows[0].result);
  const reserve = (ids,key,{expected='acct_old',version=0,total=ids.length*6000,hash='request',expired=null}={}) =>
    db.query('select reserve_order_payment_account($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',
      [photographer,ids,ids[0],expected,version,total,'cad',key,hash,expired]).then(r=>r.rows[0].result);
  const resolve = (id,{session=null,intent=null,expected=null,mode=null}={}) =>
    db.query('select resolve_order_payment_account($1,$2,null,$3,$4,$5,$6) account',[photographer,id,session,intent,expected,mode]).then(r=>r.rows[0].account);
  const backfill = (ids,{aid='acct_old',session='cs_old',intent='pi_old',total=ids.length*6000,proof=true}={}) =>
    db.query('select backfill_order_payment_account($1,$2,$3,$4,$5,$6,$7,$8) result',[photographer,ids,aid,session,intent,total,'cad',
      proof?{source:'verified_stripe_get',account_id:aid,photographer_id:photographer,livemode:false}:{}]).then(r=>r.rows[0].result);
  return {db,photographer,user,register,order,activate,routing,reserve,resolve,backfill};
}

test('backfill gates cutover; original Express refunds and delayed returns resolve after Standard activation',async()=>{
  const f=await fixture();
  try {
    const id=await f.order({session:'cs_old',intent:'pi_old'});
    await assert.rejects(()=>f.activate(),/Historical checkouts/);
    await assert.rejects(()=>f.backfill([id],{proof:false}),/evidence/);
    await assert.rejects(()=>f.backfill([id],{aid:'acct_other'}),/original account/);
    await assert.rejects(()=>f.backfill([id],{total:1}),/amount or currency/);
    await f.backfill([id]);
    await assert.rejects(()=>f.activate('acct_old',true),/Live Standard/);
    await assert.rejects(()=>f.activate('acct_old',false,randomUUID()),/ownership/);
    const activated=await f.activate();
    assert.equal(activated.accountId,'acct_new');
    assert.equal(activated.routeVersion,1);
    assert.equal((await f.routing()).feeRateCents,null);
    assert.equal(await f.resolve(id,{session:'cs_old',intent:'pi_old',expected:'acct_old',mode:false}),'acct_old');
    await assert.rejects(()=>f.resolve(id,{expected:'acct_new'}),/account/);
    await assert.rejects(()=>f.resolve(id,{mode:true}),/historical account binding/);
    // A delayed legacy account update must not unset the new merchant's flags.
    await f.db.query('select sync_photographer_stripe_account_history($1,false)',[{...account('acct_old','express'),charges_enabled:false,payouts_enabled:false}]);
    const row=(await f.db.query('select stripe_connected_account_id,stripe_connect_charges_enabled from photographers')).rows[0];
    assert.deepEqual(row,{stripe_connected_account_id:'acct_new',stripe_connect_charges_enabled:true});
    await f.db.query('select deauthorize_photographer_stripe_account($1,false)',['acct_new']);
    await assert.rejects(()=>f.routing(),/historical payment routing|connection/);
    assert.equal(await f.resolve(id,{session:'cs_old'}),'acct_old');
    await assert.rejects(()=>f.db.query('update photographers set stripe_standard_migrated_at=null'),/marker cannot be erased/);
  } finally {await f.db.close();}
});

test('checkout reservations survive cutover and retries; stale generation cannot create a new charge',async()=>{
  const f=await fixture();
  try {
    const id=await f.order();
    const attempt=await f.reserve([id],'stable-key');
    await f.activate();
    const retry=await f.reserve([id],'stable-key',{expected:'acct_new',version:1});
    assert.deepEqual(retry,attempt,'An uncertain request must keep the original account and key');
    const oldRouting=await f.routing(id);
    assert.equal(oldRouting.accountId,'acct_old');assert.equal(oldRouting.routeVersion,0);
    await assert.rejects(()=>f.reserve([id],'stable-key',{hash:'different'}),/immutable request/);
    await assert.rejects(()=>f.reserve([id],'replacement'),/must be reused/);
    await f.db.query('select bind_order_payment_references($1,$2,$3,null,null)',[attempt.attemptId,'cs_original','pi_original']);
    await f.db.query("update orders set stripe_checkout_session_id='cs_original',stripe_payment_intent_id='pi_original' where id=$1",[id]);
    assert.equal(await f.resolve(id,{session:'cs_original',intent:'pi_original'}),'acct_old');
    await assert.rejects(()=>f.db.query('select bind_order_payment_references($1,$2,null,null,null)',[attempt.attemptId,'cs_different']),/immutable/);
    const next=await f.order();
    await assert.rejects(()=>f.reserve([next],'stale-key'),/account changed/);
    const current=await f.reserve([next],'new-key',{expected:'acct_new',version:1});
    assert.equal(current.accountId,'acct_new');
    const counts=(await f.db.query('select count(*)::int n from order_payment_accounts')).rows[0].n;
    assert.equal(counts,2);
    await assert.rejects(()=>f.db.query("update order_payment_accounts set stripe_account_id='acct_other' where id=$1",[attempt.attemptId]),/immutable/);
    await assert.rejects(()=>f.db.query('delete from order_payment_accounts where id=$1',[attempt.attemptId]),/cannot be deleted/);
  } finally {await f.db.close();}
});

test('complete groups, owner/mode uniqueness and zero-cost historical checkout remain protected',async()=>{
  const f=await fixture();
  try {
    const group=randomUUID();
    const ids=[await f.order({group,session:'cs_group',intent:'pi_group'}),await f.order({group,session:'cs_group',intent:'pi_group'})];
    await assert.rejects(()=>f.backfill([ids[0]],{session:'cs_group',intent:'pi_group'}),/complete verified group/);
    await f.backfill(ids,{session:'cs_group',intent:'pi_group'});
    await f.activate();
    assert.equal(await f.resolve(ids[0],{session:'cs_group'}),'acct_old');
    await f.order({group,session:'cs_group',intent:'pi_group'});
    await assert.rejects(()=>f.resolve(ids[0],{session:'cs_group'}),/binding/);
    const other=randomUUID(),user=randomUUID();
    await f.db.query("insert into photographers(id,user_id,business_country,stripe_connect_country) values($1,$2,'CA','CA')",[other,user]);
    await assert.rejects(()=>f.register(account('acct_old','express'),false,other,user),/already assigned/);
    await assert.rejects(()=>f.register(account('acct_old','express'),true),/Live Standard/);
    await f.db.query("insert into photographer_stripe_accounts(photographer_id,stripe_account_id,livemode,account_type,status,country) values($1,'acct_old',true,'express','legacy','CA')",[f.photographer]);
    await assert.rejects(()=>f.db.query('select find_photographer_stripe_account($1,null)',['acct_old']),/environment is ambiguous/);
    const zero=await f.order({total:0,session:'cs_free',intent:null});
    await f.db.query("update orders set platform_fee_collection_method='waived',platform_fee_amount_cents=0,platform_fee_rate_cents=0 where id=$1",[zero]);
    await f.backfill([zero],{total:0,session:'cs_free',intent:null});
    assert.equal(await f.resolve(zero,{session:'cs_free',mode:false}),'acct_old');
  } finally {await f.db.close();}
});

test('rollback changes only future routing and history is inaccessible to browser roles',async()=>{
  const f=await fixture();
  try {
    await f.activate();
    const id=await f.order();const saved=await f.reserve([id],'standard-payment',{expected:'acct_new',version:1});
    await f.db.query('select bind_order_payment_references($1,$2,$3,null,null)',[saved.attemptId,'cs_new','pi_new']);
    await f.db.query("update orders set stripe_checkout_session_id='cs_new',stripe_payment_intent_id='pi_new' where id=$1",[id]);
    await f.db.query('select rollback_photographer_standard_account($1,$2,$3,$4,false)',[f.photographer,f.user,'acct_old','acct_new']);
    assert.equal((await f.routing()).accountId,'acct_old');
    assert.equal(await f.resolve(id,{session:'cs_new'}),'acct_new');
    await assert.rejects(()=>f.db.query('delete from photographer_stripe_accounts'),/cannot be deleted/);
    await f.db.exec('set role authenticated');
    await assert.rejects(()=>f.db.query('select * from photographer_stripe_accounts'),/permission/);
    await assert.rejects(()=>f.activate(),/permission/);
    await assert.rejects(()=>f.db.query('update photographers set stripe_connect_route_version=100'),/Only Studio OS/);
    await assert.rejects(()=>f.db.query('update orders set stripe_payment_account_binding_id=null'),/bindings are managed/);
  } finally {await f.db.close();}
});

test('actual checkout SQL pipeline reserves before the ambiguous marker and rejects an unknown old request',async()=>{
  const f=await fixture();
  try {
    const id=await f.order();
    const routing=await f.routing(id);
    const reservation=await f.reserve([id],'new-request',{expected:routing.accountId,version:routing.routeVersion});
    await f.db.query("update orders set status='checkout_starting' where id=$1",[id]);
    await f.db.query('select bind_order_payment_references($1,$2,null,null,null)',[reservation.attemptId,'cs_started']);
    await f.db.query("update orders set status='payment_pending',stripe_checkout_session_id='cs_started' where id=$1",[id]);
    await f.activate();
    assert.equal(await f.resolve(id,{session:'cs_started'}),'acct_old');
    const ambiguous=await f.order();
    await f.db.query("update orders set status='checkout_starting' where id=$1",[ambiguous]);
    await assert.rejects(()=>f.reserve([ambiguous],'unknown-request',{expected:'acct_new',version:1}),/must be backfilled/);
  } finally {await f.db.close();}
});

test('GET audit uses the stable original-account resolver for legacy, initial-null PI and exact payment scope',async()=>{
  const f=await fixture();
  const calls=[];
  const auditDB=async path=>{
    calls.push(path);
    const url=new URL(path,'http://local.test/');
    assert.equal(url.pathname,'/rpc/resolve_order_payment_account','Audit must reuse exact account isolation rules');
    const q=url.searchParams;
    return (await f.db.query('select resolve_order_payment_account($1,$2,$3,null,$4,null,null) account',
      [q.get('p_photographer_id'),q.get('p_order_id'),q.get('p_order_group_id'),q.get('p_payment_intent_id')])).rows[0].account;
  };
  try {
    const old=await f.order({session:'cs_old',intent:'pi_old'});
    await f.backfill([old]);
    const initial=await f.order();
    const reservation=await f.reserve([initial],'initial-pi-later');
    await f.db.query('select bind_order_payment_references($1,$2,null,null,null)',[reservation.attemptId,'cs_initial']);
    await f.db.query("update orders set stripe_checkout_session_id='cs_initial',stripe_payment_intent_id='pi_later' where id=$1",[initial]);
    const group=randomUUID();
    const members=[await f.order({group,session:'cs_group',intent:'pi_group'}),await f.order({group,session:'cs_group',intent:'pi_group'})];
    await f.backfill(members,{session:'cs_group',intent:'pi_group'});
    await f.activate();
    const order={id:old,photographer_id:f.photographer,stripe_payment_intent_id:'pi_old',order_group_id:null};
    assert.equal(await resolveAuditedPaymentAccount(auditDB,order,false),'acct_old','Feature probe flag must not switch an old payment to Standard');
    assert.equal(await resolveAuditedPaymentAccount(auditDB,{...order,id:initial,stripe_payment_intent_id:'pi_later'},true),'acct_old');
    await assert.rejects(()=>resolveAuditedPaymentAccount(auditDB,{...order,photographer_id:randomUUID()},false),/unavailable|no rows/);
    await assert.rejects(()=>resolveAuditedPaymentAccount(auditDB,{...order,stripe_payment_intent_id:'pi_wrong'},false),/scope/);
    const missing=await f.order({session:'cs_missing',intent:'pi_missing'});
    await assert.rejects(()=>resolveAuditedPaymentAccount(auditDB,{...order,id:missing,stripe_payment_intent_id:'pi_missing'},false),/not been verified/);
    const grouped={...order,id:members[0],order_group_id:group,stripe_payment_intent_id:'pi_group'};
    assert.equal(await resolveAuditedPaymentAccount(auditDB,grouped),'acct_old');
    await f.order({group,session:'cs_group',intent:'pi_group'});
    await assert.rejects(()=>resolveAuditedPaymentAccount(auditDB,grouped),/binding/);
    // Exact group membership and currency/amount remain part of routing proof.
    await f.db.query('update orders set total_cents=6001 where id=$1',[old]);
    await assert.rejects(()=>resolveAuditedPaymentAccount(auditDB,order),/binding/);
    const volatility=(await f.db.query("select provolatile from pg_proc where proname='resolve_order_payment_account'")).rows[0].provolatile;
    assert.equal(volatility,'s','PostgREST GET must use a stable, read-only resolver');
    assert.ok(calls.length>=6);
  } finally {await f.db.close();}
});

test('lost Stripe replies retry their original account only inside the idempotency window',async()=>{
  const f=await fixture();
  try {
    const id=await f.order();
    const original=await f.reserve([id],'lost-reply');
    await f.db.query("update orders set status='checkout_starting' where id=$1",[id]);
    await f.activate();
    const retry=await f.reserve([id],'lost-reply',{expected:'acct_new',version:1});
    assert.equal(retry.accountId,'acct_old');assert.equal(retry.idempotencyKey,original.idempotencyKey);
    await f.db.query('select bind_order_payment_references($1,$2,$3,null,null)',[original.attemptId,'cs_replayed','pi_replayed']);
    // A crash between binding and order update still returns known references;
    // the caller can GET/reuse them without another Stripe creation request.
    const known=await f.reserve([id],'lost-reply',{expected:'acct_new',version:1});
    assert.equal(known.checkoutSessionId,'cs_replayed');assert.equal(known.paymentIntentId,'pi_replayed');
    await f.db.query("update orders set stripe_checkout_session_id='cs_replayed',stripe_payment_intent_id='pi_replayed',status='pending' where id=$1",[id]);
    assert.equal(await f.resolve(id,{session:'cs_replayed',intent:'pi_replayed'}),'acct_old');
    const unresolved=await f.order();
    const saved=await f.reserve([unresolved],'aged-reply',{expected:'acct_new',version:1});
    await f.db.query("update order_payment_accounts set created_at=now()-interval '23 hours' where id=$1",[saved.attemptId]);
    await assert.rejects(()=>f.reserve([unresolved],'aged-reply',{expected:'acct_new',version:1}),/too old to retry safely/);
    assert.equal((await f.db.query('select count(*)::int n from order_payment_accounts')).rows[0].n,2);
  } finally {await f.db.close();}
});

const liveScope={photographer:'ed6b8a99-1f38-48f3-a198-447c49b5ac34',user:'4a9f37fe-d217-4edd-bcf9-3a561da2e2f0',
  platform:'acct_1TBlT4PxlnWeytFA',express:'acct_1TIHTrLqg5vdCgpU',standard:'acct_1UQHR5LZhEC2SlmP'};
const providerProof=aid=>({platformAccountId:liveScope.platform,accountId:aid,livemode:true,verifiedAt:new Date().toISOString()});
async function liveFixture(){
  const f=await fixture();
  await f.db.query("insert into photographers(id,user_id,business_country,stripe_connect_country,stripe_account_id,stripe_connected_account_id,stripe_connect_onboarding_complete,stripe_connect_charges_enabled,stripe_connect_payouts_enabled) values($1,$2,'CA','CA',$3,$3,true,true,true)",[liveScope.photographer,liveScope.user,liveScope.express]);
  const liveAccount=(aid,kind=aid===liveScope.express?'express':'standard')=>({...account(aid,kind),
    metadata:{photographer_id:liveScope.photographer,user_id:liveScope.user},future_requirements:emptyRequirements()});
  const register=(value,proof=providerProof(value.id))=>f.db.query('select register_photographer_stripe_account($1,$2,$3,true,$4)',[liveScope.photographer,liveScope.user,value,proof]);
  const enable=(activationEnabled=true)=>f.db.query("update stripe_standard_live_release_controls set migration_enabled=true,checkout_enabled=true,reservation_required=true,activation_enabled=$1 where release_key='whitephoto-20261015'",[activationEnabled]);
  const activate=(proof=providerProof(liveScope.standard))=>f.db.query('select activate_photographer_standard_account($1,$2,$3,$4,true,$5)',[liveScope.photographer,liveScope.user,liveScope.standard,liveScope.express,proof]);
  const routing=(currency='cad',id=null)=>f.db.query('select get_photographer_checkout_routing($1,$2,$3,null) result',[liveScope.photographer,currency,id]).then(r=>r.rows[0].result);
  return {...f,liveAccount,register,enable,activate,routing};
}

test('live SQL pilot defaults disabled and requires fresh platform/account proof plus secure ownership metadata',async()=>{
  const f=await liveFixture();
  try{
    const settings=(await f.db.query('select migration_enabled,checkout_enabled from stripe_standard_live_release_controls')).rows[0];
    assert.deepEqual(settings,{migration_enabled:false,checkout_enabled:false});
    await assert.rejects(()=>f.register(f.liveAccount(liveScope.express)),/disabled/);
    await f.enable();
    for(const invalid of [
      {...providerProof(liveScope.express),platformAccountId:'acct_wrong'},
      {...providerProof(liveScope.express),accountId:liveScope.standard},
      {...providerProof(liveScope.express),livemode:false},
      {...providerProof(liveScope.express),verifiedAt:new Date(Date.now()-6*60000).toISOString()},
    ])await assert.rejects(()=>f.register(f.liveAccount(liveScope.express),invalid),/proof|stale/);
    await assert.rejects(()=>f.register({...f.liveAccount(liveScope.express),metadata:{}}),/ownership metadata/);
    await assert.rejects(()=>f.register(f.liveAccount('acct_unrelated')),/authorized account pair/);
    await f.register(f.liveAccount(liveScope.express));await f.register(f.liveAccount(liveScope.standard));
    await assert.rejects(()=>f.activate({...providerProof(liveScope.standard),platformAccountId:'acct_wrong'}),/proof/);
    await f.db.query("update photographer_stripe_accounts set verified_at=now()-interval '6 minutes' where stripe_account_id=$1",[liveScope.express]);
    await assert.rejects(()=>f.activate(),/previous account.*freshly verified/);
    await f.register(f.liveAccount(liveScope.express));await f.activate();
    assert.equal((await f.routing()).accountId,liveScope.standard);
    await f.db.exec('set role authenticated');
    await assert.rejects(()=>f.db.query('select * from stripe_standard_live_release_controls'),/permission/);
    await assert.rejects(()=>f.db.query('update stripe_standard_live_release_controls set migration_enabled=true'),/permission/);
    await f.db.exec('reset role');
  }finally{await f.db.close();}
});

test('live routing preserves tier fee snapshots in CAD/USD and leaves unproven currencies on original Express',async()=>{
  const f=await liveFixture();
  try{
    await f.enable();await f.register(f.liveAccount(liveScope.express));await f.register(f.liveAccount(liveScope.standard));await f.activate();
    const saved=[];
    for(const [currency,rate] of [['cad',55],['usd',45],['eur',55]]){
      const id=await f.order({owner:liveScope.photographer});
      await f.db.query('update orders set currency=$2,platform_fee_amount_cents=$3,platform_fee_rate_cents=$3,platform_fee_currency=$2 where id=$1',[id,currency,rate]);
      const routing=await f.routing(currency);assert.equal(routing.feeRateCents,null);
      assert.equal(routing.accountId,currency==='eur'?liveScope.express:liveScope.standard);
      const attempt=(await f.db.query('select reserve_order_payment_account($1,$2,$3,$4,1,6000,$5,$6,$7,null) result',
        [liveScope.photographer,[id],id,routing.accountId,currency,`live-${currency}`,'frozen-request'])).rows[0].result;
      const row=(await f.db.query('select stripe_account_id,fee_snapshot,currency from order_payment_accounts where id=$1',[attempt.attemptId])).rows[0];
      assert.equal(row.currency,currency);assert.equal(row.fee_snapshot[0].platform_fee_rate_cents,rate);assert.equal(row.fee_snapshot[0].platform_fee_amount_cents,rate);
      await f.db.query('select bind_order_payment_references($1,$2,$3,null,null)',[attempt.attemptId,`cs_${currency}`,`pi_${currency}`]);
      await f.db.query('update orders set stripe_checkout_session_id=$2,stripe_payment_intent_id=$3 where id=$1',[id,`cs_${currency}`,`pi_${currency}`]);
      saved.push({id,currency,account:row.stripe_account_id});
    }
    await f.db.query('select rollback_photographer_standard_account($1,$2,$3,$4,true,$5)',
      [liveScope.photographer,liveScope.user,liveScope.express,liveScope.standard,providerProof(liveScope.express)]);
    assert.equal((await f.routing('usd')).accountId,liveScope.express);
    for(const payment of saved){
      const original=(await f.db.query('select resolve_order_payment_account($1,$2,null,$3,$4,null,true) account',
        [liveScope.photographer,payment.id,`cs_${payment.currency}`,`pi_${payment.currency}`])).rows[0].account;
      assert.equal(original,payment.account,'Rollback cannot reassign saved Standard or Express payments');
    }
  }finally{await f.db.close();}
});

test('readiness reacts to transfer, current and future requirement failures before live activation or new routing',async()=>{
  const f=await liveFixture();
  try{
    await f.enable();await f.register(f.liveAccount(liveScope.express));
    for(const invalid of [
      {...f.liveAccount(liveScope.standard),capabilities:{card_payments:'active',transfers:'pending'}},
      {...f.liveAccount(liveScope.standard),requirements:{errors:[{code:'verification_failed'}]}},
      {...f.liveAccount(liveScope.standard),future_requirements:{currently_due:['representative.id_number']}},
      {...f.liveAccount(liveScope.standard),future_requirements:{pending_verification:['representative.id_number']}},
      {...f.liveAccount(liveScope.standard),requirements:undefined},
      {...f.liveAccount(liveScope.standard),requirements:{}},
      {...f.liveAccount(liveScope.standard),future_requirements:undefined},
      {...f.liveAccount(liveScope.standard),future_requirements:{}},
      {...f.liveAccount(liveScope.standard),future_requirements:{...emptyRequirements(),currently_due:'malformed'}},
    ]){
      await f.register(invalid);await assert.rejects(()=>f.activate(),/freshly verified Standard/);
    }
    await f.register(f.liveAccount(liveScope.standard));await f.activate();
    await f.db.query('select sync_photographer_stripe_account_history($1,true)',[
      {...f.liveAccount(liveScope.standard),future_requirements:{currently_due:['representative.id_number']}}]);
    await assert.rejects(()=>f.routing(),/no longer ready/);
  }finally{await f.db.close();}
});

test('additive history supports provider-backed legacy Express retries before registry backfill, never unknown replay',async()=>{
  const f=await fixture();
  try{
    const owner=randomUUID(),user=randomUUID(),aid='acct_preinstall';
    await f.db.query("insert into photographers(id,user_id,business_country,stripe_connect_country,stripe_account_id,stripe_connected_account_id) values($1,$2,'CA','CA',$3,$3)",[owner,user,aid]);
    const old=await f.order({owner,session:'cs_preinstall'});
    const resolved=(await f.db.query('select resolve_order_payment_account($1,$2,null,$3,null,null,true) account',[owner,old,'cs_preinstall'])).rows[0].account;
    assert.equal(resolved,aid,'Existing open-session GETs retain Express with rollout controls disabled');
    const evidence={source:'verified_stripe_get',account_id:aid,photographer_id:owner,livemode:true};
    await assert.rejects(()=>f.db.query('select backfill_order_payment_account($1,$2,$3,$4,null,6000,$5,$6)',[owner,[old],'acct_wrong','cs_preinstall','cad',{...evidence,account_id:'acct_wrong'}]),/original account/);
    const bound=(await f.db.query('select backfill_order_payment_account($1,$2,$3,$4,null,6000,$5,$6) result',[owner,[old],aid,'cs_preinstall','cad',evidence])).rows[0].result;
    assert.equal(bound.accountId,aid);
    const replacement=(await f.db.query('select reserve_order_payment_account($1,$2,$3,$4,0,6000,$5,$6,$7,$8) result',
      [owner,[old],old,aid,'cad','replacement-after-provider-expiration','request','cs_preinstall'])).rows[0].result;
    assert.equal(replacement.accountId,aid);
    const unknown=await f.order({owner});await f.db.query("update orders set status='checkout_starting' where id=$1",[unknown]);
    await assert.rejects(()=>f.db.query('select reserve_order_payment_account($1,$2,$3,$4,0,6000,$5,$6,$7,null)',
      [owner,[unknown],unknown,aid,'cad','unknown-preinstall','request']),/backfilled first/);
    assert.equal((await f.db.query('select count(*)::int n from order_payment_accounts where photographer_id=$1',[owner])).rows[0].n,2);
  }finally{await f.db.close();}
});

test('activation rechecks complete immutable fee scope and stops aged unresolved provider requests',async()=>{
  const f=await fixture();
  try{
    const id=await f.order();const reserved=await f.reserve([id],'before-cutover');
    await f.db.query('update orders set platform_fee_amount_cents=55,platform_fee_rate_cents=55 where id=$1',[id]);
    await assert.rejects(()=>f.activate(),/historical account binding/);
    await f.db.query('update orders set platform_fee_amount_cents=35,platform_fee_rate_cents=35 where id=$1',[id]);
    await f.db.query("update order_payment_accounts set created_at=now()-interval '23 hours' where id=$1",[reserved.attemptId]);
    await assert.rejects(()=>f.activate(),/old unresolved checkout/);
    await f.db.query('select bind_order_payment_references($1,$2,null,null,null)',[reserved.attemptId,'cs_reconciled']);
    await f.db.query("update orders set stripe_checkout_session_id='cs_reconciled' where id=$1",[id]);
    await f.activate();assert.equal((await f.routing()).accountId,'acct_new');
  }finally{await f.db.close();}
});

test('disabled additive schema preserves legacy writes; enabled reservation barrier stops old instances before Stripe POST',async()=>{
  const f=await liveFixture();
  try{
    const legacy=await f.order({owner:liveScope.photographer});
    await f.db.query("update orders set status='checkout_starting' where id=$1",[legacy]);
    await f.db.query("update orders set status='pending' where id=$1",[legacy]);
    await f.db.query("update stripe_standard_live_release_controls set reservation_required=true where release_key='whitephoto-20261015'");
    await assert.rejects(()=>f.db.query("update orders set status='checkout_starting' where id=$1",[legacy]),/must reserve/);
    assert.equal((await f.db.query('select status from orders where id=$1',[legacy])).rows[0].status,'pending');
    // Normal new code reserves before crossing the external request boundary.
    await f.db.query('select reserve_order_payment_account($1,$2,$3,$4,0,6000,$5,$6,$7,null)',
      [liveScope.photographer,[legacy],legacy,liveScope.express,'cad','guarded-before-cutover','exact-frozen-request']);
    await f.db.query("update orders set status='checkout_starting' where id=$1",[legacy]);
    // A request already past the marker when the barrier enabled can still be
    // bound to its provider-verified original history, without authorizing POST.
    await f.db.query("update stripe_standard_live_release_controls set reservation_required=false where release_key='whitephoto-20261015'");
    const inFlight=await f.order({owner:liveScope.photographer,session:'cs_already_starting'});
    await f.db.query("update orders set status='checkout_starting' where id=$1",[inFlight]);
    await f.db.query("update stripe_standard_live_release_controls set reservation_required=true where release_key='whitephoto-20261015'");
    await f.db.query('select backfill_order_payment_account($1,$2,$3,$4,null,6000,$5,$6)',
      [liveScope.photographer,[inFlight],liveScope.express,'cs_already_starting','cad',
        {source:'verified_stripe_get',account_id:liveScope.express,photographer_id:liveScope.photographer,livemode:true}]);
    await assert.rejects(()=>f.db.query("update orders set status='checkout_starting' where id=$1",[inFlight]),/must reserve/);
    // Another photographer retains their original behavior during this pilot.
    const other=await f.order();await f.db.query("update orders set status='checkout_starting' where id=$1",[other]);
    assert.equal((await f.db.query('select status from orders where id=$1',[other])).rows[0].status,'checkout_starting');
  }finally{await f.db.close();}
});


test('read-only schema status proves the actual enabled reservation trigger and denies browser access',async()=>{
  const f=await fixture();
  try{
    const status=()=>f.db.query('select stripe_account_history_schema_status() result').then(r=>r.rows[0].result);
    assert.deepEqual(await status(),{version:'20261015010000',history_schema_present:true,reservation_guard_present:true});
    await f.db.exec('alter table orders disable trigger protect_order_stripe_binding');
    assert.equal((await status()).reservation_guard_present,false);
    await f.db.exec('alter table orders enable trigger protect_order_stripe_binding; set role authenticated');
    await assert.rejects(()=>status(),/permission/);
    await f.db.exec('reset role');
    const volatility=(await f.db.query("select provolatile from pg_proc where proname='stripe_account_history_schema_status'")).rows[0].provolatile;
    assert.equal(volatility,'s');
  }finally{await f.db.close();}
});


test('live preparation can bind verified history while activation stays disabled and Express keeps all future orders',async()=>{
  const f=await liveFixture();
  try{
    assert.equal((await f.db.query('select activation_enabled from stripe_standard_live_release_controls')).rows[0].activation_enabled,false);
    await f.enable(false);await f.register(f.liveAccount(liveScope.express));
    await assert.rejects(()=>f.register({...f.liveAccount(liveScope.standard),metadata:{}}),/ownership metadata/);
    await assert.rejects(()=>f.register({...f.liveAccount(liveScope.standard),metadata:{photographer_id:'other',user_id:liveScope.user}}),/ownership metadata/);
    // The server's adoption handler must first bind and freshly reread the exact
    // candidate. Registering it does not grant permission to select its route.
    await f.register(f.liveAccount(liveScope.standard));
    await assert.rejects(()=>f.activate(),/activation is disabled during preparation/);
    assert.equal((await f.routing('cad')).accountId,liveScope.express);
    assert.equal((await f.routing('usd')).accountId,liveScope.express);
    await f.enable(true);await f.activate();
    await f.db.query("update stripe_standard_live_release_controls set activation_enabled=false where release_key='whitephoto-20261015'");
    assert.equal((await f.routing()).accountId,liveScope.standard,'Disabling future activation cannot erase an already guarded active route');
    await f.db.query('select rollback_photographer_standard_account($1,$2,$3,$4,true,$5)',
      [liveScope.photographer,liveScope.user,liveScope.express,liveScope.standard,providerProof(liveScope.express)]);
    assert.equal((await f.routing()).accountId,liveScope.express,'Rollback remains available while activation is disabled');
  }finally{await f.db.close();}
});

test('a manually changed Standard pointer without the permanent activation marker cannot bypass preparation',async()=>{
  const f=await liveFixture();
  try{
    await f.enable(false);await f.register(f.liveAccount(liveScope.express));await f.register(f.liveAccount(liveScope.standard));
    await f.db.query("update photographer_stripe_accounts set status='legacy' where photographer_id=$1 and status='active'",[liveScope.photographer]);
    await f.db.query("update photographer_stripe_accounts set status='active' where stripe_account_id=$1",[liveScope.standard]);
    await f.db.query('update photographers set stripe_account_id=$2,stripe_connected_account_id=$2 where id=$1',[liveScope.photographer,liveScope.standard]);
    await assert.rejects(()=>f.routing(),/completed guarded activation/);
  }finally{await f.db.close();}
});


test('authenticated maintenance of an existing starting order cannot read private controls or start/rebind a checkout',async()=>{
  const f=await liveFixture();
  try{
    const started=await f.order({owner:liveScope.photographer}),fresh=await f.order({owner:liveScope.photographer});
    await f.db.query("update orders set status='checkout_starting' where id=$1",[started]);
    for(const reservationRequired of [false,true]){
      await f.db.query("update stripe_standard_live_release_controls set reservation_required=$1 where release_key='whitephoto-20261015'",[reservationRequired]);
      await f.db.exec('set role authenticated');
      await f.db.query('update orders set total_cents=total_cents where id=$1',[started]);
      assert.equal((await f.db.query('select status from orders where id=$1',[started])).rows[0].status,'checkout_starting');
      await assert.rejects(()=>f.db.query('update orders set stripe_payment_account_binding_id=$2 where id=$1',[started,randomUUID()]),/bindings are managed/);
      await assert.rejects(()=>f.db.query("update orders set status='checkout_starting' where id=$1",[fresh]),/server payment route/);
      await assert.rejects(()=>f.db.query('select * from stripe_standard_live_release_controls'),/permission/);
      await f.db.exec('reset role');
    }
    // An old server process can contact Stripe; its repeat of the marker must
    // still hit the reservation barrier rather than the maintenance exception.
    await assert.rejects(()=>f.db.query("update orders set status='checkout_starting' where id=$1",[started]),/must reserve/);
  }finally{await f.db.close();}
});
