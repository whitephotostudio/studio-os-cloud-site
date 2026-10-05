import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { harness, projectId as schoolId, id } from './helpers/event-gallery-harness.mjs';

const studio=id(70), student=id(71), otherStudent=id(72), schoolProject=id(73);
const portrait=`schools/${schoolId}/Grade A/Student A/portrait.jpg`, foreign=`schools/${schoolId}/Grade B/Student B/foreign.jpg`;
const compositeA=`projects/${schoolProject}/composites/Grade A.jpg`, compositeB=`projects/${schoolProject}/composites/Grade B.jpg`;
const original=await sharp({create:{width:4800,height:3200,channels:3,background:'#386598'}}).jpeg().toBuffer();
const cutout=await sharp({create:{width:2400,height:1600,channels:4,background:{r:100,g:150,b:200,alpha:0.4}}}).png().toBuffer();
const imageFetch=async()=>new Response(original,{headers:{'content-type':'image/jpeg'}});
function fixture(options={}) {
  const files=[{key:portrait,name:'portrait.jpg',url:`https://fixture.test/${portrait}`},{key:foreign,name:'foreign.jpg',url:`https://fixture.test/${foreign}`}];
  const h=harness({fetchImage:imageFetch,folderFiles:files,cutoutBytes:cutout,...options});
  h.tables.schools.push({id:schoolId,school_name:'School',photographer_id:studio,local_school_id:null,status:'active',portal_status:'active',expiration_date:null,gallery_settings:{extras:{freeDigitalRuleEnabled:true,showDownloadAllButton:true,freeDigitalAudience:'gallery',freeDigitalDownloadLimit:'unlimited',freeDigitalResolution:'original',watermarkDownloads:false,allowClientFavoriteDownloads:true,favoriteDownloadsRequireAllDigitalsPurchase:false,...options.extras}}});
  h.tables.photographers.push({id:studio,subscription_status:'active',watermark_enabled:true});
  h.tables.students.push({id:student,school_id:schoolId,pin:'12345',first_name:'Student',last_name:'A',photo_url:portrait,class_id:id(74),class_name:'Grade A',folder_name:'Student A'},{id:otherStudent,school_id:schoolId,pin:'54321',first_name:'Student',last_name:'B',photo_url:foreign,class_id:id(75),class_name:'Grade B',folder_name:'Student B'});
  const body=overrides=>({schoolId,email:'parent@example.test',pin:'12345',mediaIds:[portrait],...overrides});
  return {...h,school:h.tables.schools[0],student:h.tables.students[0],body};
}
const paid=(overrides={})=>({id:id(80),school_id:schoolId,student_id:student,photographer_id:studio,parent_email:'parent@example.test',package_name:'All Digitals',status:'digital_paid',payment_status:'succeeded',cart_snapshot:[{packageName:'All Digitals'}],...overrides});

for(const route of ['app/api/portal/gallery-context/route.ts','app/api/portal/school-access/route.ts']) test(`${route} exposes true previews plus canonical keys without original portrait URLs`,async()=>{
  const h=fixture();const result=await h.post(route,h.body({prefetch:true}));
  assert.equal(result.status,200);
  const context=result.body.galleryContext||result.body;
  assert.ok(context.media?.length,'prefetch and direct context must both include media');
  assert.equal(context.media.length,1);assert.equal(context.media[0].storage_path,portrait);
  assert.match(context.media[0].preview_url,/school-preview/);assert.equal(context.media[0].download_url??null,null);
  assert.match(context.primaryStudent.photo_url,/school-preview/);assert.equal(context.primaryStudent.photo_storage_path,portrait);
  assert.equal(JSON.stringify(context).includes(`https://fixture.test/${portrait}`),false);
  assert.equal(h.fetched.length,0);
  const preview=await h.get(context.media[0].preview_url);assert.equal(preview.status,200);assert.equal((await sharp(preview.body).metadata()).width,1200);assert.equal(preview.headers.get('location'),null);
});

