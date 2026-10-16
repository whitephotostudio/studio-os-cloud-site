import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import ts from 'typescript';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createLabDatabase,createLabFixture,LAB_FIXTURE,seedLegacyLabCanaries,fixtureToken } from '../scripts/lab-system-fixture.mjs';

function load(file,deps={}) { const code=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{ compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true } }).outputText,exports={};new Function('require','exports',code)(name=>{ assert(name in deps,'Unexpected dependency '+name);return deps[name]; },exports);return exports; }
const money=load('lib/labs/money.ts'),directory=load('lib/lab-directory.ts'),validation=load('lib/labs/validation.ts',{ zod:{ z },'./money':money }),fulfillment=load('lib/labs/fulfillment-profile.ts',{ zod:{ z },'../lab-directory':directory,'./money':money });
const countryProfiles=load('lib/labs/country-profiles.ts',{ './fulfillment-profile':fulfillment,'./money':money,'../lab-directory':directory,'./validation':validation });
const uuid=()=>crypto.randomUUID();
async function asRole(db,role,user,action) { assert(['service_role','authenticated','anon'].includes(role));return db.transaction(async tx=>{ await tx.exec('set local role '+role);await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[user||'',role,JSON.stringify({ sub:user,role,aal:'aal2' })]);return action(tx); }); }
async function rpc(db,name,args) { assert.match(name,/^[a-z_][a-z_0-9]*$/);const entries=Object.entries(args);return asRole(db,'service_role',null,async tx=>(await tx.query('select '+name+'('+entries.map(([key],i)=>{ assert.match(key,/^[a-z_][a-z_0-9]*$/);return key+'=>$'+(i+1); }).join(',')+') as value',entries.map(([,value])=>value!==null&&typeof value==='object'?JSON.stringify(value):value))).rows[0].value); }
async function snapshot(db) { const tables=(await db.query("select tablename from pg_tables where schemaname='public' and tablename<>'lab_country_profiles' order by tablename")).rows,result={};for (const { tablename } of tables) { assert.match(tablename,/^[a-z_][a-z_0-9]*$/);result[tablename]=(await db.query("select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from "+tablename+' t')).rows[0].rows; }return JSON.stringify(result); }
const COUNTRY={ CA:{ labId:LAB_FIXTURE.lab,currency:'CAD',city:'Fixture city',timeZone:'America/Toronto',unit:'in' },GB:{ labId:'c1111111-1111-4111-8111-111111111111',currency:'GBP',city:'SYNTHETIC Island City',timeZone:'Europe/London',unit:'mm' },JP:{ labId:'c2222222-2222-4222-8222-222222222222',currency:'JPY',city:'SYNTHETIC Pacific City',timeZone:'Asia/Tokyo',unit:'mm' } };
function lab(country='CA') { const c=COUNTRY[country];return { id:c.labId,slug:'synthetic-'+country.toLowerCase(),name:'SYNTHETIC '+country+' lab',countryCode:country,city:c.city,region:'SYNTHETIC region',location:'SYNTHETIC fixture only',currency:c.currency,status:'active',intakeEnabled:false,catalogVerified:true,description:'SYNTHETIC country selection test' }; }
function product(country='CA') { const c=COUNTRY[country];return { id:country==='CA'?LAB_FIXTURE.productA:country==='GB'?'c3333333-3333-4333-8333-333333333333':'c4444444-4444-4444-8444-444444444444',labId:c.labId,category:'prints',name:'SYNTHETIC 5x7 print',size:'5x7',finish:'Lustre',costCents:country==='JP'?150:200,currency:c.currency,sku:country==='CA'?'SYNTHETIC-5X7':'SYNTHETIC-'+country+'-5X7',verified:true,active:true,popular:true,widthInches:5,heightInches:7,costSource:'lab_confirmed',printsPerUnit:1 }; }
function profile(country='CA',revision=1) { const c=COUNTRY[country],p=product(country),size=c.unit==='in'?{ unit:'in',width:5,height:7 }:{ unit:'mm',width:127,height:177.8 };return { version:1,labId:c.labId,marketCountryCode:country,revision,location:{ countryCode:country,city:c.city,timeZone:c.timeZone },currency:c.currency,transport:{ kind:'manual_download',state:'configured' },capabilities:{ inputModes:['individual','composite'],labCropping:country==='GB',labColourCorrection:country==='JP',deliveryModes:['pickup','ship_to_client'],deliveryCountries:[country] },products:[{ productId:p.id,sku:p.sku,finishedSize:size,inputModes:['individual','composite'],paperIds:['SYNTHETIC-paper-5x7'] }],papers:[{ paperId:'SYNTHETIC-paper-5x7',size,dpi:300,colorSpace:'sRGB' }] }; }
function row(country='CA',revision=1,patch={}) { const p=profile(country,revision);return { lab_id:p.labId,market_country_code:p.marketCountryCode,revision,status:'approved',document:p,reviewed_by:LAB_FIXTURE.admin,reviewed_at:'2026-10-16T00:00:00.000Z',created_at:'2026-10-16T00:00:00.000Z',...patch }; }
const fixtureLabs=()=>['CA','GB','JP'].map(lab),fixtureProducts=()=>['CA','GB','JP'].map(product);
async function put(db,values={}) { const p=profile(),args={ p_actor_user_id:LAB_FIXTURE.admin,p_lab_id:p.labId,p_market_country_code:p.marketCountryCode,p_revision:p.revision,p_status:'approved',p_document:p,...values };return { args,result:await rpc(db,'put_lab_country_profile',args) }; }

