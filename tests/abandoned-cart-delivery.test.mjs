import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../lib/abandoned-cart-reminders.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(options={}) {
  const order={id:'draft',photographer_id:'studio',project_id:'gallery',school_id:null,student_id:null,
    customer_email:'Buyer@Example.com',parent_email:'stale@example.com',status:'payment_pending',payment_status:'pending',
    paid_at:null,stripe_payment_intent_id:null,stripe_checkout_session_id:'cs_unpaid',created_at:'2026-10-01T12:00:00Z',
    order_group_id:null,total_cents:1000,total_amount:10,package_name:'New package',...options.order};
  const claim={claim_id:'claim',lease_token:'lease',order_id:order.id,stage:1,dedupe_key:'stable-scope-episode-stage',
    recipient_email:'buyer@example.com',photographer_id:'studio',project_id:'gallery',school_id:null,student_id:null,created_at:order.created_at};
  const tables={orders:[order],photographers:[{id:'studio',business_name:'Example studio',studio_email:'reply@example.com',stripe_connected_account_id:'acct_studio',subscription_status:'active',...options.photographer}],
    projects:[{id:'gallery',photographer_id:'studio',title:'Gallery',gallery_settings:{},portal_status:'active',expiration_date:'2100-01-01',...options.gallery}],schools:[]};
  const sends=[],stripeReads=[],rpcCalls=[],finishes=[];let active=true;
  const service={from(table){let predicate=()=>true;const chain={select(){return chain},eq(k,v){const old=predicate;predicate=r=>old(r)&&r[k]===v;return chain},async maybeSingle(){return {data:structuredClone(tables[table].find(predicate)??null),error:null}}};return chain},
    async rpc(name,args){rpcCalls.push({name,args});
      if(name==='claim_abandoned_cart_reminders')return {data:active?[structuredClone(claim)]:[],error:null};
      if(name==='authorize_abandoned_cart_reminder_send'){if(options.authorizationChanged){active=false;return {data:false,error:null}}return {data:true,error:null}}
      assert.equal(name,'complete_abandoned_cart_reminder');finishes.push(args);
      if(options.ledgerFailure&&args.p_status==='sent')return {data:null,error:{message:'fixture ledger outage'}};
      active=false;return {data:true,error:null};}};
  const metadata={photographer_id:'studio',order_id:'draft',billing_flow:'customer_order'};
  const dependencies={
    '@/lib/event-gallery-email':{buildAbandonedCartEmail:input=>({subject:'Finish your saved order',html:`<a href="${input.stopRemindersUrl}">Stop reminders</a>`,text:`${input.orderTotalLabel}\n${input.stopRemindersUrl}`}),buildSchoolAbandonedCartEmail:input=>({subject:'School order',html:input.stopRemindersUrl,text:input.stopRemindersUrl}),eventFromName:p=>p.business_name,eventReplyTo:p=>p.studio_email},
    '@/lib/event-gallery-settings':{normalizeEventGallerySettings:()=>({extras:{enableAbandonedCartEmail:!options.disabled},share:{}})},
    '@/lib/abandoned-cart-reminder-links':{createAbandonedCartStopUrl:()=>options.noSignedUrl?null:'https://example.test/cart-reminders/stop?token=signed'},
    '@/lib/payments':{retrieveCheckoutSession:async(id,account)=>{stripeReads.push({id,account});if(options.stripeOutage)throw Error('isolated Stripe outage');return {id:'cs_unpaid',status:'open',payment_status:'unpaid',customer_details:{email:'buyer@example.com'},metadata,payment_intent:options.intent?'pi_checkout':null,...options.session}},retrievePaymentIntent:async(id,account)=>{stripeReads.push({id,account});return {id:'pi_checkout',status:'requires_payment_method',metadata,...options.intent}}},
    '@/lib/resend':{resendConfigured:()=>!options.noProvider,sendResendEmail:async message=>{sends.push(message);if(options.providerFailure)throw Error('accepted but response lost');return {id:options.noReceipt?null:'provider-receipt'}}},
    '@/lib/subscription-gate':{hasActiveSubscription:photographer=>photographer.subscription_status==='active'},
    '@/lib/calendar-dates':{calendarBoundaryEnd:value=>Number.isFinite(Date.parse(value))?new Date(value):null,hasCalendarBoundaryPassed:value=>Date.parse(value)<Date.now()},
  };
  const exports={};new Function('require','exports',compiled)(name=>{assert.ok(dependencies[name],name);return dependencies[name]},exports);
  return {exports,service,order,sends,stripeReads,rpcCalls,finishes,claim};
}
const deliver=f=>f.exports.deliverAbandonedCartReminders(f.service,{origin:'https://example.test',orderIds:['draft'],photographerId:'studio',limit:100});

