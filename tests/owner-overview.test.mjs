import assert from 'node:assert/strict';
import test, {before, after} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const require=createRequire(import.meta.url);
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,last_sign_in_at timestamptz,raw_user_meta_data jsonb default '{}');
 create table photographers(id uuid primary key,user_id uuid,business_name text,billing_email text,studio_email text,is_platform_admin boolean default false,subscription_status text default 'trial',subscription_plan_code text,stripe_subscription_id text,trial_starts_at timestamptz,trial_ends_at timestamptz,created_at timestamp default now());
 create table photography_keys(id uuid primary key,photographer_id uuid,status text,key_code text);
 create table photography_key_activations(id uuid primary key,photography_key_id uuid,device_id text,device_name text,platform text,app_version text,status text,activated_at timestamptz,last_validated_at timestamptz);
 create table desktop_app_device_registrations(id uuid primary key,user_id uuid,device_id text,device_name text,platform text,app_version text,released_at timestamptz,last_seen_at timestamptz,first_seen_at timestamptz default now());
 create table schools(id uuid primary key,photographer_id uuid,created_at timestamp);
 create table projects(id uuid primary key,photographer_id uuid,linked_school_id uuid,created_at timestamptz);
 create table students(id uuid primary key,school_id uuid);
 create table photos(id uuid primary key,student_id uuid,created_at timestamp);
 create table media(id uuid primary key,project_id uuid,created_at timestamptz);
 create table school_roster_snapshots(id uuid primary key,school_id uuid,created_at timestamptz);
 create table orders(id uuid primary key,photographer_id uuid,is_test boolean,status text,payment_status text,refund_status text,updated_at timestamptz,paid_at timestamptz,total_cents integer,total_amount numeric,refund_amount_cents integer,currency text);
 create table audit_log(id uuid primary key,actor_user_id uuid,actor_photographer_id uuid,target_photographer_id uuid,occurred_at timestamptz,action text,entity_type text,entity_id text,result text,"after" jsonb,metadata jsonb);
 create table order_refund_emails(id uuid primary key,photographer_id uuid,created_at timestamptz,sent_at timestamptz,status text,audience text,payload jsonb);
 create table project_email_deliveries(id uuid primary key,photographer_id uuid,created_at timestamptz,sent_at timestamptz,status text,email_type text,recipient_email text);
 create table crm_email_outbox(id uuid primary key,photographer_id uuid,created_at timestamptz,sent_at timestamptz,status text,subject text,to_email text);
 create table crm_email_events(id uuid primary key,photographer_id uuid,outbox_id uuid,event_type text,occurred_at timestamptz);
 create table stripe_events(id text primary key,event_type text,processed_at timestamptz,livemode boolean,stripe_account text,payload jsonb);`);
 await db.exec(source('supabase/migrations/20260925010000_owner_overview.sql'));
 for(let n=1;n<=4;n++){
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[id(n),`person${n}@example.invalid`]);
  await db.query("insert into photographers(id,user_id,business_name,is_platform_admin) values($1,$1,$2,$3)",[id(n),['','Owner','Incomplete','Expired','Active'][n],n===1]);
 }
 await db.query("update photographers set subscription_plan_code='studio',trial_starts_at=now()-interval '60 days',trial_ends_at=now()-interval '30 days' where id=$1",[id(3)]);
 await db.query("update photographers set subscription_plan_code='studio',trial_starts_at=now(),trial_ends_at=now()+interval '30 days' where id=$1",[id(4)]);
});
after(async()=>db?.close());
const snapshot=async(search='',attention=false,page=0)=>(await db.query('select owner_overview_snapshot($1,$2,$3,$4) data',[id(1),page,search,attention])).rows[0].data;
const history=async(account=4,page=0)=>(await db.query('select owner_account_history($1,$2,$3) data',[id(1),id(account),page])).rows[0].data;

test('owner RPCs reject browser roles and non-owners; notes cannot be read through the table',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  for(const sql of ['select owner_overview_snapshot($1)','select owner_account_history($1,$1)','select owner_add_support_note($1,$1,$1,\'private\')','select * from owner_support_notes where author_user_id=$1'])
   await assert.rejects(db.query(sql,[id(1)]),/permission denied/);
  await db.exec('reset role');
 }
 await assert.rejects(db.query('select owner_overview_snapshot($1)',[id(4)]),/Owner access required/);
 await db.exec('set role service_role');assert.equal((await snapshot()).summary.accounts,4);await db.exec('reset role');
});

test('incomplete signup is flagged; expiry and inactivity alone are not failures; search is literal',async()=>{
 const result=await snapshot();assert.equal(result.summary.needs_attention,1);assert.equal(result.summary.active_trials,1);
 const expired=result.accounts.find(a=>a.id===id(3));assert.equal(expired.needs_attention,false);assert.equal(expired.active_devices,0);
 assert.equal((await snapshot('',true)).accounts[0].name,'Incomplete');
 assert.equal((await snapshot(id(4))).accounts[0].name,'Active');
 assert.equal((await snapshot('%')).total,0);
 await assert.rejects(snapshot('',false,-1),/Invalid page/);
});

test('keys, deduplicated physical devices, saved photos and bridged galleries are distinct measurements',async()=>{
 await db.query("insert into photography_keys values($1,$2,'active','NEVER_RETURN_THIS_SECRET'),($3,$2,'active','ANOTHER_SECRET')",[id(40),id(4),id(41)]);
 await db.query("insert into photography_key_activations values($1,$2,'mac-1','Studio Mac','macos','1.2','active',now(),now())",[id(42),id(40)]);
 await db.query("insert into desktop_app_device_registrations(id,user_id,device_id,device_name,platform,app_version,released_at,last_seen_at) values($1,$2,'mac-1','Studio Mac','macos','1.2',null,now())",[id(43),id(4)]);
 await db.query('insert into schools values($1,$2,now())',[id(44),id(4)]);
 await db.query('insert into projects values($1,$2,$3,now()),($4,$2,null,now())',[id(45),id(4),id(44),id(46)]);
 await db.query('insert into media values($1,$2,now())',[id(47),id(45)]);
 const result=await snapshot(id(4)),a=result.accounts[0];
 assert.equal(a.available_keys,2);assert.equal(a.active_devices,1);assert.equal(a.gallery_count,2);assert.equal(a.photo_records,1);assert.ok(a.first_photo_at);assert.ok(a.first_activation_at);
 assert.ok(!JSON.stringify(result).includes('SECRET'));assert.ok(!('user_id' in a));
 const detail=await history();assert.equal(detail.devices.length,1);assert.ok(!JSON.stringify(detail).includes('mac-1'));
});

test('private support notes are idempotent, isolated, author attributed, and paginated',async()=>{
 for(let n=0;n<27;n++)await db.query('select owner_add_support_note($1,$2,$3,$4)',[id(1),id(4),id(100+n),`Private note ${n}`]);
 await db.query('select owner_add_support_note($1,$2,$3,$4)',[id(1),id(4),id(100),'Private note 0']);
 await assert.rejects(db.query('select owner_add_support_note($1,$2,$3,$4)',[id(1),id(3),id(100),'Private note 0']),/Note request changed/);
 await assert.rejects(db.query('select owner_add_support_note($1,$2,$3,$4)',[id(4),id(4),id(300),'Forbidden']),/Owner access required/);
 const first=await history(),second=await history(4,1);
 assert.equal(first.entries.length,25);assert.equal(first.has_more,true);assert.equal(second.entries.length,2);assert.equal(second.has_more,false);
 assert.equal(new Set([...first.entries,...second.entries].map(e=>e.id)).size,27);
 assert.equal(first.entries[0].author,'person1@example.invalid');assert.equal((await history(3)).entries.length,0);
});

test('email status distinguishes accepted from delivered; timelines never expose raw audit/email payloads',async()=>{
 await db.query("insert into order_refund_emails values($1,$2,now(),now(),'sent','client',$3)",[id(200),id(4),{to:'client@example.invalid',html:'PRIVATE_BODY',secret:'PRIVATE_KEY'}]);
 await db.query("insert into crm_email_outbox values($1,$2,now(),now(),'sent','Gallery ready','recipient@example.invalid')",[id(201),id(4)]);
 await db.query("insert into crm_email_events values($1,$2,$3,'delivered',now())",[id(202),id(4),id(201)]);
 await db.query("insert into audit_log(id,target_photographer_id,occurred_at,action,result,metadata) values($1,$2,now(),'upload.failed','error',$3)",[id(203),id(4),{api_key:'PRIVATE_KEY',payload:'PRIVATE_BODY'}]);
 const detail=await history();assert.equal(detail.entries.find(e=>e.id==='refund-email:'+id(200)).state,'sent');
 assert.equal(detail.entries.find(e=>e.id==='crm-email:'+id(201)).state,'delivered');assert.ok(!JSON.stringify(detail).includes('PRIVATE_'));
 const a=(await snapshot(id(4))).accounts[0];assert.equal(a.recent_errors,1);assert.equal(a.needs_attention,true);
});

test('platform receipts exclude Connect/test invoices, dedupe invoice IDs, and never mix currencies or customer sales',async()=>{
 for(const [event,invoice,account,live,currency,amount] of [['evt1','inv1',null,true,'cad',2500],['evt2','inv1',null,true,'cad',2500],['evt3','inv3',null,true,'usd',900],['evt4','inv4','acct_other',true,'cad',99999],['evt5','inv5',null,false,'cad',99999]])
  await db.query("insert into stripe_events values($1,'invoice.paid',now(),$2,$3,$4)",[event,live,account,{data:{object:{id:invoice,subscription:'sub_1',currency,amount_paid:amount}}}]);
 await db.query("insert into orders(id,photographer_id,paid_at,total_cents,currency,refund_amount_cents,refund_status) values($1,$2,now(),10360,'cad',10360,'refunded'),($3,$2,now(),10360,'cad',0,null)",[id(210),id(4),id(211)]);
 const receipts=(await snapshot()).subscription_receipts;assert.equal(receipts.find(r=>r.currency==='CAD').amount_cents,2500);assert.equal(receipts.find(r=>r.currency==='USD').amount_cents,900);
 const sale=(await history()).sales[0];assert.equal(sale.paid_cents,20720);assert.equal(sale.refunded_cents,10360);
});

function loadModule(path,overrides={}){
 const exports={};const compiled=ts.transpileModule(source(path+'.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',compiled)(name=>name in overrides?overrides[name]:require(name),exports);return exports;
}
const responseModule={'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}}};
test('API owner gate rejects anonymous, incomplete MFA and regular photographers without issuing cross-account queries',async()=>{
 for(const [user,mfa,admin,status] of [[null,false,false,401],[{id:id(1)},false,true,403],[{id:id(4)},true,false,403],[{id:id(1)},true,true,200]]){
  let reads=0;const service={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>{reads++;return {data:{id:id(1),is_platform_admin:admin},error:null};}})})})};
  const module=loadModule('lib/owner-admin',{...responseModule,'@/lib/dashboard-auth':{resolveDashboardAuth:async()=>({user,mfaSatisfied:mfa}),createDashboardServiceClient:()=>service}});
  const result=await module.requireOwner({});assert.equal(result.response?.status??200,status);
  if(result.response)assert.match(result.response.headers.get('cache-control'),/no-store/);
  assert.equal(reads,user&&mfa?1:0);
 }
});

test('failed overview reads return unavailable, never a successful all-clear or zero-filled snapshot',async()=>{
 const route=loadModule('app/api/dashboard/admin/overview/route',{'@/lib/owner-admin':{ownerJson:(body,status=200)=>Response.json(body,{status}),requireOwner:async()=>({user:{id:id(1)},service:{rpc:()=>({abortSignal:async()=>({error:{message:'db down'}})})}})}});
 const response=await route.GET({nextUrl:new URL('https://example.invalid/api')});assert.equal(response.status,503);assert.equal((await response.json()).summary,undefined);
});

test('presentation never calls a sent message delivered or an inactive account broken',()=>{
 const module=loadModule('lib/owner-overview');assert.equal(module.emailState('sent'),'Sent · delivery unverified');
 assert.equal(module.accountAttention({auth_missing:false,signup_incomplete:false,billing_problem:false,recent_errors:0,email_problems:0,payment_problems:0}).length,0);
 assert.equal(module.accountAccess({is_owner:false,has_subscription:false,subscription_status:'trial',trial_ends_at:'2000-01-01'}),'Trial expired');
});

test('support-note route enforces origin and size, validates input and reuses the supplied retry ID',async()=>{
 let writes=0,args;
 const route=loadModule('app/api/dashboard/admin/overview/accounts/[id]/route',{'@/lib/owner-admin':{
  ownerJson:(body,status=200)=>Response.json(body,{status}),requireOwner:async()=>({user:{id:id(1)},service:{rpc:(_name,input)=>{writes++;args=input;return{abortSignal:async()=>({error:null})};}}})
 },'@/lib/rate-limit':{rateLimit:async()=>({allowed:true})}});
 const run=(body,origin='https://example.invalid')=>{const req=new Request('https://example.invalid/api',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});req.nextUrl=new URL(req.url);return route.POST(req,{params:Promise.resolve({id:id(4)})});};
 const note={id:id(901),body:'Retry this exact note'};
 assert.equal((await run(note,'https://evil.invalid')).status,403);assert.equal(writes,0);
 assert.equal((await run({...note,body:' '.repeat(2000)})).status,400);assert.equal(writes,0);
 assert.equal((await run({...note,body:'x'.repeat(17000)})).status,413);assert.equal(writes,0);
 assert.equal((await run(note)).status,200);assert.equal(args.p_id,note.id);assert.equal(args.p_actor,id(1));assert.equal(args.p_photographer,id(4));
 assert.equal((await run(note)).status,200);assert.equal(args.p_id,note.id);
});

test('confirmed login accounts missing profiles are visible without exposing auth secrets',async()=>{
 await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,'missing@example.invalid',now(),$2)",[id(910),{full_name:'Missing profile',private:'SECRET'}]);
 const s=await snapshot();assert.equal(s.unlinked_confirmed_accounts,1);assert.equal(s.unlinked_accounts[0].email,'missing@example.invalid');assert.ok(!JSON.stringify(s.unlinked_accounts).includes('SECRET'));
});

test('account pagination reports filtered totals and never silently caps the first page',async()=>{
 for(let n=1000;n<1027;n++){
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[id(n),`page${n}@example.invalid`]);
  await db.query("insert into photographers(id,user_id,business_name,subscription_status,subscription_plan_code) values($1,$1,'Paging fixture','active','core')",[id(n)]);
 }
 const first=await snapshot('Paging fixture',false,0),second=await snapshot('Paging fixture',false,1);
 assert.equal(first.total,27);assert.equal(first.accounts.length,25);assert.equal(second.accounts.length,2);
 assert.equal(new Set([...first.accounts,...second.accounts].map(a=>a.id)).size,27);
});

test('device release history survives reactivation without duplicate timeline entries',async()=>{
 await db.query('update desktop_app_device_registrations set released_at=now() where id=$1',[id(43)]);
 let events=(await history()).entries.filter(e=>e.title==='device.release'||e.title==='Desktop device released');assert.equal(events.length,1);
 await db.query('update desktop_app_device_registrations set released_at=null where id=$1',[id(43)]);
 events=(await history()).entries.filter(e=>e.title==='device.release');assert.equal(events.length,1);
});
