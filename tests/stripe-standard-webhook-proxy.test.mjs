import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHmac, createHash } from 'node:crypto';
import { startSignedWebhookProxy, replayOriginalDelivery, assertPaidDeliveryHoldSpec } from '../scripts/stripe-standard-webhook-proxy.mjs';
const secret='whsec_SYNTHETICUNITFIXTURE';
const pinned='acct_testsandbox',connected='acct_testmerchant';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const body=patch=>Buffer.from(JSON.stringify({id:'evt_unitfixture',type:'payment_intent.succeeded',account:connected,livemode:false,data:{object:{id:'pi_unitfixture',metadata:{billing_flow:'customer_order'}}},...patch},null,2));
const signature=(raw,seconds=Math.floor(Date.now()/1000))=>`t=${seconds},v1=${createHmac('sha256',secret).update(String(seconds)+'.').update(raw).digest('hex')}`;
async function fixture(t,options={}){
  const directory=await fs.mkdtemp('/tmp/stripe-standard-proxy-unit-');await fs.chmod(directory,0o700);t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const secretFile=path.join(directory,'unit-secret.txt');await fs.writeFile(secretFile,secret,{mode:0o600});
  let holdFile;if(options.holdSpec){holdFile=path.join(directory,'paid-hold.json');await fs.writeFile(holdFile,JSON.stringify(options.holdSpec),{mode:0o600});}
  const calls=[];
  const settings={listenOrigin:'http://127.0.0.1:0',upstreamOrigin:'http://localhost:55430',secretFile,stateDirectory:path.join(directory,'captures'),expectedPlatform:pinned,accountIds:[connected],
    fetcher:async(url,request)=>{calls.push({url,request});if(options.failUpstream)throw Error('synthetic upstream interruption');return new Response('{"ok":true}',{status:options.upstreamStatus||200});},...(holdFile?{holdFile}:{}),...options};
  const proxy=await startSignedWebhookProxy(settings);t.after(()=>proxy.close());
  const send=(raw=body(),header=signature(raw))=>fetch(proxy.listenUrl,{method:'POST',headers:{'stripe-signature':header,'content-type':'application/json'},body:raw});
  return {directory,secretFile,holdFile,calls,settings,proxy,send};
}

test('proxy forwards original signed TEST bytes unchanged and privately captures observation plus upstream result',async t=>{
  const f=await fixture(t),raw=body(),header=signature(raw);
  const result=await f.send(raw,header);assert.equal(result.status,200);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].url,'http://localhost:55430/api/stripe/webhook');assert.ok(f.calls[0].request.body.equals(raw));
  assert.equal(f.calls[0].request.headers['stripe-signature'],header);assert.equal(f.calls[0].request.redirect,'error');
  const files=await fs.readdir(f.proxy.stateDirectory),recordFile=path.join(f.proxy.stateDirectory,files.find(name=>name.endsWith('.delivery.json')));
  const record=JSON.parse(await fs.readFile(recordFile,'utf8'));assert.equal(record.rawBodySha256,digest(raw));assert.equal(record.originalStripeSignature,header);
  assert.ok(Buffer.from(record.rawBodyBase64,'base64').equals(raw));assert.equal(record.signatureVerifiedAtCapture,true);assert.equal(record.livemode,false);
  assert.equal((await fs.stat(recordFile)).mode&0o077,0);assert.equal((await fs.stat(f.proxy.stateDirectory)).mode&0o077,0);
  assert.equal(record.platformIdentityProof,'separate genuine provider preflight required');assert.equal(JSON.stringify(record).includes(secret),false);
});

test('invalid signatures, live/unknown modes and foreign connected accounts never forward or create evidence',async t=>{
  const f=await fixture(t);
  for(const [raw,header]of [[body(),'t=1,v1='+'a'.repeat(64)],...[
    body({livemode:true}),body({livemode:undefined}),body({account:'acct_othermerchant'}),body({id:'not-provider-event'})
  ].map(raw=>[raw,signature(raw)])]){
    assert.equal((await f.send(raw,header)).status,400);
  }
  assert.equal(f.calls.length,0);assert.deepEqual(await fs.readdir(f.proxy.stateDirectory),[]);
});

test('an interrupted or rejected Next response retains signed capture without claiming successful processing',async t=>{
  for(const options of [{upstreamStatus:503},{failUpstream:true}]){
    const f=await fixture(t,options);assert.equal((await f.send()).status,503);
    const files=await fs.readdir(f.proxy.stateDirectory);assert.equal(files.filter(name=>name.endsWith('.delivery.json')).length,1);
    if(options.failUpstream)assert.equal(files.filter(name=>name.endsWith('.failure.json')).length,1);
    else{const proof=JSON.parse(await fs.readFile(path.join(f.proxy.stateDirectory,files.find(name=>name.endsWith('.result.json'))),'utf8'));assert.equal(proof.upstreamStatus,503);}
  }
});

