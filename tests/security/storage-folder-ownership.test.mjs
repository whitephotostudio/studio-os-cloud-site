import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const require=createRequire(import.meta.url), root=new URL('../../',import.meta.url);
const source=path=>readFileSync(new URL(path,root),'utf8');
const [owner,other,school,secondSchool]=[1,2,3,4].map(n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`);
function load(path,dependencies={}) {
  const exports={};
  const code=ts.transpileModule(source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',code)(name=>dependencies[name]??(name.startsWith('@/')?assert.fail(`Unexpected dependency ${name}`):require(name)),exports);
  return exports;
}
const security=load('lib/r2-access-security.ts');
const resolver=load('lib/r2-media-ownership.ts',{'@/lib/r2-access-security':security});
async function fixture() {
  const db=new PGlite(), calls=[];
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table public.photographers(id uuid primary key,user_id uuid not null);
    create table public.projects(id uuid primary key,photographer_id uuid not null);
    create table public.schools(id uuid primary key,photographer_id uuid not null,local_school_id text);
    create table public.school_storage_root_claims(root text primary key,school_id uuid references public.schools(id) on delete cascade);`);
  await db.query('insert into public.photographers values($1,$1),($2,$2)',[owner,other]);
  await db.query('insert into public.schools values($1,$2,$3)',[school,owner,'original-root']);
  for(const file of ['20261012060000_retain_r2_namespace_owners.sql','20261012080000_bind_r2_photographer_namespace_accounts.sql']) await db.exec(source(`supabase/migrations/${file}`));
  await db.query("update public.schools set local_school_id='renamed-root' where id=$1",[school]);
  const service={
    async rpc(name,args) {
      assert.equal(name,'r2_media_namespace_owner');calls.push({rpc:args.p_root});
      if(service.unavailable)return {data:null,error:{message:'fixture outage'}};
      return {data:(await db.query('select * from public.r2_media_namespace_owner($1,$2,$3,$4)',[args.p_kind,args.p_root,args.p_allow_photographer_root,args.p_allow_deleted_resource])).rows,error:null};
    },
    from(table) {
      assert.equal(table,'photographers');let user;
      const query={select(){return query;},eq(field,value){assert.equal(field,'user_id');user=value;return query;},async maybeSingle(){return {data:(await db.query('select id from public.photographers where user_id=$1',[user])).rows[0]||null,error:null};}};
      return query;
    },
  };
  let user=owner;
  const route=load('app/api/dashboard/storage-folder/route.ts',{
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/dashboard-auth':{resolveDashboardAuth:async()=>({user:{id:user},mfaSatisfied:true}),createDashboardServiceClient:()=>service},
    '@/lib/r2':{listR2FolderImages:async prefix=>{calls.push({listed:prefix});return [{key:`${prefix.replace(/\/$/,'')}/photo.jpg`,url:'fixture',name:'photo.jpg'}];}},
    '@/lib/require-agreement':{guardAgreement:async()=>({ok:true})},
    '@/lib/photographer-storage':{selectPhotographerStorage:async(client,field,value)=>client.from('photographers').select('id').eq(field,value).maybeSingle(),enterPhotographerStorage:()=>({code:'fixture'})},
    '@/lib/r2-access-security':security,'@/lib/r2-media-ownership':resolver,
    '@/lib/credit-cutout-access':{filterPaidCutoutFiles:async files=>files},
    '@/lib/school-photo-deletions':{filterTombstonedSchoolPhotoAssets:files=>files,loadSchoolPhotoTombstones:async(_,id)=>{calls.push({tombstones:id});return [];},tombstoneFamilySet:()=>new Set()},
  });
  return {db,calls,service,asUser:value=>{user=value;},get:path=>route.GET({nextUrl:new URL(`https://fixture.invalid/api/dashboard/storage-folder?path=${encodeURIComponent(path)}`)})};
}

test('retained local school folders remain listable only by their original owner after relabeling',async()=>{
  const f=await fixture();try {
    for(const path of ['original-root/Grade A','renamed-root/Grade A',`schools/${school}/Grade A`,`photos/${school}/Grade A`,`nobg-photos/schools/${school}/Grade A`]) {
      assert.equal((await f.get(path)).status,200,path);
    }
    assert.ok(f.calls.some(call=>call.tombstones===school),'retained root resolves the original school tombstones');
    f.asUser(other);const before=f.calls.filter(call=>call.listed).length;
    assert.equal((await f.get('original-root/Grade A')).status,403);
    assert.equal(f.calls.filter(call=>call.listed).length,before,'foreign owners never enumerate retained bytes');
    await assert.rejects(()=>f.db.query('insert into public.schools values($1,$2,$3)',[secondSchool,other,'original-root']),/original studio owner/);
  }finally{await f.db.close();}
});

test('current alias collisions, removed schools and unsafe/server prefixes cannot authorize folder enumeration',async()=>{
  const f=await fixture();try {
    await f.db.query('insert into public.schools values($1,$2,$3)',[secondSchool,owner,school]);
    assert.equal((await f.get(`schools/${school}/Grade A`)).status,403,'globally ambiguous UUID/local aliases deny even for same owner');
    await f.db.query('delete from public.schools where id=$1',[school]);
    assert.equal((await f.get('original-root/Grade A')).status,403,'retention never reopens a deleted generic gallery');
    for(const path of ['credits/owned','credit-staging/owned','order-automation/owned','../original-root','original-root//Grade A']) assert.equal((await f.get(path)).status,403,path);
    assert.equal(f.calls.filter(call=>call.listed).length,0);
  }finally{await f.db.close();}
});

test('ownership provider outages remain retryable rather than silently listing or falsely denying',async()=>{
  const f=await fixture();try {
    f.service.unavailable=true;
    assert.equal((await f.get('original-root/Grade A')).status,500);
    assert.equal(f.calls.filter(call=>call.listed).length,0);
  }finally{await f.db.close();}
});
