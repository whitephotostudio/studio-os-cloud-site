import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { before, after } from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { localPinBudgetRedis } from '../helpers/pin-budget-redis.mjs';

const require = createRequire(import.meta.url), root = new URL('../../', import.meta.url);
const id = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const owner=id(1), otherOwner=id(2), schoolId=id(3), siblingSchool=id(4), projectId=id(5), collectionId=id(6);
const pin='synthetic-student-pin', email='parent@example.test';
const schoolCredentials={kind:'school',galleryId:schoolId,pin,email};
const eventCredentials={kind:'event',galleryId:projectId,pin:'synthetic-event-pin',email};
const digest=value=>createHash('sha256').update(value).digest('hex');
const migration=readFileSync(new URL('supabase/migrations/20261012110000_parent_gallery_sessions.sql',root),'utf8');
const sqlName=value=>{assert.match(value,/^[a-z_]+$/);return '"'+value+'"';};
let redis,fixtureNumber=0;
before(async()=>{redis=await localPinBudgetRedis();});
after(async()=>{await redis?.close();});

async function fixture({ inheritedClientAuthority=false }={}) {
  const db=new PGlite(), queries=[], counters=[],ip=`synthetic-ip-${++fixtureNumber}`;
  let unavailable=false, denied=null, malformedRpc=false;
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated;
    create table photographers(id uuid primary key);
    create table schools(id uuid primary key,photographer_id uuid,status text,portal_status text,expiration_date text);
    create table students(id uuid primary key,school_id uuid,pin text);
    create table projects(id uuid primary key,title text,workflow_type text,status text,email_required boolean,
      access_mode text,access_pin text,gallery_settings jsonb,photographer_id uuid,order_due_date text,expiration_date text,portal_status text);
    create table pre_release_emails(id uuid primary key,project_id uuid,email text);
    create table subjects(id uuid primary key,project_id uuid,external_ref text);
    create table collections(id uuid primary key,project_id uuid,slug text,kind text,access_mode text,access_pin text,sort_order integer);`);
  await db.query('insert into photographers values($1),($2)',[owner,otherOwner]);
  await db.query("insert into schools values($1,$3,'active','active',null),($2,$3,'active','active',null)",[schoolId,siblingSchool,owner]);
  await db.query('insert into students values($1,$2,$3),($4,$5,$6)',[id(10),schoolId,pin,id(11),siblingSchool,'synthetic-sibling-pin']);
  await db.query("insert into projects(id,title,workflow_type,status,email_required,access_mode,access_pin,photographer_id,portal_status) values($1,'Synthetic event','event','active',true,'pin',$2,$3,'active')",[projectId,eventCredentials.pin,owner]);
  await db.query("insert into collections values($1,$2,'synthetic-album','album','inherit_project',null,0)",[collectionId,projectId]);
  if(inheritedClientAuthority)await db.exec('grant service_role to authenticated');
  try {await db.exec(migration);}catch(error){await db.close();throw error;}
  await db.exec('set role service_role');
  const service={from(table) {
    queries.push(table);
    const where=[],args=[];let single=false,cap=1000,offset=0;
    const query={
      select(){return query;},
      eq(key,value){args.push(value);where.push(`${sqlName(key)}=$${args.length}`);return query;},
      is(key,value){assert.equal(value,null);where.push(`${sqlName(key)} is null`);return query;},
      in(key,values){args.push(values);where.push(`${sqlName(key)}=any($${args.length})`);return query;},
      order(){return query;},
      limit(value){cap=value;return query;},
      range(from,to){offset=from;cap=to-from+1;return query;},
      maybeSingle(){single=true;return query;},
      then(resolve,reject){
        if(unavailable)return Promise.resolve({data:null,error:{code:'SYNTHETIC_UNAVAILABLE'}}).then(resolve,reject);
        return db.query(`select * from ${sqlName(table)}${where.length?' where '+where.join(' and '):''} limit ${cap} offset ${offset}`,args)
          // Supabase/PostgREST returns timestamp columns as JSON strings.
          .then(result=>({data:JSON.parse(JSON.stringify(single?result.rows[0]??null:result.rows)),error:null}),error=>({data:null,error})).then(resolve,reject);
      },
    };return query;
  },async rpc(name,args){
    assert.equal(name,'register_parent_gallery_session');
    if(unavailable)return {data:null,error:{code:'SYNTHETIC_UNAVAILABLE'}};
    if(malformedRpc)return {data:{laneId:id(99),...malformedRpc},error:null};
    try {return {data:(await db.query('select public.register_parent_gallery_session($1,$2,$3,$4,$5,$6,$7) result',
      [args.p_token_hash,args.p_scope_hash,args.p_kind,args.p_gallery_id,args.p_photographer_id,args.p_pin,args.p_email])).rows[0].result,error:null};}
    catch(error){return {data:null,error};}
  }};
  const modules=new Map();
  function load(file){
    if(modules.has(file))return modules.get(file);
    const exports={};modules.set(file,exports);
    const output=ts.transpileModule(readFileSync(new URL(file,root),'utf8'),{
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    }).outputText;
    class SharedRedis{
      constructor(config){assert.equal(config.retry.retries,0);}
      async eval(script,keys,args){counters.push({script,keys,args});if(denied?.unavailable)throw Error('synthetic counter outage');if(denied)return[0,60000];return redis.eval(script,keys,args);}
    }
    const stubs={
      'server-only':{},'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
      '@/lib/dashboard-auth':{createDashboardServiceClient:()=>service},
      '@/lib/rate-limit':{getClientIp:()=>ip},
      '@upstash/redis':{Redis:SharedRedis},
    };
    new Function('require','exports','process',output)(name=>name in stubs?stubs[name]:name.startsWith('@/')?load(name.slice(2)+'.ts'):require(name),exports,
      {env:{NODE_ENV:'production',EVENT_DOWNLOAD_TOKEN_SECRET:'synthetic-parent-budget-secret',UPSTASH_REDIS_REST_URL:'https://synthetic.invalid',UPSTASH_REDIS_REST_TOKEN:'synthetic'}});
    return exports;
  }
  const helper=load('lib/parent-gallery-session.ts'),route=load('app/api/portal/session/route.ts');
  const request=({method='POST',body=schoolCredentials,cookie='',query='',headers={}}={})=>new Request('https://fixture.test/api/portal/session'+query,{
    method,headers:{origin:'https://fixture.test','sec-fetch-site':'same-origin','content-type':'application/json',cookie,...headers},
    ...(['GET','HEAD'].includes(method)?{}:{body:typeof body==='string'?body:JSON.stringify(body)}),
  });
  async function bootstrap(credentials=schoolCredentials,cookie=''){
    const response=await route.POST(request({body:credentials,cookie}));
    const body=await response.json();
    const sessionCookie=(response.headers.getSetCookie?.()??[response.headers.get('set-cookie')]).find(value=>value?.startsWith('__Host-studio_os_parent_session='))?.split(';')[0];
    return {response,body,cookie:sessionCookie};
  }
  async function admin(sql,args=[]){await db.exec('reset role');try{return await db.query(sql,args);}finally{await db.exec('set role service_role');}}
  return {db,helper,route,request,bootstrap,admin,queries,counters,
    setUnavailable:value=>{unavailable=value;},setDenied:value=>{denied=value;},setMalformedRpc:value=>{malformedRpc=value;}};
}

test('actual bootstrap stores only a token hash, returns no PIN, and resolves separate sibling lanes with one host cookie',async()=>{
  const f=await fixture();try{
    const first=await f.bootstrap();assert.equal(first.response.status,200);
    assert.deepEqual(Object.keys(first.body).sort(),['ok','laneId','kind','galleryId','viewerEmail','photographerId','expiresAt','galleryUrl'].sort());
    assert.equal(first.body.galleryUrl,'/parents/view/'+first.body.laneId);assert.equal(first.body.viewerEmail,email);
    assert.ok(Date.parse(first.body.expiresAt)>Date.now()+86300000&&Date.parse(first.body.expiresAt)<=Date.now()+86401000);
    assert.ok(!JSON.stringify(first.body).includes(pin));
    const setCookie=first.response.headers.get('set-cookie');
    for(const flag of ['Path=/','HttpOnly','SameSite=Lax','Secure','Max-Age=86400'])assert.ok(setCookie.includes(flag));
    assert.ok(!setCookie.includes(pin)&&!setCookie.includes(email));
    const token=first.cookie.split('=')[1];assert.equal(Buffer.from(token,'base64url').length,32);
    const rows=(await f.admin('select * from parent_gallery_sessions')).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].token_hash,digest(token));assert.ok(!JSON.stringify(rows).includes(token));
    const sibling=await f.bootstrap({...schoolCredentials,galleryId:siblingSchool,pin:'synthetic-sibling-pin'},first.cookie);
    assert.equal(sibling.response.status,200);assert.equal(sibling.cookie,first.cookie);assert.notEqual(sibling.body.laneId,first.body.laneId);
    const again=await f.bootstrap(schoolCredentials,first.cookie);assert.equal(again.body.laneId,first.body.laneId);
    for(const granted of [first,sibling]){
      const resolved=await f.helper.resolveParentGallerySession(f.request({method:'GET',cookie:first.cookie}),granted.body.laneId);
      assert.equal(resolved.galleryId,granted.body.galleryId);assert.equal(resolved.photographerId,owner);
      const get=await f.route.GET(f.request({method:'GET',cookie:first.cookie,query:'?parentLaneId='+granted.body.laneId}));
      assert.equal(get.status,200);assert.ok(!JSON.stringify(await get.json()).includes(resolved.pin));
      assert.equal(get.headers.get('cache-control'),'private, no-store');
    }
    assert.equal((await f.admin('select count(*) n from parent_gallery_sessions')).rows[0].n,2);
    assert.equal(f.helper.parentSessionCookieBinding(f.request({cookie:first.cookie})),digest(token));
  }finally{await f.db.close();}
});

test('session lookup denies cross-browser, forged/malformed/duplicate cookies, missing cookies and the old budget cookie',async()=>{
  const f=await fixture();try{
    const first=await f.bootstrap(),other=await f.bootstrap();
    const oldBudget=first.response.headers.getSetCookie().find(value=>value.startsWith('studio_os_parent_pin_budget='))?.split(';')[0];
    for(const cookie of ['',other.cookie,'__Host-studio_os_parent_session=short',first.cookie+'; '+first.cookie,
      '__Host-studio_os_parent_session='+randomBytes(32).toString('base64url'),oldBudget]){
      await assert.rejects(()=>f.helper.resolveParentGallerySession(f.request({method:'GET',cookie}),first.body.laneId),error=>error.status===401);
    }
    const withoutCookie=await f.route.GET(f.request({method:'GET',query:'?parentLaneId='+first.body.laneId+'&token='+first.cookie.split('=')[1]}));
    assert.equal(withoutCookie.status,401,'URL tokens cannot authenticate');
  }finally{await f.db.close();}
});

test('live school PIN, school boundary, owner, expiry and revocation are rechecked on every resolve',async()=>{
  const f=await fixture();try{
    const first=await f.bootstrap(),req=f.request({method:'GET',cookie:first.cookie});
    await f.admin('update students set pin=$1 where school_id=$2',['changed-synthetic-pin',schoolId]);
    await assert.rejects(()=>f.helper.resolveParentGallerySession(req,first.body.laneId),error=>error.status===404);
    await f.admin('update students set pin=$1 where school_id=$2',[pin,schoolId]);
    await f.admin('update schools set photographer_id=$1 where id=$2',[otherOwner,schoolId]);
    await assert.rejects(()=>f.helper.resolveParentGallerySession(req,first.body.laneId),error=>error.status===403);
    await f.admin('update schools set photographer_id=$1,portal_status=$2 where id=$3',[owner,'pre_release',schoolId]);
    await assert.rejects(()=>f.helper.resolveParentGallerySession(req,first.body.laneId),error=>error.status===409);
    await f.admin("update schools set portal_status='active',expiration_date='2000-01-01' where id=$1",[schoolId]);
    await assert.rejects(()=>f.helper.resolveParentGallerySession(req,first.body.laneId),error=>error.status===409);
    await f.admin('update schools set expiration_date=null where id=$1',[schoolId]);
    await f.admin("update parent_gallery_sessions set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",[first.body.laneId]);
    await assert.rejects(()=>f.helper.resolveParentGallerySession(req,first.body.laneId),error=>error.status===401);
    await f.admin("update parent_gallery_sessions set expires_at=now()+interval '24 hours',revoked_at=now() where id=$1",[first.body.laneId]);
    await assert.rejects(()=>f.helper.resolveParentGallerySession(req,first.body.laneId),error=>error.status===401);
  }finally{await f.db.close();}
});

test('event sessions use the actual event whitelist, collection/subject/project PIN and closed-gallery validator',async()=>{
  const f=await fixture();try{
    const first=await f.bootstrap(eventCredentials);assert.equal(first.response.status,200);
    await f.admin('insert into pre_release_emails values($1,$2,$3)',[id(70),projectId,'other@example.test']);
    await assert.rejects(()=>f.helper.resolveParentGallerySession(f.request({method:'GET',cookie:first.cookie}),first.body.laneId),error=>error.status===403);
    await f.admin('insert into pre_release_emails values($1,$2,$3)',[id(71),projectId,email]);
    assert.equal((await f.helper.resolveParentGallerySession(f.request({method:'GET',cookie:first.cookie}),first.body.laneId)).kind,'event');
    await f.admin("update projects set access_pin='changed-synthetic-pin' where id=$1",[projectId]);
    await assert.rejects(()=>f.helper.resolveParentGallerySession(f.request({method:'GET',cookie:first.cookie}),first.body.laneId),error=>error.status===404);
    await f.admin('insert into subjects values($1,$2,$3)',[id(72),projectId,eventCredentials.pin]);
    assert.equal((await f.helper.resolveParentGallerySession(f.request({method:'GET',cookie:first.cookie}),first.body.laneId)).kind,'event');
    await f.admin("update projects set portal_status='closed' where id=$1",[projectId]);
    await assert.rejects(()=>f.helper.resolveParentGallerySession(f.request({method:'GET',cookie:first.cookie}),first.body.laneId),error=>error.status===403);
    assert.equal((await f.bootstrap(eventCredentials)).response.status,403);
  }finally{await f.db.close();}
});

test('session queries and parsed adapter scopes reject raw credentials, duplicate selectors and foreign gallery aliases',async()=>{
  const f=await fixture();try{
    const first=await f.bootstrap(),request=f.request({method:'GET',cookie:first.cookie});
    const scope=await f.helper.resolveParentGallerySession(request,first.body.laneId);
    f.helper.assertParentSessionScope(request,scope,{parentLaneId:scope.laneId,mode:'school',schoolId});
    for(const fields of [{pin},{email},{pin:''},{email:undefined},{parentLaneId:id(99)},{mode:'event'},
      {schoolId:siblingSchool},{projectId:schoolId},{eventId:schoolId},{kind:'event'},{galleryId:siblingSchool}]){
      assert.throws(()=>f.helper.assertParentSessionScope(request,scope,fields),error=>error.status===400);
    }
    for(const query of ['?pin='+pin,'?email='+email,'?schoolId='+siblingSchool,
      '?projectId='+schoolId,'?mode=event','?parentLaneId='+scope.laneId+'&parentLaneId='+scope.laneId,
      '?schoolId='+schoolId+'&schoolId='+schoolId]){
      await assert.rejects(()=>f.helper.resolveParentGallerySession(f.request({method:'GET',cookie:first.cookie,query}),scope.laneId),error=>error.status===400);
    }
  }finally{await f.db.close();}
});

test('bootstrap and cookie-authenticated mutations require exact browser origin; untrusted credentials never create a session',async()=>{
  const f=await fixture();try{
    for(const headers of [{origin:'https://foreign.test'},{origin:'null'},{origin:'https://fixture.test','sec-fetch-site':'cross-site'},
      {origin:'https://fixture.test','sec-fetch-site':'same-site'},{origin:'','sec-fetch-site':''}]){
      const response=await f.route.POST(f.request({headers}));assert.equal(response.status,403);
    }
    assert.equal((await f.admin('select count(*) n from parent_gallery_sessions')).rows[0].n,0);
    assert.equal((await f.bootstrap({...schoolCredentials,pin:'incorrect'})).response.status,404);
    assert.equal((await f.bootstrap({...schoolCredentials,galleryId:siblingSchool})).response.status,404);
    const valid=await f.bootstrap();assert.equal(valid.response.status,200);
    await assert.rejects(()=>f.helper.resolveParentGallerySession(f.request({cookie:valid.cookie,headers:{origin:'https://foreign.test'}}),valid.body.laneId),error=>error.status===403);
  }finally{await f.db.close();}
});

test('malformed, oversized and ambiguous bootstrap bodies fail closed before validation or cookie issuance',async()=>{
  const f=await fixture();try{
    for(const body of ['{','null','[]','true','"string"',JSON.stringify({...schoolCredentials,pin:4}),
      JSON.stringify({...schoolCredentials,schoolId}),JSON.stringify({...schoolCredentials,token:'synthetic-token'}),
      JSON.stringify({...schoolCredentials,pin:'x'.repeat(9000)})]){
      const before=f.queries.length,response=await f.route.POST(f.request({body}));assert.equal(response.status,400);
      assert.equal(response.headers.get('set-cookie'),null);assert.equal(f.queries.length,before);
    }
    const withQuery=await f.route.POST(f.request({query:'?pin='+pin}));assert.equal(withQuery.status,400);
  }finally{await f.db.close();}
});

test('the bootstrap uses the shared durable PIN budget and never treats proof as gallery authorization',async()=>{
  const f=await fixture();try{
    f.setDenied({allowed:false,unavailable:true,resetAt:Date.now()+30000});
    const outage=await f.bootstrap();assert.equal(outage.response.status,503);assert.ok(Number(outage.response.headers.get('retry-after'))>0);assert.deepEqual(f.queries,[]);
    assert.ok(f.counters.every(counter=>counter.script.includes('short >= 10')&&counter.script.includes('long >= 60')));
    f.setDenied({allowed:false,resetAt:Date.now()+60000});assert.equal((await f.bootstrap()).response.status,429);
    f.setDenied(null);const valid=await f.bootstrap();
    const cookies=valid.response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const before=f.counters.length;assert.equal((await f.bootstrap(schoolCredentials,cookies)).response.status,200);
    assert.equal(f.counters.length,before,'matching proof exempts repeated valid credentials from the attempt counter');
    await f.admin("update students set pin='changed-synthetic-pin' where school_id=$1",[schoolId]);
    assert.equal((await f.bootstrap(schoolCredentials,cookies)).response.status,404,'proof never authorizes a changed PIN');
  }finally{await f.db.close();}
});

test('store outages and malformed registration results never issue cookies or expose credentials',async()=>{
  const f=await fixture();try{
    const valid=await f.bootstrap();f.setUnavailable(true);
    const get=await f.route.GET(f.request({method:'GET',cookie:valid.cookie,query:'?parentLaneId='+valid.body.laneId}));
    assert.equal(get.status,503);assert.ok(!JSON.stringify(await get.json()).includes(pin));
    const failed=await f.bootstrap();assert.equal(failed.response.status,503);assert.equal(failed.response.headers.get('set-cookie'),null);
    f.setUnavailable(false);
    for(const malformed of [{},{kind:'school',galleryId:schoolId,photographerId:owner,viewerEmail:email,expiresAt:'invalid'},
      {kind:'school',galleryId:siblingSchool,photographerId:owner,viewerEmail:email,expiresAt:new Date(Date.now()+86400000).toISOString()}]){
      f.setMalformedRpc(malformed);const result=await f.bootstrap();assert.equal(result.response.status,503);assert.equal(result.response.headers.get('set-cookie'),null);
    }
  }finally{await f.db.close();}
});

test('correct bootstrap credentials refund their reservation even if session registration subsequently fails',async()=>{
  const f=await fixture();try{
    f.setMalformedRpc({});
    const result=await f.bootstrap();assert.equal(result.response.status,503);
    const held=f.counters.find(counter=>counter.script.includes("redis.call('INCR'"));
    assert.ok(held);assert.equal(await redis.command('GET',held.keys[0]),'0');assert.equal(await redis.command('GET',held.keys[1]),'0');
    const failed=await f.bootstrap({...schoolCredentials,pin:'synthetic-wrong-pin'});assert.equal(failed.response.status,404);
    assert.equal(await redis.command('GET',held.keys[0]),'1');assert.equal(await redis.command('GET',held.keys[1]),'1');
  }finally{await f.db.close();}
});

test('legacy Stripe checkout bootstrap cannot bypass the same durable PIN counter',async()=>{
  const f=await fixture();try{
    const request=()=>new Request('https://fixture.test/api/stripe/checkout',{method:'POST',headers:{origin:'https://fixture.test','sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify({synthetic:'order'})});
    f.setDenied({unavailable:true});
    await assert.rejects(()=>f.helper.bootstrapParentGallerySession(request(),schoolCredentials),error=>error.status===503);
    assert.deepEqual(f.queries,[]);
    f.setDenied(null);const valid=await f.helper.bootstrapParentGallerySession(request(),schoolCredentials);assert.equal(valid.grant.kind,'school');
    const keys=f.counters.find(counter=>counter.script.includes("redis.call('INCR'")).keys;
    assert.equal(await redis.command('GET',keys[0]),'0');assert.equal(await redis.command('GET',keys[1]),'0');
    await assert.rejects(()=>f.helper.bootstrapParentGallerySession(request(),{...schoolCredentials,pin:'wrong'}),error=>error.status===404);
    assert.equal(await redis.command('GET',keys[0]),'1');assert.equal(await redis.command('GET',keys[1]),'1');
  }finally{await f.db.close();}
});

test('API budget lanes require a current registered browser binding and never replace current gallery authorization',async()=>{
  const f=await fixture();try{
    const first=await f.bootstrap(),other=await f.bootstrap(),sibling=await f.bootstrap({...schoolCredentials,galleryId:siblingSchool,pin:'synthetic-sibling-pin'},first.cookie);
    const req=(lane=first.body.laneId,cookie=first.cookie)=>new Request('https://fixture.test/api/portal/yearbook?parentLaneId='+lane,{headers:{cookie}});
    const key=await f.helper.parentSessionRateBudgetKey(req());assert.match(key,/^parent-session:[a-f0-9]{64}$/);
    assert.equal(await f.helper.parentSessionRateBudgetKey(req()),key);
    assert.notEqual(await f.helper.parentSessionRateBudgetKey(req(sibling.body.laneId)),key);
    assert.equal(key.includes(first.body.laneId)||key.includes(pin)||key.includes(email),false);
    for(const request of [req(first.body.laneId,other.cookie),req(first.body.laneId,''),req(id(999)),
      new Request(req().url+'&parentLaneId='+first.body.laneId,{headers:{cookie:first.cookie}}),
      new Request('https://fixture.test/api/portal/session?parentLaneId='+first.body.laneId,{headers:{cookie:first.cookie}})]){
      assert.equal(await f.helper.parentSessionRateBudgetKey(request),null);
    }
    await f.admin('update students set pin=$1 where school_id=$2',['synthetic-pin-changed',schoolId]);
    assert.equal(await f.helper.parentSessionRateBudgetKey(req()),key,'budget is a registered-lane proof only');
    await assert.rejects(()=>f.helper.resolveParentGallerySession(req(),first.body.laneId),error=>error.status===404);
    await f.admin('update parent_gallery_sessions set revoked_at=now() where id=$1',[first.body.laneId]);
    assert.equal(await f.helper.parentSessionRateBudgetKey(req()),null);
    f.setUnavailable(true);assert.equal(await f.helper.parentSessionRateBudgetKey(req(sibling.body.laneId)),null);
  }finally{await f.db.close();}
});

test('API budget body selection is bounded, accepts combined first lane, and preserves the original request body',async()=>{
  const f=await fixture();try{
    const first=await f.bootstrap();
    const req=(body,query='')=>new Request('https://fixture.test/api/portal/orders/create-combined'+query,{method:'POST',headers:{cookie:first.cookie,'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
    const body={groups:[{parentLaneId:first.body.laneId,entries:[{synthetic:'choice'}]}]};
    const request=req(body),key=await f.helper.parentSessionRateBudgetKey(request);assert.match(key,/^parent-session:/);
    assert.deepEqual(await request.json(),body,'budget inspection must not consume a checkout body');
    for(const request of [req('{'),req(null),req({groups:Array.from({length:33},()=>body.groups[0])}),
      req({...body,parentLaneId:'malformed'}),req(body,'?parentLaneId='+id(999)),req({...body,padding:'x'.repeat(32768)})]){
      assert.equal(await f.helper.parentSessionRateBudgetKey(request),null);
    }
    const slow=new Request('https://fixture.test/api/portal/orders/create-combined',{method:'POST',headers:{cookie:first.cookie},body:new ReadableStream(),duplex:'half'});
    const started=Date.now();assert.equal(await f.helper.parentSessionRateBudgetKey(slow),null);
    assert.ok(Date.now()-started<3000,'an incomplete clone cannot hold the proxy budget read open');
    await slow.body.cancel();
    await f.admin("update parent_gallery_sessions set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",[first.body.laneId]);
    assert.equal(await f.helper.parentSessionRateBudgetKey(req(body)),null);
  }finally{await f.db.close();}
});

test('actual registration SQL deduplicates queued grants, bounds 32 lanes and retains expired cart lane identities',async()=>{
  const f=await fixture();try{
    const tokenHash=digest('synthetic-browser'),scopeHash=digest('synthetic-exact-scope');
    const register=(scope=scopeHash,selectedPin=pin)=>f.db.query('select public.register_parent_gallery_session($1,$2,$3,$4,$5,$6,$7) result',
      [tokenHash,scope,'school',schoolId,owner,selectedPin,email]).then(result=>result.rows[0].result);
    const concurrent=await Promise.all(Array.from({length:12},()=>register()));
    assert.equal(new Set(concurrent.map(row=>row.laneId)).size,1);
    const first=concurrent[0];
    await f.admin("update parent_gallery_sessions set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",[first.laneId]);
    assert.equal((await register()).laneId,first.laneId,'a freshly revalidated exact scope retains its cart lane');
    const more=await Promise.allSettled(Array.from({length:40},(_,index)=>register(digest('scope-'+index),'synthetic-pin-'+index)));
    assert.equal(more.filter(result=>result.status==='fulfilled').length,31);
    assert.equal(more.filter(result=>result.status==='rejected').length,9);
    assert.ok(more.filter(result=>result.status==='rejected').every(result=>result.reason.message==='PARENT_SESSION_CAPACITY'));
    assert.equal((await f.db.query('select count(*) n from parent_gallery_sessions where token_hash=$1',[tokenHash])).rows[0].n,32);
    await f.admin("update parent_gallery_sessions set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where token_hash=$1",[tokenHash]);
    await assert.rejects(()=>register(digest('extra-scope'),'extra-pin'),/PARENT_SESSION_CAPACITY/);
    assert.equal((await f.db.query('select count(*) n from parent_gallery_sessions where token_hash=$1',[tokenHash])).rows[0].n,32,'no silent expired-lane eviction');
    await assert.rejects(()=>register(scopeHash,'changed-pin'),/PARENT_SESSION_INVALID/);
  }finally{await f.db.close();}
});

test('actual migration denies all client table privileges and RPC execution, despite permissive defaults',async()=>{
  const f=await fixture();try{
    await f.db.exec('reset role');
    const protection=(await f.db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='public.parent_gallery_sessions'::regclass")).rows[0];
    assert.deepEqual(protection,{relrowsecurity:true,relforcerowsecurity:true});
    const fn=(await f.db.query("select prosecdef,proconfig from pg_proc where proname='register_parent_gallery_session'")).rows[0];
    assert.equal(fn.prosecdef,true);assert.ok(fn.proconfig.includes('search_path=""'));
    for(const role of ['anon','authenticated']){
      for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES']){
        assert.equal((await f.db.query('select has_table_privilege($1,$2,$3) allowed',[role,'public.parent_gallery_sessions',privilege])).rows[0].allowed,false);
      }
      await f.db.exec('set role '+role);
      await assert.rejects(()=>f.db.query('select * from parent_gallery_sessions'),/permission denied/);
      await assert.rejects(()=>f.db.query("select public.register_parent_gallery_session(repeat('a',64),repeat('b',64),'school',$1,$2,$3,$4)",[schoolId,owner,pin,email]),/permission denied/);
      await f.db.exec('reset role');
    }
    await f.db.exec('set role service_role');
    await assert.rejects(()=>f.db.query('delete from parent_gallery_sessions'),/permission denied/);
  }finally{await f.db.close();}
});

test('migration fails closed on unexpected inherited client authority',async()=>{
  await assert.rejects(()=>fixture({inheritedClientAuthority:true}),/Unexpected parent session privilege/);
});
