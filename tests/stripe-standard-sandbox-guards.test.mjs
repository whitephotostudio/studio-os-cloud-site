import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertSandboxConfiguration,createGuardedSandboxProvider,readProtectedTestKey,readProtectedLocalSupabase,redactSandboxError,loadActualApplication,runRehearsal,parseRehearsalArguments } from '../scripts/stripe-standard-sandbox-rehearsal.mjs';
import { openStandardSandboxDatabase } from './helpers/standard-sandbox-db.mjs';

const key='sk_test_GuardFixtureOnly',expectedPlatform='acct_SandboxFixture';
const cfg={key,expectedPlatform};
const account={id:'acct_RehearsalMerchant',email:'merchant@example.test',metadata:{studio_standard_rehearsal:'run-fixture'}};
const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'request-id':'req_fixture'}});

test('explicit retry-after-definitive400 arguments are recognized and typos/duplicate flags fail closed',()=>{
  assert.deepEqual(parseRehearsalArguments(['--retry-definitive-400','yes','--phase','prepare']),{retryDefinitive400:'yes',phase:'prepare'});
  for(const values of [['--retry-definitive-40','yes'],['--phase','prepare','--phase','payments'],['--key-file']])assert.throws(()=>parseRehearsalArguments(values));
});
function fixture({wrongPlatform=false,liveBalance=false,maxPosts=10}={}){
  const calls=[];
  const fetchImpl=async(url,settings)=>{const path=new URL(url).pathname.slice(4);calls.push({path,...settings});
    if(path==='account')return response({id:wrongPlatform?'acct_Unexpected':expectedPlatform});
    if(path==='balance')return response({object:'balance',livemode:liveBalance});
    if(path===`accounts/${account.id}`)return response(account);
    return response({id:'pi_testfixture',livemode:false,status:'succeeded'});
  };
  return{calls,provider:createGuardedSandboxProvider({...cfg,fetchImpl,maxPosts})};
}

test('sandbox refuses live/restricted keys, known live accounts, production runtime and remote databases',()=>{
  for(const bad of ['sk_live_fake','rk_test_fake','pk_test_fake','',undefined])assert.throws(()=>assertSandboxConfiguration({...cfg,key:bad}),/TEST key/);
  for(const id of ['acct_1TBlT4PxlnWeytFA','acct_1TIHTrLqg5vdCgpU','acct_1UQHR5LZhEC2SlmP','acct_1QGuOtIy738lmoke'])assert.throws(()=>assertSandboxConfiguration({...cfg,expectedPlatform:id}),/TEST key/);
  for(const database of ['https://project.supabase.co','postgresql://prod@database.example/db','file:///tmp/local'])assert.throws(()=>assertSandboxConfiguration({...cfg,database}),/loopback/);
  for(const origin of ['https://studiooscloud.com','https://localhost','http://localhost.evil.example','http://user:pass@localhost'])assert.throws(()=>assertSandboxConfiguration({...cfg,origin}),/loopback/);
  for(const env of [{STRIPE_SECRET_KEY:'sk_live_secret'},{NEXT_PUBLIC_SUPABASE_URL:'https://production.supabase.co'},{DATABASE_URL:'postgresql://postgres@prod.example/database'},{VERCEL_ENV:'preview'},{NODE_ENV:'production'}])assert.throws(()=>assertSandboxConfiguration(cfg,env));
  assert.ok(assertSandboxConfiguration({...cfg,key:'rkcs_test_OfficialCliFixtureOnly'}));
});

