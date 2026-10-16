import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAuditedPaymentAccount, verifyPaymentRelease, WHITEPHOTO_STANDARD_AUDIT_SCOPE,verifyStandardWebhookDestinations,
  STANDARD_CONNECT_WEBHOOK_EVENTS,STANDARD_PLATFORM_WEBHOOK_EVENTS,WHITEPHOTO_STANDARD_WEBHOOK_CONFIGURATION,verifyStandardSignupRelease } from '../scripts/verify-payment-release.mjs';

const order={id:'11111111-1111-4111-8111-111111111111',photographer_id:'22222222-2222-4222-8222-222222222222',stripe_payment_intent_id:'pi_old'};
const error=code=>Object.assign(new Error('Database verification failed; details withheld.'),{code});
const legacy={stripe_connected_account_id:'acct_old',stripe_standard_migrated_at:null};

test('born-Standard audit payments never use the current pointer if immutable history is unavailable with creation disabled',async()=>{
  await assert.rejects(()=>resolveAuditedPaymentAccount(async path=>{
    if(path.startsWith('rpc/'))throw error('PGRST202');
    assert.ok(path.includes('stripe_account_history_required'));
    return[{...legacy,stripe_account_history_required:true}];
  },order),/requires its verified original account/);
  const paths=[];
  await assert.rejects(()=>resolveAuditedPaymentAccount(async path=>{
    paths.push(path);if(path.startsWith('rpc/'))throw error('PGRST202');
    if(path.includes('stripe_account_history_required'))throw error('42703');
    return[{...legacy,stripe_standard_migrated_at:'2026-10-15T07:00:00Z'}];
  },order),/requires its verified original account/);
  assert.equal(paths.length,3,'Missing signup column must retain the earlier pilot migration marker');
});

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
    'claim_stripe_merchant_event','finish_stripe_merchant_event','get_photographer_checkout_routing','register_photographer_stripe_account','assert_whitephoto_live_stripe_scope','stripe_account_history_schema_status',
    'stripe_standard_signup_schema_status','stripe_standard_signup_params_hash','get_photographer_standard_signup_eligibility',
    'reserve_photographer_standard_signup','record_photographer_standard_signup_account','activate_photographer_standard_signup'];
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
      else if(url.pathname==='/rest/v1/rpc/stripe_standard_signup_schema_status')data={version:'20261016010000',regional_markets_present:true,signup_schema_present:true,
        history_required_guard_present:true,legacy_creation_barrier_present:true,service_only_rpcs:true,service_only_tables:true,...options.signupProtections};
      else if(url.pathname==='/rest/v1/stripe_standard_signup_release_controls'){
        assert.equal(url.searchParams.get('release_key'),'eq.standard-signup-v1');
        data=options.signupRows??[{release_key:'standard-signup-v1',platform_account_id:scope.platformAccountId,project_ref:scope.projectRef,
          enabled:true,enrollment_starts_at:new Date(Date.now()-3600000).toISOString(),allowed_countries:['CA','US','AU','GB'],allowed_currencies:['cad','usd','aud','gbp'],...options.signupControl}];
      }
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
  return{env,control,standard,express,calls,logs,fetcher,run:()=>verifyPaymentRelease(env,fetcher,line=>logs.push(JSON.parse(line)))};
}

test('new Standard signup audit defaults off and preserves disabled deployment compatibility without network access',async()=>{
  for(const env of [{},{STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED:'false'},{STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED:'TRUE'}]) {
    await verifyStandardSignupRelease(env,()=>assert.fail('Default-off signup audit cannot require new schema'),()=>assert.fail('No readiness claim while disabled'));
  }
});

