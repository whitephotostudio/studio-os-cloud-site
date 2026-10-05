import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { harness, projectId, albumA, a, b, id, legacyRoute, readyRoute } from './helpers/event-gallery-harness.mjs';

const migration=readFileSync(new URL('../supabase/migrations/20261005003000_atomic_gallery_download_quota.sql',import.meta.url),'utf8');
const owner=id(60), school=id(61), student=id(62), portrait=`schools/${school}/Grade A/Student A/portrait.jpg`;
async function sqlFixture(limit='1') {
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create temp table projects(id uuid primary key,photographer_id uuid,gallery_settings jsonb);
    create temp table schools(id uuid primary key,photographer_id uuid,gallery_settings jsonb);
    create temp table collections(id uuid primary key,project_id uuid);
    create temp table media(id uuid primary key,project_id uuid,collection_id uuid);`);
  for(const file of ['20260329143000_create_event_gallery_downloads.sql','20260329190000_create_school_gallery_downloads.sql']) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8').replaceAll('public.','pg_temp.').replaceAll('create table if not exists','create temp table if not exists'));
  }
  await db.exec(migration.replaceAll('public.','pg_temp.').replaceAll('create table if not exists','create temp table if not exists'));
  const settings={extras:{freeDigitalRuleEnabled:true,showDownloadAllButton:true,freeDigitalDownloadLimit:limit}};
  await db.query('insert into projects values($1,null,$2)',[projectId,settings]);
  await db.query('insert into schools values($1,$2,$3)',[school,owner,settings]);
  await db.query('insert into collections values($1,$2)',[albumA,projectId]);
  await db.query('insert into media values($1,$2,$3),($4,$2,$3)',[a,projectId,albumA,b]);
  async function reserve(options={}) {
    const p={kind:'event',gallery:projectId,owner:null,email:'viewer@example.test',media:[a],reservation:id(100),attempt:id(200),collection:albumA,mode:'prepare',gallerySettings:settings,...options};
    return (await db.query('select pg_temp.reserve_portal_gallery_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[p.kind,p.gallery,p.owner,p.email,p.media,p.reservation,p.attempt,p.collection,p.mode,p.gallerySettings])).rows[0].result;
  }
  const finish=(reservation,attempt,media=[],release=false)=>db.query('select pg_temp.finish_portal_gallery_download($1,$2,$3,$4)',[reservation,attempt,media,release]);
  async function attach(h) {
    await db.query('update pg_temp.projects set gallery_settings=$1 where id=$2',[h.tables.projects[0].gallery_settings,projectId]);
    h.service.rpc=(name,args)=>{
      const promise=name==='reserve_portal_gallery_download'?reserve({kind:args.p_gallery_kind,gallery:args.p_gallery_id,owner:args.p_photographer_id,email:args.p_viewer_email,media:args.p_media_ids,reservation:args.p_reservation_id,attempt:args.p_attempt_id,collection:args.p_collection_id,mode:args.p_mode,gallerySettings:args.p_gallery_settings})
        :finish(args.p_reservation_id,args.p_attempt_id,args.p_completed_media_ids,args.p_release).then(()=>null);
      const query={abortSignal(){return query;},then(resolve,reject){return promise.then(data=>({data,error:null}),error=>({data:null,error:{message:error.message}})).then(resolve,reject);}};
      return query;
    };
    return h;
  }
  return {db,reserve,finish,attach,close:()=>db.close()};
}

for(const kind of ['event','school']) test(`concurrent actual ${kind} preparations cannot spend the same last photo allowance`,async()=>{
  const sql=await sqlFixture();try{
    const h=await sql.attach(harness({extras:{freeDigitalDownloadLimit:'1'},folderFiles:[{key:portrait,name:'portrait.jpg',url:`https://fixture.test/${portrait}`}]}));
    let route=legacyRoute,body=h.body({mediaIds:[a]});
    if(kind==='school'){
      h.tables.schools.push({id:school,photographer_id:owner,status:'active',portal_status:'active',gallery_settings:{extras:{freeDigitalRuleEnabled:true,showDownloadAllButton:true,freeDigitalDownloadLimit:'1'}}});
      h.tables.photographers.push({id:owner,subscription_status:'active'});
      h.tables.students.push({id:student,school_id:school,pin:'12345',class_name:'Grade A',folder_name:'Student A',photo_url:portrait});
      route='app/api/portal/school-downloads/route.ts';body={schoolId:school,email:'parent@example.test',pin:'12345',mediaIds:[portrait]};
    }
    // Both route requests observe the same stale zero-use precheck. The actual
    // PostgreSQL RPC must decide admission, not that optimistic precheck.
    const results=await Promise.all([h.post(route,body),h.post(route,body)]);
    assert.equal(results.filter(result=>result.status===200).length,1);
    assert.equal(results.filter(result=>result.status===403).length,1);
    assert.equal(results.flatMap(result=>result.body.allowedMediaIds||[]).length,1);
    const table=kind==='event'?'event_gallery_downloads':'school_gallery_downloads';
    assert.equal((await sql.db.query(`select sum(download_count)::int count from pg_temp.${table}`)).rows[0].count,1);
  }finally{await sql.close();}
});

