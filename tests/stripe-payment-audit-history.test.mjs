import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAuditedPaymentAccount, verifyPaymentRelease, WHITEPHOTO_STANDARD_AUDIT_SCOPE,verifyStandardWebhookDestinations,
  STANDARD_CONNECT_WEBHOOK_EVENTS,STANDARD_PLATFORM_WEBHOOK_EVENTS } from '../scripts/verify-payment-release.mjs';

const order={id:'11111111-1111-4111-8111-111111111111',photographer_id:'22222222-2222-4222-8222-222222222222',stripe_payment_intent_id:'pi_old'};
const error=code=>Object.assign(new Error('Database verification failed; details withheld.'),{code});
const legacy={stripe_connected_account_id:'acct_old',stripe_standard_migrated_at:null};

test('audit resolver refuses ambiguous/migrated missing history regardless optional probe flag',async()=>{
  for(const historyRequired of [false,true]){
    assert.equal(await resolveAuditedPaymentAccount(async path=>{assert.ok(path.startsWith('rpc/resolve_order_payment_account?'));return 'acct_old';},order,historyRequired),'acct_old');
    await assert.rejects(()=>resolveAuditedPaymentAccount(async path=>{
      if(path.startsWith('rpc/'))throw error('PGRST202');
      return [{...legacy,stripe_standard_migrated_at:'2026-10-13'}];
    },order,historyRequired),/history schema is unavailable|verified original account/);
  }
});
test('audit compatibility requires known schema absence and an explicitly unmigrated owner',async()=>{
  const calls=[];
  assert.equal(await resolveAuditedPaymentAccount(async path=>{calls.push(path);if(path.startsWith('rpc/'))throw error('PGRST202');return [legacy];},order),'acct_old');
  assert.ok(calls[1].includes('stripe_standard_migrated_at'));
  assert.equal(await resolveAuditedPaymentAccount(async path=>{
    if(path.startsWith('rpc/'))throw error('42883');
    if(path.includes('stripe_standard_migrated_at'))throw error('42703');
    return [legacy];
  },order),'acct_old');
  let queriedOwner=false;
  await assert.rejects(()=>resolveAuditedPaymentAccount(async path=>{
    if(path.startsWith('rpc/'))throw error('42501');queriedOwner=true;return [legacy];
  },order));
  assert.equal(queriedOwner,false,'Provider/database outage must never route through current pointer');
  await assert.rejects(()=>resolveAuditedPaymentAccount(async path=>path.startsWith('rpc/')?null:[legacy],order),/cannot be verified/);
});
test('release GET failures expose only known schema codes without logging provider bodies',async()=>{
  const env={STUDIO_PAYMENT_RELEASE_VERIFY:'1',STRIPE_SECRET_KEY:'sk_live_fake',SUPABASE_SERVICE_ROLE_KEY:'service-test',
    NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',STUDIO_PAYMENT_EXPECTED_PROJECT_REF:'example',STUDIO_PAYMENT_EXPECTED_APP_URL:'https://example.test'};
  const endpoint={url:'https://example.test/api/stripe/webhook',status:'enabled',livemode:true,enabled_events:['*']};
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});assert.equal(options.method,'GET');
    if(url.includes('checkout_attempts'))return {ok:false,status:400,json:async()=>({code:'42703',message:'secret-sensitive-provider-body'})};
    return {ok:true,json:async()=>url.endsWith('/account')?{id:'acct_platform'}:url.includes('webhook_endpoints')?{data:[endpoint]}:[]};
  };
  const logs=[];
  await assert.rejects(()=>verifyPaymentRelease(env,fetcher,line=>logs.push(line)),e=>e.code==='42703'&&!e.message.includes('secret-sensitive'));
  assert.ok(!logs.join('').includes('secret-sensitive'));
});


