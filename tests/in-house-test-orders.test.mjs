import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import crypto from 'node:crypto';
import ts from 'typescript';
import { z } from 'zod';
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
const orderValidation = load('lib/labs/in-house-orders-validation.ts', { 'node:crypto': crypto, zod: { z }, './validation': validation });
const token = () => crypto.randomBytes(32).toString('hex');
const digest = orderValidation.inHouseTestTokenHash;
const uuid = () => crypto.randomUUID();
const OLD_TABLES = ['schools', 'projects', 'packages', 'package_profiles', 'orders', 'studio_labs', 'studio_lab_catalog', 'lab_price_sheets', 'lab_order_assets', 'lab_orders', 'lab_order_events', 'in_house_price_sheets'];
const NEW_TABLES = ['in_house_test_galleries', 'in_house_test_orders', 'in_house_test_order_events'];
const entry = (overrides = {}) => ({ id: 'synthetic-portrait-package', sourceKey: 'packages.synthetic-portrait-package', section: 'package', name: 'Synthetic 1 large and 2 small portraits', retailCents: 4299, active: true, category: 'package', contents: [{ name: '5x7 Lustre', qty: 2 }, { name: '8x10 Lustre', qty: 1 }], original: { synthetic: true }, ...overrides });
function syntheticSheet(overrides = {}) {
  const sourceSnapshot = { profile: { id: 'synthetic-in-house-order-' + uuid(), name: 'Synthetic test-only retail source' }, packages: [{ name: 'Invented portrait package', retailCents: 4299, contents: [{ name: '8x10 Lustre', qty: 1 }, { name: '5x7 Lustre', qty: 2 }] }] };
  return { name: 'Synthetic private in-house copy', studioName: 'Synthetic test studio', currency: 'CAD', source: { profileId: sourceSnapshot.profile.id, profileName: sourceSnapshot.profile.name, contentHash: sheetValidation.inHouseSourceHash(sourceSnapshot) }, entries: [entry(), entry({ id: 'synthetic-disabled', sourceKey: 'packages.disabled', active: false }), entry({ id: 'synthetic-digital', sourceKey: 'packages.digital', contents: [{ name: 'Digital', qty: 1 }] })], warnings: [], tax: { enabled: true, percent: 13, label: 'Reference tax only' }, sourceSnapshot, ...overrides };
}
const assets = () => [
  { id: 'sample-8x10', filename: 'SYNTHETIC-8x10.jpg', widthInches: 8, heightInches: 10, widthPixels: 2400, heightPixels: 3000, sha256: 'a'.repeat(64), byteSize: 1234, quantity: 1 },
  { id: 'sample-5x7', filename: 'SYNTHETIC-5x7.jpg', widthInches: 5, heightInches: 7, widthPixels: 1500, heightPixels: 2100, sha256: 'b'.repeat(64), byteSize: 1234, quantity: 2 },
];
async function asRole(db, role, user, action) {
  assert.ok(['service_role', 'authenticated', 'anon'].includes(role));
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)", [user || '', role, JSON.stringify({ sub: user, role, aal: 'aal2' })]);
    return action(tx);
  });
}
async function callRpc(db, name, args, cast = []) {
  assert.match(name, /^[a-z_]+$/);
  return asRole(db, 'service_role', null, async tx => (await tx.query(`select ${name}(${args.map((_, i) => `$${i + 1}${cast[i] ? '::' + cast[i] : ''}`).join(',')}) as result`, args.map(value => value && typeof value === 'object' ? JSON.stringify(value) : value))).rows[0].result);
}
async function snapshots(db, tables = OLD_TABLES) {
  const snapshot = {};
  for (const table of tables) snapshot[table] = (await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) as rows from ${table} t`)).rows[0].rows;
  return JSON.stringify(snapshot);
}
async function seedCanaries(db) {
  await seedLegacyLabCanaries(db);
  const existingSheet = { name: 'Existing synthetic partner price sheet', labId: LAB_FIXTURE.lab, currency: 'CAD', pricing: { markupPercent: 100, rounding: 'none' }, items: [{ catalogProductId: LAB_FIXTURE.productA, retailCents: 1234, enabled: true }], packages: [], shipping: { mode: 'pickup', feeCents: 0, title: 'Pickup' }, terms: 'Existing synthetic terms', assignments: [] };
  await callRpc(db, 'save_lab_price_sheet', [LAB_FIXTURE.owner, uuid(), 0, existingSheet, 'create'], ['', '', '', 'jsonb', '']);
  await importSheet(db, syntheticSheet({ name: 'Existing synthetic private price copy' }));
  const assetId = uuid();
  await db.query(`insert into lab_order_assets(id,photographer_id,lab_id,filename,storage_key,sha256,width_pixels,height_pixels,content_type,byte_size,ready) values($1,$2,$3,'Synthetic existing partner order.jpg',$4,$5,600,400,'image/jpeg',120,true)`, [assetId, LAB_FIXTURE.photographer, LAB_FIXTURE.lab, `synthetic-existing/${assetId}.jpg`, 'c'.repeat(64)]);
  await callRpc(db, 'submit_lab_order', [LAB_FIXTURE.owner, uuid(), { labId: LAB_FIXTURE.lab, reference: 'Existing synthetic partner order', notes: '', delivery: { mode: 'pickup', name: 'Synthetic studio', address: '' }, items: [{ catalogProductId: LAB_FIXTURE.orderProduct, assetId, quantity: 1 }] }], ['', '', 'jsonb']);
}
async function importSheet(db, source = syntheticSheet(), owner = LAB_FIXTURE.owner) {
  return callRpc(db, 'save_in_house_price_sheet', [owner, 'import', uuid(), 0, source], ['', '', '', '', 'jsonb']);
}
async function createGallery(db, sheet, opts = {}) {
  const values = { owner: LAB_FIXTURE.owner, requestId: uuid(), entryId: 'synthetic-portrait-package', name: 'Synthetic private test gallery', accessToken: token(), assets: assets(), ...opts };
  const result = await callRpc(db, 'create_in_house_test_gallery', [values.owner, values.requestId, sheet.id, sheet.version, values.entryId, values.name, digest(values.accessToken), values.assets], ['', '', '', '', '', '', '', 'jsonb']);
  return { ...values, result, id: result.id };
}
async function submit(db, gallery, opts = {}) {
  const values = { requestId: uuid(), receiptToken: token(), offerId: gallery.result.document.offer.id, photoId: orderValidation.IN_HOUSE_TEST_PHOTO_ID, quantity: 2, accessToken: gallery.accessToken, ...opts };
  const result = await callRpc(db, 'submit_in_house_test_order', [gallery.id, digest(values.accessToken), values.requestId, digest(values.receiptToken), values.offerId, values.photoId, values.quantity]);
  return { ...values, result, id: result.id };
}
const receipt = (db, rawToken) => callRpc(db, 'read_in_house_test_receipt', [digest(rawToken)]);
const manage = (db, gallery, version, action, rawToken = '') => callRpc(db, 'manage_in_house_test_gallery', [LAB_FIXTURE.owner, gallery.id, version, action, rawToken ? digest(rawToken) : null]);
const transition = (db, order, version, status, requestId = uuid(), owner = LAB_FIXTURE.owner) => callRpc(db, 'transition_in_house_test_order', [owner, order.id, version, requestId, status]);

// No prices or identifiers in these fixtures originate from a real studio.
test('first in-house rehearsal accepts only the exact active recorded print package', () => {
  const eligible = orderValidation.eligibleInHouseTestOffer(entry());
  assert.deepEqual(eligible, { id: entry().id, name: entry().name, retailCents: 4299, contents: [{ name: '8x10 Lustre', qty: 1 }, { name: '5x7 Lustre', qty: 2 }] });
  for (const patch of [{ active: false }, { section: undefined }, { section: 'individual' }, { retailCents: 0 }, { retailCents: -1 }, { retailCents: 4.299 }, { retailCents: 100_000_001 }, { contents: [] }, { contents: [{ name: '8x10 Lustre', qty: 1 }, { name: '5x7 Lustre', qty: 1 }] }, { contents: [{ name: '8x10 Lustre', qty: 1 }, { name: '5x7 Lustre', qty: 2, finish: 'Lustre' }] }, { contents: [{ name: '8×10 Lustre', qty: 1 }, { name: '5x7 Lustre', qty: 2 }] }, { contents: [{ name: '8x10 Lustre', qty: 1 }, { name: '8x10 Lustre', qty: 1 }] }, { contents: [...entry().contents, { name: 'Digital', qty: 1 }] }]) assert.equal(orderValidation.eligibleInHouseTestOffer(entry(patch)), null, JSON.stringify(patch));
  const misleading = entry({ name: 'Name cannot authorize contents', contents: [{ name: 'Wallets', qty: 8 }] });
  assert.equal(orderValidation.eligibleInHouseTestOffer(misleading), null);
});

test('strict action validation rejects client-controlled prices, ownership, files, identity and invalid quantities', () => {
  const create = { action: 'create_gallery', requestId: uuid(), sheetId: uuid(), expectedSheetVersion: 1, entryId: entry().id, name: 'Synthetic gallery', accessToken: token() };
  assert.deepEqual(orderValidation.parseInHouseTestOwnerAction(create), create);
  for (const fields of [{ retailCents: 1 }, { currency: 'USD' }, { taxMinor: 0 }, { photographerId: LAB_FIXTURE.otherPhotographer }, { assets: assets() }, { expiresAt: '2099-01-01' }, { name: 'Hidden\nnewline' }, { expectedSheetVersion: 0 }, { accessToken: 'guessable' }]) assert.throws(() => orderValidation.parseInHouseTestOwnerAction({ ...create, ...fields }));
  const parent = { action: 'submit', galleryId: uuid(), accessToken: token(), requestId: uuid(), receiptToken: token(), offerId: entry().id, photoId: orderValidation.IN_HOUSE_TEST_PHOTO_ID, quantity: 2 };
  assert.deepEqual(orderValidation.parseInHouseTestParentAction(parent), parent);
  for (const fields of [{ subtotalMinor: 1 }, { currency: 'USD' }, { status: 'completed' }, { galleryName: 'Spoof' }, { email: 'parent@example.test' }, { quantity: 0 }, { quantity: 11 }, { quantity: 1.1 }, { photoId: 'another-photo' }, { receiptToken: token().toUpperCase() }, { delivery: 'ship_to_client' }]) assert.throws(() => orderValidation.parseInHouseTestParentAction({ ...parent, ...fields }));
  assert.equal(digest('a'.repeat(64)), crypto.createHash('sha256').update('a'.repeat(64)).digest('hex'));
  assert.notEqual(digest('a'.repeat(64)), 'a'.repeat(64));
  assert.deepEqual(orderValidation.IN_HOUSE_TEST_STATUSES.map(orderValidation.nextInHouseTestStatus), ['accepted', 'in_production', 'ready', 'completed', null]);
});

test('in-house test migration and full order lifecycle keep existing schools, retail copies and partner orders byte exact', async () => {
  let beforeMigration;
  const db = await createLabDatabase({ beforeInHouseTestOrdersMigration: async database => { await seedCanaries(database); beforeMigration = await snapshots(database); } });
  try {
    assert.ok(beforeMigration, 'Fixture must run the before-migration preservation hook');
    assert.equal(await snapshots(db), beforeMigration);
    assert.ok(Object.values(JSON.parse(beforeMigration)).every(rows => rows.length > 0), 'Every one of the twelve preserved tables has an existing canary record');
    const source = syntheticSheet(), sheet = await importSheet(db, source), frozenBefore = await snapshots(db);
    const gallery = await createGallery(db, sheet);
    assert.equal(gallery.result.version, 1); assert.equal(gallery.result.replayed, false);
    const parentView = await callRpc(db, 'read_in_house_test_gallery', [gallery.id, digest(gallery.accessToken)]);
    assert.equal(parentView.offer.retailCents, 4299);
    assert.deepEqual(parentView.offer.contents, [{ name: '8x10 Lustre', qty: 1 }, { name: '5x7 Lustre', qty: 2 }]);
    assert.equal(JSON.stringify(parentView).includes('sourceSnapshot'), false);
    assert.equal(JSON.stringify(parentView).includes('contentHash'), false);
    assert.equal(JSON.stringify(parentView).includes(entry().id), false);
    assert.equal(JSON.stringify(parentView).includes(source.source.profileId), false);
    const order = await submit(db, gallery);
    assert.equal(order.result.status, 'submitted'); assert.equal(order.result.version, 1);
    const snap = order.result.snapshot;
    assert.equal(snap.quantity, 2); assert.equal(snap.subtotalMinor, 8598);
    assert.equal(snap.taxMinor, 0); assert.equal(snap.shippingMinor, 0); assert.equal(snap.paymentCollectedMinor, 0);
    assert.equal(snap.fulfillment, 'in_house'); assert.equal(snap.delivery, 'pickup'); assert.equal(snap.testOnly, true);
    assert.deepEqual(snap.assets.map(row => [row.id, row.quantity]), [['sample-8x10', 2], ['sample-5x7', 4]]);
    assert.deepEqual(order.result.events.map(row => row.status), ['submitted']);
    const ownerRow = (await db.query('select * from in_house_test_orders where id=$1', [order.id])).rows[0];
    assert.deepEqual(ownerRow.snapshot.source, { sheetId: sheet.id, sheetVersion: 1, entryId: entry().id, sourceHash: source.source.contentHash, sourceProfileId: source.source.profileId });
    assert.equal('source' in snap, false, 'Parent receipt omits private source identifiers');
    for (const [status, version] of [['accepted', 1], ['in_production', 2], ['ready', 3], ['completed', 4]]) {
      const updated = await transition(db, order, version, status);
      assert.equal(updated.status, status); assert.equal(updated.version, version + 1);
      const parentReceipt = await receipt(db, order.receiptToken);
      assert.equal(parentReceipt.status, status); assert.equal(parentReceipt.version, version + 1);
      assert.deepEqual(parentReceipt.snapshot, snap);
    }
    const final = await receipt(db, order.receiptToken);
    assert.deepEqual(final.events.map(row => row.status), ['submitted', 'accepted', 'in_production', 'ready', 'completed']);
    assert.deepEqual(final.events.map(row => row.version), [1, 2, 3, 4, 5]);
    await assert.rejects(() => transition(db, order, 5, 'accepted'));
    assert.equal(await snapshots(db), frozenBefore, 'Creating galleries, parent orders, and in-house production statuses cannot mutate any existing table');
    const beforeCopyEdit = JSON.stringify((await db.query('select snapshot from in_house_test_orders where id=$1', [order.id])).rows[0].snapshot);
    const newEdit = { name: 'Renamed current private copy', entries: source.entries.map(row => ({ id: row.id, retailCents: row.retailCents + 777, active: row.active })) };
    await callRpc(db, 'save_in_house_price_sheet', [LAB_FIXTURE.owner, 'save', sheet.id, 1, newEdit], ['', '', '', '', 'jsonb']);
    assert.equal(JSON.stringify((await db.query('select snapshot from in_house_test_orders where id=$1', [order.id])).rows[0].snapshot), beforeCopyEdit, 'Submitted snapshot stays frozen after later copied-sheet edits');
    assert.equal((await callRpc(db, 'read_in_house_test_gallery', [gallery.id, digest(gallery.accessToken)])).offer.retailCents, 4299, 'Test gallery retains its explicit initial offer');
  } finally { await db.close(); }
});

test('database guards private gallery ownership, RLS, direct writes and server-only RPC authority', async () => {
  const db = await createLabDatabase();
  try {
    const sheet = await importSheet(db), gallery = await createGallery(db, sheet), order = await submit(db, gallery);
    for (const table of NEW_TABLES) {
      assert.equal((await asRole(db, 'authenticated', LAB_FIXTURE.owner, tx => tx.query(`select id from ${table}`))).rows.length, 1);
      for (const actor of [LAB_FIXTURE.otherOwner, LAB_FIXTURE.labOwner, LAB_FIXTURE.labOperator, LAB_FIXTURE.foreignLabOwner, LAB_FIXTURE.admin]) assert.equal((await asRole(db, 'authenticated', actor, tx => tx.query(`select id from ${table}`))).rows.length, 0, `${actor} cannot read ${table}`);
      await assert.rejects(() => asRole(db, 'anon', null, tx => tx.query(`select id from ${table}`)), error => error.code === '42501');
      for (const role of ['authenticated', 'service_role']) {
        await assert.rejects(() => asRole(db, role, LAB_FIXTURE.owner, tx => tx.query(`insert into ${table} select * from ${table}`)), error => error.code === '42501');
        await assert.rejects(() => asRole(db, role, LAB_FIXTURE.owner, tx => tx.query(`delete from ${table}`)), error => error.code === '42501');
        await assert.rejects(() => asRole(db, role, LAB_FIXTURE.owner, tx => tx.query(`update ${table} set id=id`)), error => error.code === '42501');
      }
    }
    const forbidden = [
      ['create_in_house_test_gallery', [LAB_FIXTURE.owner, uuid(), sheet.id, 1, entry().id, 'Forged', digest(token()), JSON.stringify(assets())], ['', '', '', '', '', '', '', 'jsonb']],
      ['read_in_house_test_gallery', [gallery.id, digest(gallery.accessToken)]],
      ['submit_in_house_test_order', [gallery.id, digest(gallery.accessToken), uuid(), digest(token()), entry().id, orderValidation.IN_HOUSE_TEST_PHOTO_ID, 1]],
      ['read_in_house_test_receipt', [digest(order.receiptToken)]],
      ['manage_in_house_test_gallery', [LAB_FIXTURE.owner, gallery.id, 1, 'revoke', null]],
      ['transition_in_house_test_order', [LAB_FIXTURE.owner, order.id, 1, uuid(), 'accepted']],
    ];
    for (const [rpc, args, casts = []] of forbidden) for (const role of ['authenticated', 'anon']) await assert.rejects(() => asRole(db, role, LAB_FIXTURE.owner, tx => tx.query(`select ${rpc}(${args.map((_, i) => `$${i + 1}${casts[i] ? '::' + casts[i] : ''}`).join(',')})`, args)), error => error.code === '42501', `${role} cannot directly execute ${rpc}`);
    await assert.rejects(() => createGallery(db, sheet, { owner: LAB_FIXTURE.otherOwner }));
    await assert.rejects(() => createGallery(db, sheet, { owner: LAB_FIXTURE.labOwner }));
    for (const owner of [LAB_FIXTURE.otherOwner, LAB_FIXTURE.labOwner, LAB_FIXTURE.labOperator, LAB_FIXTURE.admin]) await assert.rejects(() => transition(db, order, 1, 'accepted', uuid(), owner));
    await assert.rejects(() => callRpc(db, 'read_in_house_test_gallery', [gallery.id, digest(token())]));
    await assert.rejects(() => receipt(db, token()));
    assert.equal((await db.query('select status,version from in_house_test_orders where id=$1', [order.id])).rows[0].status, 'submitted');
  } finally { await db.close(); }
});

test('gallery, parent submission and transition retries are idempotent while changed requests conflict', async () => {
  const db = await createLabDatabase();
  try {
    const source = syntheticSheet(), sheet = await importSheet(db, source), options = { requestId: uuid(), accessToken: token() };
    const gallery = await createGallery(db, sheet, options), replay = await createGallery(db, sheet, options);
    assert.equal(replay.id, gallery.id); assert.equal(replay.result.replayed, true);
    await assert.rejects(() => createGallery(db, sheet, { ...options, name: 'Changed test name' }), /CONFLICT/);
    await assert.rejects(() => createGallery(db, sheet, { ...options, accessToken: token() }), /CONFLICT/);
    await assert.rejects(() => createGallery(db, { ...sheet, version: 2 }), /VERSION_CONFLICT/);
    const submitOptions = { requestId: uuid(), receiptToken: token(), quantity: 3 };
    const first = await submit(db, gallery, submitOptions), retried = await submit(db, gallery, submitOptions);
    assert.equal(retried.id, first.id); assert.equal(retried.result.replayed, true);
    for (const patch of [{ quantity: 2 }, { receiptToken: token() }]) await assert.rejects(() => submit(db, gallery, { ...submitOptions, ...patch }), /CONFLICT/);
    const acceptId = uuid();
    const accepted = await transition(db, first, 1, 'accepted', acceptId);
    const acceptedRetry = await transition(db, first, 1, 'accepted', acceptId);
    assert.equal(acceptedRetry.id, accepted.id); assert.equal(acceptedRetry.version, accepted.version); assert.equal(acceptedRetry.replayed, true);
    await assert.rejects(() => transition(db, first, 1, 'ready', acceptId), /CONFLICT/);
    await assert.rejects(() => transition(db, first, 1, 'in_production'), /VERSION_CONFLICT/);
    await assert.rejects(() => transition(db, first, 2, 'ready'), /TRANSITION|STATUS|INVALID/);
    assert.equal((await db.query('select count(*)::int as count from in_house_test_galleries')).rows[0].count, 1);
    assert.equal((await db.query('select count(*)::int as count from in_house_test_orders')).rows[0].count, 1);
    assert.equal((await db.query('select count(*)::int as count from in_house_test_order_events')).rows[0].count, 2);
  } finally { await db.close(); }
});

test('SQL eligibility rejects ambiguous/inactive/digital contents and cannot accept injected production assets', async () => {
  const db = await createLabDatabase();
  try {
    const cases = [{ active: false }, { section: 'individual' }, { retailCents: 0 }, { contents: [{ name: '8x10 Lustre', qty: 1 }, { name: '5x7 Lustre', qty: 3 }] }, { contents: [{ name: '8x10 Lustre', qty: 1 }, { name: '5x7 Lustre', qty: 2, finish: 'Lustre' }] }, { contents: [...entry().contents, { name: 'Digital', qty: 1 }] }];
    for (const patch of cases) {
      const sheet = await importSheet(db, syntheticSheet({ entries: [entry(patch)] }));
      await assert.rejects(() => createGallery(db, sheet), /IN_HOUSE_TEST_/);
    }
    const damagedSheet = await importSheet(db, syntheticSheet({ entries: [entry()] }));
    await db.query("update in_house_price_sheets set document=document#-'{entries,0,section}' where id=$1", [damagedSheet.id]);
    await assert.rejects(() => createGallery(db, damagedSheet), /IN_HOUSE_TEST_OFFER_UNAVAILABLE/, 'An older damaged record missing its section fails closed independently of import validation');
    const sheet = await importSheet(db);
    const numericHashAssets = JSON.stringify(assets()).replace('"' + 'a'.repeat(64) + '"', '1'.repeat(64));
    for (const altered of [numericHashAssets, assets().slice(0, 1), [...assets(), assets()[0]], assets().map((row, i) => i ? row : { ...row, filename: '../SYNTHETIC.jpg' }), assets().map((row, i) => i ? row : { ...row, sha256: 'not-a-sha' }), assets().map((row, i) => i ? row : { ...row, quantity: 2 }), assets().map((row, i) => i ? row : { ...row, widthPixels: 3000, heightPixels: 3000 }), assets().map((row, i) => i ? row : { ...row, storageKey: 'school/customer.jpg' }), assets().map((row, i) => i ? row : { ...row, byteSize: 4_000_001 })]) await assert.rejects(() => createGallery(db, sheet, { assets: altered }), /IN_HOUSE_TEST_/);
    assert.equal((await db.query('select count(*)::int as count from in_house_test_galleries')).rows[0].count, 0);
    const gallery = await createGallery(db, sheet);
    for (const patch of [{ offerId: 'synthetic-disabled' }, { offerId: 'synthetic-digital' }, { photoId: 'customer-photo' }, { quantity: 0 }, { quantity: 11 }, { accessToken: token() }]) await assert.rejects(() => submit(db, gallery, patch), /IN_HOUSE_TEST_/);
    assert.equal((await db.query('select count(*)::int as count from in_house_test_orders')).rows[0].count, 0);
  } finally { await db.close(); }
});

test('gallery rotation/revocation closes parent submission while individual receipts remain independent', async () => {
  const db = await createLabDatabase();
  try {
    const sheet = await importSheet(db), gallery = await createGallery(db, sheet), first = await submit(db, gallery), second = await submit(db, gallery);
    const firstReceipt = await receipt(db, first.receiptToken), secondReceipt = await receipt(db, second.receiptToken);
    assert.equal(firstReceipt.id, first.id); assert.equal(secondReceipt.id, second.id); assert.notEqual(firstReceipt.id, secondReceipt.id);
    assert.equal(JSON.stringify(firstReceipt).includes(second.id), false, 'A receipt capability never enumerates other customers or orders');
    assert.equal(JSON.stringify(firstReceipt).includes(second.receiptToken), false);
    assert.equal(JSON.stringify(firstReceipt).includes(gallery.accessToken), false);
    const rotatedToken = token();
    const rotated = await manage(db, gallery, 1, 'rotate', rotatedToken);
    assert.equal(rotated.version, 2);
    await assert.rejects(() => callRpc(db, 'read_in_house_test_gallery', [gallery.id, digest(gallery.accessToken)]));
    await assert.rejects(() => submit(db, gallery));
    const fresh = { ...gallery, accessToken: rotatedToken };
    assert.equal((await callRpc(db, 'read_in_house_test_gallery', [gallery.id, digest(rotatedToken)])).id, gallery.id);
    const third = await submit(db, fresh);
    assert.ok(third.id);
    await assert.rejects(() => manage(db, gallery, 1, 'revoke'), /VERSION_CONFLICT/);
    const revoked = await manage(db, gallery, 2, 'revoke');
    assert.equal(revoked.version, 3); assert.ok(revoked.revoked_at);
    await assert.rejects(() => callRpc(db, 'read_in_house_test_gallery', [gallery.id, digest(rotatedToken)]));
    await assert.rejects(() => submit(db, fresh));
    assert.equal((await receipt(db, first.receiptToken)).id, first.id, 'Revoking a gallery does not expose or destroy an existing individual receipt');
    await transition(db, first, 1, 'accepted');
    assert.equal((await receipt(db, first.receiptToken)).status, 'accepted');
    const restoredToken = token();
    const restored = await manage(db, gallery, 3, 'rotate', restoredToken);
    assert.equal(restored.version, 4); assert.equal(restored.revoked_at, null);
    assert.equal((await callRpc(db, 'read_in_house_test_gallery', [gallery.id, digest(restoredToken)])).id, gallery.id);
    await assert.rejects(() => callRpc(db, 'read_in_house_test_gallery', [gallery.id, digest(rotatedToken)]));
  } finally { await db.close(); }
});

test('gallery and order totals preserve the copied currency minor units without currency conversion or inferred tax', async () => {
  const db = await createLabDatabase();
  try {
    for (const currency of ['CAD', 'JPY', 'KWD']) {
      const sheet = await importSheet(db, syntheticSheet({ currency })), gallery = await createGallery(db, sheet), order = await submit(db, gallery);
      assert.equal(gallery.result.document.currency, currency);
      assert.equal(order.result.snapshot.currency, currency);
      assert.equal(order.result.snapshot.offer.retailCents, 4299);
      assert.equal(order.result.snapshot.subtotalMinor, 8598);
      assert.equal(order.result.snapshot.taxMinor, 0);
      assert.equal(order.result.snapshot.paymentCollectedMinor, 0);
    }
  } finally { await db.close(); }
});

test('capability expiry closes gallery access and receipts without deleting the owner production record', async () => {
  const db = await createLabDatabase();
  try {
    const sheet = await importSheet(db), gallery = await createGallery(db, sheet), order = await submit(db, gallery);
    const created = new Date(gallery.result.created_at), expires = new Date(gallery.result.expires_at);
    assert.ok(expires - created >= 6.99 * 86400000 && expires - created <= 7.01 * 86400000);
    const orderRow = (await db.query('select created_at,receipt_expires_at from in_house_test_orders where id=$1', [order.id])).rows[0];
    assert.ok(new Date(orderRow.receipt_expires_at) - new Date(orderRow.created_at) >= 29.99 * 86400000);
    // Simulate elapsed time only inside this disposable PostgreSQL fixture.
    await db.query("update in_house_test_galleries set expires_at=now()-interval '1 second' where id=$1", [gallery.id]);
    await assert.rejects(() => callRpc(db, 'read_in_house_test_gallery', [gallery.id, digest(gallery.accessToken)]));
    await assert.rejects(() => submit(db, gallery));
    assert.equal((await receipt(db, order.receiptToken)).id, order.id);
    await db.exec('alter table in_house_test_orders disable trigger user');
    try { await db.query("update in_house_test_orders set receipt_expires_at=now()-interval '1 second' where id=$1", [order.id]); }
    finally { await db.exec('alter table in_house_test_orders enable trigger user'); }
    await assert.rejects(() => receipt(db, order.receiptToken));
    assert.equal((await asRole(db, 'authenticated', LAB_FIXTURE.owner, tx => tx.query('select id from in_house_test_orders where id=$1', [order.id]))).rows.length, 1);
    await transition(db, order, 1, 'accepted');
    assert.equal((await db.query('select status from in_house_test_orders where id=$1', [order.id])).rows[0].status, 'accepted');
  } finally { await db.close(); }
});

test('rehearsal allocation and receipt reuse limits are enforced in SQL while successful retries remain available', async () => {
  const db = await createLabDatabase();
  try {
    const sheet = await importSheet(db), galleryOptions = { requestId: uuid(), accessToken: token() }, gallery = await createGallery(db, sheet, galleryOptions);
    const original = await submit(db, gallery, { quantity: 10 });
    assert.equal(original.result.snapshot.subtotalMinor, 42990);
    assert.deepEqual(original.result.snapshot.assets.map(row => row.quantity), [10, 20]);
    await assert.rejects(() => submit(db, gallery, { receiptToken: original.receiptToken }), /REQUEST_CONFLICT/);
    for (let i = 0; i < 19; i++) await submit(db, gallery);
    await assert.rejects(() => submit(db, gallery), /IN_HOUSE_TEST_LIMIT/);
    const retry = await submit(db, gallery, { quantity: original.quantity, requestId: original.requestId, receiptToken: original.receiptToken });
    assert.equal(retry.id, original.id); assert.equal(retry.result.replayed, true);
    await assert.rejects(() => createGallery(db, sheet, { accessToken: gallery.accessToken }), /REQUEST_CONFLICT/);
    for (let i = 0; i < 29; i++) await createGallery(db, sheet);
    await assert.rejects(() => createGallery(db, sheet), /IN_HOUSE_TEST_LIMIT/);
    assert.equal((await createGallery(db, sheet, galleryOptions)).result.replayed, true);
    const foreignSheet = await importSheet(db, syntheticSheet(), LAB_FIXTURE.otherOwner);
    assert.ok((await createGallery(db, foreignSheet, { owner: LAB_FIXTURE.otherOwner })).id, 'Another studio has its own independent allocation');
    assert.equal((await db.query('select count(*)::int as count from in_house_test_galleries where photographer_id=$1', [LAB_FIXTURE.photographer])).rows[0].count, 30);
    assert.equal((await db.query('select count(*)::int as count from in_house_test_orders where gallery_id=$1', [gallery.id])).rows[0].count, 20);
  } finally { await db.close(); }
});

const starters = load('lib/labs/starters.ts', { './money': money });
const labServer = load('lib/labs/server.ts', { 'node:crypto': crypto, './validation': validation, './money': money, './starters': starters, '@/lib/dashboard-auth': {}, '@/lib/rate-limit': {} });
function serviceFor(db, record = []) {
  const functions = {
    create_in_house_test_gallery: ['p_user_id', 'p_request_id', 'p_sheet_id', 'p_expected_sheet_version', 'p_entry_id', 'p_name', 'p_token_hash', 'p_assets'],
    manage_in_house_test_gallery: ['p_user_id', 'p_gallery_id', 'p_expected_version', 'p_action', 'p_token_hash'],
    read_in_house_test_gallery: ['p_gallery_id', 'p_token_hash'],
    submit_in_house_test_order: ['p_gallery_id', 'p_token_hash', 'p_request_id', 'p_receipt_hash', 'p_offer_id', 'p_photo_id', 'p_quantity'],
    read_in_house_test_receipt: ['p_receipt_hash'],
    transition_in_house_test_order: ['p_user_id', 'p_order_id', 'p_expected_version', 'p_request_id', 'p_status'],
  };
  return { from(table) {
    assert.match(table, /^[a-z_]+$/);
    const filters = [], values = [], orders = []; let limit = 1000, single = false;
    const field = value => { assert.match(value, /^[a-z_]+$/); return '"' + value + '"'; };
    const query = { select() { return query; }, eq(key, value) { values.push(value); filters.push(`${field(key)}=$${values.length}`); return query; }, in(key, value) { values.push(value); filters.push(`${field(key)}=any($${values.length}::uuid[])`); return query; }, order(key, options = {}) { orders.push(`${field(key)} ${options.ascending === false ? 'desc' : 'asc'}`); return query; }, limit(value) { limit = value; return query; }, maybeSingle() { single = true; return query; },
      then(resolve, reject) { record.push({ kind: 'query', table, filters: [...filters], values: structuredClone(values), limit }); return db.query(`select * from "${table}"${filters.length ? ' where ' + filters.join(' and ') : ''}${orders.length ? ' order by ' + orders.join(',') : ''} limit ${limit}`, values).then(result => ({ data: single ? result.rows[0] || null : result.rows, error: null }), error => ({ data: null, error: { code: error.code, message: error.message } })).then(resolve, reject); } }; return query;
  }, async rpc(name, args) {
    assert.ok(functions[name], name); assert.deepEqual(Object.keys(args).sort(), [...functions[name]].sort()); record.push({ kind: 'rpc', name, args: structuredClone(args) });
    try { return { data: await callRpc(db, name, functions[name].map(key => args[key]), name === 'create_in_house_test_gallery' ? ['', '', '', '', '', '', '', 'jsonb'] : []), error: null }; }
    catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  } };
}
function serverFor(service, protection = { trusted: true, quota: { allowed: true } }) {
  return load('lib/labs/in-house-orders-server.ts', {
    '@/lib/dashboard-auth': { createDashboardServiceClient: () => { protection.clientCreated = (protection.clientCreated || 0) + 1; return service; }, isTrustedDashboardRequest: () => protection.trusted },
    '@/lib/rate-limit': { getClientIp: () => '198.51.100.25', rateLimit: async (identity, options) => { protection.lastQuota = { identity, ...options }; return protection.quota; } },
    './in-house-sample-assets': { inHouseSampleAssets: async () => assets() }, './server': labServer, './validation': validation, './in-house-orders-validation': orderValidation,
  });
}
const accessFor = (service, userId = LAB_FIXTURE.owner, photographerId = LAB_FIXTURE.photographer) => ({ service, userId, photographerId });
const parentRequest = () => new Request('https://pilot.example.test/api/labs-pilot/in-house', { method: 'POST', headers: { Origin: 'https://pilot.example.test' } });

test('server owner workspace and parent actions preserve privacy, derived totals and source scope across save/reload', async () => {
  const db = await createLabDatabase();
  try {
    const source = syntheticSheet(), imported = await importSheet(db, source), calls = [], service = serviceFor(db, calls), backend = serverFor(service), access = accessFor(service);
    const initial = await backend.loadInHouseTestWorkspace(access);
    assert.equal(initial.sheets.length, 1); assert.equal(initial.sheets[0].offers.length, 1); assert.equal(initial.sheets[0].offers[0].retailCents, 4299);
    assert.equal('sourceSnapshot' in initial.sheets[0], false);
    const create = orderValidation.parseInHouseTestOwnerAction({ action: 'create_gallery', requestId: uuid(), sheetId: imported.id, expectedSheetVersion: 1, entryId: entry().id, name: 'Synthetic private server gallery', accessToken: token() });
    const created = await backend.performInHouseTestOwnerAction(access, create);
    assert.equal(created.workspace.galleries.length, 1); assert.equal(created.gallery.id, created.workspace.galleries[0].id);
    const createRpc = calls.find(call => call.kind === 'rpc');
    assert.equal(createRpc.args.p_token_hash, digest(create.accessToken)); assert.notEqual(createRpc.args.p_token_hash, create.accessToken);
    assert.deepEqual(createRpc.args.p_assets, assets(), 'Production manifest comes from the server asset helper');
    assert.equal(JSON.stringify(created).includes(create.accessToken), false); assert.equal(JSON.stringify(created).includes(digest(create.accessToken)), false);
    const read = await backend.performInHouseTestParentAction(parentRequest(), { action: 'gallery', galleryId: created.gallery.id, accessToken: create.accessToken });
    assert.equal(read.gallery.offer.retailCents, 4299);
    const submission = { action: 'submit', galleryId: created.gallery.id, accessToken: create.accessToken, requestId: uuid(), receiptToken: token(), offerId: read.gallery.offer.id, photoId: orderValidation.IN_HOUSE_TEST_PHOTO_ID, quantity: 3 };
    const submitted = await backend.performInHouseTestParentAction(parentRequest(), submission);
    assert.equal(submitted.order.snapshot.subtotalMinor, 12897); assert.deepEqual(submitted.order.snapshot.assets.map(row => row.quantity), [3, 6]);
    assert.equal('source' in submitted.order.snapshot, false); assert.equal('galleryId' in submitted.order, false);
    const saved = await backend.performInHouseTestOwnerAction(access, { action: 'transition', orderId: submitted.order.id, expectedVersion: 1, requestId: uuid(), status: 'accepted' });
    assert.equal(saved.order.status, 'accepted'); assert.equal(saved.workspace.orders[0].status, 'accepted');
    assert.equal(saved.order.snapshot.source.sheetId, imported.id);
    const refreshed = await backend.loadInHouseTestWorkspace(access);
    assert.deepEqual(refreshed.orders[0], saved.order);
    assert.equal((await backend.performInHouseTestParentAction(parentRequest(), { action: 'receipt', receiptToken: submission.receiptToken })).order.status, 'accepted');
    assert.deepEqual(await backend.loadInHouseTestWorkspace(accessFor(service, LAB_FIXTURE.otherOwner, LAB_FIXTURE.otherPhotographer)), { sheets: [], galleries: [], orders: [] });
    await assert.rejects(() => backend.loadInHouseTestOrder(accessFor(service, LAB_FIXTURE.otherOwner, LAB_FIXTURE.otherPhotographer), saved.order.id), error => error.status === 404);
    for (const call of calls.filter(call => call.kind === 'query' && ['in_house_test_orders', 'in_house_test_galleries'].includes(call.table))) assert.ok(call.filters.some(value => value.startsWith('"photographer_id"=')), 'Every service-role owner query explicitly scopes the studio');
    const scopedEvents = calls.filter(call => call.kind === 'query' && call.table === 'in_house_test_order_events');
    assert.ok(scopedEvents.length > 0); assert.ok(scopedEvents.every(call => call.filters.some(value => value.startsWith('"order_id"=any('))));
  } finally { await db.close(); }
});

test('parent server protection fails closed before database access and explicitly strips unknown nested fields', async () => {
  const protector = { trusted: false, quota: { allowed: true } }, service = { async rpc() { throw Error('Database must not be called'); } }, backend = serverFor(service, protector);
  const action = { action: 'receipt', receiptToken: token() };
  await assert.rejects(() => backend.performInHouseTestParentAction(parentRequest(), action), error => error.status === 403 && error.code === 'IN_HOUSE_TEST_ORIGIN');
  assert.equal(protector.clientCreated, undefined); assert.equal(protector.lastQuota, undefined);
  protector.trusted = true; protector.quota = { allowed: false, unavailable: false };
  await assert.rejects(() => backend.performInHouseTestParentAction(parentRequest(), action), error => error.status === 429);
  assert.equal(protector.clientCreated, undefined); assert.equal(protector.lastQuota.failClosed, true); assert.equal(protector.lastQuota.namespace, 'in-house-test-parent');
  protector.quota = { allowed: false, unavailable: true };
  await assert.rejects(() => backend.performInHouseTestParentAction(parentRequest(), action), error => error.status === 503);
  const stamp = '2026-10-15T20:00:00Z';
  const noisy = { id: uuid(), reference: 'TEST-SYNTHETIC', status: 'submitted', version: 1, createdAt: stamp, updatedAt: stamp, photographerId: 'PRIVATE_SENTINEL', receiptHash: 'PRIVATE_SENTINEL', events: [{ id: uuid(), status: 'submitted', version: 1, createdAt: stamp, requestPayload: 'PRIVATE_SENTINEL' }], snapshot: { schemaVersion: 1, testOnly: true, galleryName: 'Synthetic', studioName: 'Synthetic', currency: 'CAD', offer: { id: entry().id, name: entry().name, retailCents: 4299, contents: entry().contents.map(row => ({ ...row, source: 'PRIVATE_SENTINEL' })), source: 'PRIVATE_SENTINEL' }, photoId: orderValidation.IN_HOUSE_TEST_PHOTO_ID, quantity: 1, subtotalMinor: 4299, taxMinor: 0, shippingMinor: 0, paymentCollectedMinor: 0, fulfillment: 'in_house', delivery: 'pickup', assets: assets().map(row => ({ ...row, storageKey: 'PRIVATE_SENTINEL' })), source: 'PRIVATE_SENTINEL' } };
  const projection = serverFor({ rpc: async () => ({ data: noisy, error: null }) });
  const result = await projection.performInHouseTestParentAction(parentRequest(), action);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
  assert.equal(JSON.stringify(result).includes(action.receiptToken), false);
  assert.equal(result.order.snapshot.taxMinor, 0); assert.equal(result.order.snapshot.paymentCollectedMinor, 0);
});

test('backend database errors preserve actionable conflict/hold status without leaking provider messages', () => {
  const backend = serverFor({});
  for (const [message, status, code] of [['IN_HOUSE_TEST_VERSION_CONFLICT', 409, 'IN_HOUSE_TEST_VERSION_CONFLICT'], ['IN_HOUSE_TEST_REQUEST_CONFLICT', 409, 'IN_HOUSE_TEST_REQUEST_CONFLICT'], ['IN_HOUSE_TEST_NOT_FOUND', 404, 'IN_HOUSE_TEST_NOT_FOUND'], ['IN_HOUSE_TEST_OFFER_UNAVAILABLE', 409, 'IN_HOUSE_TEST_OFFER_UNAVAILABLE'], ['IN_HOUSE_TEST_TRANSITION', 409, 'IN_HOUSE_TEST_TRANSITION'], ['IN_HOUSE_TEST_LIMIT', 409, 'IN_HOUSE_TEST_LIMIT'], ['IN_HOUSE_TEST_ASSETS_INVALID', 400, 'IN_HOUSE_TEST_INVALID'], ['internal password=PRIVATE_SENTINEL', 503, 'IN_HOUSE_TEST_UNAVAILABLE']]) assert.throws(() => backend.inHouseTestDatabaseError({ message }), error => error.status === status && error.code === code && !error.message.includes('PRIVATE_SENTINEL'));
});

test('pilot HTTP handlers fail closed outside the pilot, bound bodies, reject extra pricing and return private no-store headers', async () => {
  const next = { NextResponse: { json: (body, options) => Response.json(body, options) } };
  const bounded = load('lib/labs/orders-http.ts', { 'next/server': next, './orders-validation': {}, './validation': validation });
  let enabled = false, accessCalls = 0, ownerCalls = 0, parentCalls = 0, authError = null;
  const fakeBackend = { loadInHouseTestWorkspace: async () => ({ sheets: [], galleries: [], orders: [] }), performInHouseTestOwnerAction: async () => { ownerCalls++; return { replayed: false }; }, performInHouseTestParentAction: async () => { parentCalls++; return { replayed: false }; } };
  const deps = { 'next/server': next, '@/lib/labs/pilot': { isLabPilot: () => enabled }, '@/lib/labs/in-house-orders-server': fakeBackend, '@/lib/labs/in-house-orders-validation': orderValidation, '@/lib/labs/orders-http': bounded, '@/lib/labs/validation': validation, '@/lib/labs/server': { labDashboardAccess: async () => { accessCalls++; if (authError) throw authError; return {}; } } };
  const owner = load('app/api/dashboard/in-house-test-orders/route.ts', deps), parent = load('app/api/labs-pilot/in-house/route.ts', deps);
  const create = { action: 'create_gallery', requestId: uuid(), sheetId: uuid(), expectedSheetVersion: 1, entryId: entry().id, name: 'Synthetic gallery', accessToken: token() };
  const request = body => new Request('https://pilot.example.test/api/labs-pilot/in-house', { method: 'POST', headers: { Origin: 'https://pilot.example.test', 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const held = [await owner.GET(new Request('https://pilot.example.test/api/dashboard/in-house-test-orders')), await owner.POST(request(create)), await parent.POST(request({ action: 'receipt', receiptToken: token() }))];
  assert.deepEqual(held.map(result => result.status), [404, 404, 404]); assert.equal(accessCalls, 0); assert.equal(ownerCalls, 0); assert.equal(parentCalls, 0);
  enabled = true;
  const invalid = [await owner.POST(request('{')), await owner.POST(request({ ...create, retailCents: 1 })), await parent.POST(request('{')), await parent.POST(request({ action: 'receipt', receiptToken: token(), totalMinor: 1 })), await owner.POST(request('x'.repeat(orderValidation.IN_HOUSE_TEST_BODY_BYTES + 1))), await parent.POST(request('x'.repeat(orderValidation.IN_HOUSE_TEST_BODY_BYTES + 1)))];
  assert.deepEqual(invalid.map(result => result.status), [400, 400, 400, 400, 413, 413]); assert.equal(ownerCalls, 0); assert.equal(parentCalls, 0);
  const good = [await owner.GET(new Request('https://pilot.example.test/api/dashboard/in-house-test-orders')), await owner.POST(request(create)), await parent.POST(request({ action: 'receipt', receiptToken: token() }))];
  assert.deepEqual(good.map(result => result.status), [200, 200, 200]); assert.equal(ownerCalls, 1); assert.equal(parentCalls, 1);
  for (const response of [...held, ...invalid, ...good]) { assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow'); }
  authError = new validation.LabError('Sign in first', 401, 'UNAUTHORIZED');
  assert.equal((await owner.GET(new Request('https://pilot.example.test/api/dashboard/in-house-test-orders'))).status, 401);
  assert.equal((await owner.POST(request(create))).status, 401);
  assert.equal(ownerCalls, 1);
  assert.equal('GET' in parent, false, 'Capability tokens cannot be sent in a public API query string');
});

const httpOrigin = process.env.LAB_SYSTEM_HTTP_ORIGIN;
test('actual Next pilot completes a private synthetic parent-to-in-house production loop and verifies exact sample downloads', { skip: !httpOrigin }, async () => {
  assert.match(httpOrigin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  const fixtureUrl = process.env.LAB_SYSTEM_FIXTURE_URL || 'http://127.0.0.1:55471';
  assert.match(fixtureUrl, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  const call = async (path, body, actor = LAB_FIXTURE.owner, extraHeaders = {}) => {
    const response = await fetch(new URL(path, httpOrigin), { method: body === undefined ? 'GET' : 'POST', headers: { Origin: new URL(httpOrigin).origin, ...(actor ? { Authorization: `Bearer ${fixtureToken(actor)}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (path.startsWith('/api/dashboard/in-house-test-') || path.startsWith('/api/labs-pilot/in-house')) {
      assert.match(response.headers.get('cache-control') || '', /private.*no-store/);
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, body: (response.headers.get('content-type') || '').includes('application/json') ? JSON.parse(bytes.toString('utf8')) : bytes, bytes, response };
  };
  const ownerPath = '/api/dashboard/in-house-test-orders', parentPath = '/api/labs-pilot/in-house';
  const snapshotExisting = async () => {
    const current = {};
    for (const table of OLD_TABLES) {
      const result = await fetch(`${fixtureUrl}/rest/v1/${table}?select=*&order=id`, { headers: { Authorization: `Bearer ${fixtureToken(null, 'service_role')}` } });
      assert.equal(result.status, 200); current[table] = await result.json();
    }
    return JSON.stringify(current);
  };
  const source = syntheticSheet(), imported = await call('/api/dashboard/in-house-price-sheets', { action: 'import', sheet: source });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  const sheet = imported.body.sheet, before = await snapshotExisting();
  assert.equal((await call(ownerPath, undefined, null)).status, 401);
  assert.equal((await call(ownerPath, undefined, LAB_FIXTURE.labOwner)).status, 403);
  const create = { action: 'create_gallery', requestId: uuid(), sheetId: sheet.id, expectedSheetVersion: sheet.version, entryId: entry().id, name: 'Synthetic Next HTTP portrait gallery', accessToken: token() };
  const created = await call(ownerPath, create);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const gallery = created.body.gallery;
  assert.equal((await call(ownerPath, create)).body.replayed, true);
  assert.equal((await call(ownerPath, { ...create, name: 'Conflicting gallery title' })).status, 409);
  const viewed = await call(parentPath, { action: 'gallery', galleryId: gallery.id, accessToken: create.accessToken }, null);
  assert.equal(viewed.status, 200, JSON.stringify(viewed.body)); assert.equal(viewed.body.gallery.offer.retailCents, 4299);
  for (const privateValue of [entry().id, source.source.profileId, source.source.contentHash, create.accessToken, digest(create.accessToken), LAB_FIXTURE.photographer, LAB_FIXTURE.owner]) assert.equal(JSON.stringify(viewed.body).includes(privateValue), false, 'Public gallery excludes private source/owner/capability fields');
  assert.equal((await call(parentPath, { action: 'gallery', galleryId: gallery.id, accessToken: token() }, null)).status, 404);
  const submission = { action: 'submit', galleryId: gallery.id, accessToken: create.accessToken, requestId: uuid(), receiptToken: token(), offerId: viewed.body.gallery.offer.id, photoId: orderValidation.IN_HOUSE_TEST_PHOTO_ID, quantity: 2 };
  assert.equal((await call(parentPath, { ...submission, subtotalMinor: 1 }, null)).status, 400);
  assert.equal((await call(parentPath, { ...submission, quantity: 11 }, null)).status, 400);
  const submitted = await call(parentPath, submission, null);
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const order = submitted.body.order;
  assert.equal(order.snapshot.subtotalMinor, 8598); assert.deepEqual(order.snapshot.assets.map(row => row.quantity), [2, 4]);
  assert.equal(order.snapshot.taxMinor, 0); assert.equal(order.snapshot.shippingMinor, 0); assert.equal(order.snapshot.paymentCollectedMinor, 0); assert.equal('source' in order.snapshot, false);
  assert.equal((await call(parentPath, submission, null)).body.replayed, true);
  assert.equal((await call(parentPath, { ...submission, quantity: 3 }, null)).status, 409);
  const otherSubmission = await call(parentPath, { ...submission, requestId: uuid(), receiptToken: token(), quantity: 1 }, null);
  assert.equal(otherSubmission.status, 200);
  const scopedReceipt = await call(parentPath, { action: 'receipt', receiptToken: submission.receiptToken }, null);
  assert.equal(scopedReceipt.body.order.id, order.id); assert.equal(JSON.stringify(scopedReceipt.body).includes(otherSubmission.body.order.id), false);
  assert.equal((await call(ownerPath, undefined, LAB_FIXTURE.otherOwner)).body.workspace.orders.some(row => row.id === order.id), false);
  const transitionBody = (status, version, requestId = uuid()) => ({ action: 'transition', orderId: order.id, expectedVersion: version, requestId, status });
  assert.equal((await call(ownerPath, transitionBody('accepted', 1), LAB_FIXTURE.otherOwner)).status, 404);
  assert.equal((await call(ownerPath, transitionBody('accepted', 1), LAB_FIXTURE.labOwner)).status, 403);
  assert.equal((await call(ownerPath, transitionBody('ready', 1))).status, 409);
  const acceptBody = transitionBody('accepted', 1), accepted = await call(ownerPath, acceptBody);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body)); assert.equal((await call(ownerPath, acceptBody)).body.replayed, true);
  assert.equal((await call(ownerPath, transitionBody('in_production', 1))).status, 409);
  for (const [status, version] of [['in_production', 2], ['ready', 3], ['completed', 4]]) {
    const updated = await call(ownerPath, transitionBody(status, version));
    assert.equal(updated.status, 200, JSON.stringify(updated.body)); assert.equal(updated.body.order.status, status);
    const parent = await call(parentPath, { action: 'receipt', receiptToken: submission.receiptToken }, null);
    assert.equal(parent.body.order.status, status); assert.deepEqual(parent.body.order.snapshot, order.snapshot);
  }
  const manifestPath = `/api/dashboard/in-house-test-files?orderId=${order.id}&file=manifest`;
  const manifest = await call(manifestPath);
  assert.equal(manifest.status, 200, JSON.stringify(manifest.body)); assert.equal(manifest.body.totalPrintQuantity, 6); assert.equal(manifest.body.testSubtotalMinor, 8598); assert.equal(manifest.body.paymentCollectedMinor, 0);
  assert.equal(manifest.response.headers.get('content-disposition').startsWith('attachment;'), true);
  assert.equal((await call(manifestPath, undefined, LAB_FIXTURE.otherOwner)).status, 404);
  assert.equal((await call(manifestPath, undefined, LAB_FIXTURE.labOwner)).status, 403);
  for (const asset of order.snapshot.assets) {
    const file = await call(`/api/dashboard/in-house-test-files?orderId=${order.id}&file=${asset.id}`);
    assert.equal(file.status, 200); assert.equal(file.bytes.length, asset.byteSize); assert.equal(crypto.createHash('sha256').update(file.bytes).digest('hex'), asset.sha256);
    assert.equal(file.response.headers.get('content-type'), 'image/jpeg'); assert.equal(file.response.headers.get('referrer-policy'), 'no-referrer');
  }
  const rotatedToken = token();
  assert.equal((await call(ownerPath, { action: 'rotate_gallery', galleryId: gallery.id, expectedVersion: 1, accessToken: rotatedToken })).status, 200);
  assert.equal((await call(parentPath, { action: 'gallery', galleryId: gallery.id, accessToken: create.accessToken }, null)).status, 404);
  assert.equal((await call(ownerPath, { action: 'revoke_gallery', galleryId: gallery.id, expectedVersion: 2 })).status, 200);
  assert.equal((await call(parentPath, { ...submission, requestId: uuid(), receiptToken: token(), accessToken: rotatedToken }, null)).status, 404);
  const finalReceipt = await call(parentPath, { action: 'receipt', receiptToken: submission.receiptToken }, null);
  assert.equal(finalReceipt.status, 200); assert.deepEqual(finalReceipt.body.order.events.map(row => row.status), ['submitted', 'accepted', 'in_production', 'ready', 'completed']);
  const refreshed = await call(ownerPath);
  assert.equal(refreshed.body.workspace.orders.find(row => row.id === order.id).status, 'completed');
  assert.equal(await snapshotExisting(), before, 'Actual Next gallery, parent submission, status updates and downloads preserve all existing table records');
});
