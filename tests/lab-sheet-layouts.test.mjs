import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import util from 'node:util';
import ts from 'typescript';
import sharp from 'sharp';
import { z } from 'zod';
import { createLabDatabase, LAB_FIXTURE, fixtureToken, seedLegacyLabCanaries } from '../scripts/lab-system-fixture.mjs';

function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => { if (!(name in dependencies)) throw Error('Missing dependency ' + name); return dependencies[name]; }, exports);
  return exports;
}
const layouts = load('lib/labs/sheet-layouts.ts', { zod: { z } });
const uuid = () => crypto.randomUUID();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const PAPER_DIMENSIONS = { '4x6': [4,6], '5x7': [5,7], '7x10': [7,10], '8x10': [8,10], '8x12': [8,12], '12x18': [12,18] };
const FINISHED_LAYOUTS = {
  'single-8x10': { bounds: [8,10], cells: [['a',0,0,8,10]] },
  'two-5x7': { bounds: [10,7], cells: [['a',0,0,5,7],['b',5,0,5,7]] },
  'single-5x7': { bounds: [5,7], cells: [['a',0,0,5,7]] },
  'four-wallets': { bounds: [5,7], cells: [['a',0,0,2.5,3.5],['b',2.5,0,2.5,3.5],['c',0,3.5,2.5,3.5],['d',2.5,3.5,2.5,3.5]] },
  'single-4x6': { bounds: [4,6], cells: [['a',0,0,4,6]] },
};
function document(patch = {}) {
  const value = { paperId: '7x10', orientation: 90, templateId: 'two-5x7', copies: 2, ...patch };
  return { ...value, cells: patch.cells ?? FINISHED_LAYOUTS[value.templateId].cells.map(([id]) => ({ id, assetId: null, crop: null })) };
}
const saveAction = (doc = document(), patch = {}) => ({ action: 'save', draftId: uuid(), requestId: uuid(), expectedVersion: 0, jobId: null, name: 'SYNTHETIC independent paper draft', document: doc, ...patch });
const source = (patch = {}) => ({ id: uuid(), kind: 'original', filename: 'SYNTHETIC source.jpg', sha256: 'a'.repeat(64), byteSize: 12345, widthPixels: 6000, heightPixels: 6000, contentType: 'image/jpeg', ...patch });

// All prices, IDs, images and school records used below are invented.
test('every paper preset independently accepts only fixed finished layouts that fit, without shrinking or rotating prints', () => {
  let accepted = 0, rejected = 0;
  for (const [paperId, paper] of Object.entries(PAPER_DIMENSIONS)) for (const orientation of [0,90]) for (const [templateId, template] of Object.entries(FINISHED_LAYOUTS)) {
    const [width,height] = orientation === 90 ? [paper[1],paper[0]] : paper;
    const value = document({ paperId, orientation, templateId });
    if (template.bounds[0] > width || template.bounds[1] > height) {
      assert.throws(() => layouts.sheetGeometry(value), /SHEET_LAYOUT_DOES_NOT_FIT/, `${paperId}/${orientation}/${templateId}`);
      rejected++; continue;
    }
    const actual = layouts.sheetGeometry(value), x = (width - template.bounds[0]) / 2, y = (height - template.bounds[1]) / 2;
    assert.deepEqual([actual.widthInches,actual.heightInches,actual.widthPixels,actual.heightPixels], [width,height,width*300,height*300]);
    assert.deepEqual(actual.cells.map(c => [c.id,c.xInches,c.yInches,c.widthInches,c.heightInches]), template.cells.map(([id,left,top,w,h]) => [id,x+left,y+top,w,h]));
    for (const c of actual.cells) {
      assert(c.xInches >= 0 && c.yInches >= 0 && c.xInches + c.widthInches <= width && c.yInches + c.heightInches <= height);
      assert(Number.isInteger(c.xInches * 300) && Number.isInteger(c.yInches * 300));
      for (const other of actual.cells.filter(o => o.id !== c.id)) assert(!(c.xInches < other.xInches + other.widthInches && other.xInches < c.xInches + c.widthInches && c.yInches < other.yInches + other.heightInches && other.yInches < c.yInches + c.heightInches), 'Finished print areas do not overlap');
    }
    accepted++;
  }
  assert.equal(accepted + rejected, 60); assert(accepted > 0 && rejected > 0);
});

test('paper changes preserve finished cell sizes and center unused paper as explicit margins', () => {
  const exact = layouts.sheetGeometry(document()), larger = layouts.sheetGeometry(document({ paperId: '8x10' })), largest = layouts.sheetGeometry(document({ paperId: '12x18' }));
  assert.deepEqual(exact.cells.map(c => [c.widthInches,c.heightInches]), [[5,7],[5,7]]);
  assert.deepEqual(larger.cells.map(c => [c.xInches,c.yInches,c.widthInches,c.heightInches]), [[0,0.5,5,7],[5,0.5,5,7]]);
  assert.deepEqual([larger.widthPixels,larger.heightPixels], [3000,2400]);
  assert.deepEqual(largest.cells.map(c => [c.xInches,c.yInches,c.widthInches,c.heightInches]), [[4,2.5,5,7],[9,2.5,5,7]]);
  assert.throws(() => layouts.sheetGeometry(document({ paperId: '8x10', orientation: 0 })), /DOES_NOT_FIT/, 'Two 5x7 prints must not auto-shrink to fit eight inches');
  assert.throws(() => layouts.sheetGeometry(document({ paperId: '7x10', orientation: 90, templateId: 'single-8x10' })), /DOES_NOT_FIT/, 'Paper rotation does not rotate finished prints');
});

test('strict layout actions reject extra pricing fields, duplicate cells, unsupported paper and fractional geometry', () => {
  const valid = saveAction(); assert.deepEqual(layouts.parseSheetAction(valid), valid);
  for (const [field,value] of [['paperId','custom'],['orientation',180],['orientation','90'],['copies',0],['copies',11],['copies',1.5]]) assert.throws(() => layouts.parseSheetAction(saveAction({ ...valid.document, [field]:value })));
  for (const cells of [[], [valid.document.cells[0]], [valid.document.cells[0],valid.document.cells[0]], [...valid.document.cells,{ id:'c',assetId:null,crop:null }], [{ id:'a',assetId:null,crop:null,xInches:0 },valid.document.cells[1]]]) assert.throws(() => layouts.parseSheetAction(saveAction({ ...valid.document,cells })));
  for (const field of ['retailCents','subtotalMinor','payment','printAllowed','photographerId']) assert.throws(() => layouts.parseSheetAction({ ...valid,[field]:1 }));
  for (const field of ['price','widthInches','heightInches','scale','positions']) assert.throws(() => layouts.parseSheetAction({ ...valid,document:{ ...valid.document,[field]:1 } }));
  const crop = { x:0,y:0,width:1000,height:1400,rotation:0 };
  for (const patch of [{ width:1000.1 },{ x:-1 },{ rotation:45 },{ paidAi:true }]) assert.throws(() => layouts.parseSheetAction(saveAction(document({ cells:[{ id:'a',assetId:uuid(),crop:{ ...crop,...patch } },{ id:'b',assetId:null,crop:null }] }))));
  assert.deepEqual(layouts.sheetGeometry(document({ cells:[...valid.document.cells].reverse() })).cells.map(c => c.id), ['a','b'], 'Canonical geometry keeps IDs independent of the input cell array order');
  assert.throws(() => layouts.parseSheetAction({ action:'render',draftId:uuid(),requestId:uuid(),expectedVersion:0 }));
  assert.throws(() => layouts.parseSheetAction({ action:'review',draftId:uuid(),renderId:uuid(),expectedVersion:1,sha256:'invalid' }));
});