test('actual SQL quota counts prior rows, truncates preparation, normalizes email and denies foreign scopes',async()=>{
  const f=await sqlFixture('5');try{
    await f.db.exec(`insert into pg_temp.event_gallery_downloads(project_id,viewer_email,download_count)
      select '${projectId}','viewer@example.test',case when n=1001 then 4 else 0 end from generate_series(1,1001) n;`);
    const result=await f.reserve({media:[a,b,a],email:' VIEWER@EXAMPLE.TEST '});
    assert.deepEqual(result.allowedMediaIds,[a]);assert.equal(result.downloadsUsed,5);assert.equal(result.downloadsRemaining,0);
    assert.deepEqual((await f.reserve({media:[a,b,a]})).allowedMediaIds,[a],'idempotent truncated replay cannot grant the second photo');
    await assert.rejects(f.reserve({reservation:id(101),owner:id(999)}),/owner changed/);
    await assert.rejects(f.reserve({reservation:id(101),media:[id(999)]}),/media scope changed/);
    await assert.rejects(f.reserve({reservation:id(100),media:[b]}),/reservation scope changed/);
    await f.db.exec('set role authenticated');await assert.rejects(f.reserve(),/permission denied/);await f.db.exec('reset role');
    await f.db.exec('set role anon');await assert.rejects(f.reserve(),/permission denied/);await f.db.exec('reset role');
  }finally{await f.close();}
});

test('ZIP holds compete with preparation, cancellation releases, and completed IDs count exactly once',async()=>{
  const f=await sqlFixture();try{
    const held=await f.reserve({mode:'zip'});assert.deepEqual(held.allowedMediaIds,[a]);
    assert.equal((await f.db.query('select count(*)::int count from pg_temp.event_gallery_downloads')).rows[0].count,0,'ready/stream hold is not a completed download');
    assert.deepEqual((await f.reserve({reservation:id(101),attempt:id(201)})).allowedMediaIds,[]);
    assert.equal((await f.reserve({mode:'zip',attempt:id(201)})).busy,true,'second active stream cannot release another attempt');
    await assert.rejects(f.finish(id(100),id(201),[],true),/attempt changed/);
    await f.finish(id(100),id(200),[],true);
    assert.deepEqual((await f.reserve({mode:'zip',attempt:id(202)})).allowedMediaIds,[a]);
    await assert.rejects(f.finish(id(100),id(202),[b]),/media scope changed/);
    await f.finish(id(100),id(202),[a]);await f.finish(id(100),id(202),[a]);
    assert.equal((await f.db.query('select sum(download_count)::int count from pg_temp.event_gallery_downloads')).rows[0].count,1);
    assert.deepEqual((await f.reserve({mode:'zip',attempt:id(203)})).allowedMediaIds,[a],'completed signed batch can replay without counting twice');
    assert.deepEqual((await f.reserve({reservation:id(101),media:[b]})).allowedMediaIds,[]);
  }finally{await f.close();}
});

test('failed/expired ZIP holds release without falsely counting; partial retry charges only newly completed IDs',async()=>{
  const f=await sqlFixture('5');try{
    await f.reserve({mode:'zip',media:[a,b]});await f.finish(id(100),id(200),[a]);
    assert.equal((await f.db.query('select sum(download_count)::int count from pg_temp.event_gallery_downloads')).rows[0].count,1);
    await f.reserve({mode:'zip',media:[a,b],attempt:id(201)});
    await f.finish(id(100),id(201),[a,b]);
    assert.equal((await f.db.query('select sum(download_count)::int count from pg_temp.event_gallery_downloads')).rows[0].count,2);
    await f.reserve({mode:'zip',reservation:id(101),attempt:id(202),media:[a]});
    await f.db.query("update pg_temp.portal_gallery_download_reservations set lease_expires_at=now()-interval '1 second' where id=$1",[id(101)]);
    await assert.rejects(f.finish(id(101),id(202),[a]),/expired/);
    const next=await f.reserve({reservation:id(102),attempt:id(203),media:[a,b]});assert.equal(next.downloadsUsed,4);
  }finally{await f.close();}
});

