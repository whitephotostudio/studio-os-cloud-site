import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const sha = value => createHash('sha256').update(value).digest('hex');
function storedZipEntries(bytes) {
  const entries=new Map();let offset=0;
  while(bytes.readUInt32LE(offset)===0x04034b50){assert.equal(bytes.readUInt16LE(offset+8),0);const length=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28),start=offset+30+nameLength+extraLength;entries.set(bytes.subarray(offset+30,offset+30+nameLength).toString(),bytes.subarray(start,start+length));offset=start+length;}
  return entries;
}
export const fixtureDesign = () => ({ version:1,name:'Fixture three moments',widthInches:6,heightInches:4,background:'#ffffff',ink:'#172033',overlay:null,
  slots:['left','centre','right'].map((id,i)=>({id,label:id,x:.04+i*.32,y:i===1?.04:.08,width:.28,height:.68})),caption:{x:.5,y:.86,size:.028} });
export function fixtureClient(config) {
  let cookie='';
  const requests=[];
  async function request(route,{body,token,headers={},method=body===undefined?'GET':'POST'}={}) {
    const response=await fetch(config.baseUrl+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),Origin:config.baseUrl,'Sec-Fetch-Site':'same-origin',...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const set=response.headers.getSetCookie(); if(set.length)cookie=set.map(value=>value.split(';')[0]).join('; ');
    const bytes=Buffer.from(await response.arrayBuffer()),json=response.headers.get('content-type')?.includes('application/json')?JSON.parse(bytes):null;
    requests.push({route,status:response.status}); return{status:response.status,headers:response.headers,bytes,json};
  }
  const ok=async(route,options)=>{const result=await request(route,options);assert.equal(result.status,200,`${route}: ${JSON.stringify(result.json)}`);return result;};
  return{request,ok,requests,get cookie(){return cookie;}};
}
export async function publishFixtureProduct(config,client,{mixed=false}={}) {
  const catalog=(await client.ok('/api/dashboard/collages/commerce',{token:config.ownerToken})).json;
  const payload={requestId:randomUUID(),catalogRevision:catalog.catalogRevision,design:fixtureDesign(),galleries:catalog.galleries.map(({id,kind})=>({id,kind})),product:{mode:mixed?'update':'create',...(mixed?{id:config.ids.ordinaryProduct}:{name:'Fixture collage pair'}),profileId:config.profileId,priceCents:mixed?3100:2400,copyCount:2}};
  const result=await client.ok('/api/dashboard/collages/commerce',{token:config.ownerToken,body:payload});
  const repeated=await client.ok('/api/dashboard/collages/commerce',{token:config.ownerToken,body:payload});
  assert.equal(repeated.json.replayed,true);assert.equal(repeated.json.version.id,result.json.version.id);
  const stale=await client.request('/api/dashboard/collages/commerce',{token:config.ownerToken,body:{...payload,requestId:randomUUID()}}); assert.equal(stale.status,409);
  return result.json;
}
function selections(design,versionId,media,copy) {
  return{version:1,templateVersionId:versionId,placements:design.slots.map((slot,index)=>({slotId:slot.id,mediaId:media[index%media.length].key,zoom:copy?1.35:1,x:copy?.25:.5,y:copy?.65:.5})),caption:{studentName:'Fixture Student',schoolName:'Fixture Academy',year:'2026'}};
}
export async function runCollageScenario(config,{publish=false}={}) {
  const client=fixtureClient(config),results={version:1,limitations:config.limitations,requests:client.requests};
  assert.equal((await client.request('/api/dashboard/collages/commerce')).status,401);
  assert.equal((await client.request('/api/dashboard/collages/commerce',{token:config.ownerToken+'bad'})).status,401);
  if(publish){await publishFixtureProduct(config,client);await publishFixtureProduct(config,client,{mixed:true});}
  const catalog=(await client.ok('/api/dashboard/collages/commerce',{token:config.ownerToken})).json;
  const mixed=catalog.products.find(product=>product.id===config.ids.ordinaryProduct&&product.items.some(item=>item.collage));
  assert.ok(mixed,'Native publish must append a collage to the existing ordinary print product before this scenario.');
  const collageItem=mixed.items.find(item=>item.collage),versionId=collageItem.collage.templateVersionId;
  const stored=(await client.ok('/api/dashboard/collages/'+versionId,{token:config.ownerToken})).json.version;
  assert.ok(stored?.design);
  assert.equal((await client.request('/api/dashboard/collages/'+versionId,{token:config.foreignToken})).status,404);
  const lanes=[];
  for(const parent of config.parents){const body={kind:parent.kind,galleryId:parent.galleryId,pin:parent.pin,email:parent.email};lanes.push((await client.ok('/api/portal/session',{body})).json);}
  const mediaFor=index=>config.media.filter(row=>row.schoolId===config.parents[index].galleryId);
  const entryFor=(index,version=versionId,design=stored.design)=>({packageId:mixed.id,quantity:1,price:1,slots:mixed.items.flatMap(item=>Array.from({length:item.qty||1},(_,copy)=>item.collage?{label:'Collage print',assignedImageUrl:null,collage:selections(design,version,mediaFor(index),copy)}:{label:'Ordinary print',assignedImageUrl:mediaFor(index)[0].key}))});
  const common={parent:{name:'Isolated Parent',email:'parent@example.test',phone:''},delivery:{method:'pickup'}};
  const body={...common,parentLaneId:lanes[0].laneId,entries:[entryFor(0)]};
  const invalid=structuredClone(body);invalid.entries[0].slots.find(slot=>slot.collage).collage.placements[0].mediaId=mediaFor(1)[0].key;
  assert.equal((await client.request('/api/portal/orders/create',{body:invalid,headers:{'x-studio-parent-session':'1'}})).status,409);
  const badPreview=await client.request('/api/portal/collages/preview',{body:{parentLaneId:lanes[0].laneId,selection:invalid.entries[0].slots.find(slot=>slot.collage).collage}});assert.equal(badPreview.status,403);
  const goodSelection=body.entries[0].slots.find(slot=>slot.collage).collage;
  const stranger=fixtureClient(config);assert.equal((await stranger.request('/api/portal/collages/preview',{body:{parentLaneId:lanes[0].laneId,selection:goodSelection}})).status,401);
  const preview=await client.ok('/api/portal/collages/preview',{body:{parentLaneId:lanes[0].laneId,selection:goodSelection}});
  const previewBytes=Buffer.from(preview.json.preview.split(',')[1],'base64'),previewMetadata=await sharp(previewBytes).metadata();
  assert.equal(Math.max(previewMetadata.width,previewMetadata.height),1200);await writeFile(path.join(config.outputDirectory,'parent-preview.png'),previewBytes);
  // Serialize and reload the basket as the browser does. No expiring URLs/prices
  // enter collage selections; each finished copy retains independent crops.
  const restored=JSON.parse(JSON.stringify(body));assert.deepEqual(restored,body);
  await writeFile(path.join(config.outputDirectory,'restored-cart.json'),JSON.stringify(restored,null,2));
  const headers={'x-studio-parent-session':'1','Idempotency-Key':randomUUID()};
  const created=(await client.ok('/api/portal/orders/create',{body:restored,headers})).json;
  const replay=(await client.ok('/api/portal/orders/create',{body:restored,headers})).json;assert.equal(replay.orderId,created.orderId);
  const stateBefore=(await client.ok('/__fixture/state')).json,orderBefore=stateBefore.orders.find(row=>row.id===created.orderId),itemsBefore=stateBefore.items.filter(row=>row.order_id===created.orderId),collages=itemsBefore.filter(row=>row.collage_snapshot);
  assert.equal(orderBefore.subtotal_cents,mixed.priceCents);assert.equal(itemsBefore.length,3);assert.equal(collages.length,2);assert.ok(collages.every(row=>row.quantity===1&&row.sku===null));assert.notEqual(collages[0].collage_snapshot.placements[0].x,collages[1].collage_snapshot.placements[0].x);
  const outputPath=(item,order=created.orderId)=>`/api/dashboard/collages/production?orderId=${order}&itemId=${item.id}`;
  assert.equal((await client.request(outputPath(collages[0]),{token:config.ownerToken})).status,409);
  const checkout=(await client.ok('/api/stripe/checkout',{body:{orderId:created.orderId,parentLaneId:lanes[0].laneId},headers:{'x-studio-parent-session':'1'}})).json;
  const sessionId=checkout.sessionId||checkout.checkoutSessionId||checkout.url.split('/').at(-1);
  if(config.fixtureRevision>=2){
    const providerPage=await client.ok('/__fixture/provider/'+sessionId+'?fixtureReturnTo='+encodeURIComponent('http://localhost:3114/collage-e2e'));
    const script=providerPage.bytes.toString().match(/<script>([\s\S]*?)<\/script>/)?.[1],button={};assert.ok(script,'Fixture payment button has a parseable script binding.');
    new Function('document','fetch','location',script)({getElementById:()=>button},()=>{throw Error('Unexpected provider call before click');},{});assert.equal(typeof button.onclick,'function');
  }
  const receipt=(await client.ok('/__fixture/complete-payment',{body:{sessionId}})).json;assert.equal(receipt.receipt.notStripeTestMode,true);
  await client.ok('/__fixture/complete-payment',{body:{sessionId}});
  const paidState=(await client.ok('/__fixture/state')).json,paidOrder=paidState.orders.find(row=>row.id===created.orderId);assert.equal(paidOrder.payment_status,'paid');assert.ok(paidOrder.paid_at);
  if(paidState.webhooks)assert.equal(paidState.webhooks.find(row=>row.event_id==='evt_fixture_'+sessionId).status,'processed');
  if(paidState.paidEmails)assert.equal(paidState.paidEmails.filter(row=>row.order_id===created.orderId&&row.status==='pending').length,2);
  const production=[];
  for(const item of collages){const output=await client.ok(outputPath(item),{token:config.ownerToken});assert.equal(sha(output.bytes),output.headers.get('x-collage-sha256'));const metadata=await sharp(output.bytes).metadata();assert.equal(metadata.width,Math.round((stored.design.widthInches+2*(stored.design.bleedInches||0))*300));assert.equal(metadata.height,Math.round((stored.design.heightInches+2*(stored.design.bleedInches||0))*300));const filename=`production-${item.id}.png`;await writeFile(path.join(config.outputDirectory,filename),output.bytes);production.push({itemId:item.id,filename,sha256:sha(output.bytes),width:metadata.width,height:metadata.height});}
  assert.notEqual(production[0].sha256,production[1].sha256);
  const previewItem=collages.find(item=>item.collage_snapshot.placements[0].x===goodSelection.placements[0].x),previewOutput=production.find(output=>output.itemId===previewItem.id);
  const printPixels=await sharp(await readFile(path.join(config.outputDirectory,previewOutput.filename))).resize(previewMetadata.width,previewMetadata.height).flatten({background:'#ffffff'}).removeAlpha().raw().toBuffer();
  const previewPixels=await sharp(previewBytes).flatten({background:'#ffffff'}).removeAlpha().raw().toBuffer();
  assert.equal(printPixels.length,previewPixels.length);let difference=0;for(let index=0;index<printPixels.length;index++)difference+=Math.abs(printPixels[index]-previewPixels[index]);
  const previewMeanAbsoluteError=difference/printPixels.length;assert.ok(previewMeanAbsoluteError<8,`Preview and print raster diverged: ${previewMeanAbsoluteError}`);

  assert.equal((await client.request(outputPath(collages[0]),{token:config.foreignToken})).status,409);
  const archive=await client.ok('/api/dashboard/orders/download?ids='+created.orderId,{token:config.ownerToken});assert.equal(archive.bytes.readUInt32LE(),0x04034b50);await writeFile(path.join(config.outputDirectory,'order-production.zip'),archive.bytes);
  const zipped=storedZipEntries(archive.bytes),pngs=[...zipped].filter(([name])=>name.endsWith('.png'));assert.equal(pngs.length,2);assert.equal(new Set(pngs.map(([name])=>name)).size,2);assert.ok([...zipped.keys()].some(name=>name.endsWith('.jpg')),'Mixed archive retains its ordinary print.');
  for(const output of production){const [name,data]=pngs.find(([name])=>name.includes(output.itemId));assert.ok(name);assert.equal(sha(data),output.sha256);const manifest=JSON.parse([...zipped].find(([name])=>name.includes(output.itemId)&&name.endsWith('-production.json'))[1]);assert.equal(manifest.templateVersionId,versionId);assert.equal(manifest.placements.length,stored.design.slots.length);const recipe=collages.find(item=>item.id===output.itemId).collage_snapshot;assert.deepEqual(manifest.caption,recipe.caption);assert.deepEqual(manifest.placements,recipe.placements.map(({slotId,mediaId,zoom,x,y})=>({slotId,mediaId,zoom,x,y})));assert.equal(manifest.sha256,output.sha256);}
  const history=(await client.ok('/api/portal/orders/history',{body:{parentLaneId:lanes[0].laneId},headers:{'x-studio-parent-session':'1'}})).json;assert.ok(history.orders.some(row=>row.id===created.orderId));
  // Real combined checkout revalidates both cookie lanes and all nested media.
  const combinedBody={...common,groups:lanes.map((lane,index)=>({parentLaneId:lane.laneId,entries:[entryFor(index)]}))};
  const combined=(await client.ok('/api/portal/orders/create-combined',{body:combinedBody,headers:{'x-studio-parent-session':'1','Idempotency-Key':randomUUID()}})).json;
  const combinedCheckout=(await client.ok('/api/stripe/checkout',{body:{orderId:combined.primaryOrderId,parentLaneId:lanes[0].laneId},headers:{'x-studio-parent-session':'1'}})).json;
  const combinedSession=combinedCheckout.sessionId||combinedCheckout.checkoutSessionId||combinedCheckout.url.split('/').at(-1);await client.ok('/__fixture/complete-payment',{body:{sessionId:combinedSession}});
  const combinedState=(await client.ok('/__fixture/state')).json;for(const id of combined.orderIds){const order=combinedState.orders.find(row=>row.id===id);assert.equal(order.payment_status,'paid');assert.equal(combinedState.items.filter(row=>row.order_id===id&&row.collage_snapshot).length,2);}
  // Publish a same-size revision with a new price, then prove the paid order's
  // exact old recipe/price/raster survives and an authorized reorder retains it.
  const fresh=(await client.ok('/api/dashboard/collages/commerce',{token:config.ownerToken})).json;
  const updated=(await client.ok('/api/dashboard/collages/commerce',{token:config.ownerToken,body:{requestId:randomUUID(),catalogRevision:fresh.catalogRevision,templateId:stored.templateId,design:{...stored.design,name:'Updated after purchase',background:'#e8efff'},galleries:fresh.galleries.map(({kind,id})=>({kind,id})),product:{mode:'update',id:mixed.id,profileId:mixed.profileId,priceCents:mixed.priceCents+500,copyCount:2,itemIndex:mixed.items.findIndex(item=>item.collage)}}})).json;
  assert.notEqual(updated.version.id,versionId);const oldAgain=await client.ok(outputPath(collages[0]),{token:config.ownerToken});assert.equal(sha(oldAgain.bytes),production[0].sha256);
  const reordered=(await client.ok('/api/portal/orders/create',{body:{...common,parentLaneId:lanes[0].laneId,entries:[entryFor(0)]},headers:{'x-studio-parent-session':'1','Idempotency-Key':randomUUID(),'X-Checkout-Purchase':randomUUID()}})).json;
  const final=(await client.ok('/__fixture/state')).json,reorder=final.orders.find(row=>row.id===reordered.orderId);assert.equal(reorder.subtotal_cents,mixed.priceCents+500);assert.ok(final.items.filter(row=>row.order_id===reordered.orderId&&row.collage_snapshot).every(row=>row.collage_snapshot.templateVersionId===versionId));assert.equal(final.orders.find(row=>row.id===created.orderId).subtotal_cents,mixed.priceCents);
  const latest=(await client.ok('/api/portal/orders/create',{body:{...common,parentLaneId:lanes[0].laneId,entries:[entryFor(0,updated.version.id,updated.version.design)]},headers:{'x-studio-parent-session':'1','Idempotency-Key':randomUUID(),'X-Checkout-Purchase':randomUUID()}})).json;
  const latestState=(await client.ok('/__fixture/state')).json;assert.equal(latestState.orders.find(row=>row.id===latest.orderId).subtotal_cents,mixed.priceCents+500);assert.ok(latestState.items.filter(row=>row.order_id===latest.orderId&&row.collage_snapshot).every(row=>row.collage_snapshot.templateVersionId===updated.version.id));
  const paidOrders=final.orders.filter(order=>[created.orderId,...combined.orderIds].includes(order.id)).map(order=>({...order,items:final.items.filter(item=>item.order_id===order.id)}));
  await writeFile(path.join(config.outputDirectory,'native-config.json'),JSON.stringify({...config,paidOrders},null,2));
  Object.assign(results,{singleOrderId:created.orderId,combinedOrderIds:combined.orderIds,originalPriceCents:mixed.priceCents,newPriceCents:mixed.priceCents+500,originalVersionId:versionId,updatedVersionId:updated.version.id,production,previewMeanAbsoluteError,providerReceipt:receipt.receipt,nativeConfig:path.join(config.outputDirectory,'native-config.json')});
  await writeFile(path.join(config.outputDirectory,'http-e2e-receipt.json'),JSON.stringify(results,null,2));return results;
}
export async function runEventCollageScenario(config) {
  const client=fixtureClient(config);assert.ok(config.event);
  const publication=await publishFixtureProduct(config,client,{mixed:true}),stored=publication.version,product=publication.product;
  const denied=await client.request('/api/portal/session',{body:{...config.event.credentials,pin:'WRONG-EVENT-PIN'}});assert.equal(denied.status,404);
  const lane=(await client.ok('/api/portal/session',{body:config.event.credentials})).json;
  const frames=copy=>stored.design.slots.map((slot,index)=>({slotId:slot.id,mediaId:config.event.media[index%3].id,zoom:copy?1.3:1,x:copy?.2:.5,y:.5}));
  const selection=copy=>({version:1,templateVersionId:stored.id,placements:frames(copy),caption:{studentName:'Event Family',schoolName:'Fixture Event',year:'2026'}});
  const entry={packageId:product.id,quantity:1,price:1,slots:[{label:'Ordinary',assignedImageUrl:config.event.media[0].key},{label:'Collage 1',assignedImageUrl:null,collage:selection(0)},{label:'Collage 2',assignedImageUrl:null,collage:selection(1)}]};
  const body={parentLaneId:lane.laneId,mode:'event',parent:{name:'Fixture Event Parent',email:'parent@example.test'},delivery:{method:'pickup'},entries:[entry]};
  const malicious=structuredClone(body);malicious.entries[0].slots[1].collage.placements[0].mediaId=config.event.forbiddenMedia.id;
  assert.equal((await client.request('/api/portal/orders/create',{body:malicious,headers:{'x-studio-parent-session':'1'}})).status,409);
  assert.equal((await client.request('/api/portal/collages/preview',{body:{parentLaneId:lane.laneId,selection:malicious.entries[0].slots[1].collage}})).status,403);
  await client.ok('/api/portal/collages/preview',{body:{parentLaneId:lane.laneId,selection:selection(0)}});
  const order=(await client.ok('/api/portal/orders/create',{body,headers:{'x-studio-parent-session':'1','Idempotency-Key':randomUUID()}})).json;
  const checkout=(await client.ok('/api/stripe/checkout',{body:{orderId:order.orderId,parentLaneId:lane.laneId,mode:'event'},headers:{'x-studio-parent-session':'1'}})).json;
  const sessionId=checkout.sessionId||checkout.checkoutSessionId||checkout.url.split('/').at(-1);await client.ok('/__fixture/complete-payment',{body:{sessionId}});
  const state=(await client.ok('/__fixture/state')).json,paid=state.orders.find(row=>row.id===order.orderId),items=state.items.filter(row=>row.order_id===order.orderId);assert.equal(paid.project_id,config.event.credentials.galleryId);assert.equal(paid.payment_status,'paid');assert.equal(paid.total_cents,3100);assert.equal(items.length,3);
  const outputs=[];
  for(const item of items.filter(row=>row.collage_snapshot)){
    assert.ok(item.collage_snapshot.placements.every((placement,index)=>placement.mediaId===config.event.media[index%3].id&&placement.mediaKey===config.event.media[index%3].key));
    const output=await client.ok(`/api/dashboard/collages/production?orderId=${order.orderId}&itemId=${item.id}`,{token:config.ownerToken});outputs.push(sha(output.bytes));await writeFile(path.join(config.outputDirectory,'event-production-'+item.id+'.png'),output.bytes);
  }
  assert.equal(new Set(outputs).size,2);
  const result={version:1,orderId:order.orderId,projectId:paid.project_id,outputs,limitations:config.limitations,requests:client.requests};await writeFile(path.join(config.outputDirectory,'event-http-e2e-receipt.json'),JSON.stringify(result,null,2));return result;
}
if(process.argv[1]===new URL(import.meta.url).pathname){const config=JSON.parse(await readFile(process.argv[2],'utf8'));const result=await runCollageScenario(config,{publish:process.argv.includes('--publish')});console.log(JSON.stringify(result,null,2));}