test('school preview grants revoke changed PIN/student/class/owner/expiry and tombstones before object reads',async()=>{
  for(const change of ['pin','student','class','owner','expiry','tombstone']) {
    const h=fixture();const context=await h.post('app/api/portal/gallery-context/route.ts',h.body());
    assert.equal(context.status,200);const url=context.body.media[0].preview_url;
    if(change==='pin')h.student.pin='00000';if(change==='student')h.student.school_id=id(90);if(change==='class')h.student.class_name='Grade B';if(change==='owner')h.school.photographer_id=id(91);if(change==='expiry')h.school.expiration_date='2020-01-01';
    if(change==='tombstone')h.tables.school_photo_deletions.push({id:id(92),school_id:schoolId,storage_key:portrait,storage_family:h.load('lib/school-photo-deletions.ts').schoolPhotoFamilyForKey(portrait)});
    assert.equal((await h.get(url)).status,403,change);assert.equal(h.fetched.length,0,change);
  }
});

test('transparent paid cutout previews stay bounded PNG and preserve alpha without exposing full source',async()=>{
  const h=fixture(),helper=h.load('lib/school-portal-media.ts');
  const key=`nobg-photos/${portrait}.png`;
  const token=helper.schoolMediaGrant({school:h.school,students:[h.student],email:'parent@example.test',mediaKey:key,kind:'school-gallery-preview'});
  const result=await h.get(`/api/portal/school-preview/image.jpg?token=${token}`);
  assert.equal(result.status,200);const meta=await sharp(result.body).metadata();assert.equal(meta.format,'png');assert.equal(meta.width,1200);assert.equal(meta.hasAlpha,true);assert.notDeepEqual(result.body,cutout);
});

test('school delivery keeps PIN/student scope, deduplicates IDs before quota, and returns only gated byte routes',async()=>{
  const h=fixture();const ready=await h.post('app/api/portal/school-downloads/route.ts',h.body({mediaIds:[portrait,portrait,foreign]}));
  assert.equal(ready.status,200);assert.deepEqual(ready.body.allowedMediaIds,[portrait]);assert.equal(ready.body.deliveries.length,1);
  assert.match(ready.body.deliveries[0].url,/school-download-file/);assert.equal(h.writes.at(-1).value.download_count,1);
  const result=await h.get(ready.body.deliveries[0].url);assert.equal(result.status,200);assert.deepEqual(result.body,original);
  h.school.gallery_settings.extras.freeDigitalRuleEnabled=false;
  assert.equal((await h.get(ready.body.deliveries[0].url)).status,403);
});

test('school favorite permission is independent of free gallery access but paid entitlement stays student/studio/email scoped',async()=>{
  for(const change of [{student_id:otherStudent},{school_id:id(90)},{photographer_id:id(91)},{parent_email:'other@example.test'},{status:'refunded'},{payment_status:'partially_refunded'},{status:'payment_pending',payment_status:'pending'}]) {
    const h=fixture({extras:{freeDigitalRuleEnabled:false,favoriteDownloadsRequireAllDigitalsPurchase:true}});h.tables.orders.push(paid(change));
    assert.equal((await h.post('app/api/portal/school-downloads/route.ts',h.body({downloadType:'favorites'}))).status,403);assert.equal(h.writes.length,0);
  }
  const h=fixture({extras:{freeDigitalRuleEnabled:false,favoriteDownloadsRequireAllDigitalsPurchase:true}});h.tables.orders.push(paid());
  const context=await h.post('app/api/portal/gallery-context/route.ts',h.body());assert.equal(context.body.favoriteDownloadAccess.canDownload,true);
  const ready=await h.post('app/api/portal/school-downloads/route.ts',h.body({downloadType:'favorites'}));assert.equal(ready.status,200);assert.equal((await h.get(ready.body.deliveries[0].url)).status,200);
  h.tables.orders[0].payment_status='refunded';assert.equal((await h.get(ready.body.deliveries[0].url)).status,403);
  const disabled=fixture({extras:{allowClientFavoriteDownloads:false}});assert.equal((await disabled.post('app/api/portal/school-downloads/route.ts',disabled.body({downloadType:'favorites'}))).status,403);
});