test('quota migration uses current gallery row lock and grants no anonymous/authenticated RPC access',()=>{
  assert.match(migration,/from public\.projects where id=p_gallery_id for update/);
  assert.match(migration,/from public\.schools where id=p_gallery_id for update/);
  assert.match(migration,/select photographer_id into owner_id from public\.projects where id=gallery_id for update/);
  assert.match(migration,/revoke all on function public\.reserve_portal_gallery_download[^;]+from public,anon,authenticated/);
  assert.match(migration,/grant execute on function public\.reserve_portal_gallery_download[^;]+to service_role/);
});

test('actual ZIP route reserves before storage fetch; another prepared batch cannot exceed the same limit',async()=>{
  const sql=await sqlFixture();let unblock,started;
  const blocked=new Promise(resolve=>unblock=resolve),fetchStarted=new Promise(resolve=>started=resolve);
  try{
    const h=await sql.attach(harness({extras:{freeDigitalDownloadLimit:'1'},fetchImage:async()=>{started();await blocked;return new Response('isolated photo bytes');}}));
    const prepared=await Promise.all([h.post(readyRoute,h.body({mediaIds:[a]})),h.post(readyRoute,h.body({mediaIds:[a]}))]);
    assert.ok(prepared.every(result=>result.status===200));
    assert.equal((await sql.db.query('select count(*)::int count from pg_temp.event_gallery_downloads')).rows[0].count,0);
    const first=h.batch(prepared[0].body.manifest.batches[0].token);await fetchStarted;
    const second=await h.batch(prepared[1].body.manifest.batches[0].token);assert.equal(second.status,403);assert.equal(h.fetched.length,1);
    assert.equal((await sql.db.query('select count(*)::int count from pg_temp.event_gallery_downloads')).rows[0].count,0,'in-flight ZIP is held but not completed');
    unblock();assert.equal((await first).status,200);
    assert.equal((await sql.db.query('select sum(download_count)::int count from pg_temp.event_gallery_downloads')).rows[0].count,1);
  }finally{unblock();await sql.close();}
});

test('actual ZIP cancellation releases its attempt without counting and retry can finish once',async()=>{
  const sql=await sqlFixture();try{
    const h=await sql.attach(harness({extras:{freeDigitalDownloadLimit:'1'},fetchImage:async()=>new Response('isolated photo bytes')}));
    const ready=await h.post(readyRoute,h.body({mediaIds:[a]})),token=ready.body.manifest.batches[0].token;
    const response=await h.load('app/api/portal/event-download-batch/route.ts').GET({nextUrl:new URL(`https://fixture.test/api?token=${encodeURIComponent(token)}`)});
    assert.equal(response.status,200);const reader=response.body.getReader();await reader.read();await reader.cancel('test cancellation');
    assert.equal((await sql.db.query('select count(*)::int count from pg_temp.event_gallery_downloads')).rows[0].count,0);
    assert.equal((await sql.db.query('select reserved_count from pg_temp.portal_gallery_download_reservations')).rows[0].reserved_count,0);
    assert.equal((await h.batch(token)).status,200);
    assert.equal((await sql.db.query('select sum(download_count)::int count from pg_temp.event_gallery_downloads')).rows[0].count,1);
  }finally{await sql.close();}
});

test('actual preparation fails closed if the atomic RPC is missing or returns foreign IDs',async()=>{
  for(const kind of ['event','school'])for(const response of [{data:null,error:{code:'PGRST202',message:'Missing migration'}},{data:{allowedMediaIds:[id(999)],downloadsUsed:1,downloadsRemaining:0},error:null},
    {data:{allowedMediaIds:[kind==='event'?a:portrait],busy:'true'},error:null},{data:{allowedMediaIds:[kind==='event'?a:portrait],busy:true},error:null}]){
    const h=harness({folderFiles:[{key:portrait,name:'portrait.jpg',url:`https://fixture.test/${portrait}`}]});
    h.service.rpc=()=>{const q={abortSignal(){return q;},then(resolve,reject){return Promise.resolve(response).then(resolve,reject);}};return q;};
    let route=legacyRoute,body=h.body({mediaIds:[a]});
    if(kind==='school'){
      h.tables.schools.push({id:school,photographer_id:owner,status:'active',portal_status:'active',gallery_settings:{extras:{freeDigitalRuleEnabled:true,showDownloadAllButton:true,freeDigitalDownloadLimit:'1',freeDigitalAudience:'gallery'}}});
      h.tables.photographers.push({id:owner,subscription_status:'active'});h.tables.students.push({id:student,school_id:school,pin:'12345',class_name:'Grade A',folder_name:'Student A',photo_url:portrait});
      route='app/api/portal/school-downloads/route.ts';body={schoolId:school,email:'parent@example.test',pin:'12345',mediaIds:[portrait]};
    }
    const result=await h.post(route,body);assert.equal(result.status,500);assert.equal(result.body.deliveries,undefined);assert.equal(h.writes.length,0);assert.equal(h.fetched.length,0);
  }
});

