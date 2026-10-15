/** Genuine HTTP acceptance against the isolated Next/Supabase/Stripe sandbox.
 * No production test hooks, synthetic billing activation or direct paid APIs.
 * Checkout URLs, cookies and Auth tokens remain in mode0600 local state.
 */
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,statSync,realpathSync,mkdirSync,openSync,closeSync,fsyncSync,renameSync,existsSync,readdirSync } from 'node:fs';
import { resolve,dirname,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID,createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { readProtectedTestKey,readProtectedLocalSupabase,createGuardedSandboxProvider,redactSandboxError,loadActualApplication } from './stripe-standard-sandbox-rehearsal.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
const expectedPlatform='acct_1UQo3XLkdaBBHhB9';
const expectedOwner='8ec853b6-8e33-4014-b17f-cbeb61a8d31b';
const expectedPhotographer='d73f0153-7303-4ccf-873f-43f0fb7ab61b';
const appOrigin='http://localhost:55430';
const supportedPlans=new Set(['starter','core','studio']);
export function acceptanceCaseDefinition({plan,kind,currency,variant='single',name=''}) {
  if(!supportedPlans.has(plan)||!['gallery','event','school'].includes(kind)||!['cad','usd'].includes(currency)||
      !['single','group','mixed-waiver','waived'].includes(variant)||!/^[-a-z0-9]{0,40}$/.test(name))throw Error('Invalid bounded HTTP acceptance case.');
  const count=['group','mixed-waiver'].includes(variant)?2:1;
  const billableCount=variant==='waived'?0:variant==='mixed-waiver'?1:count;
  return {label:`${plan}-${kind}-${currency}${variant==='single'?'':'-'+variant}${name?'-'+name:''}`,count,
    billableCount,feeCents:(plan==='starter'?55:45)*billableCount,
    // The shipped parent-session API has event and school branches. An
    // ordinary gallery currently shares the event-project branch; record that
    // fact rather than claiming a separate portrait handler was exercised.
    actualParentKind:kind==='school'?'school':'event',actualWorkflowType:kind==='school'?null:'event'};
}
export function assertInterruptionEvidence(fault) {
  if(fault?.format!=='studio-standard-private-fault-proof-v1'||!['lost_checkout_response','lost_bind_response'].includes(fault.mode)||
      (fault.mode==='lost_checkout_response'?fault.providerCommitted!==true:fault.databaseCommitted!==true)||
      !/^cs_test_[A-Za-z0-9]+$/.test(fault.sessionId||'')||!/^acct_[A-Za-z0-9]+$/.test(fault.accountId||'')||
      !/^[a-f0-9]{64}$/.test(fault.requestHash||'')||!/^[-a-f0-9]{36}$/i.test(fault.attemptId||''))throw Error('Genuine committed-provider/database interruption evidence is required.');
  return fault;
}
export function assertHttpAcceptanceTargets(input){
  if(input.expectedPlatform!==expectedPlatform||input.database!=='http://127.0.0.1:55421'||input.origin!==appOrigin)throw Error('The exact isolated Stripe platform, Supabase API and canonical Next origin are required.');
  return input;
}
function privateJson(path){
  const full=realpathSync(path),info=statSync(full);
  if((info.mode&0o077)!==0||!info.isFile()||info.uid!==process.getuid?.()||full.startsWith(repo+sep))throw Error('Acceptance credentials and provider state must be private, owned files outside the repository.');
  return JSON.parse(readFileSync(full,'utf8'));
}
function save(path,value){
  const temp=path+'.'+randomUUID()+'.tmp',fd=openSync(temp,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temp,path);const d=openSync(dirname(path),'r');try{fsyncSync(d);}finally{closeSync(d);}
}
function stateDirectory(path){
  mkdirSync(path,{recursive:true,mode:0o700});const full=realpathSync(path),info=statSync(full);
  if(full.startsWith(repo+sep)||(info.mode&0o077)!==0||info.uid!==process.getuid?.())throw Error('Acceptance state must be a private owned directory outside the repository.');
  return full;
}
export function assertAcceptancePhaseAllowed(phase,allowTestMoney=false){
  if(['change-plan','refund','partial-refund','refund-unfulfilled','activate','rollback'].includes(phase)&&!allowTestMoney)throw Error('Root must explicitly authorize the connected-account/payment acceptance stage.');
  if(!['status','subscribe','verify-subscription','recover-subscription','prepare-order','legacy-checkout','checkout','retry-checkout','verify-interruption','adopt-browser-order','verify-orders','change-plan','refund','partial-refund','refund-unfulfilled','verify-refund','recover-customer-events','backfill','activate','rollback','initialize-routing'].includes(phase))throw Error('Unknown HTTP acceptance phase.');
}
export async function runHttpAcceptance(options){
  const local=readProtectedLocalSupabase(options.supabaseEnvFile);
  assertHttpAcceptanceTargets({expectedPlatform:options.expectedPlatform,database:local.database,origin:appOrigin});
  assertAcceptancePhaseAllowed(options.phase,options.allowTestMoney==='yes');
  const key=readProtectedTestKey(options.keyFile,expectedPlatform),providerState=privateJson(options.providerStateFile),auth=privateJson(options.authFile);
  assert.equal(providerState.platformId,expectedPlatform);assert.equal(providerState.photographerId,expectedPhotographer);assert.equal(providerState.userId,expectedOwner);assert.equal(auth.id,expectedOwner);
  const stateDir=stateDirectory(resolve(options.stateDir)),proofPath=resolve(stateDir,'proof.json');
  const proof=existsSync(proofPath)?privateJson(proofPath):{version:1,platformId:expectedPlatform,userId:expectedOwner,photographerId:expectedPhotographer,subscriptions:{},orders:{},requests:[],checks:[],parentCookies:{}};
  assert.equal(proof.platformId,expectedPlatform);assert.equal(proof.userId,expectedOwner);assert.equal(proof.photographerId,expectedPhotographer);
  const persist=()=>save(proofPath,proof);
  const signedDeliveries=(eventIds,accountId)=>{
    const folder=realpathSync(options.webhookCaptureDir||resolve(stateDir,'../webhook-captures'));
    if(folder.startsWith(repo+sep)||(statSync(folder).mode&0o077)!==0)throw Error('Signed capture evidence must be private and outside the repository.');
    const found=[];
    for(const file of readdirSync(folder).filter(file=>/^[a-f0-9-]+\.delivery\.json$/.test(file))){
      const delivery=privateJson(resolve(folder,file));
      if(!eventIds.includes(delivery.eventId)||delivery.accountId!==(accountId||null))continue;
      const resultPath=resolve(folder,file.replace('.delivery.json','.result.json'));
      if(!existsSync(resultPath))continue;
      const result=privateJson(resultPath),raw=Buffer.from(delivery.rawBodyBase64,'base64');
      if(delivery.operatorPinnedPlatformId!==expectedPlatform||delivery.livemode!==false||delivery.signatureVerifiedAtCapture!==true||
          createHash('sha256').update(raw).digest('hex')!==delivery.rawBodySha256||result.forwardedRawBodySha256!==delivery.rawBodySha256||
          result.upstreamStatus!==200||JSON.parse(raw.toString()).id!==delivery.eventId)continue;
      found.push({eventId:delivery.eventId,captureId:delivery.captureId,eventType:delivery.eventType,upstreamStatus:result.upstreamStatus,bodySha256:delivery.rawBodySha256});
    }
    if(!found.length)throw Error('Processed SQL alone is insufficient: genuine signed CLI-to-Next HTTP 200 capture evidence is required.');
    return found;
  };
  const provider=createGuardedSandboxProvider({key,expectedPlatform,onRequest:value=>{proof.requests.push({surface:'Stripe',...value,at:new Date().toISOString()});persist();}});
  const service=createClient(local.database,local.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const anon=createClient(local.database,local.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=auth.session?.access_token;
  if(!token)throw Error('A real private local AAL2 Auth session is required.');
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
  if(claims.sub!==expectedOwner||claims.aal!=='aal2'||claims.exp*1000<Date.now()+30_000)throw Error('Refresh the genuine isolated owner AAL2 session before acceptance.');
  const user=await anon.auth.getUser(token);if(user.error||user.data.user?.id!==expectedOwner)throw Error('The isolated Auth provider did not verify this owner.');
  const db=async query=>{const result=await query;if(result.error)throw result.error;return result.data;};
  const photographer=()=>db(service.from('photographers').select('*').eq('id',expectedPhotographer).eq('user_id',expectedOwner).single());
  const http=async(path,{method='GET',body,owner=false,cookies={}}={})=>{
    const url=new URL(path,appOrigin);if(url.origin!==appOrigin||!url.pathname.startsWith('/api/'))throw Error('Acceptance HTTP requests must stay on the pinned local API.');
    const response=await fetch(url,{method,headers:{Origin:appOrigin,'Sec-Fetch-Site':'same-origin',...(owner?{Authorization:`Bearer ${token}`}:{Cookie:Object.entries(cookies).map(([k,v])=>`${k}=${v}`).join('; ')}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60_000)});
    const text=await response.text();let value;try{value=JSON.parse(text);}catch{throw Error(`Actual Next HTTP ${response.status} did not return JSON for ${url.pathname}.`);}
    proof.requests.push({surface:'actual_next_http',path:url.pathname,method,status:response.status,at:new Date().toISOString()});persist();
    for(const raw of response.headers.getSetCookie()){const part=raw.split(';')[0],i=part.indexOf('=');cookies[part.slice(0,i)]=part.slice(i+1);}
    if(!response.ok||value.ok===false)throw Error(`Actual Next ${url.pathname} returned ${response.status}: ${redactSandboxError(value.message||'Request failed')}`);
    return value;
  };
  const preflight=async()=>{
    proof.testIdentity=await provider.preflight();
    const status=await http('/api/stripe/standard/status',{owner:true});
    if(!status.enabled||status.testOnly!==true||status.currentAccountId&&![providerState.accounts.express,providerState.accounts.standard].includes(status.currentAccountId))throw Error('Actual Next server is not using the isolated test migration environment.');
    const profile=await photographer();if(profile.is_platform_admin)throw Error('A fee-exempt owner cannot prove normal order collection.');
    proof.actualNextStatus=status;persist();return profile;
  };
  const stripeRead=async(path,account)=>{
    if(!/^(?:subscriptions|customers|prices|products)\/[A-Za-z0-9_]+(?:\?.*)?$/.test(path))return provider.request(path,{account});
    if(account)throw Error('Platform subscription/catalog reads must be platform scoped.');
    const response=await fetch('https://api.stripe.com/v1/'+path,{headers:{Authorization:`Bearer ${key}`,'Stripe-Version':'2025-06-30.basil'},signal:AbortSignal.timeout(20_000)});
    const value=await response.json();if(!response.ok||value.livemode===true)throw Error('Could not verify the real isolated Stripe subscription/catalog object.');return value;
  };
  const profile=await preflight();
  const plan=options.plan||'starter';if(!supportedPlans.has(plan))throw Error('Choose an actual Gallery, Core or Studio test subscription.');
  if(options.phase==='status')return{phase:'status',proofPath,actualNextTestOnly:proof.actualNextStatus.testOnly,currentAccountId:proof.actualNextStatus.currentAccountId,subscriptionStatus:profile.subscription_status,subscriptionPlan:profile.subscription_plan_code};
  if(options.phase==='subscribe'){
    if(profile.stripe_subscription_id)throw Error('The test merchant already has a subscription; verify it or use an explicitly authorized plan change.');
    const existing=proof.subscriptions[plan];
    if(existing?.sessionId){const session=await provider.request(`checkout/sessions/${existing.sessionId}`);if(session.status==='open')return{phase:'subscribe',proofPath,plan,sessionId:session.id,unpaid:true,reused:true};throw Error('Reconcile the original subscription Checkout before creating another.');}
    const session=await http('/api/stripe/billing',{method:'POST',owner:true,body:{action:'subscribe',planCode:plan,billingInterval:'month',extraDesktopKeys:0}});
    const actual=await provider.request(`checkout/sessions/${session.sessionId}`);
    assert.equal(actual.livemode,false);assert.equal(actual.mode,'subscription');assert.equal(actual.status,'open');assert.equal(actual.payment_status,'unpaid');
    assert.equal(actual.metadata?.photographer_id,expectedPhotographer);assert.equal(actual.metadata?.user_id,expectedOwner);
    proof.subscriptions[plan]={sessionId:session.sessionId,url:session.url,customerId:session.customerId,source:'actual_authenticated_next_billing_route',createdAt:new Date().toISOString()};persist();
    return{phase:'subscribe',proofPath,plan,sessionId:session.sessionId,unpaid:true};
  }
  if(options.phase==='recover-subscription'){
    if(!profile.stripe_subscription_id)throw Error('A real existing test subscription is required for metadata-only redelivery.');
    const sub=await stripeRead(`subscriptions/${profile.stripe_subscription_id}`);
    if(sub.livemode!==false||sub.metadata?.photographer_id!==expectedPhotographer||sub.customer!==profile.stripe_platform_customer_id)throw Error('The exact owned TEST subscription could not be verified.');
    proof.subscriptionRecovery??={id:randomUUID(),subscriptionId:sub.id};persist();assert.equal(proof.subscriptionRecovery.subscriptionId,sub.id);
    const body=new URLSearchParams({'metadata[studio_standard_acceptance_recovery]':proof.subscriptionRecovery.id});
    const response=await fetch(`https://api.stripe.com/v1/subscriptions/${sub.id}`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Stripe-Version':'2025-06-30.basil','Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':`studio-standard-test-billing-redelivery-${proof.subscriptionRecovery.id}`},body:body.toString(),signal:AbortSignal.timeout(20_000)});
    const value=await response.json();if(!response.ok||value.livemode!==false||value.id!==sub.id)throw Error('The metadata-only TEST subscription update did not verify.');
    assert.equal(value.items.data[0].price.id,sub.items.data[0].price.id);assert.equal(value.status,sub.status);assert.equal(value.customer,sub.customer);
    proof.checks.push({label:'metadata-only owned TEST subscription update generates a real signed retry event, no new payment or plan change',subscriptionId:sub.id,requestId:response.headers.get('request-id')});persist();
    return{phase:'recover-subscription',proofPath,subscriptionId:sub.id,metadataOnly:true};
  }
  if(options.phase==='verify-subscription'){
    const current=await photographer();if(!current.stripe_subscription_id||current.subscription_status!=='active')throw Error('The actual signed subscription webhook has not activated the local photographer.');
    const sub=await stripeRead(`subscriptions/${current.stripe_subscription_id}`);
    assert.equal(sub.livemode,false);assert.equal(sub.status,'active');assert.equal(sub.customer,current.stripe_platform_customer_id);
    assert.equal(sub.metadata?.photographer_id,expectedPhotographer);assert.equal(sub.metadata?.pricing_profile,'gallery_v3');
    const base=sub.items.data.find(item=>item.price.lookup_key===`studio-os-${plan}-monthly-gallery-v3`);
    assert.ok(base,'The actual subscription must own the requested V3 base price.');assert.equal(base.price.currency,'cad');assert.equal(base.price.unit_amount,{starter:5900,core:9900,studio:19900}[plan]);
    assert.equal(current.subscription_plan_code,plan);assert.equal(current.stripe_subscription_item_usage_id,null);
    const customer=await stripeRead(`customers/${sub.customer}`);assert.equal(customer.metadata?.photographer_id,expectedPhotographer);assert.equal(customer.metadata?.user_id,expectedOwner);
    const mirror=await db(service.from('subscriptions').select('*').eq('user_id',expectedOwner).single());
    assert.equal(mirror.status,'active');assert.equal(mirror.plan,plan);assert.equal(mirror.stripe_subscription_id,sub.id);
    const keys=await db(service.from('photography_keys').select('id,status').eq('photographer_id',expectedPhotographer).eq('status','active'));
    assert.equal(keys.length,{starter:0,core:1,studio:2}[plan]);
    const records=await db(service.from('stripe_events').select('id,event_type,payload').eq('livemode',false));
    const signed=records.filter(row=>row.payload?.data?.object?.id===sub.id&&row.event_type.startsWith('customer.subscription.')||row.event_type==='checkout.session.completed'&&row.payload?.data?.object?.subscription===sub.id);
    if(!signed.length)throw Error('No actual Next subscription webhook audit exists for this paid provider subscription.');
    const captures=signedDeliveries(signed.map(row=>row.id),null);
    proof.subscriptions[plan]={...(proof.subscriptions[plan]||{}),subscriptionId:sub.id,actualPriceId:base.price.id,active:true,webhookEventIds:signed.map(row=>row.id),signedHttpCaptures:captures,verifiedAt:new Date().toISOString()};persist();
    return{phase:'verify-subscription',plan,subscriptionId:sub.id,actualPriceId:base.price.id,actualNextWebhookCount:signed.length,proofPath};
  }
  if(options.phase==='change-plan'){
    if(!profile.stripe_subscription_id||profile.subscription_status!=='active')throw Error('A genuinely paid active subscription is required before plan changes.');
    const changed=await http('/api/stripe/billing',{method:'POST',owner:true,body:{action:'update_plan',planCode:plan,billingInterval:'month',extraDesktopKeys:0}});
    assert.equal(changed.subscriptionId,profile.stripe_subscription_id);assert.equal(changed.subscriptionStatus,'active');assert.equal(changed.subscriptionPlanCode,plan);
    proof.checks.push({label:'actual authenticated HTTP plan change',plan,subscriptionId:changed.subscriptionId});persist();return{phase:'change-plan',plan,proofPath,subscriptionId:changed.subscriptionId};
  }
  if(options.phase==='initialize-routing'){
    for(const type of ['express','standard']){
      const account=await provider.adopt(providerState.accounts[type],providerState.runId);
      if(type==='express'&&(!account.details_submitted||!account.charges_enabled||!account.payouts_enabled))throw Error('Original Express must be fully ready before initializing the disposable routing fixture.');
      if(type==='express'){
        const current=await photographer();
        if(!current.stripe_connected_account_id&&!current.stripe_account_id)await db(service.from('photographers').update({stripe_account_id:account.id,stripe_connected_account_id:account.id,stripe_connect_country:'CA',business_country:'CA',stripe_connect_onboarding_complete:true,stripe_connect_charges_enabled:true,stripe_connect_payouts_enabled:true}).eq('id',expectedPhotographer).eq('user_id',expectedOwner));
      }
      await db(service.rpc('register_photographer_stripe_account',{p_photographer_id:expectedPhotographer,p_actor_user_id:expectedOwner,p_account:account,p_livemode:false}));
    }
    const status=await http('/api/stripe/standard/status',{owner:true});assert.equal(status.currentAccountId,providerState.accounts.express);assert.equal(status.pending?.accountId,providerState.accounts.standard);
    proof.checks.push({label:'known owned sandbox accounts registered; ready Express remains selected while Standard readiness is verified separately',current:status.currentAccountId,pending:status.pending.accountId,pendingReady:status.pending.ready});persist();return{phase:'initialize-routing',proofPath,currentAccountId:status.currentAccountId,pendingAccountId:status.pending.accountId,pendingReady:status.pending.ready};
  }
  if(['backfill','activate','rollback'].includes(options.phase)){
    const status=await http('/api/stripe/standard/status',{owner:true});
    const target=options.phase==='rollback'?providerState.accounts.express:providerState.accounts.standard;
    const body=options.phase==='backfill'?{expectedCurrentAccountId:status.currentAccountId,batchSize:25,...(options.afterOrderId?{afterOrderId:options.afterOrderId}:{})}:{accountId:target,expectedCurrentAccountId:status.currentAccountId,confirmed:true};
    const outcome=await http(`/api/stripe/standard/${options.phase}`,{method:'POST',owner:true,body});
    proof.checks.push({label:`actual authenticated Standard ${options.phase} handler`,result:outcome});persist();return{phase:options.phase,proofPath,result:outcome};
  }
  if(options.phase==='adopt-browser-order'){
    const fixture=privateJson(options.browserFixtureFile);
    if(fixture.photographerId!==expectedPhotographer||!/^[-a-f0-9]{36}$/i.test(fixture.projectId)||!/^[-a-f0-9]{36}$/i.test(options.orderId||''))throw Error('The exact owned local browser fixture and real order UUID are required.');
    const order=await db(service.from('orders').select('*').eq('id',options.orderId).eq('project_id',fixture.projectId).eq('photographer_id',expectedPhotographer).single());
    if(!order.stripe_checkout_session_id||!order.stripe_payment_account_binding_id||!(order.customer_email||order.parent_email)?.endsWith('@example.test'))throw Error('The actual browser draft has no verified synthetic checkout references.');
    const binding=await db(service.from('order_payment_accounts').select('*').eq('id',order.stripe_payment_account_binding_id).eq('photographer_id',expectedPhotographer).single());
    if(![providerState.accounts.express,providerState.accounts.standard].includes(binding.stripe_account_id))throw Error('The browser order is outside the exact connected account pair.');
    await provider.adopt(binding.stripe_account_id,providerState.runId);
    const session=await provider.request(`checkout/sessions/${order.stripe_checkout_session_id}`,{account:binding.stripe_account_id});
    assert.equal(session.metadata?.photographer_id,expectedPhotographer);assert.equal(session.metadata?.order_id,binding.anchor_order_id);assert.equal(session.livemode,false);
    const members=await db(service.from('orders').select('*').in('id',binding.order_ids));
    assert.equal(members.length,binding.order_ids.length);assert.ok(members.every(member=>member.photographer_id===expectedPhotographer&&member.project_id===fixture.projectId&&member.stripe_payment_account_binding_id===binding.id));
    const label=`${plan}-event-${order.currency}-browser-${order.id.slice(0,8)}`;
    proof.orders[label]={label,plan,kind:'event',currency:order.currency,orderId:binding.anchor_order_id,orderIds:binding.order_ids,groupId:binding.order_group_id,
      galleryId:fixture.projectId,sessionId:session.id,accountId:binding.stripe_account_id,bindingId:binding.id,requestHash:binding.request_hash,
      frozenFeeCents:members.reduce((sum,member)=>sum+member.platform_fee_amount_cents,0),actualParentKind:'event',actualWorkflowType:'event',
      source:'discovered_actual_owned_browser_fixture_order',browserInteractionProof:'separate root UI observations required'};persist();
    return{phase:'adopt-browser-order',proofPath,label,orderId:order.id,sessionId:session.id,providerStatus:session.status};
  }
  if(options.phase==='verify-interruption'){
    const c=proof.orders[options.case],fault=assertInterruptionEvidence(privateJson(options.faultProofFile));
    if(!c?.sessionId)throw Error('An actual recovered HTTP checkout is required.');
    assert.equal(c.sessionId,fault.sessionId);assert.equal(c.accountId,fault.accountId);assert.equal(c.bindingId,fault.attemptId);assert.equal(c.requestHash,fault.requestHash);
    const binding=await db(service.from('order_payment_accounts').select('*').eq('id',c.bindingId).single());
    assert.equal(binding.stripe_account_id,c.accountId);assert.equal(binding.checkout_session_id,c.sessionId);assert.equal(binding.request_hash,fault.requestHash);assert.equal(binding.idempotency_key,c.expectedIdempotencyKey);
    assert.deepEqual([...binding.order_ids].sort(),[...c.orderIds].sort());
    await provider.adopt(c.accountId,providerState.runId);
    const session=await provider.request(`checkout/sessions/${c.sessionId}`,{account:c.accountId});assert.equal(session.livemode,false);assert.equal(session.metadata.order_id,c.orderId);assert.equal(session.metadata.platform_fee_amount_cents,String(c.frozenFeeCents));
    c.interruptionProof={mode:fault.mode,armId:fault.armId,originalProviderSession:c.sessionId,originalAccount:c.accountId,immutableRequestHash:binding.request_hash,idempotencyKey:binding.idempotency_key,
      providerCommitted:true,databaseCommitted:fault.databaseCommitted??null,recoveredByActualHttp:true,verifiedAt:new Date().toISOString()};persist();
    return{phase:'verify-interruption',proofPath,case:c.label,mode:fault.mode,originalProviderSession:c.sessionId,originalAccount:c.accountId,sessionUnchanged:true};
  }
  if(['prepare-order','legacy-checkout','checkout','retry-checkout'].includes(options.phase)){
    const retry=options.phase==='retry-checkout';
    if(!retry&&(!proof.subscriptions[plan]?.active||profile.subscription_plan_code!==plan||profile.subscription_status!=='active'))throw Error('Verify the genuine paid subscription for this plan before preparing its fee-bearing checkouts.');
    const kinds=options.kind?[options.kind]:['gallery','event','school'];
    const currencies=options.currency?[options.currency]:['cad','usd'];
    const variant=options.variant||'single',itemType=options.itemType||'print';
    if(!['print','digital'].includes(itemType))throw Error('Only reviewed print and digital acceptance items are allowed.');
    const definitions=retry?[{label:options.case}]:kinds.flatMap(kind=>currencies.map(currency=>({...acceptanceCaseDefinition({plan,kind,currency,variant,name:options.name||''}),plan,kind,currency,variant,itemType})));
    const created=[];
    for(const definition of definitions){
      const {label}=definition;
      let c=proof.orders[label];
      if(retry&&!c)throw Error('Choose an existing owned HTTP acceptance draft for retry.');
      if(!c){
        const ids=Array.from({length:definition.count},()=>randomUUID()).sort();
        c={...definition,orderId:ids[0],orderIds:ids,groupId:ids.length>1?randomUUID():null,galleryId:randomUUID(),studentId:definition.kind==='school'?randomUUID():null,
          pin:'HTTP-TEST-'+randomUUID().slice(0,8),email:`http-parent-${randomUUID()}@example.test`,
          members:ids.map((id,index)=>({id,isTest:definition.variant==='waived'||definition.variant==='mixed-waiver'&&index===1}))};
        proof.orders[label]=c;persist();
      }
      // Earlier single cases are upgraded without replacing their genuine IDs.
      c.orderIds??=[c.orderId];c.members??=[{id:c.orderId,isTest:false}];c.groupId??=null;
      c.feeCents??=(c.plan==='starter'?55:45);c.actualParentKind??=c.kind==='school'?'school':'event';c.actualWorkflowType??=c.kind==='school'?null:'event';c.itemType??='print';persist();
      if(c.sessionId&&!retry){
        if(options.phase==='legacy-checkout'&&c.legacy){
          await provider.adopt(c.accountId,providerState.runId);
          const original=await provider.request(`checkout/sessions/${c.sessionId}`,{account:c.accountId});
          assert.equal(original.metadata?.order_id,c.orderId);assert.equal(original.amount_total,3000*c.orderIds.length);
          await db(service.from('orders').update({stripe_checkout_session_id:original.id}).in('id',c.orderIds).is('stripe_payment_account_binding_id',null));
        }
        created.push({label,sessionId:c.sessionId,reused:true});continue;
      }
      if(c.kind==='school'){
        await db(service.from('schools').upsert({id:c.galleryId,photographer_id:expectedPhotographer,school_name:'Disposable HTTP TEST School',status:'active',portal_status:'active'},{onConflict:'id',ignoreDuplicates:true}));
        await db(service.from('students').upsert({id:c.studentId,school_id:c.galleryId,pin:c.pin,first_name:'Synthetic',last_name:'Student'},{onConflict:'id',ignoreDuplicates:true}));
      }else await db(service.from('projects').upsert({id:c.galleryId,photographer_id:expectedPhotographer,title:`Disposable HTTP ${c.kind} TEST`,workflow_type:c.actualWorkflowType,access_mode:'pin',access_pin:c.pin,status:'active',portal_status:'active',email_required:false,gallery_settings:{}},{onConflict:'id',ignoreDuplicates:true}));
      for(const member of c.members){
        await db(service.from('orders').upsert({id:member.id,photographer_id:expectedPhotographer,school_id:c.kind==='school'?c.galleryId:null,project_id:c.kind==='school'?null:c.galleryId,student_id:c.studentId,order_group_id:c.groupId,parent_email:c.email,customer_email:c.email,total_cents:3000,total_amount:30,subtotal_cents:3000,tax_cents:0,currency:c.currency,status:'payment_pending',payment_status:'pending',package_name:c.itemType==='digital'?'HTTP TEST digital photo':'HTTP TEST print',cart_snapshot:[],is_test:member.isTest},{onConflict:'id',ignoreDuplicates:true}));
        const items=await db(service.from('order_items').select('id').eq('order_id',member.id));
        if(!items.length)await db(service.from('order_items').insert({order_id:member.id,product_name:c.itemType==='digital'?'Digital photo':'8x10 print',quantity:1,unit_price_cents:3000,line_total_cents:3000,price:30,sku:c.itemType==='digital'?'http-test-digital-photo.jpg':'http-test-print'}));
      }
      if(!c.laneId){
        const grant=await http('/api/portal/session',{method:'POST',cookies:proof.parentCookies,body:{kind:c.actualParentKind,galleryId:c.galleryId,pin:c.pin,email:c.email}});
        assert.equal(grant.photographerId,expectedPhotographer);c.laneId=grant.laneId;persist();
      }
      const parentToken=proof.parentCookies.studio_os_parent_session_dev;if(!parentToken)throw Error('Actual parent bootstrap did not issue its opaque session cookie.');
      // Arrange owned drafts via the real service-only attestation RPC. Parent
      // credentials, Redis throttling, cookie issuance and checkout authorization
      // are real; the separate draft-creation UI is outside this test target.
      await db(service.rpc('record_parent_order_session_access',{p_token_hash:createHash('sha256').update(parentToken).digest('hex'),p_lane_ids:[c.laneId],p_order_ids:c.orderIds}));
      const before=await db(service.from('orders').select('id,platform_fee_collection_method,platform_fee_amount_cents').in('id',c.orderIds));
      if(!retry&&options.phase!=='legacy-checkout')assert.ok(before.every(row=>row.platform_fee_collection_method===null),'New fixture fees must be unset before actual checkout freezes them.');
      c.expectedIdempotencyKey=`studio-os-order-session-${c.orderId}`;c.preparedAt=new Date().toISOString();persist();
      if(options.phase==='prepare-order'){
        created.push({label,orderId:c.orderId,orderIds:c.orderIds,expectedIdempotencyKey:c.expectedIdempotencyKey,prepared:true});continue;
      }
      if(options.phase==='legacy-checkout'){
        if(!['open','expired'].includes(options.legacyStatus)||proof.actualNextStatus.currentAccountId!==providerState.accounts.express)throw Error('Legacy fixtures require explicit open/expired status while the original Express account remains selected.');
        await provider.adopt(providerState.accounts.express,providerState.runId);
        // This deliberately represents a pre-history payment. It is created
        // only in the isolated provider and saved without an account binding;
        // the actual authenticated backfill handler must supply GET proof.
        // The frozen fee is an explicit fixture of old-code behavior. Actual
        // subscription recognition was independently proved through billing;
        // this setup does not replace the genuine HTTP fee-policy tests.
        const legacyFeeMode=options.legacyFee||'frozen';if(!['frozen','none'].includes(legacyFeeMode))throw Error('Choose an explicit frozen or absent historical application fee.');
        let frozenFee=null;
        if(legacyFeeMode==='frozen'){
          const app=loadActualApplication(service);
          const quote=await app.payments.quoteDirectOrderPlatformFees({pricingProfile:'gallery_v3',planCode:c.plan,subscriptionStatus:'active',isPlatformAdmin:false,currency:c.currency,
            orders:c.members.map(member=>({id:member.id,totalCents:3000,isTest:member.isTest}))});
          const snapshots=quote.orders.map(member=>({id:member.id,platform_fee_collection_method:member.collectionMethod,platform_fee_amount_cents:member.amountCents,platform_fee_currency:quote.currency,platform_fee_rate_cents:quote.rateCents}));
          const rows=await db(service.rpc('freeze_order_platform_fees',{p_photographer_id:expectedPhotographer,p_snapshots:snapshots}));
          frozenFee=app.payments.directOrderPlatformFeePayload(rows,c.currency);
          assert.equal(frozenFee.amountCents,c.feeCents);
        }
        const params=new URLSearchParams({mode:'payment',success_url:`${appOrigin}/sign-in?stripe_test_legacy=paid`,cancel_url:`${appOrigin}/sign-in?stripe_test_legacy=cancelled`,
          client_reference_id:c.orderId,customer_email:c.email,'payment_method_types[0]':'card','line_items[0][quantity]':'1',
          'line_items[0][price_data][currency]':c.currency,'line_items[0][price_data][unit_amount]':String(3000*c.orderIds.length),'line_items[0][price_data][product_data][name]':'Disposable historical TEST photo order'});
        const metadata={billing_flow:'customer_order',order_id:c.orderId,photographer_id:expectedPhotographer,
          ...(c.groupId?{order_group_id:c.groupId}:{}),...(c.kind==='school'?{school_id:c.galleryId,student_id:c.studentId}:{project_id:c.galleryId})};
        for(const [name,value]of Object.entries(metadata)){params.set(`metadata[${name}]`,value);params.set(`payment_intent_data[metadata][${name}]`,value);}
        if(frozenFee){
          params.set('payment_intent_data[application_fee_amount]',String(frozenFee.amountCents));
          const feeMetadata=loadActualApplication(service).payments.directOrderPlatformFeeMetadata(frozenFee);
          for(const [name,value]of Object.entries(feeMetadata)){params.set(`metadata[${name}]`,value);params.set(`payment_intent_data[metadata][${name}]`,value);}
        }
        let session=await provider.request('checkout/sessions',{method:'POST',account:providerState.accounts.express,body:params,idempotencyKey:`studio-standard-test-http-legacy-${c.orderId}`});
        c.sessionId=session.id;c.url=session.url;c.accountId=providerState.accounts.express;c.frozenFeeCents=frozenFee?.amountCents||0;c.feeCents=c.frozenFeeCents;c.legacy=true;c.legacyFeeMode=legacyFeeMode;c.source='synthetic_pre_history_provider_fixture';persist();
        if(options.legacyStatus==='expired')session=await provider.request(`checkout/sessions/${session.id}/expire`,{method:'POST',account:c.accountId,idempotencyKey:`studio-standard-test-http-legacy-expire-${c.orderId}`});
        await db(service.from('orders').update({stripe_checkout_session_id:session.id}).in('id',c.orderIds));
        const saved=await db(service.from('orders').select('stripe_payment_account_binding_id,platform_fee_collection_method').in('id',c.orderIds));
        assert.ok(saved.every(row=>row.stripe_payment_account_binding_id===null&&row.platform_fee_collection_method===(frozenFee?'connect_application_fee':null)));
        c.legacyProviderStatus=session.status;persist();created.push({label,sessionId:session.id,status:session.status,originalAccount:c.accountId,unbound:true,historicalFeeCents:c.frozenFeeCents,orderCount:c.orderIds.length});continue;
      }
      const checkout=await http(`/api/stripe/checkout?parentLaneId=${c.laneId}`,{method:'POST',cookies:proof.parentCookies,body:{orderId:c.orderId,parentLaneId:c.laneId}});
      const saved=await db(service.from('orders').select('*').in('id',c.orderIds).order('id'));
      assert.equal(saved.length,c.orderIds.length);
      for(const row of saved){
        if(c.legacy&&c.legacyFeeMode==='none'){assert.equal(row.platform_fee_collection_method,null);assert.equal(row.platform_fee_amount_cents,null);assert.ok(row.stripe_payment_account_binding_id);continue;}
        const member=c.members.find(member=>member.id===row.id),expected=member.isTest?0:(c.plan==='starter'?55:45);
        assert.equal(row.platform_fee_collection_method,expected?'connect_application_fee':'waived');assert.equal(row.platform_fee_amount_cents,expected);assert.equal(row.platform_fee_currency,c.currency);assert.ok(row.stripe_payment_account_binding_id);
      }
      assert.equal(new Set(saved.map(row=>row.stripe_payment_account_binding_id)).size,1);
      const binding=await db(service.from('order_payment_accounts').select('*').eq('id',saved[0].stripe_payment_account_binding_id).single());
      assert.deepEqual([...binding.order_ids].sort(),[...c.orderIds].sort());assert.equal(binding.amount_cents,3000*c.orderIds.length);assert.equal(binding.currency,c.currency);if(!c.legacy)assert.ok(binding.request_hash);
      const account=await provider.adopt(binding.stripe_account_id,providerState.runId);
      const session=await provider.request(`checkout/sessions/${checkout.sessionId||saved[0].stripe_checkout_session_id}`,{account:account.id});
      assert.equal(session.livemode,false);assert.equal(session.status,'open');
      if(c.legacy&&c.legacyFeeMode==='none')assert.equal(session.metadata.platform_fee_collection_method,undefined);
      else{assert.equal(session.metadata.platform_fee_amount_cents,String(c.feeCents));assert.equal(session.metadata.platform_fee_currency,c.currency);}
      if(c.sessionId&&c.legacyProviderStatus!=='expired')assert.equal(session.id,c.sessionId,'A route retry must reuse the same provider Session.');
      if(c.legacyProviderStatus==='expired'){c.originalExpiredSessionId??=c.sessionId;assert.notEqual(session.id,c.originalExpiredSessionId);}
      c.sessionId=session.id;c.url=checkout.url||session.url;c.accountId=account.id;c.frozenFeeCents=saved.reduce((sum,row)=>sum+row.platform_fee_amount_cents,0);c.bindingId=binding.id;c.actualCheckoutRoute=true;c.requestHash=binding.request_hash;persist();created.push({label,sessionId:c.sessionId,feeCents:c.frozenFeeCents,accountId:c.accountId,actualParentKind:c.actualParentKind,itemType:c.itemType,orderCount:c.orderIds.length});
    }
    return{phase:options.phase,proofPath,created,allUnpaid:true};
  }
  if(options.phase==='verify-orders'){
    const verified=[];
    for(const c of Object.values(proof.orders).filter(c=>c.plan===plan&&c.sessionId&&(!options.case||c.label===options.case))){
      await provider.adopt(c.accountId,providerState.runId);
      const session=await provider.request(`checkout/sessions/${c.sessionId}`,{account:c.accountId});
      if(session.status!=='complete'||session.payment_status!=='paid')throw Error(`Actual hosted TEST checkout remains unpaid: ${c.label}`);
      const intent=await provider.request(`payment_intents/${session.payment_intent}`,{account:c.accountId});assert.equal(intent.status,'succeeded');assert.equal(intent.application_fee_amount||0,c.frozenFeeCents);assert.equal(intent.currency,c.currency);
      const charge=await provider.request(`charges/${intent.latest_charge}`,{account:c.accountId});
      let fee=null;
      if(c.frozenFeeCents){
        fee=await provider.request(`application_fees/${typeof charge.application_fee==='string'?charge.application_fee:charge.application_fee.id}`);assert.equal(fee.account,c.accountId);assert.equal(fee.charge,charge.id);
      }else assert.equal(charge.application_fee,null,'Waived orders must not collect an application fee.');
      const orders=await db(service.from('orders').select('*').in('id',c.orderIds||[c.orderId]));
      assert.equal(orders.length,(c.orderIds||[c.orderId]).length);
      for(const order of orders){assert.ok(order.paid_at);assert.ok(['paid','succeeded'].includes(order.payment_status));assert.equal(order.stripe_payment_intent_id,intent.id);}
      const bindingId=orders[0].stripe_payment_account_binding_id;
      if(bindingId){
        const binding=await db(service.from('order_payment_accounts').select('*').eq('id',bindingId).single());
        assert.ok(orders.every(order=>order.stripe_payment_account_binding_id===bindingId));assert.equal(binding.stripe_account_id,c.accountId);
        assert.equal(binding.amount_cents,intent.amount);assert.equal(binding.currency,c.currency);assert.deepEqual([...binding.order_ids].sort(),orders.map(order=>order.id).sort());
        if(c.bindingId)assert.equal(bindingId,c.bindingId);c.bindingId=bindingId;
      }else if(!c.legacy)throw Error('A current HTTP checkout cannot be accepted without its immutable original-account binding.');
      const events=await db(service.from('customer_order_webhooks').select('event_id,status').eq('order_id',c.orderId).eq('status','processed'));assert.ok(events.length);
      const captures=signedDeliveries(events.map(event=>event.event_id),c.accountId);
      c.paymentIntentId=intent.id;c.chargeId=charge.id;c.applicationFeeId=fee?.id||null;c.providerFeeSettlement=fee?{amount:fee.amount,currency:fee.currency}:null;c.actualSignedNextWebhookIds=events.map(e=>e.event_id);c.signedHttpCaptures=captures;c.verified=true;persist();verified.push({label:c.label,chargeCurrency:c.currency,feeCharged:c.frozenFeeCents,feeSettlement:c.providerFeeSettlement,orderCount:orders.length,signedNextHttp200:captures.length});
    }
    if(!verified.length)throw Error('No actual HTTP checkout cases exist for this plan.');return{phase:'verify-orders',proofPath,verified};
  }
  if(options.phase==='refund'){
    const c=proof.orders[options.case];if(!c?.verified)throw Error('Choose a genuinely paid and verified HTTP checkout case.');
    const snapshot=await http(`/api/dashboard/orders/payment?orderId=${c.orderId}`,{owner:true});
    const outcome=await http('/api/dashboard/orders/payment',{method:'POST',owner:true,body:{orderId:c.orderId,action:'refund',reason:'Disposable genuine Stripe TEST acceptance refund',paymentId:snapshot.paymentId,amountCents:snapshot.remainingCents,orderIds:snapshot.orderIds}});
    if(c.applicationFeeId){const fee=await provider.request(`application_fees/${c.applicationFeeId}`);assert.equal(fee.amount_refunded,fee.amount);}assert.equal(outcome.status,'refunded');
    c.actualHttpRefund=true;persist();return{phase:'refund',proofPath,case:c.label,originalAccount:c.accountId,status:outcome.status};
  }
  if(options.phase==='partial-refund'){
    const c=proof.orders[options.case];if(!c?.verified||c.actualHttpRefund)throw Error('Choose an unrefunded, genuinely paid and verified HTTP checkout case.');
    const amount=Number(options.amountCents);if(!Number.isSafeInteger(amount)||amount<1||amount>1000)throw Error('The bounded synthetic partial refund must be 1–1000 minor units.');
    await provider.adopt(c.accountId,providerState.runId);
    const intent=await provider.request(`payment_intents/${c.paymentIntentId}`,{account:c.accountId});assert.equal(intent.status,'succeeded');
    const charge=await provider.request(`charges/${c.chargeId}`,{account:c.accountId});if(amount>=charge.amount-charge.amount_refunded)throw Error('This stage must leave a positive remainder for the actual HTTP full-refund handler.');
    c.partialRefund??={id:randomUUID(),amountCents:amount};assert.equal(c.partialRefund.amountCents,amount);persist();
    const body=new URLSearchParams({payment_intent:c.paymentIntentId,amount:String(amount),'metadata[studio_standard_acceptance]':providerState.runId,'metadata[order_id]':c.orderId});
    if(c.applicationFeeId)body.set('refund_application_fee','true');
    const refund=await provider.request('refunds',{method:'POST',account:c.accountId,body,idempotencyKey:`studio-standard-test-http-partial-refund-${c.partialRefund.id}`});
    assert.equal(refund.payment_intent,c.paymentIntentId);assert.equal(refund.amount,amount);assert.equal(refund.status,'succeeded');
    c.partialRefund.refundId=refund.id;c.partialRefund.source='real_provider_partial_refund_then_signed_actual_next_reconciliation';persist();return{phase:'partial-refund',proofPath,case:c.label,originalAccount:c.accountId,amountCents:amount,refundId:refund.id};
  }
  if(options.phase==='refund-unfulfilled'){
    const c=proof.orders[options.case];
    if(options.allowUnfulfilledTestRefund!=='yes'||!c?.actualCheckoutRoute||!c.bindingId||!c.sessionId||c.verified||c.frozenFeeCents<=0)throw Error('Root must explicitly authorize the known fee-bearing actual HTTP checkout whose genuine paid deliveries are held.');
    await provider.adopt(c.accountId,providerState.runId);
    const binding=await db(service.from('order_payment_accounts').select('*').eq('id',c.bindingId).single());
    assert.equal(binding.stripe_account_id,c.accountId);assert.equal(binding.checkout_session_id,c.sessionId);assert.equal(binding.request_hash,c.requestHash);assert.deepEqual([...binding.order_ids].sort(),[...c.orderIds].sort());
    const session=await provider.request(`checkout/sessions/${c.sessionId}`,{account:c.accountId});
    assert.equal(session.livemode,false);assert.equal(session.status,'complete');assert.equal(session.payment_status,'paid');assert.equal(session.metadata.order_id,c.orderId);assert.equal(session.metadata.photographer_id,expectedPhotographer);assert.equal(session.metadata.platform_fee_amount_cents,String(c.frozenFeeCents));
    const intent=await provider.request(`payment_intents/${session.payment_intent}`,{account:c.accountId});
    assert.equal(intent.status,'succeeded');assert.equal(intent.amount,intent.amount_received);assert.equal(intent.amount,binding.amount_cents);assert.equal(intent.currency,c.currency);assert.equal(intent.application_fee_amount,c.frozenFeeCents);assert.equal(intent.metadata.order_id,c.orderId);assert.equal(intent.metadata.photographer_id,expectedPhotographer);
    const charge=await provider.request(`charges/${intent.latest_charge}`,{account:c.accountId});
    assert.equal(charge.payment_intent,intent.id);assert.equal(charge.amount,intent.amount);assert.equal(charge.currency,c.currency);assert.equal(charge.paid,true);assert.equal(charge.captured,true);
    const feeId=typeof charge.application_fee==='string'?charge.application_fee:charge.application_fee?.id;if(!feeId)throw Error('The genuine collected application fee must exist before the bounded refund.');
    const fee=await provider.request(`application_fees/${feeId}`);assert.equal(fee.account,c.accountId);assert.equal(fee.charge,charge.id);if(fee.currency===c.currency)assert.equal(fee.amount,c.frozenFeeCents);
    const orders=await db(service.from('orders').select('id,status,payment_status,paid_at,stripe_payment_account_binding_id,platform_fee_amount_cents,platform_fee_currency').in('id',c.orderIds));
    assert.equal(orders.length,c.orderIds.length);assert.ok(orders.every(order=>order.stripe_payment_account_binding_id===c.bindingId));
    assert.equal(orders.reduce((sum,order)=>sum+order.platform_fee_amount_cents,0),c.frozenFeeCents);assert.ok(orders.every(order=>order.platform_fee_currency===c.currency));
    if(!c.unfulfilledRefund){
      assert.equal(charge.amount_refunded,0);assert.ok(orders.every(order=>!order.paid_at&&order.payment_status==='pending'&&order.status==='payment_pending'));
      const deliveries=await db(service.from('customer_order_webhooks').select('event_id').eq('order_id',c.orderId));assert.equal(deliveries.length,0,'First paid-event delivery must not have reached the app before this refund.');
      c.unfulfilledRefund={id:randomUUID(),sessionId:session.id,paymentIntentId:intent.id,chargeId:charge.id,applicationFeeId:feeId,originalAccount:c.accountId,
        grossCents:intent.amount,frozenFeeCents:c.frozenFeeCents,pendingSqlBeforeRefund:orders,paidLedgerRowsBeforeRefund:0,preparedAt:new Date().toISOString()};persist();
    }
    assert.equal(c.unfulfilledRefund.paymentIntentId,intent.id);assert.equal(c.unfulfilledRefund.originalAccount,c.accountId);assert.equal(c.unfulfilledRefund.grossCents,intent.amount);
    const body=new URLSearchParams({payment_intent:intent.id,refund_application_fee:'true','metadata[studio_standard_acceptance]':providerState.runId,'metadata[acceptance_refund_id]':c.unfulfilledRefund.id,'metadata[order_id]':c.orderId});
    const refund=await provider.request('refunds',{method:'POST',account:c.accountId,body,idempotencyKey:`studio-standard-test-unfulfilled-refund-${c.unfulfilledRefund.id}`});
    assert.equal(refund.payment_intent,intent.id);assert.equal(refund.amount,intent.amount);assert.equal(refund.status,'succeeded');
    c.paymentIntentId=intent.id;c.chargeId=charge.id;c.applicationFeeId=feeId;c.unfulfilledRefund.refundId=refund.id;c.unfulfilledRefund.succeeded=true;persist();
    return{phase:'refund-unfulfilled',proofPath,case:c.label,originalAccount:c.accountId,grossRefundedCents:refund.amount,frozenFeeCents:c.frozenFeeCents,paidSqlAndLedgerAbsentBeforeRefund:true};
  }
  if(options.phase==='verify-refund'){
    const c=proof.orders[options.case];if(!c?.verified&&!c?.unfulfilledRefund?.succeeded)throw Error('Choose a genuinely paid and verified HTTP checkout case.');
    await provider.adopt(c.accountId,providerState.runId);
    const charge=await provider.request(`charges/${c.chargeId}`,{account:c.accountId});assert.ok(charge.amount_refunded>0);
    const rows=await db(service.from('orders').select('id,status,payment_status,refund_amount_cents,stripe_payment_account_binding_id').in('id',c.orderIds||[c.orderId]));
    assert.equal(rows.reduce((sum,row)=>sum+row.refund_amount_cents,0),charge.amount_refunded);
    assert.ok(rows.every(row=>row.stripe_payment_account_binding_id===c.bindingId));
    if(charge.amount_refunded===charge.amount)assert.ok(rows.every(row=>row.status==='refunded'&&row.payment_status==='refunded'));
    else assert.ok(rows.some(row=>row.payment_status==='partially_refunded'));
    const merchant=await db(service.from('stripe_merchant_events').select('event_id,event_type,payload,status').eq('stripe_account_id',c.accountId).eq('status','processed'));
    const matching=merchant.filter(row=>{const object=row.payload?.data?.object;return object?.id===c.chargeId||object?.payment_intent===c.paymentIntentId||object?.charge===c.chargeId;});
    const captures=signedDeliveries(matching.map(row=>row.event_id),c.accountId);
    const fee=c.applicationFeeId?await provider.request(`application_fees/${c.applicationFeeId}`):null;
    if(fee&&charge.amount_refunded===charge.amount)assert.equal(fee.amount_refunded,fee.amount);
    let platformCaptures=[];
    if(fee){
      const platformEvents=merchant.filter(row=>row.event_type.startsWith('application_fee.')&&
        (row.payload?.data?.object?.id===fee.id||row.payload?.data?.object?.fee===fee.id));
      platformCaptures=signedDeliveries(platformEvents.map(row=>row.event_id),null);
    }
    c.refundProof={chargeRefundedCents:charge.amount_refunded,applicationFeeRefunded:fee?{amount:fee.amount_refunded,currency:fee.currency}:null,signedHttpCaptures:captures,signedPlatformFeeHttpCaptures:platformCaptures,verifiedAt:new Date().toISOString()};persist();
    return{phase:'verify-refund',proofPath,case:c.label,originalAccount:c.accountId,refundedCents:charge.amount_refunded,applicationFeeRefunded:c.refundProof.applicationFeeRefunded,signedNextHttp200:captures.length,signedPlatformFeeNextHttp200:platformCaptures.length};
  }
  if(options.phase==='recover-customer-events'){
    const secretFile=realpathSync(options.cronSecretFile),info=statSync(secretFile);
    if(!info.isFile()||(info.mode&0o077)!==0||info.uid!==process.getuid?.()||secretFile.startsWith(repo+sep))throw Error('The explicit isolated cron credential must be private and outside the repository.');
    const secret=readFileSync(secretFile,'utf8').trim();if(secret.length<32||secret.length>300||/[\s\r\n]/.test(secret))throw Error('Invalid isolated cron credential.');
    const before=await db(service.from('customer_order_webhooks').select('event_id,order_id,status,attempts,payload_hash').in('status',['pending','processing']));
    const response=await fetch(`${appOrigin}/api/cron/customer-order-payment-recovery`,{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(60_000)});
    const result=await response.json();proof.requests.push({surface:'actual_next_cron_http',path:'/api/cron/customer-order-payment-recovery',method:'GET',status:response.status,at:new Date().toISOString()});persist();
    const after=before.length?await db(service.from('customer_order_webhooks').select('event_id,order_id,status,attempts,payload_hash').in('event_id',before.map(event=>event.event_id))):[];
    for(const event of before){const recovered=after.find(row=>row.event_id===event.event_id);assert.equal(recovered?.payload_hash,event.payload_hash);}
    proof.customerRecovery??=[];proof.customerRecovery.push({at:new Date().toISOString(),httpStatus:response.status,result,before,after});persist();
    if(!response.ok||!result.ok)throw Error('Actual customer event recovery still needs retry; inspect private unchanged-payload evidence.');
    return{phase:'recover-customer-events',proofPath,result,storedEventsRecovered:after.filter(event=>event.status==='processed').length};
  }
  throw Error('This acceptance phase is being prepared; do not substitute helper-only evidence.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options={};for(let i=2;i<process.argv.length;i+=2){const name=process.argv[i]?.replace(/^--/,'').replace(/-([a-z0-9])/g,(_,c)=>c.toUpperCase());if(!name||!process.argv[i+1])throw Error('Explicit HTTP acceptance arguments are required.');options[name]=process.argv[i+1];}
  runHttpAcceptance(options).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error=>{process.stderr.write(redactSandboxError(error.message)+'\n');process.exitCode=1;});
}
