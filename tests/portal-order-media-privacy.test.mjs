import assert from 'node:assert/strict';
import test from 'node:test';
import {harness,projectId,albumA,lockedAlbum,a,id} from './helpers/event-gallery-harness.mjs';
const history='app/api/portal/orders/history/route.ts';
const stubs={'@/lib/digital-delivery':{createDigitalDeliveryDownloadUrl:(order,email)=>`/api/portal/digital-download?order=${order}&email=${email}`}};
const order=(change={})=>({id:id(450),project_id:projectId,photographer_id:null,parent_email:'viewer@example.test',parent_name:'Parent',customer_email:null,status:'payment_pending',payment_status:'pending',paid_at:null,package_name:'All Digitals',total_cents:1000,order_items:[{product_name:'Digital',quantity:1,line_total_cents:1000,unit_price_cents:1000,sku:'https://fixture.test/fixture/a.jpg?old-signature'}],cart_snapshot:[{packageName:'All Digitals',quantity:1,selectedImageUrl:'https://fixture.test/fixture/a.jpg?old-signature',slots:[{assignedImageUrl:'https://fixture.test/fixture/a.jpg?old-signature'}],purchasedEventScope:{version:1,projectId,collectionIds:[albumA]}}],...change});
function setup(){const h=harness({overrides:stubs});h.tables.event_gallery_visitors=[{project_id:projectId,viewer_email:'viewer@example.test'}];return h;}
const body={projectId,email:'viewer@example.test',pin:'project-pin'};

test('order history carries canonical photo identities and never presigns originals before payment',async()=>{
 const h=setup();h.tables.orders.push(order());const result=await h.post(history,body);assert.equal(result.status,200);assert.equal(result.body.orders.length,1);const row=result.body.orders[0];assert.equal(row.items[0].sku,'fixture/a.jpg');assert.equal(row.cartSnapshot[0].selectedImageUrl,'fixture/a.jpg');assert.equal(row.cartSnapshot[0].slots[0].assignedImageUrl,'fixture/a.jpg');assert.equal(row.digitalDownload.available,false);assert.equal(JSON.stringify(result.body).includes('https://fixture.test/'),false);assert.equal(h.fetched.length,0);assert.equal(h.writes.length,0);
});

test('history respects album-only PIN, project invitations/current owner and exact purchase email',async()=>{
 const h=setup();h.tables.orders.push(order(),order({id:id(451),cart_snapshot:[{packageName:'All Digitals',purchasedEventScope:{version:1,projectId,collectionIds:[lockedAlbum]}}]}),order({id:id(452),parent_email:'other@example.test'}),order({id:id(453),photographer_id:id(90)}));
 const album=await h.post(history,{...body,pin:'album-a'});assert.equal(album.status,200);assert.equal(album.body.orders.length,1);assert.equal(album.body.orders[0].id,id(450));
 h.tables.projects[0].email_required=true;h.tables.pre_release_emails.push({id:id(470),project_id:projectId,email:'other@example.test'});assert.equal((await h.post(history,body)).status,403);assert.equal(h.fetched.length,0);
});

test('refunded digital orders never receive a fresh paid delivery link even with historical paid_at',async()=>{
 for(const change of [{payment_status:'refunded'},{payment_status:'partially_refunded'},{status:'cancelled'},{status:'refund_pending'}]) {
 const h=setup();h.tables.orders.push(order({status:'digital_paid',payment_status:'paid',paid_at:'2026-10-01',...change}));const result=await h.post(history,body);assert.equal(result.status,200);assert.equal(result.body.orders[0].digitalDownload.available,false);assert.equal(result.body.orders[0].digitalDownload.url,null);
 }
 const h=setup();h.tables.orders.push(order({status:'digital_paid',payment_status:'paid',paid_at:'2026-10-01'}));const result=await h.post(history,body);assert.equal(result.body.orders[0].digitalDownload.available,true);assert.match(result.body.orders[0].digitalDownload.url,/digital-download/);assert.equal(JSON.stringify(result.body).includes('https://fixture.test/'),false);
});
