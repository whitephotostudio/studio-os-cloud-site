import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { harness, projectId, albumA, albumB, a, b, locked, foreign, id, legacyRoute, readyRoute } from './helpers/event-gallery-harness.mjs';

const original = await sharp({create:{width:4800,height:3200,channels:3,background:{r:54,g:100,b:152}}}).jpeg({quality:95}).toBuffer();
const imageFetch = async () => new Response(original, {headers:{'content-type':'image/jpeg','content-length':String(original.length)}});
const purchase = () => ({id:id(900),project_id:projectId,package_name:'All Digitals',status:'digital_paid',payment_status:'succeeded',parent_email:'viewer@example.test',cart_snapshot:[{packageName:'All Digitals',purchasedEventScope:{version:1,projectId,collectionIds:[albumA]}}]});

test('missing derivatives are resized internally; preview bytes never redirect or expose the original',async()=>{
  const h=harness({extras:{freeDigitalRuleEnabled:false},signedUrls:({storagePath})=>({originalUrl:`https://fixture.test/${storagePath}`,previewUrl:`https://fixture.test/${storagePath}?variant=preview`,thumbnailUrl:`https://fixture.test/${storagePath}?variant=thumb`}),fetchImage:async url=>url.includes('?variant=')?new Response('missing',{status:404}):imageFetch()});
  const context=await h.post('app/api/portal/event-gallery-context/route.ts',h.body());
  assert.equal(context.status,200);
  const url=context.body.media[0].preview_url;
  const result=await h.get(url);
  assert.equal(result.status,200);assert.equal(result.headers.get('location'),null);
  const metadata=await sharp(result.body).metadata();
  assert.equal(metadata.width,1200);assert.equal(metadata.height,800);
  assert.notDeepEqual(result.body,original);
  assert.deepEqual(h.fetched,['https://fixture.test/fixture/a.jpg?variant=preview','https://fixture.test/fixture/a.jpg']);
  assert.equal(h.writes.filter(row=>row.table==='media').length,0);
});

test('preview authorization rejects foreign, private, moved and revoked gallery media before storage reads',async()=>{
  for(const change of ['foreign','private','moved','pin','slug','invitation','owner']) {
    const h=harness({fetchImage:imageFetch});
    if(change==='invitation') {h.tables.projects[0].email_required=true;h.tables.pre_release_emails.push({id:id(901),project_id:projectId,email:'viewer@example.test'},{id:id(902),project_id:projectId,email:'other@example.test'});}
    const context=await h.post('app/api/portal/event-gallery-context/route.ts',h.body());
    let url=context.body.media[0].preview_url;
    if(change==='foreign'||change==='private') url=url.replace(`${a}.jpg`,`${change==='foreign'?foreign:locked}.jpg`);
    if(change==='moved') h.tables.media[0].collection_id=albumB;
    if(change==='pin') h.tables.projects[0].access_pin='new-pin';
    if(change==='slug') h.tables.collections[0].slug='changed-album-a';
    if(change==='invitation') h.tables.pre_release_emails.shift();
    if(change==='owner') h.tables.projects[0].photographer_id=id(990);
    assert.equal((await h.get(url)).status,403,change);assert.equal(h.fetched.length,0,change);
  }
});

test('corrupt, oversized and unavailable originals fail visibly instead of leaking original bytes as previews',async()=>{
  for(const fetchImage of [async()=>new Response('not an image'),async()=>new Response(original,{headers:{'content-length':String(33*1024*1024)}}),async()=>new Response('missing',{status:404})]) {
    const h=harness({fetchImage}); const context=await h.post('app/api/portal/event-gallery-context/route.ts',h.body());
    const result=await h.get(context.body.media[0].preview_url);
    assert.equal(result.status,503);assert.match(result.body.message,/Preview unavailable/);assert.equal(result.headers.get('location'),null);
  }
});