const scope=WHITEPHOTO_STANDARD_AUDIT_SCOPE;
const emptyRequirements=()=>({currently_due:[],eventually_due:[],past_due:[],pending_verification:[],errors:[],disabled_reason:null});
const destination=(eventsFrom,enabledEvents,id)=>({id,object:'v2.core.event_destination',type:'webhook_endpoint',livemode:true,status:'enabled',event_payload:'snapshot',
  events_from:eventsFrom,enabled_events:enabledEvents,webhook_endpoint:{url:'https://www.studiooscloud.com/api/stripe/webhook'}});
const completeDestinations=()=>({data:[destination(['@accounts'],[...STANDARD_CONNECT_WEBHOOK_EVENTS],'ed_live_connected'),
  destination(['@self'],[...STANDARD_PLATFORM_WEBHOOK_EVENTS],'ed_live_platform')],next_page_url:null});
function releaseFixture(options={}) {
  const env={STUDIO_PAYMENT_RELEASE_VERIFY:'1',STRIPE_SECRET_KEY:'sk_live_fake',SUPABASE_SERVICE_ROLE_KEY:'service-test',
    NEXT_PUBLIC_SUPABASE_URL:`https://${scope.projectRef}.supabase.co`,STUDIO_PAYMENT_EXPECTED_PROJECT_REF:scope.projectRef,
    STUDIO_PAYMENT_EXPECTED_APP_URL:'https://www.studiooscloud.com',STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID:scope.platformAccountId,
    STRIPE_STANDARD_MIGRATION_ENABLED:'true',STRIPE_STANDARD_LIVE_MIGRATION_ENABLED:'true',STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED:'true',
    ...options.env};
  const control={release_key:scope.releaseKey,migration_enabled:true,checkout_enabled:true,reservation_required:true,activation_enabled:true,
    platform_account_id:scope.platformAccountId,photographer_id:scope.photographerId,actor_user_id:scope.userId,
    express_account_id:scope.expressAccountId,standard_account_id:scope.standardAccountId,allowed_currencies:['cad','usd'],...options.control};
  const standard={id:scope.standardAccountId,type:'standard',country:'CA',default_currency:'cad',details_submitted:true,charges_enabled:true,
    payouts_enabled:true,capabilities:{card_payments:'active',transfers:'active'},controller:{fees:{payer:'account'},losses:{payments:'stripe'},
      requirement_collection:'stripe',stripe_dashboard:{type:'full'}},requirements:emptyRequirements(),future_requirements:emptyRequirements(),
    metadata:{photographer_id:scope.photographerId,user_id:scope.userId},email:'private-photographer@example.invalid',...options.standard};
  const express={id:scope.expressAccountId,type:'express',country:'CA',details_submitted:true,charges_enabled:true,payouts_enabled:true,
    metadata:{photographer_id:scope.photographerId,user_id:scope.userId},capabilities:{card_payments:'active',transfers:'active'},requirements:emptyRequirements(),...options.express};
  const required=['resolve_order_payment_account','reserve_order_payment_account','bind_order_payment_references',
    'backfill_order_payment_account','activate_photographer_standard_account','rollback_photographer_standard_account',
    'claim_stripe_merchant_event','finish_stripe_merchant_event','get_photographer_checkout_routing','register_photographer_stripe_account','assert_whitephoto_live_stripe_scope','stripe_account_history_schema_status'];
  const schema={paths:Object.fromEntries(required.filter(name=>name!==options.missingRpc).map(name=>[`/rpc/${name}`,{post:{}}]))};
  const calls=[],logs=[];
  const fetcher=async(target,init)=>{
    const url=new URL(target);calls.push({url,method:init.method});assert.equal(init.method,'GET','release audit never mutates providers/database');
    let data;
    if(url.origin==='https://api.stripe.com'){
      if(url.pathname==='/v1/account')data={id:options.platformId??scope.platformAccountId};
      else if(url.pathname==='/v1/balance')data={object:'balance',livemode:true,...options.balance};
      else if(url.pathname===`/v1/accounts/${scope.standardAccountId}`)data=standard;
      else if(url.pathname===`/v1/accounts/${scope.expressAccountId}`)data=express;
      else if(url.pathname==='/v1/webhook_endpoints')data={data:[{id:'we_fixture',url:'https://www.studiooscloud.com/api/stripe/webhook',status:'enabled',livemode:true,enabled_events:['*']}]};
      else if(url.pathname==='/v2/core/event_destinations'){
        assert.equal(init.headers['Stripe-Version'],'2026-09-30.endive');assert.equal(url.searchParams.get('include[0]'),'webhook_endpoint.url');
        if(options.v2Status)return{ok:false,status:options.v2Status,json:async()=>({error:{message:'private-provider-body'}})};
        data=options.destinations??completeDestinations();
      }
      else assert.fail(`unexpected Stripe audit path ${url.pathname}`);
    }else{
      assert.equal(url.origin,`https://${scope.projectRef}.supabase.co`);
      if(url.pathname==='/rest/v1/')data=schema;
      else if(url.pathname==='/rest/v1/rpc/stripe_account_history_schema_status')data={version:'20261015010000',history_schema_present:true,reservation_guard_present:true,...options.protections};
      else if(url.pathname==='/rest/v1/photographers' && url.searchParams.has('id'))data=options.photographers??[{id:scope.photographerId,user_id:scope.userId,
        stripe_connected_account_id:scope.expressAccountId,stripe_account_id:scope.expressAccountId,stripe_standard_migrated_at:null}];
      else if(url.pathname==='/rest/v1/stripe_standard_live_release_controls'){
        assert.equal(url.searchParams.get('release_key'),`eq.${scope.releaseKey}`);
        data=options.rows??[control];
      }else if(url.pathname.startsWith('/rest/v1/'))data=[];
      else assert.fail(`unexpected database path ${url.pathname}`);
    }
    return{ok:true,json:async()=>structuredClone(data)};
  };
  return{env,control,standard,express,calls,logs,run:()=>verifyPaymentRelease(env,fetcher,line=>logs.push(JSON.parse(line)))};
}

