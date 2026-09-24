import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const require=createRequire(import.meta.url);
const root=new URL('../',import.meta.url);
const userId='11111111-1111-4111-8111-111111111111';
const loadSource=path=>readFileSync(new URL(path,root),'utf8');
function modules(overrides={}) {
  const cache=new Map();
  const actual=new Set(['lib/payments','lib/subscription-access','lib/subscription-gate','lib/studio-os-app','lib/studio-pricing','lib/trial-config','app/api/studio-os-app/status/route']);
  const load=name=>{
    if(name in overrides)return overrides[name];
    if(name.startsWith('node:'))return require(name);
    const path=name.replace('@/', '');
    if(!actual.has(path))return new Proxy({}, {get:(_,key)=>()=>{throw Error(`Unexpected dependency ${name}.${String(key)}`);}});
    if(cache.has(path))return cache.get(path);
    const exports={};cache.set(path,exports);
    const compiled=ts.transpileModule(loadSource(path+'.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','exports',compiled)(load,exports);return exports;
  };
  return load;
}
const load=modules();
const access=load('@/lib/subscription-access');
const app=load('@/lib/studio-os-app');
const portal=load('@/lib/subscription-gate');
const now=Date.now();
const trial={subscription_status:'trial',subscription_plan_code:null,created_at:new Date(now-86400000).toISOString()};
const release={release_state:'public',mac_download_url:'https://example.invalid/mac.dmg',windows_download_url:null};

test('legacy active trial receives Studio, two keys, downloads, and gallery access consistently',()=>{
  const state=access.resolveSubscriptionAccess(trial);
  assert.equal(state.trialActive,true);assert.equal(state.planCode,'studio');
  assert.equal(state.trialDaysRemaining,29);assert.equal(app.getAllowedPhotographyKeyCount(trial),2);
  const entitlement=app.resolveStudioAppEntitlement(trial,release);
  assert.equal(entitlement.planCode,'studio');assert.equal(entitlement.canDownload,true);assert.equal(entitlement.totalAllowedKeys,2);
  assert.equal(portal.hasActiveSubscription(trial),true);
});

test('expired or exactly-ended trials cannot download, activate keys, or serve galleries',()=>{
  for(const end of [now-1,now-86400000]) {
    const row={...trial,subscription_plan_code:'studio',trial_ends_at:new Date(end).toISOString()};
    assert.equal(access.resolveSubscriptionAccess(row,now).trialExpired,true);
    assert.equal(app.getAllowedPhotographyKeyCount(row),0);
    assert.equal(app.resolveStudioAppEntitlement(row,release).canDownload,false);
    assert.equal(portal.hasActiveSubscription(row),false);
  }
  assert.equal(access.isFreeTrialActive({...trial,trial_ends_at:new Date(now).toISOString()},now),false);
});

test('paid plans and owners retain their allowances; canceled accounts cannot reuse future trial dates',()=>{
  for(const [plan,keys] of [['starter',0],['core',1],['studio',3]]){
    const row={...trial,subscription_status:'active',subscription_plan_code:plan,extra_desktop_keys:1,trial_ends_at:'2000-01-01'};
    assert.equal(app.getAllowedPhotographyKeyCount(row),keys);assert.equal(portal.hasActiveSubscription(row),true);
  }
  assert.equal(app.getAllowedPhotographyKeyCount({...trial,is_platform_admin:true}),4);
  for(const status of ['canceled','past_due','inactive']){
    const row={...trial,subscription_status:status,trial_ends_at:new Date(now+86400000).toISOString()};
    assert.equal(app.getAllowedPhotographyKeyCount(row),0);assert.equal(portal.hasActiveSubscription(row),false);
  }
  assert.equal(app.getAllowedPhotographyKeyCount({...trial,subscription_status:'trialing',subscription_plan_code:'core'}),1);
});

test('legacy timezone-free timestamps are interpreted as UTC in every browser',()=>{
  assert.equal(access.resolveFreeTrialEndsAt({...trial,created_at:'2026-09-24T05:14:40.000'}),'2026-10-24T05:14:40.000Z');
});

test('invalid trial dates fail closed and public/beta rollout still gates downloads',()=>{
  assert.equal(access.resolveSubscriptionAccess({...trial,trial_ends_at:'invalid'}).accessEnabled,false);
  assert.equal(access.getFreeTrialDaysRemaining({...trial,trial_ends_at:'invalid'}),0);
  assert.equal(app.resolveStudioAppEntitlement(trial,{...release,release_state:'hidden'}).canDownload,false);
  assert.equal(app.resolveStudioAppEntitlement({...trial,studio_app_beta_access:true},{...release,release_state:'beta'}).canDownload,true);
});

async function fixture() {
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create table public.photographers(id uuid primary key default gen_random_uuid(),user_id uuid not null unique,
 business_name text,billing_email text,studio_email text,is_platform_admin boolean not null default false,
 subscription_status text not null default 'trial',subscription_plan_code text,stripe_subscription_id text,
 trial_starts_at timestamptz,trial_ends_at timestamptz,created_at timestamptz default now(),
 studio_id uuid,extra_desktop_keys integer default 0,studio_app_beta_access boolean default false);
 create function public.handle_new_user() returns trigger language plpgsql as $$ begin
 insert into public.photographers(user_id,business_name) values(new.id,'My Photography Business');return new;end;$$;
 create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();`);
 await db.exec(loadSource('supabase/migrations/20260403143000_add_studio_os_app_beta_rollout.sql'));
 await db.exec(loadSource('supabase/migrations/20260924190000_initialize_photographer_trials.sql'));
 await db.exec(`create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
 create table subscriptions(user_id uuid, is_admin boolean default false, status text, plan text);
 create table desktop_app_device_registrations(scope_key text,user_id uuid,studio_id uuid,device_id text,device_name text,
 platform text,app_version text,released_at timestamptz,last_seen_at timestamptz default now(),updated_at timestamptz default now(),unique(scope_key,device_id));`);
 await db.exec(loadSource('supabase/migrations/20260924220000_repair_desktop_access_lifecycle.sql'));
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[userId]);
 await db.query("update studio_app_releases set release_state='public',mac_download_url='https://example.invalid/mac.dmg'");
 await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'tester@example.invalid',$2)",[userId,{business_name:'Photo Studio'}]);
 const notified=[];
 function ident(s){assert.match(s,/^[a-z_]+$/);return '"'+s+'"';}
 function from(table){
  const filters=[],sort=[];let operation='select',values;let max;
  const chain={select(){return chain;},eq(k,v){filters.push([k,'=',v]);return chain;},in(k,v){filters.push([k,'in',v]);return chain;},order(k,{ascending}={}){sort.push(`${ident(k)} ${ascending===false?'desc':'asc'}`);return chain;},limit(v){max=v;return chain;},insert(v){operation='insert';values=v;return chain;},update(v){operation='update';values=v;return chain;},single(){return run(true);},maybeSingle(){return run(true);},then(a,b){return run(false).then(a,b);}};
  async function run(single){try{
   const params=[];const param=v=>{params.push(v);return '$'+params.length;};
   let sql;
   if(operation==='insert'){
    const rows=Array.isArray(values)?values:[values],columns=Object.keys(rows[0]);
    sql=`insert into ${ident(table)} (${columns.map(ident).join(',')}) values ${rows.map(row=>'('+columns.map(k=>param(row[k])).join(',')+')').join(',')} returning *`;
   }else{
    sql=operation==='update'?`update ${ident(table)} set ${Object.entries(values).map(([k,v])=>ident(k)+'='+param(v)).join(',')}`:`select * from ${ident(table)}`;
    if(filters.length)sql+=' where '+filters.map(([k,op,v])=>op==='in'?`${ident(k)} in (${v.map(param).join(',')})`:`${ident(k)} = ${param(v)}`).join(' and ');
    if(operation==='update')sql+=' returning *';else{if(sort.length)sql+=' order by '+sort.join(',');if(max)sql+=' limit '+Number(max);}
   }
   const result=await db.query(sql,params);return {data:single?result.rows[0]??null:result.rows,error:null};
  }catch(error){return {data:null,error};}}
  return chain;
 }
 const service={from,rpc(name,args){
  assert.ok(['initialize_photographer_trial','sync_photography_keys','activate_photography_key'].includes(name));
  const run=async(single=false)=>{try{const result=await db.query(`select * from ${name}(${Object.keys(args).map((k,i)=>`${ident(k)} => $${i+1}`).join(',')})`,Object.values(args));return {data:single?result.rows[0]:result.rows,error:null};}catch(error){return {data:null,error};}};
  return {single:()=>run(true),then:(a,b)=>run().then(a,b)};
 }};
 const load=modules({'@/lib/dashboard-auth':{createDashboardServiceClient:()=>service,resolveDashboardAuth:async()=>({user:{id:userId,email:'tester@example.invalid'}})},'@/lib/admin-notification-center':{notifyOwnerForSetting:async(...args)=>notified.push(args)},'@/lib/owner-notifications':{ownerUrl:path=>'https://example.invalid'+path},'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}}});
 const confirm=()=>db.query('update auth.users set email_confirmed_at=now() where id=$1',[userId]);
 const profile=async()=>(await db.query('select * from photographers where user_id=$1',[userId])).rows[0];
 return {db,service,load,confirm,profile,notified};
}

test('signup placeholder cannot start a trial before confirmation; confirmed first visit initializes once',async()=>{
 const f=await fixture();try{
  const payments=f.load('@/lib/payments');
  await assert.rejects(()=>payments.getOrCreatePhotographerByUser(f.service,{id:userId}),/confirmed account/);
  assert.equal((await f.profile()).trial_ends_at,null);
  await f.confirm();
  const responses=await Promise.all(Array.from({length:8},()=>payments.getOrCreatePhotographerByUser(f.service,{id:userId})));
  assert.ok(responses.every(p=>p.subscription_plan_code==='studio'&&p.business_name==='Photo Studio'));
  const first=await f.profile();assert.equal(Date.parse(first.trial_ends_at)-Date.parse(first.trial_starts_at),30*86400000);
  await payments.getOrCreatePhotographerByUser(f.service,{id:userId});assert.deepEqual(await f.profile(),first);
  assert.equal(f.notified.length,1);
 }finally{await f.db.close();}
});

test('missing profile initializes safely and old complete trials, paid users, owners and cancellations are preserved',async()=>{
 const f=await fixture();try{
  await f.confirm();await f.db.query('delete from photographers where user_id=$1',[userId]);
  const p=await f.load('@/lib/payments').getOrCreatePhotographerByUser(f.service,{id:userId});assert.equal(p.subscription_plan_code,'studio');
  for(const [status,owner,stripe] of [['trial',false,null],['active',false,'sub_paid'],['trialing',false,'sub_trialing'],['canceled',false,null],['trial',true,null]]){
   await f.db.query("update photographers set subscription_status=$1,is_platform_admin=$2,stripe_subscription_id=$3,trial_starts_at='2020-01-01',trial_ends_at='2020-01-31',business_name='Custom Studio'",[status,owner,stripe]);
   const before=await f.profile();await f.db.query('select * from initialize_photographer_trial($1)',[userId]);assert.deepEqual(await f.profile(),before);
  }
 }finally{await f.db.close();}
});

test('partial profile repair preserves explicit old expiry and custom business name',async()=>{
 const f=await fixture();try{
  await f.confirm();await f.db.query("update photographers set trial_ends_at='2020-01-31',business_name='Custom Studio'");
  const before=await f.profile();
  await f.db.query('select * from initialize_photographer_trial($1)',[userId]);
  const p=await f.profile();assert.equal(p.subscription_plan_code,'studio');assert.equal(p.business_name,'Custom Studio');
  assert.equal(Date.parse(p.trial_ends_at),Date.parse(before.trial_ends_at));assert.equal(access.resolveSubscriptionAccess(p).accessEnabled,false);
 }finally{await f.db.close();}
});

test('trial initializer is inaccessible to anonymous and signed-in browser roles',async()=>{
 const f=await fixture();try{await f.confirm();for(const role of ['anon','authenticated']){
  await f.db.exec(`set role ${role}`);await assert.rejects(()=>f.db.query('select * from public.initialize_photographer_trial($1)',[userId]),/permission denied/);await f.db.exec('reset role');
 }await f.db.exec('set role service_role');assert.equal((await f.db.query('select * from public.initialize_photographer_trial($1)',[userId])).rows[0].trial_initialized,true);
 }finally{await f.db.close();}
});

test('confirmed status request provisions two keys, concurrent refreshes preserve them, activation works, expiration revokes use',async()=>{
 const f=await fixture();try{
  await f.confirm();
  const route=f.load('@/app/api/studio-os-app/status/route');
  const responses=await Promise.all(Array.from({length:4},()=>route.GET({headers:new Headers()})));
  for(const response of responses){const result=await response.json();assert.equal(response.status,200,result.message);assert.equal(result.trialActive,true);assert.equal(result.entitlement.planCode,'studio');assert.equal(result.entitlement.canDownload,true);assert.equal(result.keys.length,2);}
  assert.equal((await f.db.query('select count(*)::int n from photography_keys')).rows[0].n,2);
  const key=(await f.db.query('select * from photography_keys order by slot_index')).rows[0];
  const app=f.load('@/lib/studio-os-app');const input={keyCode:key.key_code,deviceId:'test-computer',platform:'macos'};
  await app.activatePhotographyKey(f.service,input);await app.validatePhotographyKey(f.service,input);
  await assert.rejects(()=>app.activatePhotographyKey(f.service,{...input,deviceId:'second-computer'}),/already activated/);
  await f.db.query("update photographers set trial_ends_at=now()-interval '1 second'");
  await assert.rejects(()=>app.validatePhotographyKey(f.service,input),/not currently active/);
  assert.equal((await f.db.query("select count(*)::int n from photography_key_activations where status='active'")).rows[0].n,0);
  const response=await route.GET({headers:new Headers()});const result=await response.json();
  assert.equal(result.entitlement.canDownload,false);assert.equal(result.entitlement.totalAllowedKeys,0);
 }finally{await f.db.close();}
});

test('authorized five-account recovery is atomic, grants ten keys, preserves other accounts, and cannot replay',async()=>{
 const f=await fixture();try{
  const source=loadSource('scripts/recover-trials-2026-09-24.sql');
  const ids=[...source.matchAll(/'([0-9a-f-]{36})'/g)].map(m=>m[1]);assert.equal(ids.length,5);
  await f.db.exec('create table audit_log(action text,entity_type text,entity_id text,target_photographer_id uuid,"before" jsonb,"after" jsonb,metadata jsonb,result text)');
  for(const id of ids){const uid=crypto.randomUUID();await f.db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'recovery@example.invalid',now())",[uid]);await f.db.query('update photographers set id=$1 where user_id=$2',[id,uid]);}
  const unrelated=await f.profile();
  await f.db.query("update photographers set subscription_status='active' where id=$1",[ids[4]]);
  await assert.rejects(()=>f.db.exec(source),/preconditions changed/);await f.db.exec('rollback');
  assert.equal((await f.db.query('select count(*)::int n from photography_keys')).rows[0].n,0);
  assert.equal((await f.db.query('select count(*)::int n from audit_log')).rows[0].n,0);
  await f.db.query("update photographers set subscription_status='trial' where id=$1",[ids[4]]);
  await f.db.exec(source);
  assert.equal((await f.db.query('select count(*)::int n from photography_keys')).rows[0].n,10);
  assert.equal((await f.db.query('select count(*)::int n from audit_log')).rows[0].n,5);
  const rows=(await f.db.query('select * from photographers where id=any($1)',[ids])).rows;
  assert.ok(rows.every(p=>p.subscription_plan_code==='studio'&&Date.parse(p.trial_ends_at)-Date.parse(p.trial_starts_at)===30*86400000));
  assert.deepEqual(await f.profile(),unrelated);
  await assert.rejects(()=>f.db.exec(source),/preconditions changed/);await f.db.exec('rollback');
  assert.deepEqual((await f.db.query('select * from photographers where id=any($1)',[ids])).rows,rows);
 }finally{await f.db.close();}
});

const claim=async(f,device='mac-a')=>(await f.db.query('select * from claim_desktop_app_access($1)',[device])).rows[0];
const releaseDevice=async(f,device='mac-a')=>(await f.db.query('select release_desktop_app_access($1) released',[device])).rows[0].released;

test('native first login initializes and provisions without a website visit; sign-out frees the same key for reactivation',async()=>{
 const f=await fixture();try{
  assert.equal((await claim(f)).allowed,false);await f.confirm();
  const result=await claim(f);assert.equal(result.allowed,true);assert.equal(result.seat_limit,2);assert.equal(result.active_device_count,1);
  const before=await f.profile();const keys=(await f.db.query('select id,key_code from photography_keys order by slot_index')).rows;
  for(let i=0;i<3;i++){
   assert.equal(await releaseDevice(f),true);assert.equal(await releaseDevice(f),false);
   assert.equal((await claim(f)).allowed,true);
  }
  assert.deepEqual((await f.db.query('select id,key_code from photography_keys order by slot_index')).rows,keys);
  assert.deepEqual(await f.profile(),before);assert.equal((await f.db.query('select count(*)::int n from photography_key_activations')).rows[0].n,1);
 }finally{await f.db.close();}
});

test('native retries are idempotent, two devices fit, third is refused, and released seat is reusable',async()=>{
 const f=await fixture();try{await f.confirm();
  const repeated=await Promise.all(Array.from({length:6},()=>claim(f)));assert.ok(repeated.every(r=>r.allowed));
  assert.equal((await claim(f,'mac-b')).allowed,true);const denied=await claim(f,'mac-c');assert.equal(denied.allowed,false);assert.equal(denied.active_device_count,2);
  await releaseDevice(f);assert.equal((await claim(f,'mac-c')).allowed,true);
 }finally{await f.db.close();}
});

test('native policy matches web allowance, including paid extra keys, expiration, downgrade and owner bypass',async()=>{
 const f=await fixture();try{await f.confirm();await claim(f);
  for(const [status,plan,extra,owner,expected] of [['active','core',3,false,1],['active','studio',3,false,5],['trialing','core',0,false,1],['active','starter',9,false,0],['canceled','studio',0,false,0],['past_due','studio',0,false,0],['trial','studio',9,false,2],['active','studio',0,true,4]]){
   await f.db.query("update photographers set subscription_status=$1,subscription_plan_code=$2,extra_desktop_keys=$3,is_platform_admin=$4",[status,plan,extra,owner]);
   const result=await claim(f);const p=await f.profile();assert.equal(app.getAllowedPhotographyKeyCount(p),expected);
   assert.equal((await f.db.query("select count(*)::int n from photography_keys where status='active'")).rows[0].n,expected);
   assert.equal(result.allowed,expected>0);assert.equal(result.is_admin,owner);
   if(owner){for(let i=0;i<6;i++)assert.equal((await claim(f,'owner-'+i)).allowed,true);}
  }
  await f.db.query("update photographers set is_platform_admin=false,subscription_status='trial',trial_ends_at=now()-interval '1 second'");
  assert.equal((await claim(f)).allowed,false);assert.equal((await f.db.query("select count(*)::int n from photography_key_activations where status='active'")).rows[0].n,0);
 }finally{await f.db.close();}
});

test('stale legacy subscriptions cannot block a trial or revive canceled access',async()=>{
 const f=await fixture();try{await f.confirm();await f.db.query("insert into subscriptions(user_id,status,plan) values($1,'inactive','starter')",[userId]);assert.equal((await claim(f)).allowed,true);
 await f.db.query("update subscriptions set status='active',plan='studio'");await f.db.query("update photographers set subscription_status='canceled'");assert.equal((await claim(f)).allowed,false);
 }finally{await f.db.close();}
});

test('revoked key stays revoked, replacements preserve other codes and active devices',async()=>{
 const f=await fixture();try{await f.confirm();await claim(f);await claim(f,'mac-b');
 const keys=(await f.db.query('select * from photography_keys order by slot_index')).rows;
 await f.db.query("update photography_keys set status='revoked' where id=$1",[keys[0].id]);assert.equal((await claim(f)).allowed,true);
 assert.equal((await f.db.query('select status from photography_keys where id=$1',[keys[0].id])).rows[0].status,'revoked');
 assert.equal((await f.db.query('select key_code from photography_keys where id=$1',[keys[1].id])).rows[0].key_code,keys[1].key_code);
 assert.equal((await f.db.query("select status from photography_key_activations where photography_key_id=$1",[keys[0].id])).rows[0].status,'deactivated');
 assert.equal((await claim(f,'mac-b')).allowed,true);
 }finally{await f.db.close();}
});

test('key-code activation can reclaim a released device and never takes another device’s seat',async()=>{
 const f=await fixture();try{await f.confirm();await claim(f);
 const key=(await f.db.query('select * from photography_keys order by slot_index')).rows[0];
 const api=f.load('@/lib/studio-os-app');await releaseDevice(f);
 await api.activatePhotographyKey(f.service,{keyCode:key.key_code,deviceId:'mac-a'});
 await api.activatePhotographyKey(f.service,{keyCode:key.key_code,deviceId:'mac-a'});
 await assert.rejects(()=>api.activatePhotographyKey(f.service,{keyCode:key.key_code,deviceId:'mac-other'}),/already activated/);
 }finally{await f.db.close();}
});

test('native release and claim are caller-scoped and key maintenance is service-only',async()=>{
 const f=await fixture();try{await f.confirm();await claim(f);
 const other='22222222-2222-4222-8222-222222222222';await f.db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'second@example.invalid',now())",[other]);
 await f.db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);assert.equal(await releaseDevice(f),false);assert.equal((await claim(f)).allowed,true);
 assert.equal((await f.db.query("select count(*)::int n from photography_key_activations where status='active'")).rows[0].n,2);
 await f.db.exec('set role authenticated');await assert.rejects(()=>f.db.query('select * from sync_photography_keys($1)',[userId]),/permission denied/);
 await assert.rejects(()=>f.db.query('select activate_photography_key($1,$2)',[userId,'forged']),/permission denied/);await f.db.exec('reset role');
 await f.db.exec('set role anon');await assert.rejects(()=>claim(f),/permission denied/);await f.db.exec('reset role');
 }finally{await f.db.close();}
});