test('delivery verifies connected account then final policy and records provider receipt with signed stop URL',async()=>{
  const f=fixture();assert.deepEqual(await deliver(f),{processed:1,sent:1,skipped:0,failed:0});
  assert.deepEqual(f.stripeReads,[{id:'cs_unpaid',account:'acct_studio'}]);
  assert.equal(f.sends[0].to,'buyer@example.com');assert.equal(f.sends[0].replyTo,'reply@example.com');assert.match(f.sends[0].text,/token=signed/);
  assert.equal(f.sends[0].idempotencyKey,f.claim.dedupe_key);assert.equal(f.finishes[0].p_resend_email_id,'provider-receipt');
  assert.equal((await deliver(f)).processed,0);assert.equal(f.sends.length,1);
});
test('paid or processing checkout is suppressed even while database still says pending',async()=>{
  for(const options of [{session:{payment_status:'paid',status:'complete'}},{session:{payment_status:'no_payment_required',status:'complete'}},{session:{status:'complete'}},{intent:{status:'processing'}},{intent:{status:'succeeded'}},{intent:{status:'requires_action'}}]){
    const f=fixture(options);assert.equal((await deliver(f)).skipped,1);assert.equal(f.sends.length,0);assert.equal(f.finishes[0].p_status,'skipped');
  }
});
test('read-only unpaid failed intent remains recoverable after metadata verification',async()=>{
  const f=fixture({intent:{status:'requires_payment_method'}});assert.equal((await deliver(f)).sent,1);
  assert.deepEqual(f.stripeReads,[{id:'cs_unpaid',account:'acct_studio'},{id:'pi_checkout',account:'acct_studio'}]);
});
test('wrong provider owner, order, actual email and missing account fail closed',async()=>{
  for(const session of [{metadata:{photographer_id:'other',order_id:'draft',billing_flow:'customer_order'}},{metadata:{photographer_id:'studio',order_id:'other',billing_flow:'customer_order'}},{customer_details:{email:'stale@example.com'}},{customer_details:null},{id:'cs_other'}]){
    const f=fixture({session});assert.equal((await deliver(f)).skipped,1);assert.equal(f.sends.length,0);
  }
});
test('own paid and refund markers are rejected before provider lookup',async()=>{
  for(const order of [{paid_at:'2026-10-02T12:00:00Z'},{payment_status:'succeeded'},{refund_status:'pending'},{refund_amount_cents:1},{status:'cancel_pending'},{is_test:true}]){
    const f=fixture({order});assert.equal((await deliver(f)).skipped,1);assert.equal(f.sends.length,0);assert.equal(f.stripeReads.length,0);
  }
});
test('new purchase, replacement or stop during slow preparation prevents send at final authorization',async()=>{
  const f=fixture({authorizationChanged:true});assert.equal((await deliver(f)).skipped,1);assert.equal(f.sends.length,0);
  assert.ok(f.rpcCalls.some(c=>c.name==='authorize_abandoned_cart_reminder_send'));
});
test('provider configuration, disabled gallery and absent signed stop link cannot send',async()=>{
  for(const options of [{noProvider:true},{disabled:true},{noSignedUrl:true}]){const f=fixture(options);await deliver(f);assert.equal(f.sends.length,0)}
});
test('closed, unreleased, expired and invalid-expiration galleries never receive reminders',async()=>{
  for(const gallery of [{portal_status:'closed'},{portal_status:'inactive'},{portal_status:'pre-release'},{status:'archived'},{expiration_date:'2000-01-01'},{expiration_date:'invalid'}]){
    const f=fixture({gallery});assert.equal((await deliver(f)).skipped,1);assert.equal(f.sends.length,0);assert.equal(f.stripeReads.length,0);
    assert.equal(f.finishes[0].p_status,'skipped');
  }
});
test('inactive photographer subscription blocks reminders before gallery or provider lookup',async()=>{
  const f=fixture({photographer:{subscription_status:'cancelled'}});assert.equal((await deliver(f)).skipped,1);
  assert.equal(f.sends.length,0);assert.equal(f.stripeReads.length,0);assert.equal(f.finishes[0].p_status,'skipped');
});
test('worker budget releases unattempted claims instead of starting sends past its deadline',async()=>{
  const f=fixture();const started=Date.now();
  assert.deepEqual(await f.exports.deliverAbandonedCartReminders(f.service,{origin:'https://example.test',maxDurationMs:1_000}),{processed:1,sent:0,skipped:1,failed:0});
  assert.equal(f.sends.length,0);assert.equal(f.stripeReads.length,0);assert.equal(f.finishes[0].p_status,'skipped');
  assert.equal(f.rpcCalls.some(c=>c.name==='authorize_abandoned_cart_reminder_send'),false);assert.ok(Date.now()-started<1_000);
});
test('Stripe verification outage never reaches email provider and releases an unused claim',async()=>{
  const f=fixture({stripeOutage:true});assert.equal((await deliver(f)).failed,1);assert.equal(f.sends.length,0);assert.equal(f.finishes[0].p_status,'skipped');
});
test('ambiguous provider response or lost receipt holds stage for reconciliation instead of blind resend',async()=>{
  for(const options of [{providerFailure:true},{noReceipt:true},{ledgerFailure:true}]){
    const f=fixture(options);assert.equal((await deliver(f)).failed,1);assert.equal(f.finishes.at(-1).p_status,'uncertain');
    assert.equal((await deliver(f)).processed,0);assert.equal(f.sends.length,1);
  }
});
test('empty manual selection and unsupported force flag cannot broaden or bypass claim policy',async()=>{
  const empty=fixture();assert.equal((await empty.exports.deliverAbandonedCartReminders(empty.service,{origin:'https://example.test',orderIds:[]})).processed,0);assert.equal(empty.rpcCalls.length,0);
  const f=fixture();await f.exports.deliverAbandonedCartReminders(f.service,{origin:'https://example.test',orderIds:['draft'],photographerId:'studio',force:true});
  assert.deepEqual(f.rpcCalls[0].args,{p_order_ids:['draft'],p_photographer_id:'studio',p_limit:100});
});
test('automatic cron rejects missing and invalid secret before creating a service or claims',async()=>{
  const code=ts.transpileModule(readFileSync(new URL('../app/api/cron/abandoned-cart-reminders/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  let calls=0;const modules={'next/server':{NextResponse:{json:(data,options)=>Response.json(data,options)}},'@/lib/dashboard-auth':{createDashboardServiceClient:()=>({})},'@/lib/abandoned-cart-reminders':{deliverAbandonedCartReminders:async()=>{calls++;return {processed:1,sent:1,skipped:0,failed:0}}}};
  const route={};new Function('require','exports',code)(name=>modules[name],route);
  const previous=process.env.CRON_SECRET;try{delete process.env.CRON_SECRET;assert.equal((await route.GET({headers:new Headers()})).status,401);process.env.CRON_SECRET='expected';assert.equal((await route.GET({headers:new Headers({authorization:'Bearer wrong'})})).status,401);assert.equal(calls,0);assert.equal((await route.GET({url:'https://example.test/api/cron/abandoned-cart-reminders',headers:new Headers({authorization:'Bearer expected'})})).status,200);assert.equal(calls,1)}finally{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous}
});