test('new registry migration creates no lab profile defaults and preserves all existing tables and selected school prices',async()=>{
  let before;const db=await createLabDatabase({ beforeCountryProfilesMigration:async database=>{ await seedLegacyLabCanaries(database);await rpc(database,'save_lab_price_sheet',{ p_user_id:LAB_FIXTURE.owner,p_id:uuid(),p_expected_version:0,p_action:'create',p_document:{ name:'SYNTHETIC existing price draft',labId:LAB_FIXTURE.lab,currency:'CAD',pricing:{ markupPercent:100,rounding:'none' },items:[{ catalogProductId:LAB_FIXTURE.productA,retailCents:1234,enabled:true }],packages:[],shipping:{ mode:'pickup',feeCents:0,title:'Pickup' },terms:'SYNTHETIC retained terms',assignments:[] } });before=await snapshot(database); } });
  try { assert(before);assert.equal(await snapshot(db),before);assert.equal((await db.query('select count(*)::int as n from lab_country_profiles')).rows[0].n,0);const gta=(await db.query("select intake_enabled,catalog_verified from studio_labs where slug='gta-imaging'")).rows[0];assert.deepEqual(gta,{ intake_enabled:false,catalog_verified:false }); } finally { await db.close(); }
});

function projected(rows,labs=fixtureLabs(),catalog=fixtureProducts()) { return countryProfiles.projectLabCountryProfiles(rows,labs,catalog); }
function option(result,labId=LAB_FIXTURE.lab,marketCountryCode='CA') { const found=result.options.find(entry=>entry.labId===labId&&entry.marketCountryCode===marketCountryCode);assert(found,'Exact lab/market option exists');return found; }
function pending(value) { assert.equal(value.status,'pending');assert.equal(value.profile,null);assert(Array.isArray(value.catalogProductIds));assert.equal(value.testOnly,true);assert.equal(value.printAllowed,false);assert.equal(value.operationallyAuthorized,false); }

test('server projection binds synthetic CAD, GBP and JPY options to exact labs and market profiles',()=>{
  const rows=['CA','GB','JP'].map(country=>row(country)),before=JSON.stringify(rows),result=projected(rows);assert.equal(result.available,true);
  for (const country of ['CA','GB','JP']) { const current=option(result,COUNTRY[country].labId,country);assert.equal(current.status,'configured',current.reason);assert.equal(current.revision,1);assert.equal(current.city,COUNTRY[country].city);assert.equal(current.physicalCountryCode,country);assert.deepEqual(current.catalogProductIds,[product(country).id]);assert.deepEqual(current.profile,profile(country));assert.equal(current.printAllowed,false);assert.equal(current.operationallyAuthorized,false); }
  assert.equal(JSON.stringify(rows),before,'Read projection does not rewrite registry snapshots');
});