test('HTTP replay preserves the original signature and cannot re-sign a delayed event beyond its original tolerance',async t=>{
  const f=await fixture(t),raw=body(),header=signature(raw);await f.send(raw,header);
  const recordFile=path.join(f.proxy.stateDirectory,(await fs.readdir(f.proxy.stateDirectory)).find(name=>name.endsWith('.delivery.json')));
  const replay=await replayOriginalDelivery({...f.settings,recordFile});assert.equal(replay.ok,true);assert.equal(replay.resigned,false);assert.equal(replay.originalSignatureReused,true);
  assert.ok(f.calls[1].request.body.equals(raw));assert.equal(f.calls[1].request.headers['stripe-signature'],header);
  await assert.rejects(()=>replayOriginalDelivery({...f.settings,recordFile,now:()=>Date.now()+301000}),/EXPIRED/);
  assert.equal(f.calls.length,2);
  const record=JSON.parse(await fs.readFile(recordFile,'utf8'));record.rawBodyBase64=body({id:'evt_changed'}).toString('base64');await fs.writeFile(recordFile,JSON.stringify(record),{mode:0o600});
  await assert.rejects(()=>replayOriginalDelivery({...f.settings,recordFile}),/HASH_MISMATCH/);
});

test('only loopback HTTP forwarding, private secrets and explicitly pinned sandbox account scopes are accepted',async t=>{
  const f=await fixture(t);
  for(const upstreamOrigin of ['https://studiooscloud.com','http://192.168.0.5:55430','http://localhost:55430/other']){
    await assert.rejects(()=>startSignedWebhookProxy({...f.settings,upstreamOrigin}),/LOCAL_ORIGIN_REQUIRED/);
  }
  await assert.rejects(()=>startSignedWebhookProxy({...f.settings,expectedPlatform:''}),/EXPLICIT_TEST_SCOPE_REQUIRED/);
  await fs.chmod(f.secretFile,0o644);await assert.rejects(()=>startSignedWebhookProxy(f.settings),/PRIVATE_FILE_REQUIRED/);
});

test('oversized bodies stop before signature capture and local forwarding',async t=>{
  const f=await fixture(t,{maxBodyBytes:10});assert.equal((await f.send()).status,413);assert.equal(f.calls.length,0);assert.deepEqual(await fs.readdir(f.proxy.stateDirectory),[]);
});

function paidHold(patch={}){const now=Date.now();return{format:'stripe-standard-first-paid-delivery-hold-v1',armed:true,holdId:'10000000-0000-4000-8000-000000000001',
  platformId:'acct_1UQo3XLkdaBBHhB9',accountId:'acct_1UQoJMQ9EOPSxHSm',photographerId:'d73f0153-7303-4ccf-873f-43f0fb7ab61b',userId:'8ec853b6-8e33-4014-b17f-cbeb61a8d31b',
  orderId:'20000000-0000-4000-8000-000000000001',sessionId:'cs_test_unitSession',currency:'cad',feeCents:45,amountCents:3000,armedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),...patch};}
function heldEvent(spec,type='payment_intent.succeeded',patch={}){const metadata={billing_flow:'customer_order',order_id:spec.orderId,photographer_id:spec.photographerId,
  platform_fee_amount_cents:String(spec.feeCents),platform_fee_currency:spec.currency,platform_fee_billable_order_count:'1'};
  return body({id:type==='payment_intent.succeeded'?'evt_heldPI':'evt_heldCS',type,account:spec.accountId,data:{object:type==='payment_intent.succeeded'
    ?{id:'pi_heldTest',status:'succeeded',amount:spec.amountCents,amount_received:spec.amountCents,currency:spec.currency,application_fee_amount:spec.feeCents,metadata,...patch}
    :{id:spec.sessionId,mode:'payment',status:'complete',payment_status:'paid',amount_total:spec.amountCents,currency:spec.currency,payment_intent:'pi_heldTest',metadata,...patch}}});
}
const holdOptions=spec=>({holdSpec:spec,expectedPlatform:spec.platformId,accountIds:[spec.accountId]});

test('default-off hold leaves ordinary forwarding intact and armed hold validates exact owned sandbox scope',async t=>{
  const spec=paidHold(),f=await fixture(t,holdOptions({...spec,armed:false}));assert.equal((await f.send(heldEvent(spec))).status,200);assert.equal(f.calls.length,1);
  for(const patch of [{platformId:'acct_1TBlT4PxlnWeytFA'},{accountId:'acct_foreign'},{userId:'foreign'},{feeCents:0},{amountCents:10001},{expiresAt:new Date(Date.now()+900000).toISOString()}]){
    assert.throws(()=>assertPaidDeliveryHoldSpec({...spec,...patch},{expectedPlatform:spec.platformId,accountIds:[spec.accountId]}),/INVALID_PAID_HOLD_SPEC/);
  }
});

