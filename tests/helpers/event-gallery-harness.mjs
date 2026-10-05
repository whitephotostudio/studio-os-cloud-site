import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = new URL('../../', import.meta.url);
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), otherProjectId = id(2), albumA = id(3), albumB = id(4), lockedAlbum = id(5);
const a = id(10), b = id(11), locked = id(12), foreign = id(13);
const readyRoute = 'app/api/portal/event-download-ready/route.ts';
const legacyRoute = 'app/api/portal/event-downloads/route.ts';

export function harness({ extras = {}, media, logs = [], collections, repeatPage = false, failMediaPage = null, fetchImage = null, signedUrls = null, rateAllowed = true, folderFiles = [], cutoutBytes = null, sourceOverrides = {}, overrides = {} } = {}) {
  const writes = [], queries = [], fetched = [];
  const tables = {
    projects: [{ id: projectId, title: 'Fixture Event', workflow_type: 'event', status: 'active', email_required: false, access_mode: 'pin', access_pin: 'project-pin', photographer_id: null, gallery_settings: { extras: { freeDigitalRuleEnabled: true, showDownloadAllButton: true, freeDigitalAudience: 'gallery', freeDigitalDownloadLimit: 'unlimited', freeDigitalResolution: 'original', watermarkDownloads: false, includePrintRelease: false, allowClientFavoriteDownloads: true, favoriteDownloadsRequireAllDigitalsPurchase: false, ...extras } } }],
    collections: collections ?? [
      { id: albumA, project_id: projectId, title: 'Album A', kind: 'album', slug: 'album-a', access_mode: 'inherit_project', access_pin: null },
      { id: albumB, project_id: projectId, title: 'Album B', kind: 'album', slug: 'album-b', access_mode: 'public', access_pin: null },
      { id: lockedAlbum, project_id: projectId, title: 'Locked', kind: 'album', slug: 'guessable-slug', access_mode: 'private', access_pin: 'secret-pin' },
    ],
    media: media ?? [
      { id: a, project_id: projectId, collection_id: albumA, filename: 'a.jpg', storage_path: 'fixture/a.jpg' },
      { id: b, project_id: projectId, collection_id: albumB, filename: 'b.jpg', storage_path: 'fixture/b.jpg' },
      { id: locked, project_id: projectId, collection_id: lockedAlbum, filename: 'locked.jpg', storage_path: 'fixture/locked.jpg' },
      { id: foreign, project_id: otherProjectId, collection_id: albumA, filename: 'foreign.jpg', storage_path: 'fixture/foreign.jpg' },
    ],
    event_gallery_downloads: logs.map((row, index) => ({ id: id(20000 + index), project_id: projectId, viewer_email: 'viewer@example.test', download_type: 'gallery', ...row })),
    pre_release_emails: [], subjects: [], orders: [], packages: [], photographers: [], schools: [], students: [], school_photo_deletions: [], school_gallery_downloads: [],
  };
  const service = { from(table) {
    const filters = []; let range, cap, single = false, mutation = false;
    const record = { table, filters: [], range: null }; queries.push(record);
    const q = {
      select() { return q; },
      eq(key, value) { filters.push(row => row[key] === value); record.filters.push([key, value]); return q; },
      ilike(key, value) { filters.push(row => typeof row[key] === 'string' && row[key].toLowerCase() === value.toLowerCase()); return q; },
      or(value) { const parts=value.split(',').map(part=>part.split('.ilike.')); filters.push(row=>parts.some(([key,wanted])=>typeof row[key]==='string'&&row[key].toLowerCase()===wanted.toLowerCase())); return q; },
      single() { single=true; return q; },
      in(key, values) { filters.push(row => values.includes(row[key])); record.filters.push([key, values]); return q; },
      order() { return q; },
      range(from, to) { range = [from, to]; record.range = range; return q; },
      limit(value) { cap = value; return q; },
      maybeSingle() { single = true; return q; },
      insert(value) { mutation = true; writes.push({ table, value }); return q; },
      upsert(value) { mutation = true; writes.push({ table, value }); return q; },
      then(resolve, reject) {
        if (table === 'media' && range?.[0] === failMediaPage) return Promise.resolve({ data: null, error: { message: 'fixture read failed' } }).then(resolve, reject);
        let rows = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
        const count = rows.length;
        if (range) rows = rows.slice(repeatPage && table === 'media' ? 0 : range[0], repeatPage && table === 'media' ? range[1] - range[0] + 1 : range[1] + 1);
        rows = rows.slice(0, Math.min(cap ?? 1000, 1000));
        return Promise.resolve({ data: mutation ? null : single ? rows[0] ?? null : rows, error: null, count }).then(resolve, reject);
      },
    }; return q;
  } };
  const reservations = new Map();
  service.rpc = (name, args) => {
    const promise = Promise.resolve().then(() => {
      if (name === 'finish_portal_gallery_download') {
        const held=reservations.get(args.p_reservation_id);
        if (!held || held.attempt!==args.p_attempt_id) return {data:null,error:{message:'Reservation attempt changed'}};
        if (args.p_release) {held.count=0;return {data:null,error:null};}
        const completed=[...new Set([...held.completed,...args.p_completed_media_ids])];
        held.completed=completed;held.count=0;
        if(completed.length){
          const value={id:args.p_reservation_id,project_id:held.gallery,collection_id:held.collection,viewer_email:held.email,download_type:'gallery',download_count:completed.length,media_ids:completed};
          const existing=tables.event_gallery_downloads.find(row=>row.id===value.id);
          if(existing)Object.assign(existing,value);else tables.event_gallery_downloads.push(value);
          writes.push({table:'event_gallery_downloads',value});
        }
        return {data:null,error:null};
      }
      assert.equal(name,'reserve_portal_gallery_download');
      const event=args.p_gallery_kind==='event', table=event?'event_gallery_downloads':'school_gallery_downloads';
      const gallery=(event?tables.projects:tables.schools).find(row=>row.id===args.p_gallery_id);
      if(!gallery||(gallery.photographer_id??null)!==args.p_photographer_id)return {data:null,error:{message:'Gallery owner changed'}};
      const email=args.p_viewer_email.trim().toLowerCase(), ids=[...new Set(args.p_media_ids)], extras=gallery.gallery_settings.extras;
      const used=tables[table].filter(row=>row[event?'project_id':'school_id']===gallery.id&&row.viewer_email.toLowerCase()===email&&row.download_type==='gallery').reduce((sum,row)=>sum+Math.max(0,row.download_count??0),0);
      const otherHolds=[...reservations.entries()].filter(([key,value])=>key!==args.p_reservation_id&&value.gallery===gallery.id&&value.email===email).reduce((sum,[,value])=>sum+value.count,0);
      const limit=extras.freeDigitalDownloadLimit==='unlimited'?null:Number(extras.freeDigitalDownloadLimit??0);
      const remaining=limit===null?null:Math.max(0,limit-used-otherHolds);
      const prior=reservations.get(args.p_reservation_id);
      if(args.p_mode==='zip'){
        if(prior?.count>0)return {data:{allowedMediaIds:[],busy:true},error:null};
        const completed=prior?.completed??tables.event_gallery_downloads.find(row=>row.id===args.p_reservation_id)?.media_ids??[];
        const count=ids.filter(key=>!completed.includes(key)).length;
        if(remaining!==null&&count>remaining)return {data:{allowedMediaIds:[],downloadsUsed:used,downloadsRemaining:remaining},error:null};
        reservations.set(args.p_reservation_id,{gallery:gallery.id,collection:args.p_collection_id,email,completed,count,attempt:args.p_attempt_id});
        return {data:{allowedMediaIds:ids,downloadsUsed:used,downloadsRemaining:remaining===null?null:remaining-count},error:null};
      }
      const allowed=remaining===null?ids:ids.slice(0,remaining);
      if(allowed.length){
        const value={id:args.p_reservation_id,[event?'project_id':'school_id']:gallery.id,collection_id:args.p_collection_id,viewer_email:email,download_type:'gallery',download_count:allowed.length,media_ids:allowed};
        tables[table].push(value);writes.push({table,value});
      }
      return {data:{allowedMediaIds:allowed,downloadsUsed:used+allowed.length,downloadsRemaining:remaining===null?null:remaining-allowed.length},error:null};
    });
    const query={abortSignal(){return query;},then(resolve,reject){return promise.then(resolve,reject);}};return query;
  };
  class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }
  const cache = new Map();
  const stubs = {
    'next/server': { NextResponse },
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => service },
    '@/lib/rate-limit': { rateLimit: async () => ({ allowed: rateAllowed, resetAt: Date.now()+60000 }), getClientIp: () => 'fixture' },
    '@/lib/storage-images': { SIGNED_URL_TTL_PARENTS_PORTAL_SECONDS: 21600, buildSignedMediaUrls: input => signedUrls ? signedUrls(input) : ({ originalUrl: `https://fixture.test/${input.storagePath}`, previewUrl: null, thumbnailUrl: null }), extractStoragePathFromSupabaseUrl: () => null },
    '@/lib/private-media-references': { signedPrivateMediaReference: value => value, durablePrivateMediaReference: value => value ?? '', privateMediaKeyFromReference: value => typeof value==='string' && !value.includes('://') && !value.startsWith('/api/portal/') ? value : value?.startsWith('https://fixture.test/') ? value.slice('https://fixture.test/'.length).split(/[?#]/)[0] : '', signPhotoUrlRows: rows=>rows },
    '@/lib/package-profile-selection': { filterPackagesForProfile: value => ({packages:value}) },
    '@/lib/subscription-gate': { hasActiveSubscription: row => row?.subscription_status === 'active' },
    '@/lib/checkout-tax': { applyCheckoutTaxFallbackToSettings: value => value },
    '@/lib/school-sync':{findSyncedSchoolProjectId:async()=>null},
    '@/lib/r2':{listR2FolderImages:async prefix=>folderFiles.filter(file=>file.key.startsWith(prefix+'/')),r2Download:async()=>cutoutBytes},
    '@/lib/credit-cutout-access':{filterPaidCutoutFiles:async files=>files,isManagedCutoutKey:key=>key.startsWith('nobg-photos/'),readPaidCutout:async(_service,_owner,key)=>{if(!cutoutBytes)throw Error('No paid cutout');return cutoutBytes;}},
  };
  Object.assign(stubs,overrides);
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const js = ts.transpileModule(sourceOverrides[file] ?? readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    vm.runInNewContext(js, { exports, Response, Request, URL, Buffer, atob, TextDecoder, TextEncoder, ReadableStream, AbortController, AbortSignal, setTimeout, clearTimeout, console, process: { env: { EVENT_DOWNLOAD_TOKEN_SECRET: 'synthetic-test-secret' } },
      fetch: async (url, options) => { fetched.push(url); return fetchImage ? fetchImage(url, options) : new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }); },
      require(name) { if (name in stubs) return stubs[name]; if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`); if (name.startsWith('.')) return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name)) + '.ts'); return require(name); },
    }, { filename: file }); return exports;
  }
  const body = overrides => ({ projectId, email: 'viewer@example.test', pin: 'project-pin', collectionId: albumA, mediaIds: [a, b, locked, foreign], ...overrides });
  return { service, tables, queries, writes, fetched, load, body, async get(url) {
    const parsed=new URL(url,'https://fixture.test');
    const preview=parsed.pathname.includes('-preview/');
    const school=parsed.pathname.includes('/school-');
    const route=school?(preview?'app/api/portal/school-preview/[filename]/route.ts':'app/api/portal/school-download-file/route.ts'):(preview?'app/api/portal/event-preview/[filename]/route.ts':'app/api/portal/event-download-file/route.ts');
    const response=await load(route).GET({nextUrl:parsed,headers:new Headers()}, {params:Promise.resolve({filename:parsed.pathname.split('/').pop()})});
    return {status:response.status,headers:response.headers,body:response.headers.get('content-type')?.includes('json')?await response.json():Buffer.from(await response.arrayBuffer())};
  }, async post(route, payload = body()) {
    const response = await load(route).POST(new Request('https://fixture.test/api', { method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } }));
    return { status: response.status, body: await response.json() };
  }, async batch(token, json = false) {
    const response = await load('app/api/portal/event-download-batch/route.ts').GET({ nextUrl: new URL(`https://fixture.test/api?token=${encodeURIComponent(token)}${json ? '&format=json' : ''}`) });
    return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? await response.json() : new Uint8Array(await response.arrayBuffer()) };
  } };
}


export { projectId, otherProjectId, albumA, albumB, lockedAlbum, a, b, locked, foreign, id, readyRoute, legacyRoute };