test('missing, malformed and unreviewed profiles offer pending reference setup without inferred capabilities',()=>{
  for (const rows of [[],[row('CA',1,{ status:'pending',document:null,reviewed_by:null,reviewed_at:null })],[row('CA',1,{ document:null })],[row('CA',1,{ document:{ ...profile(),printAllowed:true } })],[row('CA',1,{ reviewed_by:null,reviewed_at:null })]]) pending(option(projected(rows)));
  const missing=option(projected([]));assert.equal(missing.revision,null);assert.equal(missing.city,COUNTRY.CA.city);
});

test('the latest pending or invalid revision always holds a lab instead of reviving an older approved profile',()=>{
  const old=row('CA',1),latest=row('CA',2,{ status:'pending',document:null,reviewed_by:null,reviewed_at:null });
  for (const rows of [[old,latest],[latest,old],[old,row('CA',2,{ document:{ ...profile('CA',2),revision:1 } })],[old,row('CA',2,{ document:{ ...profile('CA',2),labId:COUNTRY.GB.labId } })],[old,row('CA',2,{ document:{ ...profile('CA',2),marketCountryCode:'GB' } })]]) { const selected=option(projected(rows));pending(selected);assert.equal(selected.revision,2); }
});

test('one unsupported SKU, currency, dimension or verification state holds the whole profile without partial catalogue substitution',()=>{
  const original=product(),mutations=[{ sku:'synthetic-5x7' },{ sku:'SYNTHETIC-OTHER-SKU' },{ currency:'GBP' },{ widthInches:4.999 },{ heightInches:7.001 },{ labId:COUNTRY.GB.labId },{ active:false },{ verified:false },{ costCents:null },{ costSource:'screenshot_reference' },{ printsPerUnit:2 }];
  for (const patch of mutations) pending(option(projected([row()],[lab()],[{ ...original,...patch }])));
  const extra=profile();extra.products.push({ ...extra.products[0],productId:uuid(),sku:'SYNTHETIC-MISSING-SECOND-PRODUCT' });pending(option(projected([row('CA',1,{ document:extra })])));
  const near=profile('GB');near.products[0].finishedSize.width=127.001;pending(option(projected([row('GB',1,{ document:near })]),COUNTRY.GB.labId,'GB'));
});

test('physical location and operational metadata must agree with the directory while transport execution stays unsupported',()=>{
  for (const patch of [{ status:'paused' },{ catalogVerified:false },{ countryCode:'US' },{ city:'SYNTHETIC different physical city' }]) pending(option(projected([row()],[{ ...lab(),...patch }],[product()])));
  for (const kind of ['api','hot_folder','windows_helper']) { const p=profile();p.transport.kind=kind;pending(option(projected([row('CA',1,{ document:p })]))); }
  const p=profile();p.transport.state='unverified';pending(option(projected([row('CA',1,{ document:p })])));
});

test('selected market is independent of physical location and never borrows a different market profile',()=>{
  const crossBorder=profile();crossBorder.marketCountryCode='GB';crossBorder.capabilities.deliveryCountries=['GB'];const rows=[row(),row('CA',1,{ market_country_code:'GB',document:crossBorder })],result=projected(rows,[lab()],[product()]);
  const british=option(result,LAB_FIXTURE.lab,'GB');assert.equal(british.status,'configured',british.reason);assert.equal(british.physicalCountryCode,'CA');assert.equal(british.profile.currency,'CAD');assert.deepEqual(british.profile.capabilities.deliveryCountries,['GB']);assert.equal(option(result).profile.marketCountryCode,'CA');
});