test('live flags force the complete history/control audit even when optional history and generic release probes are absent',async()=>{
  const f=releaseFixture({env:{STUDIO_PAYMENT_RELEASE_VERIFY:undefined}});
  await f.run();
  assert.ok(f.calls.some(call=>call.url.pathname==='/rest/v1/order_payment_accounts'));
  assert.ok(f.calls.some(call=>call.url.pathname==='/rest/v1/photographer_stripe_accounts'&&call.url.searchParams.get('select').includes('future_requirements')));
  assert.ok(f.calls.some(call=>call.url.pathname==='/rest/v1/stripe_standard_live_release_controls'));
  assert.ok(f.logs.some(log=>log.check==='stripe-standard-live-account-readiness'&&log.futureRequirementsClear===true));
  assert.ok(f.logs.some(log=>log.check==='payment-release-verification'&&log.financialMutations===0));
  assert.ok(f.calls.every(call=>call.method==='GET'));
  const serialized=JSON.stringify(f.logs);
  for(const privateValue of ['sk_live_fake','service-test','private-photographer@example.invalid',scope.userId,scope.photographerId])assert.equal(serialized.includes(privateValue),false);
});

test('schema-only additive history audit accepts explicitly disabled controls and never claims live activation readiness',async()=>{
  const f=releaseFixture({env:{STUDIO_STRIPE_ACCOUNT_HISTORY_VERIFY:'1',STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED:undefined,STRIPE_STANDARD_LIVE_MIGRATION_ENABLED:undefined},
    control:{checkout_enabled:false,migration_enabled:false,reservation_required:false,activation_enabled:false}});
  await f.run();
  const audit=f.logs.find(log=>log.check==='stripe-standard-live-release-controls');
  assert.equal(audit.checkoutEnabled,false);assert.equal(audit.migrationEnabled,false);assert.equal(audit.reservationRequired,false);
  assert.equal(f.calls.some(call=>call.url.pathname.startsWith('/v1/accounts/')),false);
  assert.equal(f.logs.some(log=>log.check==='stripe-standard-live-account-readiness'),false);
});