test('preview token cannot be reused as a delivery token and its separate limiter blocks before DB/storage',async()=>{
  const h=harness({fetchImage:imageFetch});const context=await h.post('app/api/portal/event-gallery-context/route.ts',h.body());
  const token=new URL(context.body.media[0].preview_url,'https://fixture.test').searchParams.get('token');
  assert.equal((await h.get(`/api/portal/event-download-file?token=${token}`)).status,403);assert.equal(h.fetched.length,0);
  const limited=harness({rateAllowed:false});
  assert.equal((await limited.get(`/api/portal/event-preview/${a}.jpg?token=${token}`)).status,429);assert.equal(limited.queries.length,0);
});

test('authorized original delivery is byte-exact; web delivery is bounded and watermarking happens on the server',async()=>{
  const plain=harness({fetchImage:imageFetch});const ready=await plain.post(legacyRoute,plain.body({mediaIds:[a]}));
  const result=await plain.get(ready.body.deliveries[0].url);
  assert.equal(result.status,200);assert.deepEqual(result.body,original);assert.equal(result.headers.get('location'),null);
  const web=harness({extras:{freeDigitalResolution:'web',watermarkDownloads:true},fetchImage:imageFetch});const webReady=await web.post(legacyRoute,web.body({mediaIds:[a]}));
  const delivered=await web.get(webReady.body.deliveries[0].url+'&watermark=false&resolution=original');
  assert.equal(delivered.status,200);assert.equal((await sharp(delivered.body).metadata()).width,1600);
  assert.equal(webReady.body.deliveries[0].watermarked,true);
  const helper=web.load('lib/event-media-delivery.ts');const unmarked=await helper.transformEventImage(original,{resolution:'web',watermark:false});
  assert.notDeepEqual(delivered.body,unmarked.buffer);
});

test('missing originals cannot silently deliver a thumbnail as an Original download',async()=>{
  const h=harness({fetchImage:async()=>new Response('missing',{status:404})});const ready=await h.post(legacyRoute,h.body({mediaIds:[a]}));
  const result=await h.get(ready.body.deliveries[0].url);assert.equal(result.status,503);assert.equal(h.fetched.length,1);
});

test('download PIN, current configuration, album grants, invitation, and paid refund changes revoke single-photo links',async()=>{
  for(const change of ['pin','policy','album','invitation','refund','purchase-scope']) {
    const paid=change==='refund'||change==='purchase-scope';
    const h=harness({extras:{favoriteDownloadsRequireAllDigitalsPurchase:paid,downloadPinEnabled:true,downloadPin:'download-pin'},fetchImage:imageFetch});
    h.tables.orders.push(purchase());
    if(change==='invitation') {h.tables.projects[0].email_required=true;h.tables.pre_release_emails.push({id:id(901),project_id:projectId,email:'viewer@example.test'},{id:id(902),project_id:projectId,email:'other@example.test'});}
    const ready=await h.post(legacyRoute,h.body({mediaIds:[a],downloadPin:'download-pin',downloadType:paid?'favorites':'gallery'}));assert.equal(ready.status,200,change);
    if(change==='pin')h.tables.projects[0].gallery_settings.extras.downloadPin='changed';
    if(change==='policy')h.tables.projects[0].gallery_settings.extras.freeDigitalRuleEnabled=false;
    if(change==='album')h.tables.collections[0].access_mode='private';
    if(change==='invitation')h.tables.pre_release_emails.shift();
    if(change==='refund')h.tables.orders[0].payment_status='refunded';
    if(change==='purchase-scope')h.tables.orders[0].cart_snapshot[0].purchasedEventScope.collectionIds=[albumB];
    assert.equal((await h.get(ready.body.deliveries[0].url)).status,403,change);assert.equal(h.fetched.length,0,change);
  }
});

