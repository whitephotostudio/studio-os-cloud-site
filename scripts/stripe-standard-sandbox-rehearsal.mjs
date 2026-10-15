/**
 * Explicit, resumable real Stripe TEST rehearsal. Never loaded by prebuild.
 * Example (no secret in arguments):
 * node scripts/stripe-standard-sandbox-rehearsal.mjs --phase prepare \
 *   --key-file /private/config.toml --expected-platform acct_TEST \
 *   --state-dir /private/studio-standard-test
 *
 * `prepare` creates synthetic accounts/onboarding links. Complete their TEST
 * onboarding, then `payments`. Hosted sessions require a real browser test
 * checkout; `verify-hosted` reads their actual final provider state. `listen`
 * accepts only Stripe CLI signed deliveries and executes the actual helpers.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, statSync, chmodSync, existsSync, realpathSync, openSync,closeSync,fsyncSync,renameSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { openStandardSandboxDatabase } from '../tests/helpers/standard-sandbox-db.mjs';

const require = createRequire(import.meta.url);
const repository = fileURLToPath(new URL('../', import.meta.url));
const liveAccounts = new Set(['acct_1TBlT4PxlnWeytFA','acct_1TIHTrLqg5vdCgpU','acct_1UQHR5LZhEC2SlmP','acct_1QGuOtIy738lmoke']);
const loopback = new Set(['localhost','127.0.0.1','[::1]','::1']);
const secretPattern = /(?:[sr]k_(?:test|live)_[A-Za-z0-9_]+|rkcs_test_[A-Za-z0-9_]+|whsec_[A-Za-z0-9]+|pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+)/g;
export const redactSandboxError = value => String(value).replace(secretPattern,'[redacted]');

export function assertSandboxConfiguration({key,expectedPlatform,origin='http://127.0.0.1:43115',database='http://127.0.0.1:54321'}, environment={}) {
  if (!/^(?:sk_test_|rkcs_test_)[A-Za-z0-9_]+$/.test(key||'') || !/^acct_[A-Za-z0-9]+$/.test(expectedPlatform||'') || liveAccounts.has(expectedPlatform)) {
    throw Error('A genuine isolated Stripe TEST key and exact approved TEST platform are required.');
  }
  for (const address of [origin,database]) {
    let parsed;try{parsed=new URL(address);}catch{throw Error('Only explicit loopback test addresses are allowed.');}
    if (!loopback.has(parsed.hostname)||parsed.protocol!=='http:'||parsed.username||parsed.password) throw Error('Only explicit loopback test addresses are allowed.');
  }
  for (const name of ['STRIPE_SECRET_KEY','STRIPE_TEST_SECRET_KEY']) {
    if (environment[name] && environment[name] !== key) throw Error('An ambient Stripe credential conflicts with the explicit test key.');
  }
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL','SUPABASE_URL','DATABASE_URL']) {
    if (!environment[name])continue;
    let hostname;try{hostname=new URL(environment[name]).hostname;}catch{throw Error('An ambient database is unverified.');}
    if(!loopback.has(hostname))throw Error('An ambient production database is forbidden.');
  }
  if (environment.VERCEL_ENV || environment.VERCEL || environment.NODE_ENV==='production') throw Error('The rehearsal cannot execute in a deployed/production runtime.');
  return {key,expectedPlatform,origin,database};
}

export function readProtectedTestKey(path, expectedPlatform) {
  const full=realpathSync(path), info=statSync(full);
  if(!info.isFile()||(info.mode&0o077)!==0||info.uid!==process.getuid?.())throw Error('The explicit test credential file must be owned by this user and mode0600.');
  if(full===repository||full.startsWith(repository+sep))throw Error('Test credentials must stay outside the repository.');
  const contents=readFileSync(full,'utf8');
  const direct=contents.trim();
  const key=/^(?:sk_test_|rkcs_test_)[A-Za-z0-9_]+$/.test(direct)?direct:contents.match(/^\s*(?:test_mode_api_key|testmode_api_key|test_key|STRIPE_SECRET_KEY)\s*=\s*"((?:sk_test_|rkcs_test_)[A-Za-z0-9_]+)"\s*$/m)?.[1];
  const account=contents.match(/^\s*(?:account_id|test_mode_account_id)\s*=\s*"(acct_[A-Za-z0-9]+)"\s*$/m)?.[1];
  if(account&&account!==expectedPlatform)throw Error('The credential file belongs to another Stripe test platform.');
  assertSandboxConfiguration({key,expectedPlatform});
  return key;
}

export function readProtectedLocalSupabase(path) {
  const full=realpathSync(path),info=statSync(full);
  if(!info.isFile()||(info.mode&0o077)!==0||info.uid!==process.getuid?.()||full.startsWith(repository+sep))throw Error('Local Supabase configuration must be private and outside the repository.');
  const entries={};
  for(const line of readFileSync(full,'utf8').split('\n')){
    const match=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(!match)continue;
    let value=match[2].trim();if(value.startsWith('"')&&value.endsWith('"'))value=value.slice(1,-1);entries[match[1]]=value;
  }
  if(Object.keys(entries).some(name=>name.startsWith('STRIPE_')&&name.includes('KEY')))throw Error('Local Supabase configuration must not contain a Stripe credential.');
  const database=entries.NEXT_PUBLIC_SUPABASE_URL,origin=entries.NEXT_PUBLIC_APP_URL;
  for(const address of [database,origin]){
    const url=new URL(address);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password)throw Error('Genuine Supabase rehearsal requires explicit isolated loopback addresses.');
  }
  if(database!=='http://127.0.0.1:55421'||origin!=='http://127.0.0.1:55430')throw Error('The exact isolated Supabase/API and Next.js origins must be pinned.');
  if(!entries.SUPABASE_SERVICE_ROLE_KEY||!entries.NEXT_PUBLIC_SUPABASE_ANON_KEY)throw Error('Both genuine local Supabase keys are required.');
  return{database,origin,serviceKey:entries.SUPABASE_SERVICE_ROLE_KEY,anonKey:entries.NEXT_PUBLIC_SUPABASE_ANON_KEY};
}

export function createGuardedSandboxProvider({key,expectedPlatform,fetchImpl=globalThis.fetch,onRequest=()=>{},maxPosts=100}) {
  assertSandboxConfiguration({key,expectedPlatform});
  const allowedAccounts=new Set();let verifiedAt=0,posts=0;
  const raw=async(path,{method='GET',account,body,idempotencyKey,stripeVersion='2025-06-30.basil'}={})=>{
    if(!/^(?:account|balance|accounts(?:\/[A-Za-z0-9_]+)?|account_links|checkout\/sessions(?:\/[A-Za-z0-9_]+(?:\/expire)?)?|payment_intents(?:\/[A-Za-z0-9_]+(?:\/confirm)?)?|charges\/[A-Za-z0-9_]+|refunds|application_fees\/[A-Za-z0-9_]+(?:\/refunds)?|events(?:\/[A-Za-z0-9_]+)?)$/.test(path.split('?')[0])) throw Error('Provider path is outside the bounded test rehearsal.');
    if(!['GET','POST'].includes(method))throw Error('Destructive provider operations are forbidden.');
    if(account&&(!allowedAccounts.has(account)||liveAccounts.has(account)))throw Error('This connected account is not owned by the isolated rehearsal.');
    if(method==='POST'){
      if(Date.now()-verifiedAt>300_000)throw Error('Fresh exact Stripe TEST platform/balance proof is required before provider writes.');
      if(!idempotencyKey?.startsWith('studio-standard-test-'))throw Error('A durable rehearsal idempotency key is required.');
      if(++posts>maxPosts)throw Error('The bounded rehearsal write budget was exhausted.');
      if(path==='accounts'&&(!['standard','express'].includes(body?.get('type'))||!body?.get('email')?.endsWith('@example.test')||!body?.get('metadata[studio_standard_rehearsal]')))throw Error('Only identified synthetic rehearsal accounts can be created.');
      if(path==='account_links'&&!allowedAccounts.has(body?.get('account')))throw Error('Onboarding is restricted to owned test accounts.');
      if(/^(payment_intents|checkout\/sessions|refunds)$/.test(path)&&!account)throw Error('Direct test payments require their owned connected account.');
      if(path.startsWith('application_fees/')&&account)throw Error('Platform fee operations must be platform scoped.');
      if(body?.get('customer_email')&&!body.get('customer_email').endsWith('@example.test'))throw Error('Real customer email is forbidden.');
      for(const field of ['success_url','cancel_url','return_url','refresh_url']){
        if(!body?.get(field))continue;
        const url=new URL(body.get(field));
        if(url.protocol!=='http:'||!loopback.has(url.hostname))throw Error('Test redirects must stay on loopback.');
      }
    }
    if(!/^\d{4}-\d{2}-\d{2}(?:\.[a-z]+)?$/.test(stripeVersion))throw Error('Invalid explicit Stripe API version.');
    const headers={Authorization:`Bearer ${key}`,'Stripe-Version':stripeVersion,...(account?{'Stripe-Account':account}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})};
    const result=await fetchImpl(`https://api.stripe.com/v1/${path}`,{method,headers,body:body?.toString(),signal:AbortSignal.timeout(20_000)});
    const json=await result.json();
    onRequest({method,path:path.split('?')[0],account:account||expectedPlatform,requestId:result.headers?.get?.('request-id')||null,status:result.status,idempotentReplayed:result.headers?.get?.('idempotent-replayed')||null,originalRequest:result.headers?.get?.('original-request')||null,...(json.error?{errorCode:json.error.code??null,errorParam:json.error.param??null}:{})});
    if(!result.ok)throw Error(redactSandboxError((json.error?.message||`Stripe test request failed (${result.status}).`)+(json.error?.param?` [parameter: ${json.error.param}]`:'')));
    if(json.livemode===true)throw Error('Stripe returned a live object during the test rehearsal.');
    return json;
  };
  const preflight=async()=>{
    const platform=await raw('account');
    if(platform.id!==expectedPlatform)throw Error('Stripe TEST platform identity differs from the exact approved account.');
    const balance=await raw('balance');
    if(balance.object!=='balance'||balance.livemode!==false)throw Error('Explicit Stripe TEST balance proof is missing.');
    verifiedAt=Date.now();return{platformId:platform.id,livemode:false,verifiedAt:new Date(verifiedAt).toISOString()};
  };
  const adopt=async(id,runId)=>{
    if(!/^acct_[A-Za-z0-9]+$/.test(id)||liveAccounts.has(id)||id===expectedPlatform)throw Error('Invalid rehearsal account.');
    const account=await raw(`accounts/${id}`);
    if(account.metadata?.studio_standard_rehearsal!==runId||!account.email?.endsWith('@example.test'))throw Error('Connected account is not owned by this synthetic rehearsal.');
    allowedAccounts.add(id);return account;
  };
  // Actual app helpers call fetch. Keep their request encoding and validate the
  // destination, exact credential, owning account and idempotency independently.
  const guardedFetch=async(url,options={})=>{
    const parsed=new URL(url);
    if(parsed.origin!=='https://api.stripe.com'||!parsed.pathname.startsWith('/v1/'))throw Error('Only the real Stripe TEST API is allowed.');
    const h=new Headers(options.headers);
    if(h.get('authorization')!==`Bearer ${key}`)throw Error('An app helper attempted to use another credential.');
    const result=await raw(parsed.pathname.slice(4)+parsed.search,{method:options.method||'GET',account:h.get('stripe-account')||undefined,body:options.body?new URLSearchParams(options.body):undefined,idempotencyKey:h.get('idempotency-key')||undefined,stripeVersion:h.get('stripe-version')||undefined});
    return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
  };
  return {request:raw,preflight,adopt,guardedFetch,allowedAccounts};
}

export function loadActualApplication(service) {
  const cache=new Map();
  const noExternalEffect=async()=>{};
  const overrides={
    '@/lib/dashboard-auth':{createDashboardServiceClient:()=>service},
    '@/lib/studio-os-app':{syncPhotographyKeysByPhotographerId:noExternalEffect},
    '@/lib/credit-maintenance':{creditMaintenanceActive:()=>false},
    '@/lib/paid-order-emails':{schedulePaidOrderEmails:noExternalEffect},
    '@/lib/order-push':{sendNewOrderPush:noExternalEffect},
    '@/lib/admin-notification-center':{notifyOwnerForSetting:noExternalEffect},
    '@/lib/owner-notifications':{ownerUrl:()=>''},'@/lib/resend':{resendConfigured:()=>false},
    '@/lib/order-refund-notifications':{scheduleOrderRefundEmails:noExternalEffect},
  };
  const load=name=>{
    if(name in overrides)return overrides[name];
    if(!name.startsWith('@/'))return require(name);
    if(cache.has(name))return cache.get(name);
    const exports={};cache.set(name,exports);
    const filename=resolve(repository,`${name.slice(2)}.ts`);
    const code=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','exports','module',code)((dependency)=>{
      if(!dependency.startsWith('.'))return load(dependency);
      const dependencyPath=resolve(dirname(filename),dependency).replace(/\.ts$/,'');
      if(!dependencyPath.startsWith(repository))throw Error('Unexpected application module path.');
      return load('@/'+dependencyPath.slice(repository.length));
    },exports,{exports});
    return exports;
  };
  return {payments:load('@/lib/payments'),history:load('@/lib/stripe-connect-history'),refund:load('@/lib/direct-order-fee-refund'),merchant:load('@/lib/stripe-merchant-webhook'),customer:load('@/lib/customer-order-webhook')};
}

const persist=(path,value)=>{
  const temporary=`${path}.${randomUUID()}.tmp`,fd=openSync(temporary,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temporary,path);chmodSync(path,0o600);
  const directory=openSync(dirname(path),'r');try{fsyncSync(directory);}finally{closeSync(directory);}
};
async function startSignedWebhookReceiver({secretFile,app,provider,proof,proofPath,save,service}) {
  const info=statSync(secretFile);
  if((info.mode&0o077)!==0||info.uid!==process.getuid?.())throw Error('Webhook signing-secret file must be private.');
  const secret=readFileSync(secretFile,'utf8').trim();if(!/^whsec_[A-Za-z0-9]+$/.test(secret))throw Error('Invalid explicit test webhook secret.');
  const processEvent=async event=>{
    const merchantResult=await app.merchant.processStripeMerchantEvent(service,event);
    if(merchantResult)return merchantResult;
    if(app.customer.isCustomerOrderStripeEvent(event))return app.customer.processCustomerOrderStripeEvent(service,event);
    return{ok:true,status:200,ignored:true};
  };
  const server=createServer(async(req,res)=>{
    let record;
    try{
      if(req.method!=='POST'||req.url!=='/stripe-test-webhook'){res.writeHead(404);res.end();return;}
      const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>1_000_000)throw Error('Webhook exceeds local bounded payload limit.');chunks.push(chunk);}
      const payload=Buffer.concat(chunks).toString('utf8');
      if(!await app.payments.verifyStripeSignature(payload,String(req.headers['stripe-signature']||''),[secret])){res.writeHead(400);res.end('Invalid Stripe signature');return;}
      const event=JSON.parse(payload);if(event.livemode!==false)throw Error('Live webhook payload is forbidden.');
      if(event.account&&!provider.allowedAccounts.has(event.account))throw Error('Webhook connected account is outside this rehearsal.');
      record={id:event.id,type:event.type,account:event.account??null,signatureVerified:true,receivedAt:new Date().toISOString(),payload};proof.webhooks.push(record);save();
      const result=await processEvent(event);record.result=result;record.processed=result.ok;save();res.writeHead(result.status);res.end(JSON.stringify(result));
    }catch(error){if(record){record.error=redactSandboxError(error.message);save();}res.writeHead(503);res.end(redactSandboxError(error.message));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(43115,'127.0.0.1',resolve);});
  process.stdout.write(JSON.stringify({listening:'http://127.0.0.1:43115/stripe-test-webhook',proofPath})+'\n');
  return{server,processEvent};
}
const waitForReceiverStop=server=>new Promise(resolve=>{
  const stop=()=>server.close(resolve);process.once('SIGTERM',stop);process.once('SIGINT',stop);
});
function privateStateDirectory(path) {
  const full=resolve(path);
  if(full===repository||full.startsWith(repository+sep))throw Error('Rehearsal state must be outside the repository.');
  mkdirSync(full,{recursive:true,mode:0o700});
  const info=statSync(full);
  if(!info.isDirectory()||(info.mode&0o077)!==0||info.uid!==process.getuid?.())throw Error('Rehearsal state directory must be owned by this user and mode0700.');
  const canonical=realpathSync(full);
  if(canonical===repository||canonical.startsWith(repository+sep))throw Error('Rehearsal state must stay outside the repository.');
  return canonical;
}

export async function runRehearsal(options) {
  const key=readProtectedTestKey(options.keyFile,options.expectedPlatform);
  const localEnvFile=options.supabaseEnvFile||options.localEnvFile;
  const localSupabase=localEnvFile?readProtectedLocalSupabase(localEnvFile):null;
  const deliveryMode=options.webhookDeliveryMode||(options.webhookSecretFile?'internal':'none');
  if(!['external','internal','none'].includes(deliveryMode)||deliveryMode==='external'&&options.webhookSecretFile)throw Error('Select exactly one explicit webhook delivery mode.');
  const config=assertSandboxConfiguration({key,expectedPlatform:options.expectedPlatform,...(localSupabase?{database:localSupabase.database,origin:localSupabase.origin}:{})},process.env);
  const stateDir=privateStateDirectory(options.stateDir),proofPath=resolve(stateDir,'proof.json');
  const proof=existsSync(proofPath)?JSON.parse(readFileSync(proofPath,'utf8')):{version:1,runId:randomUUID(),platformId:config.expectedPlatform,photographerId:randomUUID(),userId:randomUUID(),accounts:{},cases:{},requests:[],webhooks:[],checks:[]};
  assert.equal(proof.platformId,config.expectedPlatform);assert.equal(proof.version,1);
  const save=()=>persist(proofPath,proof);
  const provider=createGuardedSandboxProvider({...config,onRequest:request=>{proof.requests.push({...request,at:new Date().toISOString()});save();}});
  proof.testIdentity=await provider.preflight();save();
  for(const id of Object.values(proof.accounts))await provider.adopt(id,proof.runId);
  process.env.STRIPE_SECRET_KEY=key;
  process.env.NEXT_PUBLIC_SUPABASE_URL=config.database;
  process.env.STRIPE_STANDARD_MIGRATION_ENABLED='true';
  process.env.STUDIO_STANDARD_SANDBOX_PLATFORM_VERIFIED='true';
  process.env.STUDIO_STANDARD_SANDBOX_EXPECTED_PLATFORM_ACCOUNT_ID=config.expectedPlatform;
  process.env.STUDIO_GALLERY_PRICING_V3_ENABLED='1';
  const originalFetch=globalThis.fetch;
  // The isolated Supabase client captures the original local HTTP transport;
  // actual application Stripe helpers use the separately guarded API fetch.
  const fixture=['prepare','status','refresh-express-link','refresh-standard-link'].includes(options.phase)?{db:null,service:null,migrations:[]}:localSupabase?{
    db:null,service:createClient(localSupabase.database,localSupabase.serviceKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:originalFetch}}),migrations:[],
  }:await openStandardSandboxDatabase(resolve(stateDir,'pglite'));
  const {db,service}=fixture,app=service?loadActualApplication(service):null;
  if(service){
    const transport={kind:localSupabase?'genuine_local_supabase_http':'embedded_postgresql',...(localSupabase?{url:localSupabase.database}:{})};
    if(proof.transport&&proof.transport.kind!==transport.kind&&Object.keys(proof.cases).length)throw Error('Cannot replace a payment rehearsal database after creating payment cases.');
    proof.transport=transport;
    proof.databaseKind=localSupabase?'actualSupabase':'PGlite';
    proof.webhookDeliveryMode=deliveryMode;
    if(db)proof.appliedMigrations=fixture.migrations;
    else{const{data,error}=await service.rpc('stripe_account_history_schema_status');if(error)throw Error('Genuine local Supabase Stripe history schema is unavailable.');proof.localSchema=data;}
    save();
  }
  globalThis.fetch=provider.guardedFetch;
  const opKey=label=>`studio-standard-test-${proof.runId}-${label}`;
  const result=async query=>{const value=await query;if(value.error)throw value.error;return value.data;};
  const savedOrders=ids=>result(service.from('orders').select('*').in('id',ids).order('id'));
  const updateOrders=(ids,value)=>result(service.from('orders').update(value).in('id',ids));
  const checked=async(label,work)=>{const result=await work();proof.checks.push({label,at:new Date().toISOString(),result:result??true});save();return result;};
  let receiver;
  try {
    if(['refresh-express-link','refresh-standard-link'].includes(options.phase)){
      const type=options.phase==='refresh-express-link'?'express':'standard';
      const account=await provider.adopt(proof.accounts[type],proof.runId);assert.equal(account.type,type);
      const refreshId=randomUUID();
      const params={account:account.id,type:'account_onboarding',return_url:'http://localhost:55430/sign-in?stripe_test_onboarding=returned',refresh_url:'http://localhost:55430/sign-in?stripe_test_onboarding=refresh'};
      proof[`${type}LinkRefresh`]={id:refreshId,params,preparedAt:new Date().toISOString()};save();
      const link=await provider.request('account_links',{method:'POST',body:new URLSearchParams(params),idempotencyKey:opKey(`${type}-link-refresh-${refreshId}`)});
      proof[`${type}Onboarding`]={url:link.url,expiresAt:link.expires_at};save();
      return{phase:options.phase,accountId:account.id,proofPath,chargesEnabled:account.charges_enabled,payoutsEnabled:account.payouts_enabled,expiresAt:link.expires_at};
    }
    if(options.phase==='status'){
      const readiness={};
      for(const[type,id]of Object.entries(proof.accounts)){
        const account=await provider.adopt(id,proof.runId);
        const requirementCounts=object=>Object.fromEntries(['currently_due','eventually_due','past_due','pending_verification','errors'].map(name=>[name,Array.isArray(object?.[name])?object[name].length:null]));
        readiness[type]={accountId:id,type:account.type,chargesEnabled:account.charges_enabled,payoutsEnabled:account.payouts_enabled,detailsSubmitted:account.details_submitted,feesPayer:account.controller?.fees?.payer,capabilities:account.capabilities,requirements:requirementCounts(account.requirements),futureRequirements:requirementCounts(account.future_requirements)};
      }
      proof.freshReadiness={at:new Date().toISOString(),accounts:readiness};save();return{phase:'status',platformId:proof.platformId,readiness,proofPath};
    }
    if(options.phase==='prepare'){
      let retryGenerationConsumed=false;
      for(const type of ['express','standard']){
        if(!proof.accounts[type]){
          proof.accountCreationParams??={};
          const previousParams=Boolean(proof.accountCreationParams[type]);
          proof.accountCreationParams[type]??={type,country:'CA',email:`studio-standard-${proof.runId}-${type}@example.test`,'metadata[studio_standard_rehearsal]':proof.runId,'metadata[photographer_id]':proof.photographerId,'metadata[user_id]':proof.userId,'business_profile[name]':'Studio OS disposable TEST rehearsal','business_profile[mcc]':'7333','capabilities[card_payments][requested]':'true','capabilities[transfers][requested]':'true'};
          if(proof.accountCreationParams[type]['business_profile[url]']){
            const lastAccountRequest=proof.requests.filter(row=>row.path==='accounts'&&row.method==='POST').at(-1);
            if(lastAccountRequest?.status!==400||lastAccountRequest.errorParam!=='business_profile[url]')throw Error('Cannot change an uncertain account-creation payload.');
            delete proof.accountCreationParams[type]['business_profile[url]'];
            proof.checks.push({label:'provider400 business_profile URL validation rejected before account creation; optional URL omitted under new v3 key',type});
          }
          proof.accountCreationGeneration??={};
          proof.accountCreationGeneration[type]??=3;
          if(options.retryDefinitive400==='yes'&&previousParams&&!retryGenerationConsumed){
            const lastAccountRequest=proof.requests.filter(row=>row.path==='accounts'&&row.method==='POST').at(-1);
            if(lastAccountRequest?.status!==400||proof.accountCreationGeneration[type]!==3)throw Error('A new creation key is allowed only after the approved definitive400/no-account Connect setup failure.');
            proof.accountCreationGeneration[type]=4;retryGenerationConsumed=true;
            proof.checks.push({label:'Parent-approved fresh v4 creation key after definitive400/no-object and completed sandbox EnableConnect',type,previousRequestId:lastAccountRequest.requestId});
          }
          save();
          const body=new URLSearchParams(proof.accountCreationParams[type]);
          const account=await provider.request('accounts',{method:'POST',body,idempotencyKey:opKey(`account-${type}-v${proof.accountCreationGeneration[type]}`)});
          proof.accounts[type]=account.id;save();await provider.adopt(account.id,proof.runId);
        }
        const account=await provider.adopt(proof.accounts[type],proof.runId);
        proof[`${type}Readiness`]={chargesEnabled:account.charges_enabled,payoutsEnabled:account.payouts_enabled,requirements:account.requirements,controller:account.controller};save();
        if(!account.charges_enabled||!account.payouts_enabled){
          const link=await provider.request('account_links',{method:'POST',body:new URLSearchParams({account:account.id,type:'account_onboarding',return_url:config.origin+'/onboarded',refresh_url:config.origin+'/onboarding-refresh'}),idempotencyKey:opKey(`onboard-${type}-${Math.floor(Date.now()/3_600_000)}`)});
          proof[`${type}Onboarding`]={url:link.url,expiresAt:link.expires_at};save();
        }
      }
      return {phase:'prepare',platformId:proof.platformId,accounts:proof.accounts,proofPath,needsTestOnboarding:!proof.standardReadiness?.chargesEnabled||!proof.expressReadiness?.chargesEnabled};
    }
    const old=await provider.adopt(proof.accounts.express,proof.runId),standard=await provider.adopt(proof.accounts.standard,proof.runId);
    assert.equal(old.type,'express');assert.equal(standard.type,'standard');
    if(!old.charges_enabled||!old.payouts_enabled||!standard.charges_enabled||!standard.payouts_enabled)throw Error('Both synthetic accounts must complete genuine TEST onboarding before the payment rehearsal.');
    assert.equal(standard.controller?.fees?.payer,'account');assert.equal(standard.controller?.losses?.payments,'stripe');
    await result(service.from('photographers').upsert({id:proof.photographerId,user_id:proof.userId,business_country:'CA',stripe_connect_country:'CA',stripe_account_id:old.id,stripe_connected_account_id:old.id,stripe_connect_onboarding_complete:true,stripe_connect_charges_enabled:true,stripe_connect_payouts_enabled:true,is_platform_admin:false,subscription_plan_code:'core',subscription_status:'active'},{onConflict:'id',ignoreDuplicates:true}));
    const photographer=await result(service.from('photographers').select('*').eq('id',proof.photographerId).maybeSingle());
    assert.equal(photographer?.user_id,proof.userId,'The synthetic Auth photographer must match the immutable rehearsal owner.');
    const existingAccount=photographer.stripe_connected_account_id||photographer.stripe_account_id;
    if(!existingAccount){
      assert.ok(!photographer.stripe_standard_migrated_at,'A migrated test merchant cannot be silently reinitialized.');
      await result(service.from('photographers').update({stripe_account_id:old.id,stripe_connected_account_id:old.id,stripe_connect_country:'CA',stripe_connect_onboarding_complete:true,stripe_connect_charges_enabled:true,stripe_connect_payouts_enabled:true}).eq('id',proof.photographerId).eq('user_id',proof.userId));
      proof.checks.push({label:'first synthetic Express route initialized without altering existing subscription fields',accountId:old.id});save();
    }else assert.ok([old.id,standard.id].includes(existingAccount),'The test merchant already routes to another account.');
    for(const account of [old,standard])await app.history.registerStripeAccountCandidate(service,{photographerId:proof.photographerId,userId:proof.userId,account,livemode:false});
    if(deliveryMode==='internal'&&options.webhookSecretFile)receiver=await startSignedWebhookReceiver({secretFile:options.webhookSecretFile,app,provider,proof,proofPath,save,service});

    async function makeCase(label,{plan='core',currency='cad',count=1,waived=false,waivedIndex=null,route}={}){
      let c=proof.cases[label];
      if(!c){c={label,plan,currency,orderIds:Array.from({length:count},()=>randomUUID()),groupId:count>1?randomUUID():null,waived,totalCents:3000*count};proof.cases[label]=c;save();}
      const quote=await app.payments.quoteDirectOrderPlatformFees({pricingProfile:'gallery_v3',planCode:plan,subscriptionStatus:'active',isPlatformAdmin:false,currency,orders:c.orderIds.map((id,index)=>({id,totalCents:3000,isTest:waived||index===waivedIndex,feeScope:label.includes('school')?'production':'gallery'}))});
      assert.equal(quote.rateCents,waived?0:plan==='starter'?55:45);
      for(let i=0;i<c.orderIds.length;i++)await result(service.from('orders').upsert({id:c.orderIds[i],photographer_id:proof.photographerId,order_group_id:c.groupId,total_cents:3000,currency,platform_fee_collection_method:quote.orders[i].collectionMethod,platform_fee_amount_cents:quote.orders[i].amountCents,platform_fee_currency:currency,platform_fee_rate_cents:quote.rateCents},{onConflict:'id',ignoreDuplicates:true}));
      const rows=await savedOrders(c.orderIds);
      const fee=app.payments.directOrderPlatformFeePayload(rows,currency);
      const routing=await app.history.getCheckoutRouting(service,{photographerId:proof.photographerId,currency,orderId:c.orderIds[0]});
      if(route)assert.equal(routing.accountId,route);
      const reservation=await app.history.reserveOrderPaymentAccount(service,{photographerId:proof.photographerId,orderIds:c.orderIds,anchorOrderId:c.orderIds[0],expectedAccountId:routing.accountId,expectedRouteVersion:routing.routeVersion,amountCents:c.totalCents,currency,idempotencyKey:opKey(label),requestHash:createHash('sha256').update(JSON.stringify({label,fee,orders:c.orderIds})).digest('hex')});
      c.accountId=reservation.accountId;c.attemptId=reservation.attemptId;c.fee=fee;save();
      return {c,fee,reservation,rows};
    }
    async function hosted(label,input){
      const {c,fee,reservation}=await makeCase(label,input);
      const session=await app.payments.createDirectOrderCheckoutSession({accountId:c.accountId,orderId:c.orderIds[0],photographerId:proof.photographerId,currency:c.currency,totalCents:c.totalCents,productName:'Disposable TEST photos',description:`Synthetic ${label}`,successUrl:config.origin+'/success',cancelUrl:config.origin+'/cancel',customerEmail:`parent-${proof.runId}@example.test`,orderGroupId:c.groupId,platformFee:fee,idempotencyKey:reservation.idempotencyKey});
      assert.equal(session.livemode,false);assert.equal(session.amount_total,c.totalCents);
      c.sessionId=session.id;c.sessionUrl=session.url;save();
      await app.history.bindOrderPaymentReferences(service,{attemptId:c.attemptId,checkoutSessionId:session.id,paymentIntentId:session.payment_intent});
      await updateOrders(c.orderIds,{stripe_checkout_session_id:session.id,status:'payment_pending'});
      return c;
    }
    async function paidIntent(label,input){
      const {c,fee,reservation}=await makeCase(label,input);
      const metadata={billing_flow:'customer_order',order_id:c.orderIds[0],photographer_id:proof.photographerId,...(c.groupId?{order_group_id:c.groupId}:{}),...app.payments.directOrderPlatformFeeMetadata(fee)};
      const body=new URLSearchParams({amount:String(c.totalCents),currency:c.currency,'payment_method_types[0]':'card',payment_method:'pm_card_visa',confirm:'true',description:`Synthetic TEST ${label}`});
      for(const[k,v]of Object.entries(metadata))body.set(`metadata[${k}]`,v);
      if(fee.amountCents)body.set('application_fee_amount',String(fee.amountCents));
      let intent=await provider.request('payment_intents',{method:'POST',account:c.accountId,body,idempotencyKey:reservation.idempotencyKey});
      if(label==='standard-interrupted'&&!c.intentId){
        // Drop the accepted response before app/database acknowledgement,
        // then repeat the byte-identical provider request under its saved key.
        const firstId=intent.id;
        intent=await provider.request('payment_intents',{method:'POST',account:c.accountId,body,idempotencyKey:reservation.idempotencyKey});
        assert.equal(intent.id,firstId,'Stripe must replay the original accepted test payment, not create another.');
        proof.checks.push({label:'real provider accepted-reply interruption replays the same test PaymentIntent',paymentIntentId:intent.id,accountId:c.accountId});save();
      }
      assert.equal(intent.livemode,false);assert.equal(intent.status,'succeeded');
      // PI-only payments are provider/fee probes, not evidence that hosted
      // Checkout completed. Their immutable provider reference is still real.
      // The application checkout binder correctly requires a real Session.
      // PI-only provider probes append only real PI/charge references through
      // the service fixture; they never invent a Checkout Session reference.
      await result(service.from('order_payment_accounts').update({payment_intent_id:intent.id,charge_id:intent.latest_charge,state:'completed'}).eq('id',c.attemptId));
      await updateOrders(c.orderIds,{stripe_payment_intent_id:intent.id,status:'paid',payment_status:'paid',paid_at:new Date().toISOString()});
      c.intentId=intent.id;c.chargeId=intent.latest_charge;save();
      const verifiedFee=await app.payments.verifyDirectOrderPlatformFeePayment(service,{orderIds:c.orderIds,paymentIntentId:intent.id});
      assert.equal(verifiedFee.amountCents,fee.amountCents);
      let charge=await provider.request(`charges/${c.chargeId}`,{account:c.accountId});
      assert.equal(charge.amount,c.totalCents);assert.equal(charge.application_fee_amount||0,fee.amountCents);
      if(fee.amountCents){
        // Stripe may attach the asynchronous platform-fee object shortly
        // after confirming the charge. Poll only its immutable GET reference.
        for(let retry=0;!charge.application_fee&&retry<12;retry++){
          await new Promise(resolve=>setTimeout(resolve,250));
          charge=await provider.request(`charges/${c.chargeId}`,{account:c.accountId});
        }
        const feeId=typeof charge.application_fee==='string'?charge.application_fee:charge.application_fee?.id;
        assert.ok(feeId,'The actual application-fee object is not yet available; retry the same persisted test case.');
        const actualFee=await provider.request(`application_fees/${feeId}`);
        assert.equal(actualFee.account,c.accountId);assert.equal(actualFee.charge,c.chargeId);assert.equal(actualFee.amount,fee.amountCents);assert.equal(actualFee.currency,c.currency);
        c.applicationFeeId=actualFee.id;c.actualCollectedCents=actualFee.amount;
      }else assert.equal(charge.application_fee,null);
      c.providerPaymentVerified=true;save();return c;
    }

    if(options.phase==='payments'){
      if(!proof.cases['old-express-open']?.sessionId)await checked('old Express hosted checkout remains open before cutover',()=>hosted('old-express-open',{plan:'starter',route:old.id}));
      if(!proof.cases['old-express-paid']?.providerPaymentVerified)await checked('original Express actual Gallery55 collection',()=>paidIntent('old-express-paid',{plan:'starter',route:old.id}));
      let routing=await app.history.getCheckoutRouting(service,{photographerId:proof.photographerId,currency:'cad'});
      if(routing.accountId===old.id)await checked('actual SQL Standard activation preserves Express open/paid reservations',()=>app.history.activateStandardAccount(service,{photographerId:proof.photographerId,userId:proof.userId,accountId:standard.id,expectedCurrentAccountId:old.id,livemode:false}));
      assert.equal((await app.history.getCheckoutRouting(service,{photographerId:proof.photographerId,currency:'usd'})).accountId,standard.id);
      for(const currency of ['cad','usd'])for(const plan of ['starter','core','studio'])for(const kind of ['gallery','event','school']){
        const label=`standard-${plan}-${kind}-${currency}`;
        if(!proof.cases[label]?.providerPaymentVerified)await checked(`real Standard ${plan} ${currency} ${kind} collection`,()=>paidIntent(label,{plan,currency,route:standard.id}));
      }
      if(!proof.cases['standard-group-usd']?.providerPaymentVerified)await checked('two persisted grouped orders collect two Gallery55 fees',()=>paidIntent('standard-group-usd',{plan:'starter',currency:'usd',count:2,route:standard.id}));
      if(!proof.cases['standard-group-mixed-usd']?.providerPaymentVerified)await checked('mixed grouped order collects only its billable Gallery55 member',()=>paidIntent('standard-group-mixed-usd',{plan:'starter',currency:'usd',count:2,waivedIndex:1,route:standard.id}));
      if(!proof.cases['standard-waived']?.providerPaymentVerified)await checked('waived test order collects no application fee',()=>paidIntent('standard-waived',{waived:true,route:standard.id}));
      if(!proof.cases['new-standard-hosted']?.sessionId)await checked('actual Standard Checkout helper creates Gallery55 frozen session',()=>hosted('new-standard-hosted',{plan:'starter',route:standard.id}));
      // Replay the accepted-but-unacknowledged provider request, then prove
      // stale requested routing cannot change its immutable account binding.
      const interrupted=await paidIntent('standard-interrupted',{plan:'core',route:standard.id});
      await checked('lost-reply retry retains original Standard account and idempotency',async()=>{
        const reserved=await app.history.reserveOrderPaymentAccount(service,{photographerId:proof.photographerId,orderIds:interrupted.orderIds,anchorOrderId:interrupted.orderIds[0],expectedAccountId:old.id,expectedRouteVersion:0,amountCents:interrupted.totalCents,currency:'cad',idempotencyKey:opKey('standard-interrupted'),requestHash:createHash('sha256').update(JSON.stringify({label:'standard-interrupted',fee:interrupted.fee,orders:interrupted.orderIds})).digest('hex')});
        assert.equal(reserved.accountId,standard.id);assert.equal(reserved.paymentIntentId,interrupted.intentId);return{accountId:reserved.accountId,paymentIntentId:reserved.paymentIntentId};
      });
      for(const label of ['old-express-paid','standard-starter-gallery-cad','standard-core-event-usd']){
        const c=proof.cases[label];if(c.refundComplete)continue;
        await checked(`${label}: partial then full customer/application fee refunds`,async()=>{
          let currentCharge=await provider.request(`charges/${c.chargeId}`,{account:c.accountId});
          if(currentCharge.amount_refunded===0){
            await provider.request('refunds',{method:'POST',account:c.accountId,idempotencyKey:opKey(`${label}-partial`),body:new URLSearchParams({payment_intent:c.intentId,amount:'1000',refund_application_fee:'false'})});
            currentCharge=await provider.request(`charges/${c.chargeId}`,{account:c.accountId});
          }
          if(currentCharge.amount_refunded<c.totalCents){
            assert.equal(currentCharge.amount_refunded,1000,'Only the original bounded synthetic partial refund may precede full recovery.');
            const before=await provider.request(`application_fees/${c.applicationFeeId}`);assert.equal(before.amount_refunded,0);
            await app.payments.reconcileOrderRefundFromStripe(service,c.accountId,c.intentId);
            assert.equal((await savedOrders([c.orderIds[0]]))[0].payment_status,'partially_refunded');
            await provider.request('refunds',{method:'POST',account:c.accountId,idempotencyKey:opKey(`${label}-full`),body:new URLSearchParams({payment_intent:c.intentId,amount:String(c.totalCents-1000),refund_application_fee:'false'})});
          }
          const intent=await provider.request(`payment_intents/${c.intentId}`,{account:c.accountId});
          const charge=await provider.request(`charges/${c.chargeId}`,{account:c.accountId});
          const orders=await savedOrders(c.orderIds);
          // Actual recovery helper uses a fixed platform idempotency prefix;
          // permit only its exact operation through our test request adapter.
          const recoveryRequest=(path,settings={})=>provider.request(path,{...settings,idempotencyKey:settings.idempotencyKey?opKey(settings.idempotencyKey):undefined});
          const fee=await app.refund.completeDirectOrderApplicationFeeRefund({orders,account:c.accountId,payment:intent,charge},recoveryRequest);
          assert.equal(fee.fullyRefunded,true);
          await app.payments.reconcileOrderRefundFromStripe(service,c.accountId,c.intentId);
          assert.equal((await savedOrders([c.orderIds[0]]))[0].payment_status,'refunded');
          c.refundComplete=true;save();return{accountId:c.accountId,feeRefundedCents:fee.fee.amount_refunded};
        });
      }
      proof.paymentRehearsalComplete=true;save();
      const result={phase:'payments',proofPath,databaseKind:proof.databaseKind,webhookDeliveryMode:deliveryMode,actualFees:Object.values(proof.cases).filter(c=>c.intentId).map(c=>({case:c.label,currency:c.currency,fee:c.actualCollectedCents??0,account:c.accountId})),hostedCompletionPending:['old-express-open','new-standard-hosted'].filter(label=>!proof.cases[label]?.hostedComplete)};
      if(receiver){process.stdout.write(JSON.stringify({...result,receiverHeldUntilSignal:true})+'\n');await waitForReceiverStop(receiver.server);}
      return result;
    }
    if(options.phase==='verify-hosted'){
      for(const label of ['old-express-open','new-standard-hosted']){
        const c=proof.cases[label];if(!c?.sessionId)throw Error('Run payments to create the bounded hosted TEST sessions first.');
        const session=await provider.request(`checkout/sessions/${c.sessionId}`,{account:c.accountId});
        if(session.status!=='complete'||session.payment_status!=='paid')throw Error(`The ${label} genuine hosted TEST checkout has not completed.`);
        const intentId=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
        assert.ok(intentId);await app.history.bindOrderPaymentReferences(service,{attemptId:c.attemptId,checkoutSessionId:c.sessionId,paymentIntentId:intentId});
        await updateOrders(c.orderIds,{stripe_payment_intent_id:intentId});
        await app.payments.finalizePaidOrderOrGroup(service,{orderId:c.orderIds[0],checkoutSessionId:c.sessionId,paymentIntentId:intentId,paymentStatus:'paid',note:'Genuine hosted Stripe TEST checkout verified.'});
        const actualFee=await app.payments.verifyDirectOrderPlatformFeePayment(service,{orderIds:c.orderIds,paymentIntentId:intentId});assert.equal(actualFee.amountCents,55);
        c.intentId=intentId;c.hostedComplete=true;save();
      }
      return{phase:'verify-hosted',proofPath,oldExpressCompletionAfterCutover:true,newStandardCompletion:true};
    }
    if(options.phase==='listen'){
      if(!receiver)throw Error('A mode0600 Stripe CLI webhook signing-secret file is required.');
      await waitForReceiverStop(receiver.server);
      return{phase:'listen',proofPath,signedDeliveries:proof.webhooks.length};
    }
    if(options.phase==='replay-events'){
      const process=async event=>await app.merchant.processStripeMerchantEvent(service,event)??await app.customer.processCustomerOrderStripeEvent(service,event);
      const stored=proof.webhooks.filter(row=>row.signatureVerified&&row.processed).slice().reverse();
      if(!stored.length)throw Error('No actual signed Stripe CLI deliveries have been captured.');
      for(const row of stored){
        const event=JSON.parse(row.payload);
        if(!app.merchant.isStripeMerchantEvent(event)&&!app.customer.isCustomerOrderStripeEvent(event))continue;
        const duplicate=await process(event);assert.equal(duplicate.ok,true);assert.equal(duplicate.duplicate,true);
        proof.checks.push({label:'delayed/duplicate replay of stored provider-signed event',eventId:event.id,type:event.type,result:duplicate});save();
      }
      return{phase:'replay-events',proofPath,providerSignedEventsReplayed:stored.length};
    }
    if(options.phase==='verify-events'){
      if(!localSupabase||deliveryMode!=='external')throw Error('Actual Next.js webhook verification requires the pinned genuine Supabase service and external delivery mode.');
      const events=await result(service.from('stripe_events').select('*').eq('livemode',false));
      const cases=Object.values(proof.cases).filter(c=>c.intentId);
      let verified=0;
      for(const c of cases){
        const deliveries=events.filter(event=>event.stripe_account===c.accountId&&event.payload?.data?.object?.id===c.intentId&&event.event_type==='payment_intent.succeeded');
        if(!deliveries.length)throw Error(`Actual Next.js payment webhook has not durably completed for ${c.label}.`);
        for(const delivery of deliveries){
          let event;try{event=await provider.request(`events/${delivery.id}`);}catch{event=await provider.request(`events/${delivery.id}`,{account:c.accountId});}
          assert.equal(event.id,delivery.id);assert.equal(event.type,delivery.event_type);assert.equal(event.livemode,false);
          assert.equal(event.data?.object?.id,c.intentId);assert.equal(event.data.object.metadata?.photographer_id,proof.photographerId);
          assert.equal(event.data.object.currency,c.currency);assert.equal(event.data.object.amount,c.totalCents);
          const ledger=await result(service.from('customer_order_webhooks').select('*').eq('event_id',delivery.id).maybeSingle());
          assert.equal(ledger?.status,'processed');assert.equal(ledger?.stripe_account_id,c.accountId);
          const duplicate=await app.customer.processCustomerOrderStripeEvent(service,delivery.payload);assert.equal(duplicate.ok,true);assert.equal(duplicate.duplicate,true);
          proof.checks.push({label:'actual Next.js webhook durable completion correlated to original provider TEST event; duplicate replay harmless',eventId:delivery.id,paymentIntentId:c.intentId,accountId:c.accountId});save();verified++;
        }
      }
      proof.externalNextWebhookEvidence={providerEventsCorrelated:verified,databaseKind:'actualSupabase',nextOrigin:localSupabase.origin,signatureDeliveryEvidence:'Root must retain actual Stripe CLI HTTP delivery log and signing-secret configuration proof separately.'};save();
      return{phase:'verify-events',proofPath,databaseKind:'actualSupabase',providerEventsCorrelated:verified};
    }
    if(options.phase==='rollback'){
      await checked('rollback changes only future routing; original Standard and Express payments resolve',async()=>{
        await app.history.rollbackStandardAccount(service,{photographerId:proof.photographerId,userId:proof.userId,accountId:old.id,expectedCurrentAccountId:standard.id,livemode:false});
        assert.equal((await app.history.getCheckoutRouting(service,{photographerId:proof.photographerId,currency:'cad'})).accountId,old.id);
        for(const c of Object.values(proof.cases).filter(c=>c.intentId))assert.equal(await app.history.resolveOrderPaymentAccount(service,{photographerId:proof.photographerId,orderId:c.orderIds[0],paymentIntentId:c.intentId}),c.accountId);
      });
      proof.rollbackVerified=true;save();return{phase:'rollback',proofPath};
    }
    throw Error('Unknown rehearsal phase.');
  } finally {if(receiver?.server.listening)await new Promise(resolve=>receiver.server.close(resolve));globalThis.fetch=originalFetch;await db?.close();}
}

export function parseRehearsalArguments(values) {
  const allowed=new Set(['phase','key-file','expected-platform','state-dir','supabase-env-file','local-env-file','webhook-delivery-mode','webhook-secret-file','retry-definitive-400']);
  const args={};
  for(let i=0;i<values.length;i+=2){
    const flag=values[i];
    if(!flag?.startsWith('--')||!allowed.has(flag.slice(2))||!values[i+1]||values[i+1].startsWith('--'))throw Error('Explicit recognized rehearsal arguments are required.');
    const name=flag.slice(2).replace(/-([a-z0-9])/g,(_,c)=>c.toUpperCase());
    if(name in args)throw Error('Duplicate rehearsal arguments are forbidden.');args[name]=values[i+1];
  }
  return args;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=parseRehearsalArguments(process.argv.slice(2));
  runRehearsal(args).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error=>{process.stderr.write(redactSandboxError(error.message)+'\n');process.exitCode=1;});
}
