import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {openStandardSandboxDatabase} from './helpers/standard-sandbox-db.mjs';

const migration='20261015020000_stripe_standard_new_signups.sql';
const platform='acct_sandbox';
const canonical=params=>'{'+Object.keys(params).sort().map(k=>JSON.stringify(k)+':'+JSON.stringify(params[k])).join(',')+'}';
const hash=params=>createHash('sha256').update(canonical(params)).digest('hex');
const requirements=()=>({disabled_reason:null,currently_due:[],eventually_due:[],past_due:[],pending_verification:[],errors:[]});
async function fixture(t,{country='CA',enabled=true,old=false}={}){
  const {db}=await openStandardSandboxDatabase();t.after(()=>db.close());
  await db.exec("alter table photographers add column created_at timestamptz default now(),add column billing_currency text default 'cad';");
  for(const file of ['20261008200000_explicit_stripe_business_country.sql','20261013021000_stripe_standard_creation_intents.sql',migration])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  if(enabled)await db.query("update stripe_standard_signup_release_controls set enabled=true where release_key='standard-signup-v1'");
  const photographer=randomUUID(),owner=randomUUID();
  await db.query("insert into photographers(id,user_id,business_country,billing_currency,created_at) values($1,$2,$3,$4,now()-$5::interval)",[photographer,owner,country,country==='US'?'usd':'cad',old?'1 day':'0 seconds']);
  const params={type:'standard',country,email:'invented@example.test','business_profile[name]':'Invented studio é\n"','metadata[photographer_id]':photographer,'metadata[user_id]':owner,'capabilities[card_payments][requested]':'true','capabilities[transfers][requested]':'true'};
  const reserve=async(p=params,actor=owner,mode=false,plat=platform)=>
    (await db.query('select reserve_photographer_standard_signup($1,$2,$3,$4,$5,$6,$7) value',[photographer,actor,country,mode,plat,p,hash(p)])).rows[0].value;
  const account=(s,{ready=true,id='acct_new',mode=false}={})=>({id,type:'standard',country,livemode:mode,
    metadata:{photographer_id:photographer,user_id:owner,standard_signup_id:s.id},
    controller:{fees:{payer:'account'},losses:{payments:'stripe'},requirement_collection:'stripe',stripe_dashboard:{type:'full'}},
    capabilities:{card_payments:ready?'active':'pending',transfers:ready?'active':'pending'},requirements:requirements(),future_requirements:requirements(),
    charges_enabled:ready,payouts_enabled:ready,details_submitted:ready});
  const record=async(s,a=account(s),{actor=owner,mode=false,plat=platform,verified=new Date().toISOString()}={})=>
    (await db.query('select record_photographer_standard_signup_account($1,$2,$3,$4,$5,$6) value',[s.id,actor,a,plat,mode,verified])).rows[0].value;
  const activate=async(s,a=account(s),{actor=owner,mode=false,plat=platform,verified=new Date().toISOString()}={})=>
    (await db.query('select activate_photographer_standard_signup($1,$2,$3,$4,$5,$6) value',[s.id,actor,a,plat,mode,verified])).rows[0].value;
  const route=async(currency='cad',order=null)=>(await db.query('select get_photographer_checkout_routing($1,$2,$3,null) value',[photographer,currency,order])).rows[0].value;
  const eligibility=async()=>(await db.query('select get_photographer_standard_signup_eligibility($1,$2,false,$3) value',[photographer,owner,platform])).rows[0].value;
  const order=async({fee=55,currency='cad',session=null,intent=null,status='pending'}={})=>{const id=randomUUID();await db.query("insert into orders(id,photographer_id,total_cents,currency,stripe_checkout_session_id,stripe_payment_intent_id,status,platform_fee_collection_method,platform_fee_amount_cents,platform_fee_currency,platform_fee_rate_cents) values($1,$2,3000,$3,$4,$5,$6,'connect_application_fee',$7,$3,$7)",[id,photographer,currency,session,intent,status,fee]);return id;};
  const paymentReserve=async(id,{fee=55,currency='cad',key='checkout-'+id,request='a'.repeat(64)}={})=>(await db.query('select reserve_order_payment_account($1,$2,$3,$4,1,3000,$5,$6,$7,null) value',[photographer,[id],id,'acct_new',currency,key,request])).rows[0].value;
  return{db,photographer,owner,params,reserve,account,record,activate,route,eligibility,order,paymentReserve};
}