test('school download PIN and class rules remain enforced and quota includes rows after1000',async()=>{
  const pin=fixture({extras:{downloadPinEnabled:true,downloadPin:'download-secret'}});
  assert.equal((await pin.post('app/api/portal/school-downloads/route.ts',pin.body())).status,403);
  assert.equal((await pin.post('app/api/portal/school-downloads/route.ts',pin.body({downloadPin:'download-secret'}))).status,200);
  const disabledClass=fixture({extras:{schoolClassDownloadOverrides:{[id(74)]:{freeDigitalRuleEnabled:false}}}});
  assert.equal((await disabledClass.post('app/api/portal/school-downloads/route.ts',disabledClass.body())).status,403);
  const quota=fixture({extras:{freeDigitalDownloadLimit:'1'}});
  quota.tables.school_gallery_downloads.push(...Array.from({length:1000},(_,n)=>({id:id(1000+n),school_id:schoolId,viewer_email:'parent@example.test',download_type:'gallery',download_count:0})),{id:id(3000),school_id:schoolId,viewer_email:'parent@example.test',download_type:'gallery',download_count:1});
  assert.equal((await quota.post('app/api/portal/school-downloads/route.ts',quota.body())).status,403);
});

test('one mismatched composite collection cannot expose another class group photo',async()=>{
  const h=fixture({overrides:{'@/lib/school-sync':{findSyncedSchoolProjectId:async()=>schoolProject}}});
  h.tables.collections.push({id:id(76),project_id:schoolProject,kind:'composite',title:'Grade B',slug:'grade-b'});
  h.tables.media.push({id:id(77),project_id:schoolProject,collection_id:id(76),storage_path:compositeB,filename:'Grade B.jpg'});
  const result=await h.post('app/api/portal/gallery-context/route.ts',h.body());assert.equal(result.status,200);assert.equal(result.body.composites.length,0);
});

 test('a shared family PIN does not let one child purchase unlock another child photos',async()=>{
  const h=fixture({extras:{favoriteDownloadsRequireAllDigitalsPurchase:true}});h.tables.students[1].pin='12345';h.tables.orders.push(paid());
  assert.equal((await h.post('app/api/portal/school-downloads/route.ts',h.body({downloadType:'favorites',mediaIds:[foreign]}))).status,403);
  const prints=fixture({extras:{favoriteDownloadsRequireAllDigitalsPurchase:true}});prints.tables.orders.push(paid({package_name:'Full Gallery Prints',cart_snapshot:[{packageName:'Full Gallery Prints'}]}));
  assert.equal((await prints.post('app/api/portal/school-downloads/route.ts',prints.body({downloadType:'favorites'}))).status,403);
 });

for(const route of ['app/api/portal/gallery-context/route.ts','app/api/portal/school-access/route.ts']) test(`class identity and composite paging remain exact in ${route}`,async()=>{
  const h=fixture({overrides:{'@/lib/school-sync':{findSyncedSchoolProjectId:async()=>schoolProject}}});h.student.class_name='Grade 1';
  h.tables.collections.push({id:id(76),project_id:schoolProject,kind:'composite',title:'Grade 1',slug:'grade-1'},{id:id(79),project_id:schoolProject,kind:'composite',title:'Grade 10',slug:'grade-10'});
  h.tables.media.push(...Array.from({length:1001},(_,n)=>({id:id(10000+n),project_id:schoolProject,collection_id:id(76),storage_path:`projects/${schoolProject}/composites/Grade 1-${n}.jpg`,filename:`Grade 1-${n}.jpg`})),{id:id(78),project_id:schoolProject,collection_id:id(79),storage_path:compositeB,filename:'Grade 10.jpg'});
  const result=await h.post(route,h.body({prefetch:true}));assert.equal(result.status,200);const context=result.body.galleryContext||result.body;assert.equal(context.composites.length,1001);assert.ok(context.composites.every(row=>row.collection_id===id(76)));assert.ok(context.composites.every(row=>row.preview_url.includes('school-preview')));assert.equal(h.fetched.length,0);
  h.student.class_name=null;h.student.class_id=null;const unknown=await h.post(route,h.body({prefetch:true}));assert.equal((unknown.body.galleryContext||unknown.body).composites.length,0);
});

test('school preview failures are visible for corrupt, oversized and missing sources without redirects',async()=>{
 for(const mode of ['corrupt','oversize','missing']) {
  const h=fixture({fetchImage:async()=>mode==='missing'?new Response('',{status:404}):new Response('invalid image',{headers:{'content-length':mode==='oversize'?String(33*1024*1024):'13'}})});
  const context=await h.post('app/api/portal/gallery-context/route.ts',h.body());const result=await h.get(context.body.media[0].preview_url);assert.equal(result.status,503,mode);assert.equal(result.headers.get('location'),null);assert.equal(h.writes.length,0);
 }
});