test('new Standard flag independently forces schema, service-only permissions, exact live controls and connected/platform webhook proof',async()=>{
  const f=releaseFixture({env:{STUDIO_PAYMENT_RELEASE_VERIFY:undefined,STRIPE_STANDARD_MIGRATION_ENABLED:'false',
    STRIPE_STANDARD_LIVE_MIGRATION_ENABLED:'false',STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED:'false',STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED:'true'},
    control:{migration_enabled:false,checkout_enabled:false,reservation_required:false,activation_enabled:false}});
  await f.run();
  const result=f.logs.find(line=>line.check==='stripe-standard-new-signup-release');
  assert.deepEqual(result.allowedCountries,['CA','US','AU','GB']);assert.deepEqual(result.allowedCurrencies,['cad','usd','aud','gbp']);
  assert.equal(result.creationFlag,true);assert.equal(result.creationControl,true);assert.equal(result.serviceOnlyPermissions,true);
  assert.equal(result.legacyCreationBarrier,true);assert.equal(result.immutableHistoryRequired,true);
  assert.equal(result.existingMerchantRoutingChanged,false);assert.equal(result.financialMutations,0);assert.equal(result.databaseMutations,0);
  assert.ok(f.calls.some(call=>call.url.pathname==='/rest/v1/photographer_stripe_standard_signups'&&call.url.searchParams.get('limit')==='0'));
  assert.ok(f.calls.some(call=>call.url.pathname==='/rest/v1/stripe_standard_signup_eligible_profiles'&&call.url.searchParams.get('limit')==='0'));
  assert.ok(f.logs.some(line=>line.check==='stripe-account-history-schema'),'New signup cannot skip the existing immutable-history audit');
  assert.equal(f.calls.some(call=>call.url.pathname.startsWith('/v1/accounts/')),false,'New-only audit does not expand or adopt pilot accounts');
  assert.ok(f.calls.every(call=>call.method==='GET'));
  const output=JSON.stringify(f.logs);for(const secret of ['sk_live_fake','service-test','private-photographer@example.invalid'])assert.equal(output.includes(secret),false);
});

test('explicit disabled preparation audit proves new schema without enabling creation or requiring a merchant cutover',async()=>{
  const f=releaseFixture({env:{STUDIO_STANDARD_SIGNUP_RELEASE_VERIFY:'1',STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED:'false'},signupControl:{enabled:false}});
  await verifyStandardSignupRelease(f.env,f.fetcher,line=>f.logs.push(JSON.parse(line)));
  assert.equal(f.logs[0].creationFlag,false);assert.equal(f.logs[0].creationControl,false);
  assert.ok(f.calls.every(call=>call.method==='GET'));
  assert.equal(f.calls.some(call=>call.url.pathname.startsWith('/v1/accounts/')),false);
});

test('new Standard signup audit fails closed for wrong platform/project/app/mode or configuration operations before new controls',async()=>{
  for(const options of [{platformId:'acct_foreign'},{balance:{livemode:false}},
    ...Object.entries({STRIPE_SECRET_KEY:'sk_test_fake',SUPABASE_SERVICE_ROLE_KEY:'[SENSITIVE]',STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID:'acct_foreign',
      STUDIO_PAYMENT_EXPECTED_PROJECT_REF:'foreign',NEXT_PUBLIC_SUPABASE_URL:'https://foreign.supabase.co',STUDIO_PAYMENT_EXPECTED_APP_URL:'https://foreign.test',
      STUDIO_STANDARD_WEBHOOK_CONFIGURE:'whitephoto-20261015',STUDIO_CREDIT_WEBHOOK_CONFIGURE:'1',STUDIO_PAYMENT_REFUND_WEBHOOK_ID:'we_foreign'})
      .map(([key,value])=>({env:{[key]:value}}))]) {
    const f=releaseFixture({...options,env:{...options.env,STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED:'true'}});
    await assert.rejects(()=>verifyStandardSignupRelease(f.env,f.fetcher),/exact protected live|exact platform|GET-only/);
    assert.equal(f.calls.some(call=>call.url.pathname==='/rest/v1/stripe_standard_signup_release_controls'),false);
  }
});

test('new Standard signup creation requires its exact enabled control, proven schema guards and six service-only RPCs',async()=>{
  const invalidControls=[{enabled:false},{enabled:'true'},{release_key:'whitephoto-20261015'},{platform_account_id:'acct_foreign'},
    {project_ref:'foreign'},{allowed_countries:['CA']},{allowed_countries:['CA','CA']},{allowed_countries:['CA','US','GB']},
    {allowed_currencies:['cad']},{allowed_currencies:['cad','usd']},{allowed_currencies:['cad','eur']},{allowed_currencies:['cad','usd','aud','aud']},{enrollment_starts_at:null},{enrollment_starts_at:'invalid'},
    {enrollment_starts_at:new Date(Date.now()+86400000).toISOString()}];
  for(const options of [...invalidControls.map(signupControl=>({signupControl})),{signupRows:[]},{signupRows:[{},{}]},
    ...['regional_markets_present','signup_schema_present','history_required_guard_present','legacy_creation_barrier_present','service_only_rpcs','service_only_tables'].map(key=>({signupProtections:{[key]:false}})),
    {signupProtections:{version:'old'}},{signupProtections:{version:'20261015020000'}},...['stripe_standard_signup_params_hash','record_photographer_standard_signup_account','activate_photographer_standard_signup']
      .map(missingRpc=>({missingRpc})),{protections:{reservation_guard_present:false}}]) {
    const f=releaseFixture({...options,env:{STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED:'true'}});
    await assert.rejects(()=>verifyStandardSignupRelease(f.env,f.fetcher),/signup|history/);
    assert.equal(f.calls.some(call=>call.url.pathname==='/v2/core/event_destinations'),false,'Unproven signup controls cannot reach webhook readiness claim');
  }
});

