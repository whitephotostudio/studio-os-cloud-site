import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as policy from '../lib/order-payment-policy.ts';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/api/dashboard/orders/payment/route.ts',import.meta.url),'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(path, overrides={}) {
  const exports={};
  const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',code)(name=>name in overrides?overrides[name]:name.startsWith('@/')?{}:require(name),exports);
  return exports;
}
const actualPayments=load('lib/payments.ts',{'@/lib/studio-pricing':load('lib/studio-pricing.ts'),'@/lib/order-currency':load('lib/order-currency.ts')});
const id='11111111-1111-4111-8111-111111111111';
const studio='22222222-2222-4222-8222-222222222222';
function fixture(options={}) {
  const row={id,photographer_id:studio,order_group_id:null,total_cents:10360,currency:options.orderCurrency||'cad',status:'paid',payment_status:'succeeded',paid_at:'2026-09-23',stripe_payment_intent_id:'pi_test',stripe_checkout_session_id:'cs_test'};
  if(options.unpaid) Object.assign(row,{status:'payment_pending',payment_status:'pending',paid_at:null,stripe_payment_intent_id:null});
  if(options.starting) Object.assign(row,{status:'checkout_starting',stripe_checkout_session_id:null});
  const rows=[row];
  if(options.combined){row.order_group_id='33333333-3333-4333-8333-333333333333';rows.push({...row,id:'44444444-4444-4444-8444-444444444444'});}
  if(options.directFee || options.waivedFee) rows.forEach((r,index)=>Object.assign(r,{platform_fee_collection_method:options.waivedFee||(options.waivedMember&&index===rows.length-1)?'waived':'connect_application_fee',platform_fee_amount_cents:options.waivedFee||(options.waivedMember&&index===rows.length-1)?0:40,platform_fee_currency:r.currency,platform_fee_rate_cents:options.waivedFee?0:40,stripe_application_fee_id:options.waivedFee||(options.waivedMember&&index===rows.length-1)?null:'fee_test'}));
  const tables={orders:rows,photographers:[{id:studio,user_id:options.otherOwner?'other':'owner',stripe_connected_account_id:'acct_test',stripe_account_id:null}]};
  const service={from(table){let predicate=()=>true;let update;const chain={select(){return chain},eq(k,v){const prev=predicate;predicate=r=>prev(r)&&r[k]===v;return chain},in(k,v){const prev=predicate;predicate=r=>prev(r)&&v.includes(r[k]);return chain},is(k,v){return chain.eq(k,v)},order(){return chain},update(v){update=v;return chain},single(){return run(true)},maybeSingle(){return run(true)},then(a,b){return run(false).then(a,b)}};
  async function run(single){const matching=tables[table].filter(predicate);if(update)matching.forEach(r=>Object.assign(r,update));return {data:single?matching.length===1?structuredClone(matching[0]):null:structuredClone(matching),error:single&&matching.length!==1?{message:'not found'}:null};}return chain;}};
  const notifications=[];
  const actions=[];let refunds=[];let locked=false;let sessionStatus=options.unpaid?'open':'complete';let lost=options.lostReply;
  const intent={id:'pi_test',status:'succeeded',amount:10360*rows.length,amount_received:10360*rows.length,currency:row.currency,latest_charge:'ch_test',metadata:{photographer_id:studio,order_id:id}};
  if(row.order_group_id)intent.metadata.order_group_id=row.order_group_id;
  let savedFee;
  if(options.directFee || options.waivedFee){savedFee=actualPayments.directOrderPlatformFeePayload(rows,intent.currency);Object.assign(intent.metadata,{platform_fee_collection_method:savedFee.collectionMethod,platform_fee_amount_cents:String(savedFee.amountCents),platform_fee_currency:savedFee.currency,platform_fee_snapshot_key:savedFee.snapshotKey,platform_fee_billable_order_count:String(savedFee.billableOrderCount),platform_fee_rate_cents:String(savedFee.rateCents)});}
  const fee={id:'fee_test',object:'application_fee',account:options.wrongFeeAccount?'acct_other':'acct_test',charge:options.wrongFeeCharge?'ch_other':'ch_test',amount:options.settlementCurrency?32:(savedFee?.amountCents||0),amount_refunded:0,currency:options.settlementCurrency||intent.currency,refunded:false};
  if(options.initialFeeRefunded){fee.amount_refunded=options.initialFeeRefunded;fee.refunded=fee.amount_refunded===fee.amount;}
  if(options.alreadyFullCustomerRefund)refunds=[{id:'re_prior',status:'succeeded',amount:intent.amount}];
  else if(options.partialPrior)refunds=[{id:'re_partial',status:'succeeded',amount:options.partialPrior}];
  if(options.mismatchedMetadata)intent.metadata.platform_fee_snapshot_key='different';
  if(options.mismatchedGroup)intent.metadata.order_group_id='group_other';
  if(options.mismatchedSavedFeeId)rows[0].stripe_application_fee_id='fee_other';
  if(options.mixedLegacy)rows[rows.length-1].platform_fee_collection_method=null;
  if(options.missingCharge)intent.latest_charge=null;
  if(options.wrongFeeAmount)fee.amount++;
  if(options.failedPayment){Object.assign(row,{status:'payment_pending',paid_at:null,payment_status:'pending'});Object.assign(intent,{status:'requires_payment_method',amount_received:0});sessionStatus='open';}
  async function stripeRequest(path,params={}) {
    if(path.startsWith('application_fees/')){
      assert.equal(params.account,undefined,'application fee operations must address the platform');
      if(params.method==='POST'){
        actions.push({path,...params});assert.ok(rows.every(r=>r.status==='refund_pending'),'hold before repairing fee refund');
        assert.equal(Number(params.body.get('amount')),fee.amount-fee.amount_refunded);
        if(!options.feeRecoveryPending){fee.amount_refunded=fee.amount;fee.refunded=true;}
        if(options.feeRecoveryLostReply){options.feeRecoveryLostReply=false;throw Error('lost fee refund response');}
        return {id:'fr_test',amount:fee.amount};
      }
      return structuredClone(fee);
    }
    if(params.account!=='acct_test')throw Error('wrong account');
    if(params.method==='POST'){
      actions.push({path,...params});
      if(path==='refunds'){
        assert.ok(rows.every(r=>r.status==='refund_pending'),'hold must exist before refund');
        const next={id:'re_test',status:options.pending?'pending':'succeeded',amount:intent.amount-refunds.filter(r=>r.status==='succeeded').reduce((sum,r)=>sum+r.amount,0)};
        refunds.push(next);
        if(params.body.get('refund_application_fee')==='true'&&!options.feePending&&!options.pending){fee.amount_refunded=fee.amount;fee.refunded=true;}
        if(lost){lost=false;throw Error('connection lost after Stripe accepted');}
        return next;
      }
      if(path.endsWith('/expire')){if(options.paymentWins)throw Error('session completed while expiring');sessionStatus='expired';return {status:sessionStatus};}
    }
    if(path==='refunds')return {data:refunds,has_more:false};
    if(path.startsWith('checkout/sessions/'))return {id:'cs_test',status:sessionStatus,payment_status:options.unpaid?'unpaid':'paid',payment_intent:options.unpaid?null:'pi_test'};
    if(path.startsWith('payment_intents/'))return intent;
    if(path.startsWith('charges/'))return {id:'ch_test',payment_intent:intent.id,amount:intent.amount,currency:intent.currency,amount_refunded:options.chargeRefundMismatch?0:refunds.filter(r=>r.status==='succeeded').reduce((n,r)=>n+r.amount,0),application_fee:savedFee?.amountCents?'fee_test':null,application_fee_amount:options.mismatchedChargeFee?41:savedFee?.amountCents||null};
    throw Error(`unexpected stripe request ${path}`);
  }
  const dependencies={
    'next/server':{NextResponse:{json:(value,options)=>Response.json(value,options)}},zod:require('zod'),
    '@/lib/dashboard-auth':{resolveDashboardAuth:async()=>({user:options.signedOut?null:{id:'owner'},mfaSatisfied:!options.missingMfa}),createDashboardServiceClient:()=>service},
    '@/lib/payments':{getConnectedAccountId:p=>p.stripe_connected_account_id,stripeRequest,markOrderOrGroupRefunded:async()=>{rows.forEach(r=>Object.assign(r,{status:'refunded',payment_status:'refunded'}));}},
    '@/lib/order-payment-lock':{lockOrderPayment:async()=>{if(locked)throw Error('busy');locked=true;return async()=>{locked=false;};}},
    '@/lib/order-refund-notifications':{scheduleOrderRefundEmails:async(_service,input)=>{if(options.emailFailure)throw Error('queue unavailable');notifications.push(input);}},
    '@/lib/order-payment-policy':policy,'@/lib/audit':{recordAudit:async()=>{}},
  };
  dependencies['@/lib/direct-order-fee-refund']=load('lib/direct-order-fee-refund.ts',{'@/lib/payments':{...actualPayments,stripeRequest},'@/lib/order-payment-policy':policy});
  const exports={};new Function('require','exports',compiled)(name=>{if(!dependencies[name])throw Error(name);return dependencies[name];},exports);
  const body={orderId:id,action:'refund',reason:'Duplicate payment',paymentId:options.unpaid?null:'pi_test',amountCents:options.unpaid||options.alreadyFullCustomerRefund?0:intent.amount-(options.partialPrior||0),orderIds:rows.map(r=>r.id)};
  const request=(data=body)=>({nextUrl:new URL(`https://example.test/api/dashboard/orders/payment?orderId=${id}`),headers:new Headers(),json:async()=>data});
  return {exports,rows,actions,body,request,notifications,fee,confirmFeeRefund(){fee.amount_refunded=fee.amount;fee.refunded=true;}};
}
test('refund is owner scoped, confirmed, and one Stripe request across retries',async()=>{
  const f=fixture({combined:true});
  const preview=await (await f.exports.GET(f.request())).json();
  assert.equal(preview.remainingCents,20720);assert.equal(preview.orderIds.length,2);
  const first=await f.exports.POST(f.request());assert.equal(first.status,200);
  assert.ok(f.rows.every(r=>r.status==='refunded'));
  assert.equal((await f.exports.POST(f.request())).status,200);
  assert.equal(f.actions.filter(a=>a.path==='refunds').length,1);
  assert.equal(f.actions[0].idempotencyKey,'studio-os-full-refund-pi_test');
  assert.equal(f.notifications.length,2);
  assert.ok(f.notifications.every(n=>n.refunds[0].id==='re_test' && n.orderId===id && n.account==='acct_test'));
});
test('lost refund reply keeps a hold, and retry reconciles without another refund',async()=>{
  const f=fixture({lostReply:true});
  assert.equal((await f.exports.POST(f.request())).status,409);
  assert.equal(f.rows[0].status,'refund_pending');
  assert.equal((await f.exports.GET(f.request())).status,200);
  assert.equal(f.rows[0].status,'refunded');
  assert.equal((await f.exports.POST(f.request())).status,200);
  assert.equal(f.rows[0].status,'refunded');assert.equal(f.actions.length,1);
});
test('pending refunds remain on hold, never reported as completed',async()=>{
  const f=fixture({pending:true});
  const result=await (await f.exports.POST(f.request())).json();
  assert.equal(result.status,'refund_pending');
  const preview=await (await f.exports.GET(f.request())).json();
  assert.equal(f.notifications.length,0);
  assert.equal(preview.refundedCents,0);assert.equal(preview.pending,true);assert.equal(preview.canRefund,false);
  assert.equal((await f.exports.POST(f.request())).status,409);assert.equal(f.actions.length,1);
});
test('unpaid cancellation expires checkout before closing; a payment race does not claim cancellation',async()=>{
  const f=fixture({unpaid:true});f.body.action='cancel';
  assert.equal((await f.exports.POST(f.request())).status,200);
  assert.equal(f.actions[0].path,'checkout/sessions/cs_test/expire');assert.equal(f.rows[0].status,'cancelled');
  const race=fixture({unpaid:true,paymentWins:true});race.body.action='cancel';
  assert.equal((await race.exports.POST(race.request())).status,409);assert.equal(race.rows[0].status,'cancel_pending');
});
test('ownership, MFA, stale amounts, combined scope and ambiguous checkout block money actions',async()=>{
  for(const options of [{signedOut:true},{otherOwner:true},{missingMfa:true},{unpaid:true,starting:true}]){
    const f=fixture(options);if(options.unpaid)f.body.action='cancel';
    assert.equal((await f.exports.POST(f.request())).status,409);assert.equal(f.actions.length,0);
  }
  const f=fixture({combined:true});
  for(const body of [{...f.body,amountCents:1},{...f.body,orderIds:[id]},{...f.body,action:'cancel'}]){
    assert.equal((await f.exports.POST(f.request(body))).status,409);assert.equal(f.actions.length,0);
  }
});