// Independently reproduced stale-attempt and foreign-ledger regressions.
test('completed ZIP attempt cannot add previously unheld IDs after later preparations fill quota',async()=>{
 const f=await sqlFixture('5'); try {
  await f.reserve({mode:'zip',media:[a,b]});
  await f.finish(id(100),id(200),[a]);
  await f.reserve({reservation:id(101),media:[a,b]});
  await f.reserve({reservation:id(102),media:[a,b]});
  assert.equal((await f.db.query('select sum(download_count)::int n from pg_temp.event_gallery_downloads')).rows[0].n,5);
  await assert.rejects(f.finish(id(100),id(200),[a,b]),/finished|completed|released|scope|quota/i);
 } finally { await f.close(); }
});
test('cancelled retry cannot resurrect capacity after other preparation consumes it',async()=>{
 const f=await sqlFixture('5'); try {
  await f.reserve({mode:'zip',media:[a,b]}); await f.finish(id(100),id(200),[a]);
  await f.reserve({mode:'zip',media:[a,b],attempt:id(201)}); await f.finish(id(100),id(201),[],true);
  await f.reserve({reservation:id(101),media:[a,b]}); await f.reserve({reservation:id(102),media:[a,b]});
  assert.equal((await f.db.query('select sum(download_count)::int n from pg_temp.event_gallery_downloads')).rows[0].n,5);
  await assert.rejects(f.finish(id(100),id(201),[a,b]),/finished|completed|released|scope|quota/i);
 } finally { await f.close(); }
});
test('ZIP legacy log identity rejects another viewer before overwriting their accounting row',async()=>{
 const f=await sqlFixture('5'); try {
  await f.db.query('insert into pg_temp.event_gallery_downloads(id,project_id,viewer_email,download_count,media_ids) values($1,$2,$3,$4,$5)',[id(100),projectId,'other@example.test',1,[b]]);
  await assert.rejects(f.reserve({mode:'zip',media:[a]}),/scope|viewer|existing/i);
 } finally { await f.close(); }
});
test('ZIP finish rejects a project owner transfer after reservation',async()=>{
 const f=await sqlFixture('5'); try {
  await f.reserve({mode:'zip',media:[a]});
  await f.db.query('update pg_temp.projects set photographer_id=$1 where id=$2',[owner,projectId]);
  await assert.rejects(f.finish(id(100),id(200),[a]),/owner|scope/i);
 } finally { await f.close(); }
});

test('school class permission matches existing policy and concurrent class-setting changes fail closed',async()=>{
  for(const extras of [{freeDigitalRuleEnabled:true,schoolClassDownloadOverrides:{'grade-a':{freeDigitalRuleEnabled:false}}},
    {freeDigitalRuleEnabled:false,schoolClassDownloadOverrides:{'grade-a':{freeDigitalRuleEnabled:true}}}]){
    const h=harness({folderFiles:[{key:portrait,name:'portrait.jpg',url:`https://fixture.test/${portrait}`}]});
    h.tables.schools.push({id:school,photographer_id:owner,status:'active',portal_status:'active',gallery_settings:{extras:{showDownloadAllButton:true,freeDigitalDownloadLimit:'1',...extras}}});
    h.tables.photographers.push({id:owner,subscription_status:'active'});h.tables.students.push({id:student,school_id:school,pin:'12345',class_name:'Grade A',folder_name:'Student A',photo_url:portrait});
    let calls=0;h.service.rpc=()=>{calls++;throw Error('Denied classes must never reserve');};
    assert.equal((await h.post('app/api/portal/school-downloads/route.ts',{schoolId:school,email:'parent@example.test',pin:'12345',mediaIds:[portrait]})).status,403);
    assert.equal(calls,0);
  }
  const f=await sqlFixture();try{
    await f.db.query("update pg_temp.schools set gallery_settings=jsonb_set(gallery_settings,'{extras,schoolClassDownloadOverrides}', $1) where id=$2",[{'grade-a':{freeDigitalRuleEnabled:false}},school]);
    await assert.rejects(f.reserve({kind:'school',gallery:school,owner,collection:null,media:[portrait]}),/class download policy changed/);
    assert.equal((await f.db.query('select count(*)::int count from pg_temp.school_gallery_downloads')).rows[0].count,0);
  }finally{await f.close();}
});