test('school saved preview choices recover canonical identity but server checks exact child/class before orders',async()=>{
 const h=fixture({overrides:{'@/lib/school-sync':{findSyncedSchoolProjectId:async()=>schoolProject}}});h.tables.collections.push({id:id(76),project_id:schoolProject,kind:'composite',title:'Grade A',slug:'grade-a'},{id:id(79),project_id:schoolProject,kind:'composite',title:'Grade B',slug:'grade-b'});h.tables.media.push({id:id(77),project_id:schoolProject,collection_id:id(76),storage_path:compositeA,filename:'Grade A.jpg'},{id:id(78),project_id:schoolProject,collection_id:id(79),storage_path:compositeB,filename:'Grade B.jpg'});
 const context=await h.post('app/api/portal/gallery-context/route.ts',h.body());const preview=context.body.media[0].preview_url,helper=h.load('lib/school-order-media.ts'),browser=h.load('lib/event-gallery-media-client.ts');
 const entry=value=>({selectedImageUrl:value,slots:[{assignedImageUrl:value}],retouchSelections:[{imageUrl:value,notes:'Keep freckles'}],digitalSelections:[{mediaId:portrait,url:value}]});
 const saved=browser.canonicalEventOrderEntry(entry(preview),[]);assert.equal(saved.selectedImageUrl,portrait);assert.equal(saved.slots[0].assignedImageUrl,portrait);assert.equal(saved.retouchSelections[0].imageUrl,portrait);
 await helper.resolveSchoolOrderMediaReferences(h.service,schoolId,student,studio,[saved]);assert.equal(saved.digitalSelections[0].url,portrait);
 const groupPhoto={selectedImageUrl:compositeA,slots:[],retouchSelections:[]};await helper.resolveSchoolOrderMediaReferences(h.service,schoolId,student,studio,[groupPhoto]);assert.equal(groupPhoto.selectedImageUrl,compositeA);
 for(const key of [foreign,compositeB,`schools/${id(90)}/Grade A/Student A/portrait.jpg`,'https://attacker.test/portrait.jpg']) await assert.rejects(helper.resolveSchoolOrderMediaReferences(h.service,schoolId,student,studio,[{...entry(portrait),selectedImageUrl:key}]),/outside/);
 const forged=new URL(preview,'https://fixture.test'),payload=JSON.parse(Buffer.from(forged.searchParams.get('token').split('.')[0],'base64url').toString());payload.mediaKey=foreign;forged.searchParams.set('token',Buffer.from(JSON.stringify(payload)).toString('base64url')+'.fake');
 await assert.rejects(helper.resolveSchoolOrderMediaReferences(h.service,schoolId,student,studio,[{...entry(portrait),selectedImageUrl:forged.pathname+forged.search}]),/outside/);assert.equal(h.writes.length,0);
});

