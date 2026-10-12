import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const require=createRequire(import.meta.url),root=new URL('../../',import.meta.url);
const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),otherOwner=id(2),school=id(3),siblingSchool=id(4),project=id(5),student=id(6),siblingStudent=id(7),order=id(8),sibling=id(9),group=id(10);
const token='A'.repeat(43),otherToken='B'.repeat(43),hash=v=>createHash('sha256').update(v).digest('hex');
const sql=readFileSync(new URL('supabase/migrations/20261012120000_parent_checkout_returns.sql',root),'utf8');
const name=v=>{assert.match(v,/^[a-z_]+$/);return '"'+v+'"';};
async function fixture({event=false,combined=false}={}) {
 const db=new PGlite(),providerCalls=[],rpcCalls=[];let providerOverride={};
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 grant usage on schema public to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated;
 create table photographers(id uuid primary key,stripe_connected_account_id text,stripe_account_id text);
 create table schools(id uuid primary key,photographer_id uuid);
 create table students(id uuid primary key,school_id uuid,pin text);
 create table projects(id uuid primary key,photographer_id uuid);
 create table orders(id uuid primary key,photographer_id uuid,order_group_id uuid,school_id uuid,project_id uuid,student_id uuid,
 customer_email text,parent_email text,stripe_checkout_session_id text,total_cents integer,total_amount numeric,currency text);`);
 await db.query('insert into photographers values($1,$2,null),($3,$4,null)',[owner,'acct_fixture',otherOwner,'acct_other']);
 await db.query('insert into schools values($1,$3),($2,$3)',[school,siblingSchool,owner]);
 await db.query('insert into students values($1,$2,$3),($4,$5,$6)',[student,school,'student-fixture-pin',siblingStudent,siblingSchool,'sibling-fixture-pin']);
 await db.query('insert into projects values($1,$2)',[project,owner]);
 await db.exec(readFileSync(new URL('supabase/migrations/20261012110000_parent_gallery_sessions.sql',root),'utf8'));
 await db.exec(sql);
 const orders=[{id:order,photographer_id:owner,order_group_id:combined?group:null,school_id:event?null:school,project_id:event?project:null,
 student_id:event?null:student,customer_email:'edited-buyer@example.test',parent_email:'edited-buyer@example.test',stripe_checkout_session_id:null,total_cents:1000,total_amount:10,currency:'cad'}];
 if(combined)orders.push({...orders[0],id:sibling,school_id:event?null:siblingSchool,student_id:event?null:siblingStudent});
 for(const row of orders)await db.query('insert into orders values('+Object.keys(row).map((_,i)=>'$'+(i+1)).join(',')+')',Object.values(row));
 const signatures={record_parent_order_session_access:['p_token_hash','p_lane_ids','p_order_ids'],register_parent_checkout_return:['p_token_hash','p_return_lane_id','p_anchor_order_id','p_order_ids','p_attempt_key','p_allow_legacy_school'],bind_parent_checkout_return:['p_return_id','p_token_hash','p_session_id']};
 await db.exec('set role service_role');
 const service={from(table){const where=[],args=[];let single=false,limit=1000;const q={select(){return q;},eq(k,v){args.push(v);where.push(`${name(k)}=$${args.length}`);return q;},in(k,v){args.push(v);where.push(`${name(k)}=any($${args.length})`);return q;},contains(k,v){args.push(v);where.push(`${name(k)} @> $${args.length}::uuid[]`);return q;},is(k,v){assert.equal(v,null);where.push(`${name(k)} is null`);return q;},limit(v){limit=v;return q;},maybeSingle(){single=true;return q;},then(resolve,reject){return db.query(`select * from ${name(table)}${where.length?' where '+where.join(' and '):''} limit ${limit}`,args).then(result=>({data:JSON.parse(JSON.stringify(single?result.rows[0]??null:result.rows)),count:result.rows.length,error:null}),error=>({data:null,error})).then(resolve,reject);}};return q;},async rpc(fn,args){rpcCalls.push(fn);try{return{data:(await db.query(`select public.${name(fn)}(${signatures[fn].map((_,i)=>'$'+(i+1)).join(',')}) result`,signatures[fn].map(k=>args[k]))).rows[0].result,error:null};}catch(error){return{data:null,error};}}};
 async function admin(query,args=[]){await db.exec('reset role');try{return await db.query(query,args);}finally{await db.exec('set role service_role');}}
 async function lane({kind=event?'event':'school',galleryId=event?project:school,pin=event?'event-fixture-pin':'student-fixture-pin',cookie=token,ownerId=owner}={}) {
 const result=await admin('select public.register_parent_gallery_session($1,$2,$3,$4,$5,$6,$7) result',[hash(cookie),hash(JSON.stringify([kind,galleryId,ownerId,pin,'viewer@example.test'])),kind,galleryId,ownerId,pin,'viewer@example.test']);
 const v=result.rows[0].result;return{laneId:v.laneId,kind,galleryId,photographerId:ownerId,pin,email:'viewer@example.test',expiresAt:v.expiresAt};}
 const binding=req=>{const m=(req.headers.get('cookie')||'').match(/^fixture=([AB]{43})$/);return m?hash(m[1]):null;};
 async function resolve(req,laneId){const found=await service.from('parent_gallery_sessions').select().eq('id',laneId).eq('token_hash',binding(req)).is('revoked_at',null).maybeSingle();const l=found.data;if(!l||Date.parse(l.expires_at)<=Date.now())throw Error('Denied');
 if(l.gallery_kind==='school'){const st=await service.from('students').select().eq('school_id',l.gallery_id).eq('pin',l.pin);const sc=await service.from('schools').select().eq('id',l.gallery_id).maybeSingle();if(!st.data.length||sc.data?.photographer_id!==l.photographer_id)throw Error('Denied');}
 return{laneId:l.id,kind:l.gallery_kind,galleryId:l.gallery_id,photographerId:l.photographer_id,pin:l.pin,email:l.viewer_email,expiresAt:l.expires_at};}
 function load(file){const exports={};const js=ts.transpileModule(readFileSync(new URL(file,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',js)(dep=>({'server-only':{},'@/lib/dashboard-auth':{createDashboardServiceClient:()=>service},'@/lib/parent-gallery-session':{parentSessionCookieBinding:binding,resolveParentGallerySession:resolve,bootstrapParentGallerySession:()=>assert.fail('Session fixture must use authenticated scope')},'@/lib/payments':{getConnectedAccountId:p=>p.stripe_connected_account_id,retrieveCheckoutSession:async(s,a)=>{providerCalls.push([s,a]);return{id:'cs_fixture_bound',mode:'payment',status:'complete',payment_status:'paid',amount_total:orders.length*1000,currency:'cad',client_reference_id:order,metadata:{billing_flow:'customer_order',photographer_id:owner,order_id:order,...(combined?{order_group_id:group}:{})},...providerOverride};}}}[dep]??(dep.startsWith('@/')?load(dep.slice(2)+'.ts'):require(dep))),exports);return exports;}
 const helper=load('lib/parent-checkout-return.ts');
 const request=(cookie=token,path='/api/stripe/checkout',method='POST')=>new Request('https://fixture.test'+path,{method,headers:{cookie:'fixture='+cookie,origin:'https://fixture.test'}});
 const originalLane=await lane();
 async function attest(scopes=[originalLane],cookie=token,ids=orders.map(o=>o.id)){return helper.recordParentOrderSessionAccess(request(cookie),scopes,{ok:true,orderIds:ids,primaryOrderId:ids[0]});}
 async function access(scope=originalLane,cookie=token,fields={}){return helper.authorizeParentCheckout(request(cookie),service,orders,fields,scope);}
 async function registered(){await attest(combined&&!event?[originalLane,await lane({galleryId:siblingSchool,pin:'sibling-fixture-pin'})]:[originalLane]);const a=await access();const r=await helper.registerParentCheckoutReturn(service,a,orders,order,null);await helper.bindParentCheckoutReturn(service,a,r.returnId,'cs_fixture_bound');await admin("update orders set stripe_checkout_session_id='cs_fixture_bound'");return{...r,access:a};}
 return{db,service,helper,orders,originalLane,request,lane,admin,attest,access,registered,rpcCalls,providerCalls,setProvider:v=>providerOverride=v};
}

test('actual SQL gives client roles no table privileges or issuer RPCs; service has read-only tables',async()=>{const f=await fixture();try{for(const role of ['anon','authenticated']){await f.db.exec('reset role; set role '+role);for(const table of ['parent_order_session_access','parent_checkout_returns'])await assert.rejects(()=>f.db.query('select * from '+table),/permission denied/);await assert.rejects(()=>f.db.query('select record_parent_order_session_access($1,$2,$3)',[hash(token),[f.originalLane.laneId],[order]]),/permission denied/);}await f.db.exec('reset role; set role service_role');await assert.rejects(()=>f.db.query('delete from parent_checkout_returns'),/permission denied/);}finally{await f.db.close();}});

test('edited buyer email remains independent of viewer; event attestation and exact group scopes persist immutably',async()=>{for(const event of [false,true]){const f=await fixture({event,combined:true});try{const scopes=event?[f.originalLane]:[f.originalLane,await f.lane({galleryId:siblingSchool,pin:'sibling-fixture-pin'})];await f.attest(scopes);await f.attest(scopes);assert.equal((await f.admin('select count(*) n from parent_order_session_access')).rows[0].n,2);const a=await f.access();assert.equal(a.hasProvenance,true);assert.notEqual(a.scope.email,f.orders[0].customer_email);await assert.rejects(()=>f.attest(scopes,otherToken),/basket/);await assert.rejects(()=>f.attest(scopes,token,[order]),/basket/);await f.admin('update orders set photographer_id=$1 where id=$2',[otherOwner,sibling]);await assert.rejects(()=>f.attest(scopes),/basket/);}finally{await f.db.close();}}});

test('unmapped school checkout needs its saved student PIN; event draft cannot get a new return even with receipt contact',async()=>{const f=await fixture();try{const a=await f.access();assert.equal(a.legacySchool,true);assert.equal(a.hasProvenance,false);await f.helper.registerParentCheckoutReturn(f.service,a,f.orders,order,null);const unrelated=await f.lane({galleryId:siblingSchool,pin:'sibling-fixture-pin'});await assert.rejects(()=>f.access(unrelated),/basket/);await assert.rejects(()=>f.helper.authorizeParentCheckout(f.request(),f.service,f.orders,{},null),/basket/);}finally{await f.db.close();}const e=await fixture({event:true});try{await assert.rejects(()=>e.access(),/basket/);const a=await e.access(e.originalLane,token,{customerEmail:e.orders[0].customer_email});assert.equal(a.hasProvenance,false);await assert.rejects(()=>e.helper.registerParentCheckoutReturn(e.service,a,e.orders,order,null),err=>err.status===409);}finally{await e.db.close();}});

test('return registration reuses exact attempt/lane across retries and rejects browser, membership or session replacement',async()=>{const f=await fixture({combined:true});try{const r=await f.registered();const again=await f.helper.registerParentCheckoutReturn(f.service,r.access,f.orders,order,null);assert.equal(again.returnId,r.returnId);const current=await f.lane({galleryId:siblingSchool,pin:'sibling-fixture-pin'});const a=await f.access(current);const switched=await f.helper.registerParentCheckoutReturn(f.service,a,f.orders,order,null);assert.equal(switched.laneId,r.laneId);await assert.rejects(()=>f.helper.bindParentCheckoutReturn(f.service,a,r.returnId,'cs_fixture_other'),/basket/);const foreign=await f.lane({cookie:otherToken});await assert.rejects(()=>f.access(foreign,otherToken),/basket/);await assert.rejects(()=>f.helper.registerParentCheckoutReturn(f.service,a,[f.orders[0]],order,null),/basket/);assert.equal(await f.helper.hasMappedParentCheckout(f.service,order,'cs_fixture_bound'),true);assert.equal(await f.helper.hasMappedParentCheckout(f.service,sibling,'cs_fixture_other'),false);}finally{await f.db.close();}});

test('success return is browser and lane bound, verifies connected provider proof, and exposes only a clean in-memory handle',async()=>{const f=await fixture({combined:true});try{const r=await f.registered();const landing=f.request(token,`/parents/checkout-return/${r.returnId}?result=success&session_id=cs_fixture_bound`,'GET');const resolved=await f.helper.resolveParentCheckoutReturn(landing,r.returnId);assert.deepEqual(resolved,{returnId:r.returnId,laneId:r.laneId,status:'success',sessionId:'cs_fixture_bound'});assert.deepEqual(f.providerCalls,[['cs_fixture_bound','acct_fixture']]);const urls=f.helper.parentCheckoutReturnUrls('https://fixture.test',r.returnId);for(const url of Object.values(urls)){assert.ok(!url.includes(f.originalLane.pin)&&!url.includes(f.originalLane.email));assert.ok(url.includes('/parents/checkout-return/'));}assert.ok(urls.successUrl.endsWith('session_id={CHECKOUT_SESSION_ID}'));await assert.rejects(()=>f.helper.resolveParentCheckoutReturn(f.request(otherToken,landing.url.replace('https://fixture.test',''),'GET'),r.returnId));await assert.rejects(()=>f.helper.resolveParentCheckoutReturn(landing,r.returnId,id(99)));await assert.rejects(()=>f.helper.resolveParentCheckoutReturn(f.request(token,`/parents/checkout-return/${r.returnId}?result=success&session_id=cs_other`,'GET'),r.returnId));for(const bad of [{id:'cs_other'},{amount_total:1},{currency:'usd'},{status:'open'},{payment_status:'unpaid'},{metadata:{billing_flow:'customer_order',photographer_id:otherOwner,order_id:order,order_group_id:group}}]){f.setProvider(bad);await assert.rejects(()=>f.helper.resolveParentCheckoutReturn(landing,r.returnId));}}finally{await f.db.close();}});

test('cancel never contacts Stripe, rejects duplicate selectors, expired/revoked access or changed saved membership',async()=>{const f=await fixture();try{const r=await f.registered(),path=`/parents/checkout-return/${r.returnId}?result=cancel`;const resolved=await f.helper.resolveParentCheckoutReturn(f.request(token,path,'GET'),r.returnId);assert.equal(resolved.status,'cancel');assert.equal(resolved.sessionId,undefined);assert.equal(f.providerCalls.length,0);for(const suffix of ['&result=success','&session_id=cs_fixture_bound'])await assert.rejects(()=>f.helper.resolveParentCheckoutReturn(f.request(token,path+suffix,'GET'),r.returnId));await f.admin('update students set pin=$1 where id=$2',['changed-fixture-pin',student]);await assert.rejects(()=>f.helper.resolveParentCheckoutReturn(f.request(token,path,'GET'),r.returnId));await f.admin('update students set pin=$1 where id=$2',[f.originalLane.pin,student]);await f.admin("update parent_checkout_returns set created_at=now()-interval '2 days',expires_at=now()-interval '1 day'");await assert.rejects(()=>f.helper.resolveParentCheckoutReturn(f.request(token,path,'GET'),r.returnId));}finally{await f.db.close();}});

test('actual return page redirects to a clean lane and renders safe fallback for absent browser access or duplicate query fields',async()=>{
 const file='app/parents/checkout-return/[returnId]/page.tsx';let calls=0,denied=false;
 const compiled=ts.transpileModule(readFileSync(new URL(file,root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};new Function('require','exports',compiled)(dep=>({'next/headers':{headers:async()=>new Headers()},'next/navigation':{redirect:url=>{throw Object.assign(new Error('redirect'),{target:url});}},'next/link':{default:'a'},'@/lib/parent-checkout-return':{resolveParentCheckoutReturn:async(req,returnId)=>{calls++;if(denied)throw Error('Denied');assert.equal(new URL(req.url).searchParams.get('session_id'),'cs_fixture_bound');return{returnId,laneId:id(90),status:'success',sessionId:'cs_fixture_bound'};}}}[dep]??require(dep)),exports);
 const props={params:Promise.resolve({returnId:id(91)}),searchParams:Promise.resolve({result:'success',session_id:'cs_fixture_bound'})};
 await assert.rejects(()=>exports.default(props),error=>error.target===`/parents/view/${id(90)}?checkout=success&return=${id(91)}`);
 denied=true;const fallback=JSON.stringify(await exports.default(props));assert.match(fallback,/saved basket has been kept/);assert.ok(!fallback.includes('cs_fixture_bound')&&!fallback.includes(id(91)));
 const before=calls;const duplicate=JSON.stringify(await exports.default({...props,searchParams:Promise.resolve({result:['success','cancel'],session_id:'cs_fixture_bound'})}));assert.match(duplicate,/Reopen your gallery/);assert.equal(calls,before);
});


test('creation attestation and checkout return freeze original student/gallery scope against later editable order changes',async()=>{
 const f=await fixture();try{const r=await f.registered();await f.admin('update orders set student_id=$1,school_id=$2 where id=$3',[siblingStudent,siblingSchool,order]);
 Object.assign(f.orders[0],{student_id:siblingStudent,school_id:siblingSchool}); // checkout rereads these fields under its payment lock
 await assert.rejects(()=>f.access(),/basket/);await assert.rejects(()=>f.attest(),/basket/);
 await assert.rejects(()=>f.helper.registerParentCheckoutReturn(f.service,r.access,f.orders,order,null),/basket/);
 await assert.rejects(()=>f.helper.resolveParentCheckoutReturn(f.request(token,`/parents/checkout-return/${r.returnId}?result=cancel`,'GET'),r.returnId));
 }finally{await f.db.close();}
});


test('changing only purchased child PIN revokes attested checkout/return even when another same-school child keeps the old family PIN',async()=>{
 const f=await fixture();try{const r=await f.registered();await f.admin('insert into students values($1,$2,$3)',[id(88),school,f.originalLane.pin]);
 await f.admin('update students set pin=$1 where id=$2',['revoked-child-fixture-pin',student]);
 await assert.rejects(()=>f.access(),/basket/);await assert.rejects(()=>f.helper.registerParentCheckoutReturn(f.service,r.access,f.orders,order,null),/basket/);
 await assert.rejects(()=>f.helper.resolveParentCheckoutReturn(f.request(token,`/parents/checkout-return/${r.returnId}?result=cancel`,'GET'),r.returnId));
 assert.equal(f.providerCalls.length,0);
 }finally{await f.db.close();}
});