test('release audit rejects missing, duplicated or differently scoped control rows and unproven currencies',async()=>{
  for(const options of [{rows:[]},{rows:[{},{}]},...Object.entries({release_key:'wrong',platform_account_id:'acct_wrong',
    photographer_id:'wrong',actor_user_id:'wrong',express_account_id:'acct_wrong',standard_account_id:'acct_wrong',
    allowed_currencies:['cad'],migration_enabled:'true',checkout_enabled:null,reservation_required:undefined,activation_enabled:undefined})
    .map(([name,value])=>({control:{[name]:value}})),{control:{allowed_currencies:['cad','usd','eur']}},{control:{allowed_currencies:['cad','cad']}}]) {
    const f=releaseFixture(options);
    await assert.rejects(f.run,/release-control row|exact WhitePhoto live release scope/);
    assert.equal(f.calls.some(call=>call.url.pathname.startsWith('/v1/accounts/')),false);
  }
});

test('live release flags cannot bypass disabled database controls or the reservation barrier',async()=>{
  for(const options of [{control:{checkout_enabled:false}},{control:{migration_enabled:false}},{control:{reservation_required:false}},
    {env:{STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED:'false'}},{env:{STRIPE_STANDARD_MIGRATION_ENABLED:'false'}},
    {env:{STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID:'acct_wrong'}}]) {
    const f=releaseFixture(options);
    await assert.rejects(f.run,/flags, reservation barrier and database release controls disagree/);
    assert.equal(f.calls.some(call=>call.url.pathname.startsWith('/v1/accounts/')),false);
  }
});

test('live checkout-only releases still require history, exact scope and the enabled reservation barrier',async()=>{
  const f=releaseFixture({env:{STRIPE_STANDARD_LIVE_MIGRATION_ENABLED:'false',STRIPE_STANDARD_MIGRATION_ENABLED:'false'},control:{migration_enabled:false}});
  await f.run();
  const audit=f.logs.find(log=>log.check==='stripe-standard-live-release-controls');
  assert.equal(audit.liveCheckoutFlag,true);assert.equal(audit.liveMigrationFlag,false);
  assert.ok(f.logs.some(log=>log.check==='stripe-account-history-schema'));
});

test('missing routing or live-scope RPCs block release before any merchant-account access',async()=>{
  for(const missingRpc of ['get_photographer_checkout_routing','assert_whitephoto_live_stripe_scope','reserve_order_payment_account']){
    const f=releaseFixture({missingRpc});await assert.rejects(f.run,/schema is incomplete/);
    assert.equal(f.calls.some(call=>call.url.pathname.startsWith('/v1/accounts/')),false);
  }
});

test('exact platform and true live balance are necessary before Standard account readiness proof',async()=>{
  const wrongPlatform=releaseFixture({platformId:'acct_wrong'});await assert.rejects(wrongPlatform.run,/exact WhitePhoto/);
  const wrongMode=releaseFixture({balance:{livemode:false}});await assert.rejects(wrongMode.run,/live Stripe platform balance/);
  assert.equal(wrongMode.calls.some(call=>call.url.pathname.startsWith('/v1/accounts/')),false);
});

test('current and future Standard requirements must both be explicitly clear before release',async()=>{
  for(const field of ['requirements','future_requirements']) {
    for(const requirements of [undefined,...['currently_due','eventually_due','past_due','pending_verification','errors']
      .map(name=>({...emptyRequirements(),[name]:['still-due']})),{...emptyRequirements(),disabled_reason:'restricted'}]) {
      const f=releaseFixture({standard:{[field]:requirements}});
      await assert.rejects(f.run,/current\/future requirements/);
      assert.equal(f.logs.some(log=>log.check==='stripe-standard-live-account-readiness'),false);
    }
  }
});