test('notification queue outage does not turn a confirmed refund into a failed payment action',async()=>{
 const f=fixture({emailFailure:true});
 const result=await (await f.exports.POST(f.request())).json();
 assert.equal(result.ok,true);assert.equal(result.status,'refunded');assert.equal(f.actions.length,1);
});

test('new direct-fee combined refund returns the platform fee once, including waived group members',async()=>{
 for(const options of [{directFee:true,combined:true},{directFee:true,combined:true,waivedMember:true}]){
  const f=fixture(options);
  assert.equal((await f.exports.POST(f.request())).status,200);
  assert.ok(f.rows.every(r=>r.status==='refunded'));
  assert.equal(f.actions[0].body.get('refund_application_fee'),'true');
  assert.equal(f.fee.amount_refunded,f.fee.amount);
  assert.equal((await f.exports.POST(f.request())).status,200);
  assert.equal(f.actions.length,1,'repeated full refund moves money only once');
 }
});

test('waived owner/test and legacy refunds never request application-fee refunds',async()=>{
 for(const options of [{},{waivedFee:true}]){
  const f=fixture(options);assert.equal((await f.exports.POST(f.request())).status,200);
  assert.equal(f.actions[0].body.get('refund_application_fee'),null);
 }
});

test('unsafe fee snapshot, mixed legacy group, amount, account or fee-ID mismatches prevent all money actions',async()=>{
  for(const bad of [{mismatchedMetadata:true},{mismatchedSavedFeeId:true},{mismatchedChargeFee:true},{wrongFeeAccount:true},{wrongFeeCharge:true},{wrongFeeAmount:true},{missingCharge:true},{mismatchedGroup:true,combined:true},{mixedLegacy:true,combined:true}]){
  const f=fixture({directFee:true,...bad});assert.equal((await f.exports.POST(f.request())).status,409);
  assert.equal(f.actions.length,0);assert.ok(f.rows.every(r=>r.status==='paid'));
 }
});