function readService(read) { return { from(table){ assert.equal(table,'lab_country_profile_latest');return { select(){ return this; },order(){ return this; },range:read }; } }; }
test('unavailable, partial or oversized registry reads degrade to pending without breaking existing lab browsing',async()=>{
  for (const read of [async()=>({ data:null,error:{ code:'42P01' } }),async()=>({ data:null,error:{ code:'PGRST205' } }),async()=>({ data:null,error:null }),async()=>{ throw Error('SYNTHETIC read interruption'); }]) { const result=await countryProfiles.loadLabCountryProfiles(readService(read),fixtureLabs(),fixtureProducts());assert.equal(result.available,false);result.options.forEach(pending); }
  const pages=[],first=Array.from({ length:25 },()=>row());const interrupted=await countryProfiles.loadLabCountryProfiles(readService(async(from,to)=>{ pages.push([from,to]);return from===0?{ data:first,error:null }:{ data:null,error:{ code:'SYNTHETIC_UNAVAILABLE' } }; }),fixtureLabs(),fixtureProducts());assert.equal(interrupted.available,false);interrupted.options.forEach(pending);assert.deepEqual(pages,[[0,24],[25,49]]);
  const oversized=await countryProfiles.loadLabCountryProfiles(readService(async(from,to)=>({ data:Array.from({ length:to-from+1 },()=>row()),error:null })),fixtureLabs(),fixtureProducts());assert.equal(oversized.available,false);oversized.options.forEach(pending);
});

test('registry paging considers a later-page hold and never returns its earlier approved capabilities',async()=>{
  const rows=[row(),...Array.from({ length:24 },()=>row('GB')),row('CA',2,{ status:'pending',document:null,reviewed_by:null,reviewed_at:null })],pages=[];
  const result=await countryProfiles.loadLabCountryProfiles(readService(async(from,to)=>{ pages.push([from,to]);return { data:rows.slice(from,to+1),error:null }; }),fixtureLabs(),fixtureProducts());assert.equal(result.available,true);pending(option(result));assert.equal(option(result).revision,2);assert.deepEqual(pages,[[0,24],[25,49]]);
});

test('trusted profile append rejects unsupported catalogues before any registry RPC call',async()=>{
  const calls=[],service={ rpc:async(name,args)=>{ calls.push({ name,args });return { data:{ revision:1 },error:null }; } },input={ labId:LAB_FIXTURE.lab,marketCountryCode:'CA',revision:1,status:'approved',document:profile() };
  await assert.rejects(()=>countryProfiles.appendLabCountryProfile(service,LAB_FIXTURE.admin,input,[lab()],[{ ...product(),sku:'SYNTHETIC changed SKU' }]),error=>error.status===409);assert.equal(calls.length,0);
  await assert.rejects(()=>countryProfiles.appendLabCountryProfile(service,LAB_FIXTURE.admin,{ ...input,status:'pending' },[lab()],[product()]));assert.equal(calls.length,0);
  await countryProfiles.appendLabCountryProfile(service,LAB_FIXTURE.admin,input,[lab()],[product()]);assert.equal(calls.length,1);assert.equal(calls[0].name,'put_lab_country_profile');assert.equal(calls[0].args.p_actor_user_id,LAB_FIXTURE.admin);assert.deepEqual(calls[0].args.p_document,profile());
});

test('the registry is append-only, platform-admin controlled and never changes lab intake or existing records',async()=>{
  const db=await createLabDatabase();try {
    await seedLegacyLabCanaries(db);const before=await snapshot(db);
    for (const actor of [LAB_FIXTURE.owner,LAB_FIXTURE.labOwner,LAB_FIXTURE.labOperator,LAB_FIXTURE.foreignLabOwner]) await assert.rejects(()=>put(db,{ p_actor_user_id:actor }),/FORBIDDEN|ADMIN|AUTH/);
    const initial=await put(db);assert(initial.result);await assert.rejects(()=>put(db,{ p_revision:3,p_document:profile('CA',3) }),/VERSION_CONFLICT/);
    await put(db,{ p_revision:2,p_status:'pending',p_document:null });const rows=(await db.query('select * from lab_country_profiles order by revision')).rows;assert.equal(rows.length,2);assert.equal(rows[0].document.revision,1);assert.equal(rows[1].status,'pending');assert.equal(rows[1].document,null);assert.equal(rows[0].reviewed_by,LAB_FIXTURE.admin);assert(rows[0].reviewed_at);assert.equal(rows[1].reviewed_by,null);
    assert.equal((await rpc(db,'put_lab_country_profile',initial.args)).replayed,true);const latest=(await db.query('select revision,status from lab_country_profile_latest where lab_id=$1',[LAB_FIXTURE.lab])).rows;assert.deepEqual(latest,[{ revision:2,status:'pending' }],'Replaying an older approval cannot reactivate it');
    for (const sql of ["update lab_country_profiles set status='pending' where revision=1",'delete from lab_country_profiles where revision=1']) await assert.rejects(()=>db.exec(sql),/IMMUTABLE/);
    for (const role of ['anon','authenticated']) { await assert.rejects(()=>asRole(db,role,LAB_FIXTURE.owner,tx=>tx.query('insert into lab_country_profiles(lab_id,market_country_code,revision,status)values($1,$2,1,$3)',[LAB_FIXTURE.lab,'GB','pending'])),/permission denied/);await assert.rejects(()=>asRole(db,role,LAB_FIXTURE.admin,tx=>tx.query('select put_lab_country_profile(null,null,null,null,null,null)')),/permission denied/);for(const table of ['lab_country_profiles','lab_country_profile_latest']) await assert.rejects(()=>asRole(db,role,LAB_FIXTURE.owner,tx=>tx.query('select * from '+table)),/permission denied/); }
    assert.equal(await snapshot(db),before,'Appending planning metadata does not grant intake or modify any previous table');
  } finally { await db.close(); }
});