test('paid favorite gate rejects other customers/studios, refunded/unpaid/limited/unscoped packages and honors valid digital_paid',async()=>{
  for(const change of [{parent_email:'other@example.test'},{status:'payment_pending',payment_status:'pending'},{status:'refunded'},{payment_status:'partially_refunded'},{cart_snapshot:[]},{cart_snapshot:[{packageName:'All Digitals',digitalLimit:5,purchasedEventScope:{version:1,projectId,collectionIds:[albumA]}}]}]) {
    const h=harness({extras:{favoriteDownloadsRequireAllDigitalsPurchase:true}});h.tables.orders.push({...purchase(),...change});
    assert.equal((await h.post(legacyRoute,h.body({mediaIds:[a],downloadType:'favorites'}))).status,403);assert.equal(h.writes.length,0);
  }
  const h=harness({extras:{favoriteDownloadsRequireAllDigitalsPurchase:true},fetchImage:imageFetch});h.tables.orders.push(purchase());
  const ready=await h.post(legacyRoute,h.body({mediaIds:[a],downloadType:'favorites'}));assert.equal(ready.status,200);assert.equal((await h.get(ready.body.deliveries[0].url)).status,200);
});

test('browser delivery helpers require fresh gated URLs and leave preview/cart records unchanged',()=>{
  const h=harness(),helper=h.load('lib/event-gallery-media-client.ts');
  const image={id:a,url:`/api/portal/event-preview/${a}.jpg?token=old`,previewUrl:`/api/portal/event-preview/${a}.jpg?token=old`,storagePath:'fixture/a.jpg'};
  assert.throws(()=>helper.authorizedEventDownloadImages([image],{allowedMediaIds:[a]}),/fresh/);
  assert.throws(()=>helper.authorizedEventDownloadImages([image],{allowedMediaIds:[a],deliveries:[{mediaId:a,url:'https://attacker.test/original.jpg'}]}),/fresh/);
  const download=helper.authorizedEventDownloadImages([image],{allowedMediaIds:[a],deliveries:[{mediaId:a,url:'/api/portal/event-download-file?token=signed',resolution:'original',watermarked:false}]});
  assert.equal(download[0].deliveryUrl,'/api/portal/event-download-file?token=signed');assert.equal('deliveryUrl' in image,false);
  const entry={selectedImageUrl:image.url,slots:[{label:'8x10',assignedImageUrl:image.url}],retouchSelections:[{imageUrl:image.url,notes:'Preserve freckles'}],digitalSelections:[{mediaId:a,url:image.url}]};
  const canonical=helper.canonicalEventOrderEntry(entry,[image]);
  assert.equal(canonical.selectedImageUrl,'fixture/a.jpg');assert.equal(canonical.slots[0].assignedImageUrl,'fixture/a.jpg');assert.equal(canonical.retouchSelections[0].imageUrl,'fixture/a.jpg');assert.equal(canonical.digitalSelections[0].url,'fixture/a.jpg');
  assert.equal(entry.selectedImageUrl,image.url);
  assert.throws(()=>helper.canonicalEventOrderEntry({...entry,selectedImageUrl:'https://foreign.test/photo.jpg'},[image]),/no longer available/);
});