test('successful customer refund cannot close the order until the actual platform fee refund is confirmed',async()=>{
 const f=fixture({directFee:true,feePending:true});const result=await(await f.exports.POST(f.request())).json();
 assert.equal(result.status,'refund_pending');assert.equal(f.rows[0].status,'refund_pending');assert.equal(f.notifications.length,0);
 const refresh=await(await f.exports.GET(f.request())).json();assert.equal(refresh.applicationFeeRefundPending,true);assert.equal(refresh.status,'Refund pending');
 assert.equal(f.actions.length,1,'refresh never refunds money');
 f.confirmFeeRefund();assert.equal((await f.exports.GET(f.request())).status,200);assert.equal(f.rows[0].status,'refunded');
 assert.equal((await f.exports.POST(f.request())).status,200);assert.equal(f.actions.length,1);
});

test('explicit POST repairs a manual full customer refund by refunding only the verified remaining platform fee',async()=>{
 const f=fixture({directFee:true,alreadyFullCustomerRefund:true,initialFeeRefunded:10});
 assert.equal((await f.exports.GET(f.request())).status,200);assert.equal(f.rows[0].status,'refund_pending');assert.equal(f.actions.length,0);
 assert.equal((await f.exports.POST(f.request())).status,200);assert.equal(f.rows[0].status,'refunded');
 assert.equal(f.actions.length,1);assert.equal(f.actions[0].path,'application_fees/fee_test/refunds');
 assert.equal(f.actions[0].body.get('amount'),'30');assert.equal(f.actions[0].idempotencyKey,'studio-os-full-application-fee-refund-fee_test');
 assert.equal(f.fee.amount_refunded,40);assert.equal((await f.exports.POST(f.request())).status,200);assert.equal(f.actions.length,1);
});

