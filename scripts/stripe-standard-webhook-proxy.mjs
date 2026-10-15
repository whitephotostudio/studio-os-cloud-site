#!/usr/bin/env node
// Local test-delivery capture only. Never creates events or signatures and never
// connects to a production server. Actual Stripe platform proof is separate.
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHmac, createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
const FORMAT='stripe-cli-signed-test-delivery-v1';
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const accountPattern=/^acct_[A-Za-z0-9]+$/;
const HOLD_FORMAT='stripe-standard-first-paid-delivery-hold-v1';
const repository=fileURLToPath(new URL('../',import.meta.url));
const heldTypes=new Set(['payment_intent.succeeded','checkout.session.completed']);
export function assertPaidDeliveryHoldSpec(spec,{expectedPlatform,accountIds,now=Date.now()}){
  if(spec?.format!==HOLD_FORMAT||typeof spec.armed!=='boolean')fail('INVALID_PAID_HOLD_SPEC');
  if(!spec.armed)return null;
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if(expectedPlatform!=='acct_1UQo3XLkdaBBHhB9'||spec.platformId!==expectedPlatform
    ||!['acct_1UQoJJLghbZLnG5t','acct_1UQoJMQ9EOPSxHSm'].includes(spec.accountId)||!accountIds.includes(spec.accountId)
    ||spec.photographerId!=='d73f0153-7303-4ccf-873f-43f0fb7ab61b'||spec.userId!=='8ec853b6-8e33-4014-b17f-cbeb61a8d31b'
    ||!uuid.test(spec.holdId||'')||!uuid.test(spec.orderId||'')||!/^cs_test_[A-Za-z0-9]+$/.test(spec.sessionId||'')
    ||!['cad','usd'].includes(spec.currency)||![45,55].includes(spec.feeCents)||!Number.isSafeInteger(spec.amountCents)||spec.amountCents<=0||spec.amountCents>10000
    ||!Number.isFinite(Date.parse(spec.armedAt))||!Number.isFinite(Date.parse(spec.expiresAt))||Date.parse(spec.armedAt)>now+5000
    ||Date.parse(spec.expiresAt)<=Date.parse(spec.armedAt)||Date.parse(spec.expiresAt)-Date.parse(spec.armedAt)>600000)fail('INVALID_PAID_HOLD_SPEC');
  return spec;
}
export function matchingPaidDeliveryHold(event,spec,now=Date.now()){
  if(!spec||!heldTypes.has(event.type)||event.account!==spec.accountId||event.data?.object?.metadata?.order_id!==spec.orderId)return null;
  const object=event.data.object,metadata=object.metadata;
  if(now>Date.parse(spec.expiresAt))fail('PAID_HOLD_EXPIRED');
  if(event.livemode!==false||metadata.billing_flow!=='customer_order'||metadata.photographer_id!==spec.photographerId||metadata.order_group_id
    ||metadata.platform_fee_amount_cents!==String(spec.feeCents)||metadata.platform_fee_currency!==spec.currency||metadata.platform_fee_billable_order_count!=='1'
    ||object.currency!==spec.currency||(event.type==='payment_intent.succeeded'
      ?object.status!=='succeeded'||object.amount!==spec.amountCents||object.amount_received!==spec.amountCents||object.application_fee_amount!==spec.feeCents
      :object.id!==spec.sessionId||object.mode!=='payment'||object.status!=='complete'||object.payment_status!=='paid'||object.amount_total!==spec.amountCents||!/^pi_[A-Za-z0-9]+$/.test(typeof object.payment_intent==='string'?object.payment_intent:object.payment_intent?.id||'')))fail('PAID_HOLD_EVENT_SCOPE_MISMATCH');
  return spec;
}
function localOrigin(value){
  let url;try{url=new URL(value);}catch{fail('LOCAL_ORIGIN_REQUIRED');}
  if(url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!url.port)fail('LOCAL_ORIGIN_REQUIRED');
  return url;
}
async function privateDirectory(folder){await fs.mkdir(folder,{recursive:true,mode:0o700});const stat=await fs.lstat(folder);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid()))fail('PRIVATE_DIRECTORY_REQUIRED');return fs.realpath(folder);}
async function privateBytes(file){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid()))fail('PRIVATE_FILE_REQUIRED');return fs.readFile(file);}
async function signingSecret(file){const secret=(await privateBytes(file)).toString('utf8').trim();if(!/^whsec_[A-Za-z0-9]+$/.test(secret))fail('TEST_SIGNING_SECRET_REQUIRED');return secret;}
export function verifyOriginalSignature(raw,header,secret,now=Date.now()){
  if(!Buffer.isBuffer(raw)||typeof header!=='string')fail('INVALID_ORIGINAL_SIGNATURE');
  const parts=header.split(',').map(part=>part.split('=')),timestamps=parts.filter(([key])=>key==='t').map(([,value])=>value);
  if(timestamps.length!==1||!/^\d+$/.test(timestamps[0]))fail('INVALID_ORIGINAL_SIGNATURE');
  const timestamp=Number(timestamps[0]);
  if(!Number.isSafeInteger(timestamp)||Math.abs(now/1000-timestamp)>300)fail('ORIGINAL_SIGNATURE_EXPIRED');
  const expected=createHmac('sha256',secret).update(String(timestamp)+'.').update(raw).digest();
  const valid=parts.some(([key,value])=>key==='v1'&&/^[a-fA-F0-9]{64}$/.test(value||'')&&timingSafeEqual(expected,Buffer.from(value,'hex')));
  if(!valid)fail('INVALID_ORIGINAL_SIGNATURE');return timestamp;
}
function checkedEvent(raw,accountIds){
  let event;try{event=JSON.parse(raw.toString('utf8'));}catch{fail('INVALID_EVENT_JSON');}
  if(event?.livemode!==false)fail('LIVE_OR_UNKNOWN_MODE_FORBIDDEN');
  if(!/^evt_[A-Za-z0-9_]+$/.test(event.id||'')||typeof event.type!=='string'||!event.type||!event.data?.object)fail('INVALID_TEST_EVENT');
  const account=event.account||(event.type==='account.updated'?event.data.object.id:null);
  if(account&&(!accountPattern.test(account)||!accountIds.has(account)))fail('UNEXPECTED_TEST_CONNECTED_ACCOUNT');
  return event;
}
async function responseProof(response){const bytes=Buffer.from(await response.arrayBuffer());return {bytes,status:response.status,bodySha256:sha(bytes)};}
export async function startSignedWebhookProxy({listenOrigin='http://127.0.0.1:55431',upstreamOrigin,secretFile,stateDirectory,expectedPlatform,accountIds,holdFile,now=Date.now,fetcher=fetch,maxBodyBytes=2*1024*1024}){
  const listen=localOrigin(listenOrigin),upstream=localOrigin(upstreamOrigin);
  if(listen.origin===upstream.origin||!accountPattern.test(expectedPlatform||'')||!Array.isArray(accountIds)||accountIds.length<1||accountIds.some(id=>!accountPattern.test(id)))fail('EXPLICIT_TEST_SCOPE_REQUIRED');
  const permitted=new Set(accountIds),secret=await signingSecret(secretFile),state=await privateDirectory(stateDirectory);
  const readHold=async()=>{
    if(!holdFile)return null;
    const real=await fs.realpath(holdFile);if(real.startsWith(repository+path.sep))fail('PRIVATE_HOLD_FILE_REQUIRED');
    let spec;try{spec=JSON.parse((await privateBytes(holdFile)).toString('utf8'));}catch(error){if(error.code)throw error;fail('INVALID_PAID_HOLD_SPEC');}
    return assertPaidDeliveryHoldSpec(spec,{expectedPlatform,accountIds,now:now()});
  };
  await readHold();
  const upstreamUrl=new URL('/api/stripe/webhook',upstream).href;
  const server=createServer(async(req,res)=>{
    let captureId;
    try{
      if(req.method!=='POST'||req.url!=='/stripe-test-webhook'){res.writeHead(404);res.end();return;}
      const chunks=[];let length=0;
      for await(const chunk of req){length+=chunk.length;if(length>maxBodyBytes)fail('PAYLOAD_TOO_LARGE');chunks.push(chunk);}
      const raw=Buffer.concat(chunks),signature=req.headers['stripe-signature'];
      const timestamp=verifyOriginalSignature(raw,signature,secret,now());
      const event=checkedEvent(raw,permitted),hold=heldTypes.has(event.type)?matchingPaidDeliveryHold(event,await readHold(),now()):null;captureId=randomUUID();
      const record={format:FORMAT,captureId,receivedAt:new Date(now()).toISOString(),eventId:event.id,eventType:event.type,
        accountId:event.account??null,livemode:false,operatorPinnedPlatformId:expectedPlatform,
        platformIdentityProof:'separate genuine provider preflight required',signatureVerifiedAtCapture:true,originalTimestamp:timestamp,
        originalStripeSignature:signature,rawBodyBase64:raw.toString('base64'),rawBodySha256:sha(raw),upstreamUrl,
        deliveryDisposition:hold?'held_first_paid_delivery':'forwarded',upstreamAttempted:!hold};
      await fs.writeFile(path.join(state,`${captureId}.delivery.json`),JSON.stringify(record)+'\n',{flag:'wx',mode:0o600});
      if(hold){
        await fs.writeFile(path.join(state,`${captureId}.held.json`),JSON.stringify({captureId,holdId:hold.holdId,eventId:event.id,eventType:event.type,accountId:hold.accountId,
          orderId:hold.orderId,sessionId:hold.sessionId,heldAt:new Date(now()).toISOString(),originalSignatureExpiresAt:new Date((timestamp+300)*1000).toISOString(),
          cliAcknowledgedStatus:200,upstreamDelivered:false,actualNextStatus:null,rawBodySha256:sha(raw),resigned:false})+'\n',{flag:'wx',mode:0o600});
        res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,held:true,captureId,forwarded:false,actualNextStatus:null}));return;
      }
      const response=await fetcher(upstreamUrl,{method:'POST',headers:{'stripe-signature':signature,'content-type':req.headers['content-type']||'application/json'},body:raw,redirect:'error',signal:AbortSignal.timeout(60000)});
      const result=await responseProof(response);
      await fs.writeFile(path.join(state,`${captureId}.result.json`),JSON.stringify({captureId,completedAt:new Date(now()).toISOString(),upstreamStatus:result.status,responseBodySha256:result.bodySha256,forwardedRawBodySha256:sha(raw)})+'\n',{flag:'wx',mode:0o600});
      res.writeHead(result.status,{'content-type':'application/json'});res.end(result.bytes);
    }catch(error){
      const code=/^[A-Z_]{3,90}$/.test(error.code||'')?error.code:'LOCAL_FORWARD_FAILED';
      if(captureId){try{await fs.writeFile(path.join(state,`${captureId}.failure.json`),JSON.stringify({captureId,code,failedAt:new Date(now()).toISOString()})+'\n',{flag:'wx',mode:0o600});}catch{}}
      const status=code==='PAYLOAD_TOO_LARGE'?413:code==='LOCAL_FORWARD_FAILED'?503:400;
      if(!res.headersSent)res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,code}));
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(listen.port),listen.hostname.replace(/^\[|\]$/g,''),resolve);});
  const actualListen=new URL(listen);actualListen.port=String(server.address().port);
  return {server,listenUrl:new URL('/stripe-test-webhook',actualListen).href,stateDirectory:state,upstreamUrl,
    close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
export async function replayOriginalDelivery({recordFile,secretFile,upstreamOrigin,accountIds,expectedPlatform,now=Date.now,fetcher=fetch}){
  const upstream=localOrigin(upstreamOrigin),secret=await signingSecret(secretFile);
  if(!accountPattern.test(expectedPlatform||'')||!Array.isArray(accountIds)||!accountIds.length||accountIds.some(id=>!accountPattern.test(id)))fail('EXPLICIT_TEST_SCOPE_REQUIRED');
  let record;try{record=JSON.parse((await privateBytes(recordFile)).toString('utf8'));}catch(error){if(error.code)throw error;fail('INVALID_CAPTURE_RECORD');}
  if(record.format!==FORMAT||record.signatureVerifiedAtCapture!==true||record.livemode!==false||record.operatorPinnedPlatformId!==expectedPlatform)fail('INVALID_CAPTURE_RECORD');
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.captureId||''))fail('INVALID_CAPTURE_RECORD');
  const raw=Buffer.from(record.rawBodyBase64||'','base64');if(sha(raw)!==record.rawBodySha256)fail('CAPTURE_BODY_HASH_MISMATCH');
  const timestamp=verifyOriginalSignature(raw,record.originalStripeSignature,secret,now());
  const event=checkedEvent(raw,new Set(accountIds));
  if(event.id!==record.eventId||event.type!==record.eventType||timestamp!==record.originalTimestamp)fail('CAPTURE_EVENT_IDENTITY_MISMATCH');
  const response=await fetcher(new URL('/api/stripe/webhook',upstream).href,{method:'POST',headers:{'stripe-signature':record.originalStripeSignature,'content-type':'application/json'},body:raw,redirect:'error',signal:AbortSignal.timeout(60000)});
  const result=await responseProof(response);
  const directory=await privateDirectory(path.dirname(recordFile)),replayId=randomUUID(),proof={captureId:record.captureId,replayId,completedAt:new Date(now()).toISOString(),
    source:'original_signature_replay',upstreamStatus:result.status,responseBodySha256:result.bodySha256,forwardedRawBodySha256:sha(raw),originalSignatureReused:true,resigned:false};
  const replayProofFile=path.join(directory,`${record.captureId}.replay-${replayId}.result.json`);
  await fs.writeFile(replayProofFile,JSON.stringify(proof)+'\n',{flag:'wx',mode:0o600});
  try{await fs.writeFile(path.join(directory,`${record.captureId}.result.json`),JSON.stringify(proof)+'\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
  return {ok:result.status>=200&&result.status<300,eventId:event.id,upstreamStatus:result.status,originalRawBodySha256:sha(raw),originalSignatureReused:true,resigned:false,
    replayProofFile,
    warning:'A stored capture proves original observation; replay only succeeds inside the original signature tolerance. Use durable event recovery for older deliveries.'};
}
function parseArgs(args){const result={};for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||!args[i+1])fail('INVALID_ARGUMENTS');result[args[i].slice(2)]=args[i+1];}return result;}
async function main(){
  const mode=process.argv[2],args=parseArgs(process.argv.slice(3));
  const options={upstreamOrigin:args['upstream-origin'],secretFile:args['secret-file'],expectedPlatform:args['expected-platform'],accountIds:(args['account-ids']||'').split(',').filter(Boolean)};
  if(mode==='serve'){
    const proxy=await startSignedWebhookProxy({...options,listenOrigin:args['listen-origin'],stateDirectory:args['state-dir'],holdFile:args['hold-file']});
    console.log(JSON.stringify({ok:true,listening:proxy.listenUrl,upstream:proxy.upstreamUrl,stateDirectory:proxy.stateDirectory,signatureRewriting:false,liveEventsForbidden:true,paidDeliveryHoldConfigured:Boolean(args['hold-file'])}));
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>proxy.close().then(()=>process.exit(0)));
  }else if(mode==='replay')console.log(JSON.stringify(await replayOriginalDelivery({...options,recordFile:args.record})));
  else fail('INVALID_MODE');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify({ok:false,code:/^[A-Z_]{3,90}$/.test(error.code||'')?error.code:'SIGNED_TEST_PROXY_FAILED'}));process.exitCode=1;});