test('private explicit test credential reading never falls back to ambient/repository credentials',t=>{
  const directory=mkdtempSync(join(tmpdir(),'standard-guard-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'config.toml');writeFileSync(path,`[default]\naccount_id = "${expectedPlatform}"\ntest_mode_api_key = "${key}"\n`,{mode:0o600});
  assert.equal(readProtectedTestKey(path,expectedPlatform),key);
  assert.throws(()=>readProtectedTestKey(path,'acct_Other'),/another/);
  chmodSync(path,0o644);assert.throws(()=>readProtectedTestKey(path,expectedPlatform),/mode0600/);
  chmodSync(path,0o600);writeFileSync(path,'sk_live_fake');assert.throws(()=>readProtectedTestKey(path,expectedPlatform),/TEST key/);
});

test('genuine Supabase mode pins both loopback service and Next origins without importing Stripe credentials',t=>{
  const directory=mkdtempSync(join(tmpdir(),'standard-local-env-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'local.env');
  const contents='NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55421\nNEXT_PUBLIC_APP_URL=http://127.0.0.1:55430\nNEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-unit-anon\nSUPABASE_SERVICE_ROLE_KEY=synthetic-unit-service\n';
  writeFileSync(path,contents,{mode:0o600});assert.equal(readProtectedLocalSupabase(path).database,'http://127.0.0.1:55421');
  for(const bad of [contents.replace('127.0.0.1:55421','production.supabase.co'),contents.replace('55421','54321'),contents+'STRIPE_SECRET_KEY=sk_live_fake\n']){
    writeFileSync(path,bad);assert.throws(()=>readProtectedLocalSupabase(path));
  }
  writeFileSync(path,contents);chmodSync(path,0o644);assert.throws(()=>readProtectedLocalSupabase(path),/private/);
});

test('exact real account AND explicit false balance are mandatory before any provider POST',async()=>{
  const f=fixture();
  await assert.rejects(()=>f.provider.request('payment_intents',{method:'POST',idempotencyKey:'studio-standard-test-preflight'}),/Fresh exact/);
  assert.equal(f.calls.length,0);
  for(const options of [{wrongPlatform:true},{liveBalance:true}]){
    const denied=fixture(options);await assert.rejects(()=>denied.provider.preflight());
    await assert.rejects(()=>denied.provider.request('accounts',{method:'POST',idempotencyKey:'studio-standard-test-preflight'}),/Fresh exact/);
    assert.ok(denied.calls.every(call=>call.method==='GET'));
  }
});

test('owned connected accounts, synthetic identities, pinned API and immutable idempotency bound writes',async()=>{
  const f=fixture();await f.provider.preflight();await f.provider.adopt(account.id,'run-fixture');
  await assert.rejects(()=>f.provider.request('payment_intents',{method:'POST',account:'acct_Unknown',idempotencyKey:'studio-standard-test-a'}),/owned/);
  await assert.rejects(()=>f.provider.request('payment_intents',{method:'POST',account:account.id,idempotencyKey:'ordinary-key'}),/durable/);
  await assert.rejects(()=>f.provider.request('refunds',{method:'POST',idempotencyKey:'studio-standard-test-a'}),/connected account/);
  await assert.rejects(()=>f.provider.request('accounts',{method:'POST',body:new URLSearchParams({type:'standard',email:'real@example.com'}),idempotencyKey:'studio-standard-test-a'}),/synthetic/);
  await assert.rejects(()=>f.provider.request('account_links',{method:'POST',body:new URLSearchParams({account:'acct_Unknown'}),idempotencyKey:'studio-standard-test-a'}),/owned/);
  await assert.rejects(()=>f.provider.guardedFetch('https://studiooscloud.com/api/stripe/checkout'),/real Stripe/);
  await assert.rejects(()=>f.provider.guardedFetch('https://api.stripe.com/v1/payment_intents',{headers:{Authorization:'Bearer sk_live_nope'}}),/another credential/);
  await assert.rejects(()=>f.provider.request('accounts/acct_any',{method:'DELETE'}),/Destructive/);
  await assert.rejects(()=>f.provider.request('balance_transactions',{method:'POST'}),/bounded/);
  const result=await f.provider.request('payment_intents',{method:'POST',account:account.id,body:new URLSearchParams({amount:'3000',currency:'cad'}),idempotencyKey:'studio-standard-test-approved'});
  assert.equal(result.livemode,false);
  const call=f.calls.at(-1);assert.equal(call.headers['Stripe-Account'],account.id);assert.equal(call.headers['Idempotency-Key'],'studio-standard-test-approved');
});

test('application helper fetch preserves real encoded request through independent boundary checks',async()=>{
  const f=fixture();await f.provider.preflight();await f.provider.adopt(account.id,'run-fixture');
  const response=await f.provider.guardedFetch('https://api.stripe.com/v1/payment_intents',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Stripe-Account':account.id,'Idempotency-Key':'studio-standard-test-helper'},body:'amount=3000&currency=usd'});
  assert.equal((await response.json()).status,'succeeded');assert.equal(f.calls.at(-1).body,'amount=3000&currency=usd');
  await assert.rejects(()=>f.provider.request('checkout/sessions',{method:'POST',account:account.id,body:new URLSearchParams({success_url:'https://studiooscloud.com/success'}),idempotencyKey:'studio-standard-test-redirect'}),/loopback/);
});

test('test diagnostics redact all supported credential and payment-client-secret forms',()=>{
  for(const secret of ['sk_test_abc123','sk_live_abc123','rkcs_test_abc123','whsec_abc123','pi_abc_secret_def'])assert.equal(redactSandboxError(`Error ${secret}`),'Error [redacted]');
});

test('disposable real SQL history and actual app quotes enforce nominal55/45 in CAD/USD',async()=>{
  const {db,service,migrations}=await openStandardSandboxDatabase();
  try{
    assert.ok(migrations.some(file=>file.includes('stripe_account_history')));
    const app=loadActualApplication(service);
    for(const currency of ['cad','usd'])for(const[plan,rate]of[['starter',55],['core',45],['studio',45]]){
      const quote=await app.payments.quoteDirectOrderPlatformFees({pricingProfile:'gallery_v3',planCode:plan,subscriptionStatus:'active',isPlatformAdmin:false,currency,orders:[{id:randomUUID(),totalCents:3000},{id:randomUUID(),totalCents:3000}]});
      assert.equal(quote.amountCents,rate*2);assert.equal(quote.rateCents,rate);assert.equal(quote.currency,currency);
    }
    const waived=await app.payments.quoteDirectOrderPlatformFees({pricingProfile:'gallery_v3',planCode:'starter',subscriptionStatus:'active',isPlatformAdmin:false,currency:'cad',orders:[{id:randomUUID(),totalCents:3000,isTest:true}]});
    assert.equal(waived.amountCents,0);
    const controls=(await db.query("select migration_enabled,checkout_enabled from stripe_standard_live_release_controls where release_key='whitephoto-20261015'")).rows[0];
    assert.equal(controls.migration_enabled,false,'Rehearsal migrations must never enable live migration controls');
    assert.equal(controls.checkout_enabled,false);
  }finally{await db.close();}
});

test('rehearsal integration uses actual SQL/app helpers, retains original accounts and never calls an unpinned transport',async t=>{
  // This provider is deliberately synthetic. This regression exercises the
  // rehearsal itself; it is NOT real Stripe or release/payment evidence.
  const directory=mkdtempSync(join(tmpdir(),'standard-harness-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  chmodSync(directory,0o700);
  const keyFile=join(directory,'test-key');writeFileSync(keyFile,key,{mode:0o600});
  const previousFetch=globalThis.fetch;
  const envNames=['STRIPE_SECRET_KEY','NEXT_PUBLIC_SUPABASE_URL','STRIPE_STANDARD_MIGRATION_ENABLED','STUDIO_GALLERY_PRICING_V3_ENABLED','STUDIO_STANDARD_SANDBOX_PLATFORM_VERIFIED','STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID'];
  const previousEnv=Object.fromEntries(envNames.map(name=>[name,process.env[name]]));
  t.after(()=>{globalThis.fetch=previousFetch;for(const name of envNames){if(previousEnv[name]===undefined)delete process.env[name];else process.env[name]=previousEnv[name];}});
  for(const name of envNames)delete process.env[name];
  const objects=new Map(),idempotency=new Map(),refunds=[];let sequence=0;
  const id=prefix=>`${prefix}_${++sequence}`;
  const paramsRecord=(body,prefix)=>Object.fromEntries([...body].filter(([k])=>k.startsWith(prefix+'[')).map(([k,v])=>[k.slice(prefix.length+1,-1),v]));
  const calls=[];
  globalThis.fetch=async(url,settings={})=>{
    assert.equal(new URL(url).origin,'https://api.stripe.com');
    const path=new URL(url).pathname.slice(4),headers=new Headers(settings.headers),body=new URLSearchParams(settings.body),method=settings.method||'GET';
    calls.push({path,method,account:headers.get('stripe-account')});
    if(method==='GET'){
      if(path==='account')return response({id:expectedPlatform});if(path==='balance')return response({object:'balance',livemode:false});
      if(path==='refunds')return response({data:refunds.filter(r=>r.payment_intent===new URL(url).searchParams.get('payment_intent')),has_more:false});
      const value=objects.get(path);assert.ok(value,`Unknown synthetic provider GET ${path}`);return response(value);
    }
    const replayKey=`${headers.get('stripe-account')}:${path}:${headers.get('idempotency-key')}`;
    if(idempotency.has(replayKey)){assert.equal(idempotency.get(replayKey).body,settings.body);return response(idempotency.get(replayKey).result);}
    let result;
    if(path==='accounts'){
      const type=body.get('type');result={id:id('acct'),type,country:'CA',email:body.get('email'),metadata:paramsRecord(body,'metadata'),livemode:false,details_submitted:true,charges_enabled:true,payouts_enabled:true,capabilities:{card_payments:'active',transfers:'active'},requirements:{currently_due:[],past_due:[],pending_verification:[],eventually_due:[],errors:[]},future_requirements:{currently_due:[],past_due:[],pending_verification:[],eventually_due:[],errors:[]},controller:{fees:{payer:type==='standard'?'account':'application_express'},losses:{payments:type==='standard'?'stripe':'application'},requirement_collection:'stripe',stripe_dashboard:{type:type==='standard'?'full':'express'}}};
      objects.set(`accounts/${result.id}`,result);
    }else if(path==='checkout/sessions'){
      result={id:id('cs'),livemode:false,mode:'payment',status:'open',payment_status:'unpaid',payment_intent:null,amount_total:Number(body.get('line_items[0][price_data][unit_amount]')),currency:body.get('line_items[0][price_data][currency]'),client_reference_id:body.get('client_reference_id'),metadata:paramsRecord(body,'metadata'),url:'https://checkout.stripe.com/c/test_synthetic'};objects.set(`${path}/${result.id}`,result);
    }else if(path==='payment_intents'){
      const chargeId=id('ch'),feeCents=Number(body.get('application_fee_amount')||0),feeId=feeCents?id('fee'):null;
      result={id:id('pi'),livemode:false,status:'succeeded',amount:Number(body.get('amount')),amount_received:Number(body.get('amount')),currency:body.get('currency'),application_fee_amount:feeCents||null,latest_charge:chargeId,metadata:paramsRecord(body,'metadata')};
      objects.set(`payment_intents/${result.id}`,result);
      objects.set(`charges/${chargeId}`,{id:chargeId,livemode:false,amount:result.amount,amount_refunded:0,currency:result.currency,payment_intent:result.id,application_fee_amount:feeCents||null,application_fee:feeId});
      if(feeId)objects.set(`application_fees/${feeId}`,{id:feeId,object:'application_fee',livemode:false,account:headers.get('stripe-account'),charge:chargeId,amount:feeCents,amount_refunded:0,currency:result.currency,refunded:false});
    }else if(path==='refunds'){
      const intent=objects.get(`payment_intents/${body.get('payment_intent')}`),charge=objects.get(`charges/${intent.latest_charge}`);
      result={id:id('re'),payment_intent:intent.id,status:'succeeded',amount:Number(body.get('amount')),currency:intent.currency};refunds.push(result);charge.amount_refunded+=result.amount;
    }else if(/^application_fees\/fee_\d+\/refunds$/.test(path)){
      const fee=objects.get(path.replace('/refunds',''));fee.amount_refunded+=Number(body.get('amount'));fee.refunded=fee.amount_refunded===fee.amount;result={id:id('fr'),amount:Number(body.get('amount')),fee:fee.id};
    }else assert.fail(`Unknown synthetic provider write ${path}`);
    idempotency.set(replayKey,{body:settings.body,result});return response(result);
  };
  const options={keyFile,expectedPlatform,stateDir:join(directory,'state')};
  const prepared=await runRehearsal({...options,phase:'prepare'});assert.equal(prepared.needsTestOnboarding,false);
  const payments=await runRehearsal({...options,phase:'payments'});
  assert.equal(payments.actualFees.find(c=>c.case==='standard-starter-gallery-cad').fee,55);
  assert.equal(payments.actualFees.find(c=>c.case==='standard-core-event-usd').fee,45);
  assert.equal(payments.actualFees.find(c=>c.case==='standard-group-usd').fee,110);
  assert.deepEqual(payments.hostedCompletionPending,['old-express-open','new-standard-hosted']);
  await assert.rejects(()=>runRehearsal({...options,phase:'verify-hosted'}),/has not completed/);
  await runRehearsal({...options,phase:'rollback'});
  assert.ok(calls.some(call=>call.path==='refunds'&&call.account===prepared.accounts.express));
  assert.ok(calls.some(call=>call.path==='refunds'&&call.account===prepared.accounts.standard));
});