test('integer upright crop bounds, quarter rotations and retained 200ppi are checked for every finished size', () => {
  const original = source();
  for (const [templateId,template] of Object.entries(FINISHED_LAYOUTS)) {
    const [id,,,widthInches,heightInches] = template.cells[0], cell = { id,label:'SYNTHETIC print',xInches:0,yInches:0,widthInches,heightInches };
    const width = widthInches * 200, height = heightInches * 200;
    for (const rotation of [0,90,180,270]) {
      const turn = rotation === 90 || rotation === 270, crop = { x:13,y:17,width:turn?height:width,height:turn?width:height,rotation };
      assert.deepEqual(layouts.validateSheetCrop(original,crop,cell), { retainedPpi:200,widthPixels:widthInches*300,heightPixels:heightInches*300 });
      const tooSmall = { ...crop,width:Math.floor(crop.width*0.99),height:Math.floor(crop.height*0.99) };
      assert.throws(() => layouts.validateSheetCrop(original,tooSmall,cell), /RESOLUTION|ASPECT/, templateId+' below 200ppi');
    }
    const crop = { x:6000-width,y:6000-height,width,height,rotation:0 };
    assert.doesNotThrow(() => layouts.validateSheetCrop(original,crop,cell));
    for (const bad of [{ ...crop,x:crop.x+1 },{ ...crop,y:crop.y+1 },{ ...crop,x:-1 },{ ...crop,x:0.5 },{ ...crop,width:Infinity },{ ...crop,height:NaN },{ ...crop,rotation:'90' },{ ...crop,rotation:45 }]) assert.throws(() => layouts.validateSheetCrop(original,bad,cell), /INVALID_CROP/);
  }
  const cell = layouts.sheetGeometry(document()).cells[0];
  assert.throws(() => layouts.validateSheetCrop(original,{ x:0,y:0,width:2000,height:2000,rotation:0 },cell), /ASPECT/);
  assert.equal(layouts.validateSheetCrop(original,{ x:0,y:0,width:1999,height:2800,rotation:0 },cell).widthPixels,1500, 'The bounded aspect tolerance never changes physical print dimensions');
});