test('lost remaining-fee refund response retains the hold and read refresh confirms without a second money action',async()=>{
 const f=fixture({directFee:true,alreadyFullCustomerRefund:true,feeRecoveryLostReply:true});
 assert.equal((await f.exports.POST(f.request())).status,409);assert.equal(f.rows[0].status,'refund_pending');
 assert.equal((await f.exports.GET(f.request())).status,200);assert.equal(f.rows[0].status,'refunded');assert.equal(f.actions.length,1);
});

test('full refund after prior partial refund returns100percent of the actual fee, including converted settlement currency',async()=>{
 const f=fixture({directFee:true,partialPrior:1000,settlementCurrency:'usd'});
 assert.equal((await f.exports.POST(f.request())).status,200);assert.equal(f.actions[0].body.get('refund_application_fee'),'true');
 assert.equal(f.fee.amount_refunded,32);assert.equal(f.rows[0].status,'refunded');
});

test('full-customer recovery still verifies confirmation identity before any platform fee refund',async()=>{
 const f=fixture({directFee:true,alreadyFullCustomerRefund:true,combined:true});
 for(const body of [{...f.body,paymentId:'pi_other'},{...f.body,orderIds:[id]}]){
  assert.equal((await f.exports.POST(f.request(body))).status,409);assert.equal(f.actions.length,0);
 }
});

