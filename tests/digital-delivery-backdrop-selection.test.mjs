import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const compile = file => ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const payment = {};
vm.runInNewContext(compile("lib/digital-entitlement-payment.ts"), { exports: payment });
const display = {};
vm.runInNewContext(compile('lib/order-display.ts'), { exports: display });
const backdrop = { id: 'blue', image_url: 'backdrops/blue.jpg' };
const photos = ['one', 'two'].map(name => ({ id: name, storage_path: `school/Class/Student/${name}.jpg`, filename: `${name}.jpg` }));
const print = { packageName: '5x7 Print', backdrop, slots: [{ label: '5x7 Print', assignedImageUrl: photos[0].storage_path }] };
const all = { packageName: 'All Digital Package', backdrop: null, slots: [], selectedImageUrl: null };
const single = { packageName: 'Digital Image', backdrop, slots: [{ label: 'Selected portrait', assignedImageUrl: photos[0].storage_path }] };

async function resolve(snapshot, orderName = '5x7 Print + All Digital Package', legacyItems = [], event = null) {
  const order = { id: 'order', photographer_id: 'studio', school_id: 'school', student_id: 'student',
    payment_status: 'succeeded', customer_email: 'owned-fixture@example.test', package_name: orderName, cart_snapshot: snapshot, ...(event ? {school_id:null, student_id:null, project_id:event.projectId} : {}) };
  const rows = { media:event?.photos ?? [], projects: event ? [{id:event.projectId}] : [], orders: [order], order_items: legacyItems,
    photographers: [{ id: 'studio' }], students: [{ id: 'student', school_id: 'school' }],
    schools: [{ id: 'school', photographer_id: 'studio' }] };
  const service = { from(table) {
    let singleRow = false; const filters=[];
    const query = { select() { return query; }, eq(key,value) { filters.push(row=>row[key]===value);return query; }, in(key,values){filters.push(row=>values.includes(row[key]));return query;}, order(){return query;},range(){return query;}, maybeSingle() { singleRow = true; return query; },
      then(resolveResult, reject) { return Promise.resolve({ data: singleRow ? rows[table]?.[0] ?? null : (rows[table] ?? []).filter(row=>filters.every(f=>f(row))), error: null }).then(resolveResult, reject); } };
    return query;
  } };
  const forbidden = () => { throw new Error('No network, rendering, email or financial writes in file-selection tests'); };
  const modules = {
    'node:crypto': { createHmac: forbidden, timingSafeEqual: forbidden },
    '@/lib/event-gallery-downloads': { buildArchiveBaseName: () => 'fixture' },
    '@/lib/storage-folder': { buildSchoolCandidateFolders: () => ['school/Class/Student'], loadFolderMediaRows: async () => photos },
    '@/lib/r2-signed-urls': { r2KeyFromAnyUrl: value => value ?? '', r2PresignedGetUrl: forbidden },
    '@/lib/resend': { resendConfigured: forbidden, resolveReplyTo: forbidden, sendResendEmail: forbidden },
    '@/lib/order-display': display,
    '@/lib/digital-entitlement-payment': payment,
    '@/lib/zip': { createZipStream: forbidden },
    '@/lib/backdrop-composites': { hasBackdropCompositeSelection: selection => !!selection?.image_url,
      backdropCompositeFileName: (name, selection) => `${selection.id}-${name}`, composeBackdropImage: forbidden },
  };
  const exports = {};
  vm.runInNewContext(compile('lib/digital-delivery.ts'), { exports, Buffer, URL, process: { env: {} }, fetch: forbidden,
    require(name) { assert.ok(name in modules, `Unexpected module ${name}`); return modules[name]; } });
  return (await exports.resolveDigitalDeliveryContext(service, order.id)).files;
}

test('a print background never changes the purchased original-background all-digital files', async () => {
  const saved = [print, all];
  const before = JSON.stringify(saved);
  const files = await resolve(saved);
  assert.equal(files.length, 2);
  assert.deepEqual(Array.from(files, file => file.key), photos.map(photo => photo.storage_path));
  assert.ok(files.every(file => !file.composite));
  assert.equal(JSON.stringify(saved), before);
});