const money = load('lib/labs/money.ts');
const labValidation = load('lib/labs/validation.ts', { zod: { z }, './money': money });
const privateValidation = load('lib/labs/in-house-validation.ts', { 'node:crypto': crypto, zod: { z }, './money': money, './validation': labValidation });
const token = () => crypto.randomBytes(32).toString('hex');
const OLD_TABLES = ['schools','projects','packages','package_profiles','orders','studio_labs','studio_lab_catalog','lab_price_sheets','lab_order_assets','lab_orders','lab_order_events','in_house_price_sheets','in_house_test_galleries','in_house_test_orders','in_house_test_order_events','lab_production_policies','lab_production_assets','lab_production_galleries','lab_production_jobs','lab_production_events','lab_production_v2_jobs','lab_production_v2_assets','lab_production_v2_events','lab_connector_pairs','lab_connector_devices','lab_connector_dispatches'];
async function asRole(db, role, user, action, aal = 'aal2') {
  assert(['service_role','authenticated','anon'].includes(role));
  return db.transaction(async tx => {
    await tx.exec('set local role ' + role);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)", [user || '',role,JSON.stringify({ sub:user,role,aal })]);
    return action(tx);
  });
}
async function rpc(db, name, args) {
  assert.match(name, /^[a-z_][a-z_0-9]*$/);
  const values = Object.entries(args); for (const [key] of values) assert.match(key, /^[a-z_][a-z_0-9]*$/);
  return asRole(db,'service_role',null,async tx => (await tx.query('select ' + name + '(' + values.map(([key],i) => key + '=>$' + (i+1)).join(',') + ') as result',values.map(([,value]) => value !== null && typeof value === 'object' ? JSON.stringify(value) : value))).rows[0].result);
}
async function snapshots(db, tables = OLD_TABLES) {
  const result = {}; for (const table of tables) { assert.match(table,/^[a-z_][a-z_0-9]*$/); result[table] = (await db.query("select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from " + table + ' t')).rows[0].rows; }
  return JSON.stringify(result);
}
function privateSheet() {
  const sourceSnapshot = { profile:{ id:'SYNTHETIC-sheet-source-'+uuid(),name:'SYNTHETIC prior prices' }, price:4275 };
  return { name:'SYNTHETIC prior retail',studioName:'SYNTHETIC studio',currency:'CAD',source:{ profileId:sourceSnapshot.profile.id,profileName:sourceSnapshot.profile.name,contentHash:privateValidation.inHouseSourceHash(sourceSnapshot) },entries:[{ id:'SYNTHETIC-package',sourceKey:'packages.synthetic-package',section:'package',name:'SYNTHETIC original package',retailCents:4275,active:true,category:'package',contents:[{ name:'8x10 Lustre',qty:1 },{ name:'5x7 Lustre',qty:2 }],original:{ synthetic:true } }],warnings:[],tax:{ enabled:false,percent:0,label:'SYNTHETIC' },sourceSnapshot };
}
async function registerSource(db, actor = LAB_FIXTURE.owner) {
  const id = uuid(), owner = actor === LAB_FIXTURE.otherOwner ? LAB_FIXTURE.otherPhotographer : LAB_FIXTURE.photographer;
  return rpc(db,'register_lab_production_asset',{ p_user_id:actor,p_document:{ ...source({ id,filename:'SYNTHETIC-'+hash(id).slice(0,12)+'.jpg' }),jobId:null,size:null,sourceAssetId:null,storageKey:owner+'/'+id+'.jpg' } });
}
async function productionFixture(db) {
  const imported = await rpc(db,'save_in_house_price_sheet',{ p_user_id:LAB_FIXTURE.owner,p_action:'import',p_id:uuid(),p_expected_version:0,p_document:privateSheet() });
  const sources = await Promise.all([0,1,2,3].map(() => registerSource(db))), accessToken = token();
  const gallery = await rpc(db,'create_lab_production_gallery',{ p_user_id:LAB_FIXTURE.owner,p_request_id:uuid(),p_payload:{ sheetId:imported.id,expectedSheetVersion:imported.version,entryId:'SYNTHETIC-package',name:'SYNTHETIC existing gallery',assetIds:sources.slice(0,3).map(a => a.id),tokenHash:hash(accessToken),target:{ kind:'partner_lab',labId:LAB_FIXTURE.lab,product8x10Id:LAB_FIXTURE.productB,product5x7Id:LAB_FIXTURE.productA } } });
  const selections = Object.fromEntries(['8x10','5x7-a','5x7-b'].map((id,i) => [id,gallery.document.photos[i].id]));
  const submitted = await rpc(db,'submit_lab_production_v2_order',{ p_gallery_id:gallery.id,p_token_hash:hash(accessToken),p_request_id:uuid(),p_receipt_hash:hash(token()),p_selections:selections,p_quantity:2 });
  return { imported,sources,gallery,accessToken,jobId:submitted.id };
}
async function seedPreserved(db) {
  await seedLegacyLabCanaries(db);
  await rpc(db,'save_lab_price_sheet',{ p_user_id:LAB_FIXTURE.owner,p_id:uuid(),p_expected_version:0,p_action:'create',p_document:{ name:'SYNTHETIC prior lab sheet',labId:LAB_FIXTURE.lab,currency:'CAD',pricing:{ markupPercent:100,rounding:'none' },items:[{ catalogProductId:LAB_FIXTURE.productA,retailCents:1234,enabled:true }],packages:[],shipping:{ mode:'pickup',feeCents:0,title:'Pickup' },terms:'SYNTHETIC',assignments:[] } });
  const legacyAsset = uuid(); await db.query("insert into lab_order_assets(id,photographer_id,lab_id,filename,storage_key,sha256,width_pixels,height_pixels,content_type,byte_size,ready)values($1,$2,$3,'SYNTHETIC old.jpg',$4,$5,600,400,'image/jpeg',100,true)",[legacyAsset,LAB_FIXTURE.photographer,LAB_FIXTURE.lab,'synthetic/'+legacyAsset+'.jpg','b'.repeat(64)]);
  await rpc(db,'submit_lab_order',{ p_actor_user_id:LAB_FIXTURE.owner,p_request_id:uuid(),p_payload:{ labId:LAB_FIXTURE.lab,reference:'SYNTHETIC prior order',notes:'',delivery:{ mode:'pickup',name:'SYNTHETIC',address:'' },items:[{ catalogProductId:LAB_FIXTURE.orderProduct,assetId:legacyAsset,quantity:1 }] } });
  await rpc(db,'save_lab_production_policy',{ p_user_id:LAB_FIXTURE.owner,p_expected_version:1,p_policy:{ autoApprove:false,cropResponsibility:'photographer',labColourCorrection:false } });
  const fixture = await productionFixture(db), legacyToken = token();
  const legacyGallery = await rpc(db,'create_in_house_test_gallery',{ p_user_id:LAB_FIXTURE.owner,p_request_id:uuid(),p_sheet_id:fixture.imported.id,p_expected_sheet_version:fixture.imported.version,p_entry_id:'SYNTHETIC-package',p_name:'SYNTHETIC prior rehearsal',p_token_hash:hash(legacyToken),p_assets:[{ id:'sample-8x10',filename:'SYNTHETIC-8x10.jpg',widthInches:8,heightInches:10,widthPixels:2400,heightPixels:3000,sha256:'a'.repeat(64),byteSize:100,quantity:1 },{ id:'sample-5x7',filename:'SYNTHETIC-5x7.jpg',widthInches:5,heightInches:7,widthPixels:1500,heightPixels:2100,sha256:'b'.repeat(64),byteSize:100,quantity:2 }] });
  await rpc(db,'submit_in_house_test_order',{ p_gallery_id:legacyGallery.id,p_token_hash:hash(legacyToken),p_request_id:uuid(),p_receipt_hash:hash(token()),p_offer_id:legacyGallery.document.offer.id,p_photo_id:'studio-os-inhouse-demo-v1',p_quantity:1 });
  await rpc(db,'submit_lab_production_order',{ p_gallery_id:fixture.gallery.id,p_token_hash:hash(fixture.accessToken),p_request_id:uuid(),p_receipt_hash:hash(token()),p_photo_id:fixture.gallery.document.photos[0].id,p_quantity:1 });
  const currentJob = async () => (await db.query('select * from lab_production_v2_jobs where id=$1',[fixture.jobId])).rows[0];
  const act = async (action,details = {},actor = LAB_FIXTURE.labOperator) => rpc(db,'act_lab_production_v2_job',{ p_user_id:actor,p_job_id:fixture.jobId,p_expected_version:(await currentJob()).version,p_request_id:uuid(),p_action:action,p_details:details });
  await act('accept'); await act('approve_order',{},LAB_FIXTURE.owner);
  for (const [index,slotId] of ['8x10','5x7-a','5x7-b'].entries()) {
    const id = uuid(), isLarge = slotId === '8x10';
    await rpc(db,'save_lab_production_v2_crop',{ p_user_id:LAB_FIXTURE.owner,p_job_id:fixture.jobId,p_expected_version:(await currentJob()).version,p_request_id:uuid(),p_slot_id:slotId,p_crop:{ x:0,y:0,width:isLarge?2400:2000,height:isLarge?3000:2800,rotation:0 },p_asset_document:{ id,kind:'crop',jobId:fixture.jobId,slotId,sourceAssetId:fixture.sources[index].id,filename:'SYNTHETIC-'+slotId+'.jpg',storageKey:LAB_FIXTURE.photographer+'/'+id+'.jpg',sha256:hash(id),byteSize:1234,widthPixels:isLarge?2400:1500,heightPixels:isLarge?3000:2100,contentType:'image/jpeg' } });
    await act('approve_crop',{ slotId,assetId:id },LAB_FIXTURE.owner); await act('final_review',{ slotId,assetId:id });
  }
  await act('transition',{ status:'in_production' });
  const codeHash = hash(token()), deviceId = uuid();
  await rpc(db,'create_lab_connector_pair',{ p_user_id:LAB_FIXTURE.labOperator,p_kind:'partner_lab',p_target:LAB_FIXTURE.lab,p_name:'SYNTHETIC prior connector',p_code_hash:codeHash });
  await rpc(db,'pair_lab_connector',{ p_code_hash:codeHash,p_device_id:deviceId,p_token_hash:hash(token()) });
  const current = await currentJob(), dispatchId = uuid(), manifest = { schemaVersion:2,dispatchId,jobId:current.id,reference:current.reference,version:current.version,testOnly:true,printAllowed:false,payment:'test_no_payment',outputProfile:'sRGB',densityPpi:300,quantity:2,finishedPrints:6,paperSheets:4,sheets:[{ size:'8x10',filename:current.reference+'-8x10.jpg',widthPixels:2400,heightPixels:3000,copies:2,printsPerSheet:1,slots:['8x10'],sha256:'a'.repeat(64),byteSize:100 },{ size:'10x7',filename:current.reference+'-10x7.jpg',widthPixels:3000,heightPixels:2100,copies:2,printsPerSheet:2,slots:['5x7-a','5x7-b'],sha256:'b'.repeat(64),byteSize:100 }] };
  await rpc(db,'queue_lab_connector_dispatch',{ p_user_id:LAB_FIXTURE.labOperator,p_job_id:current.id,p_expected_version:current.version,p_request_id:uuid(),p_dispatch_id:dispatchId,p_manifest:manifest,p_manifest_sha256:hash(JSON.stringify(manifest)) });
  return fixture;
}
async function draft(db,id) { return (await db.query('select * from lab_sheet_layout_drafts where id=$1',[id])).rows[0]; }
async function saveDraft(db, options = {}) {
  const values = { actor:LAB_FIXTURE.owner,audience:'studio',draftId:uuid(),requestId:uuid(),expectedVersion:0,jobId:null,name:'SYNTHETIC paper draft',document:document(),...options };
  const args = { p_user_id:values.actor,p_audience:values.audience,p_draft_id:values.draftId,p_request_id:values.requestId,p_expected_version:values.expectedVersion,p_job_id:values.jobId,p_name:values.name,p_document:values.document };
  const result = await rpc(db,'save_lab_sheet_layout_draft',args);
  return { ...values,args,result,row:await draft(db,values.draftId) };
}
async function exportDocument(db, saved, options = {}) {
  const current = await draft(db,saved.draftId), id = uuid(), geometry = layouts.sheetGeometry(current.document), filename = 'TEST-sheet-'+current.id+'-v'+current.version+'.jpg', sha256 = hash(id), byteSize = 12345;
  const cells = [];
  for (const { label,...cell } of geometry.cells) {
    assert.equal(typeof label,'string');
    const input = current.document.cells.find(c => c.id === cell.id), source = (await db.query('select * from lab_production_assets where id=$1',[input.assetId])).rows[0];
    cells.push({ ...cell,assetId:input.assetId,sourceSha256:source?.sha256,crop:input.crop });
  }
  const value = { id,filename,storageKey:saved.actor+'/'+id+'.jpg',sha256,byteSize,widthPixels:geometry.widthPixels,heightPixels:geometry.heightPixels,document:current.document,manifest:{ version:1,testOnly:true,printAllowed:false,draftId:current.id,draftVersion:current.version,paper:{ id:current.document.paperId,orientation:current.document.orientation,...Object.fromEntries(Object.entries(geometry).filter(([key]) => key !== 'cells')) },templateId:current.document.templateId,copies:current.document.copies,dpi:300,cells,file:{ filename,sha256,byteSize,contentType:'image/jpeg' },notice:'TEST sheet only. No order, payment, printer or dispatch was changed.' },...options };
  return value;
}
async function registerExport(db,saved,value,patch = {}) {
  const args = { p_user_id:saved.actor,p_audience:saved.audience,p_draft_id:saved.draftId,p_request_id:uuid(),p_expected_version:saved.row.version,p_export:value,...patch };
  return { args,result:await rpc(db,'register_lab_sheet_layout_export',args) };
}
async function reviewExport(db,saved,id,sha256,patch = {}) { return rpc(db,'review_lab_sheet_layout_export',{ p_user_id:saved.actor,p_audience:saved.audience,p_draft_id:saved.draftId,p_render_id:id,p_expected_version:saved.row.version,p_sha256:sha256,...patch }); }
function filledDocument(sources, patch = {}) { return document({ cells:sources.slice(0,2).map((source,index) => ({ id:index?'b':'a',assetId:source.id,crop:{ x:100*index,y:100,width:2000,height:2800,rotation:0 } })),...patch }); }

