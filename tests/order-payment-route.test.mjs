import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as policy from '../lib/order-payment-policy.ts';
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/api/dashboard/orders/payment/route.ts',import.meta.url),'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const id='11111111-1111-4111-8111-111111111111';
const studio='22222222-2222-4222-8222-222222222222';
function fixture(options={}) {
  const row={id,photographer_id:studio,order_group_id:null,total_cents:10360,currency:'cad',status:'paid',payment_status:'succeeded',paid_at:'2026-09-23',stripe_payment_intent_id:'pi_test',stripe_checkout_session_id:'cs_test'};
  if(options.unpaid) Object.assign(row,{status:'payment_pending',payment_status:'pending',paid_at:null,stripe_payment_intent_id:null});
  if(options.starting) Object.assign(row,{status:'checkout_starting',stripe_checkout_session_id:null});
  const rows=[row];
  if(options.combined){row.order_group_id='33333333-3333-4333-8333-333333333333';rows.push({...row,id:'44444444-4444-4444-8444-444444444444'});}
  const tables={orders:rows,photographers:[{id:studio,user_id:options.otherOwner?'other':'owner',stripe_connected_account_id:'acct_test',stripe_account_id:null}]};
  const service={from(table){let predicate=()=>true;let update;const chain={select(){return chain},eq(k,v){const prev=predicate;predicate=r=>prev(r)&&r[k]===v;return chain},in(k,v){const prev=predicate;predicate=r=>prev(r)&&v.includes(r[k]);return chain},is(k,v){return chain.eq(k,v)},order(){return chain},update(v){update=v;return chain},single(){return run(true)},maybeSingle(){return run(true)},then(a,b){return run(false).then(a,b)}};
  async function run(single){const matching=tables[table].filter(predicate);if(update)matching.forEach(r=>Object.assign(r,update));return {data:single?matching.length===1?structuredClone(matching[0]):null:structuredClone(matching),error:single&&matching.length!==1?{message:'not found'}:null};}return chain;}};
  const notifications=[];
  const actions=[];let refunds=[];let locked=false;let sessionStatus=options.unpaid?'open':'complete';let lost=options.lostReply;
  const intent={id:'pi_test',status:'succeeded',amount:10360*rows.length,amount_received:10360*rows.length,currency:'cad',latest_charge:'ch_test',metadata:{photographer_id:studio,order_id:id}};
  async function stripeRequest(path,params={}) {
    if(params.account!=='acct_test')throw Error('wrong account');
    if(params.method==='POST'){
      actions.push({path,...params});
      if(path==='refunds'){
        assert.ok(rows.every(r=>r.status==='refund_pending'),'hold must exist before refund');
        refunds=[{id:'re_test',status:options.pending?'pending':'succeeded',amount:intent.amount}];
        if(lost){lost=false;throw Error('connection lost after Stripe accepted');}
        return refunds[0];
      }
      if(path.endsWith('/expire')){if(options.paymentWins)throw Error('session completed while expiring');sessionStatus='expired';return {status:sessionStatus};}
    }
    if(path==='refunds')return {data:refunds,has_more:false};
    if(path.startsWith('checkout/sessions/'))return {id:'cs_test',status:sessionStatus,payment_status:options.unpaid?'unpaid':'paid',payment_intent:options.unpaid?null:'pi_test'};
    if(path.startsWith('payment_intents/'))return intent;
    if(path.startsWith('charges/'))return {amount:intent.amount,amount_refunded:refunds.reduce((n,r)=>n+r.amount,0)};
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
  const exports={};new Function('require','exports',compiled)(name=>{if(!dependencies[name])throw Error(name);return dependencies[name];},exports);
  const body={orderId:id,action:'refund',reason:'Duplicate payment',paymentId:options.unpaid?null:'pi_test',amountCents:options.unpaid?0:intent.amount,orderIds:rows.map(r=>r.id)};
  const request=(data=body)=>({nextUrl:new URL(`https://example.test/api/dashboard/orders/payment?orderId=${id}`),headers:new Headers(),json:async()=>data});
  return {exports,rows,actions,body,request,notifications};
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