test('wrong account/controller/ownership or unready Express rollback cannot pass live release',async()=>{
  for(const options of [{standard:{id:'acct_wrong'}},{standard:{type:'express'}},{standard:{country:'US'}},{standard:{default_currency:'usd'}},
    {standard:{metadata:{}}},{standard:{charges_enabled:false}},{standard:{controller:{fees:{payer:'application'}}}},
    {express:{metadata:{}}},{express:{payouts_enabled:false}},{express:{id:'acct_wrong'}}]){
    const f=releaseFixture(options);await assert.rejects(f.run,/ownership|payment configuration|rollback readiness/);
    assert.equal(f.logs.some(log=>log.check==='payment-release-verification'),false);
  }
});


test('schema version and the installed reservation trigger are checked independently of control-row flags',async()=>{
  for(const protections of [{version:'old'},{history_schema_present:false},{reservation_guard_present:false}]){
    const f=releaseFixture({protections});await assert.rejects(f.run,/history or reservation protections are incomplete/);
    assert.equal(f.calls.some(call=>call.url.pathname.startsWith('/v1/accounts/')),false);
  }
});


test('preparation with activation disabled permits only empty candidate ownership while fresh Express remains selected and unmigrated',async()=>{
  const f=releaseFixture({control:{activation_enabled:false},standard:{metadata:{}}});
  await f.run();
  const audit=f.logs.find(log=>log.check==='stripe-standard-live-account-readiness');
  assert.equal(audit.preparationOnly,true);assert.equal(audit.ownershipBound,false);assert.equal(audit.activationEnabled,false);
  assert.equal(f.logs.find(log=>log.check==='stripe-standard-live-release-controls').activationEnabled,false);
  assert.ok(f.calls.every(call=>call.method==='GET'));
});

test('preparation never accepts partial, conflicting or foreign candidate ownership metadata',async()=>{
  for(const metadata of [{photographer_id:'foreign'},{user_id:'foreign'},{studio_os_migration:'foreign'},
    {photographer_id:scope.photographerId},{user_id:scope.userId}]) {
    const f=releaseFixture({control:{activation_enabled:false},standard:{metadata}});
    await assert.rejects(f.run,/Standard account ownership/);
  }
});

test('empty candidate ownership cannot pass activation or an already changed/unverified route',async()=>{
  for(const options of [{},...[
    {id:scope.photographerId,user_id:scope.userId,stripe_connected_account_id:scope.standardAccountId,stripe_standard_migrated_at:null},
    {id:scope.photographerId,user_id:scope.userId,stripe_connected_account_id:scope.standardAccountId,stripe_standard_migrated_at:'2026-10-15T08:00:00Z'},
    {id:scope.photographerId,user_id:scope.userId,stripe_connected_account_id:scope.expressAccountId,stripe_standard_migrated_at:'2026-10-15T08:00:00Z'},
    {id:scope.photographerId,user_id:'foreign',stripe_connected_account_id:scope.expressAccountId,stripe_standard_migrated_at:null},
    {id:scope.photographerId,user_id:scope.userId,stripe_connected_account_id:'acct_unrelated',stripe_standard_migrated_at:null},
  ].map(photographer=>({control:{activation_enabled:false},photographers:[photographer]})),
    {control:{activation_enabled:false},photographers:[]},{control:{activation_enabled:false},express:{metadata:{}}},
    {control:{activation_enabled:false},express:{charges_enabled:false}}]) {
    const f=releaseFixture({...options,standard:{metadata:{}}});
    await assert.rejects(f.run,/ownership|route|marker|rollback readiness/);
    assert.equal(f.logs.some(log=>log.check==='stripe-standard-live-account-readiness'),false);
  }
});

