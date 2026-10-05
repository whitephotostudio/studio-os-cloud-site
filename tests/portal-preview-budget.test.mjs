import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {harness,projectId,a,id} from './helpers/event-gallery-harness.mjs';
const tiny=await sharp({create:{width:32,height:24,channels:3,background:'#aabbcc'}}).jpeg().toBuffer();
function budgetFixture(){const counts=new Map();const calls=[];const h=harness({fetchImage:async()=>new Response(tiny),overrides:{'@/lib/rate-limit':{getClientIp:()=> 'same-school-network',rateLimit:async(key,config)=>{calls.push({key,...config});const group=config.namespace+':'+key,n=(counts.get(group)||0)+1;counts.set(group,n);return{allowed:n<=config.limit,resetAt:Date.now()+60000};}}}});return{...h,counts,calls};}

test('one974-photo browse and a second viewer on the same IP fit distinct validated preview budgets',async()=>{
 const h=budgetFixture();const first=await h.post('app/api/portal/event-gallery-context/route.ts',h.body());const second=await h.post('app/api/portal/event-gallery-context/route.ts',h.body({email:'second@example.test'}));assert.equal(first.status,200);assert.equal(second.status,200);
 const urls=[first.body.media[0].thumbnail_url,second.body.media[0].thumbnail_url];
 for(const url of urls) for(let n=0;n<974;n++){const response=await h.get(url);assert.equal(response.status,200,`preview${n+1}`);}
 const viewerCalls=h.calls.filter(call=>call.namespace==='portal-preview-viewer');assert.equal(new Set(viewerCalls.map(call=>call.key)).size,2);assert.ok(viewerCalls.every(call=>call.limit===3000));assert.ok(h.calls.some(call=>call.namespace==='portal-preview-global'&&call.limit===12000));
 const globalKeys=[...h.counts.keys()].filter(key=>key.startsWith('portal-preview-global:'));assert.equal(globalKeys.length,1);assert.equal(h.counts.get(globalKeys[0]),1948);
});

test('validated viewer and global image abuse budgets remain bounded and refuse before storage',async()=>{
 const h=budgetFixture(),helpers=h.load('lib/portal-preview-rate-limit.ts');for(let n=0;n<3000;n++)assert.equal((await helpers.portalPreviewViewerLimit('same-school-network',projectId,'viewer@example.test')).allowed,true);assert.equal((await helpers.portalPreviewViewerLimit('same-school-network',projectId,'viewer@example.test')).allowed,false);assert.equal((await helpers.portalPreviewViewerLimit('same-school-network',projectId,'other@example.test')).allowed,true);
 for(let n=0;n<12000;n++)assert.equal((await helpers.portalPreviewGlobalLimit('same-school-network')).allowed,true);assert.equal((await helpers.portalPreviewGlobalLimit('same-school-network')).allowed,false);assert.equal(h.fetched.length,0);
});

test('preview retries recover after bounded cooldown and never retry delivery/original URLs or stale nodes',()=>{
 const h=harness(),helper=h.load('lib/portal-preview-retry.ts');const timers=[];const image={src:`https://fixture.test/api/portal/event-preview/${a}.jpg?token=signed`,isConnected:true,alt:'Photo',dataset:{},style:{opacity:'0'}};
 const schedule=(run,delay)=>timers.push({run,delay});assert.equal(helper.retryPortalPreviewImage(image,schedule),true);assert.equal(timers[0].delay,1500);assert.equal(image.style.opacity,'1');timers[0].run();assert.match(image.src,/previewRetry=1/);assert.equal(helper.retryPortalPreviewImage(image,schedule),true);assert.equal(timers[1].delay,60000);timers[1].run();assert.equal(helper.retryPortalPreviewImage(image,schedule),false);assert.equal(timers.length,2);
 const original={...image,src:'https://fixture.test/original.jpg',dataset:{}};assert.equal(helper.retryPortalPreviewImage(original,schedule),false);const delivery={...image,src:'https://fixture.test/api/portal/event-download-file?token=signed',dataset:{}};assert.equal(helper.retryPortalPreviewImage(delivery,schedule),false);
 const removed={...image,isConnected:false,dataset:{}};const before=removed.src;assert.equal(helper.retryPortalPreviewImage(removed,schedule),true);timers.at(-1).run();assert.equal(removed.src,before);
 const changed={...image,dataset:{}};assert.equal(helper.retryPortalPreviewImage(changed,schedule),true);changed.src='https://fixture.test/new-preview.jpg';timers.at(-1).run();assert.equal(changed.src,'https://fixture.test/new-preview.jpg');
});
