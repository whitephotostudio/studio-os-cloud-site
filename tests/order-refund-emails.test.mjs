import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import {buildOrderRefundEmail} from '../lib/order-refund-email.ts';

const source=readFileSync(new URL('../lib/order-refund-notifications.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const id='11111111-1111-4111-8111-111111111111';
const studio='22222222-2222-4222-8222-222222222222';
const refund={id:'re_test',status:'succeeded',amount:10360,currency:'cad',created:1790267400};
function fixture(options={}) {
 const tables={orders:[{id,photographer_id:studio,stripe_payment_intent_id:'pi_test',order_group_id:options.combined?'group':null,customer_name:'Customer',customer_email:'client@example.com',parent_email:'old@example.com',currency:'cad',total_cents:10360}],photographers:[{id:studio,user_id:'owner',business_name:'Studio',billing_email:'photographer@example.com',studio_email:'reply@example.com',stripe_connected_account_id:'acct_test'}],order_refund_emails:[]};
 if(options.combined)tables.orders.push({...tables.orders[0],id:'33333333-3333-4333-8333-333333333333'});
 const callbacks=[];const sends=[];const accepted=new Map();let lostReply=options.lostReply;let ledgerFailure=options.ledgerFailure;
 const service={auth:{admin:{getUserById:async()=>({data:{user:{email:'account@example.com'}}})}},from(table){let predicate=()=>true;let mutation;const chain={select(){return chain},eq(k,v){const p=predicate;predicate=r=>p(r)&&r[k]===v;return chain},in(k,v){const p=predicate;predicate=r=>p(r)&&v.includes(r[k]);return chain},order(){return chain},upsert(rows){mutation={rows};return chain},update(values){mutation={values};return chain},single(){return run(true)},then(a,b){return run(false).then(a,b)}};
 async function run(single){if(mutation?.rows){for(const row of mutation.rows)if(!tables[table].some(r=>r.dedupe_key===row.dedupe_key))tables[table].push({...structuredClone(row),id:crypto.randomUUID(),status:'pending',attempts:0});}const rows=tables[table].filter(predicate);if(mutation?.values){if(mutation.values.status==='sent'&&ledgerFailure){ledgerFailure=false;return {error:{message:'database unavailable'}};}rows.forEach(r=>Object.assign(r,mutation.values));}return {data:structuredClone(single?rows[0]:rows),error:null};}return chain;},async rpc(name,{p_ids}){assert.equal(name,'claim_order_refund_emails');const rows=tables.order_refund_emails.filter(r=>r.status==='pending'&&(!p_ids||p_ids.includes(r.id)));rows.forEach(r=>Object.assign(r,{status:'sending',lease_token:crypto.randomUUID(),attempts:r.attempts+1}));return {data:structuredClone(rows),error:null};}};
 const dependencies={'node:crypto':{createHash},'node:timers/promises':{setTimeout:async()=>{}},'next/server':{after:fn=>callbacks.push(fn)},'@/lib/order-refund-email':{buildOrderRefundEmail},'@/lib/resend':{resendConfigured:()=>!options.noProvider,resolveReplyTo:v=>v&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())?v.trim():null,sendResendEmail:async payload=>{sends.push(payload);if(!accepted.has(payload.idempotencyKey))accepted.set(payload.idempotencyKey,{id:crypto.randomUUID()});if(lostReply){lostReply=false;throw Error('accepted, response lost');}return accepted.get(payload.idempotencyKey);}}};
 const exports={};new Function('require','exports',compiled)(key=>{assert.ok(dependencies[key],key);return dependencies[key];},exports);
 const input={account:'acct_test',paymentIntentId:'pi_test',orderId:id,refunds:[refund]};
 return {exports,service,tables,input,callbacks,sends,accepted};
}
test('success queues isolated client and photographer messages, with correct amount and reply address',async()=>{
 const f=fixture();await f.exports.scheduleOrderRefundEmails(f.service,f.input);assert.equal(f.sends.length,0);assert.equal(f.callbacks.length,1);
 await f.callbacks[0]();assert.equal(f.sends.length,2);assert.deepEqual(f.sends.map(m=>m.to),['client@example.com','photographer@example.com']);
 for(const m of f.sends){assert.match(m.text,/CAD\s*103\.60/);assert.match(m.text,/re_test/);assert.equal(m.replyTo,'reply@example.com');assert.doesNotMatch(m.text,/old@example.com/);}
 assert.ok(f.tables.order_refund_emails.every(r=>r.status==='sent'&&r.resend_email_id));
});
test('replayed webhook, concurrent queueing, and changed contact information preserve one frozen message per audience',async()=>{
 const f=fixture();await Promise.all(Array.from({length:12},()=>f.exports.queueOrderRefundEmails(f.service,f.input)));
 f.tables.orders[0].customer_email='changed@example.com';f.tables.photographers[0].business_name='Changed';
 await f.exports.queueOrderRefundEmails(f.service,f.input);assert.equal(f.tables.order_refund_emails.length,2);
 await Promise.all([f.exports.deliverOrderRefundEmails(f.service),f.exports.deliverOrderRefundEmails(f.service)]);
 await f.exports.deliverOrderRefundEmails(f.service);assert.equal(f.accepted.size,2);assert.equal(f.sends.length,2);assert.equal(f.sends[0].to,'client@example.com');assert.equal(f.sends[0].fromName,'Studio');
});
for(const failure of ['lostReply','ledgerFailure'])test(`${failure} retries the same email key and does not duplicate the other recipient`,async()=>{
 const f=fixture({[failure]:true});await f.exports.queueOrderRefundEmails(f.service,f.input);
 assert.deepEqual(await f.exports.deliverOrderRefundEmails(f.service),{sent:1,failed:1});
 assert.deepEqual(await f.exports.deliverOrderRefundEmails(f.service),{sent:1,failed:0});assert.equal(f.accepted.size,2);assert.equal(f.sends.length,3);assert.deepEqual(f.sends[0],f.sends[2]);
});
test('pending, failed, canceled and zero refunds do not queue success notifications',async()=>{
 const f=fixture();for(const status of ['pending','failed','canceled','requires_action'])assert.deepEqual(await f.exports.queueOrderRefundEmails(f.service,{...f.input,refunds:[{...refund,status}]}),[]);
 assert.deepEqual(await f.exports.queueOrderRefundEmails(f.service,{...f.input,refunds:[{...refund,amount:0}]}),[]);assert.equal(f.tables.order_refund_emails.length,0);
});
test('combined payment produces two emails, lists both orders and reports each partial refund only once',async()=>{
 const f=fixture({combined:true});f.input.refunds=[{...refund,amount:1000},{...refund,id:'re_second',amount:2000}];
 await f.exports.queueOrderRefundEmails(f.service,f.input);assert.equal(f.tables.order_refund_emails.length,4);
 assert.ok(f.tables.order_refund_emails.every(r=>r.order_ids.length===2));const messages=f.tables.order_refund_emails.map(r=>r.payload.text);assert.match(messages[0],/CAD\s*10\.00/);assert.match(messages[2],/CAD\s*20\.00/);assert.doesNotMatch(messages.join(''),/order is closed|fully refunded/);
});
test('invalid currency, payment, account, cross-studio groups and mixed buyers fail closed',async()=>{
 for(const change of [f=>f.input.account='acct_wrong',f=>f.input.paymentIntentId='pi_wrong',f=>f.input.refunds=[{...refund,currency:'usd'}],f=>f.tables.orders[1].photographer_id='other',f=>f.tables.orders[1].customer_email='another@example.com',f=>f.tables.orders[0].customer_email=f.tables.orders[0].parent_email=null]){const f=fixture({combined:true});change(f);await assert.rejects(()=>f.exports.queueOrderRefundEmails(f.service,f.input));assert.equal(f.tables.order_refund_emails.length,0);}
});
test('missing studio contact falls back to authenticated account email, never customer email',async()=>{
 const f=fixture();f.tables.photographers[0].billing_email=null;f.tables.photographers[0].studio_email=null;await f.exports.queueOrderRefundEmails(f.service,f.input);assert.equal(f.tables.order_refund_emails[1].payload.to,'account@example.com');
});
test('provider outage leaves messages pending for cron retry',async()=>{
 const f=fixture({noProvider:true});await f.exports.queueOrderRefundEmails(f.service,f.input);await assert.rejects(()=>f.exports.deliverOrderRefundEmails(f.service));assert.ok(f.tables.order_refund_emails.every(r=>r.status==='pending'));
});
test('email escapes customer and studio content and does not claim bank settlement',()=>{
 const email=buildOrderRefundEmail({audience:'photographer',studioName:'Studio <script>',customerName:'<img onerror=bad>',orderIds:[id],amountCents:10360,currency:'cad',refundId:'re_test',issuedAt:'2026-09-24T12:00:00Z'});assert.doesNotMatch(email.html,/<script>|<img onerror/);assert.match(email.html,/&lt;img/);assert.match(email.text,/depends on the payment provider and bank/);assert.match(email.text,/Other orders are unchanged/);
});
test('database ledger leases deliveries, preserves sent records, and stops unsafe retries beyond provider dedupe window',async()=>{
 const db=new PGlite();try{await db.exec('create role anon;create role authenticated;create role service_role;');await db.exec(readFileSync(new URL('../supabase/migrations/20260924180000_order_refund_emails.sql',import.meta.url),'utf8'));
 const insert=await db.query("insert into order_refund_emails(dedupe_key,photographer_id,order_ids,stripe_account_id,stripe_refund_id,audience,payload) values('key',$1,array[$2::uuid],'acct_test','re_test','client','{}') returning id",[studio,id]);const noticeId=insert.rows[0].id;
 const claims=await Promise.all([db.query('select * from claim_order_refund_emails()'),db.query('select * from claim_order_refund_emails()')]);assert.equal(claims.reduce((n,r)=>n+r.rows.length,0),1);
 await db.query("update order_refund_emails set lease_until=now()-interval '1 second' where id=$1",[noticeId]);assert.equal((await db.query('select * from claim_order_refund_emails()')).rows.length,1);
 await db.query("update order_refund_emails set lease_until=now()-interval '1 second',first_attempt_at=now()-interval '24 hours' where id=$1",[noticeId]);assert.equal((await db.query('select * from claim_order_refund_emails()')).rows.length,0);assert.equal((await db.query('select status from order_refund_emails')).rows[0].status,'needs_review');
 await db.query("update order_refund_emails set status='sent' where id=$1",[noticeId]);assert.equal((await db.query('select * from claim_order_refund_emails()')).rows.length,0);
 for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(()=>db.query('select * from order_refund_emails'));await assert.rejects(()=>db.query('select * from claim_order_refund_emails()'));await db.exec('reset role');}
 }finally{await db.close();}
});
test('refund email cron fails closed without its configured secret',async()=>{
 const text=readFileSync(new URL('../app/api/cron/order-refund-emails/route.ts',import.meta.url),'utf8');
 const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let deliveries=0;const dependencies={'next/server':{NextResponse:{json:(data,options)=>Response.json(data,options)}},'@/lib/dashboard-auth':{createDashboardServiceClient:()=>({})},'@/lib/order-refund-notifications':{deliverOrderRefundEmails:async()=>{deliveries++;return {sent:2,failed:0};}}};
 const exports={};new Function('require','exports',js)(name=>dependencies[name],exports);
 const previous=process.env.CRON_SECRET;try{delete process.env.CRON_SECRET;assert.equal((await exports.GET({headers:new Headers()})).status,401);process.env.CRON_SECRET='expected';assert.equal((await exports.GET({headers:new Headers({authorization:'Bearer wrong'})})).status,401);assert.equal(deliveries,0);const response=await exports.GET({headers:new Headers({authorization:'Bearer expected'})});assert.equal(response.status,200);assert.equal(deliveries,1);}finally{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;}
});