test('armed single order holds both genuine paid event types without any actual Next success claim',async t=>{
  const spec=paidHold(),f=await fixture(t,holdOptions(spec));
  for(const type of ['payment_intent.succeeded','checkout.session.completed']){
    const response=await f.send(heldEvent(spec,type));assert.equal(response.status,200);const json=await response.json();assert.equal(json.held,true);assert.equal(json.forwarded,false);assert.equal(json.actualNextStatus,null);
  }
  assert.equal(f.calls.length,0);const files=await fs.readdir(f.proxy.stateDirectory);assert.equal(files.filter(n=>n.endsWith('.delivery.json')).length,2);assert.equal(files.filter(n=>n.endsWith('.held.json')).length,2);assert.equal(files.filter(n=>n.endsWith('.result.json')).length,0);
  for(const name of files.filter(n=>n.endsWith('.held.json'))){const h=JSON.parse(await fs.readFile(path.join(f.proxy.stateDirectory,name),'utf8'));assert.equal(h.upstreamDelivered,false);assert.equal(h.actualNextStatus,null);assert.equal(h.resigned,false);assert.equal((await fs.stat(path.join(f.proxy.stateDirectory,name))).mode&0o077,0);}
});

test('held order refunds and another paid order still reach actual Next with their unchanged signatures',async t=>{
  const spec=paidHold(),f=await fixture(t,holdOptions(spec)),refund=body({id:'evt_actualRefund',type:'charge.refunded',account:spec.accountId,data:{object:{id:'ch_original',payment_intent:'pi_heldTest'}}});
  const another=JSON.parse(heldEvent(spec));another.data.object.metadata.order_id='30000000-0000-4000-8000-000000000001';const other=Buffer.from(JSON.stringify(another));
  for(const raw of [refund,other]){const header=signature(raw);assert.equal((await f.send(raw,header)).status,200);assert.ok(f.calls.at(-1).request.body.equals(raw));assert.equal(f.calls.at(-1).request.headers['stripe-signature'],header);}
  assert.equal(f.calls.length,2);assert.equal((await fs.readdir(f.proxy.stateDirectory)).filter(n=>n.endsWith('.held.json')).length,0);
});

test('matching held order with changed fee/session/group or expired arm cannot silently pass upstream',async t=>{
  const spec=paidHold(),f=await fixture(t,holdOptions(spec));
  for(const raw of [heldEvent(spec,'payment_intent.succeeded',{application_fee_amount:55}),heldEvent(spec,'checkout.session.completed',{id:'cs_test_different'}),heldEvent(spec,'payment_intent.succeeded',{metadata:{...JSON.parse(heldEvent(spec)).data.object.metadata,order_group_id:'not-single'}})])assert.equal((await f.send(raw)).status,400);
  const expired={...spec,armedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()-1000).toISOString()};await fs.writeFile(f.holdFile,JSON.stringify(expired),{mode:0o600});assert.equal((await f.send(heldEvent(spec))).status,400);assert.equal(f.calls.length,0);
});

test('first release of a held original delivery writes actual HTTP result proof and refuses stale re-signing',async t=>{
  const spec=paidHold(),f=await fixture(t,holdOptions(spec)),raw=heldEvent(spec),header=signature(raw);await f.send(raw,header);
  const recordFile=path.join(f.proxy.stateDirectory,(await fs.readdir(f.proxy.stateDirectory)).find(n=>n.endsWith('.delivery.json')));
  const result=await replayOriginalDelivery({...f.settings,recordFile});assert.equal(result.ok,true);assert.equal(result.resigned,false);assert.equal(f.calls.length,1);assert.ok(f.calls[0].request.body.equals(raw));assert.equal(f.calls[0].request.headers['stripe-signature'],header);
  const resultFile=recordFile.replace('.delivery.json','.result.json'),actual=JSON.parse(await fs.readFile(resultFile,'utf8'));
  assert.equal(actual.upstreamStatus,200);assert.equal(actual.source,'original_signature_replay');assert.equal(actual.forwardedRawBodySha256,digest(raw));assert.equal(actual.originalSignatureReused,true);assert.equal(actual.resigned,false);assert.equal((await fs.stat(resultFile)).mode&0o077,0);
  assert.equal(JSON.parse(await fs.readFile(result.replayProofFile,'utf8')).upstreamStatus,200);
  await assert.rejects(replayOriginalDelivery({...f.settings,recordFile,now:()=>Date.now()+301000}),/EXPIRED/);assert.equal(f.calls.length,1);
});

test('configured hold file must remain private and can be explicitly disarmed without changing captures',async t=>{
  const spec=paidHold(),f=await fixture(t,holdOptions(spec));await fs.writeFile(f.holdFile,JSON.stringify({format:spec.format,armed:false}),{mode:0o600});assert.equal((await f.send(heldEvent(spec))).status,200);assert.equal(f.calls.length,1);
  await fs.chmod(f.holdFile,0o644);assert.equal((await f.send(heldEvent(spec))).status,400);assert.equal(f.calls.length,1);
});