test('ZIP RPC must return all exact authorized IDs or none before immutable payload streaming',async()=>{
  const h=harness();h.service.rpc=()=>{const q={abortSignal(){return q;},then(resolve,reject){return Promise.resolve({data:{allowedMediaIds:[a],downloadsUsed:0,downloadsRemaining:0},error:null}).then(resolve,reject);}};return q;};
  await assert.rejects(h.load('lib/gallery-download-quota.ts').reserveGalleryDownload({service:h.service,galleryKind:'event',galleryId:projectId,photographerId:null,viewerEmail:'viewer@example.test',mediaIds:[a,b],mode:'zip'}),/could not be verified/);
});

test('actual cancelled ZIP aborts an active original fetch and starts no subsequent photo request',async()=>{
  const sql=await sqlFixture('5');let sourceSignal;
  try{
    const h=await sql.attach(harness({extras:{freeDigitalDownloadLimit:'5'},fetchImage:async(_url,options)=>{
      sourceSignal=options.signal;
      const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('partial original bytes'));
        sourceSignal.addEventListener('abort',()=>controller.error(Error('upstream aborted')),{once:true});}});
      return new Response(body);
    }}));
    const ready=await h.post(readyRoute,h.body({mediaIds:[a,b]}));const token=ready.body.manifest.batches[0].token;
    const response=await h.load('app/api/portal/event-download-batch/route.ts').GET({nextUrl:new URL(`https://fixture.test/api?token=${encodeURIComponent(token)}`)});
    const reader=response.body.getReader();await reader.read();await reader.cancel('cancel active photo');
    assert.equal(sourceSignal.aborted,true);assert.equal(h.fetched.length,1);
    assert.equal((await sql.db.query('select count(*)::int count from pg_temp.event_gallery_downloads')).rows[0].count,0);
    assert.equal((await sql.db.query('select reserved_count from pg_temp.portal_gallery_download_reservations')).rows[0].reserved_count,0);
  }finally{await sql.close();}
});

test('event preparation and ZIP admission reject audience/PIN/watermark policy changes after final authorization',async()=>{
  for(const mode of ['prepare','zip'])for(const patch of [{freeDigitalAudience:'person',freeDigitalTargetEmail:'other@example.test'},
    {downloadPinEnabled:true,downloadPin:'new-secret'},{watermarkDownloads:true,freeDigitalResolution:'web'}]){
    const sql=await sqlFixture();try{
      const h=await sql.attach(harness({extras:{freeDigitalDownloadLimit:'1'},fetchImage:async()=>new Response('isolated photo bytes')}));
      const prepared=mode==='zip'?await h.post(readyRoute,h.body({mediaIds:[a]})):null;
      const originalRpc=h.service.rpc;
      h.service.rpc=(name,args)=>{
        if(name!=='reserve_portal_gallery_download')return originalRpc(name,args);
        const changed={...h.tables.projects[0].gallery_settings,extras:{...h.tables.projects[0].gallery_settings.extras,...patch}};
        const promise=sql.db.query('update pg_temp.projects set gallery_settings=$1 where id=$2',[changed,projectId]).then(()=>{
          h.tables.projects[0].gallery_settings=changed;return originalRpc(name,args);
        });
        const q={abortSignal(){return q;},then(resolve,reject){return promise.then(resolve,reject);}};return q;
      };
      const result=mode==='zip'?await h.batch(prepared.body.manifest.batches[0].token):await h.post(legacyRoute,h.body({mediaIds:[a]}));
      assert.ok([403,500].includes(result.status));assert.equal(h.fetched.length,0);assert.equal(result.body.deliveries,undefined);
      assert.equal((await sql.db.query('select count(*)::int count from pg_temp.event_gallery_downloads')).rows[0].count,0);
    }finally{await sql.close();}
  }
});
