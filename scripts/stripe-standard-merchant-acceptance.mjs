/** Isolated genuine merchant-event acceptance. Never creates a customer payment.
 * A real HTTP order paid with Stripe's dispute test card must already exist.
 * Standard deauthorization uses the official Stripe CLI fixture's real action:
 * create a separate empty Standard test account, then delete ONLY that account.
 * Every mutation requires --allow-test-mutations yes and fresh exact test proof.
 * Disposable account phases also require --primary-flows-complete yes: run them
 * only after primary activation/refund/rollback acceptance. The extra pending
 * candidate could otherwise affect Standard account selection in that fixture.
 * Recovery only reads an actually pending signed HTTP delivery, then calls the
 * real local cron; it never fabricates events or edits ledger state to pending.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { readProtectedTestKey, readProtectedLocalSupabase, redactSandboxError, assertSandboxConfiguration } from './stripe-standard-sandbox-rehearsal.mjs';
import { verifyOriginalSignature } from './stripe-standard-webhook-proxy.mjs';

export const MERCHANT_ACCEPTANCE_SCOPE=Object.freeze({platform:'acct_1UQo3XLkdaBBHhB9',owner:'8ec853b6-8e33-4014-b17f-cbeb61a8d31b',
  photographer:'d73f0153-7303-4ccf-873f-43f0fb7ab61b',express:'acct_1UQoJJLghbZLnG5t',standard:'acct_1UQoJMQ9EOPSxHSm',
  database:'http://127.0.0.1:55421',origin:'http://localhost:55430'});
const repo=fileURLToPath(new URL('../',import.meta.url));
const primary=new Set([MERCHANT_ACCEPTANCE_SCOPE.platform,MERCHANT_ACCEPTANCE_SCOPE.express,MERCHANT_ACCEPTANCE_SCOPE.standard]);
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'
  ?`{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>`${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`:JSON.stringify(value);
const fail=message=>{throw Error(message);};
const idOf=value=>typeof value==='string'?value:value?.id;
const isAccount=value=>/^acct_[A-Za-z0-9]+$/.test(value||'');
const isDispute=value=>/^(?:du|dp)_[A-Za-z0-9]+$/.test(value||'');
const eventAccount=event=>event.account||(event.type==='account.updated'?event.data?.object?.id:null);
export function assertMerchantPhaseAllowed(options){
  const allowed=new Set(['status','create-disposable','touch-disposable','delete-disposable','verify-deauthorization','verify-dispute','close-dispute','recover-interrupted']);
  if(!allowed.has(options.phase))fail('Unknown merchant acceptance phase.');
  const mutation=['create-disposable','touch-disposable','delete-disposable','close-dispute','recover-interrupted'].includes(options.phase);
  if(mutation&&options.allowTestMutations!=='yes')fail('Root must explicitly authorize this genuine isolated test mutation stage.');
  if(['create-disposable','touch-disposable','delete-disposable'].includes(options.phase)&&options.primaryFlowsComplete!=='yes')fail('Finish primary HTTP activation, payments, refunds and rollback before adding a disposable candidate.');
  return mutation;
}
async function privateFile(file){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.uid!==process.getuid?.())fail('A private owned regular file is required.');const full=await fs.realpath(file);if(full.startsWith(repo+path.sep))fail('Private acceptance state must stay outside the repository.');return fs.readFile(full);}
async function privateJson(file){return JSON.parse((await privateFile(file)).toString('utf8'));}
async function save(file,value){const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});await fs.rename(temp,file);}
export function assertDisposableAccount(account,proof){
  if(!isAccount(account?.id)||primary.has(account.id)||account.id!==proof.disposable?.accountId||account.type!=='standard'||account.country!=='CA'
    ||account.controller?.stripe_dashboard?.type!=='full'||account.controller?.requirement_collection!=='stripe'
    ||account.controller?.fees?.payer!=='account'||account.controller?.losses?.payments!=='stripe'
    ||account.metadata?.studio_standard_merchant_acceptance!==proof.runId||account.metadata?.photographer_id!==MERCHANT_ACCEPTANCE_SCOPE.photographer
    ||account.metadata?.user_id!==MERCHANT_ACCEPTANCE_SCOPE.owner)fail('The separately created empty disposable Standard test account is required.');
  return account;
}
export function assertEmptyDisposable({account,proof,balance,charges,intents,bindings}){
  assertDisposableAccount(account,proof);
  if(balance?.livemode!==false||!Array.isArray(balance.available)||!Array.isArray(balance.pending)
    ||[...balance.available,...balance.pending].some(row=>!Number.isSafeInteger(row.amount)||row.amount!==0)
    ||charges?.object!=='list'||!Array.isArray(charges.data)||charges.data.length||charges.has_more!==false
    ||intents?.object!=='list'||!Array.isArray(intents.data)||intents.data.length||intents.has_more!==false
    ||!Array.isArray(bindings)||bindings.length)fail('Disposable deauthorization requires zero balances, zero charges/intents and no payment bindings.');
}
export function createMerchantTestProvider({key,expectedPlatform,fetcher=fetch,onRequest=()=>{},now=Date.now}){
  if(!/^sk_test_[A-Za-z0-9_]+$/.test(key||'')||expectedPlatform!==MERCHANT_ACCEPTANCE_SCOPE.platform)fail('The dedicated owned Stripe TEST platform and test secret key are required.');
  assertSandboxConfiguration({key,expectedPlatform,origin:MERCHANT_ACCEPTANCE_SCOPE.origin,database:MERCHANT_ACCEPTANCE_SCOPE.database},process.env);
  let verifiedAt=null;const allowed=new Set([MERCHANT_ACCEPTANCE_SCOPE.express,MERCHANT_ACCEPTANCE_SCOPE.standard]);
  const request=async(resource,{method='GET',account,body,idempotencyKey,allowMutation=false}={})=>{
    const url=new URL(resource,'https://api.stripe.com/v1/');
    if(url.origin!=='https://api.stripe.com'||!url.pathname.startsWith('/v1/')||url.hash)fail('Only bounded official Stripe API paths are allowed.');
    const route=url.pathname.slice(4);
    if(!/^(?:account|balance|accounts(?:\/acct_[A-Za-z0-9]+)?|charges(?:\/ch_[A-Za-z0-9]+)?|payment_intents(?:\/pi_[A-Za-z0-9]+)?|disputes(?:\/(?:du|dp)_[A-Za-z0-9]+)?|events\/evt_[A-Za-z0-9]+)$/.test(route)
      ||!['GET','POST','DELETE'].includes(method)||account&&!allowed.has(account))fail('Provider request is outside the owned merchant acceptance scope.');
    if(method!=='GET'){
      if(!allowMutation||verifiedAt===null||now()-verifiedAt>300_000||!idempotencyKey?.startsWith('studio-standard-merchant-test-'))fail('Explicit mutation authorization, fresh platform proof and durable idempotency are required.');
      if(method==='DELETE'&&(!/^accounts\/acct_[A-Za-z0-9]+$/.test(route)||primary.has(route.slice(9))||!allowed.has(route.slice(9))))fail('Only the separately adopted disposable account may be deleted.');
      if(method==='POST'&&route==='accounts'){
        if(body?.get('type')!=='standard'||body.get('country')!=='CA'||!body.get('email')?.endsWith('@example.test')||!body.get('metadata[studio_standard_merchant_acceptance]')
          ||body.get('metadata[photographer_id]')!==MERCHANT_ACCEPTANCE_SCOPE.photographer||body.get('metadata[user_id]')!==MERCHANT_ACCEPTANCE_SCOPE.owner)fail('Only a securely marked synthetic Standard test account can be created.');
      }else if(method==='POST'&&route.startsWith('accounts/')){
        if(primary.has(route.slice(9))||!allowed.has(route.slice(9))||[...body.keys()].some(name=>!name.startsWith('metadata[')))fail('Only disposable account metadata may be updated.');
      }else if(method==='POST'&&route.startsWith('disputes/')){
        if(!account||body?.get('evidence[uncategorized_text]')!=='winning_evidence'||body.get('submit')!=='true'||[...body.keys()].some(name=>!['evidence[uncategorized_text]','submit'].includes(name)))fail('Only documented winning evidence on an owned test dispute is allowed.');
      }else if(method==='POST')fail('No customer payment or unbounded provider creation is allowed.');
    }
    const response=await fetcher(url.href,{method,headers:{Authorization:`Bearer ${key}`,'Stripe-Version':'2025-06-30.basil',...(account?{'Stripe-Account':account}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:body?.toString(),redirect:'error',signal:AbortSignal.timeout(20_000)});
    let value;try{value=await response.json();}catch{fail('Stripe did not return a JSON test response.');}
    onRequest({method,path:route,account:account||expectedPlatform,status:response.status,requestId:response.headers?.get?.('request-id')||null});
    if(!response.ok)fail(redactSandboxError(value.error?.message||'Stripe merchant TEST request failed.'));
    if(value.livemode===true)fail('A live Stripe object was returned.');return value;
  };
  return {request,adoptDisposable:account=>{if(!isAccount(account)||primary.has(account))fail('A separate disposable account is required.');allowed.add(account);},
    async preflight(){const account=await request('account'),balance=await request('balance');if(account.id!==expectedPlatform||balance.object!=='balance'||balance.livemode!==false)fail('Exact genuine test platform/balance proof failed.');verifiedAt=now();return{platformId:expectedPlatform,livemode:false,verifiedAt:new Date(verifiedAt).toISOString()};}};
}
export async function readGenuineCapturedEvent({captureFile,secretFile,resultStatus}){
  const record=await privateJson(captureFile),raw=Buffer.from(record.rawBodyBase64||'','base64'),secret=(await privateFile(secretFile)).toString('utf8').trim();
  if(!/^whsec_[A-Za-z0-9]+$/.test(secret)||record.format!=='stripe-cli-signed-test-delivery-v1'||record.operatorPinnedPlatformId!==MERCHANT_ACCEPTANCE_SCOPE.platform
    ||record.signatureVerifiedAtCapture!==true||record.livemode!==false||sha(raw)!==record.rawBodySha256||!Number.isFinite(Date.parse(record.receivedAt)))fail('An original privately captured genuine TEST delivery is required.');
  verifyOriginalSignature(raw,record.originalStripeSignature,secret,Date.parse(record.receivedAt));
  const event=JSON.parse(raw.toString('utf8'));
  if(event.id!==record.eventId||event.type!==record.eventType||event.livemode!==false||!isAccount(eventAccount(event)))fail('Captured test event identity differs.');
  const result=await privateJson(captureFile.replace(/\.delivery\.json$/,'.result.json'));
  if(result.captureId!==record.captureId||result.forwardedRawBodySha256!==record.rawBodySha256||result.upstreamStatus!==resultStatus)fail('Actual Next HTTP result for this original delivery was not proven.');
  return{event,record,result};
}
export async function verifyDisputeContext({service,provider,orderId,accountId,disputeId}){
  if(![MERCHANT_ACCEPTANCE_SCOPE.express,MERCHANT_ACCEPTANCE_SCOPE.standard].includes(accountId)||!isDispute(disputeId))fail('An exact owned order account and real dispute ID are required.');
  const query=async value=>{const r=await value;if(r.error)throw r.error;return r.data;};
  const seed=await query(service.from('orders').select('*').eq('id',orderId).eq('photographer_id',MERCHANT_ACCEPTANCE_SCOPE.photographer).single());
  if(!seed.stripe_payment_account_binding_id)fail('The order must already have actual immutable HTTP checkout history.');
  const binding=await query(service.from('order_payment_accounts').select('*').eq('id',seed.stripe_payment_account_binding_id).single());
  const orders=await query(seed.order_group_id?service.from('orders').select('*').eq('order_group_id',seed.order_group_id):service.from('orders').select('*').eq('id',seed.id));
  const gross=orders.reduce((n,o)=>n+Number(o.total_cents??Math.round(Number(o.total_amount)*100)),0),fee=orders.reduce((n,o)=>n+Number(o.platform_fee_amount_cents??0),0);
  const snapshot=orders.map(o=>({id:o.id,platform_fee_collection_method:o.platform_fee_collection_method,platform_fee_amount_cents:o.platform_fee_amount_cents,
    platform_fee_currency:o.platform_fee_currency,platform_fee_rate_cents:o.platform_fee_rate_cents})).sort((a,b)=>a.id.localeCompare(b.id));
  if(binding.photographer_id!==MERCHANT_ACCEPTANCE_SCOPE.photographer||binding.stripe_account_id!==accountId||binding.livemode!==false
    ||canonical([...binding.order_ids].sort())!==canonical(orders.map(o=>o.id).sort())||orders.some(o=>o.photographer_id!==binding.photographer_id||o.stripe_payment_account_binding_id!==binding.id||o.currency!==binding.currency)
    ||canonical(snapshot)!==canonical(binding.fee_snapshot)||gross!==binding.amount_cents||!Number.isSafeInteger(gross)||gross<=0||gross>10000||!Number.isSafeInteger(fee)||fee<=0||fee>1100||!['cad','usd'].includes(binding.currency))fail('The bounded genuine fee-bearing payment group differs from immutable history.');
  const paymentId=seed.stripe_payment_intent_id||binding.payment_intent_id;
  if(!/^pi_[A-Za-z0-9]+$/.test(paymentId||''))fail('A completed genuine customer payment is required.');
  const payment=await provider.request(`payment_intents/${paymentId}`,{account:accountId});
  if(payment.id!==paymentId||payment.livemode!==false||payment.status!=='succeeded'||payment.amount!==gross||payment.amount_received!==gross||payment.currency!==binding.currency||payment.application_fee_amount!==fee
    ||payment.metadata?.billing_flow!=='customer_order'||payment.metadata.photographer_id!==binding.photographer_id||!binding.order_ids.includes(payment.metadata.order_id))fail('Provider payment amount, fee or ownership differs.');
  const charge=await provider.request(`charges/${idOf(payment.latest_charge)}`,{account:accountId});
  const dispute=await provider.request(`disputes/${disputeId}`,{account:accountId});
  if(charge.livemode!==false||idOf(charge.payment_intent)!==paymentId||charge.amount!==gross||charge.currency!==binding.currency||dispute.id!==disputeId||dispute.livemode!==false
    ||idOf(dispute.charge)!==charge.id||dispute.payment_intent&&idOf(dispute.payment_intent)!==paymentId||!Number.isSafeInteger(dispute.amount)||dispute.amount<0||dispute.amount>gross||dispute.currency!==binding.currency)fail('The real dispute does not belong to the original owned payment.');
  return{binding,orders,payment,charge,dispute,fee};
}
export async function verifyInterruptedRecovery({service,provider,captured,cronSecret,fetcher=fetch}){
  const event=captured.event,account=eventAccount(event);if(!event.type.startsWith('account.')&&!event.type.startsWith('charge.dispute.')&&!event.type.startsWith('refund.')&&!event.type.startsWith('charge.refunded')&&!event.type.startsWith('application_fee.'))fail('A genuine supported merchant event is required.');
  const query=async value=>{const r=await value;if(r.error)throw r.error;return r.data;};
  const before=await query(service.from('stripe_merchant_events').select('*').eq('event_id',event.id).single());
  if(before.stripe_account_id!==account||before.livemode!==false||!['pending','processing'].includes(before.status)||before.attempts<1
    ||canonical(before.payload)!==canonical(event)||before.payload_hash!==sha(canonical(event)))fail('No actual interrupted durable merchant event matches the signed HTTP delivery.');
  if(Date.parse(before.next_attempt_at)>Date.now())fail('The real merchant retry/lease is not due yet; wait without editing its ledger.');
  const genuine=await provider.request(`events/${event.id}`);
  if(genuine.id!==event.id||genuine.type!==event.type||eventAccount(genuine)!==account||genuine.livemode!==false||canonical(genuine.data)!==canonical(event.data))fail('The original real provider event does not match the durable interrupted delivery.');
  if(typeof cronSecret!=='string'||cronSecret.length<24||/\s/.test(cronSecret))fail('The private isolated cron authorization is required.');
  const response=await fetcher(MERCHANT_ACCEPTANCE_SCOPE.origin+'/api/cron/stripe-merchant-event-recovery',{headers:{Authorization:`Bearer ${cronSecret}`},redirect:'error',signal:AbortSignal.timeout(60_000)});
  const result=await response.json();if(!response.ok||result.ok!==true||result.recovered<1)fail('Actual Next merchant cron did not recover the interrupted event.');
  const after=await query(service.from('stripe_merchant_events').select('*').eq('event_id',event.id).single());
  if(after.status!=='processed'||after.attempts<=before.attempts||canonical(after.payload)!==canonical(event)||after.stripe_account_id!==account)fail('Actual recovery did not preserve and complete the original event.');
  return{eventId:event.id,type:event.type,account,beforeStatus:before.status,afterStatus:after.status,attemptsBefore:before.attempts,attemptsAfter:after.attempts,actualHttpCronStatus:response.status,ledgerStateFabricated:false};
}
export async function runMerchantAcceptance(options){
  const mutation=assertMerchantPhaseAllowed(options);
  if(options.expectedPlatform!==MERCHANT_ACCEPTANCE_SCOPE.platform)fail('Pin the exact dedicated test platform.');
  const local=readProtectedLocalSupabase(options.supabaseEnvFile);if(local.database!==MERCHANT_ACCEPTANCE_SCOPE.database)fail('Only the isolated genuine Supabase service is allowed.');
  const state=path.resolve(options.stateDir);await fs.mkdir(state,{recursive:true,mode:0o700});const st=await fs.lstat(state);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)||st.uid!==process.getuid?.()||(await fs.realpath(state)).startsWith(repo+path.sep))fail('A private external state directory is required.');
  const file=path.join(state,'proof.json');let proof;try{proof=await privateJson(file);}catch(error){if(error.code!=='ENOENT')throw error;proof={version:1,runId:randomUUID(),platformId:MERCHANT_ACCEPTANCE_SCOPE.platform,requests:[],checks:[]};}
  if(proof.platformId!==MERCHANT_ACCEPTANCE_SCOPE.platform||!/^[a-f0-9-]{36}$/.test(proof.runId))fail('Acceptance proof belongs to another run.');
  const persist=()=>save(file,proof),key=readProtectedTestKey(options.keyFile,MERCHANT_ACCEPTANCE_SCOPE.platform);
  const provider=createMerchantTestProvider({key,expectedPlatform:options.expectedPlatform,onRequest:entry=>proof.requests.push({...entry,at:new Date().toISOString()})});
  proof.preflight=await provider.preflight();const service=createClient(local.database,local.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const query=async value=>{const r=await value;if(r.error)throw r.error;return r.data;};
  const owner=()=>query(service.from('photographers').select('id,user_id,stripe_account_id,stripe_connected_account_id,stripe_connect_route_version,stripe_standard_migrated_at').eq('id',MERCHANT_ACCEPTANCE_SCOPE.photographer).single());
  const original=await owner();if(original.user_id!==MERCHANT_ACCEPTANCE_SCOPE.owner||![MERCHANT_ACCEPTANCE_SCOPE.express,MERCHANT_ACCEPTANCE_SCOPE.standard].includes(original.stripe_connected_account_id||original.stripe_account_id))fail('The real isolated photographer owner/current pair differs.');
  const request=(resource,args={})=>provider.request(resource,{...args,allowMutation:mutation});
  if(proof.disposable?.accountId)provider.adoptDisposable(proof.disposable.accountId);
  try{
    if(options.phase==='create-disposable'){
      proof.primaryFlowsComplete={operatorConfirmedAt:new Date().toISOString(),providerEvidence:'Separate primary HTTP acceptance proof remains required; this field is operator confirmation only.'};
      proof.disposable??={createIdempotencyKey:'studio-standard-merchant-test-'+proof.runId+'-create'};await persist();
      let account;if(proof.disposable.accountId)account=await request(`accounts/${proof.disposable.accountId}`);
      else{account=await request('accounts',{method:'POST',idempotencyKey:proof.disposable.createIdempotencyKey,body:new URLSearchParams({type:'standard',country:'CA',email:`merchant-events-${proof.runId}@example.test`,'metadata[studio_standard_merchant_acceptance]':proof.runId,'metadata[photographer_id]':MERCHANT_ACCEPTANCE_SCOPE.photographer,'metadata[user_id]':MERCHANT_ACCEPTANCE_SCOPE.owner})});proof.disposable.accountId=account.id;await persist();provider.adoptDisposable(account.id);}
      assertDisposableAccount(account,proof);
      await query(service.rpc('register_photographer_stripe_account',{p_photographer_id:MERCHANT_ACCEPTANCE_SCOPE.photographer,p_actor_user_id:MERCHANT_ACCEPTANCE_SCOPE.owner,p_account:account,p_livemode:false}));
      proof.disposable.registered=true;proof.checks.push({label:'separate securely marked Standard test account registered without routing change',accountId:account.id});
    }else if(['touch-disposable','delete-disposable'].includes(options.phase)){
      const account=assertDisposableAccount(await request(`accounts/${proof.disposable?.accountId}`),proof);
      if(options.phase==='touch-disposable')await request(`accounts/${account.id}`,{method:'POST',idempotencyKey:'studio-standard-merchant-test-'+proof.runId+'-touch',body:new URLSearchParams({'metadata[merchant_acceptance_update]':proof.runId})});
      else{
        assertEmptyDisposable({account,proof,balance:await request('balance',{account:account.id}),charges:await request('charges?limit=1',{account:account.id}),intents:await request('payment_intents?limit=1',{account:account.id}),bindings:await query(service.from('order_payment_accounts').select('id').eq('stripe_account_id',account.id))});
        proof.disposable.deleteRequestedAt=new Date().toISOString();await persist();
        const deleted=await request(`accounts/${account.id}`,{method:'DELETE',idempotencyKey:'studio-standard-merchant-test-'+proof.runId+'-delete'});assert.equal(deleted.id,account.id);assert.equal(deleted.deleted,true);proof.disposable.deletedAt=new Date().toISOString();
      }
    }else if(['verify-dispute','close-dispute'].includes(options.phase)){
      const context=await verifyDisputeContext({service,provider,orderId:options.orderId,accountId:options.accountId,disputeId:options.disputeId});
      if(options.phase==='close-dispute'&&context.dispute.status!=='won'){
        if(!['needs_response','warning_needs_response','under_review','warning_under_review'].includes(context.dispute.status))fail('Only the original open synthetic dispute may receive winning evidence.');
        const result=await request(`disputes/${context.dispute.id}`,{method:'POST',account:options.accountId,idempotencyKey:'studio-standard-merchant-test-'+proof.runId+'-'+context.dispute.id,body:new URLSearchParams({'evidence[uncategorized_text]':'winning_evidence',submit:'true'})});assert.equal(result.id,context.dispute.id);
      }else if(options.phase==='verify-dispute'){
        const captured=await readGenuineCapturedEvent({captureFile:options.captureFile,secretFile:options.webhookSecretFile,resultStatus:200});
        if(!captured.event.type.startsWith('charge.dispute.')||captured.event.account!==options.accountId||captured.event.data.object.id!==context.dispute.id)fail('An actual signed Next dispute delivery is required.');
        const row=await query(service.from('stripe_merchant_disputes').select('*').eq('stripe_account_id',options.accountId).eq('dispute_id',context.dispute.id).single());
        const ledger=await query(service.from('stripe_merchant_events').select('*').eq('event_id',captured.event.id).single());
        if(row.photographer_id!==MERCHANT_ACCEPTANCE_SCOPE.photographer||row.payment_intent_id!==context.payment.id||row.charge_id!==context.charge.id||row.status!==context.dispute.status||ledger.status!=='processed'
          ||ledger.stripe_account_id!==options.accountId||ledger.livemode!==false||canonical(ledger.payload)!==canonical(captured.event)||ledger.payload_hash!==sha(canonical(captured.event)))fail('Actual Next did not store the latest original-account dispute.');
        proof.checks.push({label:'genuine provider dispute observed through signed actual Next HTTP',eventId:captured.event.id,disputeId:row.dispute_id,accountId:options.accountId,paymentIntentId:context.payment.id,status:row.status,applicationFeeCents:context.fee});
      }
    }else if(options.phase==='verify-deauthorization'){
      if(!proof.disposable?.deletedAt)fail('Delete only the separately created empty test Standard account first.');
      const captured=await readGenuineCapturedEvent({captureFile:options.captureFile,secretFile:options.webhookSecretFile,resultStatus:200});
      if(captured.event.type!=='account.application.deauthorized'||captured.event.account!==proof.disposable.accountId)fail('The genuine disposable-account deauthorization delivery is required.');
      const event=await request(`events/${captured.event.id}`);if(event.id!==captured.event.id||event.type!==captured.event.type||event.account!==captured.event.account||event.livemode!==false)fail('Provider deauthorization event identity differs.');
      const row=await query(service.from('photographer_stripe_accounts').select('*').eq('stripe_account_id',proof.disposable.accountId).eq('livemode',false).single());
      const ledger=await query(service.from('stripe_merchant_events').select('*').eq('event_id',event.id).single());
      if(row.status!=='blocked'||!row.deauthorized_at||row.photographer_id!==MERCHANT_ACCEPTANCE_SCOPE.photographer||ledger.status!=='processed')fail('Actual signed deauthorization did not block only the disposable history.');
      proof.checks.push({label:'genuine Standard account deauthorization through actual signed Next webhook',eventId:event.id,accountId:row.stripe_account_id,historyStatus:row.status});
    }else if(options.phase==='recover-interrupted'){
      const captured=await readGenuineCapturedEvent({captureFile:options.captureFile,secretFile:options.webhookSecretFile,resultStatus:503});
      if(![MERCHANT_ACCEPTANCE_SCOPE.express,MERCHANT_ACCEPTANCE_SCOPE.standard,proof.disposable?.accountId].includes(eventAccount(captured.event)))fail('Only a genuine owned interrupted test event may be recovered.');
      const result=await verifyInterruptedRecovery({service,provider,captured,cronSecret:(await privateFile(options.cronSecretFile)).toString('utf8').trim()});proof.checks.push({label:'actual interrupted signed merchant event recovered by actual local HTTP cron',...result});
    }else if(options.phase!=='status')fail('Unknown merchant acceptance phase.');
    assert.deepEqual(await owner(),original,'Merchant acceptance must never change primary future routing or ownership.');
    await persist();return{phase:options.phase,proofPath:file,disposableAccountId:proof.disposable?.accountId||null,checks:proof.checks.length,primaryRoutingUnchanged:true};
  }finally{await persist();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i]?.replace(/^--/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase());if(!key||!process.argv[i+1])throw Error('Explicit merchant acceptance arguments are required.');options[key]=process.argv[i+1];}
  runMerchantAcceptance(options).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(error=>{process.stderr.write(redactSandboxError(error.message)+'\n');process.exitCode=1;});
}
