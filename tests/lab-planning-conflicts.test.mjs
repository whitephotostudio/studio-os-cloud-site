import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {createLabDatabase,LAB_FIXTURE,seedLegacyLabCanaries} from '../scripts/lab-system-fixture.mjs';
const id=()=>crypto.randomUUID();
async function rpc(db,name,args){assert.match(name,/^[a-z_][a-z_0-9]*$/);const entries=Object.entries(args);return db.transaction(async tx=>{await tx.exec('set local role service_role');await tx.query("select set_config('request.jwt.claim.role','service_role',true)");return(await tx.query('select '+name+'('+entries.map(([k],i)=>{assert.match(k,/^[a-z_][a-z_0-9]*$/);return k+'=>$'+(i+1);}).join(',')+') as value',entries.map(([,v])=>v!==null&&typeof v==='object'?JSON.stringify(v):v))).rows[0].value;});}
async function rows(db){const result={};for(const {tablename}of(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows){assert.match(tablename,/^[a-z_][a-z_0-9]*$/);result[tablename]=(await db.query("select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from "+tablename+' t')).rows[0].rows;}return result;}
const functions=async db=>(await db.query("select p.oid::regprocedure::text as identity,p.prosrc,p.proacl,p.proowner,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid::regprocedure::text")).rows;
const changedNames=new Set(['save_lab_sheet_layout_draft','register_lab_sheet_layout_export','review_lab_sheet_layout_export','put_lab_country_profile','create_country_lab_price_sheet']);
function sheetSave(draftId,requestId=id(),expectedVersion=0){return{p_user_id:LAB_FIXTURE.owner,p_audience:'studio',p_draft_id:draftId,p_request_id:requestId,p_expected_version:expectedVersion,p_job_id:null,p_name:'SYNTHETIC retained sheet',p_document:{paperId:'5x7',orientation:0,templateId:'single-5x7',copies:1,cells:[{id:'a',assetId:null,crop:null}]}};}
const pending=(revision=1)=>({p_actor_user_id:LAB_FIXTURE.admin,p_lab_id:LAB_FIXTURE.lab,p_market_country_code:'CA',p_revision:revision,p_status:'pending',p_document:null});
const countryDocument=()=>({name:'SYNTHETIC held country draft',labId:LAB_FIXTURE.lab,currency:'CAD',pricing:{markupPercent:100,rounding:'none'},items:[{catalogProductId:LAB_FIXTURE.productA,retailCents:1234,enabled:true}],packages:[],shipping:{mode:'pickup',feeCents:0,title:'SYNTHETIC pickup'},terms:'',assignments:[],marketContext:{marketCountryCode:'CA',profileRevision:1,referenceOnly:false,catalogProductIds:[LAB_FIXTURE.productA]}});

test('planning conflict patch preserves all previous rows and privileges and changes only the five intended RPC business-error codes',async()=>{
 let before,previous;const draftId=id(),saved=sheetSave(draftId);const db=await createLabDatabase({beforeLabPlanningConflictResponsesMigration:async database=>{await seedLegacyLabCanaries(database);await rpc(database,'save_lab_sheet_layout_draft',saved);await rpc(database,'put_lab_country_profile',pending());before=await rows(database);previous=await functions(database);}});
 try{
  assert(before,'The additive planning patch must execute after existing migrations');assert.deepEqual(await rows(db),before,'Every existing school, price, setup, order and production table stays byte unchanged');let changed=0,replacements=0;
  const expected=previous.map(fn=>{if(!changedNames.has(fn.identity.split('(')[0]))return fn;changed++;replacements+=(fn.prosrc.match(/errcode='40001'/g)||[]).length;return{...fn,prosrc:fn.prosrc.replaceAll("errcode='40001'","errcode='PT409'")};});assert.equal(changed,5);assert.equal(replacements,13);assert.deepEqual(await functions(db),expected,'No other function body, ownership, security-definer setting or execution grant may change');
  const failed=async(name,args,message)=>assert.rejects(()=>rpc(db,name,args),error=>error.code==='PT409'&&message.test(error.message));
  await failed('save_lab_sheet_layout_draft',sheetSave(draftId),/SHEET_VERSION_CONFLICT/);
  await failed('register_lab_sheet_layout_export',{p_user_id:LAB_FIXTURE.owner,p_audience:'studio',p_draft_id:draftId,p_request_id:id(),p_expected_version:0,p_export:{id:id(),filename:'SYNTHETIC.jpg',storageKey:'SYNTHETIC',sha256:'a'.repeat(64),byteSize:1,widthPixels:1500,heightPixels:2100,document:saved.p_document,manifest:{}}},/SHEET_VERSION_CONFLICT/);
  await failed('review_lab_sheet_layout_export',{p_user_id:LAB_FIXTURE.owner,p_audience:'studio',p_draft_id:draftId,p_render_id:id(),p_expected_version:0,p_sha256:'a'.repeat(64)},/SHEET_VERSION_CONFLICT/);
  await failed('put_lab_country_profile',pending(3),/LAB_COUNTRY_PROFILE_VERSION_CONFLICT/);
  await failed('create_country_lab_price_sheet',{p_user_id:LAB_FIXTURE.owner,p_id:id(),p_document:countryDocument()},/LAB_COUNTRY_PROFILE_PENDING/);
  assert.deepEqual(await rows(db),before,'All five final conflicts leave no partial writes');assert.equal((await rpc(db,'save_lab_sheet_layout_draft',saved)).replayed,true);assert.equal((await rpc(db,'put_lab_country_profile',pending())).replayed,true);assert.deepEqual(await rows(db),before,'Idempotent retry remains read-only after the SQLSTATE patch');
  for(const [file,hash]of[['20261016080000_lab_sheet_layouts.sql','0f8ebd99994c338947cb55893d15af0f4735fc7915fc3a1a10a219641dbe39a0'],['20261016090000_lab_country_profiles.sql','f6f2aede358b44eac3a9e44f30d27aada76c5efc12ad01f39726baa119c845b1']])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../supabase/migrations/'+file,import.meta.url))).digest('hex'),hash,'Previously applied migration stays immutable');
 }finally{await db.close();}
});
