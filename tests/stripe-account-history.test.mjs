import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled=ts.transpileModule(readFileSync(new URL('../lib/stripe-connect-history.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
function load(env={}) {
  const exports={};
  new Function('exports','process','fetch',compiled)(exports,{env},()=>assert.fail('History helpers must never call Stripe'));
  return exports;
}
const missing={code:'PGRST202',message:'RPC not installed'};
function service({rpcError=missing,rpcData=null,marker=null,columnMissing=false,queryError=null}={}) {
  const calls=[];
  return {calls,
    async rpc(name,params){calls.push({rpc:name,params});return {data:rpcData,error:rpcError};},
    from(table){
      const query={table,fields:'',field:'',value:''};calls.push(query);
      const chain={select(fields){query.fields=fields;return chain;},eq(field,value){query.field=field;query.value=value;return chain;},
        async maybeSingle(){
          if(queryError)return {error:queryError,data:null};
          if(columnMissing&&query.fields.includes('stripe_standard_migrated_at'))return {data:null,error:{code:'42703'}};
          return {error:null,data:{id:'owner',stripe_account_id:'acct_legacy',stripe_connected_account_id:'acct_legacy',
            ...(query.fields.includes('stripe_standard_migrated_at')?{stripe_standard_migrated_at:marker}:{})}};
        }};return chain;
    }};
}

test('historical account lookup runs with migration feature disabled and never reads active pointer on success',async()=>{
  const history=load();const db=service({rpcError:null,rpcData:'acct_old'});
  assert.equal(history.standardSwitchEnabled(),false);
  assert.equal(await history.resolveOrderPaymentAccount(db,{photographerId:'owner',orderId:'order',expectedAccount:'acct_old',livemode:false}),'acct_old');
  assert.equal(db.calls.length,1);
  assert.equal(db.calls[0].params.p_livemode,false);
});
test('only genuinely unmigrated schemas permit current-account compatibility',async()=>{
  const history=load();
  for(const columnMissing of [false,true]){
    const db=service({columnMissing});
    assert.equal(await history.resolveOrderPaymentAccount(db,{photographerId:'owner',orderId:'order'}),'acct_legacy');
  }
  const migrated=service({marker:'2026-10-13T00:00:00Z'});
  await assert.rejects(()=>history.resolveOrderPaymentAccount(migrated,{photographerId:'owner',orderId:'order'}),/original Stripe/);
  await assert.rejects(()=>history.getCheckoutRouting(migrated,{photographerId:'owner'}),/original Stripe/);
  const wrong=service();
  await assert.rejects(()=>history.resolveOrderPaymentAccount(wrong,{photographerId:'owner',orderId:'order',expectedAccount:'acct_wrong'}),/mismatch/);
});
test('database/network/provider-shape errors fail closed rather than switching account',async()=>{
  const history=load();
  const broken=service({rpcError:{code:'42501',message:'permission denied'}});
  await assert.rejects(()=>history.resolveOrderPaymentAccount(broken,{photographerId:'owner',orderId:'order'}));
  assert.equal(broken.calls.length,1);
  const malformed=service({rpcError:null,rpcData:null});
  await assert.rejects(()=>history.resolveOrderPaymentAccount(malformed,{photographerId:'owner',orderId:'order'}),/saved payment/);
  assert.equal(malformed.calls.length,1);
  assert.equal(history.isStripeHistorySchemaMissing(new Error('timeout')),false);
  assert.equal(history.isStripeHistorySchemaMissing({code:'42702'}),false);
});
test('live activation/rollback is rejected locally before any database mutation',async()=>{
  const history=load();const db=service();
  const input={photographerId:'owner',userId:'user',accountId:'acct_standard',expectedCurrentAccountId:'acct_legacy',livemode:true};
  await assert.rejects(()=>history.activateStandardAccount(db,input),/Live payment migration/);
  await assert.rejects(()=>history.rollbackStandardAccount(db,input),/Live payment migration/);
  assert.equal(db.calls.length,0);
});
test('legacy reservation compatibility is unavailable once migration marker exists',async()=>{
  const history=load();const input={photographerId:'owner',orderIds:['order'],anchorOrderId:'order',expectedAccountId:'acct_legacy',expectedRouteVersion:0,amountCents:6000,currency:'cad',idempotencyKey:'stable'};
  assert.deepEqual(await history.reserveOrderPaymentAccount(service(),input),{attemptId:null,accountId:'acct_legacy',idempotencyKey:'stable',routeVersion:0});
  await assert.rejects(()=>history.reserveOrderPaymentAccount(service({marker:'2026-10-13'}),input),/original Stripe/);
  await assert.rejects(()=>history.reserveOrderPaymentAccount(service(),{...input,expectedAccountId:'acct_other'}),/changed/);
});
test('Standard checkout and reservation reject live credentials or remote databases before writes',async()=>{
  const route={accountId:'acct_standard',routeVersion:1,feeRateCents:45,connectionType:'standard',livemode:false};
  for(const env of [{STRIPE_SECRET_KEY:'sk_live_example',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321'},
    {STRIPE_SECRET_KEY:'sk_test_example',NEXT_PUBLIC_SUPABASE_URL:'https://remote.supabase.co'}]){
    const history=load(env),db=service({rpcError:null,rpcData:route});
    await assert.rejects(()=>history.getCheckoutRouting(db,{photographerId:'owner'}),/restricted/);
    db.calls.length=0;
    await assert.rejects(()=>history.reserveOrderPaymentAccount(db,{photographerId:'owner',orderIds:['order'],anchorOrderId:'order',
      expectedAccountId:'acct_standard',expectedRouteVersion:1,amountCents:6000,currency:'cad',idempotencyKey:'key'}),/restricted/);
    assert.equal(db.calls.filter(c=>c.rpc==='reserve_order_payment_account').length,0);
  }
  const local=load({STRIPE_SECRET_KEY:'sk_test_example',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321'});
  assert.deepEqual(await local.getCheckoutRouting(service({rpcError:null,rpcData:route}),{photographerId:'owner'}),{...route,feeRateCents:null});
  // A saved Standard payment remains readable even under live-key/remote env.
  const historical=load({STRIPE_SECRET_KEY:'sk_live_example',NEXT_PUBLIC_SUPABASE_URL:'https://remote.supabase.co'});
  assert.equal(await historical.resolveOrderPaymentAccount(service({rpcError:null,rpcData:'acct_standard'}),{photographerId:'owner',orderId:'order'}),'acct_standard');
});

const liveEnvironment = {
  STRIPE_SECRET_KEY:'sk_live_verified', NEXT_PUBLIC_SUPABASE_URL:'https://bwqhzczxoevouiondjak.supabase.co',
  STUDIO_STANDARD_EXPECTED_PLATFORM_ACCOUNT_ID:'acct_1TBlT4PxlnWeytFA',
  STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED:'true', STRIPE_STANDARD_MIGRATION_ENABLED:'true', STRIPE_STANDARD_LIVE_MIGRATION_ENABLED:'true',
};
const liveIdentity = {
  photographerId:'ed6b8a99-1f38-48f3-a198-447c49b5ac34', userId:'4a9f37fe-d217-4edd-bcf9-3a561da2e2f0',
  accountId:'acct_1UQHR5LZhEC2SlmP',expectedCurrentAccountId:'acct_1TIHTrLqg5vdCgpU',livemode:true,
};
const freshProof = (accountId=liveIdentity.accountId) => ({platformAccountId:'acct_1TBlT4PxlnWeytFA',accountId,livemode:true,verifiedAt:new Date().toISOString()});

test('live history mutations require every explicit environment gate and fresh exact provider identity',async()=>{
  const input={...liveIdentity,providerProof:freshProof()};
  for(const missing of Object.keys(liveEnvironment)){
    const env={...liveEnvironment};delete env[missing];const api=load(env),db=service();
    await assert.rejects(()=>api.activateStandardAccount(db,input),/disabled|unverified/);
    assert.equal(db.calls.length,0);
  }
  const api=load(liveEnvironment);
  for(const invalid of [
    {...input,photographerId:'another-photographer'}, {...input,userId:'another-user'},
    {...input,accountId:'acct_other'}, {...input,expectedCurrentAccountId:'acct_other'},
    {...input,providerProof:undefined}, {...input,providerProof:{...freshProof(),accountId:'acct_other'}},
    {...input,providerProof:{...freshProof(),platformAccountId:'acct_other'}},
    {...input,providerProof:{...freshProof(),verifiedAt:new Date(Date.now()-6*60*1000).toISOString()}},
    {...input,providerProof:{...freshProof(),verifiedAt:new Date(Date.now()+60000).toISOString()}},
  ]){
    const db=service();await assert.rejects(()=>api.activateStandardAccount(db,invalid));assert.equal(db.calls.length,0);
  }
  const db=service({rpcError:null,rpcData:{accountId:input.accountId,previousAccountId:input.expectedCurrentAccountId,routeVersion:1}});
  assert.equal((await api.activateStandardAccount(db,input)).accountId,input.accountId);
  assert.deepEqual(db.calls[0].params.p_provider_proof,input.providerProof);
  const wrongDirection=service();
  await assert.rejects(()=>api.rollbackStandardAccount(wrongDirection,input),/direction/);assert.equal(wrongDirection.calls.length,0);
  const rollback={...input,accountId:input.expectedCurrentAccountId,expectedCurrentAccountId:input.accountId,providerProof:freshProof(input.expectedCurrentAccountId)};
  const restored=service({rpcError:null,rpcData:{accountId:rollback.accountId,previousAccountId:rollback.expectedCurrentAccountId,routeVersion:2}});
  assert.equal((await api.rollbackStandardAccount(restored,rollback)).accountId,rollback.accountId);
});

test('live checkout survives disabling onboarding but remains exact-scope and fee-policy neutral',async()=>{
  const env={...liveEnvironment,STRIPE_STANDARD_MIGRATION_ENABLED:'false',STRIPE_STANDARD_LIVE_MIGRATION_ENABLED:'false'};
  const api=load(env),route={accountId:liveIdentity.accountId,routeVersion:1,feeRateCents:45,connectionType:'standard',livemode:true};
  const result=await api.getCheckoutRouting(service({rpcError:null,rpcData:route}),{photographerId:liveIdentity.photographerId,currency:'usd'});
  assert.equal(result.accountId,liveIdentity.accountId);assert.equal(result.feeRateCents,null);
  await assert.rejects(()=>api.getCheckoutRouting(service({rpcError:null,rpcData:route}),{photographerId:'another-photographer'}),/restricted/);
  await assert.rejects(()=>api.getCheckoutRouting(service({rpcError:null,rpcData:{...route,accountId:'acct_other'}}),{photographerId:liveIdentity.photographerId}),/restricted/);
  const disabled=load({...env,STRIPE_STANDARD_LIVE_CHECKOUT_ENABLED:'false'});
  await assert.rejects(()=>disabled.getCheckoutRouting(service({rpcError:null,rpcData:route}),{photographerId:liveIdentity.photographerId}),/disabled/);
});

test('live registration always requires provider GET proof even for the retained Express account',async()=>{
  const api=load(liveEnvironment),scope=api.WHITEPHOTO_STANDARD_LIVE_SCOPE;
  for(const accountId of [scope.expressAccountId,scope.standardAccountId]){
    const account={id:accountId,type:accountId===scope.standardAccountId?'standard':'express'};
    const input={photographerId:scope.photographerId,userId:scope.userId,account,livemode:true};
    const denied=service();await assert.rejects(()=>api.registerStripeAccountCandidate(denied,input),/proof/);assert.equal(denied.calls.length,0);
    const db=service({rpcError:null,rpcData:{photographer_id:scope.photographerId,stripe_account_id:accountId}});
    await api.registerStripeAccountCandidate(db,{...input,providerProof:freshProof(accountId)});
    assert.equal(db.calls[0].params.p_provider_proof.accountId,accountId);
  }
});

test('claimable CLI sandbox key requires local database plus independently verified sandbox platform marker',async()=>{
  const base={STRIPE_SECRET_KEY:'rkcs_test_claimable',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321'};
  assert.throws(()=>load(base).assertStandardCheckoutTestMode(),/restricted/);
  assert.doesNotThrow(()=>load({...base,STUDIO_STANDARD_SANDBOX_PLATFORM_VERIFIED:'true',STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID:'acct_sandbox'}).assertStandardCheckoutTestMode());
  assert.throws(()=>load({...base,STUDIO_STANDARD_SANDBOX_PLATFORM_VERIFIED:'true',STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID:'acct_sandbox',NEXT_PUBLIC_SUPABASE_URL:'https://remote.supabase.co'}).assertStandardCheckoutTestMode(),/restricted/);
});