test('real workspace GET loads server registry options and leaves every existing school, price and intake row unchanged',async()=>{
  const fixture=await createLabFixture({ port:0 });try {
    await put(fixture.db);const before=await snapshot(fixture.db),starters=load('lib/labs/starters.ts',{ './money':money }),server=load('lib/labs/server.ts',{ 'node:crypto':crypto,'./validation':validation,'./money':money,'./starters':starters,'./country-profiles':countryProfiles,'@/lib/dashboard-auth':{},'@/lib/rate-limit':{} }),service=createClient(fixture.url,fixture.serviceKey,{ auth:{ persistSession:false,autoRefreshToken:false } }),access={ service,userId:LAB_FIXTURE.owner,photographerId:LAB_FIXTURE.photographer };
    const route=load('app/api/dashboard/labs/route.ts',{ 'next/server':{ NextResponse:{ json:(value,settings)=>Response.json(value,settings) } },'@/lib/labs/validation':validation,'@/lib/labs/server':{ ...server,labDashboardAccess:async()=>access } });
    const response=await route.GET(new Request('http://fixture.invalid/api/dashboard/labs'));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);const body=await response.json();assert.equal(body.ok,true);const current=option(body.workspace.countryProfiles);assert.equal(current.status,'configured',current.reason);assert.deepEqual(current.catalogProductIds,[LAB_FIXTURE.productA]);assert.equal(body.workspace.galleries.find(gallery=>gallery.id===LAB_FIXTURE.school).currentProfileId,'legacy-fixture-profile');assert.equal(await snapshot(fixture.db),before);assert(fixture.requests.filter(request=>request.path.startsWith('/rest/v1/')).every(request=>request.method==='GET'),'Directory loading executes no mutation RPCs');
  } finally { await fixture.close(); }
});

