import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { pausePlatformCreditEvent } from '../lib/credit-maintenance.ts';
const root=fileURLToPath(new URL('..',import.meta.url));
const compiled=ts.transpileModule(fs.readFileSync(root+'/app/api/stripe/webhook/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
process.env.STRIPE_WEBHOOK_SECRET='test-signing-secret';
async function run(type,{pending=false,queueFailure=false}={}){
 const recorded=new Set();const queued=[];let reconciled=0;let fail=queueFailure;
 const service={from:table=>({delete:()=>({eq:async(_key,id)=>{recorded.delete(id);return {error:null};}})})};
 const deps={'next/server':{NextResponse:{json:(value,options)=>Response.json(value,options)}},'@/lib/dashboard-auth':{createDashboardServiceClient:()=>service},'@/lib/payments':{verifyStripeSignature:async()=>true,recordStripeEvent:async(_s,event)=>{if(recorded.has(event.id))return {inserted:false};recorded.add(event.id);return {inserted:true};},reconcileOrderRefundFromStripe:async(_s,account,payment)=>{assert.equal(account,'acct_test');assert.equal(payment,'pi_test');reconciled++;return pending?null:{orderId:'order',photographerId:'studio',verifiedRefunds:[{id:'re_test',status:'succeeded',amount:10360,currency:'cad',created:1790267400}]};}},'@/lib/order-refund-notifications':{scheduleOrderRefundEmails:async(_s,input)=>{if(fail){fail=false;throw Error('expected queue outage');}queued.push(input);}},'@/lib/audit':{recordAudit:async()=>{}}};
 deps['@/lib/credit-maintenance']={pausePlatformCreditEvent};
 const exports={};new Function('require','exports',compiled)(name=>deps[name]||{},exports);
 const event={id:'evt_test',type,account:'acct_test',data:{object:{id:'ch_test',payment_intent:'pi_test'}}};const req={headers:new Headers({'stripe-signature':'valid'}),text:async()=>JSON.stringify(event)};
 const first=await exports.POST(req);assert.equal(first.status,queueFailure?500:200);
 if(queueFailure){assert.equal(recorded.size,0);assert.equal((await exports.POST(req)).status,200);}
 assert.equal((await exports.POST(req)).status,200);assert.equal(queued.length,pending?0:1);assert.equal(reconciled,queueFailure?2:1);
 if(!pending){assert.equal(queued[0].orderId,'order');assert.equal(queued[0].refunds[0].id,'re_test');}
}
for(const event of ['charge.refunded','refund.updated','refund.failed']) {
 test(`${event} queues confirmed refunds once`,()=>run(event));
 test(`${event} does not notify without a verified successful refund`,()=>run(event,{pending:true}));
 test(`${event} releases the event when queueing fails, allowing a retry`,()=>run(event,{queueFailure:true}));
}
