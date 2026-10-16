import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import ts from 'typescript';
import { z } from 'zod';
import sharp from 'sharp';
import { createLabDatabase, LAB_FIXTURE, fixtureToken, seedLegacyLabCanaries } from '../scripts/lab-system-fixture.mjs';

function load(file, deps = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => { if (!(name in deps)) throw Error(`Missing dependency ${name}`); return deps[name]; }, exports);
  return exports;
}
const money = load('lib/labs/money.ts');
const validation = load('lib/labs/validation.ts', { zod: { z }, './money': money });
const sheetValidation = load('lib/labs/in-house-validation.ts', { 'node:crypto': crypto, zod: { z }, './money': money, './validation': validation });
const uuid = () => crypto.randomUUID();
const token = () => crypto.randomBytes(32).toString('hex');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const OLD_TABLES = ['schools', 'projects', 'packages', 'package_profiles', 'orders', 'studio_labs', 'studio_lab_catalog', 'lab_price_sheets', 'lab_order_assets', 'lab_orders', 'lab_order_events', 'in_house_price_sheets', 'in_house_test_galleries', 'in_house_test_orders', 'in_house_test_order_events'];
const entry = (patch = {}) => ({ id: 'invented-package', sourceKey: 'packages.invented-package', section: 'package', name: 'Invented portrait package', retailCents: 4275, active: true, category: 'package', contents: [{ name: '8x10 Lustre', qty: 1 }, { name: '5x7 Lustre', qty: 2 }], original: { synthetic: true }, ...patch });
function syntheticSheet(patch = {}) {
  const sourceSnapshot = { profile: { id: 'invented-production-source-' + uuid(), name: 'Invented synthetic prices' }, contents: entry().contents, price: 4275 };
  return { name: 'Synthetic private test prices', studioName: 'Invented fixture studio', currency: 'CAD', source: { profileId: sourceSnapshot.profile.id, profileName: sourceSnapshot.profile.name, contentHash: sheetValidation.inHouseSourceHash(sourceSnapshot) }, entries: [entry()], warnings: [], tax: { enabled: true, percent: 13, label: 'Synthetic reference only' }, sourceSnapshot, ...patch };
}
async function asRole(db, role, user, action, aal = 'aal2') {
  assert.ok(['service_role', 'authenticated', 'anon'].includes(role));
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)", [user || '', role, JSON.stringify({ sub: user, role, aal })]);
    return action(tx);
  });
}
function rpcQuery(name, args) {
  assert.match(name, /^[a-z_]+$/);
  const values = Object.entries(args);
  for (const [key] of values) assert.match(key, /^[a-z_]+$/);
  return { sql: `select ${name}(${values.map(([key], index) => `${key}=>$${index + 1}`).join(',')}) as result`, params: values.map(([, value]) => value !== null && typeof value === 'object' ? JSON.stringify(value) : value) };
}
async function rpc(db, name, args) {
  const { sql, params } = rpcQuery(name, args);
  return asRole(db, 'service_role', null, async tx => (await tx.query(sql, params)).rows[0].result);
}
async function snapshots(db, tables = OLD_TABLES) {
  const result = {};
  for (const table of tables) { assert.match(table, /^[a-z_]+$/); result[table] = (await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) as rows from ${table} t`)).rows[0].rows; }
  return JSON.stringify(result);
}
async function importSheet(db, source = syntheticSheet(), user = LAB_FIXTURE.owner) {
  return rpc(db, 'save_in_house_price_sheet', { p_user_id: user, p_action: 'import', p_id: uuid(), p_expected_version: 0, p_document: source });
}
const legacyAssets = () => [
  { id: 'sample-8x10', filename: 'SYNTHETIC-8x10.jpg', widthInches: 8, heightInches: 10, widthPixels: 2400, heightPixels: 3000, sha256: 'a'.repeat(64), byteSize: 1234, quantity: 1 },
  { id: 'sample-5x7', filename: 'SYNTHETIC-5x7.jpg', widthInches: 5, heightInches: 7, widthPixels: 1500, heightPixels: 2100, sha256: 'b'.repeat(64), byteSize: 1234, quantity: 2 },
];
async function seedPreservation(db) {
  await seedLegacyLabCanaries(db);
  const draft = { name: 'Existing synthetic partner price sheet', labId: LAB_FIXTURE.lab, currency: 'CAD', pricing: { markupPercent: 100, rounding: 'none' }, items: [{ catalogProductId: LAB_FIXTURE.productA, retailCents: 1234, enabled: true }], packages: [], shipping: { mode: 'pickup', feeCents: 0, title: 'Pickup' }, terms: 'Existing synthetic terms', assignments: [] };
  await rpc(db, 'save_lab_price_sheet', { p_user_id: LAB_FIXTURE.owner, p_id: uuid(), p_expected_version: 0, p_document: draft, p_action: 'create' });
  const assetId = uuid();
  await db.query(`insert into lab_order_assets(id,photographer_id,lab_id,filename,storage_key,sha256,width_pixels,height_pixels,content_type,byte_size,ready) values($1,$2,$3,'Existing synthetic.jpg',$4,$5,600,400,'image/jpeg',120,true)`, [assetId, LAB_FIXTURE.photographer, LAB_FIXTURE.lab, `existing-synthetic/${assetId}.jpg`, 'c'.repeat(64)]);
  await rpc(db, 'submit_lab_order', { p_actor_user_id: LAB_FIXTURE.owner, p_request_id: uuid(), p_payload: { labId: LAB_FIXTURE.lab, reference: 'Existing synthetic partner order', notes: '', delivery: { mode: 'pickup', name: 'Synthetic studio', address: '' }, items: [{ catalogProductId: LAB_FIXTURE.orderProduct, assetId, quantity: 1 }] } });
  const sheet = await importSheet(db), access = token();
  const gallery = await rpc(db, 'create_in_house_test_gallery', { p_user_id: LAB_FIXTURE.owner, p_request_id: uuid(), p_sheet_id: sheet.id, p_expected_sheet_version: 1, p_entry_id: entry().id, p_name: 'Existing synthetic private gallery', p_token_hash: digest(access), p_assets: legacyAssets() });
  await rpc(db, 'submit_in_house_test_order', { p_gallery_id: gallery.id, p_token_hash: digest(access), p_request_id: uuid(), p_receipt_hash: digest(token()), p_offer_id: gallery.document.offer.id, p_photo_id: 'studio-os-inhouse-demo-v1', p_quantity: 2 });
}

// All fixtures are invented; no customer, real school or actual studio prices.

test('additive production schema preserves every populated legacy school, price, partner order and in-house rehearsal record', async () => {
  let before;
  const db = await createLabDatabase({ beforeProductionMigration: async database => { await seedPreservation(database); before = await snapshots(database); } });
  try {
    assert.ok(before);
    assert.ok(Object.values(JSON.parse(before)).every(rows => rows.length > 0), 'All fifteen preserved tables contain pre-existing canary records');
    assert.equal(await snapshots(db), before);
    for (const table of ['lab_production_policies', 'lab_production_assets', 'lab_production_galleries', 'lab_production_jobs', 'lab_production_events']) assert.equal((await db.query(`select count(*)::int as count from ${table}`)).rows[0].count, 0, 'A migration creates no customer jobs or policy changes');
    const gta = (await db.query("select status,intake_enabled,catalog_verified from studio_labs where slug='gta-imaging'")).rows[0];
    assert.deepEqual(gta, { status: 'setup', intake_enabled: false, catalog_verified: false });
    const bucket = (await db.query("select public,file_size_limit from storage.buckets where id='lab-production-workflow-files'")).rows[0];
    assert.equal(bucket.public, false); assert.equal(Number(bucket.file_size_limit), 4_000_000);
  } finally { await db.close(); }
});

const DEFAULT_POLICY = { autoApprove: false, cropResponsibility: 'photographer', labColourCorrection: false };
const partnerTarget = () => ({ kind: 'partner_lab', labId: LAB_FIXTURE.lab, product8x10Id: LAB_FIXTURE.productB, product5x7Id: LAB_FIXTURE.productA });
const validRect = size => size === '8x10' ? { x: 60, y: 300, width: 2880, height: 3600, rotation: 0 } : { x: 0, y: 0, width: 3000, height: 4200, rotation: 0 };
function assetDocument(patch = {}, photographer = LAB_FIXTURE.photographer) {
  const id = uuid();
  return { id, kind: 'original', jobId: null, size: null, sourceAssetId: null, filename: 'Invented-synthetic-original.jpg', storageKey: `${photographer}/${id}.jpg`, sha256: digest(id), byteSize: 12345, widthPixels: 3000, heightPixels: 4200, contentType: 'image/jpeg', ...patch };
}
async function register(db, document = assetDocument(), actor = LAB_FIXTURE.owner) {
  return rpc(db, 'register_lab_production_asset', { p_user_id: actor, p_document: document });
}
async function setPolicy(db, policy, expectedVersion = 1, actor = LAB_FIXTURE.owner) {
  return rpc(db, 'save_lab_production_policy', { p_user_id: actor, p_expected_version: expectedVersion, p_policy: policy });
}
async function makeGallery(db, opts = {}) {
  const sheet = opts.sheet || await importSheet(db), original = opts.original || await register(db);
  const values = { actor: LAB_FIXTURE.owner, requestId: uuid(), accessToken: token(), sheet, original, ...opts };
  const payload = { sheetId: sheet.id, expectedSheetVersion: sheet.version, entryId: entry().id, name: 'Invented synthetic gallery', assetIds: [original.id], tokenHash: digest(values.accessToken), target: partnerTarget(), ...opts.payload };
  const result = await rpc(db, 'create_lab_production_gallery', { p_user_id: values.actor, p_request_id: values.requestId, p_payload: payload });
  return { ...values, payload, result, id: result.id };
}
async function submit(db, gallery, opts = {}) {
  const values = { requestId: uuid(), receiptToken: token(), quantity: 2, photoId: gallery.result.document.photos[0].id, accessToken: gallery.accessToken, ...opts };
  const result = await rpc(db, 'submit_lab_production_order', { p_gallery_id: gallery.id, p_token_hash: digest(values.accessToken), p_request_id: values.requestId, p_receipt_hash: digest(values.receiptToken), p_photo_id: values.photoId, p_quantity: values.quantity });
  return { ...values, id: result.id, result };
}
const job = async (db, id) => (await db.query('select * from lab_production_jobs where id=$1', [id])).rows[0];
const events = async (db, id) => (await db.query('select * from lab_production_events where job_id=$1 order by version', [id])).rows;
const holds = async (db, id) => (await db.query('select lab_production_holds(j) as holds from lab_production_jobs j where id=$1', [id])).rows[0].holds;
async function act(db, id, action, details = {}, opts = {}) {
  return rpc(db, 'act_lab_production_job', { p_user_id: opts.actor || LAB_FIXTURE.labOperator, p_job_id: id, p_expected_version: opts.version || (await job(db, id)).version, p_request_id: opts.requestId || uuid(), p_action: action, p_details: details });
}
async function saveCrop(db, id, size, opts = {}) {
  const current = await job(db, id), actor = opts.actor || LAB_FIXTURE.owner;
  const document = opts.document || assetDocument({ kind: 'crop', jobId: id, size, sourceAssetId: current.snapshot.sourceAssetId, widthPixels: size === '8x10' ? 2400 : 1500, heightPixels: size === '8x10' ? 3000 : 2100 });
  const result = await rpc(db, 'save_lab_production_crop', { p_user_id: actor, p_job_id: id, p_expected_version: opts.version || current.version, p_request_id: opts.requestId || uuid(), p_size: size, p_crop: opts.rect || validRect(size), p_asset_document: document });
  return { result, document, assetId: document.id };
}
async function finishSize(db, id, size, { cropActor = LAB_FIXTURE.owner, colour = false } = {}) {
  const crop = await saveCrop(db, id, size, { actor: cropActor });
  await act(db, id, 'approve_crop', { size, assetId: crop.assetId }, { actor: cropActor });
  let finalAssetId = crop.assetId;
  if (colour) {
    const corrected = assetDocument({ kind: 'corrected', jobId: id, size, sourceAssetId: crop.assetId, widthPixels: crop.document.widthPixels, heightPixels: crop.document.heightPixels });
    await register(db, corrected, LAB_FIXTURE.labOperator);
    await act(db, id, 'complete_colour', { size, assetId: corrected.id, reviewNoChange: false });
    finalAssetId = corrected.id;
  }
  await act(db, id, 'final_review', { size, assetId: finalAssetId });
  return { ...crop, finalAssetId };
}

test('manual photographer release and own-crop policy holds every output until both exact renders are approved and reviewed', async () => {
  const db = await createLabDatabase();
  try {
    await seedPreservation(db);
    const gallery = await makeGallery(db), before = await snapshots(db), submitted = await submit(db, gallery), frozen = structuredClone((await job(db, submitted.id)).snapshot);
    assert.deepEqual(frozen.policy, DEFAULT_POLICY); assert.equal(frozen.subtotalMinor, 8550); assert.equal(frozen.currency, 'CAD');
    assert.equal(frozen.testOnly, true); assert.equal(frozen.payment, 'test_no_payment'); assert.equal(frozen.printAllowed, false);
    assert.deepEqual((await job(db, submitted.id)).work.lines.map(line => line.quantity), [2, 4]);
    assert.ok((await holds(db, submitted.id)).includes('photographer_approval'));
    await act(db, submitted.id, 'accept');
    await assert.rejects(() => act(db, submitted.id, 'transition', { status: 'in_production' }), /PRODUCTION_HELD/);
    await assert.rejects(() => act(db, submitted.id, 'approve_order'), /PRODUCTION_FORBIDDEN/);
    await assert.rejects(() => saveCrop(db, submitted.id, '8x10', { actor: LAB_FIXTURE.labOperator }), /PRODUCTION_FORBIDDEN/);
    await act(db, submitted.id, 'approve_order', {}, { actor: LAB_FIXTURE.owner });
    const first = await finishSize(db, submitted.id, '8x10');
    assert.ok((await holds(db, submitted.id)).includes('crop_5x7'));
    await assert.rejects(() => act(db, submitted.id, 'transition', { status: 'in_production' }), /PRODUCTION_HELD/);
    const second = await finishSize(db, submitted.id, '5x7');
    assert.deepEqual(await holds(db, submitted.id), []);
    for (const status of ['in_production', 'ready', 'completed']) assert.equal((await act(db, submitted.id, 'transition', { status })).status, status);
    const current = await job(db, submitted.id);
    assert.deepEqual(current.snapshot, frozen, 'Workflow approvals cannot rewrite the order agreement');
    assert.deepEqual(current.work.lines.map(line => line.cropAssetId), [first.assetId, second.assetId]);
    assert.equal(await snapshots(db), before, 'Manual release and crop review preserve all fifteen earlier tables exactly');
  } finally { await db.close(); }
});

test('automatic photographer approval delegates cropping to the lab without approving a center suggestion or missing final review', async () => {
  const db = await createLabDatabase();
  try {
    const policy = { autoApprove: true, cropResponsibility: 'lab', labColourCorrection: false };
    await setPolicy(db, policy);
    const gallery = await makeGallery(db), submitted = await submit(db, gallery);
    assert.equal((await job(db, submitted.id)).work.photographerApproved, true);
    assert.equal((await events(db, submitted.id))[0].actor_role, 'policy');
    assert.equal((await events(db, submitted.id))[0].action, 'submitted_auto_approved');
    assert.ok((await holds(db, submitted.id)).includes('crop_8x10')); assert.ok(!(await holds(db, submitted.id)).includes('photographer_approval'));
    await act(db, submitted.id, 'accept');
    await assert.rejects(() => saveCrop(db, submitted.id, '8x10'), /PRODUCTION_FORBIDDEN/);
    const proposal = await saveCrop(db, submitted.id, '8x10', { actor: LAB_FIXTURE.labOperator });
    assert.equal((await job(db, submitted.id)).work.lines[0].cropApproved, false);
    await assert.rejects(() => act(db, submitted.id, 'final_review', { size: '8x10', assetId: proposal.assetId }), /PRODUCTION_STALE_RENDER/);
    await assert.rejects(() => act(db, submitted.id, 'transition', { status: 'in_production' }), /PRODUCTION_HELD/);
    await act(db, submitted.id, 'approve_crop', { size: '8x10', assetId: proposal.assetId });
    await act(db, submitted.id, 'final_review', { size: '8x10', assetId: proposal.assetId });
    await finishSize(db, submitted.id, '5x7', { cropActor: LAB_FIXTURE.labOperator });
    assert.deepEqual(await holds(db, submitted.id), []);
    await act(db, submitted.id, 'transition', { status: 'in_production' });
    assert.equal((await job(db, submitted.id)).snapshot.printAllowed, false, 'Approvals complete the rehearsal ledger without authorizing a physical printer');
  } finally { await db.close(); }
});

test('lab colour correction requires a separate corrected render for each approved crop and exact final review', async () => {
  const db = await createLabDatabase();
  try {
    const policy = { autoApprove: true, cropResponsibility: 'lab', labColourCorrection: true };
    await setPolicy(db, policy);
    const gallery = await makeGallery(db), submitted = await submit(db, gallery);
    await act(db, submitted.id, 'accept');
    for (const size of ['8x10', '5x7']) {
      const crop = await saveCrop(db, submitted.id, size, { actor: LAB_FIXTURE.labOperator });
      await assert.rejects(() => register(db, assetDocument({ kind: 'corrected', jobId: submitted.id, size, sourceAssetId: crop.assetId, widthPixels: crop.document.widthPixels, heightPixels: crop.document.heightPixels }), LAB_FIXTURE.labOperator), /PRODUCTION_STALE_RENDER/);
      await act(db, submitted.id, 'approve_crop', { size, assetId: crop.assetId });
      await assert.rejects(() => act(db, submitted.id, 'final_review', { size, assetId: crop.assetId }), /PRODUCTION_STALE_RENDER/);
      await assert.rejects(() => act(db, submitted.id, 'complete_colour', { size, assetId: crop.assetId, reviewNoChange: false }), /PRODUCTION_STALE_RENDER/);
      const corrected = assetDocument({ kind: 'corrected', jobId: submitted.id, size, sourceAssetId: crop.assetId, widthPixels: crop.document.widthPixels, heightPixels: crop.document.heightPixels });
      await assert.rejects(() => register(db, corrected, LAB_FIXTURE.owner), /PRODUCTION_FORBIDDEN/);
      await register(db, corrected, LAB_FIXTURE.labOperator);
      await act(db, submitted.id, 'complete_colour', { size, assetId: corrected.id, reviewNoChange: false });
      assert.ok((await holds(db, submitted.id)).includes(`final_review_${size}`));
      await act(db, submitted.id, 'final_review', { size, assetId: corrected.id });
    }
    assert.deepEqual(await holds(db, submitted.id), []);
    for (const status of ['in_production', 'ready', 'completed']) await act(db, submitted.id, 'transition', { status });
    const current = await job(db, submitted.id);
    assert.ok(current.work.lines.every(line => line.colourAssetId && line.colourCompletedAt && line.finalReviewedAt));
    assert.equal(current.snapshot.payment, 'test_no_payment'); assert.equal(current.snapshot.printAllowed, false);
  } finally { await db.close(); }
});

const productionValidation = load('lib/labs/production-validation.ts', { zod: { z }, './validation': validation });
test('strict production actions keep prices, approval evidence and internal rendering metadata server controlled', () => {
  const policy = { action: 'save_policy', expectedVersion: 1, policy: DEFAULT_POLICY };
  assert.deepEqual(productionValidation.parseProductionOwnerAction(policy), policy);
  for (const changed of [{ autoApprove: 'true' }, { cropResponsibility: 'automatic' }, { labColourCorrection: 'true' }, { aiCredits: 100 }, { qualityApproved: true }]) assert.throws(() => productionValidation.parseProductionOwnerAction({ ...policy, policy: { ...policy.policy, ...changed } }));
  const crop = { action: 'save_crop', jobId: uuid(), expectedVersion: 1, requestId: uuid(), productSize: '8x10', rect: validRect('8x10') };
  assert.deepEqual(productionValidation.parseProductionOwnerAction(crop), crop);
  for (const changed of [{ sourceAssetId: uuid() }, { sha256: 'a'.repeat(64) }, { cropApproved: true }, { render: {} }, { aiApproved: true }, { printAllowed: true }, { rect: { ...crop.rect, x: -1 } }, { rect: { ...crop.rect, width: 100.5 } }, { rect: { ...crop.rect, rotation: 45 } }, { rect: { ...crop.rect, headSafe: true } }]) assert.throws(() => productionValidation.parseProductionOwnerAction({ ...crop, ...changed }));
  const parent = { action: 'submit', galleryId: uuid(), accessToken: token(), requestId: uuid(), receiptToken: token(), photoId: uuid(), quantity: 2 };
  assert.deepEqual(productionValidation.parseProductionParentAction(parent), parent);
  for (const changed of [{ retailCents: 1 }, { totalMinor: 1 }, { policy: { autoApprove: true } }, { photographerApproved: true }, { sourceAssetId: uuid() }, { quantity: 0 }, { quantity: 11 }, { quantity: 1.5 }, { paid: true }, { credits: 1 }, { email: 'invented@example.test' }]) assert.throws(() => productionValidation.parseProductionParentAction({ ...parent, ...changed }));
  assert.equal(productionValidation.PRODUCTION_BUCKET, 'lab-production-workflow-files');
});

test('production RLS requires lab MFA, isolates foreign studios and keeps every table write behind checked RPCs', async () => {
  const db = await createLabDatabase();
  const tables = ['lab_production_policies', 'lab_production_assets', 'lab_production_galleries', 'lab_production_jobs', 'lab_production_events'];
  try {
    await setPolicy(db, { autoApprove: true, cropResponsibility: 'lab', labColourCorrection: false });
    const gallery = await makeGallery(db);
    const readAs = (table, actor, aal = 'aal2') => asRole(db, 'authenticated', actor, tx => tx.query(`select * from ${table}`), aal);
    assert.equal((await readAs('lab_production_assets', LAB_FIXTURE.labOperator)).rows.length, 0, 'Unsubmitted studio originals are private');
    const submitted = await submit(db, gallery);
    for (const table of tables) {
      assert.ok((await readAs(table, LAB_FIXTURE.owner, 'aal1')).rows.length > 0, `Owner can read own ${table}`);
      for (const actor of [LAB_FIXTURE.otherOwner, LAB_FIXTURE.foreignLabOwner, LAB_FIXTURE.admin]) assert.equal((await readAs(table, actor)).rows.length, 0, `${actor} cannot read ${table}`);
      for (const actor of [LAB_FIXTURE.labOwner, LAB_FIXTURE.labOperator, LAB_FIXTURE.labViewer]) {
        assert.equal((await readAs(table, actor, 'aal1')).rows.length, 0, `Lab MFA cannot be bypassed through direct ${table} reads`);
        assert.equal((await readAs(table, actor)).rows.length, ['lab_production_policies', 'lab_production_galleries', 'lab_production_jobs'].includes(table) ? 0 : 1);
      }
      await assert.rejects(() => asRole(db, 'anon', null, tx => tx.query(`select * from ${table}`)), error => error.code === '42501');
      for (const role of ['authenticated', 'service_role']) {
        const key = table === 'lab_production_policies' ? 'photographer_id' : 'id';
        await assert.rejects(() => asRole(db, role, LAB_FIXTURE.owner, tx => tx.query(`insert into ${table} select * from ${table}`)), error => error.code === '42501');
        await assert.rejects(() => asRole(db, role, LAB_FIXTURE.owner, tx => tx.query(`update ${table} set ${key}=${key}`)), error => error.code === '42501');
        await assert.rejects(() => asRole(db, role, LAB_FIXTURE.owner, tx => tx.query(`delete from ${table}`)), error => error.code === '42501');
      }
    }
    for (const actor of [LAB_FIXTURE.otherOwner, LAB_FIXTURE.foreignLabOwner, LAB_FIXTURE.admin, LAB_FIXTURE.labViewer]) await assert.rejects(() => act(db, submitted.id, 'accept', {}, { actor }));
    const blocked = [
      ['save_lab_production_policy', { p_user_id: LAB_FIXTURE.owner, p_expected_version: 2, p_policy: DEFAULT_POLICY }],
      ['register_lab_production_asset', { p_user_id: LAB_FIXTURE.owner, p_document: assetDocument() }],
      ['create_lab_production_gallery', { p_user_id: LAB_FIXTURE.owner, p_request_id: uuid(), p_payload: gallery.payload }],
      ['read_lab_production_gallery', { p_gallery_id: gallery.id, p_token_hash: digest(gallery.accessToken) }],
      ['read_lab_production_photo', { p_gallery_id: gallery.id, p_token_hash: digest(gallery.accessToken), p_photo_id: gallery.result.document.photos[0].id }],
      ['submit_lab_production_order', { p_gallery_id: gallery.id, p_token_hash: digest(gallery.accessToken), p_request_id: uuid(), p_receipt_hash: digest(token()), p_photo_id: gallery.result.document.photos[0].id, p_quantity: 1 }],
      ['read_lab_production_receipt', { p_receipt_hash: digest(submitted.receiptToken) }],
      ['act_lab_production_job', { p_user_id: LAB_FIXTURE.owner, p_job_id: submitted.id, p_expected_version: 1, p_request_id: uuid(), p_action: 'approve_order', p_details: {} }],
    ];
    for (const [name, args] of blocked) for (const role of ['authenticated', 'anon']) {
      const { sql, params } = rpcQuery(name, args);
      await assert.rejects(() => asRole(db, role, LAB_FIXTURE.owner, tx => tx.query(sql, params)), error => error.code === '42501', `${role} cannot execute ${name}`);
    }
  } finally { await db.close(); }
});

test('saved production policy and gallery price remain frozen, while stale versions and changed requests conflict', async () => {
  const db = await createLabDatabase();
  try {
    const original = assetDocument(), registered = await register(db, original);
    assert.equal((await register(db, original)).id, registered.id);
    for (const change of [{ filename: 'Different-name.jpg' }, { widthPixels: 2999 }, { byteSize: 100 }, { contentType: 'image/png', storageKey: original.storageKey.replace('.jpg', '.png') }, { sha256: '0'.repeat(64) }]) await assert.rejects(() => register(db, { ...original, ...change }), /PRODUCTION_REQUEST_CONFLICT/);
    const values = { requestId: uuid(), accessToken: token(), original: registered, sheet: await importSheet(db) };
    const gallery = await makeGallery(db, values);
    assert.equal((await makeGallery(db, values)).result.replayed, true);
    await assert.rejects(() => makeGallery(db, { ...values, payload: { name: 'Changed gallery' } }), /PRODUCTION_REQUEST_CONFLICT/);
    await setPolicy(db, { autoApprove: true, cropResponsibility: 'lab', labColourCorrection: true });
    await assert.rejects(() => setPolicy(db, DEFAULT_POLICY), /PRODUCTION_VERSION_CONFLICT/);
    const submitted = await submit(db, gallery), frozen = structuredClone((await job(db, submitted.id)).snapshot);
    assert.deepEqual(frozen.policy, DEFAULT_POLICY, 'The gallery policy, not later defaults, governs the order');
    assert.equal(frozen.offer.retailCents, 4275);
    const changed = { name: 'Edited synthetic price copy', entries: [{ id: entry().id, retailCents: 9999, active: true }] };
    await rpc(db, 'save_in_house_price_sheet', { p_user_id: LAB_FIXTURE.owner, p_action: 'save', p_id: gallery.sheet.id, p_expected_version: 1, p_document: changed });
    const second = await submit(db, gallery);
    assert.equal(second.result.subtotalMinor, 8550);
    const retry = await submit(db, gallery, { requestId: submitted.requestId, receiptToken: submitted.receiptToken });
    assert.equal(retry.id, submitted.id); assert.equal(retry.result.replayed, true);
    await assert.rejects(() => submit(db, gallery, { requestId: submitted.requestId, receiptToken: submitted.receiptToken, quantity: 3 }), /PRODUCTION_REQUEST_CONFLICT/);
    const requestId = uuid();
    await act(db, submitted.id, 'approve_order', {}, { actor: LAB_FIXTURE.owner, requestId, version: 1 });
    const replay = await act(db, submitted.id, 'approve_order', {}, { actor: LAB_FIXTURE.owner, requestId, version: 1 });
    assert.equal(replay.replayed, true);
    await assert.rejects(() => act(db, submitted.id, 'approve_order', { changed: true }, { actor: LAB_FIXTURE.owner, requestId, version: 1 }), /PRODUCTION_REQUEST_CONFLICT/);
    await assert.rejects(() => act(db, submitted.id, 'accept', {}, { version: 1 }), /PRODUCTION_VERSION_CONFLICT/);
    assert.deepEqual((await job(db, submitted.id)).snapshot, frozen);
  } finally { await db.close(); }
});

test('re-cropping invalidates old approvals, colour work and final checks without rewriting original bytes or submitted pricing', async () => {
  const db = await createLabDatabase();
  try {
    await setPolicy(db, { autoApprove: true, cropResponsibility: 'lab', labColourCorrection: true });
    const gallery = await makeGallery(db), submitted = await submit(db, gallery);
    await act(db, submitted.id, 'accept');
    const previous = await finishSize(db, submitted.id, '8x10', { cropActor: LAB_FIXTURE.labOperator, colour: true });
    const oldAssetRows = (await db.query('select * from lab_production_assets order by id')).rows;
    const original = oldAssetRows.find(row => row.id === gallery.original.id), frozen = structuredClone((await job(db, submitted.id)).snapshot);
    const next = await saveCrop(db, submitted.id, '8x10', { actor: LAB_FIXTURE.labOperator });
    const line = (await job(db, submitted.id)).work.lines[0];
    assert.equal(line.cropAssetId, next.assetId); assert.equal(line.cropApproved, false);
    for (const key of ['cropApprovedAt', 'colourAssetId', 'colourCompletedAt', 'finalReviewedAt']) assert.equal(key in line, false, `${key} must be cleared by a new crop revision`);
    await assert.rejects(() => act(db, submitted.id, 'approve_crop', { size: '8x10', assetId: previous.assetId }), /PRODUCTION_STALE_RENDER/);
    await assert.rejects(() => act(db, submitted.id, 'complete_colour', { size: '8x10', assetId: previous.finalAssetId, reviewNoChange: false }), /PRODUCTION_STALE_RENDER/);
    await assert.rejects(() => act(db, submitted.id, 'final_review', { size: '8x10', assetId: previous.finalAssetId }), /PRODUCTION_STALE_RENDER/);
    assert.deepEqual((await db.query('select * from lab_production_assets where id=$1', [original.id])).rows[0], original);
    for (const before of oldAssetRows) assert.deepEqual((await db.query('select * from lab_production_assets where id=$1', [before.id])).rows[0], before, 'Earlier source and render registry entries remain immutable');
    assert.deepEqual((await job(db, submitted.id)).snapshot, frozen);
    const cropRequest = uuid(), cropDocument = assetDocument({ kind: 'crop', jobId: submitted.id, size: '5x7', sourceAssetId: gallery.original.id, widthPixels: 1500, heightPixels: 2100 });
    const version = (await job(db, submitted.id)).version;
    const saved = await saveCrop(db, submitted.id, '5x7', { actor: LAB_FIXTURE.labOperator, requestId: cropRequest, version, document: cropDocument });
    const retried = await saveCrop(db, submitted.id, '5x7', { actor: LAB_FIXTURE.labOperator, requestId: cropRequest, version, document: cropDocument });
    assert.equal(retried.result.replayed, true); assert.equal(retried.result.version, saved.result.version);
    await assert.rejects(() => saveCrop(db, submitted.id, '5x7', { actor: LAB_FIXTURE.labOperator, requestId: cropRequest, version, document: cropDocument, rect: { ...validRect('5x7'), x: 1 } }), /PRODUCTION_REQUEST_CONFLICT/);
  } finally { await db.close(); }
});

test('explicit lab review can record no colour change, but the colour toggle alone never completes that task', async () => {
  const db = await createLabDatabase();
  try {
    await setPolicy(db, { autoApprove: true, cropResponsibility: 'lab', labColourCorrection: true });
    const gallery = await makeGallery(db), submitted = await submit(db, gallery);
    await act(db, submitted.id, 'accept');
    const crop = await saveCrop(db, submitted.id, '8x10', { actor: LAB_FIXTURE.labOperator });
    await act(db, submitted.id, 'approve_crop', { size: '8x10', assetId: crop.assetId });
    assert.ok((await holds(db, submitted.id)).includes('colour_8x10'));
    const beforeAssets = (await db.query('select count(*)::int as n from lab_production_assets')).rows[0].n;
    await act(db, submitted.id, 'complete_colour', { size: '8x10', assetId: crop.assetId, reviewNoChange: true });
    const current = await job(db, submitted.id);
    assert.equal(current.work.lines[0].colourAssetId, crop.assetId);
    assert.ok(current.work.lines[0].colourCompletedAt);
    assert.ok((await holds(db, submitted.id)).includes('final_review_8x10'));
    assert.equal((await db.query('select count(*)::int as n from lab_production_assets')).rows[0].n, beforeAssets, 'An explicit no-change review creates no fake corrected file');
    assert.equal((await events(db, submitted.id)).at(-1).action, 'reviewed_no_colour_change');
    await act(db, submitted.id, 'final_review', { size: '8x10', assetId: crop.assetId });
  } finally { await db.close(); }
});

test('pixel crop validation rejects missing, fractional, outside, mismatched and low-detail geometry; rotations keep a review hold', async () => {
  const db = await createLabDatabase();
  try {
    const gallery = await makeGallery(db), submitted = await submit(db, gallery), initialVersion = (await job(db, submitted.id)).version;
    const invalid = [
      { ...validRect('8x10'), x: -1 }, { ...validRect('8x10'), y: 0.5 }, { ...validRect('8x10'), width: 0 },
      { ...validRect('8x10'), width: 3001 }, { ...validRect('8x10'), height: 4201 }, { ...validRect('8x10'), rotation: 45 },
      { x: 0, y: 0, width: 1200, height: 1500, rotation: 0 }, { x: 0, y: 0, width: 2800, height: 2800, rotation: 0 },
      { ...validRect('8x10'), autoApproved: true }, { x: 0, y: 0, width: 2400, height: 3000 },
    ];
    for (const rect of invalid) await assert.rejects(() => saveCrop(db, submitted.id, '8x10', { rect }), /PRODUCTION_INVALID_CROP|PRODUCTION_CROP_DETAIL/);
    assert.equal((await job(db, submitted.id)).version, initialVersion);
    assert.equal((await db.query("select count(*)::int as n from lab_production_assets where kind='crop'")).rows[0].n, 0);
    for (const rotation of [0, 90, 180, 270]) {
      const rect = rotation === 90 || rotation === 270 ? { x: 0, y: 0, width: 3000, height: 2400, rotation } : { ...validRect('8x10'), rotation };
      const saved = await saveCrop(db, submitted.id, '8x10', { rect });
      assert.deepEqual(saved.result.work.lines[0].crop, rect);
      assert.equal(saved.result.work.lines[0].cropApproved, false, 'Geometry can suggest an output but cannot approve a head or hair crop');
    }
    const atMinimum = await saveCrop(db, submitted.id, '5x7', { rect: { x: 0, y: 0, width: 1000, height: 1400, rotation: 0 } });
    assert.equal(atMinimum.result.work.lines[1].cropApproved, false);
    await assert.rejects(() => saveCrop(db, submitted.id, '5x7', { document: assetDocument({ kind: 'crop', jobId: submitted.id, size: '5x7', sourceAssetId: uuid(), widthPixels: 1500, heightPixels: 2100 }) }), /PRODUCTION_STALE_RENDER/);
  } finally { await db.close(); }
});

const httpOrigin = process.env.LAB_SYSTEM_HTTP_ORIGIN;
test('actual Next production rehearses all three approval/crop/colour modes and returns exact reviewed paper files with no paid providers', { skip: !httpOrigin }, async () => {
  assert.match(httpOrigin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  const fixtureUrl = process.env.LAB_SYSTEM_FIXTURE_URL || 'http://127.0.0.1:55541';
  assert.match(fixtureUrl, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  let requests = 0;
  const call = async (path, body, actor = LAB_FIXTURE.owner) => {
    requests++;
    const multipart = body instanceof FormData;
    const response = await fetch(new URL(path, httpOrigin), { method: body === undefined ? 'GET' : 'POST', headers: { Origin: new URL(httpOrigin).origin, ...(actor ? { Authorization: `Bearer ${fixtureToken(actor)}` } : {}), ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
    if (path.includes('lab-production') || path.startsWith('/api/lab/production') || path.startsWith('/api/labs-pilot/production')) {
      assert.match(response.headers.get('cache-control') || '', /private.*no-store/);
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.match(response.headers.get('x-robots-tag') || '', /noindex, nofollow/);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, bytes, body: (response.headers.get('content-type') || '').includes('application/json') ? JSON.parse(bytes.toString('utf8')) : bytes, response };
  };
  const expectOk = result => { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };
  const originalBytes = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="4200"><rect width="3000" height="4200" fill="#e4eedc"/><path d="M0 0h3000v180H0z" fill="#ba4528"/><path d="M0 3900h3000v300H0z" fill="#345d93"/><circle cx="1500" cy="1350" r="470" fill="#dba379"/><rect x="940" y="1850" width="1120" height="1900" rx="180" fill="#396b55"/><path d="M500 0v4200M2500 0v4200" stroke="#e3b62c" stroke-width="60"/><text x="1500" y="300" text-anchor="middle" font-family="sans-serif" font-size="110">SYNTHETIC TEST ARTWORK</text></svg>')).jpeg({ quality: 90 }).toBuffer();
  const form = (bytes = originalBytes, fields = {}) => { const data = new FormData(); data.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'Invented-synthetic-photo.jpg'); for (const [key, value] of Object.entries({ kind: 'original', audience: 'studio', ...fields })) data.append(key, value); return data; };
  const ownerPath = '/api/dashboard/lab-production', labPath = '/api/lab/production', assetPath = '/api/dashboard/lab-production-assets', parentPath = '/api/labs-pilot/production';
  assert.equal((await call(ownerPath, undefined, null)).status, 401);
  assert.equal((await call(assetPath, form(Buffer.from('not a complete JPEG')))).status, 400);
  const uploaded = expectOk(await call(assetPath, form())).asset;
  assert.equal(uploaded.sha256, digest(originalBytes)); assert.equal(uploaded.byteSize, originalBytes.length);
  const imported = expectOk(await call('/api/dashboard/in-house-price-sheets', { action: 'import', sheet: syntheticSheet() })).sheet;
  const snapshotExisting = async () => {
    const value = {};
    for (const table of OLD_TABLES) { const result = await fetch(`${fixtureUrl}/rest/v1/${table}?select=*&order=id`, { headers: { Authorization: `Bearer ${fixtureToken(null, 'service_role')}` } }); assert.equal(result.status, 200); value[table] = await result.json(); }
    return JSON.stringify(value);
  };
  const before = await snapshotExisting();
  const policies = [DEFAULT_POLICY, { autoApprove: true, cropResponsibility: 'lab', labColourCorrection: false }, { autoApprove: true, cropResponsibility: 'lab', labColourCorrection: true }];
  for (const [index, policy] of policies.entries()) {
    const labActor = index === 1 ? LAB_FIXTURE.labOwner : LAB_FIXTURE.labOperator;
    const start = expectOk(await call(ownerPath)).workspace;
    expectOk(await call(ownerPath, { action: 'save_policy', expectedVersion: start.policy.version, policy }));
    const accessToken = token(), created = expectOk(await call(ownerPath, { action: 'create_gallery', requestId: uuid(), sheetId: imported.id, expectedSheetVersion: imported.version, entryId: entry().id, name: `Synthetic production mode ${index + 1}`, assetIds: [uploaded.id], accessToken, target: partnerTarget() }));
    const gallery = created.gallery;
    const view = expectOk(await call(parentPath, { action: 'gallery', galleryId: gallery.id, accessToken }, null)).gallery;
    for (const privateValue of [uploaded.id, imported.id, imported.source.profileId, imported.source.contentHash, LAB_FIXTURE.photographer, digest(accessToken), entry().id]) assert.equal(JSON.stringify(view).includes(privateValue), false);
    if (index === 0) {
      const preview = await call(parentPath, { action: 'photo', galleryId: gallery.id, accessToken, photoId: view.photos[0].id }, null);
      assert.equal(preview.status, 200); assert.equal((await sharp(preview.bytes).metadata()).format, 'jpeg');
      assert.equal((await call(parentPath, { action: 'photo', galleryId: gallery.id, accessToken, photoId: uploaded.id }, null)).status, 404);
      assert.equal((await call(`${assetPath}?assetId=${uploaded.id}&audience=lab`, undefined, labActor)).status, 404, 'Lab cannot browse an original before an order is submitted');
    }
    const receiptToken = token(), submission = { action: 'submit', galleryId: gallery.id, accessToken, requestId: uuid(), receiptToken, photoId: view.photos[0].id, quantity: 2 };
    const received = expectOk(await call(parentPath, submission, null)).receipt;
    assert.equal(received.subtotalMinor, 8550); assert.equal(received.testOnly, true); assert.equal(received.printAllowed, false); assert.equal(received.payment, 'test_no_payment');
    assert.equal('source' in received, false); assert.equal('sourceAssetId' in received, false);
    let current = expectOk(await call(ownerPath)).workspace.jobs.find(value => value.id === received.id);
    assert.equal(current.photographerApproved, policy.autoApprove);
    const labWorkspace = expectOk(await call(labPath, undefined, labActor)).workspace;
    const labJob = labWorkspace.jobs.find(value => value.id === received.id);
    assert.equal(labJob.amountKind, 'wholesale'); assert.equal(labJob.offer.retailCents, 800); assert.equal(labJob.subtotalMinor, 1600);
    assert.equal(current.amountKind, 'retail'); assert.equal(current.offer.retailCents, 4275); assert.equal(current.subtotalMinor, 8550);
    const labJson = JSON.stringify(labWorkspace);
    for (const hidden of [imported.id, imported.source.profileId, imported.source.contentHash, entry().id, entry().name]) assert.equal(labJson.includes(hidden), false, 'The receiver cannot read private retail sheet identity');
    assert.doesNotMatch(labJson, /"retailCents":4275|"subtotalMinor":8550/);
    assert.deepEqual(labWorkspace.sheets, []); assert.deepEqual(labWorkspace.galleries, []);
    const update = async (action, details = {}, actor = labActor) => {
      const body = { action, jobId: current.id, expectedVersion: current.version, requestId: uuid(), ...details };
      const result = await call(actor === LAB_FIXTURE.owner ? ownerPath : labPath, body, actor);
      if (result.status === 200) current = result.body.job;
      return result;
    };
    const files = (file, actor = labActor) => call(`/api/dashboard/lab-production-files?jobId=${current.id}&file=${file}&audience=${[LAB_FIXTURE.owner, LAB_FIXTURE.otherOwner].includes(actor) ? 'studio' : 'lab'}`, undefined, actor);
    assert.equal((await files('manifest')).status, 409);
    expectOk(await update('accept'));
    assert.equal((await update('transition', { status: 'in_production' })).status, 409);
    if (!policy.autoApprove) expectOk(await update('approve_order', {}, LAB_FIXTURE.owner));
    for (const size of ['8x10', '5x7']) {
      const actor = policy.cropResponsibility === 'photographer' ? LAB_FIXTURE.owner : labActor;
      const cropAction = { action: 'save_crop', jobId: current.id, expectedVersion: current.version, requestId: uuid(), productSize: size, rect: validRect(size) };
      const saved = expectOk(await call(actor === LAB_FIXTURE.owner ? ownerPath : labPath, cropAction, actor)); current = saved.job;
      let line = current.lines.find(value => value.size === size);
      assert.equal(line.cropApproved, false); assert.ok(line.cropAsset.sha256);
      if (index === 0 && size === '8x10') {
        const retried = expectOk(await call(ownerPath, cropAction)); assert.equal(retried.replayed, true); assert.equal(retried.job.version, current.version);
        assert.equal((await call(ownerPath, { ...cropAction, rect: { ...cropAction.rect, x: cropAction.rect.x + 1 } })).status, 409);
      }
      expectOk(await update('approve_crop', { size, assetId: line.cropAsset.id }, actor));
      line = current.lines.find(value => value.size === size);
      if (policy.labColourCorrection) {
        assert.ok(current.holds.includes(`colour_${size}`));
        if (size === '8x10') {
          const cropBytes = await call(`${assetPath}?assetId=${line.cropAsset.id}&audience=lab`, undefined, labActor);
          assert.equal(cropBytes.status, 200); assert.equal(digest(cropBytes.bytes), line.cropAsset.sha256);
          const correctedBytes = await sharp(cropBytes.bytes).modulate({ brightness: 1.03 }).jpeg({ quality: 95 }).toBuffer();
          const correction = expectOk(await call(assetPath, form(correctedBytes, { kind: 'corrected', audience: 'lab', jobId: current.id, productSize: size, sourceAssetId: line.cropAsset.id }), labActor)).asset;
          expectOk(await update('complete_colour', { size, assetId: correction.id, reviewNoChange: false }));
        } else expectOk(await update('complete_colour', { size, assetId: line.cropAsset.id, reviewNoChange: true }));
      }
      line = current.lines.find(value => value.size === size);
      expectOk(await update('final_review', { size, assetId: line.finalAsset.id }));
      if (size === '8x10') assert.equal((await files('manifest')).status, 409, 'A complete first size cannot release the unfinished second size');
    }
    assert.deepEqual(current.holds, []);
    expectOk(await update('transition', { status: 'in_production' }));
    const manifest = expectOk(await files('manifest'));
    assert.equal(manifest.finishedPrints, 6); assert.equal(manifest.paperSheets, 4); assert.equal(manifest.printAllowed, false); assert.equal(manifest.payment, 'test_no_payment');
    assert.equal(manifest.sourceSha256, uploaded.sha256); assert.deepEqual(manifest.policy, policy);
    assert.deepEqual(manifest.sheets.map(sheet => [sheet.size, sheet.copies, sheet.printsPerSheet]), [['8x10', 2, 1], ['10x7', 2, 2]]);
    for (const sheet of manifest.sheets) {
      const downloaded = await files(sheet.size); assert.equal(downloaded.status, 200); assert.equal(downloaded.bytes.length, sheet.byteSize); assert.equal(digest(downloaded.bytes), sheet.sha256);
      const metadata = await sharp(downloaded.bytes).metadata(); assert.equal(metadata.width, sheet.widthPixels); assert.equal(metadata.height, sheet.heightPixels); assert.equal(metadata.density, 300); assert.equal(metadata.orientation === undefined || metadata.orientation === 1, true);
    }
    if (index === 0) {
      assert.equal((await files('manifest', LAB_FIXTURE.otherOwner)).status, 404);
      assert.equal((await files('manifest', LAB_FIXTURE.foreignLabOwner)).status, 404);
    }
    for (const status of ['ready', 'completed']) expectOk(await update('transition', { status }));
    const tracked = expectOk(await call(parentPath, { action: 'receipt', receiptToken }, null)).receipt;
    assert.equal(tracked.id, current.id); assert.equal(tracked.status, 'completed'); assert.equal(tracked.printAllowed, false);
  }
  const exactOriginal = await call(`${assetPath}?assetId=${uploaded.id}&audience=studio`);
  assert.equal(exactOriginal.status, 200); assert.deepEqual(exactOriginal.bytes, originalBytes, 'Cropping and lab colour work never overwrite the original photograph');
  assert.equal(await snapshotExisting(), before, 'All legacy schools, pricing, partner orders and earlier rehearsal orders stay byte exact through every new production mode');
  assert.ok(requests < 100, `The bounded workflow used ${requests} API requests`);
});

test('publication fails closed for tiny originals, missing versions, duplicate or foreign products and disabled GTA intake', async () => {
  const db = await createLabDatabase();
  try {
    const sheet = await importSheet(db), original = await register(db);
    for (const target of [{ ...partnerTarget(), product5x7Id: LAB_FIXTURE.productB }, { ...partnerTarget(), product5x7Id: LAB_FIXTURE.foreignProduct }, { ...partnerTarget(), inventedCost: 0 }, { kind: 'in_house', labId: LAB_FIXTURE.lab }]) await assert.rejects(() => makeGallery(db, { sheet, original, payload: { target } }), /PRODUCTION_INVALID|PRODUCTION_LAB_NOT_READY/);
    const gta = (await db.query("select id from studio_labs where slug='gta-imaging'")).rows[0];
    await assert.rejects(() => makeGallery(db, { sheet, original, payload: { target: { ...partnerTarget(), labId: gta.id } } }), /PRODUCTION_LAB_NOT_READY/);
    for (const expectedSheetVersion of [null, 0, 1.5, 2]) await assert.rejects(() => makeGallery(db, { sheet, original, payload: { expectedSheetVersion } }), /PRODUCTION_INVALID|PRODUCTION_VERSION_CONFLICT/);
    const small = await register(db, assetDocument({ widthPixels: 1000, heightPixels: 1400 }));
    await assert.rejects(() => makeGallery(db, { sheet, original: small }), /PRODUCTION_SOURCE_DETAIL/);
    const landscapeBelowCurrentUiMinimum = await register(db, assetDocument({ widthPixels: 2000, heightPixels: 1600 }));
    await assert.rejects(() => makeGallery(db, { sheet, original: landscapeBelowCurrentUiMinimum }), /PRODUCTION_SOURCE_DETAIL/, 'Current gallery UI publishes upright portrait source dimensions only');
    const gallery = await makeGallery(db, { sheet, original });
    const frozen = JSON.stringify(gallery.result);
    await assert.rejects(() => rpc(db, 'manage_lab_production_gallery', { p_user_id: LAB_FIXTURE.owner, p_gallery_id: gallery.id, p_expected_version: 1, p_action: null, p_token_hash: null }), /PRODUCTION_INVALID/);
    assert.deepEqual((await db.query('select to_jsonb(g) as row from lab_production_galleries g where id=$1', [gallery.id])).rows[0].row, Object.fromEntries(Object.entries(JSON.parse(frozen)).filter(([key]) => key !== 'replayed')));
    const rotatedToken = token();
    await rpc(db, 'manage_lab_production_gallery', { p_user_id: LAB_FIXTURE.owner, p_gallery_id: gallery.id, p_expected_version: 1, p_action: 'rotate', p_token_hash: digest(rotatedToken) });
    await assert.rejects(() => submit(db, gallery), /PRODUCTION_NOT_FOUND/);
    const changed = { ...gallery, accessToken: rotatedToken };
    const submitted = await submit(db, changed);
    await rpc(db, 'manage_lab_production_gallery', { p_user_id: LAB_FIXTURE.owner, p_gallery_id: gallery.id, p_expected_version: 2, p_action: 'revoke', p_token_hash: null });
    await assert.rejects(() => submit(db, changed), /PRODUCTION_NOT_FOUND/);
    const receipt = await rpc(db, 'read_lab_production_receipt', { p_receipt_hash: digest(submitted.receiptToken) });
    assert.equal(receipt.id, submitted.id, 'Gallery closure leaves an individual saved receipt available');
    assert.equal(JSON.stringify(receipt).includes(original.id), false); assert.equal(JSON.stringify(receipt).includes(sheet.id), false);
  } finally { await db.close(); }
});

test('actual production rejects unsafe uploads, foreign capabilities and corrupted renders without mutating saved data', { skip: !httpOrigin }, async () => {
  assert.match(httpOrigin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  const fixtureUrl = process.env.LAB_SYSTEM_FIXTURE_URL || 'http://127.0.0.1:55541';
  assert.match(fixtureUrl, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  const serviceHeaders = { Authorization: `Bearer ${fixtureToken(null, 'service_role')}` };
  const rest = async (table, extra = '') => { const response = await fetch(`${fixtureUrl}/rest/v1/${table}?select=*&order=id${extra}`, { headers: serviceHeaders }); assert.equal(response.status, 200); return response.json(); };
  const jobs = await rest('lab_production_jobs'), assets = await rest('lab_production_assets'), galleries = await rest('lab_production_galleries');
  assert.ok(jobs.length >= 3 && assets.length > 3 && galleries.length >= 3, 'Run the three-mode HTTP rehearsal first');
  const registryBefore = JSON.stringify({ jobs, assets, galleries });
  const call = async (path, body, actor = LAB_FIXTURE.owner) => {
    const multipart = body instanceof FormData;
    const response = await fetch(new URL(path, httpOrigin), { method: body === undefined ? 'GET' : 'POST', headers: { Origin: new URL(httpOrigin).origin, Authorization: `Bearer ${fixtureToken(actor)}`, ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
    const value = await response.json(); assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); return { status: response.status, body: value };
  };
  const upload = (bytes, extra = {}) => { const form = new FormData(); form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'Invented-only.jpg'); for (const [key, value] of Object.entries({ audience: 'studio', kind: 'original', ...extra })) form.append(key, value); return form; };
  assert.equal((await call('/api/dashboard/lab-production-assets', upload(Buffer.from('x'), { costCents: '1' }))).status, 400);
  assert.equal((await call('/api/dashboard/lab-production-assets', upload(Buffer.alloc(4_000_001)))).status, 413);
  const duplicate = upload(Buffer.from('x')); duplicate.append('kind', 'original');
  assert.equal((await call('/api/dashboard/lab-production-assets', duplicate)).status, 400);
  assert.equal((await call('/api/dashboard/lab-production-assets', upload(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01])))).status, 400);
  assert.equal((await call(`/api/dashboard/lab-production-files?jobId=${jobs[0].id}&file=arbitrary-path&audience=studio`)).status, 400);
  assert.equal((await call(`/api/dashboard/lab-production-assets?assetId=${assets[0].id}&audience=studio`, undefined, LAB_FIXTURE.otherOwner)).status, 404);
  assert.equal((await call('/api/labs-pilot/production', { action: 'photo', galleryId: galleries[0].id, accessToken: token(), photoId: uuid() })).status, 404);
  const labDirect = await fetch(`${fixtureUrl}/rest/v1/lab_production_jobs?select=*`, { headers: { Authorization: `Bearer ${fixtureToken(LAB_FIXTURE.labOperator)}` } });
  assert.equal(labDirect.status, 200); assert.deepEqual(await labDirect.json(), [], 'Even AAL2 lab users cannot bypass the wholesale API projection through direct REST');
  const crop = assets.find(asset => asset.kind === 'crop'); assert.ok(crop);
  const objectUrl = `${fixtureUrl}/storage/v1/object/lab-production-workflow-files/${crop.storage_key}`;
  const saved = await fetch(objectUrl, { headers: serviceHeaders }); assert.equal(saved.status, 200); const backup = Buffer.from(await saved.arrayBuffer());
  const damaged = Buffer.from(backup); damaged[0] ^= 1;
  const replace = bytes => fetch(objectUrl, { method: 'POST', headers: { ...serviceHeaders, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: bytes });
  try {
    assert.equal((await replace(damaged)).status, 200);
    const denied = await call(`/api/dashboard/lab-production-assets?assetId=${crop.id}&audience=studio`);
    assert.equal(denied.status, 409); assert.equal(denied.body.code, 'PRODUCTION_INTEGRITY');
  } finally { assert.equal((await replace(backup)).status, 200); }
  assert.equal(digest(Buffer.from(await (await fetch(objectUrl, { headers: serviceHeaders })).arrayBuffer())), crop.sha256, 'Corruption simulation restores the exact synthetic derivative');
  assert.equal(JSON.stringify({ jobs: await rest('lab_production_jobs'), assets: await rest('lab_production_assets'), galleries: await rest('lab_production_galleries') }), registryBefore, 'Rejected uploads, foreign links and failed integrity checks mutate no saved data');
});