test('additive sheet schema preserves all populated schools, prices, legacy production and connector ledgers', async () => {
  let before;
  const db = await createLabDatabase({ beforeSheetLayoutsMigration:async database => { await seedPreserved(database); before = await snapshots(database); } });
  try {
    assert(before); assert(Object.values(JSON.parse(before)).every(rows => rows.length > 0), 'All twenty-six previous tables contain preservation canaries');
    assert.equal(await snapshots(db),before);
    for (const table of ['lab_sheet_layout_drafts','lab_sheet_layout_exports']) assert.equal((await db.query('select count(*)::int as n from '+table)).rows[0].n,0);
    const bucket = (await db.query("select public,file_size_limit from storage.buckets where id='lab-sheet-layout-files'")).rows[0]; assert.equal(bucket.public,false); assert.equal(Number(bucket.file_size_limit),4000000);
  } finally { await db.close(); }
});

test('database geometry independently agrees with all sixty paper and fixed-template fit combinations', async () => {
  const db = await createLabDatabase();
  try {
    for (const paperId of Object.keys(PAPER_DIMENSIONS)) for (const orientation of [0,90]) for (const templateId of Object.keys(FINISHED_LAYOUTS)) {
      const value = document({ paperId,orientation,templateId }); let expected;
      try { expected = layouts.sheetGeometry(value); } catch { await assert.rejects(() => db.query('select lab_sheet_layout_geometry($1::jsonb)',[JSON.stringify(value)]),/DOES_NOT_FIT/); continue; }
      const actual = (await db.query('select lab_sheet_layout_geometry($1::jsonb) as g',[JSON.stringify(value)])).rows[0].g;
      assert.deepEqual(actual,{ ...expected,cells:expected.cells.map(({ label,...cell }) => { assert.equal(typeof label,'string'); return cell; }) });
    }
  } finally { await db.close(); }
});

test('private draft save/reload uses CAS and exact request replays, retaining previous rows and prices', async () => {
  const db = await createLabDatabase();
  try {
    const fixture = await productionFixture(db),before = await snapshots(db), saved = await saveDraft(db,{ document:filledDocument(fixture.sources) });
    assert.equal(saved.row.version,1); assert.deepEqual(saved.row.document,saved.document);
    assert.equal((await rpc(db,'save_lab_sheet_layout_draft',saved.args)).replayed,true);
    for (const patch of [{ p_name:'Changed synthetic name' },{ p_document:{ ...saved.document,copies:3 } }]) await assert.rejects(() => rpc(db,'save_lab_sheet_layout_draft',{ ...saved.args,...patch }),/REQUEST_CONFLICT/);
    await assert.rejects(() => saveDraft(db,{ ...saved,requestId:uuid(),expectedVersion:0,name:'SYNTHETIC stale' }),/VERSION_CONFLICT/);
    const updated = await saveDraft(db,{ ...saved,requestId:uuid(),expectedVersion:1,name:'SYNTHETIC changed draft',document:{ ...saved.document,paperId:'8x10' } });
    assert.equal(updated.row.version,2); assert.equal(updated.row.document.paperId,'8x10'); assert.equal(updated.row.current_export_id,null); assert.equal(await snapshots(db),before);
    const gta = (await db.query("select intake_enabled,catalog_verified from studio_labs where slug='gta-imaging'")).rows[0]; assert.deepEqual(gta,{ intake_enabled:false,catalog_verified:false });
  } finally { await db.close(); }
});