test('additive signup schema is default off, service-only and proves its old-instance/history guards',async t=>{
  const f=await fixture(t,{enabled:false});const status=(await f.db.query('select stripe_standard_signup_schema_status() value')).rows[0].value;
  assert.deepEqual(status,{version:'20261015020000',signup_schema_present:true,history_required_guard_present:true,legacy_creation_barrier_present:true,service_only_rpcs:true,service_only_tables:true});
  assert.equal((await f.eligibility()).reason,'creation_disabled');await assert.rejects(f.reserve(),/creation_disabled/);
  for(const role of ['anon','authenticated']){await f.db.exec('set role '+role);for(const table of ['photographer_stripe_standard_signups','stripe_standard_signup_release_controls','stripe_standard_signup_eligible_profiles'])await assert.rejects(f.db.query('select * from '+table),/permission denied/);await assert.rejects(f.reserve(),/permission denied/);await assert.rejects(f.db.query('select stripe_standard_signup_schema_status()'),/permission denied/);await f.db.exec('reset role');}
});

test('concurrent reservation freezes owner/body/hashes/key and initial time; profile edits cannot change retry',async t=>{
  const f=await fixture(t);const [a,b]=await Promise.all([f.reserve(),f.reserve({...f.params,email:'changed@example.test'})]);
  assert.equal(a.id,b.id);assert.deepEqual(a.creation_params,b.creation_params);assert.equal(a.attempted_at,b.attempted_at);assert.equal(a.idempotency_key,'studio-os-standard-signup-'+a.id);
  assert.equal(a.request_hash,hash(a.creation_params));assert.equal(a.provider_request_hash,hash({...a.creation_params,'metadata[standard_signup_id]':a.id}));
  assert.equal((await f.db.query('select count(*)::int n from photographer_stripe_standard_signups')).rows[0].n,1);
  await assert.rejects(f.db.query("update photographer_stripe_standard_signups set request_hash=$1 where id=$2",['b'.repeat(64),a.id]),/immutable/);
  await assert.rejects(f.db.query('delete from photographer_stripe_standard_signups where id=$1',[a.id]),/cannot be deleted/);
  await assert.rejects(f.db.query('update photographers set stripe_account_history_required=false where id=$1',[f.photographer]),/cannot be erased/);
  await assert.rejects(f.db.query("select configure_photographer_payment_profile($1,'CA',null,false,true)",[f.photographer]),/Express account cannot be created/);
});

test('new enrollment rejects foreign owners, wrong platform/mode/body/hash and unknown legacy Express attempts',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.reserve(f.params,randomUUID()),/ownership/);await assert.rejects(f.reserve(f.params,f.owner,true,platform),/platform/);
  await assert.rejects(f.reserve(f.params,f.owner,false,'acct_1TBlT4PxlnWeytFA'),/platform/);
  for(const p of [{...f.params,type:'express'},{...f.params,'metadata[user_id]':randomUUID()},{...f.params,'metadata[photographer_id]':randomUUID()},{...f.params,extra:'unsafe'},{...f.params,'capabilities[transfers][requested]':'false'}])await assert.rejects(f.reserve(p),/parameters/);
  await assert.rejects(f.db.query('select reserve_photographer_standard_signup($1,$2,$3,false,$4,$5,$6)',[f.photographer,f.owner,'CA',platform,f.params,'0'.repeat(64)]),/hash/);
  await f.db.query("update photographers set stripe_connect_country='CA' where id=$1",[f.photographer]);await assert.rejects(f.reserve(),/uncertain_legacy_creation/);
});

