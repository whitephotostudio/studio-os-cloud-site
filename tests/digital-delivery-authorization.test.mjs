import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,projectId,albumA,id} from './helpers/event-gallery-harness.mjs';
const recipient='buyer@example.test',other='alternate@example.test';
function fixture(){
 const h=harness({overrides:{'@/lib/resend':{},'@/lib/backdrop-composites':{hasBackdropCompositeSelection:()=>false}}});
 const row={id:id(900),project_id:projectId,photographer_id:null,package_name:'All Digital Package',status:'digital_paid',payment_status:'paid',paid_at:'2026-10-01',customer_email:recipient,cart_snapshot:[{packageName:'All Digital Package',purchasedEventScope:{version:1,projectId,collectionIds:[albumA]},slots:[]}]};h.tables.orders.push(row);h.tables.order_items=[];
 const helper=h.load('lib/digital-delivery.ts');
 const url=token=>new URL(`https://fixture.test/api/portal/digital-delivery?token=${encodeURIComponent(token)}&format=json`);
 const token=(email=recipient,extra={})=>helper.createDigitalDeliveryToken({v:1,kind:'digital-order-delivery',orderId:row.id,recipientEmail:email,exp:Date.now()+60000,...extra});
 return {...h,row,helper,token,async delivery(value){const response=await h.load('app/api/portal/digital-delivery/route.ts').GET({nextUrl:url(value)});return{status:response.status,body:await response.json()};}};
}

test('historical paid_at cannot reopen cancelled, refunded or partially refunded digital delivery',async()=>{
 for(const change of [{status:'refunded'},{status:'cancelled'},{payment_status:'refunded'},{payment_status:'partially_refunded'},{status:'reviewed',payment_status:'pending',paid_at:null},{status:'sent_to_print',payment_status:'pending',paid_at:null},{payment_status:'pending'},{payment_status:'failed'},{payment_status:'processing'},{refund_status:'pending'},{refund_amount_cents:100}]){const h=fixture();Object.assign(h.row,change);assert.notEqual((await h.delivery(h.token())).status,200);assert.equal(h.fetched.length,0);}
});

test('legacy paid delivery tokens require the current exact order recipient, not the resolver override',async()=>{
 const h=fixture();assert.equal((await h.delivery(h.token())).status,200);assert.notEqual((await h.delivery(h.token(other))).status,200);const previous=h.token();h.row.customer_email='changed@example.test';assert.notEqual((await h.delivery(previous)).status,200);assert.equal(h.fetched.length,0);
});

test('a signed owner-authorized alternate recipient remains usable only while its bound order identity is current',async()=>{
 for(const change of ['owner','project','customer','choice','student']){
 const h=fixture();assert.equal(typeof h.helper.createDigitalDeliveryOrderAccessGrant,'function');const token=h.token(other,{orderAccessGrant:h.helper.createDigitalDeliveryOrderAccessGrant(h.row)});assert.equal((await h.delivery(token)).status,200);
 if(change==='owner')h.row.photographer_id=id(910);if(change==='project')h.row.project_id=id(911);if(change==='customer')h.row.customer_email='changed@example.test';if(change==='choice')h.row.cart_snapshot[0].purchasedEventScope.collectionIds=[id(912)];if(change==='student')h.row.student_id=id(913);
 assert.notEqual((await h.delivery(token)).status,200,change);assert.equal(h.fetched.length,0);assert.equal(h.writes.length,0);
 }
});