test('render review binds the exact draft revision and any saved edit invalidates the current proof without changing history', async () => {
  const db = await createLabDatabase();
  try {
    const sources = await Promise.all([registerSource(db),registerSource(db)]), saved = await saveDraft(db,{ document:filledDocument(sources) }),value = await exportDocument(db,saved),registered = await registerExport(db,saved,value);
    assert.equal((await rpc(db,'register_lab_sheet_layout_export',registered.args)).replayed,true); assert.equal((await draft(db,saved.draftId)).current_export_id,value.id);
    for (const patch of [{ sha256:'f'.repeat(64) },{ filename:'OTHER.jpg' },{ widthPixels:value.widthPixels+1 },{ manifest:{ ...value.manifest,copies:9 } }]) await assert.rejects(() => rpc(db,'register_lab_sheet_layout_export',{ ...registered.args,p_export:{ ...value,...patch } }),/REQUEST_CONFLICT/);
    await assert.rejects(() => reviewExport(db,saved,value.id,'f'.repeat(64)),/VERSION_CONFLICT/); const reviewed = await reviewExport(db,saved,value.id,value.sha256); assert.equal(reviewed.replayed,false); assert.equal((await reviewExport(db,saved,value.id,value.sha256)).replayed,true);
    const historical = (await db.query('select * from lab_sheet_layout_exports where id=$1',[value.id])).rows[0]; assert(historical.reviewed_at);
    await assert.rejects(() => db.query("update lab_sheet_layout_exports set sha256=$1 where id=$2",['b'.repeat(64),value.id]),/SHEET_IMMUTABLE/); await assert.rejects(() => db.query('delete from lab_sheet_layout_exports where id=$1',[value.id]),/SHEET_IMMUTABLE/);
    for (const change of [doc => ({ ...doc,copies:doc.copies+1 }),doc => ({ ...doc,paperId:'8x10' }),doc => ({ ...doc,cells:doc.cells.map((cell,index) => index?cell:{ ...cell,crop:{ ...cell.crop,x:cell.crop.x+10 } }) }),doc => ({ ...doc,cells:doc.cells.map((cell,index) => index?cell:{ ...cell,assetId:sources[1].id }) })]) {
      const current = await draft(db,saved.draftId); await saveDraft(db,{ ...saved,expectedVersion:current.version,requestId:uuid(),document:change(current.document) }); assert.equal((await draft(db,saved.draftId)).current_export_id,null); await assert.rejects(() => reviewExport(db,saved,value.id,value.sha256),/VERSION_CONFLICT/); assert.deepEqual((await db.query('select * from lab_sheet_layout_exports where id=$1',[value.id])).rows[0],historical);
    }
  } finally { await db.close(); }
});

test('sheet source access is creator private, requires a receiving job for labs and rejects unrelated originals', async () => {
  const db = await createLabDatabase();
  try {
    const fixture = await productionFixture(db), foreign = await registerSource(db,LAB_FIXTURE.otherOwner), before = await snapshots(db);
    const saved = await saveDraft(db,{ actor:LAB_FIXTURE.labOperator,audience:'lab',jobId:fixture.jobId,document:filledDocument(fixture.sources) });
    const value = await exportDocument(db,saved); await registerExport(db,saved,value);
    for (const options of [
      { actor:LAB_FIXTURE.labOperator,audience:'lab',jobId:null },
      { actor:LAB_FIXTURE.labViewer,audience:'lab',jobId:fixture.jobId },
      { actor:LAB_FIXTURE.foreignLabOwner,audience:'lab',jobId:fixture.jobId },
      { actor:LAB_FIXTURE.otherOwner,audience:'studio',jobId:fixture.jobId },
      { actor:LAB_FIXTURE.labOperator,audience:'studio',jobId:fixture.jobId },
      { actor:LAB_FIXTURE.labOperator,audience:'lab',jobId:fixture.jobId,document:filledDocument([fixture.sources[3],fixture.sources[1]]) },
      { actor:LAB_FIXTURE.owner,audience:'studio',jobId:fixture.jobId,document:filledDocument([fixture.sources[3],fixture.sources[1]]) },
      { actor:LAB_FIXTURE.owner,audience:'studio',document:filledDocument([foreign,fixture.sources[1]]) },
    ]) await assert.rejects(() => saveDraft(db,options), /SHEET_FORBIDDEN/);
    for (const [actor,aal,count] of [[LAB_FIXTURE.labOperator,'aal2',1],[LAB_FIXTURE.labOperator,'aal1',0],[LAB_FIXTURE.labOwner,'aal2',0],[LAB_FIXTURE.owner,'aal2',0],[LAB_FIXTURE.foreignLabOwner,'aal2',0]]) {
      for (const table of ['lab_sheet_layout_drafts','lab_sheet_layout_exports']) assert.equal(await asRole(db,'authenticated',actor,async tx => (await tx.query('select count(*)::int as n from '+table)).rows[0].n,aal),count,table+'/'+actor+'/'+aal);
    }
    for (const actor of [LAB_FIXTURE.labOwner,LAB_FIXTURE.owner,LAB_FIXTURE.foreignLabOwner]) {
      await assert.rejects(() => reviewExport(db,saved,value.id,value.sha256,{ p_user_id:actor }), /SHEET_FORBIDDEN/);
      await assert.rejects(() => saveDraft(db,{ ...saved,actor,requestId:uuid(),expectedVersion:1 }), /SHEET_FORBIDDEN/);
    }
    const personal = await saveDraft(db,{ document:filledDocument([fixture.sources[3],fixture.sources[1]]) });
    assert.equal(await asRole(db,'authenticated',LAB_FIXTURE.owner,async tx => (await tx.query('select count(*)::int as n from lab_sheet_layout_drafts')).rows[0].n,'aal1'),1,'Photographer personal originals remain available without a lab job');
    assert.equal(personal.row.photographer_id,LAB_FIXTURE.photographer);
    for (const role of ['authenticated','anon']) {
      await assert.rejects(() => asRole(db,role,LAB_FIXTURE.owner,tx => tx.query('select save_lab_sheet_layout_draft(null,null,null,null,null,null,null,null)')),/permission denied/);
      await assert.rejects(() => asRole(db,role,LAB_FIXTURE.owner,tx => tx.query('select register_lab_sheet_layout_export(null,null,null,null,null,null)')),/permission denied/);
      await assert.rejects(() => asRole(db,role,LAB_FIXTURE.owner,tx => tx.query('select review_lab_sheet_layout_export(null,null,null,null,null,null)')),/permission denied/);
      for (const table of ['lab_sheet_layout_drafts','lab_sheet_layout_exports']) await assert.rejects(() => asRole(db,role,LAB_FIXTURE.owner,tx => tx.query('update '+table+' set created_at=now()')),/permission denied/);
    }
    await assert.rejects(() => asRole(db,'anon',null,tx => tx.query('select * from lab_sheet_layout_drafts')),/permission denied/);
    assert.equal(await snapshots(db),before,'Private drafts and reviews leave all existing owner, lab, price and order records unchanged');
  } finally { await db.close(); }
});

