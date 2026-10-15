import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash,createHmac } from 'node:crypto';
import { MERCHANT_ACCEPTANCE_SCOPE as scope,createMerchantTestProvider,assertDisposableAccount,assertEmptyDisposable,
  assertMerchantPhaseAllowed,verifyDisputeContext,readGenuineCapturedEvent,verifyInterruptedRecovery } from '../scripts/stripe-standard-merchant-acceptance.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'
  ?`{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>`${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`:JSON.stringify(value);
const runId='10000000-0000-4000-8000-000000000001';
function disposable(){return {id:'acct_disposableTest',type:'standard',country:'CA',controller:{fees:{payer:'account'},losses:{payments:'stripe'},requirement_collection:'stripe',stripe_dashboard:{type:'full'}},metadata:{studio_standard_merchant_acceptance:runId,photographer_id:scope.photographer,user_id:scope.owner}};}
const proof=()=>({runId,disposable:{accountId:'acct_disposableTest'}});
const empty=()=>({account:disposable(),proof:proof(),balance:{livemode:false,available:[{amount:0}],pending:[{amount:0}]},charges:{object:'list',data:[],has_more:false},intents:{object:'list',data:[],has_more:false},bindings:[]});
test('disposable candidate phases remain blocked until primary flows finish and root authorizes mutations',()=>{
  for(const phase of ['create-disposable','touch-disposable','delete-disposable']){
    assert.throws(()=>assertMerchantPhaseAllowed({phase,allowTestMutations:'yes'}),/Finish primary/);
    assert.throws(()=>assertMerchantPhaseAllowed({phase,primaryFlowsComplete:'yes'}),/Root/);
    assert.equal(assertMerchantPhaseAllowed({phase,allowTestMutations:'yes',primaryFlowsComplete:'yes'}),true);
  }
  assert.equal(assertMerchantPhaseAllowed({phase:'verify-deauthorization'}),false);
  assert.throws(()=>assertMerchantPhaseAllowed({phase:'close-dispute'}),/Root/);
});
function providerFixture({wrongPlatform=false,live=false}={}){
  const calls=[];let clock=1_000_000;
  const api=createMerchantTestProvider({key:'sk_test_merchant_unit',expectedPlatform:scope.platform,now:()=>clock,fetcher:async(url,options)=>{
    calls.push({url,options});const route=new URL(url).pathname.slice(4);
    return{ok:true,status:200,headers:new Headers({'request-id':'req_test'}),json:async()=>route==='account'?{id:wrongPlatform?'acct_foreign':scope.platform}:route==='balance'?{object:'balance',livemode:live}:route==='accounts'?disposable():{id:route.split('/')[1],deleted:options.method==='DELETE',livemode:false}};
  }});
  return{api,calls,advance:()=>{clock+=300001;}};
}
test('merchant provider rejects every write before fresh exact owned test platform and balance proof',async()=>{
  const f=providerFixture();await assert.rejects(f.api.request('accounts',{method:'POST',allowMutation:true,idempotencyKey:'studio-standard-merchant-test-one',body:new URLSearchParams()}),/fresh/);assert.equal(f.calls.length,0);
  await assert.rejects(providerFixture({wrongPlatform:true}).api.preflight(),/proof failed/);
  await assert.rejects(providerFixture({live:true}).api.preflight(),/live/);
  assert.throws(()=>createMerchantTestProvider({key:'sk_live_no',expectedPlatform:scope.platform}),/TEST/);
  assert.throws(()=>createMerchantTestProvider({key:'sk_test_mock',expectedPlatform:'acct_1TBlT4PxlnWeytFA'}),/TEST/);
});
test('bounded provider cannot charge customers, delete either primary account or target a foreign host/account',async()=>{
  const f=providerFixture();await f.api.preflight();const options={method:'DELETE',allowMutation:true,idempotencyKey:'studio-standard-merchant-test-delete'};
  for(const id of [scope.platform,scope.express,scope.standard,'acct_notAdopted'])await assert.rejects(f.api.request('accounts/'+id,options),/disposable/);
  await assert.rejects(f.api.request('payment_intents',{...options,method:'POST',account:scope.standard,body:new URLSearchParams({amount:'100'})}),/No customer payment/);
  await assert.rejects(f.api.request('https://evil.example/v1/account'),/official/);
  await assert.rejects(f.api.request('balance',{account:'acct_unknown'}),/scope/);
  f.api.adoptDisposable('acct_disposableTest');await f.api.request('accounts/acct_disposableTest',options);
  assert.equal(f.calls.at(-1).options.method,'DELETE');assert.equal(f.calls.at(-1).options.headers['Stripe-Account'],undefined);
  f.advance();await assert.rejects(f.api.request('accounts/acct_disposableTest',options),/fresh/);
});
test('Standard creation is restricted to synthetic email and exact securely marked owner',async()=>{
  const f=providerFixture();await f.api.preflight();const body=new URLSearchParams({type:'standard',country:'CA',email:'events@example.test','metadata[studio_standard_merchant_acceptance]':runId,'metadata[photographer_id]':scope.photographer,'metadata[user_id]':scope.owner});
  await f.api.request('accounts',{method:'POST',body,allowMutation:true,idempotencyKey:'studio-standard-merchant-test-create'});
  body.set('metadata[user_id]','foreign');await assert.rejects(f.api.request('accounts',{method:'POST',body,allowMutation:true,idempotencyKey:'studio-standard-merchant-test-other'}),/securely marked/);
  assert.throws(()=>f.api.adoptDisposable(scope.standard),/separate/);
});
test('disposable deletion readiness excludes primary accounts, foreign metadata and any financial state',()=>{
  assert.equal(assertDisposableAccount(disposable(),proof()).id,'acct_disposableTest');assert.doesNotThrow(()=>assertEmptyDisposable(empty()));
  for(const patch of [{id:scope.standard},{metadata:{}},{type:'express'}])assert.throws(()=>assertDisposableAccount({...disposable(),...patch},proof()),/disposable/);
  for(const patch of [{balance:{livemode:true,available:[],pending:[]}},{balance:{livemode:false,available:[{amount:1}],pending:[]}},{charges:{object:'list',data:[{id:'ch_any'}],has_more:false}},{intents:{object:'list',data:[],has_more:true}},{bindings:[{id:'financial'}]}])assert.throws(()=>assertEmptyDisposable({...empty(),...patch}),/zero/);
});
function disputeFixture(){
  const order={id:'10000000-0000-4000-8000-000000000010',photographer_id:scope.photographer,order_group_id:null,total_cents:3000,currency:'cad',stripe_payment_account_binding_id:'binding',stripe_payment_intent_id:'pi_test',platform_fee_collection_method:'application_fee',platform_fee_amount_cents:55,platform_fee_currency:'cad',platform_fee_rate_cents:55};
  const binding={id:'binding',photographer_id:scope.photographer,stripe_account_id:scope.standard,livemode:false,order_ids:[order.id],amount_cents:3000,currency:'cad',fee_snapshot:[{id:order.id,platform_fee_collection_method:'application_fee',platform_fee_amount_cents:55,platform_fee_currency:'cad',platform_fee_rate_cents:55}]};
  const payment={id:'pi_test',livemode:false,status:'succeeded',amount:3000,amount_received:3000,currency:'cad',application_fee_amount:55,latest_charge:'ch_test',metadata:{billing_flow:'customer_order',photographer_id:scope.photographer,order_id:order.id}};
  const charge={id:'ch_test',livemode:false,payment_intent:'pi_test',amount:3000,currency:'cad'};
  const dispute={id:'du_test',livemode:false,charge:'ch_test',payment_intent:'pi_test',amount:3000,currency:'cad',status:'needs_response'};
  const calls=[];const service={from(table){const q={select(){return q;},eq(){return q;},single:async()=>({data:table==='orders'?order:binding,error:null}),then(resolve,reject){return Promise.resolve({data:[order],error:null}).then(resolve,reject);}};return q;}};
  const provider={request:async(route,options)=>{calls.push({route,options});assert.equal(options.account,scope.standard);return route.startsWith('payment_intents/')?payment:route.startsWith('charges/')?charge:dispute;}};
  return{order,binding,payment,charge,dispute,calls,service,provider,options:{service,provider,orderId:order.id,accountId:scope.standard,disputeId:'du_test'}};
}
test('genuine dispute verification follows current du IDs through original scoped payment, fee and immutable group',async()=>{
  const f=disputeFixture(),result=await verifyDisputeContext(f.options);assert.equal(result.fee,55);assert.equal(result.dispute.id,'du_test');
  assert.deepEqual(f.calls.map(call=>call.route),['payment_intents/pi_test','charges/ch_test','disputes/du_test']);assert.ok(f.calls.every(c=>!c.options.method));
});
test('dispute cannot borrow another account, changed frozen fee or copied unrelated charge',async()=>{
  for(const mutate of [f=>{f.binding.stripe_account_id=scope.express;},f=>{f.order.platform_fee_amount_cents=45;},f=>{f.payment.application_fee_amount=45;},f=>{f.dispute.charge='ch_foreign';}]){
    const f=disputeFixture();mutate(f);await assert.rejects(verifyDisputeContext(f.options),/differs|belong/);
  }
});
async function captureFixture(t,status=503){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'merchant-signature-unit-'));await fs.chmod(dir,0o700);t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const event={id:'evt_genuineunit',type:'account.updated',livemode:false,account:scope.standard,data:{object:{id:scope.standard}}},raw=Buffer.from(JSON.stringify(event)),secret='whsec_merchantunit',now=Date.now(),timestamp=Math.floor(now/1000);
  const signature=`t=${timestamp},v1=${createHmac('sha256',secret).update(`${timestamp}.`).update(raw).digest('hex')}`;
  const record={format:'stripe-cli-signed-test-delivery-v1',captureId:'unit',receivedAt:new Date(now).toISOString(),eventId:event.id,eventType:event.type,livemode:false,operatorPinnedPlatformId:scope.platform,signatureVerifiedAtCapture:true,originalStripeSignature:signature,rawBodyBase64:raw.toString('base64'),rawBodySha256:sha(raw)};
  const captureFile=path.join(dir,'unit.delivery.json'),secretFile=path.join(dir,'secret');
  await fs.writeFile(captureFile,JSON.stringify(record),{mode:0o600});await fs.writeFile(secretFile,secret,{mode:0o600});await fs.writeFile(path.join(dir,'unit.result.json'),JSON.stringify({captureId:'unit',forwardedRawBodySha256:sha(raw),upstreamStatus:status}),{mode:0o600});
  return{dir,event,record,captureFile,secretFile};
}
test('interruption evidence requires original signature, exact raw hash and actual Next503 result',async t=>{
  const f=await captureFixture(t);assert.equal((await readGenuineCapturedEvent({...f,resultStatus:503})).event.id,f.event.id);
  await assert.rejects(readGenuineCapturedEvent({...f,resultStatus:200}),/HTTP result/);
  f.record.rawBodySha256='0'.repeat(64);await fs.writeFile(f.captureFile,JSON.stringify(f.record),{mode:0o600});await assert.rejects(readGenuineCapturedEvent({...f,resultStatus:503}),/genuine/);
});
function recoveryFixture(event){
  const before={event_id:event.id,stripe_account_id:event.account,livemode:false,status:'pending',attempts:1,next_attempt_at:new Date(Date.now()-1000).toISOString(),payload:event,payload_hash:sha(canonical(event))};
  let recovered=false,http=0,gets=0;
  const service={from(table){assert.equal(table,'stripe_merchant_events');const q={select(){return q;},eq(){return q;},single:async()=>({data:recovered?{...before,status:'processed',attempts:2}:before,error:null})};return q;}};
  const provider={request:async resource=>{assert.equal(resource,'events/'+event.id);gets++;return event;}};
  const fetcher=async(url,options)=>{assert.equal(url,scope.origin+'/api/cron/stripe-merchant-event-recovery');assert.ok(options.headers.Authorization.startsWith('Bearer '));http++;recovered=true;return{ok:true,status:200,json:async()=>({ok:true,recovered:1})};};
  return{before,service,provider,fetcher,counts:()=>({http,gets})};
}
test('real local cron recovers only an already pending original signed event without manufacturing ledger state',async t=>{
  const c=await captureFixture(t),f=recoveryFixture(c.event),captured=await readGenuineCapturedEvent({...c,resultStatus:503});
  const result=await verifyInterruptedRecovery({...f,captured,cronSecret:'unit-local-private-cron-123456789'});assert.equal(result.beforeStatus,'pending');assert.equal(result.afterStatus,'processed');assert.equal(result.ledgerStateFabricated,false);assert.deepEqual(f.counts(),{http:1,gets:1});
});
test('processed, mismatched or not-yet-due ledger rows cannot be used as interruption proof or force cron',async t=>{
  const c=await captureFixture(t),captured=await readGenuineCapturedEvent({...c,resultStatus:503});
  for(const mutate of [f=>{f.before.status='processed';},f=>{f.before.payload_hash='f'.repeat(64);},f=>{f.before.next_attempt_at=new Date(Date.now()+60_000).toISOString();}]){
    const f=recoveryFixture(c.event);mutate(f);await assert.rejects(verifyInterruptedRecovery({...f,captured,cronSecret:'unit-local-private-cron-123456789'}),/interrupted|due/);assert.equal(f.counts().http,0);
  }
});