test('older profiles require immutable explicit inventory-audited cohort and still cannot hide prior provider references',async t=>{
  const f=await fixture(t,{old:true});await assert.rejects(f.reserve(),/preexisting_profile/);
  await f.db.query("insert into stripe_standard_signup_eligible_profiles(photographer_id,actor_user_id,platform_account_id,livemode,audit_source,provider_inventory_sha256,provider_verified_at) values($1,$2,$3,false,'verified_stripe_account_inventory',$4,now())",[f.photographer,f.owner,platform,'1'.repeat(64)]);
  await assert.rejects(f.db.query("update stripe_standard_signup_eligible_profiles set provider_inventory_sha256=$1",['2'.repeat(64)]),/immutable/);
  await assert.rejects(f.db.query("select configure_photographer_payment_profile($1,'CA',null,false,true)",[f.photographer]),/Express account cannot be created/);
  const id=await f.order({session:'cs_live_original'});await assert.rejects(f.reserve(),/existing_payment_history/);
  await f.db.query('delete from orders where id=$1',[id]);assert.ok((await f.reserve()).id);
});

test('unknown creation older than23h requires reconciliation and cannot silently get a new key',async t=>{
  const f=await fixture(t);const id=randomUUID();await f.db.query("insert into photographer_stripe_standard_signups(id,photographer_id,actor_user_id,platform_account_id,livemode,country,creation_params,request_hash,provider_request_hash,idempotency_key,allowed_currencies,attempted_at) values($1,$2,$3,$4,false,'CA',$5,$6,$7,$8,array['cad','usd'],now()-interval '23 hours')",[id,f.photographer,f.owner,platform,f.params,hash(f.params),hash({...f.params,'metadata[standard_signup_id]':id}),'studio-os-standard-signup-'+id]);
  await f.db.query('update photographers set stripe_account_history_required=true where id=$1',[f.photographer]);await assert.rejects(f.reserve(),/reconciliation_required/);
});

test('pending candidate is durably owned before onboarding, first activation requires readiness and current proof',async t=>{
  const f=await fixture(t);const s=await f.reserve(),pending=f.account(s,{ready:false});await f.record(s,pending);
  assert.equal((await f.db.query('select status from photographer_stripe_accounts')).rows[0].status,'pending');
  assert.equal((await f.db.query('select stripe_connected_account_id from photographers')).rows[0].stripe_connected_account_id,null);
  await assert.rejects(f.activate(s,pending),/verification/);await assert.rejects(f.activate(s,f.account(s),{verified:new Date(Date.now()-301000).toISOString()}),/Fresh owned/);
  const result=await f.activate(s);assert.equal(result.accountId,'acct_new');assert.equal(result.previousAccountId,null);assert.equal(result.routeVersion,1);assert.equal(result.signupIntentId,s.id);
  assert.deepEqual(await f.activate(s),result);const photo=(await f.db.query('select stripe_standard_migrated_at,stripe_account_history_required from photographers')).rows[0];assert.equal(photo.stripe_standard_migrated_at,null);assert.equal(photo.stripe_account_history_required,true);
});

test('account identity/country/mode/controller/owner/intent are immutable and cannot be adopted from another signup',async t=>{
  const f=await fixture(t),s=await f.reserve();for(const mutate of [a=>a.country='US',a=>a.livemode=true,a=>a.metadata.user_id=randomUUID(),a=>a.metadata.standard_signup_id=randomUUID(),a=>a.metadata.photographer_id=randomUUID(),a=>a.controller.fees.payer='application']){const a=f.account(s);mutate(a);await assert.rejects(f.record(s,a),/Fresh owned/);}
  await f.record(s);await assert.rejects(f.record(s,f.account(s,{id:'acct_replacement'})),/immutable/);
  await assert.rejects(f.record(s,f.account(s),{plat:'acct_other'}),/Fresh owned/);
});