test('SQL rejects malformed documents and forged export metadata before any saved revision changes', async () => {
  const db = await createLabDatabase();
  try {
    const sources = await Promise.all([registerSource(db),registerSource(db)]), saved = await saveDraft(db,{ document:filledDocument(sources) }), before = await snapshots(db,['lab_sheet_layout_drafts','lab_sheet_layout_exports']);
    for (const bad of [null,1,'"bad"',[],{ ...saved.document,cells:null },{ ...saved.document,cells:4 },{ ...saved.document,cells:{} },{ ...saved.document,copies:1.5 },{ ...saved.document,cells:[{ ...saved.document.cells[0],crop:{ ...saved.document.cells[0].crop,x:0.5 } },saved.document.cells[1]] }]) await assert.rejects(() => saveDraft(db,{ document:bad }),/SHEET_INVALID/);
    const value = await exportDocument(db,saved), changes = [
      e => { e.printAllowed=true; }, e => { e.id=null; }, e => { e.sha256=Number('1'.repeat(64)); }, e => { e.byteSize=4000001; }, e => { e.widthPixels--; }, e => { e.storageKey=LAB_FIXTURE.otherOwner+'/'+e.id+'.jpg'; }, e => { e.filename='../escape.jpg'; },
      e => { e.manifest=null; }, e => { e.manifest.cells=null; }, e => { e.manifest.cells=1; }, e => { e.manifest.cells={}; }, e => { e.manifest.printAllowed=true; }, e => { e.manifest.printAllowed='false'; }, e => { e.manifest.testOnly=false; }, e => { e.manifest.dpi=72; }, e => { e.manifest.paper.widthInches=9; }, e => { e.manifest.file.sha256='b'.repeat(64); }, e => { e.manifest.cells[0].sourceSha256='f'.repeat(64); }, e => { e.manifest.cells[0].assetId=sources[1].id; }, e => { e.manifest.cells[0].crop.x++; }, e => { e.manifest.cells[0].label='not in manifest'; }, e => { e.manifest.cells.reverse(); },
    ];
    for (const change of changes) { const altered = JSON.parse(JSON.stringify(value)); change(altered); await assert.rejects(() => registerExport(db,saved,altered),/SHEET_INVALID/); }
    for (const key of ['p_user_id','p_audience','p_request_id','p_expected_version','p_export']) await assert.rejects(() => registerExport(db,saved,value,{ [key]:null }),/SHEET_INVALID/);
    assert.equal(await snapshots(db,['lab_sheet_layout_drafts','lab_sheet_layout_exports']),before,'Rejected shapes and manifest claims cannot modify a draft or create a render');
    const incomplete = await saveDraft(db), missing = await exportDocument(db,incomplete);
    await assert.rejects(() => registerExport(db,incomplete,missing),/SHEET_INVALID_INCOMPLETE/);
    const registered = await registerExport(db,saved,value); assert.equal(registered.result.id,value.id);
  } finally { await db.close(); }
});

test('a later job photo change removes the old lab source from future sheet saves and review', async () => {
  const db = await createLabDatabase();
  try {
    const fixture = await productionFixture(db), saved = await saveDraft(db,{ actor:LAB_FIXTURE.labOperator,audience:'lab',jobId:fixture.jobId,document:filledDocument(fixture.sources) }), value = await exportDocument(db,saved); await registerExport(db,saved,value);
    const current = (await db.query('select * from lab_production_v2_jobs where id=$1',[fixture.jobId])).rows[0];
    await rpc(db,'act_lab_production_v2_job',{ p_user_id:LAB_FIXTURE.owner,p_job_id:fixture.jobId,p_expected_version:current.version,p_request_id:uuid(),p_action:'set_slot_source',p_details:{ slotId:'8x10',photoId:fixture.gallery.document.photos[2].id } });
    await assert.rejects(() => reviewExport(db,saved,value.id,value.sha256),/SHEET_FORBIDDEN/);
    await assert.rejects(() => saveDraft(db,{ ...saved,expectedVersion:1,requestId:uuid() }),/SHEET_FORBIDDEN/);
    const stale = await exportDocument(db,saved); await assert.rejects(() => registerExport(db,saved,stale),/SHEET_FORBIDDEN/);
    const retained = await draft(db,saved.draftId); assert.equal(retained.version,1); assert.equal(retained.current_export_id,value.id);
  } finally { await db.close(); }
});

const productionRenderer = load('lib/labs/production-renderer.ts', { 'node:crypto':crypto,sharp,'./validation':labValidation });
const sheetServer = load('lib/labs/sheet-layout-server.ts', {
  'node:crypto':crypto,'node:util':util,sharp,zod:{ z },'@/lib/rate-limit':{},'./production-server':{},'./production-v2-server':{},'./production-v2-image-server':{},'./production-renderer':productionRenderer,'./production-image-server':{},'./validation':labValidation,'./sheet-layouts':layouts,
});
async function actualSource(bytes, patch = {}) {
  const metadata = await productionRenderer.inspectProductionImage(bytes); return { asset:source({ ...metadata,...patch }),bytes };
}
async function pixel(bytes,x,y) { return [...await sharp(bytes).extract({ left:x,top:y,width:1,height:1 }).removeAlpha().raw().toBuffer()]; }
function dominant(rgb,channel,message) { assert(rgb[channel]>180 && rgb[channel]>Math.max(...rgb.filter((_,i) => i!==channel))*3,message+' '+JSON.stringify(rgb)); }

test('real server JPEG rendering binds crops by cell ID and preserves exact print sizes with centered white margins', async () => {
  const bytes = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="4200"><path fill="#df1111" d="M0 0h1000v4200H0z"/><path fill="#11df11" d="M1000 0h1000v4200H1000z"/><path fill="#1111df" d="M2000 0h1000v4200H2000z"/></svg>')).jpeg({ quality:95 }).toBuffer(), loaded = await actualSource(bytes), before = hash(bytes);
  const cells = [{ id:'b',assetId:loaded.asset.id,crop:{ x:2000,y:200,width:1000,height:1400,rotation:0 } },{ id:'a',assetId:loaded.asset.id,crop:{ x:0,y:100,width:1000,height:1400,rotation:0 } }];
  const rendered = await sheetServer.renderSheetBytes(document({ paperId:'8x10',copies:4,cells }),new Map([[loaded.asset.id,loaded]])), metadata = await sharp(rendered.bytes).metadata();
  assert.deepEqual([metadata.width,metadata.height,metadata.density,metadata.format],[3000,2400,300,'jpeg']); assert.equal(metadata.hasProfile,true); assert.equal(metadata.exif,undefined); assert.equal(metadata.orientation,undefined); assert(rendered.bytes.length<=4000000);
  dominant(await pixel(rendered.bytes,750,1000),0,'The a crop stays on the left even when browser cells are reversed'); dominant(await pixel(rendered.bytes,2250,1000),2,'The b crop stays on the right');
  for (const y of [0,149,2250,2399]) assert((await pixel(rendered.bytes,750,y)).every(c => c>=250),'Unfilled paper is white rather than a stretched print');
  assert.deepEqual(rendered.manifestCells.map(c => [c.id,c.xInches,c.yInches,c.widthInches,c.heightInches,c.assetId,c.crop.x]),[['a',0,.5,5,7,loaded.asset.id,0],['b',5,.5,5,7,loaded.asset.id,2000]]); assert(rendered.manifestCells.every(c => !('label' in c) && c.sourceSha256===before));
  assert.equal(hash(bytes),before,'Rendering does not edit the original file'); assert.deepEqual(cells.map(c => c.id),['b','a']);
});