test('an already migrated Standard route requires bound candidate ownership even after activation is closed',async()=>{
  const f=releaseFixture({control:{activation_enabled:false},photographers:[{id:scope.photographerId,user_id:scope.userId,
    stripe_connected_account_id:scope.standardAccountId,stripe_standard_migrated_at:'2026-10-15T08:00:00Z'}]});
  await f.run();
  const audit=f.logs.find(log=>log.check==='stripe-standard-live-account-readiness');
  assert.equal(audit.preparationOnly,false);assert.equal(audit.ownershipBound,true);
});


test('preparation requires currently ready Express capabilities and verification without blocking future eventual requirements',async()=>{
  for(const express of [{capabilities:{card_payments:'inactive',transfers:'active'}},{capabilities:{card_payments:'active',transfers:'inactive'}},
    {requirements:undefined},...['currently_due','past_due','pending_verification','errors'].map(name=>({requirements:{...emptyRequirements(),[name]:['due']}})),
    {requirements:{...emptyRequirements(),disabled_reason:'restricted'}}]) {
    const f=releaseFixture({control:{activation_enabled:false},standard:{metadata:{}},express});
    await assert.rejects(f.run,/Express account ownership or rollback readiness/);
  }
  const futureExpress=releaseFixture({control:{activation_enabled:false},standard:{metadata:{}},
    express:{requirements:{...emptyRequirements(),eventually_due:['future-info']},future_requirements:{currently_due:['future-info']}}});
  await futureExpress.run();
  assert.ok(futureExpress.logs.some(log=>log.check==='stripe-standard-live-account-readiness'&&log.preparationOnly));
});

test('Standard release requires explicit provider snapshot scopes and all connected/fee-refund events without relying on v1 application',async()=>{
  const f=releaseFixture();await f.run();
  const proof=f.logs.find(row=>row.check==='stripe-standard-webhook-scopes');assert.equal(proof.ok,true);assert.equal(proof.scopeProof,'provider_v2_events_from');
  assert.deepEqual(proof.connectedDestinationIds,['ed_live_connected']);assert.deepEqual(proof.platformDestinationIds,['ed_live_platform']);
  assert.deepEqual(proof.missingConnectedEvents,[]);assert.deepEqual(proof.missingPlatformEvents,[]);assert.ok(f.calls.every(row=>row.method==='GET'));
  assert.ok(!JSON.stringify(proof).includes('service-test'));assert.ok(!JSON.stringify(proof).includes('sk_live_fake'));
});

test('Connect events cannot be supplied by a platform destination or application-fee events by a Connect destination',async()=>{
  for(const list of [
    {data:[destination(['@self'],[...STANDARD_CONNECT_WEBHOOK_EVENTS,...STANDARD_PLATFORM_WEBHOOK_EVENTS],'ed_wrong_scope')],next_page_url:null},
    {data:[destination(['@accounts'],[...STANDARD_CONNECT_WEBHOOK_EVENTS,...STANDARD_PLATFORM_WEBHOOK_EVENTS],'ed_wrong_scope')],next_page_url:null},
  ]){
    const proof=verifyStandardWebhookDestinations(list,'https://www.studiooscloud.com');assert.equal(proof.ok,false);
    await assert.rejects(releaseFixture({destinations:list}).run,/connected\/platform snapshot subscriptions/);
  }
});

test('every required Standard connected and platform event independently blocks release when missing',async()=>{
  for(const [index,events]of [[0,STANDARD_CONNECT_WEBHOOK_EVENTS],[1,STANDARD_PLATFORM_WEBHOOK_EVENTS]])for(const event of events){
    const list=completeDestinations();list.data[index].enabled_events=list.data[index].enabled_events.filter(value=>value!==event);
    const f=releaseFixture({destinations:list});await assert.rejects(f.run,/subscriptions are incomplete/);
    const proof=f.logs.find(row=>row.check==='stripe-standard-webhook-scopes');assert.ok([...proof.missingConnectedEvents,...proof.missingPlatformEvents].includes(event));
  }
});