test('actual school create and combined routes reject another child before any order/payment write',async()=>{
 for(const route of ['app/api/portal/orders/create/route.ts','app/api/portal/orders/create-combined/route.ts']) {
  const h=fixture();h.tables.packages.push({id:id(88),photographer_id:studio,name:'5x7 Print',category:'print',price_cents:1000,active:true});
  const entry={packageId:id(88),quantity:1,selectedImageUrl:foreign,slots:[{label:'5x7',assignedImageUrl:foreign}]};const parent={name:'Parent',email:'parent@example.test'},delivery={method:'pickup'};
  const body=route.includes('create-combined')?{groups:[{schoolId,pin:'12345',email:'parent@example.test',entries:[entry]}],parent,delivery}:{...h.body(),mode:'school',entries:[entry],parent,delivery};
  const result=await h.post(route,body);assert.equal(result.status,403,JSON.stringify(result));assert.match(result.body.message,/photo selections|outside/);assert.equal(h.writes.length,0);assert.equal(h.fetched.length,0);
 }
});

 test('an old school composite preview revokes after its class collection or project membership changes',async()=>{
 for(const change of ['class','project','removed']){
  const h=fixture({overrides:{'@/lib/school-sync':{findSyncedSchoolProjectId:async()=>schoolProject}}});const album={id:id(76),project_id:schoolProject,kind:'composite',title:'Grade A',slug:'grade-a'};const media={id:id(77),project_id:schoolProject,collection_id:id(76),storage_path:compositeA,filename:'Group Photo.jpg'};h.tables.collections.push(album);h.tables.media.push(media);
  const context=await h.post('app/api/portal/gallery-context/route.ts',h.body());assert.equal(context.body.composites.length,1);const url=context.body.composites[0].preview_url;
  if(change==='class'){album.title='Grade B';album.slug='grade-b';media.storage_path=compositeB;}if(change==='project')media.project_id=id(990);if(change==='removed')h.tables.media=h.tables.media.filter(row=>row.id!==media.id);
  assert.equal((await h.get(url)).status,403,change);assert.equal(h.fetched.length,0);
 }
 });

 test('current school payment/refund fields override historical paid timestamps',async()=>{
 for(const change of [{payment_status:'pending'},{payment_status:'processing'},{payment_status:'failed'},{payment_status:'unknown'},{refund_status:'pending'},{refund_status:'succeeded'},{refund_amount_cents:100}]) {
 const h=fixture({extras:{favoriteDownloadsRequireAllDigitalsPurchase:true}});h.tables.orders.push(paid({paid_at:'2026-10-01',...change}));assert.equal((await h.post('app/api/portal/school-downloads/route.ts',h.body({downloadType:'favorites'}))).status,403,JSON.stringify(change));assert.equal(h.writes.length,0);
 }
 });

 test('canonical native school composite keys display only for the current authorized class',async()=>{
 const key=`schools/${schoolId}/composites/grade-a/class.jpg`;const h=fixture({overrides:{'@/lib/school-sync':{findSyncedSchoolProjectId:async()=>schoolProject}}});h.tables.collections.push({id:id(76),project_id:schoolProject,kind:'composite',title:'Grade A',slug:'grade-a'});h.tables.media.push({id:id(77),project_id:schoolProject,collection_id:id(76),storage_path:key,filename:'class.jpg'});
 const context=await h.post('app/api/portal/gallery-context/route.ts',h.body());assert.equal(context.body.composites.length,1);const url=context.body.composites[0].preview_url;assert.equal((await h.get(url)).status,200);h.student.class_name='Grade B';assert.equal((await h.get(url)).status,403);
 });

 test('shared family PIN free downloads use each photo owner class and recheck it during delivery',async()=>{
 const h=fixture({extras:{schoolClassDownloadOverrides:{[id(75)]:{freeDigitalRuleEnabled:false}}}});h.tables.students[1].pin='12345';
 assert.equal((await h.post('app/api/portal/school-downloads/route.ts',h.body({mediaIds:[foreign]}))).status,403);assert.equal(h.writes.length,0);
 const mixed=await h.post('app/api/portal/school-downloads/route.ts',h.body({mediaIds:[portrait,foreign]}));assert.equal(mixed.status,200);assert.deepEqual(mixed.body.allowedMediaIds,[portrait]);assert.equal((await h.get(mixed.body.deliveries[0].url)).status,200);
 h.school.gallery_settings.extras.schoolClassDownloadOverrides[id(74)]={freeDigitalRuleEnabled:false};assert.equal((await h.get(mixed.body.deliveries[0].url)).status,403);
 const changed=fixture();changed.tables.students[1].pin='12345';const ready=await changed.post('app/api/portal/school-downloads/route.ts',changed.body({mediaIds:[foreign]}));assert.equal(ready.status,200);changed.school.gallery_settings.extras.schoolClassDownloadOverrides={[id(75)]:{freeDigitalRuleEnabled:false}};assert.equal((await changed.get(ready.body.deliveries[0].url)).status,403);assert.equal(changed.fetched.length,0);
 });

 for(const route of ['app/api/portal/gallery-context/route.ts','app/api/portal/school-access/route.ts']) test(`all nested school settings copies are sanitized in ${route}`,async()=>{
 const h=fixture({extras:{downloadPinEnabled:true,downloadPin:'owner-only-download-pin'}});h.school.gallery_settings.desktopClientEmail='private-owner-contact@example.test';const result=await h.post(route,h.body({prefetch:true}));assert.equal(result.status,200);assert.equal(JSON.stringify(result.body).includes('owner-only-download-pin'),false);assert.equal(JSON.stringify(result.body).includes('private-owner-contact@example.test'),false);
 });
