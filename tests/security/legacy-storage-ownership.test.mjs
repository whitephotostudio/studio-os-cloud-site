import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../supabase/migrations/20261012040000_legacy_storage_ownership_gateway.sql', import.meta.url), 'utf8');
const cutover = readFileSync(new URL('../../docs/security/2026-10-12-legacy-storage-private-cutover.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../../docs/security/2026-10-12-legacy-storage-private-cutover-rollback.sql', import.meta.url), 'utf8');
const owner='11111111-1111-4111-8111-111111111111', foreign='22222222-2222-4222-8222-222222222222';
const uploader='33333333-3333-4333-8333-333333333333', otherUploader='44444444-4444-4444-8444-444444444444';
const project='55555555-5555-4555-8555-555555555555';
const objectIds=Array.from({length:6},(_,index)=>`66666666-6666-4666-8666-${String(index+1).padStart(12,'0')}`);

async function fixture() {
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema storage;
    create table public.photographers(id uuid primary key,user_id uuid);
    create table public.projects(id uuid primary key,photographer_id uuid);
    create table public.schools(id uuid primary key,local_school_id text,photographer_id uuid);
    create table public.media(id integer,project_id uuid,thumbnail_url text);
    create table public.students(id integer,photo_url text);
    create table public.orders(id integer,photo_url text);
    create table storage.buckets(id text primary key,public boolean);
    create table storage.objects(id uuid primary key,bucket_id text,name text,owner_id text);
    alter table storage.objects enable row level security;
    create policy "Anyone can view studio logos" on storage.objects for select to public using(bucket_id='studio-logos');
    create policy "Public read access for thumbs" on storage.objects for select to public using(bucket_id='thumbs');
    create policy "Public read backdrops" on storage.objects for select to public using(bucket_id='backdrops');
    create policy "Public read nobg" on storage.objects for select to public using(bucket_id='nobg-photos');
    insert into storage.buckets values('thumbs',true),('nobg-photos',true),('photos',false),('backdrops',true),('studio-logos',true);
    grant usage on schema public,storage to anon,authenticated,service_role;
    grant select on storage.objects,public.photographers to service_role;`);
  await db.exec('grant select on storage.objects to anon,authenticated');
  await db.query('insert into photographers values($1,$2),($3,$4)',[owner,uploader,foreign,otherUploader]);
  await db.query('insert into projects values($1,$2)',[project,owner]);
  await db.query('insert into schools values($1,$2,$3),($4,$2,$5)',[uploader,'ambiguous-school',owner,otherUploader,foreign]);
  const rows=[
    ['thumbs',`projects/${project}/original.jpg`,uploader],
    ['thumbs',`projects/${project}/legacy.jpg`,null],
    ['nobg-photos',`projects/${project}/uploader-authoritative.png`,otherUploader],
    ['thumbs','ambiguous-school/class/photo.jpg',null],
    ['thumbs','orphan/photo.jpg',null],
    ['thumbs',`projects/${project}/unknown-uploader.jpg`,'deleted-user'],
  ];
  for(let index=0;index<rows.length;index++) await db.query('insert into storage.objects values($1,$2,$3,$4)',[objectIds[index],...rows[index]]);
  await db.query('insert into storage.objects values($1,$2,$3,null),($4,$5,$6,null)',[
    '88888888-8888-4888-8888-888888888888','backdrops','public-background.jpg',
    '99999999-9999-4999-8999-999999999999','studio-logos','public-logo.jpg']);
  return db;
}
async function resolved(db,bucket,key) {
  return (await db.query('select public.legacy_student_storage_owner($1,$2) as owner',[bucket,key])).rows[0].owner;
}

test('ownership migration snapshots immutable uploader/unique existing namespaces and leaves every object unchanged',async()=>{
  const db=await fixture();
  try {
    const before=(await db.query('select * from storage.objects order by id')).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query('select * from storage.objects order by id')).rows,before);
    assert.equal(await resolved(db,'thumbs',`projects/${project}/original.jpg`),owner);
    assert.equal(await resolved(db,'thumbs',`projects/${project}/legacy.jpg`),owner);
    assert.equal(await resolved(db,'nobg-photos',`projects/${project}/uploader-authoritative.png`),foreign);
    for(const key of ['ambiguous-school/class/photo.jpg','orphan/photo.jpg',`projects/${project}/unknown-uploader.jpg`]) assert.equal(await resolved(db,'thumbs',key),null);
    assert.equal((await db.query('select count(*)::int count from legacy_student_storage_ownership')).rows[0].count,3);
  } finally {await db.close();}
});

test('client edited media pointers and later namespace changes cannot claim legacy objects',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);
    await db.query('insert into media values(1,$1,$2)',[project,'orphan/photo.jpg']);
    await db.query('update projects set photographer_id=$1 where id=$2',[foreign,project]);
    assert.equal(await resolved(db,'thumbs','orphan/photo.jpg'),null);
    assert.equal(await resolved(db,'thumbs',`projects/${project}/legacy.jpg`),owner);
    await db.exec(migration); // Re-running preserves recorded owner.
    assert.equal(await resolved(db,'thumbs',`projects/${project}/legacy.jpg`),owner);
    await db.query('delete from storage.objects where id=$1',[objectIds[1]]);
    await db.query('insert into storage.objects values($1,$2,$3,$4)',['77777777-7777-4777-8777-777777777777','thumbs',`projects/${project}/legacy.jpg`,otherUploader]);
    assert.equal(await resolved(db,'thumbs',`projects/${project}/legacy.jpg`),null);
  } finally {await db.close();}
});

test('only the server can read ownership proofs or call the ownership resolver',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(()=>resolved(db,'thumbs',`projects/${project}/original.jpg`),/permission denied/);
      await assert.rejects(()=>db.query('select * from legacy_student_storage_ownership'),/permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.equal(await resolved(db,'thumbs',`projects/${project}/original.jpg`),owner);
  } finally {await db.close();}
});

test('private cutover requires verification, removes anonymous photo reads and preserves public artwork and object bytes',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);
    const objects=(await db.query('select * from storage.objects order by id')).rows;
    const buckets=(await db.query('select * from storage.buckets order by id')).rows;
    await assert.rejects(()=>db.exec(cutover),/Verify deployed legacy gateway/);
    await db.exec('rollback');
    assert.deepEqual((await db.query('select * from storage.buckets order by id')).rows,buckets);
    await db.exec("set studio_os.legacy_storage_cutover_verified='gateway-and-backup-verified'");
    await db.exec(cutover);
    assert.deepEqual((await db.query('select * from storage.objects order by id')).rows,objects);
    assert.deepEqual((await db.query('select * from storage.buckets where public order by id')).rows,[{id:'backdrops',public:true},{id:'studio-logos',public:true}]);
    await db.exec('set role anon');
    assert.deepEqual((await db.query('select bucket_id from storage.objects order by bucket_id')).rows,[{bucket_id:'backdrops'},{bucket_id:'studio-logos'}]);
    await db.exec('reset role');
    await db.exec(rollback);
    assert.deepEqual((await db.query('select * from storage.buckets order by id')).rows,buckets);
    assert.deepEqual((await db.query('select * from storage.objects order by id')).rows,objects);
    await db.exec('set role anon');
    assert.equal((await db.query('select count(*)::int count from storage.objects')).rows[0].count,8);
  } finally {await db.close();}
});

test('private cutover aborts if a current photo pointer has unresolved ownership',async()=>{
  const db=await fixture();
  try {
    await db.exec(migration);
    await db.query('insert into media values(1,$1,$2)',[project,'orphan/photo.jpg']);
    await db.exec("set studio_os.legacy_storage_cutover_verified='gateway-and-backup-verified'");
    await assert.rejects(()=>db.exec(cutover),/active legacy photo reference has no frozen owner/);
    await db.exec('rollback');
    assert.equal((await db.query("select count(*)::int count from storage.buckets where id in ('thumbs','nobg-photos') and public")).rows[0].count,2);
  } finally {await db.close();}
});