test('declined direct-fee payment stays cancellable without requiring an application fee that was never collected',async()=>{
 const f=fixture({directFee:true,failedPayment:true});
 const snapshot=await(await f.exports.GET(f.request())).json();assert.equal(snapshot.canCancel,true);assert.equal(snapshot.chargedCents,0);
 const result=await(await f.exports.POST(f.request({...f.body,action:'cancel',amountCents:0}))).json();
 assert.equal(result.status,'cancelled');assert.equal(f.actions[0].path,'checkout/sessions/cs_test/expire');assert.equal(f.actions.length,1);
});

test('USD sale preserves the nominal40-cent frozen fee without CAD conversion or FX metadata',async()=>{
 const f=fixture({directFee:true,orderCurrency:'usd'});
 assert.equal((await f.exports.POST(f.request())).status,200);assert.equal(f.fee.amount_refunded,40);assert.equal(f.fee.currency,'usd');
 assert.equal(f.rows[0].platform_fee_amount_cents,40);assert.equal(f.actions[0].body.get('refund_application_fee'),'true');
 assert.equal(f.rows[0].status,'refunded');
});

test('success-shaped fee-refund response remains on hold until Stripe cumulative fee amount confirms completion',async()=>{
 const f=fixture({directFee:true,alreadyFullCustomerRefund:true,feeRecoveryPending:true});
 const result=await(await f.exports.POST(f.request())).json();assert.equal(result.status,'refund_pending');assert.equal(f.rows[0].status,'refund_pending');
 assert.equal(f.fee.amount_refunded,0);assert.equal(f.actions.length,1);
});

test('inconsistent customer charge refund proof blocks fee recovery despite a successful-refund list',async()=>{
 const f=fixture({directFee:true,alreadyFullCustomerRefund:true,chargeRefundMismatch:true});
 const snapshot=await(await f.exports.GET(f.request())).json();assert.equal(snapshot.canCompleteApplicationFeeRefund,false);
 assert.equal((await f.exports.POST(f.request())).status,409);assert.equal(f.actions.length,0);assert.equal(f.rows[0].status,'refund_pending');
});
