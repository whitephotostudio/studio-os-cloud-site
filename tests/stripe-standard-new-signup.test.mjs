import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const load = (path, dependencies={}) => {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',code)(name => dependencies[name] ?? (name.startsWith('@/') ? {} : require(name)),exports);
  return exports;
};
const country = load('lib/stripe-connect-country.ts',{'./order-currency':load('lib/order-currency.ts')});
const history = load('lib/stripe-connect-history.ts');
const standard = load('lib/stripe-standard-connect.ts',{'@/lib/stripe-connect-country':country});
const envKeys=['STRIPE_SECRET_KEY','NEXT_PUBLIC_SUPABASE_URL','STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID','STUDIO_STANDARD_SANDBOX_PLATFORM_VERIFIED',
 'STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED','STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID','STUDIO_PAYMENT_EXPECTED_APP_URL','VERCEL_ENV'];
const saved=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
test.beforeEach(()=>{for(const key of envKeys)delete process.env[key];Object.assign(process.env,{STRIPE_SECRET_KEY:'sk_test_intercepted',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:55421',STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID:'acct_sandbox',STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED:'true'});});
test.after(()=>{for(const key of envKeys)saved[key]===undefined?delete process.env[key]:process.env[key]=saved[key];});
const requirements={currently_due:[],eventually_due:[],past_due:[],pending_verification:[],errors:[]};
function fixture(options={}) {
 const photographer={id:'photo',user_id:'owner',business_name:'Initial studio',billing_email:'first@example.test',business_country:options.country||'CA',stripe_account_id:options.existing||null,stripe_connected_account_id:options.existing||null};
 let intent=null,provider=null,lost=options.lost,saveFailure=options.saveFailure;
 const calls=[];
 const service={from(table){let conditions=[];const query={select(){return query},eq(key,value){conditions.push([key,value]);return query},maybeSingle:run,single:run};async function run(){if(options.schemaMissing&&table==='photographer_stripe_standard_signups')return {data:null,error:{code:'42P01'}};const row=table==='photographers'?photographer:intent;return {data:row&&conditions.every(([key,value])=>row[key]===value)?structuredClone(row):null,error:null};}return query;},async rpc(name,args){calls.push({rpc:name,args});
   if(name==='get_photographer_standard_signup_eligibility')return {data:{eligible:options.eligible!==false,reason:options.reason||'new'},error:null};
   if(name==='reserve_photographer_standard_signup'){
    if(!intent)intent={id:'signup',photographer_id:photographer.id,actor_user_id:'owner',platform_account_id:'acct_sandbox',country:args.p_country,livemode:false,status:'creating',stripe_account_id:null,allowed_currencies:options.allowedCurrencies||['cad','usd','aud','gbp'],attempted_at:new Date(Date.now()-(options.age||0)).toISOString(),creation_params:structuredClone(args.p_creation_params),request_hash:args.p_request_hash,idempotency_key:'studio-os-standard-signup-signup'};
    intent.provider_request_hash=api.standardSignupParamsHash({...intent.creation_params,'metadata[standard_signup_id]':intent.id});
    return {data:structuredClone(intent),error:null};}
   if(name==='record_photographer_standard_signup_account'){if(saveFailure){saveFailure=false;return {error:Error('lost database save'),data:null};}intent.stripe_account_id=args.p_account.id;intent.status='registered';return {data:structuredClone(intent),error:null};}
   if(name==='activate_photographer_standard_signup'){intent.status='activated';photographer.stripe_account_id=photographer.stripe_connected_account_id=args.p_account.id;return {data:{accountId:args.p_account.id},error:null};}
   throw Error(name);}};
 const api=load('lib/stripe-standard-signup.ts',{'@/lib/stripe-connect-country':country,'@/lib/stripe-connect-history':history,'@/lib/stripe-standard-connect':standard,
  '@/lib/payments':{async stripeRequest(path,settings={}){calls.push({path,key:settings.idempotencyKey,body:settings.body?.toString(),method:settings.method||'GET'});
   if(path==='account')return {id:options.wrongPlatform?'acct_foreign':'acct_sandbox'};
   if(path==='balance')return {object:'balance',livemode:!!options.wrongMode};
   if(path==='accounts'){const p=Object.fromEntries(settings.body);provider||={id:'acct_new',type:'standard',country:p.country,metadata:{photographer_id:p['metadata[photographer_id]'],user_id:p['metadata[user_id]'],standard_signup_id:p['metadata[standard_signup_id]']},details_submitted:!!options.ready,charges_enabled:!!options.ready,payouts_enabled:!!options.ready,capabilities:{card_payments:'active',transfers:'active'},requirements,future_requirements:requirements,controller:{fees:{payer:'account'},losses:{payments:'stripe'},requirement_collection:'stripe',stripe_dashboard:{type:'full'}}};if(lost){lost=false;throw Error('lost account reply');}return structuredClone(provider);}
   if(path==='accounts/acct_new')return {...structuredClone(provider),...(options.accountChanges||{})};
   if(path==='account_links')return {url:options.badLink||'https://connect.stripe.com/setup/test'};
   throw Error(path);
  }}});
 const request={url:'http://localhost:55430/api/stripe/connect',headers:new Headers({origin:'http://localhost:55430'})};
 const start=()=>api.startStandardSignup(service,{request,photographer,userId:'owner',email:photographer.billing_email,country:photographer.business_country,salesCurrency:options.salesCurrency});
 return {api,service,photographer,calls,start,request,get intent(){return intent},get provider(){return provider}};
}
test('all four country signups persist pending ownership before exposing a hosted link and never selects unfinished account',async()=>{
 for(const country of ['CA','US','AU','GB']){const f=fixture({country});const result=await f.start();assert.equal(result.stripeAccountId,null);assert.equal(result.stripePendingAccountId,'acct_new');assert.equal(f.intent.stripe_account_id,'acct_new');assert.equal(f.photographer.stripe_account_id,null);assert.equal(f.calls.filter(c=>c.path==='accounts').length,1);assert.ok(f.calls.findIndex(c=>c.rpc==='record_photographer_standard_signup_account')<f.calls.findIndex(c=>c.path==='account_links'));}
});
test('lost account creation and lost database save reuse exact frozen body and idempotency despite profile changes',async()=>{
 for(const failure of ['lost','saveFailure']){const f=fixture({[failure]:true});await assert.rejects(f.start());f.photographer.business_name='Edited studio';f.photographer.billing_email='edited@example.test';await f.start();const creates=f.calls.filter(c=>c.path==='accounts');assert.equal(creates.length,2);assert.equal(creates[0].body,creates[1].body);assert.equal(creates[0].key,creates[1].key);assert.equal(f.intent.stripe_account_id,'acct_new');}
});
test('signup retry permits at most thirty seconds of future clock skew while preserving strict twenty-three-hour expiry',()=>{
 const {api}=fixture(),now=Date.parse('2026-10-15T18:51:45.561Z'),hour=60*60*1000;
 for(const [age,allowed]of [[0,true],[-6,true],[-30000,true],[-30001,false],[-hour,false],[23*hour-1,true],[23*hour,false],[23*hour+1,false]]){
  assert.equal(api.standardSignupRetryAllowed({attempted_at:new Date(now-age).toISOString()},now),allowed,`age ${age}`);
 }
 for(const attempted_at of ['invalid','',undefined,null])assert.equal(api.standardSignupRetryAllowed({attempted_at},now),false);
 assert.equal(api.standardSignupRetryAllowed({attempted_at:new Date(now).toISOString()},NaN),false);
});
test('a first database reservation six milliseconds ahead of the app retries the exact request under SQL controls',async()=>{
 const originalNow=Date.now;Date.now=()=>Date.parse('2026-10-15T18:51:45.561Z');
 try{const f=fixture({age:-6,lost:true});await assert.rejects(f.start(),/lost account reply/);
  const original=structuredClone(f.intent);assert.equal(original.attempted_at,'2026-10-15T18:51:45.567Z');
  f.photographer.business_name='Later profile name';f.photographer.billing_email='later@example.test';await f.start();
  const creates=f.calls.filter(c=>c.path==='accounts'),reservations=f.calls.filter(c=>c.rpc==='reserve_photographer_standard_signup');
  assert.equal(creates.length,2);assert.equal(creates[0].body,creates[1].body);assert.equal(creates[0].key,creates[1].key);assert.equal(creates[0].key,original.idempotency_key);
  assert.equal(reservations.length,3);assert.ok(reservations.every(c=>c.args.p_request_hash===original.request_hash&&JSON.stringify(c.args.p_creation_params)===JSON.stringify(original.creation_params)));
  assert.ok(f.calls.findLastIndex(c=>c.rpc==='reserve_photographer_standard_signup')<f.calls.findLastIndex(c=>c.path==='accounts'));
  assert.equal(f.intent.id,original.id);assert.equal(f.intent.request_hash,original.request_hash);assert.equal(f.intent.stripe_account_id,'acct_new');assert.equal(f.photographer.stripe_account_id,null);
 }finally{Date.now=originalNow;}
});
test('small clock skew cannot bypass browser ownership or disabled unknown-result creation',async()=>{
 const originalNow=Date.now;Date.now=()=>Date.parse('2026-10-15T18:51:45.561Z');
 try{const foreign=fixture({age:-6});foreign.request.headers.set('origin','https://foreign.test');await assert.rejects(foreign.start(),/this Studio OS page/);assert.equal(foreign.calls.length,0);
  const f=fixture({age:-6,lost:true});await assert.rejects(f.start(),/lost account reply/);const original=structuredClone(f.intent),creates=f.calls.filter(c=>c.path==='accounts').length;
  process.env.STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED='false';await assert.rejects(f.start(),/reconciliation/);assert.equal(f.calls.filter(c=>c.path==='accounts').length,creates);assert.deepEqual(f.intent,original);
 }finally{Date.now=originalNow;}
});
test('repeated pending links and ready status never create another account; feature off continues saved Standard servicing',async()=>{
 const f=fixture();await f.start();await f.start();assert.equal(f.calls.filter(c=>c.path==='accounts').length,1);f.provider.charges_enabled=f.provider.payouts_enabled=f.provider.details_submitted=true;process.env.STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED='false';const refreshed=await f.api.refreshStandardSignupForPhotographer(f.service,{photographer:f.photographer,userId:'owner'});assert.equal(refreshed.active,true);assert.equal(refreshed.photographer.stripe_account_id,'acct_new');assert.equal((await f.start()).url,'https://dashboard.stripe.com/');assert.equal(f.calls.filter(c=>c.path==='accounts').length,1);
});
test('expired uncertain intent, foreign provider, wrong mode and foreign ownership stop before account exposure',async()=>{
 const expired=fixture({age:23*60*60*1000});await assert.rejects(expired.start(),/reconciliation/);assert.equal(expired.calls.some(c=>c.path==='accounts'),false);
 for(const options of [{wrongPlatform:true},{wrongMode:true},{accountChanges:{metadata:{photographer_id:'foreign'}}},{accountChanges:{controller:{fees:{payer:'application'}}}},{badLink:'https://example.test/steal'}]){const f=fixture(options);await assert.rejects(f.start());assert.equal(f.photographer.stripe_account_id,null);}
});
test('legacy Express and disabled pre-schema creation remain available without new provider writes',async()=>{
 const f=fixture({existing:'acct_old'});assert.equal(await f.start(),null);assert.equal(f.calls.length,0);
 process.env.STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED='false';delete process.env.STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID;
 const old=fixture({schemaMissing:true});assert.equal(await old.start(),null);assert.equal(old.calls.length,0);
});
test('browser ownership, permanent marker and payment boundary cannot silently fall back',async()=>{
 const f=fixture();f.request.headers.set('origin','https://foreign.test');await assert.rejects(f.start(),/this Studio OS page/);assert.equal(f.calls.length,0);
 const api=f.api;process.env.STRIPE_SECRET_KEY='sk_live_intercepted';process.env.NEXT_PUBLIC_SUPABASE_URL='https://bwqhzczxoevouiondjak.supabase.co';process.env.STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID='acct_1TBlT4PxlnWeytFA';process.env.STUDIO_PAYMENT_EXPECTED_APP_URL='https://www.studiooscloud.com';process.env.VERCEL_ENV='preview';assert.throws(()=>api.assertStandardSignupEnvironment(),/environment/);
 process.env.STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED='false';const required=fixture({schemaMissing:true});required.photographer.stripe_account_history_required=true;await assert.rejects(required.start(),/saved Stripe connection/);
});

test('connect route rejects a blocked signup before deleted-account GETs or profile and branding writes',async()=>{
 for(const enabled of ['true','false']){
  const f=fixture({ready:true});await f.start();f.intent.status='blocked';f.photographer.stripe_account_history_required=true;f.calls.length=0;
  process.env.STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED=enabled;
  const before=structuredClone(f.photographer);let forbiddenCalls=0;
  const forbidden=()=>{forbiddenCalls++;throw Error('Blocked signup must not call profile/provider mutations or the deleted account.');};
  const route=load('app/api/stripe/connect/route.ts',{
   'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
   '@/lib/dashboard-auth':{resolveDashboardAuth:async()=>({user:{id:'owner',email:'first@example.test'},mfaSatisfied:true}),createDashboardServiceClient:()=>f.service},
   '@/lib/payments':{getOrCreatePhotographerByUser:async()=>f.photographer,configureConnectBusinessProfile:forbidden,retrieveStripeAccount:forbidden,createConnectedAccount:forbidden,createConnectedAccountLink:forbidden,syncConnectState:forbidden},
   '@/lib/stripe-connect-country':country,'@/lib/stripe-standard-signup':f.api,'@/lib/stripe-standard-connect':standard,
  });
  const response=await route.POST({...f.request,json:async()=>({businessCountry:'US',salesCurrency:'usd',businessName:'Must not save',studioName:'Must not save'})});
  assert.equal(response.status,409);const body=await response.json();assert.equal(body.ok,false);assert.match(body.message,/support review/);assert.equal(body.url,undefined);
  assert.equal(forbiddenCalls,0);assert.equal(f.calls.length,0);assert.deepEqual(f.photographer,before);assert.equal(f.intent.status,'blocked');
 }
});

test('connect preflight validates owner, frozen intent, selected pointers and actual permanent marker without provider calls',async()=>{
 for(const mutate of [f=>f.intent.actor_user_id='foreign',f=>f.intent.request_hash='bad',f=>f.intent.platform_account_id='acct_foreign',f=>f.photographer.stripe_account_id='acct_foreign']){
  const f=fixture({ready:true});await f.start();mutate(f);f.calls.length=0;
  await assert.rejects(f.api.assertStandardSignupConnectAllowed(f.service,{photographer:f.photographer,userId:'owner'}));assert.equal(f.calls.length,0);
 }
 const f=fixture();f.photographer.stripe_account_history_required=true;
 const projection={...f.photographer};delete projection.stripe_account_history_required;
 await assert.rejects(f.api.assertStandardSignupConnectAllowed(f.service,{photographer:projection,userId:'owner'}),/support review/);assert.equal(f.calls.length,0);
 await assert.rejects(f.api.assertStandardSignupConnectAllowed(f.service,{photographer:f.photographer,userId:'foreign'}),/another owner/);assert.equal(f.calls.length,0);
});

test('connect preflight selects the intended payment mode and keeps legacy feature-off schema compatibility',async()=>{
 const f=fixture({ready:true});await f.start();f.calls.length=0;
 const conditions=[];const original=f.service.from.bind(f.service);
 const rows=[structuredClone(f.intent),{...structuredClone(f.intent),id:'other-mode',livemode:true,status:'blocked'}];
 const service={...f.service,from(table){if(table!=='photographer_stripe_standard_signups')return original(table);
  const q={select(){return q},eq(key,value){conditions.push([key,value]);return q},async maybeSingle(){const matches=rows.filter(row=>conditions.every(([key,value])=>row[key]===value));return matches.length>1?{data:null,error:{code:'PGRST116'}}:{data:matches[0]||null,error:null}}};return q;}};
 await f.api.assertStandardSignupConnectAllowed(service,{photographer:f.photographer,userId:'owner'});
 assert.ok(conditions.some(([key,value])=>key==='livemode'&&value===false));assert.equal(f.calls.length,0);
 process.env.STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED='false';delete process.env.STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID;
 const legacy=fixture({existing:'acct_old',schemaMissing:true});await legacy.api.assertStandardSignupConnectAllowed(legacy.service,{photographer:legacy.photographer,userId:'owner'});assert.equal(legacy.calls.length,0);
 legacy.photographer.stripe_account_history_required=true;await assert.rejects(legacy.api.assertStandardSignupConnectAllowed(legacy.service,{photographer:legacy.photographer,userId:'owner'}));assert.equal(legacy.calls.length,0);
});


test('new regional signup accepts its supported sales currency and rejects an unsupported scope before creating a provider account',async()=>{
 for(const [country,salesCurrency]of [['AU','aud'],['GB','gbp']]){const f=fixture({country,salesCurrency});await f.start();assert.equal(f.intent.country,country);assert.deepEqual(f.intent.allowed_currencies,['cad','usd','aud','gbp']);assert.equal(f.provider.country,country);}
 for(const salesCurrency of ['eur','jpy']){const f=fixture({country:'AU',salesCurrency});await assert.rejects(f.start(),/CAD, USD, AUD or GBP/);assert.equal(f.calls.some(c=>c.path==='accounts'),false);assert.equal(f.calls.some(c=>c.rpc==='reserve_photographer_standard_signup'),false);}
});

test('historical CA and US signup scope remains unchanged and cannot be forged for a regional country',async()=>{
 for(const country of ['CA','US']){const f=fixture({country,allowedCurrencies:['cad','usd'],ready:true});await f.start();const frozen=structuredClone(f.intent.allowed_currencies);process.env.STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED='false';await f.start();assert.deepEqual(f.intent.allowed_currencies,frozen);process.env.STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED='true';}
 for(const options of [{country:'AU',allowedCurrencies:['cad','usd']},{country:'GB',allowedCurrencies:['cad','usd']},{allowedCurrencies:['cad','usd','eur','gbp']},{allowedCurrencies:['cad','usd','aud','aud']}]){const f=fixture(options);await assert.rejects(f.start(),/original Stripe account request/);assert.equal(f.calls.some(c=>c.path==='accounts'),false);}
});