test('country-bound price creation freezes exact products and rejects stale or foreign context while existing drafts remain editable',async()=>{
  const fixture=await createLabFixture({ port:0 });try {
    await put(fixture.db);const before=JSON.parse(await snapshot(fixture.db)),starters=load('lib/labs/starters.ts',{ './money':money }),server=load('lib/labs/server.ts',{ 'node:crypto':crypto,'./validation':validation,'./money':money,'./starters':starters,'./country-profiles':countryProfiles,'@/lib/dashboard-auth':{},'@/lib/rate-limit':{} }),service=createClient(fixture.url,fixture.serviceKey,{ auth:{ persistSession:false,autoRefreshToken:false } }),access={ service,userId:LAB_FIXTURE.owner,photographerId:LAB_FIXTURE.photographer },action={ action:'create',labId:LAB_FIXTURE.lab,name:'SYNTHETIC bound country draft',starter:'popular',marketCountryCode:'CA',profileRevision:1,referenceOnly:false };
    const created=await server.performLabAction(access,validation.parseLabAction(action));assert(created.sheet);let current=created.sheet;assert.deepEqual(current.marketContext,{ marketCountryCode:'CA',profileRevision:1,referenceOnly:false,catalogProductIds:[LAB_FIXTURE.productA] });assert.deepEqual(current.items.map(item=>item.catalogProductId),[LAB_FIXTURE.productA]);
    for (const patch of [{ profileRevision:2 },{ labId:LAB_FIXTURE.foreignLab },{ marketCountryCode:'GB' }]) await assert.rejects(()=>server.performLabAction(access,validation.parseLabAction({ ...action,...patch })),error=>error.status===409);
    for (const transform of [sheet=>{ delete sheet.marketContext; },sheet=>{ sheet.marketContext.profileRevision=2; },sheet=>{ sheet.marketContext.referenceOnly=true;sheet.marketContext.profileRevision=null; },sheet=>{ sheet.marketContext.catalogProductIds.push(LAB_FIXTURE.productB); },sheet=>{ sheet.marketContext.marketCountryCode='GB'; }]) { const altered=structuredClone(current);transform(altered);await assert.rejects(()=>server.performLabAction(access,validation.parseLabAction({ action:'save',sheet:altered,expectedVersion:current.version })),error=>error.code==='LAB_COUNTRY_CONTEXT_IMMUTABLE'); }
    const extra=structuredClone(current);extra.items.push({ catalogProductId:LAB_FIXTURE.productB,retailCents:1234,enabled:true });await assert.rejects(()=>server.performLabAction(access,validation.parseLabAction({ action:'save',sheet:extra,expectedVersion:current.version })),error=>error.code==='LAB_CATALOG_SCOPE');
    await put(fixture.db,{ p_revision:2,p_status:'pending',p_document:null });await assert.rejects(()=>server.performLabAction(access,validation.parseLabAction(action)),error=>error.code==='LAB_COUNTRY_PROFILE_PENDING');
    current=(await server.performLabAction(access,validation.parseLabAction({ action:'save',sheet:{ ...current,name:'SYNTHETIC old revision still editable' },expectedVersion:current.version }))).sheet;assert.equal(current.marketContext.profileRevision,1);assert.equal(current.name,'SYNTHETIC old revision still editable');
    const duplicate=await server.performLabAction(access,{ action:'duplicate',id:current.id,name:'SYNTHETIC retained duplicate' });assert.deepEqual(duplicate.sheet.marketContext,current.marketContext);
    const reference=await server.performLabAction(access,validation.parseLabAction({ ...action,name:'SYNTHETIC explicit reference draft',referenceOnly:true,profileRevision:null }));assert.equal(reference.sheet.marketContext.referenceOnly,true);assert.equal(reference.sheet.marketContext.profileRevision,null);assert.equal(reference.sheet.status,'draft');
    const after=JSON.parse(await snapshot(fixture.db));after.lab_price_sheets=after.lab_price_sheets.filter(row=>![current.id,duplicate.sheet.id,reference.sheet.id].includes(row.id));assert.deepEqual(after,before,'Only three newly requested private drafts changed; existing prices, schools, profiles, intake and orders stay intact');
  } finally { await fixture.close(); }
});

test('atomic country creation rechecks a profile hold or catalogue change arriving after the workspace read',async()=>{
  for (const scenario of ['pending','catalogue']) {
    const fixture=await createLabFixture({ port:0 });try {
      await put(fixture.db);const starters=load('lib/labs/starters.ts',{ './money':money }),server=load('lib/labs/server.ts',{ 'node:crypto':crypto,'./validation':validation,'./money':money,'./starters':starters,'./country-profiles':countryProfiles,'@/lib/dashboard-auth':{},'@/lib/rate-limit':{} }),service=createClient(fixture.url,fixture.serviceKey,{ auth:{ persistSession:false,autoRefreshToken:false } }),before=(await fixture.db.query('select * from lab_price_sheets order by id')).rows,calls=[];
      const raced={ from:service.from.bind(service),rpc:async(name,args)=>{ calls.push(name);assert.equal(name,'create_country_lab_price_sheet','Country creation must use its atomic wrapper');if(scenario==='pending') await put(fixture.db,{ p_revision:2,p_status:'pending',p_document:null });else await fixture.db.query('update studio_lab_catalog set sku=$1 where id=$2',['SYNTHETIC changed during create',LAB_FIXTURE.productA]);return service.rpc(name,args); } };
      await assert.rejects(()=>server.performLabAction({ service:raced,userId:LAB_FIXTURE.owner,photographerId:LAB_FIXTURE.photographer },{ action:'create',labId:LAB_FIXTURE.lab,name:'SYNTHETIC raced draft',starter:'popular',marketCountryCode:'CA',profileRevision:1,referenceOnly:false }),error=>error.status===409&&error.code==='LAB_COUNTRY_PROFILE_PENDING');assert.deepEqual(calls,['create_country_lab_price_sheet']);assert.deepEqual((await fixture.db.query('select * from lab_price_sheets order by id')).rows,before,'A concurrent change cannot leave a partially saved price draft');
    } finally { await fixture.close(); }
  }
});