test('new Standard signup audit requires genuine connected-account and platform events with complete scope pagination',async()=>{
  for(const destinations of [{data:[destination(['@self'],['*'],'ed_platform')],next_page_url:null},
    {data:[destination(['@accounts'],['*'],'ed_connect')],next_page_url:null},
    {...completeDestinations(),next_page_url:'/v2/next'},
    {data:[destination(['@accounts'],STANDARD_CONNECT_WEBHOOK_EVENTS.filter(event=>event!=='account.application.deauthorized'),'ed_connect'),
      destination(['@self'],[...STANDARD_PLATFORM_WEBHOOK_EVENTS],'ed_platform')],next_page_url:null}]) {
    const f=releaseFixture({env:{STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED:'true'},destinations});
    await assert.rejects(()=>verifyStandardSignupRelease(f.env,f.fetcher),/scope proof is incomplete|webhook scope/);
  }
});

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

const webhookPin=WHITEPHOTO_STANDARD_WEBHOOK_CONFIGURATION;
function configurationFixture(options={}){
  const f=releaseFixture({control:{migration_enabled:false,checkout_enabled:false,reservation_required:false,activation_enabled:false,...options.control},
    standard:{metadata:{},...options.standard},platformId:options.platformId,balance:options.balance,
    photographers:options.photographers??[{id:scope.photographerId,user_id:scope.userId,stripe_account_id:scope.expressAccountId,
      stripe_connected_account_id:scope.expressAccountId,stripe_standard_migrated_at:null,stripe_connect_route_version:0}],
    protections:options.protections,rows:options.rows,
    env:{STUDIO_PAYMENT_RELEASE_VERIFY:undefined,STUDIO_STANDARD_PROVIDER_RELEASE_VERIFY:'1',STUDIO_STANDARD_WEBHOOK_CONFIGURE:scope.releaseKey,
      STUDIO_STANDARD_COMPATIBLE_RELEASE_CONFIRMED:webhookPin.acknowledgment,STUDIO_STANDARD_COMPATIBLE_RELEASE_COMMIT:'a'.repeat(40),
      STRIPE_STANDARD_MIGRATION_ENABLED:undefined,STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED:undefined,STRIPE_STANDARD_LIVE_MIGRATION_ENABLED:undefined,...options.env}});
  const oldConnected=['checkout.session.completed','payment_intent.succeeded','charge.refunded','refund.updated','refund.failed','payout.paid'];
  const oldPlatform=['checkout.session.completed','customer.subscription.created','customer.subscription.updated','invoice.payment_succeeded'];
  const endpoints=[{id:webhookPin.connectedEndpointId,object:'webhook_endpoint',url:webhookPin.url,status:'enabled',livemode:true,
    enabled_events:options.complete?[...oldConnected,...STANDARD_CONNECT_WEBHOOK_EVENTS]:oldConnected,application:'ca_original',api_version:'2025-12-15.clover'},
    {id:webhookPin.platformEndpointId,object:'webhook_endpoint',url:webhookPin.url,status:'enabled',livemode:true,
      enabled_events:options.complete?[...oldPlatform,...STANDARD_PLATFORM_WEBHOOK_EVENTS]:oldPlatform,application:null,api_version:'2025-12-15.clover'}];
  const writes=[],reads=[];
  const fetcher=async(target,init)=>{
    const url=new URL(target);reads.push({url,method:init.method});
    if(url.pathname==='/v2/core/event_destinations'){
      const list={data:endpoints.map((endpoint,index)=>({...destination([index===0?'@accounts':'@self'],[...endpoint.enabled_events],endpoint.id),...options.destinationPatch,...(writes.length===2?options.finalDestinationPatch:{})})),next_page_url:null};
      if(options.duplicateDestination)list.data.push(list.data[0]);
      return{ok:true,json:async()=>list};
    }
    if(url.pathname.startsWith('/v1/webhook_endpoints/')){
      const endpoint=endpoints.find(row=>url.pathname===`/v1/webhook_endpoints/${row.id}`);assert.ok(endpoint,'only the two exact endpoint paths are permitted');
      if(init.method==='GET')return{ok:true,json:async()=>({...structuredClone(endpoint),...options.endpointPatch,...(writes.length===2?options.finalEndpointPatch:{})})};
      assert.equal(init.method,'POST');const body=[...init.body.entries()];assert.ok(body.every(([key])=>key==='enabled_events[]'));
      assert.match(init.headers['Idempotency-Key'],/^studio-standard-webhooks-20261015-[a-f0-9]{64}$/);
      writes.push({id:endpoint.id,events:body.map(([,value])=>value)});
      if(options.failSecond&&writes.length===2)return{ok:false,status:503,json:async()=>({error:{message:'private-provider-body'}})};
      endpoint.enabled_events=writes.at(-1).events;
      return{ok:true,json:async()=>({...structuredClone(endpoint),...options.postPatch})};
    }
    return f.fetcher(target,init);
  };
  return{...f,endpoints,writes,reads,run:()=>verifyPaymentRelease(f.env,fetcher,line=>f.logs.push(JSON.parse(line)))};
}

