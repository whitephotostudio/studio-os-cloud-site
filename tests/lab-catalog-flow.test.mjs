import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import test from 'node:test';
import { createLabDatabase, LAB_FIXTURE, fixtureToken } from '../scripts/lab-system-fixture.mjs';

const row = (sku = 'P-5X7', costCents = 240) => ({ sku, name: 'Lab uploaded print', category: 'prints', size: '5x7', finish: 'Lustre', costCents, currency: 'CAD', widthInches: 5, heightInches: 7, popular: true });
async function role(db, name, user, action) {
  assert.ok(['service_role', 'authenticated', 'anon'].includes(name));
  return db.transaction(async tx => {
    await tx.exec(`set local role ${name}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)", [user || '', name]);
    return action(tx);
  });
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('actual catalog RPC is atomic, owner scoped, case insensitive, idempotent, and preserves sheet prices and product identity', async () => {
  const db = await createLabDatabase();
  try {
    const labId = randomUUID();
    await db.query("insert into studio_labs(id,slug,name,country_code,city,region,currency) values ($1,'catalog-test','Catalog test lab','CA','Fixture city','Fixture region','CAD')", [labId]);
    await db.query("insert into lab_memberships(lab_id,user_id,role) values ($1,$2,'owner')", [labId, LAB_FIXTURE.owner]);
    const imports = () => db.query('select * from lab_catalog_imports where lab_id=$1 order by catalog_version', [labId]);
    const products = () => db.query('select * from studio_lab_catalog where lab_id=$1 order by sku', [labId]);
    const version = async () => (await db.query('select catalog_version from studio_labs where id=$1', [labId])).rows[0].catalog_version;
    const apply = (rows, expectedVersion, requestId = randomUUID(), actor = LAB_FIXTURE.owner, target = labId) => role(db, 'service_role', null, tx => tx.query('select apply_lab_catalog_import($1,$2,$3,$4::jsonb,$5,$6,$7) as result', [actor, target, expectedVersion, JSON.stringify(rows), 'Synthetic lab CSV', digest(rows), requestId]));
    await assert.rejects(() => apply([row(), { ...row('BAD'), costCents: -1 }], 0), /LAB_IMPORT_INVALID_ROW/);
    assert.equal((await products()).rows.length, 0, 'A valid earlier row is rolled back with an invalid later row');
    assert.equal((await imports()).rows.length, 0);
    assert.equal(await version(), 0);
    await assert.rejects(() => apply([row('CASE'), row('case')], 0), /LAB_IMPORT_DUPLICATE_SKU/);
    await assert.rejects(() => apply([row('TRIM'), row(' trim ')], 0), /LAB_IMPORT_DUPLICATE_SKU/, 'SQL normalizes duplicate SKUs the same way as insertion');
    const requestId = randomUUID();
    const initial = [row('P-5X7', 240), { ...row('P-8X10', 640), size: '8x10', widthInches: 8, heightInches: 10 }];
    const first = (await apply(initial, 0, requestId)).rows[0].result;
    assert.equal(first.catalogVersion, 1);
    const savedProducts = (await products()).rows;
    assert.equal(savedProducts.length, 2);
    assert.equal(savedProducts.every(p => p.verified === false && p.cost_source === 'lab_upload'), true);
    const replay = (await apply(initial, 0, requestId)).rows[0].result;
    assert.equal(replay.id, first.id);
    assert.equal(replay.replayed, true);
    assert.equal((await imports()).rows.length, 1);
    await assert.rejects(() => apply([row('CHANGED')], 1, requestId), /LAB_IMPORT_REQUEST_CONFLICT/);
    assert.equal(await version(), 1);

    const sheetId = randomUUID(), sheet = { name: 'Existing photographer prices', labId, currency: 'CAD', pricing: { markupPercent: 100, rounding: 'none' },
      items: [{ catalogProductId: savedProducts[0].id, retailCents: 1799, enabled: true }], packages: [], shipping: { mode: 'lab', feeCents: 0, title: 'Lab shipping' }, terms: '', assignments: [] };
    await role(db, 'service_role', null, tx => tx.query('select save_lab_price_sheet($1,$2,0,$3::jsonb,$4)', [LAB_FIXTURE.owner, sheetId, JSON.stringify(sheet), 'create']));
    const secondRequest = randomUUID(), replacement = [{ ...row('p-5x7', 350), name: 'Updated print name' }, initial[1]];
    const attempts = await Promise.all([apply(replacement, 1, secondRequest), apply(replacement, 1, secondRequest)]);
    assert.equal(attempts[0].rows[0].result.id, attempts[1].rows[0].result.id);
    assert.equal((await imports()).rows.length, 2, 'Concurrent idempotent retries commit once');
    const replaced = (await products()).rows;
    assert.equal(replaced.find(p => p.sku.toLowerCase() === 'p-5x7').id, savedProducts.find(p => p.sku === 'P-5X7').id);
    assert.equal(replaced.find(p => p.sku.toLowerCase() === 'p-5x7').cost_cents, 350);
    const persistedSheet = (await db.query('select document from lab_price_sheets where id=$1', [sheetId])).rows[0].document;
    assert.deepEqual(persistedSheet, sheet, 'Catalog edits preserve photographer retail prices and references');
    const raced = await Promise.allSettled([apply([row('RACE-A')], 2), apply([row('RACE-B')], 2)]);
    assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(raced.find(result => result.status === 'rejected').reason.message, /LAB_IMPORT_VERSION_CONFLICT/);
    assert.equal(await version(), 3);
    const beforeHeldProducts = (await products()).rows;
    const beforeHeldImports = (await imports()).rows;
    await db.query("update studio_labs set status='paused',catalog_verified=true where id=$1", [labId]);
    await assert.rejects(() => apply([row('MUST-NOT-REPLACE')], 3), /LAB_IMPORT_ACTIVE_CATALOG_HELD/);
    assert.equal(await version(), 3, 'A paused verified catalog keeps its version');
    assert.deepEqual((await products()).rows, beforeHeldProducts, 'Paused verified catalog replacement changes no products');
    assert.deepEqual((await imports()).rows, beforeHeldImports, 'Paused verified catalog rejection creates no audit receipt');

    const gta = (await db.query("select id from studio_labs where slug='gta-imaging'")).rows[0];
    await assert.rejects(() => apply([row('GTA-TEST')], 0, randomUUID(), LAB_FIXTURE.owner, gta.id), /LAB_IMPORT_FORBIDDEN/);
    await apply([row('GTA-TEST')], 0, randomUUID(), LAB_FIXTURE.admin, gta.id);
    const gtaProducts = (await db.query('select active,cost_source from studio_lab_catalog where lab_id=$1', [gta.id])).rows;
    assert.equal(gtaProducts.filter(p => p.cost_source === 'screenshot_reference').every(p => p.active === false), true, 'Reference samples are disabled after a genuine file import');
    const gtaState = (await db.query('select status,intake_enabled,catalog_verified,catalog_version from studio_labs where id=$1', [gta.id])).rows[0];
    assert.deepEqual(gtaState, { status: 'setup', intake_enabled: false, catalog_verified: false, catalog_version: 1 });
    await assert.rejects(() => role(db, 'authenticated', LAB_FIXTURE.owner, tx => tx.query('select * from lab_catalog_imports')), undefined, 'Wholesale audit snapshots are not readable by browser sessions');
    await assert.rejects(() => role(db, 'authenticated', LAB_FIXTURE.admin, tx => tx.query('select * from lab_catalog_imports')), undefined, 'Admin UI must use its authenticated, MFA checked API');
    await assert.rejects(() => role(db, 'authenticated', LAB_FIXTURE.owner, tx => tx.query('select apply_lab_catalog_import($1,$2,3,$3::jsonb,$4,$5,$6)', [LAB_FIXTURE.owner, labId, JSON.stringify([row()]), 'Raw browser RPC', digest([row()]), randomUUID()])));
  } finally { await db.close(); }
});

const origin = process.env.LAB_SYSTEM_HTTP_ORIGIN;
test('actual Next catalog preview/import requires admin MFA and rejects partial or stale files without changing retail drafts', { skip: !origin }, async () => {
  assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  const call = async (body, actor = LAB_FIXTURE.admin, path = '/api/dashboard/lab-catalog') => {
    const response = await fetch(new URL(path, origin), { method: body ? 'POST' : 'GET', headers: { Origin: new URL(origin).origin, Authorization: `Bearer ${fixtureToken(actor)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  const ordinary = await call(undefined, LAB_FIXTURE.owner);
  assert.equal(ordinary.status, 401, 'Unenrolled studio owners cannot skip the importer MFA gate');
  const setup = await call();
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  assert.equal(setup.body.mayCreateLab, true);
  const created = await call({ action: 'createLab', name: 'HTTP synthetic catalog lab', countryCode: 'CA', city: 'Fixture city', region: 'Fixture region', currency: 'CAD' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const labId = created.body.labId;
  const csv = 'sku,name,category,size,finish,wholesale_price,currency,popular,prints_per_unit\r\nHTTP-5X7,HTTP Print,Prints,5x7,Lustre,2.40,CAD,yes,1\r\nHTTP-8X10,HTTP Pair of 8x10 Prints,Prints,8x10,Lustre,6.40,CAD,yes,2\r\n';
  const preview = await call({ action: 'preview', labId, csv });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.preview.rows.length, 2);
  assert.deepEqual(preview.body.preview.issues, []);
  assert.deepEqual(preview.body.preview.rows.map(row => row.printsPerUnit), [1, 2]);
  const requestId = randomUUID(), command = { action: 'import', labId, csv, expectedVersion: 0, requestId, sourceName: 'Synthetic catalog.csv' };
  const imported = await call(command);
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.receipt.catalogVersion, 1);
  const replay = await call(command);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.receipt.id, imported.body.receipt.id);
  assert.equal(replay.body.receipt.replayed, true);
  const invalid = await call({ ...command, requestId: randomUUID(), expectedVersion: 1, csv: csv.replace('6.40', '-6.40') });
  assert.equal(invalid.status, 400);
  const stale = await call({ ...command, requestId: randomUUID() });
  assert.equal(stale.status, 409);
  const reload = await call();
  assert.equal(reload.body.labs.find(lab => lab.id === labId).catalogVersion, 1);
  assert.equal(reload.body.labs.find(lab => lab.id === labId).status, 'setup');
  const workspace = await call(undefined, LAB_FIXTURE.owner, '/api/dashboard/labs');
  const products = workspace.body.workspace.catalog.filter(product => product.labId === labId);
  assert.equal(products.length, 2);
  assert.equal(products.every(product => !product.verified && product.costSource === 'lab_upload'), true);
  assert.equal(products.find(product => product.sku === 'HTTP-5X7').printsPerUnit, 1);
  assert.equal(products.find(product => product.sku === 'HTTP-8X10').printsPerUnit, 2);
});