test('real four-wallet output gives every independent cell its selected portrait at 300ppi', async () => {
  const colors=['#e01010','#10d010','#1010e0','#d0d010'], inputs = await Promise.all(colors.map(async color => actualSource(await sharp({ create:{ width:1000,height:1400,channels:3,background:color } }).jpeg({ quality:95 }).toBuffer())));
  const doc = document({ paperId:'5x7',orientation:0,templateId:'four-wallets',copies:1,cells:inputs.map((input,i) => ({ id:String.fromCharCode(97+i),assetId:input.asset.id,crop:{ x:0,y:0,width:1000,height:1400,rotation:0 } })) });
  const rendered = await sheetServer.renderSheetBytes(doc,new Map(inputs.map(input => [input.asset.id,input]))), m = await sharp(rendered.bytes).metadata(); assert.deepEqual([m.width,m.height,m.density],[1500,2100,300]);
  dominant(await pixel(rendered.bytes,375,525),0,'Wallet a red'); dominant(await pixel(rendered.bytes,1125,525),1,'Wallet b green'); dominant(await pixel(rendered.bytes,375,1575),2,'Wallet c blue'); const yellow=await pixel(rendered.bytes,1125,1575); assert(yellow[0]>180 && yellow[1]>180 && yellow[2]<50,'Wallet d yellow');
  assert.deepEqual(rendered.manifestCells.map(c => [c.widthInches,c.heightInches,c.assetId]),inputs.map(input => [2.5,3.5,input.asset.id]));
});

test('rendering uses upright EXIF coordinates and rejects missing, undersized, altered or mismatched originals', async () => {
  const bytes = await sharp({ create:{ width:2000,height:1400,channels:3,background:'#e01010' } }).withMetadata({ orientation:6 }).jpeg({ quality:90 }).toBuffer(), loaded = await actualSource(bytes), doc = document({ paperId:'5x7',orientation:0,templateId:'single-5x7',cells:[{ id:'a',assetId:loaded.asset.id,crop:{ x:0,y:20,width:1400,height:1960,rotation:0 } }] }), inputs = new Map([[loaded.asset.id,loaded]]);
  assert.deepEqual([loaded.asset.widthPixels,loaded.asset.heightPixels],[1400,2000]); const rendered = await sheetServer.renderSheetBytes(doc,inputs), m = await sharp(rendered.bytes).metadata(); assert.deepEqual([m.width,m.height,m.density],[1500,2100,300]); assert.equal(m.exif,undefined);
  await assert.rejects(() => sheetServer.renderSheetBytes(doc,new Map()),e => e.code==='SHEET_INVALID_INCOMPLETE');
  for (const patch of [{ sha256:'f'.repeat(64) },{ byteSize:loaded.asset.byteSize+1 },{ widthPixels:2000,heightPixels:1400 }]) await assert.rejects(() => sheetServer.renderSheetBytes(doc,new Map([[loaded.asset.id,{ ...loaded,asset:{ ...loaded.asset,...patch } }]])),e => e.code==='SHEET_INTEGRITY'||e.code==='SHEET_INVALID');
  const small = { ...doc,cells:[{ ...doc.cells[0],crop:{ x:0,y:0,width:500,height:700,rotation:0 } }] }; await assert.rejects(() => sheetServer.renderSheetBytes(small,inputs),e => e.code==='SHEET_INVALID');
  assert.throws(() => sheetServer.parsePrivateSheetAction({ ...saveAction(),retailCents:1 }),e => e.status===400 && e.code==='SHEET_INVALID');
});

