import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import sharp from 'sharp';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const env = { R2_ACCOUNT_ID: 'fixture', R2_ACCESS_KEY_ID: 'fixture', R2_SECRET_ACCESS_KEY: 'fixture', R2_BUCKET_NAME: 'fixture',
  NEXT_PUBLIC_SITE_URL: 'https://gallery-fixture.invalid', NEXT_PUBLIC_SUPABASE_URL: 'https://storage-fixture.supabase.invalid', DOWNLOAD_TOKEN_SECRET: 'synthetic-media-authorization-secret' };
function load(file, modules = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'exports', 'process', 'fetch', code)(name => modules[name] ?? (name.startsWith('@/') ? assert.fail(`Missing dependency: ${name}`) : require(name)), exports, { env }, globals.fetch);
  return exports;
}
const [owner, other, project, foreign, school] = [1,2,3,4,5].map(n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`);
const ownKey = `projects/${project}/albums/main/portrait 1.jpg`, foreignKey = `projects/${foreign}/albums/main/portrait 2.jpg`;
const security = load('lib/r2-access-security.ts');
const browser = load('lib/photo-url.ts');
const tokens = load('lib/r2-media-token.ts', { 'node:crypto': crypto, '@/lib/r2-access-security': security });
const legacyTokens = load('lib/legacy-storage-token.ts', { 'node:crypto': crypto, '@/lib/photo-url': browser });
const native = load('lib/r2-signed-urls.ts');
const privateMedia = load('lib/private-media-references.ts', { '@/lib/r2-signed-urls': native, '@/lib/photo-url': browser,
  '@/lib/legacy-storage-token': legacyTokens, '@/lib/r2-media-token': tokens });
const ownership = load('lib/r2-media-ownership.ts', { '@/lib/r2-access-security': security });
const legacyAccess = load('lib/legacy-storage-access.ts');

function fixture(options = {}) {
  const signed = [], queried = [], fetched = [];
  // These stand in for the service-only immutable registry; editable media
  // rows are intentionally absent from the source of storage ownership.
  const claims = { [`project/${project}`]: { photographer_id: owner, school_id: null }, [`project/${foreign}`]: { photographer_id: other, school_id: null },
    [`school/${school}`]: { photographer_id: owner, school_id: school }, 'school/old-school-alias': { photographer_id: owner, school_id: school } };
  const service = {
    async rpc(name, args) {
      queried.push({ name, args });
      if (options.unavailable) return { data: null, error: { message: 'fixture outage' } };
      if (name === 'legacy_student_storage_owner') return { data: options.legacyOwner || owner, error: null };
      assert.equal(name, 'r2_media_namespace_owner');
      if (args.p_kind === 'photographer' || (args.p_allow_photographer_root && [owner,other].includes(args.p_root))) return { data: [owner, other].includes(args.p_root) ? [{ photographer_id: args.p_root, school_id: null }] : [], error: null };
      const row = claims[`${args.p_kind}/${args.p_root}`];
      return { data: row && (!options.deleted || args.p_allow_deleted_resource) ? [row] : [], error: null };
    },
    from(table) {
      assert.equal(table, 'photographers');
      const filters = new Map();
      const q = { select: () => q, eq: (field, value) => { filters.set(field,value); return q; }, maybeSingle: async () => ({
        data: filters.get('id') === other || filters.get('user_id') === 'other-user' ? {id:other} : {id:owner}, error: null }) };
      return q;
    },
    storage: { from: bucket => ({ createSignedUrl: async (key, ttl) => {
      signed.push({ bucket, key, ttl });
      return { data: { signedUrl: `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/sign/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}?token=native-fixture` }, error:null };
    } }) },
  };
  const signer = { ...native, r2PresignedGetUrl: (key,ttl) => { signed.push({key,ttl}); return native.r2PresignedGetUrl(key,ttl); } };
  const authorized = load('lib/authorized-media.ts', { '@/lib/legacy-storage-access': legacyAccess, '@/lib/photo-url': browser,
    '@/lib/private-media-references': privateMedia, '@/lib/r2-media-ownership': ownership, '@/lib/r2-signed-urls': signer, '@/lib/r2-access-security': security });
  class NextResponse extends Response { static json = (body, init) => Response.json(body,init); static redirect = (url,init) => new Response(null,{status:init.status,headers:{location:url}}); }
  const route = load('app/api/r2/img/[...path]/route.ts', { 'next/server': {NextResponse}, '@/lib/dashboard-auth': {
    createDashboardServiceClient: () => service, resolveDashboardAuth: async () => ({user:options.signedOut?null:{id:options.userId||'own-user'},mfaSatisfied:options.mfaSatisfied??true}) },
    '@/lib/r2-signed-urls': signer, '@/lib/r2': {r2Download:()=>assert.fail('Unexpected byte read')}, '@/lib/r2-access-security': security,
    '@/lib/r2-media-token': tokens, '@/lib/r2-media-ownership': ownership, '@/lib/credit-cutout-access': {isManagedCutoutKey:()=>false},
    '@/lib/school-photo-deletions': {schoolPhotoFamilyForKey:()=>null,tombstoneFamilySet:()=>new Set(),loadSchoolPhotoTombstones:async()=>[]},
  });
  const get = (key,token) => route.GET({nextUrl:new URL(`${env.NEXT_PUBLIC_SITE_URL}/api?${token?`mediaToken=${encodeURIComponent(token)}`:''}`)}, {params:Promise.resolve({path:key.split('/')})});
  const tokenFor = (key,photographerId=owner) => new URL(tokens.signedR2MediaUrl(key,300,photographerId)).searchParams.get('mediaToken');
  return {service,signed,queried,fetched,authorized,get,tokenFor};
}

test('R2 capabilities bind the exact photo, studio and expiry without exposing a native signature', () => {
  assert.equal(tokens.signedR2MediaUrl(ownKey,300), '');
  for (const key of ['../secret.jpg',`credits/${owner}/result.png`,`credit-staging/${owner}/result.png`,`order-automation/${owner}/result.zip`]) assert.equal(tokens.signedR2MediaUrl(key,300,owner),'');
  const link = new URL(tokens.signedR2MediaUrl(ownKey,300,owner)), token = link.searchParams.get('mediaToken');
  assert.equal(link.origin,env.NEXT_PUBLIC_SITE_URL);
  assert.equal(browser.proxiedPhotoUrl(link.href),`${link.pathname}${link.search}`);
  assert.equal(tokens.verifyR2MediaToken(new URL(browser.proxiedPhotoUrl(link.href),env.NEXT_PUBLIC_SITE_URL).searchParams.get("mediaToken"),ownKey),owner);
  assert.equal(tokens.verifyR2MediaToken(token,ownKey),owner);
  assert.equal(tokens.verifyR2MediaToken(token,foreignKey),null);
  assert.equal(tokens.verifyR2MediaToken(`${token}x`,ownKey),null);
  assert.equal(tokens.verifyR2MediaToken(`${token}.extra`,ownKey),null);
  const payload = Buffer.from(JSON.stringify({v:1,key:ownKey,photographerId:owner,exp:Date.now()-1})).toString('base64url');
  const sig = crypto.createHmac('sha256',env.DOWNLOAD_TOKEN_SECRET).update(`studio-os-r2-media-v1:${payload}`).digest('base64url');
  assert.equal(tokens.verifyR2MediaToken(`${payload}.${sig}`,ownKey),null);
  assert.ok(!link.searchParams.has('X-Amz-Signature'));
});

test('an editable media, cover or order reference to another studio never produces a native read', async () => {
  const f = fixture({signedOut:true});
  const compromisedRow = {storage_path:foreignKey,preview_url:foreignKey,sku:foreignKey,cover_photo_url:foreignKey};
  for (const reference of Object.values(compromisedRow)) {
    const capability = new URL(privateMedia.signedPrivateMediaReference(reference,300,owner));
    assert.equal((await f.get(foreignKey,capability.searchParams.get('mediaToken'))).status,403);
    await assert.rejects(f.authorized.authorizedMediaUrl(f.service,reference,owner),/outside the studio/);
  }
  assert.deepEqual(f.signed,[]);
  assert.deepEqual(f.fetched,[]);
});

test('owned project, historical school alias and photographer artwork work with a capability or dashboard MFA', async () => {
  for (const key of [ownKey,`schools/${school}/Student/portrait.jpg`,'old-school-alias/Class/Student/photo.jpg',`${owner}/portrait.jpg`,`backdrops/${owner}/blue.jpg`,`crm-locations/${owner}/campus/photo.jpg`]) {
    const f = fixture({signedOut:true});
    const result = await f.get(key,f.tokenFor(key));
    assert.equal(result.status,302,key);
    assert.match(result.headers.get('location'),/X-Amz-Signature=/);
    assert.equal(result.headers.get('cache-control'),'private, no-store');
    assert.equal(result.headers.get('referrer-policy'),'no-referrer');
    assert.equal(f.signed.length,1);
    const url = await f.authorized.authorizedMediaUrl(f.service,key,owner);
    assert.match(url,/X-Amz-Signature=/);
  }
  assert.equal((await fixture().get(ownKey)).status,302);
  for (const options of [{signedOut:true},{mfaSatisfied:false},{userId:'other-user'}]) {
    const f=fixture(options);assert.ok((await f.get(ownKey)).status>=400);assert.deepEqual(f.signed,[]);
  }
});

test('native byte readers validate exact legacy ownership and retained paid-order resources', async () => {
  const reference=`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/thumbs/legacy-school/Class/photo%201.jpg`;
  const f=fixture();assert.match(await f.authorized.authorizedMediaUrl(f.service,reference,owner),/\/object\/sign\/thumbs\/legacy-school/);
  const foreign=fixture({legacyOwner:other});await assert.rejects(foreign.authorized.authorizedMediaUrl(foreign.service,reference,owner),/another storage owner/);assert.deepEqual(foreign.signed,[]);
  const deleted=fixture({deleted:true});await assert.rejects(deleted.authorized.authorizedMediaUrl(deleted.service,ownKey,owner),/outside the studio/);
  assert.match(await deleted.authorized.authorizedMediaUrl(deleted.service,ownKey,owner,300,{allowDeletedResource:true}),/X-Amz-Signature=/);
  await assert.rejects(deleted.authorized.authorizedMediaUrl(deleted.service,foreignKey,owner,300,{allowDeletedResource:true}),/outside the studio/);
  const outage=fixture({unavailable:true});await assert.rejects(outage.authorized.authorizedMediaUrl(outage.service,ownKey,owner));assert.deepEqual(outage.signed,[]);
});

test('actual event image byte delivery rejects a forged path before fetching and preserves valid originals', async () => {
  const f=fixture(), bytes=await sharp({create:{width:3,height:4,channels:3,background:'#ddd'}}).jpeg().toBuffer();
  const event=load('lib/event-media-delivery.ts', {
    '@/lib/calendar-dates':{},'@/lib/digital-entitlement-payment':{}, sharp, '@/lib/dashboard-auth':{}, '@/lib/event-gallery-download-tokens':{},
    '@/lib/event-gallery-settings':{},'@/lib/request-validation':{},'@/lib/authorized-media':f.authorized,'@/lib/subscription-gate':{},
  }, {fetch:async url=>{f.fetched.push(url);return new Response(bytes,{headers:{'content-type':'image/jpeg'}});}});
  await assert.rejects(event.eventImageBytes({storage_path:foreignKey},{resolution:'original',watermark:false},{service:f.service,photographerId:owner}),/outside the studio/);
  assert.deepEqual(f.fetched,[]);assert.deepEqual(f.signed,[]);
  const result=await event.eventImageBytes({storage_path:ownKey},{resolution:'original',watermark:false},{service:f.service,photographerId:owner});
  assert.deepEqual(result.buffer,bytes);assert.equal(f.fetched.length,1);assert.ok(f.fetched[0].includes(project));
});

test('parent school representative previews preserve exact legacy storage instead of substituting an R2 key', async () => {
  const f=fixture(), bytes=await sharp({create:{width:3,height:4,channels:3,background:'#ddd'}}).jpeg().toBuffer();
  const imageOptions={fetch:async url=>{f.fetched.push(url);return new Response(bytes,{headers:{'content-type':'image/jpeg'}});}};
  const event=load('lib/event-media-delivery.ts', {
    '@/lib/calendar-dates':{},'@/lib/digital-entitlement-payment':{}, sharp, '@/lib/dashboard-auth':{}, '@/lib/event-gallery-download-tokens':{},
    '@/lib/event-gallery-settings':{},'@/lib/request-validation':{},'@/lib/authorized-media':f.authorized,'@/lib/subscription-gate':{},
  },imageOptions);
  const parent=load('lib/school-portal-media.ts',{
    '@/lib/school-gallery-downloads':{},'@/lib/digital-entitlement-payment':{},'@/lib/dashboard-auth':{},'@/lib/calendar-dates':{},
    '@/lib/event-gallery-settings':{normalizeEventGallerySettings:()=>({extras:{}})},'@/lib/private-media-references':privateMedia,
    '@/lib/photo-url':browser,'@/lib/authorized-media':f.authorized,'@/lib/storage-images':{},'@/lib/subscription-gate':{},
    '@/lib/school-photo-deletions':{},'@/lib/credit-cutout-access':{},'@/lib/school-order-media':{},'@/lib/storage-folder':{},'@/lib/event-media-delivery':event,
  });
  const key='legacy-school/Class/Student/portrait 1.jpg';
  const photo_url=`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/thumbs/${key.split('/').map(encodeURIComponent).join('/')}`;
  const student={id:project,school_id:school,pin:'fixture-pin',photo_url};
  const result=parent.schoolPreviewPresentation({school:{id:school,photographer_id:owner},students:[student],visibleStudents:[student],email:'parent@example.test',media:[],composites:[],nobgUrls:{}});
  const payload=parent.verifySchoolMediaToken(new URL(result.students[0].photo_url,env.NEXT_PUBLIC_SITE_URL).searchParams.get('token'),'school-gallery-preview');
  assert.deepEqual(payload.legacyStorage,{bucket:'thumbs',key});
  assert.equal(payload.mediaKey,key);assert.equal(payload.photographerId,owner);
  const image=await parent.schoolImageBytes(f.service,payload,true,false,false);
  assert.equal(image.contentType,'image/jpeg');assert.ok(f.fetched[0].includes('/object/sign/thumbs/'));
  assert.deepEqual(f.signed,[{bucket:'thumbs',key,ttl:300}]);
  const foreign=fixture({legacyOwner:other});await assert.rejects(parent.schoolImageBytes(foreign.service,payload,true,false,false),/another storage owner/);assert.deepEqual(foreign.signed,[]);
});