test('thin, disabled, test, foreign URL and organization-only destinations never prove exact live snapshot scope',()=>{
  for(const patch of [{event_payload:'thin'},{status:'disabled'},{livemode:false},{events_from:['@organization_members/@accounts']},
    {events_from:null},{enabled_events:null},{webhook_endpoint:{url:'https://attacker.example/api/stripe/webhook'}},
    {webhook_endpoint:{url:'https://www.studiooscloud.com/api/stripe/webhook?secret=private'}}]){
    const list=completeDestinations();list.data[0]={...list.data[0],...patch};assert.equal(verifyStandardWebhookDestinations(list,'https://www.studiooscloud.com').ok,false);
  }
  const wildcard=completeDestinations();wildcard.data.forEach(row=>row.enabled_events=['*']);assert.equal(verifyStandardWebhookDestinations(wildcard,'https://www.studiooscloud.com').ok,true);
});

test('unsupported or incomplete v2 scope proof blocks only enabled Standard release; disabled additive installs retain old checks',async()=>{
  await assert.rejects(releaseFixture({v2Status:404}).run,/signed Workbench review/);
  await assert.rejects(releaseFixture({destinations:{...completeDestinations(),next_page_url:'https://api.stripe.com/v2/next'}}).run,/pagination/);
  await assert.rejects(releaseFixture({destinations:{data:completeDestinations().data}}).run,/incomplete/);
  const disabled=releaseFixture({v2Status:404,env:{STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED:undefined,STRIPE_STANDARD_LIVE_MIGRATION_ENABLED:undefined,STUDIO_STRIPE_ACCOUNT_HISTORY_VERIFY:'1'},
    control:{migration_enabled:false,checkout_enabled:false,reservation_required:false,activation_enabled:false}});
  await disabled.run();assert.equal(disabled.calls.some(row=>row.url.pathname.startsWith('/v2/')),false);
});

test('pre-schema provider-only opt-in uses exact live GET proof without database access or activation claims',async()=>{
  const f=releaseFixture({standard:{metadata:{}},env:{STUDIO_STANDARD_PROVIDER_RELEASE_VERIFY:'1',STUDIO_PAYMENT_RELEASE_VERIFY:undefined,
    STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED:undefined,STRIPE_STANDARD_LIVE_MIGRATION_ENABLED:undefined}});
  await f.run();assert.ok(f.calls.every(row=>row.url.origin==='https://api.stripe.com'&&row.method==='GET'));
  const ready=f.logs.find(row=>row.check==='stripe-standard-provider-only-readiness');assert.equal(ready.ownershipBound,false);assert.equal(ready.databaseRoutingVerified,false);assert.equal(ready.activationReady,false);
  assert.ok(f.logs.some(row=>row.check==='stripe-standard-provider-only-webhooks'&&row.ok));
  for(const change of [{STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID:'acct_wrong'},{NEXT_PUBLIC_SUPABASE_URL:'https://foreign.supabase.co'},
    {STUDIO_PAYMENT_EXPECTED_APP_URL:'https://foreign.example'},{STRIPE_SECRET_KEY:'[SENSITIVE]'}]){
    const bad=releaseFixture({env:{...f.env,...change}});await assert.rejects(bad.run,/exact live platform\/project\/app/);assert.equal(bad.calls.length,0);
  }
});

test('provider-only audit cannot ignore conflicting candidate metadata, missing requirements or destination scope',async()=>{
  for(const options of [{standard:{metadata:{user_id:'foreign'}}},{standard:{requirements:undefined}},{standard:{future_requirements:{}}},
    {balance:{livemode:false}},{destinations:{data:[],next_page_url:null}}]){
    const f=releaseFixture({...options,env:{STUDIO_STANDARD_PROVIDER_RELEASE_VERIFY:'1',STUDIO_PAYMENT_RELEASE_VERIFY:undefined,
      STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED:undefined,STRIPE_STANDARD_LIVE_MIGRATION_ENABLED:undefined}});
    await assert.rejects(f.run,/ownership|requirements|balance|subscriptions/);assert.ok(f.calls.every(row=>row.method==='GET'));
  }
});