test('explicit Standard webhook preparation adds only missing events to the two pinned endpoints and preserves all prior billing events',async()=>{
  const f=configurationFixture();const original=f.endpoints.map(row=>[...row.enabled_events]);await f.run();
  assert.equal(f.writes.length,2);assert.deepEqual(f.writes.map(row=>row.id),[webhookPin.connectedEndpointId,webhookPin.platformEndpointId]);
  for(let index=0;index<2;index++)for(const event of original[index])assert.ok(f.endpoints[index].enabled_events.includes(event));
  assert.ok(STANDARD_CONNECT_WEBHOOK_EVENTS.every(event=>f.endpoints[0].enabled_events.includes(event)));
  assert.ok(STANDARD_PLATFORM_WEBHOOK_EVENTS.every(event=>f.endpoints[1].enabled_events.includes(event)));
  const proof=f.logs.find(row=>row.check==='stripe-standard-webhook-subscriptions-configured');
  assert.equal(proof.endpointSubscriptionWrites,2);assert.equal(proof.expressStillSelected,true);assert.equal(proof.allReleaseControlsOff,true);
  assert.equal(proof.databaseMutations,0);assert.equal(proof.financialMutations,0);
  assert.equal(f.reads.filter(row=>row.method==='POST').length,2);assert.ok(f.reads.filter(row=>row.url.origin!=='https://api.stripe.com').every(row=>row.method==='GET'));
  const writes=f.writes.length;await f.run();assert.equal(f.writes.length,writes,'rerun skips already-complete subscriptions');
  assert.equal(f.logs.filter(row=>row.check==='stripe-standard-webhook-subscriptions-configured').at(-1).endpointSubscriptionWrites,0);
  assert.ok(!JSON.stringify(f.logs).includes('sk_live_fake'));assert.ok(!JSON.stringify(f.logs).includes('service-test'));
});

test('endpoint configuration refuses absent acknowledgment, foreign schema/owner/routes, active controls and live flags before every POST',async()=>{
  for(const options of [
    {env:{STUDIO_STANDARD_PROVIDER_RELEASE_VERIFY:undefined}},{env:{STUDIO_STANDARD_WEBHOOK_CONFIGURE:'wrong'}},
    {env:{STUDIO_STANDARD_COMPATIBLE_RELEASE_CONFIRMED:undefined}},{env:{STUDIO_STANDARD_COMPATIBLE_RELEASE_COMMIT:'not-a-commit'}},
    {env:{STRIPE_STANDARD_MIGRATION_ENABLED:'true'}},{env:{STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED:'true'}},
    {env:{STRIPE_STANDARD_LIVE_MIGRATION_ENABLED:'true'}},{env:{STUDIO_CREDIT_WEBHOOK_CONFIGURE:'1'}},
    {env:{STUDIO_PAYMENT_REFUND_WEBHOOK_ID:'we_other'}},{env:{SUPABASE_SERVICE_ROLE_KEY:'[SENSITIVE]'}},
    {protections:{version:'wrong'}},{protections:{reservation_guard_present:false}},{rows:[]},{rows:[{},{}]},
    ...['migration_enabled','checkout_enabled','reservation_required','activation_enabled'].map(name=>({control:{[name]:true}})),
    {photographers:[{id:scope.photographerId,user_id:'foreign'}]},
    {photographers:[{id:scope.photographerId,user_id:scope.userId,stripe_account_id:scope.standardAccountId,stripe_connected_account_id:scope.standardAccountId,stripe_standard_migrated_at:'2026-10-15',stripe_connect_route_version:1}]},
    {platformId:'acct_foreign'},{balance:{livemode:false}},{standard:{metadata:{user_id:'foreign'}}},{standard:{future_requirements:undefined}},
  ]){const f=configurationFixture(options);await assert.rejects(f.run);assert.equal(f.writes.length,0,JSON.stringify(options));}
});