test('atomic country RPC rejects foreign catalogue IDs and stale context without affecting legacy draft creation',async()=>{
  const db=await createLabDatabase();try {
    await put(db);const document={ name:'SYNTHETIC atomic scope',labId:LAB_FIXTURE.lab,currency:'CAD',pricing:{ markupPercent:100,rounding:'none' },items:[{ catalogProductId:LAB_FIXTURE.productA,retailCents:1234,enabled:true }],packages:[],shipping:{ mode:'pickup',feeCents:0,title:'SYNTHETIC pickup' },terms:'',assignments:[],marketContext:{ marketCountryCode:'CA',profileRevision:1,referenceOnly:false,catalogProductIds:[LAB_FIXTURE.productA] } },before=await snapshot(db);
    for (const change of [value=>{ value.marketContext.profileRevision=2; },value=>{ value.marketContext.catalogProductIds.push(LAB_FIXTURE.foreignProduct); },value=>{ value.items.push({ catalogProductId:LAB_FIXTURE.foreignProduct,retailCents:1234,enabled:true }); },value=>{ value.marketContext.marketCountryCode='GB'; },value=>{ value.marketContext.referenceOnly=true;value.marketContext.profileRevision=null;value.marketContext.catalogProductIds=[LAB_FIXTURE.productA]; }]) { const changed=structuredClone(document);change(changed);await assert.rejects(()=>rpc(db,'create_country_lab_price_sheet',{ p_user_id:LAB_FIXTURE.owner,p_id:uuid(),p_document:changed }),/LAB_COUNTRY_PROFILE|LAB_CATALOG_SCOPE/); }
    for (const role of ['anon','authenticated']) await assert.rejects(()=>asRole(db,role,LAB_FIXTURE.owner,tx=>tx.query('select create_country_lab_price_sheet(null,null,null)')),/permission denied/);assert.equal(await snapshot(db),before);
    const old={ ...document };delete old.marketContext;const id=uuid();await rpc(db,'save_lab_price_sheet',{ p_user_id:LAB_FIXTURE.owner,p_id:id,p_expected_version:0,p_action:'create',p_document:old });assert.equal((await db.query('select document from lab_price_sheets where id=$1',[id])).rows[0].document.marketContext,undefined,'The existing unbound draft contract remains available');
  } finally { await db.close(); }
});