test('an all-digital background with no selected pose is retained for every gallery file', async () => {
  const files = await resolve([{ ...all, backdrop }], 'All Digital Package');
  assert.equal(files.length, 2);
  assert.ok(files.every(file => file.composite?.backdrop.id === backdrop.id));
});

test('an individual digital background stays on its selected photo beside original all-digitals', async () => {
  const files = await resolve([single, all], 'Digital Image + All Digital Package');
  assert.equal(files.filter(file => !file.composite).length, 2);
  const composites = files.filter(file => file.composite);
  assert.equal(composites.length, 1);
  assert.equal(composites[0].composite.originalUrlOrKey, photos[0].storage_path);
});

test('single digital snapshots retain package intent when a slot uses a plain portrait label', async () => {
  const files = await resolve([single], 'Digital Image');
  assert.equal(files.length, 1);
  assert.equal(files[0].composite.backdrop.id, backdrop.id);
});

test('legacy original all-digital delivery with no snapshot remains eligible', async () => {
  const files = await resolve(null, 'All Digital Package', [{ product_name: 'All Digital Package', sku: null }]);
  assert.equal(files.length, 2);
  assert.ok(files.every(file => !file.composite));
});

test('separate all-gallery packages retain original and background variants', async () => {
  const files = await resolve([all, { ...all, backdrop }], 'All Digital Package');
  assert.equal(files.length, 4);
  assert.equal(files.filter(file => !file.composite).length, 2);
  assert.equal(files.filter(file => file.composite?.backdrop.id === backdrop.id).length, 2);
});

test('multiple gallery backgrounds and orientations are each delivered', async () => {
  const second = { id: 'green', image_url: 'backdrops/green.jpg' };
  const files = await resolve([{ ...all, backdrop }, { ...all, backdrop: second, orientation: 'landscape' }], 'All Digital Package');
  assert.equal(files.length, 4);
  assert.equal(files.filter(file => file.composite?.backdrop.id === second.id && file.composite.orientation === 'landscape').length, 2);
  const repeated = await resolve([{ ...all, backdrop }, { ...all, backdrop }], 'All Digital Package');
  assert.equal(repeated.length, 2, 'identical gallery choices do not duplicate files');
});

test('different purchased blur variants do not collapse into one delivery', async () => {
  const files = await resolve([{ ...all, backdrop: { ...backdrop, blurred: true, blurAmount: 10 } },
    { ...all, backdrop: { ...backdrop, blurred: true, blurAmount: 20 } }], 'All Digital Package');
  assert.equal(files.length, 4);
  assert.equal(files.filter(file => file.composite?.backdrop.blurAmount === 20).length, 2);
});


const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const albumA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const albumB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const event = {projectId, photos:[albumA,albumA,albumB].map((collection_id,i)=>({id:`photo-${i}`,project_id:projectId,collection_id,storage_path:`projects/${projectId}/photo-${i}.jpg`}))};
const savedScope = {version:1,projectId,collectionIds:[albumA]};

test('event all-digital delivery uses the purchased album and excludes another private album', async()=>{
  const files=await resolve([{...all,purchasedEventScope:savedScope}],'All Digital Package',[],event);
  assert.equal(files.length,2);assert.ok(files.every(file=>!file.key.endsWith('photo-2.jpg')));
});

test('legacy event orders without authoritative scope hold for review instead of delivering the whole project',async()=>{
  await assert.rejects(()=>resolve([all],'All Digital Package',[],event),/purchased album scope reviewed/);
  await assert.rejects(()=>resolve(null,'All Digital Package',[{product_name:'All Digital Package'}],event),/purchased album scope reviewed/);
});

test('an event purchase cannot substitute another project or malformed collection identifiers',async()=>{
  for(const purchasedEventScope of [{...savedScope,projectId:'other'},{...savedScope,collectionIds:['bad']},{...savedScope,collectionIds:[]}])
    await assert.rejects(()=>resolve([{...all,purchasedEventScope}],'All Digital Package',[],event),/purchased album scope reviewed/);
});