const httpOrigin = process.env.LAB_SHEETS_HTTP_ORIGIN;
test('actual Next private sheet routes save, render, review and download independent lab sheets without changing any existing ledger', { skip:!httpOrigin }, async () => {
  const fixtureOrigin = process.env.LAB_SYSTEM_FIXTURE_URL; assert.match(httpOrigin,/^http:\/\/(localhost|127\.0\.0\.1):\d+$/); assert.match(fixtureOrigin,/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  let requests=0; const ownerPath='/api/dashboard/lab-sheets',labPath='/api/lab/sheets';
  const call = async (path,body,actor=LAB_FIXTURE.owner) => {
    requests++; const multipart=body instanceof FormData;
    const response=await fetch(new URL(path,httpOrigin),{ method:body===undefined?'GET':'POST',headers:{ Origin:new URL(httpOrigin).origin,...(actor?{ Authorization:'Bearer '+fixtureToken(actor) }:{}),...(body!==undefined&&!multipart?{ 'Content-Type':'application/json' }:{}) },body:body===undefined?undefined:multipart?body:JSON.stringify(body),signal:AbortSignal.timeout(45000) });
    if (/lab-sheets|\/lab\/sheets/.test(path)) { assert.match(response.headers.get('cache-control')||'',/private.*no-store/); assert.equal(response.headers.get('referrer-policy'),'no-referrer'); assert.match(response.headers.get('x-robots-tag')||'',/noindex/); }
    const bytes=Buffer.from(await response.arrayBuffer()); return { status:response.status,bytes,body:(response.headers.get('content-type')||'').includes('application/json')?JSON.parse(bytes):null };
  };
  const ok=result => { assert.equal(result.status,200,JSON.stringify(result.body)); return result.body; };
  const rest=async table => { const response=await fetch(fixtureOrigin+'/rest/v1/'+table+'?select=*',{ headers:{ Authorization:'Bearer '+fixtureToken(null,'service_role') },signal:AbortSignal.timeout(15000) }); assert.equal(response.status,200); return (await response.json()).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))); };
  const existing=async () => { const result={}; for (const table of OLD_TABLES) result[table]=await rest(table); return JSON.stringify(result); };
  assert.equal((await call(ownerPath,undefined,null)).status,401); assert.equal((await call(labPath,undefined,LAB_FIXTURE.owner)).status,401);
  const assets=[];
  for (const [i,color] of ['#df1111','#1111df','#11df11'].entries()) { const bytes=await sharp({ create:{ width:3000,height:4200,channels:3,background:color } }).jpeg({ quality:90 }).toBuffer(),form=new FormData(); form.append('file',new Blob([bytes],{ type:'image/jpeg' }),'SYNTHETIC-sheet-source-'+i+'.jpg'); form.append('kind','original'); assets.push(ok(await call('/api/dashboard/lab-production-assets',form)).asset); }
  const imported=ok(await call('/api/dashboard/in-house-price-sheets',{ action:'import',sheet:privateSheet() })).sheet, accessToken=token();
  const created=ok(await call('/api/dashboard/lab-production-v2',{ action:'create_gallery',requestId:uuid(),sheetId:imported.id,expectedSheetVersion:imported.version,entryId:'SYNTHETIC-package',name:'SYNTHETIC sheet scope',assetIds:assets.map(a=>a.id),accessToken,target:{ kind:'partner_lab',labId:LAB_FIXTURE.lab,product8x10Id:LAB_FIXTURE.productB,product5x7Id:LAB_FIXTURE.productA } }));
  const publicGallery=ok(await call('/api/labs-pilot/production-v2',{ action:'gallery',galleryId:created.gallery.id,accessToken },null)).gallery, selections=Object.fromEntries(['8x10','5x7-a','5x7-b'].map((id,i)=>[id,publicGallery.photos[i].id]));
  const job=ok(await call('/api/labs-pilot/production-v2',{ action:'submit',galleryId:publicGallery.id,accessToken,requestId:uuid(),receiptToken:token(),selections,quantity:1 },null)).receipt;
  const before=await existing(); assert.equal(ok(await call(labPath,undefined,LAB_FIXTURE.labOperator)).workspace.canCreate,false);
  const initial=saveAction(document(),{ jobId:job.id }),saved=ok(await call(ownerPath,initial)).draft; assert.equal(saved.version,1);
  let reload=ok(await call(ownerPath+'?draftId='+saved.id)).workspace; assert.deepEqual(reload.drafts.find(d=>d.id===saved.id).document,initial.document); assert.equal(reload.sources.length,3);
  assert.equal((await call(ownerPath,{ action:'render',draftId:saved.id,expectedVersion:1,requestId:uuid() })).status,400);
  const filled={ ...initial,requestId:uuid(),expectedVersion:1,document:document({ cells:[{ id:'b',assetId:assets[1].id,crop:{ x:0,y:0,width:2000,height:2800,rotation:0 } },{ id:'a',assetId:assets[0].id,crop:{ x:200,y:100,width:2000,height:2800,rotation:0 } }] }) },complete=ok(await call(ownerPath,filled)).draft;
  const renderAction={ action:'render',draftId:saved.id,expectedVersion:complete.version,requestId:uuid() },rendered=ok(await call(ownerPath,renderAction)).draft; assert(rendered.render); assert.equal(rendered.render.reviewedAt,null); assert.equal(ok(await call(ownerPath,renderAction)).replayed,true);
  const file=(kind,draft=rendered,path=ownerPath,actor=LAB_FIXTURE.owner) => call(path+'?'+new URLSearchParams({ file:kind,draftId:draft.id,renderId:draft.render.id }),undefined,actor);
  assert.equal((await file('proof')).status,200); assert.equal((await file('jpeg')).status,409); assert.equal((await file('manifest')).status,409);
  const review={ action:'review',draftId:rendered.id,renderId:rendered.render.id,expectedVersion:rendered.version,sha256:rendered.render.sha256 };
  assert.equal((await call(ownerPath,{ ...review,sha256:'f'.repeat(64) })).status,409); const reviewed=ok(await call(ownerPath,review)).draft; assert(reviewed.render.reviewedAt); assert.equal(ok(await call(ownerPath,review)).replayed,true);
  const manifest=ok(await file('manifest')),jpeg=await file('jpeg'); assert.equal(jpeg.status,200); assert.equal(hash(jpeg.bytes),manifest.file.sha256); assert.equal(jpeg.bytes.length,manifest.file.byteSize); assert.equal(manifest.printAllowed,false); assert.equal(manifest.testOnly,true); assert.equal(manifest.copies,2); assert.deepEqual(manifest.cells.map(c=>c.id),['a','b']); const meta=await sharp(jpeg.bytes).metadata(); assert.deepEqual([meta.width,meta.height,meta.density],[3000,2100,300]); dominant(await pixel(jpeg.bytes,750,1000),0,'HTTP exact left crop'); dominant(await pixel(jpeg.bytes,2250,1000),2,'HTTP exact right crop');
  for (const path of [ownerPath+'?file=proof&draftId='+rendered.id+'&renderId='+rendered.render.id+'&jobId='+job.id,ownerPath+'?draftId='+rendered.id+'&draftId='+rendered.id,ownerPath+'?file=other']) assert.equal((await call(path)).status,400);
  assert.equal((await file('jpeg',rendered,ownerPath,LAB_FIXTURE.otherOwner)).status,404); assert.equal((await file('jpeg',rendered,labPath,LAB_FIXTURE.labOperator)).status,404);
  assert.equal((await call(ownerPath,{ ...filled,requestId:uuid(),expectedVersion:reviewed.version,retailCents:1 })).status,400); assert.equal((await call(ownerPath,{ ...filled,requestId:uuid() })).status,409,'A new save request cannot overwrite a newer draft revision');
  const labSaved=ok(await call(labPath,saveAction(filled.document,{ jobId:job.id }),LAB_FIXTURE.labOperator)).draft;
  const labRendered=ok(await call(labPath,{ action:'render',draftId:labSaved.id,expectedVersion:labSaved.version,requestId:uuid() },LAB_FIXTURE.labOperator)).draft;
  assert.equal((await file('proof',labRendered,labPath,LAB_FIXTURE.labOperator)).status,200); assert.equal((await file('jpeg',labRendered,labPath,LAB_FIXTURE.labOperator)).status,409);
  ok(await call(labPath,{ action:'review',draftId:labRendered.id,renderId:labRendered.render.id,expectedVersion:labRendered.version,sha256:labRendered.render.sha256 },LAB_FIXTURE.labOperator)); assert.equal((await file('jpeg',labRendered,labPath,LAB_FIXTURE.labOperator)).status,200);
  assert.equal((await call(labPath+'?jobId='+job.id,undefined,LAB_FIXTURE.foreignLabOwner)).status,404); assert.equal((await file('proof',labRendered,labPath,LAB_FIXTURE.labOwner)).status,404);
  const edited=ok(await call(ownerPath,{ ...filled,expectedVersion:reviewed.version,requestId:uuid(),document:{ ...filled.document,paperId:'8x10' } })).draft; assert.equal(edited.render,null); assert.equal((await file('jpeg')).status,409); assert.equal((await call(ownerPath,review)).status,409);
  reload=ok(await call(ownerPath+'?draftId='+edited.id)).workspace; assert.equal(reload.drafts.find(d=>d.id===edited.id).document.paperId,'8x10'); assert.equal(await existing(),before,'All 26 existing school, price, order, production and dispatch tables are byte unchanged'); assert(requests<60,'Bounded acceptance stays below sixty application requests');
});