test('server canonical order resolution binds print, retouch and digital photo identities to current album scope',async()=>{
  const h=harness(),helper=h.load('lib/event-order-media.ts');
  const preview=`/api/portal/event-preview/${a}.jpg?token=old`;
  const entry=()=>({selectedImageUrl:preview,slots:[{assignedImageUrl:preview}],retouchSelections:[{imageUrl:preview,notes:'Preserve freckles'}],digitalSelections:[{mediaId:a,url:preview}]});
  const entries=[entry()];await helper.resolveEventOrderMediaReferences(h.service,projectId,[albumA],entries);
  assert.equal(entries[0].selectedImageUrl,'fixture/a.jpg');assert.equal(entries[0].slots[0].assignedImageUrl,'fixture/a.jpg');assert.equal(entries[0].retouchSelections[0].imageUrl,'fixture/a.jpg');assert.equal(entries[0].digitalSelections[0].url,'fixture/a.jpg');
  for(const selectedImageUrl of ['fixture/b.jpg','fixture/locked.jpg','fixture/foreign.jpg','https://attacker.test/a.jpg']) await assert.rejects(helper.resolveEventOrderMediaReferences(h.service,projectId,[albumA],[{...entry(),selectedImageUrl}]),/outside/);
  await assert.rejects(helper.resolveEventOrderMediaReferences(h.service,projectId,[albumA],[{...entry(),digitalSelections:[{mediaId:a,url:'fixture/b.jpg'}]}]),/outside/);
  assert.equal(h.writes.length,0);
});

 test('a print snapshot scope cannot widen an unrelated all-digital album purchase',async()=>{
  const h=harness({extras:{favoriteDownloadsRequireAllDigitalsPurchase:true}});
  const order=purchase();order.cart_snapshot.push({packageName:'8x10 Print',purchasedEventScope:{version:1,projectId,collectionIds:[albumB]}});h.tables.orders.push(order);
  assert.equal((await h.post(legacyRoute,h.body({collectionId:albumB,mediaIds:[b],downloadType:'favorites'}))).status,403);
  const prints=harness({extras:{favoriteDownloadsRequireAllDigitalsPurchase:true}});prints.tables.orders.push({...purchase(),package_name:'Full Gallery Prints',cart_snapshot:[{packageName:'Full Gallery Prints',purchasedEventScope:{version:1,projectId,collectionIds:[albumA]}}]});
  assert.equal((await prints.post(legacyRoute,prints.body({mediaIds:[a],downloadType:'favorites'}))).status,403);
 });

 test('a corrupt original with valid JPEG headers is not reported as a delivered original',async()=>{
  const corrupt=original.subarray(0,Math.floor(original.length/2));assert.equal((await sharp(corrupt).metadata()).format,'jpeg');
  const h=harness({fetchImage:async()=>new Response(corrupt)});const ready=await h.post(legacyRoute,h.body({mediaIds:[a]}));assert.equal(ready.status,200);assert.equal((await h.get(ready.body.deliveries[0].url)).status,503);
 });

 test('current event payment/refund fields override old paid timestamps and delivery status',async()=>{
 for(const change of [{payment_status:'pending'},{payment_status:'processing'},{payment_status:'failed'},{payment_status:'unknown'},{refund_status:'pending'},{refund_status:'succeeded'},{refund_amount_cents:100}]) {
 const h=harness({extras:{favoriteDownloadsRequireAllDigitalsPurchase:true}});h.tables.orders.push({...purchase(),paid_at:'2026-10-01',...change});assert.equal((await h.post(legacyRoute,h.body({mediaIds:[a],downloadType:'favorites'}))).status,403,JSON.stringify(change));assert.equal(h.writes.length,0);
 }
 });

 test('expired event access revokes old previews and gated files before storage and blocks fresh context',async()=>{
 const h=harness({fetchImage:imageFetch});const context=await h.post('app/api/portal/event-gallery-context/route.ts',h.body());const ready=await h.post(legacyRoute,h.body({mediaIds:[a]}));assert.equal(context.status,200);assert.equal(ready.status,200);h.tables.projects[0].expiration_date='2020-01-01';
 assert.equal((await h.get(context.body.media[0].preview_url)).status,403);assert.equal((await h.get(ready.body.deliveries[0].url)).status,403);assert.equal((await h.post('app/api/portal/event-gallery-context/route.ts',h.body())).status,410);assert.equal((await h.post(legacyRoute,h.body({mediaIds:[a]}))).status,410);assert.equal(h.fetched.length,0);
 });

 test('every event context copy of settings removes private download PIN and owner-only contact',async()=>{
 const h=harness({extras:{downloadPinEnabled:true,downloadPin:'owner-only-download-pin'}});h.tables.projects[0].gallery_settings.desktopClientEmail='private-owner-contact@example.test';const result=await h.post('app/api/portal/event-gallery-context/route.ts',h.body());assert.equal(result.status,200);assert.equal(JSON.stringify(result.body).includes('owner-only-download-pin'),false);assert.equal(JSON.stringify(result.body).includes('private-owner-contact@example.test'),false);
 });