test('unknown signed deauthorization tombstones prevent registration and claimed scope cannot be forged',async t=>{
  const f=await fixture(t),s=await f.reserve(),token=randomUUID(),event={id:'evt_deauth',type:'account.application.deauthorized',account:'acct_new',livemode:false,data:{object:{id:'ca_invented'}}};
  await assert.rejects(f.db.query('select claim_stripe_merchant_event($1,$2,false,$3,$4,$5,$6)',[event.id,'acct_foreign',event.type,'a'.repeat(64),event,token]),/scope differs/);
  assert.equal((await f.db.query('select claim_stripe_merchant_event($1,$2,false,$3,$4,$5,$6) value',[event.id,'acct_new',event.type,'a'.repeat(64),event,token])).rows[0].value,'claimed');
  await assert.rejects(f.record(s),/deauthorized/);assert.equal((await f.db.query('select count(*)::int n from photographer_stripe_accounts')).rows[0].n,0);
});

test('deauthorization blocks a registered/active signup even with creation disabled without erasing historical payment scope',async t=>{
  const f=await fixture(t),s=await f.reserve();await f.activate(s);const id=await f.order(),binding=await f.paymentReserve(id);await f.db.query("select bind_order_payment_references($1,'cs_test_saved','pi_saved',null,null)",[binding.attemptId]);await f.db.query("update orders set stripe_checkout_session_id='cs_test_saved',stripe_payment_intent_id='pi_saved' where id=$1",[id]);
  await f.db.query('update stripe_standard_signup_release_controls set enabled=false');await f.db.query("select deauthorize_photographer_stripe_account('acct_new',false)");assert.equal((await f.db.query('select status from photographer_stripe_standard_signups')).rows[0].status,'blocked');await assert.rejects(f.route(),/routing|connection/);
  assert.equal((await f.db.query("select resolve_order_payment_account($1,$2,null,'cs_test_saved','pi_saved','acct_new',false) value",[f.photographer,id])).rows[0].value,'acct_new');
});

test('born Standard checkout origin is persistent, fees55/45 stay frozen, and disable creation never changes current routes',async t=>{
  for(const country of ['CA','US']){const f=await fixture(t,{country}),s=await f.reserve();await f.activate(s);await f.db.query('update stripe_standard_signup_release_controls set enabled=false');
    for(const currency of ['cad','usd']){const r=await f.route(currency);assert.equal(r.origin,'standard_signup');assert.equal(r.signupIntentId,s.id);assert.equal(r.platformAccountId,platform);assert.equal(r.feeRateCents,null);assert.equal(r.historyRequired,true);for(const fee of [55,45]){const id=await f.order({fee,currency});const b=await f.paymentReserve(id,{fee,currency});const row=(await f.db.query('select fee_snapshot from order_payment_accounts where id=$1',[b.attemptId])).rows[0];assert.equal(row.fee_snapshot[0].platform_fee_rate_cents,fee);assert.equal((await f.route(currency,id)).origin,'standard_signup');}}
    await assert.rejects(f.route('eur'),/sales currency/);const id=await f.order();await assert.rejects(f.paymentReserve(id,{request:null}),/request hash/);await assert.rejects(f.db.query("update orders set status='checkout_starting' where id=$1",[id]),/reserve/);
    await assert.rejects(f.db.query('select resolve_order_payment_account($1,$2,null,null,null,null,false)',[f.photographer,id]),/not been verified/);
  }
});

test('missing account registry or foreign existing account cannot be masked as a new Express-compatible profile',async t=>{
  const f=await fixture(t);await f.db.query("update photographers set stripe_account_id='acct_express',stripe_connected_account_id='acct_express' where id=$1",[f.photographer]);await assert.rejects(f.reserve(),/existing_account/);
  const g=await fixture(t),s=await g.reserve();await g.activate(s);await g.db.query("update photographer_stripe_accounts set status='pending' where stripe_account_id='acct_new'");await assert.rejects(g.route(),/history|routing/);
});

