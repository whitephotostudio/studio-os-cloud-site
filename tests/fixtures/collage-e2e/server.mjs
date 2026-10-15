// Isolated local protocol fixture. Nothing in this module is imported by app routes.
// GoTrue, Stripe, email delivery and object storage are simulations. Auth checks,
// parent-cookie scope, SQL RPCs, checkout validation and raster rendering are real.
import { createServer } from 'node:http';
import { createHmac, createHash, randomBytes } from 'node:crypto';
import { writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import sharp from 'sharp';
import { NextRequest, NextResponse } from 'next/server.js';
import { createFixtureDatabase, projectRoot } from './database.mjs';
import { localPinBudgetRedis } from '../../helpers/pin-budget-redis.mjs';

const require = createRequire(import.meta.url), sha = value => createHash('sha256').update(value).digest('hex');
export const fixtureId = value => `01000000-0000-4000-8000-${String(value).padStart(12,'0')}`;
export async function startCollageFixture({ outputDirectory, port = 0, includeEvent = false } = {}) {
  const directory = outputDirectory || await mkdtemp(path.join(tmpdir(),'studio-collage-e2e-'));
  await mkdir(directory,{recursive:true}); await mkdir(path.join(directory,'objects'),{recursive:true});
  const database = await createFixtureDatabase(path.join(directory,'database'));
  const redis = await localPinBudgetRedis();
  const ids = { owner:fixtureId(1), user:fixtureId(2), otherOwner:fixtureId(3), otherUser:fixtureId(4), school:fixtureId(5), siblingSchool:fixtureId(6), student:fixtureId(7), siblingStudent:fixtureId(8), profile:fixtureId(9), ordinaryProduct:fixtureId(10) };
  const jwtSecret=randomBytes(32).toString('hex'), serviceKey='fixture-service-'+randomBytes(12).toString('hex'), anonKey='fixture-anon-only';
  const tokenFor = sub => { const payload=Buffer.from(JSON.stringify({sub,aal:'aal1',role:'authenticated',exp:Math.floor(Date.now()/1000)+86400})).toString('base64url');const head=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');return`${head}.${payload}.${createHmac('sha256',jwtSecret).update(`${head}.${payload}`).digest('base64url')}`; };
  const ownerToken=tokenFor(ids.user), foreignToken=tokenFor(ids.otherUser), objects=new Map(), payments=new Map(), observations={auth:[],sql:[],provider:[],storage:[],emails:[],routes:[]}, requestContext=new AsyncLocalStorage();
  let baseUrl, environment, closed=false;
  const media = [];
  for (let student=0;student<2;student++) for(let index=0;index<3;index++) {
    const schoolId=student?ids.siblingSchool:ids.school, studentId=student?ids.siblingStudent:ids.student;
    const key=`${schoolId}/Class A/Student ${student+1}/pose-${index+1}.jpg`;
    const svg=`<svg width="1800" height="2400"><rect width="1800" height="2400" fill="${['#f8bd95','#7abddd','#a3c08c'][index]}"/><circle cx="${700+index*150}" cy="850" r="350" fill="#333355"/><rect x="${400+index*100}" y="1200" width="800" height="1200" fill="#3344aa"/><text x="100" y="200" font-size="120" fill="black">S${student+1} pose ${index+1}</text></svg>`;
    const bytes=await sharp(Buffer.from(svg)).jpeg({quality:92}).toBuffer(); objects.set(key,bytes);
    await writeFile(path.join(directory,'objects',sha(key)+'.jpg'),bytes);
    media.push({key,studentId,schoolId,filename:`pose-${index+1}.jpg`,width:1800,height:2400});
  }
  const seeded=await database.db.query('select id from photographers limit 1');
  if(!seeded.rows.length) {
    await database.db.query('insert into auth.users(id) values($1),($2)',[ids.user,ids.otherUser]);
    await database.db.query("insert into photographers(id,user_id,business_name,billing_email,studio_email,billing_currency,default_package_profile_id,stripe_connected_account_id) values($1,$2,'Isolated Collage Studio','owner@example.test','studio@example.test','cad',$3,'acct_fixture'),($4,$5,'Other Isolated Studio','other@example.test','other@example.test','cad',null,'acct_other')",[ids.owner,ids.user,ids.profile,ids.otherOwner,ids.otherUser]);
    await database.db.query("insert into photographer_agreements(user_id,agreement_version) values($1,'2026-04-v1'),($2,'2026-04-v1')",[ids.user,ids.otherUser]);
    await database.db.query("insert into package_profiles(id,photographer_id,name) values($1,$2,'E2E print products')",[ids.profile,ids.owner]);
    for(const[index,schoolId,studentId]of[[0,ids.school,ids.student],[1,ids.siblingSchool,ids.siblingStudent]]) {
      await database.db.query("insert into schools(id,photographer_id,school_name,package_profile_id,gallery_settings) values($1,$2,$3,$4,$5)",[schoolId,ids.owner,`Fixture School ${index+1}`,ids.profile,JSON.stringify({extras:{shippingEnabled:false,offerPackagesOnly:false,watermarkEnabled:false}})]);
      await database.db.query("insert into students(id,school_id,pin,first_name,last_name,class_name,folder_name,photo_url) values($1,$2,$3,'Fixture',$4,'Class A',$5,$6)",[studentId,schoolId,`FIXTURE-${index+1}`,`Student ${index+1}`,`Student ${index+1}`,media.find(row=>row.studentId===studentId).key]);
    }
    await database.db.query("insert into packages(id,photographer_id,package_profile_id,profile_id,name,category,price_cents,items) values($1,$2,$3::uuid,$3::text,'Ordinary 5x7 print','print',700,$4)",[ids.ordinaryProduct,ids.owner,ids.profile,JSON.stringify([{qty:1,name:'5x7 print',type:'print',size:'5x7'}])]);
  }
  await database.db.exec('create table if not exists school_storage_root_claims(root text primary key,school_id uuid); alter table photographers add column if not exists watermark_opacity numeric;');
  await database.db.exec('create table if not exists school_gallery_visitors(id uuid primary key default gen_random_uuid(),school_id uuid,viewer_email text); create table if not exists school_yearbook_settings(school_id uuid primary key,enabled boolean default false);');
  if(!(await database.db.query("select to_regprocedure('public.r2_media_namespace_owner(text,text,boolean,boolean)') ready")).rows[0].ready) {
    await database.applyMigration('20261012060000_retain_r2_namespace_owners.sql');
    await database.applyMigration('20261012080000_bind_r2_photographer_namespace_accounts.sql');
  }
  let event=null;
  if(includeEvent) {
    const projectId=fixtureId(11),collectionId=fixtureId(12),lockedCollectionId=fixtureId(13);
    await database.db.exec('alter table projects add column if not exists email_required boolean default true; alter table projects add column if not exists access_mode text; alter table collections add column if not exists access_mode text; alter table collections add column if not exists access_pin text; alter table collections add column if not exists sort_order integer default 0; alter table collections add column if not exists created_at timestamptz default now(); create table if not exists pre_release_emails(id uuid primary key default gen_random_uuid(),project_id uuid,email text); create table if not exists subjects(id uuid primary key default gen_random_uuid(),project_id uuid,external_ref text);');
    await database.db.query("insert into projects(id,photographer_id,title,workflow_type,package_profile_id,status,portal_status,access_mode,access_pin,gallery_settings) values($1,$2,'Fixture Event','event',$3,'published','published','pin','EVENT-1',$4) on conflict(id) do nothing",[projectId,ids.owner,ids.profile,JSON.stringify({extras:{shippingEnabled:false,offerPackagesOnly:false}})]);
    await database.db.query("insert into collections(id,project_id,kind,title,slug,access_mode,access_pin) values($1,$2,'album','Allowed album','allowed','inherit_project',null),($3,$2,'album','Locked album','locked','pin','OTHER-EVENT-PIN') on conflict(id) do nothing",[collectionId,projectId,lockedCollectionId]);
    const eventMedia=[];
    for(let index=0;index<4;index++){
      const id=fixtureId(14+index),album=index===3?lockedCollectionId:collectionId,key=`projects/${projectId}/albums/${album}/pose-${index+1}.jpg`;
      objects.set(key,objects.get(media[index%3].key));
      await database.db.query('insert into media(id,project_id,collection_id,storage_path,filename,sort_order) values($1,$2,$3,$4,$5,$6) on conflict(id) do nothing',[id,projectId,album,key,`pose-${index+1}.jpg`,index]);
      eventMedia.push({id,key,collectionId:album});
    }
    event={credentials:{kind:'event',galleryId:projectId,pin:'EVENT-1',email:'parent@example.test'},media:eventMedia.slice(0,3),forbiddenMedia:eventMedia[3]};
  }
  const commerceMigration=path.join(projectRoot,'supabase/migrations/20261014190000_collage_commerce.sql');
  if(existsSync(commerceMigration)&&!(await database.db.query("select to_regclass('public.collage_commerce_attempts') ready")).rows[0].ready) await database.applyMigration('20261014190000_collage_commerce.sql');
  if(!(await database.db.query("select to_regprocedure('public.sync_photographer_connect_state(uuid,text,text,boolean,boolean,boolean)') ready")).rows[0].ready) await database.applyMigration('20261008200000_explicit_stripe_business_country.sql');
  const modules=new Map(), deferred=[], timers=new Set();
  const objectRead=async key => { observations.storage.push({operation:'read',key});const bytes=objects.get(key);if(!bytes)throw Error('Fixture object unavailable: '+key);return bytes; };
  const storageTransport={
    digest:sha, readProduction:async(key,maxBytes)=>{const bytes=await objectRead(key);if(bytes.length>maxBytes)throw Error('Fixture object limit');return{bytes,contentType:'image/png'};},
    writeProduction:async(key,bytes,contentType)=>{observations.storage.push({operation:'write',key,sha256:sha(bytes)});objects.set(key,Buffer.from(bytes));await writeFile(path.join(directory,'objects',sha(key)+'.png'),bytes);return{key,contentType};},
  };
  async function providerFetch(input,init={}) {
    const url=new URL(typeof input==='string'?input:input.url);
    if(url.hostname!=='api.stripe.com') {
      if(url.origin===baseUrl)return fetch(input,init);
      if(url.hostname==='api.resend.com'){ observations.emails.push(JSON.parse(init.body)); return Response.json({id:'simulated_email_'+observations.emails.length}); }
      throw Error('Fixture refuses external network: '+url.origin);
    }
    const route=url.pathname.replace('/v1/',''), method=init.method||'GET', account=new Headers(init.headers).get('stripe-account');
    if(account && !['acct_fixture','acct_other'].includes(account))throw Error('Wrong simulated provider account');
    observations.provider.push({route,method,account});
    if(route.startsWith('accounts/'))return Response.json({id:route.split('/')[1],country:'CA',default_currency:'cad',details_submitted:true,charges_enabled:true,payouts_enabled:true,requirements:{currently_due:[]},business_profile:{name:'Fixture Studio'},metadata:{}});
    if(route==='checkout/sessions' && method==='POST') {
      const params=new URLSearchParams(init.body), id='cs_fixture_'+(payments.size+1), intent='pi_fixture_'+(payments.size+1), metadata={};
      for(const[key,value]of params)if(/^metadata\[/.test(key))metadata[key.slice(9,-1)]=value;
      const intentMetadata={}; for(const[key,value]of params)if(key.startsWith('payment_intent_data[metadata]['))intentMetadata[key.slice(30,-1)]=value;
      const saved={id,mode:'payment',status:'open',payment_status:'unpaid',amount_total:Number(params.get('line_items[0][price_data][unit_amount]')),currency:params.get('line_items[0][price_data][currency]'),client_reference_id:params.get('client_reference_id'),metadata,
        payment_intent:intent,customer_details:{email:params.get('customer_email')},url:`${baseUrl}/__fixture/provider/${id}`,successUrl:params.get('success_url'),cancelUrl:params.get('cancel_url'),application_fee_amount:Number(params.get('payment_intent_data[application_fee_amount]')||0),intentMetadata};
      payments.set(id,saved);await writeFile(path.join(directory,'simulated-provider-receipts.json'),JSON.stringify([...payments.values()],null,2));return Response.json(saved);
    }
    if(route.startsWith('checkout/sessions/')) { const session=payments.get(route.split('/')[2]);if(!session)return Response.json({error:{message:'Unknown simulated session'}},{status:404});return Response.json(session); }
    if(route.startsWith('payment_intents/')) { const session=[...payments.values()].find(p=>p.payment_intent===route.split('/')[1]);if(!session)return Response.json({error:{message:'Unknown simulated intent'}},{status:404});return Response.json({id:session.payment_intent,status:session.payment_status==='paid'?'succeeded':'requires_payment_method',amount:session.amount_total,amount_received:session.payment_status==='paid'?session.amount_total:0,currency:session.currency,application_fee_amount:session.application_fee_amount,metadata:session.intentMetadata}); }
    throw Error('Unimplemented simulated provider endpoint '+route);
  }
  class PinRedis { async eval(script,keys,args){return redis.eval(script,keys,args);} }
  function load(file) {
    if(file==='lib/r2.ts')return {r2Download:objectRead,listR2FolderImages:async(prefix)=>media.filter(m=>m.key.startsWith(prefix+'/')&&!m.key.slice(prefix.length+1).includes('/')).map(m=>({key:m.key,name:m.filename,url:m.key})),r2Head:async key=>objects.has(key)?{size:objects.get(key).length}:null};
    if(file==='lib/order-automation-storage.ts')return storageTransport;
    if(modules.has(file))return modules.get(file);
    const exports={};modules.set(file,exports);
    const code=ts.transpileModule(readFileSync(path.join(projectRoot,file),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
    const mocks={
      'server-only':{},'next/server':{NextRequest,NextResponse,after:callback=>deferred.push(callback)},
      'next/headers':{cookies:async()=>({getAll:()=>[],set(){}})},
      '@/lib/order-automation-storage':storageTransport,
      '@/lib/r2':{r2Download:objectRead,listR2FolderImages:async(prefix)=>media.filter(m=>m.key.startsWith(prefix+'/')&&!m.key.slice(prefix.length+1).includes('/')).map(m=>({key:m.key,name:m.filename,url:m.key})),r2Head:async key=>objects.has(key)?{size:objects.get(key).length}:null},
      '@upstash/redis':file==='lib/portal-pin-rate-limit.ts'?{Redis:PinRedis}:undefined,
    };
    const scopedEnv=file==='lib/rate-limit.ts'?{...environment,UPSTASH_REDIS_REST_URL:'',UPSTASH_REDIS_REST_TOKEN:''}:environment;
    new Function('require','exports','process','fetch','setInterval',code)(name=>{
      if(mocks[name]!==undefined)return mocks[name];
      if(name==='@/lib/r2-signed-urls')return {...load('lib/r2-signed-urls.ts'),r2PresignedGetUrl:(key,ttl=300)=>{
        const expires=Math.floor(Date.now()/1000)+ttl,signature=createHmac('sha256',jwtSecret).update(`${key}:${expires}`).digest('hex');
        return `${baseUrl}/__fixture/object?key=${encodeURIComponent(key)}&expires=${expires}&signature=${signature}`;
      }};
      if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
      if(name.startsWith('.'))return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),name)) + (path.extname(name)?'':'.ts'));
      return require(name);
    },exports,{env:scopedEnv},providerFetch,(...args)=>{const timer=setInterval(...args);timer.unref();timers.add(timer);return timer;});
    return exports;
  }
  async function fixtureGallery(request) {
    const body=request.method==='GET'?Object.fromEntries(request.nextUrl.searchParams):await request.json();
    const laneId=body.parentLaneId||request.nextUrl.searchParams.get('parentLaneId');
    const session=await load('lib/parent-gallery-session.ts').resolveParentGallerySession(request,laneId);
    load('lib/parent-gallery-session.ts').assertParentSessionScope(request,session,body);
    const school=(await database.db.query('select * from schools where id=$1',[session.galleryId])).rows[0];
    const students=(await database.db.query('select * from students where school_id=$1 and pin=$2',[session.galleryId,session.pin])).rows;
    const rows=media.filter(m=>students.some(s=>s.id===m.studentId)).map(m=>({id:m.key,storage_path:m.key,filename:m.filename,preview_url:load('lib/school-portal-media.ts').schoolPreviewUrl({school,students,email:session.email,mediaKey:m.key,kind:'school-gallery-preview'}),thumbnail_url:null}));
    const packages=(await database.db.query('select * from packages where photographer_id=$1 and active and (profile_id is null or profile_id=$2) order by sort_order,id',[ids.owner,school.package_profile_id||ids.profile])).rows;
    return Response.json({ok:true,currentSchool:school,schoolRowsForMatch:[school],activeSchool:school,primaryStudent:students[0],studentCandidates:students,gallerySettings:load('lib/event-gallery-settings.ts').normalizeEventGallerySettings(school.gallery_settings),media:rows,composites:[],packages,backdrops:[],onlineBackdropsEnabled:false,nobgUrls:{},photographerId:ids.owner,watermarkEnabled:false,orderCurrency:'cad',studioInfo:{businessName:'Isolated Collage Studio',logoUrl:'',address:'',phone:'',email:'studio@example.test'}});
  }
  async function route(request) {
    const url=request.nextUrl;
    if(url.pathname==='/__fixture/config')return Response.json(config);
    if(url.pathname==='/__fixture/object') {
      const key=url.searchParams.get('key'),expires=url.searchParams.get('expires');
      const signature=createHmac('sha256',jwtSecret).update(`${key}:${expires}`).digest('hex');
      if(Number(expires)<Date.now()/1000||signature!==url.searchParams.get('signature'))return Response.json({message:'Expired fixture object signature'},{status:403});
      if(!objects.has(key))return Response.json({message:'Fixture object not found'},{status:404});
      return new Response(new Uint8Array(await objectRead(key)),{headers:{'Content-Type':'image/jpeg'}});
    }
    if(url.pathname==='/__fixture/state')return Response.json({orders:(await database.db.query('select * from orders order by created_at,id')).rows,items:(await database.db.query('select * from order_items order by id')).rows,webhooks:(await database.db.query('select event_id,status from customer_order_webhooks')).rows,paidEmails:(await database.db.query('select order_id,kind,status from paid_order_emails')).rows,provider:[...payments.values()],observations});
    if(url.pathname==='/__fixture/complete-payment') {
      const {sessionId}=await request.json(), session=payments.get(sessionId);if(!session)return Response.json({message:'Unknown simulated session'},{status:404});
      session.status='complete';session.payment_status='paid';session.simulatedReceipt||={id:'simulated_receipt_'+session.id,provider:'isolated fake Stripe transport',notStripeTestMode:true,amountCents:session.amount_total,createdAt:new Date().toISOString()};
      await writeFile(path.join(directory,'simulated-provider-receipts.json'),JSON.stringify([...payments.values()],null,2));
      const event={id:'evt_fixture_'+session.id,type:'checkout.session.completed',account:'acct_fixture',livemode:false,data:{object:session}};
      const payload=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000);
      const signature=createHmac('sha256',environment.STRIPE_CONNECT_WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest('hex');
      const webhook=await load('app/api/stripe/webhook/route.ts').POST(new NextRequest(baseUrl+'/api/stripe/webhook',{method:'POST',headers:{'content-type':'application/json','stripe-signature':`t=${timestamp},v1=${signature}`},body:payload}));
      const webhookResult=await webhook.json();
      if(!webhook.ok)return Response.json({ok:false,receipt:session.simulatedReceipt,webhook:webhookResult},{status:webhook.status});
      return Response.json({ok:true,sessionId,receipt:session.simulatedReceipt,webhook:webhookResult,successUrl:session.successUrl.replace('{CHECKOUT_SESSION_ID}',sessionId)});
    }
    if(url.pathname.startsWith('/__fixture/provider/')) {
      const id=url.pathname.split('/').at(-1); let fixtureReturnTo=null;
      try {const target=new URL(url.searchParams.get('fixtureReturnTo'));if(['localhost','127.0.0.1'].includes(target.hostname)&&target.protocol==='http:'){target.searchParams.set('checkout','success');target.searchParams.set('session_id',id);fixtureReturnTo=target.toString();}} catch {}
      return new Response(`<html><body><h1>SIMULATED fixture payment</h1><p>No real charge. This is not Stripe test mode.</p><button onclick="fetch('/__fixture/complete-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'${id}'})}).then(r=>r.json()).then(v=>{if(!v.ok)throw Error(JSON.stringify(v));location.href=${JSON.stringify(fixtureReturnTo)}||v.successUrl}).catch(e=>document.body.append(String(e)))">Complete simulated payment</button></body></html>`,{headers:{'content-type':'text/html'}});
    }
    if(url.pathname==='/auth/v1/user') {
      const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
      let sub=null;try{const[a,b,c]=token.split('.');if(createHmac('sha256',jwtSecret).update(`${a}.${b}`).digest('base64url')!==c)throw Error();const p=JSON.parse(Buffer.from(b,'base64url'));if(p.exp*1000<Date.now())throw Error();sub=p.sub;}catch{}
      observations.auth.push({accepted:sub===ids.user||sub===ids.otherUser});
      if(![ids.user,ids.otherUser].includes(sub))return Response.json({message:'Invalid fixture token'},{status:401});
      return Response.json({id:sub,email:sub===ids.user?'owner@example.test':'other@example.test',aud:'authenticated',role:'authenticated',factors:[],app_metadata:{},user_metadata:{},created_at:new Date().toISOString()});
    }
    if(url.pathname.startsWith('/rest/v1/')) {
      if(request.headers.get('apikey')!==serviceKey)return Response.json({message:'Fixture service role required'},{status:403});
      observations.sql.push({path:url.pathname,method:request.method});return database.rest(request);
    }
    if(url.pathname==='/api/portal/gallery-context')return fixtureGallery(request);
    if(url.pathname==='/api/portal/school-favorites') { const body=await request.clone().json();await load('lib/parent-gallery-session.ts').resolveParentGallerySession(request,body.parentLaneId);return Response.json({ok:true,mediaIds:[]}); }
    let file=`app${url.pathname}/route.ts`, context;
    const version=url.pathname.match(/^\/api\/dashboard\/collages\/([a-f0-9-]{36})$/);
    const preview=url.pathname.match(/^\/api\/portal\/school-preview\/([a-f0-9]{64}\.jpg)$/);
    if(version){file='app/api/dashboard/collages/[versionId]/route.ts';context={params:Promise.resolve({versionId:version[1]})};}
    if(preview){file='app/api/portal/school-preview/[filename]/route.ts';context={params:Promise.resolve({filename:preview[1]})};}
    if(url.pathname.startsWith('/api/r2/img/')){file='app/api/r2/img/[...path]/route.ts';context={params:Promise.resolve({path:url.pathname.slice('/api/r2/img/'.length).split('/').map(decodeURIComponent)})};}
    if(!existsSync(path.join(projectRoot,file)))return Response.json({message:'Fixture route not mounted',file},{status:404});
    const handler=load(file)[request.method];if(!handler)return Response.json({message:'Unsupported fixture method'},{status:405});
    return requestContext.run(request,()=>handler(request,context));
  }
  const server=createServer(async(req,res)=>{
    try {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const headers=new Headers();for(const[key,value]of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(','):value);
      const request=new NextRequest(baseUrl+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
      observations.routes.push({path:request.nextUrl.pathname,method:request.method});
      const response=await route(request);
      res.statusCode=response.status;for(const[key,value]of response.headers)if(key!=='set-cookie')res.setHeader(key,value);
      const cookies=response.headers.getSetCookie?.()||[];if(cookies.length)res.setHeader('set-cookie',cookies);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch(error) { if(!error.status)console.error('[collage fixture]',error);res.statusCode=Number(error.status)||500;res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:false,message:error.message,fixture:true})); }
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));baseUrl=`http://localhost:${server.address().port}`;
  environment={NODE_ENV:'test',NEXT_PUBLIC_SITE_URL:baseUrl,NEXT_PUBLIC_SUPABASE_URL:baseUrl,NEXT_PUBLIC_SUPABASE_ANON_KEY:anonKey,SUPABASE_SERVICE_ROLE_KEY:serviceKey,STRIPE_SECRET_KEY:'sk_fixture_simulated_never_real',STRIPE_CONNECT_WEBHOOK_SECRET:'whsec_isolated_fixture_only',EVENT_DOWNLOAD_TOKEN_SECRET:'isolated-collage-fixture-secret-'+jwtSecret,DOWNLOAD_TOKEN_SECRET:'isolated-collage-fixture-secret-'+jwtSecret,STUDIO_OS_COLLAGE_CHECKOUT_ENABLED:'1',UPSTASH_REDIS_REST_URL:'https://fixture.invalid',UPSTASH_REDIS_REST_TOKEN:'fixture',STUDIO_CREDIT_MAINTENANCE:'1'};
  const config={version:1,baseUrl,outputDirectory:directory,ownerToken,foreignToken,ids,profileId:ids.profile,media,event,parents:[{kind:'school',galleryId:ids.school,pin:'FIXTURE-1',email:'parent@example.test',label:'First synthetic student'},{kind:'school',galleryId:ids.siblingSchool,pin:'FIXTURE-2',email:'parent@example.test',label:'Second synthetic student'}],limitations:['GoTrue auth provider simulated with signed fixture JWT; production resolveDashboardAuth runs unchanged.','Stripe provider simulated; no Stripe test-mode or live charge.','Private object storage local synthetic media; production ownership checks and renderer unchanged.','No production database, migration, customer data, email delivery or printer.']};
  await writeFile(path.join(directory,'config.json'),JSON.stringify(config,null,2));
  return {baseUrl,config,directory,database:database.db,load,observations,payments,objects,async close(){if(closed)return;closed=true;for(const timer of timers)clearInterval(timer);await new Promise(resolve=>server.close(resolve));await redis.close();await database.db.close();}};
}
if(process.argv[1]===new URL(import.meta.url).pathname) {
  const fixture=await startCollageFixture({outputDirectory:process.env.COLLAGE_E2E_OUTPUT,port:Number(process.env.COLLAGE_E2E_PORT||0)});
  console.log(JSON.stringify({baseUrl:fixture.baseUrl,configPath:path.join(fixture.directory,'config.json'),outputDirectory:fixture.directory}));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>fixture.close().then(()=>process.exit(0)));
}