const httpOrigin=process.env.LAB_COUNTRY_HTTP_ORIGIN;
test('actual Next country discovery loads latest server profiles, freezes new draft context and preserves all prior data', { skip:!httpOrigin },async()=>{
  const fixtureOrigin=process.env.LAB_SYSTEM_FIXTURE_URL;assert.match(httpOrigin,/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);assert.match(fixtureOrigin,/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  let requests=0;const call=async(body,actor=LAB_FIXTURE.owner)=>{ requests++;const response=await fetch(httpOrigin+'/api/dashboard/labs',{ method:body===undefined?'GET':'POST',headers:{ Origin:new URL(httpOrigin).origin,...(actor?{ Authorization:'Bearer '+fixtureToken(actor) }:{}),...(body===undefined?{}:{ 'Content-Type':'application/json' }) },body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45000) });assert.match(response.headers.get('cache-control')||'',/private.*no-store/);return { status:response.status,body:await response.json() }; },ok=result=>{ assert.equal(result.status,200,JSON.stringify(result.body));return result.body; };
  const tables=['schools','projects','packages','package_profiles','orders','studio_labs','studio_lab_catalog','lab_memberships','lab_price_sheets','lab_order_assets','lab_orders','lab_order_events','in_house_price_sheets','in_house_test_galleries','in_house_test_orders','in_house_test_order_events','lab_production_policies','lab_production_assets','lab_production_galleries','lab_production_jobs','lab_production_events','lab_production_v2_jobs','lab_production_v2_assets','lab_production_v2_events','lab_connector_pairs','lab_connector_devices','lab_connector_dispatches','lab_sheet_layout_drafts','lab_sheet_layout_exports'];
  const existing=async()=>{ const result={};for(const table of tables){ const response=await fetch(fixtureOrigin+'/rest/v1/'+table+'?select=*',{ headers:{ Authorization:'Bearer '+fixtureToken(null,'service_role') },signal:AbortSignal.timeout(15000) });assert.equal(response.status,200);result[table]=(await response.json()).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))); }return result; };
  const append=async(revision,status,document)=>{ const response=await fetch(fixtureOrigin+'/rest/v1/rpc/put_lab_country_profile',{ method:'POST',headers:{ Authorization:'Bearer '+fixtureToken(null,'service_role'),'Content-Type':'application/json' },body:JSON.stringify({ p_actor_user_id:LAB_FIXTURE.admin,p_lab_id:LAB_FIXTURE.lab,p_market_country_code:'CA',p_revision:revision,p_status:status,p_document:document }),signal:AbortSignal.timeout(15000) });assert.equal(response.status,200); };
  assert.equal((await call(undefined,null)).status,401);const before=await existing();await append(1,'approved',profile());
  const workspace=ok(await call()).workspace,current=option(workspace.countryProfiles);assert.equal(current.status,'configured',current.reason);assert.deepEqual(current.catalogProductIds,[LAB_FIXTURE.productA]);assert.equal(current.printAllowed,false);assert.equal(current.operationallyAuthorized,false);assert.deepEqual(await existing(),before,'Discovery GET changes no existing table');
  const create={ action:'create',labId:LAB_FIXTURE.lab,name:'SYNTHETIC HTTP country draft',starter:'popular',marketCountryCode:'CA',profileRevision:1,referenceOnly:false };let sheet=ok(await call(create)).sheet;assert.deepEqual(sheet.marketContext,{ marketCountryCode:'CA',profileRevision:1,referenceOnly:false,catalogProductIds:[LAB_FIXTURE.productA] });assert.deepEqual(sheet.items.map(item=>item.catalogProductId),[LAB_FIXTURE.productA]);
  for (const patch of [{ profileRevision:2 },{ labId:LAB_FIXTURE.foreignLab },{ marketCountryCode:'GB' }]) assert.equal((await call({ ...create,...patch })).status,409);
  const tampered=structuredClone(sheet);tampered.marketContext.catalogProductIds.push(LAB_FIXTURE.productB);assert.equal((await call({ action:'save',sheet:tampered,expectedVersion:sheet.version })).status,409);assert.equal((await call({ action:'save',sheet,expectedVersion:sheet.version },LAB_FIXTURE.otherOwner)).status,404);
  await append(2,'pending',null);const held=option(ok(await call()).workspace.countryProfiles);pending(held);assert.equal(held.revision,2);assert.equal((await call(create)).status,409);
  sheet=ok(await call({ action:'save',sheet:{ ...sheet,name:'SYNTHETIC HTTP retained draft revision',items:sheet.items.map(item=>({ ...item,retailCents:1555 })) },expectedVersion:sheet.version })).sheet;assert.equal(sheet.marketContext.profileRevision,1);assert.equal(sheet.items[0].retailCents,1555);
  const reference=ok(await call({ ...create,name:'SYNTHETIC HTTP explicit reference',profileRevision:null,referenceOnly:true })).sheet;assert.equal(reference.marketContext.referenceOnly,true);assert.equal(reference.marketContext.profileRevision,null);assert.equal(reference.status,'draft');
  assert.equal((await call({ ...create,printAllowed:true })).status,400);const after=await existing();after.lab_price_sheets=after.lab_price_sheets.filter(row=>![sheet.id,reference.id].includes(row.id));assert.deepEqual(after,before,'Only two requested private drafts were added; old schools, prices, intake and production rows stay unchanged');assert(requests<30);
});