test('endpoint configuration cannot infer scopes from application or modify foreign/ambiguous/thin/test destinations',async()=>{
  for(const options of [
    ...[{id:'we_other'},{events_from:['@self']},{events_from:['@accounts','@self']},{event_payload:'thin'},
      {livemode:false},{status:'disabled'},{webhook_endpoint:{url:'https://studiooscloud.com/api/stripe/webhook'}},
      {enabled_events:[]}].map(destinationPatch=>({destinationPatch})),
    {duplicateDestination:true},{endpointPatch:{id:'we_other'}},{endpointPatch:{url:'https://foreign.example/api/stripe/webhook'}},
    {endpointPatch:{livemode:false}},{endpointPatch:{status:'disabled'}},{endpointPatch:{enabled_events:['*']}},
  ]){const f=configurationFixture(options);await assert.rejects(f.run);assert.equal(f.writes.length,0);}
});

test('partial endpoint configuration failure never removes prior subscriptions and can be safely reconciled by GET before rerun',async()=>{
  const f=configurationFixture({failSecond:true});await assert.rejects(f.run,/subscription addition failed/);assert.equal(f.writes.length,2);
  assert.ok(f.endpoints[0].enabled_events.includes('payout.paid'));assert.ok(f.endpoints[0].enabled_events.includes('account.updated'));
  assert.ok(f.endpoints[1].enabled_events.includes('invoice.payment_succeeded'));assert.ok(!f.endpoints[1].enabled_events.includes('application_fee.refunded'));
  assert.equal(f.logs.some(row=>row.check==='stripe-standard-webhook-subscriptions-configured'),false);
  await f.run();assert.equal(f.writes.length,3,'rerun GETs and repairs only the remaining endpoint');
});

test('endpoint POST response or final GET drift cannot be reported as a successful repair',async()=>{
  for(const postPatch of [{application:'foreign'},{api_version:'2020-01-01'},{enabled_events:['account.updated']},{url:'https://foreign.example'}]){
    const f=configurationFixture({postPatch});await assert.rejects(f.run);assert.equal(f.writes.length,1);assert.equal(f.logs.some(row=>row.check==='stripe-standard-webhook-subscriptions-configured'),false);
  }
});

test('fresh final v1 and v2 scope GETs independently reject drift after both endpoint additions',async()=>{
  for(const options of [{finalEndpointPatch:{application:'foreign'}},{finalEndpointPatch:{api_version:'old'}},
    {finalEndpointPatch:{enabled_events:['account.updated']}},{finalDestinationPatch:{events_from:['@self']}},
    {finalDestinationPatch:{webhook_endpoint:{url:'https://foreign.example'}}}]){
    const f=configurationFixture(options);await assert.rejects(f.run);assert.equal(f.writes.length,2);
    assert.equal(f.logs.some(row=>row.check==='stripe-standard-webhook-subscriptions-configured'),false);
  }
});


test('regional compatibility audit permits unchanged legacy enrollment only while creation is disabled',async()=>{
 const f=releaseFixture({env:{STUDIO_STANDARD_SIGNUP_RELEASE_VERIFY:'1',STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED:'false'},signupControl:{allowed_countries:['CA','US'],allowed_currencies:['cad','usd']}});
 await verifyStandardSignupRelease(f.env,f.fetcher,line=>f.logs.push(JSON.parse(line)));assert.deepEqual(f.logs[0].allowedCountries,['CA','US']);assert.equal(f.logs[0].creationFlag,false);
 for(const signupControl of [{allowed_countries:['CA','US'],allowed_currencies:['cad','usd','aud','gbp']},{allowed_countries:['CA','US','AU','GB'],allowed_currencies:['cad','usd']}]){
  const mismatch=releaseFixture({env:{STUDIO_STANDARD_SIGNUP_RELEASE_VERIFY:'1',STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED:'false'},signupControl});await assert.rejects(()=>verifyStandardSignupRelease(mismatch.env,mismatch.fetcher),/coverage is unverified/);
 }
 const enabled=releaseFixture({env:{STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED:'true'},signupControl:{allowed_countries:['CA','US'],allowed_currencies:['cad','usd']}});await assert.rejects(()=>verifyStandardSignupRelease(enabled.env,enabled.fetcher),/coverage is unverified/);
});
