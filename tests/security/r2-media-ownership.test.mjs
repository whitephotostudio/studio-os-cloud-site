import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';

const require=createRequire(import.meta.url);
const root=new URL('../../',import.meta.url);
function load(file,overrides={}) {
  const source=readFileSync(new URL(file,root),'utf8'), exports={};
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',output)(name=>overrides[name]??require(name),exports);
  return exports;
}
const helper=load('lib/r2-media-ownership.ts',{'@/lib/r2-access-security':load('lib/r2-access-security.ts')});
const uploads=load('lib/upload-ownership.ts',{'@/lib/r2-media-ownership':helper});
const migration=readFileSync(new URL('supabase/migrations/20261012060000_retain_r2_namespace_owners.sql',root),'utf8');
const accountMigration=readFileSync(new URL('supabase/migrations/20261012080000_bind_r2_photographer_namespace_accounts.sql',root),'utf8');
const [owner,other,project,foreignProject,school,foreignSchool,newSchool]=[1,2,3,4,5,6,7].map(x=>`00000000-0000-4000-8000-${String(x).padStart(12,'0')}`);

async function fixture({collision=false}={}) {
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table public.photographers(id uuid primary key,user_id uuid not null);
    create table public.projects(id uuid primary key,photographer_id uuid not null);
    create table public.schools(id uuid primary key,photographer_id uuid not null,local_school_id text);
    create table public.school_storage_root_claims(root text primary key,school_id uuid references public.schools(id) on delete cascade);
    grant usage on schema public to anon,authenticated,service_role;
    grant all on public.projects,public.schools to authenticated,service_role;
    grant select on public.photographers to authenticated,service_role;
  `);
  await db.query('insert into public.photographers values($1,$1),($2,$2)',[owner,other]);
  await db.query('insert into public.projects values($1,$2),($3,$4)',[project,owner,foreignProject,other]);
  await db.query('insert into public.schools values($1,$2,$3),($4,$5,$6)',[school,owner,'legacy-school',foreignSchool,other,collision?school:'foreign-school']);
  await db.query('insert into public.school_storage_root_claims values($1,$2),($3,$4)',[school,school,foreignSchool,foreignSchool]);
  return db;
}
function service(db) {
  return {async rpc(name,args) {
    assert.equal(name,'r2_media_namespace_owner');
    try {return {data:(await db.query('select * from public.r2_media_namespace_owner($1,$2,$3,$4)',[args.p_kind,args.p_root,args.p_allow_photographer_root,args.p_allow_deleted_resource])).rows,error:null};}
    catch(error){return {data:null,error};}
  }};
}

test('retained namespace SQL and actual helper authorize legitimate paths and reject foreign rows across every namespace',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);await db.exec(accountMigration);await db.exec('set role service_role');
    const owned=[`projects/${project}/album/photo.jpg`,`probes/${project}/probe.txt`,`nobg-photos/projects/${project}/photo.png`,
      `schools/${school}/photo.jpg`,`photos/${school}/student/photo.jpg`,`nobg-photos/schools/${school}/photo.png`,
      'legacy-school/photo.jpg','nobg-photos/legacy-school/photo.png','thumbs/legacy-school/photo.jpg',
      `${owner}/photo.jpg`,`nobg-photos/${owner}/photo.png`,`thumbs/${owner}/photo.jpg`,
      `backdrops/${owner}/background.jpg`,`crm-locations/${owner}/location/photo.jpg`,`booking-email-campaigns/${owner}/campaign/direction-1.jpg`];
    for(const key of owned)assert.equal(await helper.r2MediaOwnedBy(service(db),key,owner),true,key);
    for(const key of [`projects/${foreignProject}/photo.jpg`,`photos/${foreignSchool}/photo.jpg`,'foreign-school/photo.jpg',`${other}/photo.jpg`,`backdrops/${other}/bg.jpg`,`crm-locations/${other}/location/photo.jpg`,`booking-email-campaigns/${other}/campaign/direction-1.jpg`]) {
      assert.equal(await helper.r2MediaOwnedBy(service(db),key,owner),false,key);
    }
    for(const key of ['unclaimed/photo.jpg',`projects/${project}`,`../${school}/photo.jpg`,`credits/${owner}/photo.png`,`credit-staging/${owner}/photo.png`,`order-automation/${owner}/photo.png`,'https://foreign.test/photo.jpg']) {
      assert.equal(await helper.r2MediaOwnedBy(service(db),key,owner),false,key);
    }
    for(const key of ['legacy-school/',`projects/${project}/`,`schools/${school}/`,`nobg-photos/projects/${project}/`]) {
      assert.equal(await helper.r2MediaOwnedBy(service(db),key,owner,{prefix:true}),true,key);
    }
    assert.equal((await helper.resolveR2MediaOwnership(service(db),'legacy-school/photo.jpg',owner)).schoolId,school);
  }finally{await db.close();}
});

test('namespace owners survive deletion/relabeling, block cross-owner reclaim, and permit legitimate new uploads',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);await db.exec(accountMigration);
    await db.exec('set role authenticated');
    await assert.rejects(()=>db.query('delete from public.r2_namespace_ownership'),/permission denied/);
    await assert.rejects(()=>db.query("select public._claim_r2_namespace('school','stolen',$1,$2)",[other,newSchool]),/permission denied/);
    await assert.rejects(()=>db.query("select * from public.r2_media_namespace_owner('school','legacy-school')"),/permission denied/);
    await db.query('insert into public.projects values($1,$2)',[newSchool,owner]);
    await db.query("update public.schools set local_school_id='relabeled-school' where id=$1",[school]);
    await db.exec('reset role;set role service_role');
    assert.equal(await helper.r2MediaOwnedBy(service(db),`projects/${newSchool}/upload.jpg`,owner),true);
    assert.equal(await helper.r2MediaOwnedBy(service(db),'legacy-school/historical.jpg',owner),true,'old root still resolves original school');
    await db.query('delete from public.projects where id=$1',[project]);
    await db.query('delete from public.schools where id=$1',[school]);
    assert.equal(await helper.r2MediaOwnedBy(service(db),`projects/${project}/old.jpg`,owner),false);
    assert.equal(await helper.r2MediaOwnedBy(service(db),'legacy-school/old.jpg',owner),false);
    assert.equal(await helper.r2MediaOwnedBy(service(db),`projects/${project}/paid-order.jpg`,owner,{allowDeletedResource:true}),true);
    assert.equal(await helper.r2MediaOwnedBy(service(db),'legacy-school/paid-order.jpg',owner,{allowDeletedResource:true}),true);
    assert.equal(await helper.r2MediaOwnedBy(service(db),'legacy-school/paid-order.jpg',other,{allowDeletedResource:true}),false);
    await assert.rejects(()=>db.query('insert into public.projects values($1,$2)',[project,other]),/original studio owner/);
    await assert.rejects(()=>db.query('insert into public.schools values($1,$2,$3)',[school,other,'different-root']),/original studio owner/);
    await assert.rejects(()=>db.query('insert into public.schools values($1,$2,$3)',[newSchool,other,'legacy-school']),/original studio owner/);
    await assert.rejects(()=>db.query('update public.projects set photographer_id=$1 where id=$2',[other,newSchool]),/original studio owner/);
    await db.query('insert into public.projects values($1,$2)',[project,owner]);
    assert.equal(await helper.r2MediaOwnedBy(service(db),`projects/${project}/new.jpg`,owner),true,'same tenant can safely reuse its namespace');
  }finally{await db.close();}
});

test('global ambiguous school aliases fail closed even when both records belong to the same owner',async()=>{
  const db=await fixture();
  try {
    await db.query('insert into public.schools values($1,$2,$3)',[newSchool,owner,school]);
    await db.exec(migration);await db.exec(accountMigration);await db.exec('set role service_role');
    assert.equal(await helper.r2MediaOwnedBy(service(db),`schools/${school}/photo.jpg`,owner),false);
  }finally{await db.close();}
});

test('initial cross-owner collisions abort migration atomically and provider lookup outages fail retryably',async()=>{
  const db=await fixture({collision:true});
  try {
    await assert.rejects(()=>db.exec(migration),/original studio owner/);await db.exec('rollback');
    assert.equal((await db.query("select to_regclass('public.r2_namespace_ownership') registry")).rows[0].registry,null);
  }finally{await db.close();}
  await assert.rejects(()=>helper.r2MediaOwnedBy({rpc:async()=>({error:{message:'private database details'}})},`projects/${project}/photo.jpg`,owner),error=>error instanceof helper.R2MediaOwnershipError && error.status===503 && !error.message.includes('private database'));
  await assert.rejects(()=>helper.assertR2MediaOwnership({rpc:async()=>({data:[],error:null})},`projects/${project}/photo.jpg`,owner),error=>error.status===403);
});


test('photographer roots cannot be stolen by school aliases or account recreation and legitimate signup remains compatible',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);await db.exec(accountMigration);
    await assert.rejects(()=>db.query('insert into public.schools values($1,$2,$3)',[newSchool,other,owner]),/original studio owner/);
    await assert.rejects(()=>db.query('update public.schools set local_school_id=$1 where id=$2',[other,school]),/original studio owner/);
    await assert.rejects(()=>db.query('insert into public.photographers values($1,$2)',[school,other]),/original studio owner/);
    await assert.rejects(()=>db.query('update public.photographers set user_id=$1 where id=$2',[other,owner]),/original authenticated account/);
    await db.query('delete from public.photographers where id=$1',[owner]);
    await assert.rejects(()=>db.query('insert into public.schools values($1,$2,$3)',[newSchool,other,owner]),/original studio owner/);
    await assert.rejects(()=>db.query('insert into public.photographers values($1,$2)',[owner,other]),/original authenticated account/);
    assert.equal(await helper.r2MediaOwnedBy(service(db),`projects/${project}/old.jpg`,owner),false);
    await db.query('insert into public.photographers values($1,$2)',[owner,owner]);
    assert.equal(await helper.r2MediaOwnedBy(service(db),`projects/${project}/old.jpg`,owner),true);
    await db.query('insert into public.photographers values($1,$2)',[newSchool,newSchool]);
    assert.equal(await helper.r2MediaOwnedBy(service(db),`backdrops/${newSchool}/new.jpg`,newSchool),true);
    // Even a privileged out-of-band account reassignment cannot make old bytes readable.
    await db.exec('alter table public.photographers disable trigger retain_r2_photographer_namespace_owner');
    await db.query('update public.photographers set user_id=$1 where id=$2',[other,owner]);
    assert.equal(await helper.r2MediaOwnedBy(service(db),`projects/${project}/old.jpg`,owner),false);
    assert.equal(await helper.r2MediaOwnedBy(service(db),`${owner}/old.jpg`,owner),false);
    await db.exec('set role authenticated');
    await assert.rejects(()=>db.query('select * from public.r2_photographer_namespace_ownership'),/permission denied/);
  }finally{await db.close();}
});

test('preexisting school/photographer UUID collisions abort the follow-up without changing old namespace claims',async()=>{
  const db=await fixture();
  try {
    await db.query('update public.schools set local_school_id=$1 where id=$2',[owner,foreignSchool]);
    await db.exec(migration);
    await assert.rejects(()=>db.exec(accountMigration),/original studio owner/);await db.exec('rollback');
    assert.equal((await db.query("select to_regclass('public.r2_photographer_namespace_ownership') registry")).rows[0].registry,null);
    assert.ok((await db.query('select count(*)::int n from public.r2_namespace_ownership')).rows[0].n>0);
  }finally{await db.close();}
});

test('legacy UUID ambiguity checks a photographer claim while canonical paths need only one owner RPC',async()=>{
  const calls=[];
  const mocked={rpc:async(_,args)=>{calls.push(args);return {data:[{photographer_id:args.p_kind==='photographer'?other:owner,school_id:school}],error:null};}};
  assert.equal(await helper.r2MediaOwnedBy(mocked,`thumbs/${other}/private.jpg`,owner),false);
  assert.equal(calls.length,1);
  calls.length=0;
  assert.equal(await helper.r2MediaOwnedBy(mocked,`schools/${school}/private.jpg`,owner),true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].p_kind,'school');
});


test('catalog-exact account-binding rollback restores the original helpers and preserves existing namespace rows',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);
    const catalog=()=>db.query("select oid::regprocedure::text signature,pg_get_functiondef(oid) definition,proacl::text acl from pg_proc where oid in ('public._claim_r2_namespace(text,text,uuid,uuid)'::regprocedure,'public.r2_media_namespace_owner(text,text,boolean,boolean)'::regprocedure) order by signature");
    const before=(await catalog()).rows;
    const rows=(await db.query('select count(*)::int n from public.r2_namespace_ownership')).rows;
    await db.exec(accountMigration);
    await db.exec(readFileSync(new URL('docs/security/2026-10-12-r2-photographer-namespace-rollback.sql',root),'utf8'));
    assert.deepEqual((await catalog()).rows,before);
    assert.deepEqual((await db.query('select count(*)::int n from public.r2_namespace_ownership')).rows,rows);
    assert.equal((await db.query("select to_regclass('public.r2_photographer_namespace_ownership') registry")).rows[0].registry,null);
  }finally{await db.close();}
});


test('reserved CRM and campaign namespaces cannot be claimed by a school alias for reads, uploads or transforms',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);await db.exec(accountMigration);
    await db.query('insert into public.schools values($1,$2,$3)',[newSchool,owner,'crm-locations']);
    await db.query('insert into public.schools values($1,$2,$3)',[project,owner,'booking-email-campaigns']);
    const own=[`crm-locations/${owner}/location/photo.jpg`,`booking-email-campaigns/${owner}/campaign/direction-1.jpg`,
      `projects/${project}/albums/main/photo.jpg`,`schools/${school}/Grade A/photo.jpg`,`nobg-photos/projects/${project}/photo.png`];
    for(const key of own)assert.equal((await uploads.assertKeyOwnedByPhotographer(service(db),owner,key)).ok,true,key);
    for(const prefix of ['crm-locations','booking-email-campaigns']) {
      const foreign=`${prefix}/${other}/location/photo.jpg`;
      assert.equal(await helper.r2MediaOwnedBy(service(db),foreign,owner),false,'school alias cannot authorize foreign bytes');
      assert.equal((await uploads.assertKeyOwnedByPhotographer(service(db),owner,foreign)).ok,false,'upload/thumbnail readers cannot target foreign bytes');
      assert.equal((await uploads.assertKeyOwnedByPhotographer(service(db),owner,`${prefix}/not-a-photographer/photo.jpg`)).ok,false);
    }
    for(const key of [`credits/${owner}/output.png`,`credit-staging/${owner}/output.png`,`order-automation/${owner}/output.zip`,`downloads/${owner}/app.zip`,`gallery-zips/${owner}/parents.zip`])assert.equal((await uploads.assertKeyOwnedByPhotographer(service(db),owner,key)).ok,false,key);
  }finally{await db.close();}
});


test('server download and gallery ZIP roots remain unclaimable even with a matching local school alias',async()=>{
  const db=await fixture();try {
    await db.exec(migration);await db.exec(accountMigration);
    await db.query('insert into public.schools values($1,$2,$3)',[newSchool,owner,'downloads']);
    await db.query('insert into public.schools values($1,$2,$3)',[project,owner,'gallery-zips']);
    for(const prefix of ['downloads','gallery-zips']) {
      const key=`${prefix}/foreign-gallery/private.zip`;
      assert.equal(await helper.r2MediaOwnedBy(service(db),key,owner),false);
      assert.equal(await helper.r2MediaOwnedBy(service(db),`${prefix}/`,owner,{prefix:true}),false);
      assert.equal((await uploads.assertKeyOwnedByPhotographer(service(db),owner,key)).ok,false);
    }
  }finally{await db.close();}
});