test('legacy-instance barrier stops fresh Express creation while preserving reserved Express retries and existing merchants',async t=>{
  const f=await fixture(t);await assert.rejects(f.db.query("select configure_photographer_payment_profile($1,'CA',null,false,true)",[f.photographer]),/Express account cannot be created/);
  await f.db.query("update photographers set stripe_connect_country='CA' where id=$1",[f.photographer]);assert.equal((await f.db.query("select configure_photographer_payment_profile($1,'CA','eur',true,true) value",[f.photographer])).rows[0].value.salesCurrency,'eur');
  await f.db.query("update photographers set stripe_account_id='acct_express',stripe_connected_account_id='acct_express' where id=$1",[f.photographer]);assert.equal((await f.db.query("select configure_photographer_payment_profile($1,'CA','eur',true,true) value",[f.photographer])).rows[0].value.salesCurrency,'eur');
});

test('new signup currency settings reject EUR before any write while original WhitePhoto/Express settings retain EUR',async t=>{
  const f=await fixture(t),s=await f.reserve();await f.activate(s);await assert.rejects(f.db.query("select configure_photographer_payment_profile($1,'CA','eur',true,false)",[f.photographer]),/Canadian dollars or US dollars/);assert.equal((await f.db.query('select billing_currency from photographers')).rows[0].billing_currency,'cad');
  const g=await fixture(t,{old:true});await g.db.query("insert into stripe_standard_signup_eligible_profiles(photographer_id,actor_user_id,platform_account_id,livemode,audit_source,provider_inventory_sha256,provider_verified_at) values($1,$2,$3,false,'verified_stripe_account_inventory',$4,now())",[g.photographer,g.owner,platform,'1'.repeat(64)]);await assert.rejects(g.db.query("select configure_photographer_payment_profile($1,'CA','eur',true,false)",[g.photographer]),/Canadian dollars or US dollars/);
  const h=await fixture(t);await h.db.query("update photographers set billing_currency='eur' where id=$1",[h.photographer]);await assert.rejects(h.reserve(),/unsupported_sales_currency/);
});

test('authenticated clients cannot forge enrollment dates or the permanent history marker',async t=>{
  const f=await fixture(t,{old:true});await f.db.exec('set role authenticated');
  await assert.rejects(f.db.query('update photographers set created_at=now() where id=$1',[f.photographer]),/enrollment date/);
  await assert.rejects(f.db.query('update photographers set stripe_account_history_required=true where id=$1',[f.photographer]),/history is managed/);
  const id=randomUUID();await f.db.query("insert into photographers(id,user_id,created_at) values($1,$2,'2099-01-01')",[id,randomUUID()]);await f.db.exec('reset role');
  const r=(await f.db.query('select created_at<=now() and created_at>now()-interval \'1 minute\' actual from photographers where id=$1',[id])).rows[0];assert.equal(r.actual,true);
});

test('revoked cohort cannot start/retry an unknown account, while table ACL corruption is detected',async t=>{
  const f=await fixture(t,{old:true});await f.db.query("insert into stripe_standard_signup_eligible_profiles(photographer_id,actor_user_id,platform_account_id,livemode,audit_source,provider_inventory_sha256,provider_verified_at) values($1,$2,$3,false,'verified_stripe_account_inventory',$4,now())",[f.photographer,f.owner,platform,'1'.repeat(64)]);await f.reserve();await f.db.query('update stripe_standard_signup_eligible_profiles set revoked_at=now()');await assert.rejects(f.reserve(),/eligibility_revoked/);
  await f.db.exec('grant select on photographer_stripe_standard_signups to authenticated');const s=(await f.db.query('select stripe_standard_signup_schema_status() value')).rows[0].value;assert.equal(s.service_only_tables,false);assert.equal(s.signup_schema_present,false);
});
