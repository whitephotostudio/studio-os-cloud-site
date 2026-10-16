import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import ts from 'typescript';
import { createLabDatabase, LAB_FIXTURE, seedLegacyLabCanaries, snapshotLegacyLabFixture } from '../scripts/lab-system-fixture.mjs';

function load(file, deps = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => { if (!(name in deps)) throw Error(`Missing dependency ${name}`); return deps[name]; }, exports);
  return exports;
}
const money = load('lib/labs/money.ts');
const csvImport = load('lib/lab-catalog-import.ts', { './labs/money': money });
const starters = load('lib/labs/starters.ts', { './money': money });
const migration = fs.readFileSync(new URL('../supabase/migrations/20261016020000_lab_catalog_sell_units.sql', import.meta.url), 'utf8');

test('sell-unit migration adds nullable metadata without backfilling historical products or changing existing rows/authority', async () => {
  let beforeCatalog, beforeLegacy;
  const db = await createLabDatabase({ beforeLabOrdersMigration: async db => {
    await seedLegacyLabCanaries(db);
    beforeCatalog = (await db.query('select * from studio_lab_catalog order by id')).rows;
    beforeLegacy = await snapshotLegacyLabFixture(db);
  } });
  try {
    const after = (await db.query('select * from studio_lab_catalog order by id')).rows;
    assert.deepEqual(after.map(({ prints_per_unit, ...row }) => row), beforeCatalog);
    const gta = (await db.query("select id from studio_labs where slug='gta-imaging'")).rows[0].id;
    assert.equal(after.filter(row => row.lab_id === gta).every(row => row.prints_per_unit === null), true);
    assert.equal(await snapshotLegacyLabFixture(db), beforeLegacy);
    const outsideFunction = migration.replace(/create or replace function[\s\S]*?end \$\$;/i, '');
    assert.doesNotMatch(outsideFunction, /update\s+public\.studio_lab_catalog/i, 'Migration execution contains no historical catalog update');
    assert.doesNotMatch(migration, /(?:insert into|update|alter table)\s+public\.(schools|projects|packages|package_profiles|orders)\b/i);
    const privileges = (await db.query("select has_function_privilege('authenticated','public.apply_lab_catalog_import(uuid,uuid,integer,jsonb,text,text,uuid)','execute') as browser,has_function_privilege('service_role','public.apply_lab_catalog_import(uuid,uuid,integer,jsonb,text,text,uuid)','execute') as service")).rows[0];
    assert.deepEqual(privileges, { browser: false, service: true });
    for (const count of [0, -1, 101]) await assert.rejects(() => db.query('update studio_lab_catalog set prints_per_unit=$1 where id=$2', [count, LAB_FIXTURE.productA]), /check constraint/);
  } finally { await db.close(); }
});

test('CSV preview through actual import RPC preserves physical counts, clears omitted counts and approval on edit, and rolls back invalid units', async () => {
  const db = await createLabDatabase();
  try {
    await seedLegacyLabCanaries(db);
    const beforeLegacy = await snapshotLegacyLabFixture(db), labId = randomUUID();
    await db.query("insert into studio_labs(id,slug,name,country_code,city,currency) values($1,'unit-test-catalog','Synthetic unit test lab','CA','Fixture city','CAD')", [labId]);
    const runImport = async (rows, expected, requestId = randomUUID()) => db.transaction(async tx => {
      await tx.exec('set local role service_role');
      return tx.query('select apply_lab_catalog_import($1,$2,$3,$4::jsonb,$5,$6,$7) as value', [LAB_FIXTURE.admin, labId, expected, JSON.stringify(rows), 'Synthetic pieces.csv', createHash('sha256').update(JSON.stringify(rows)).digest('hex'), requestId]);
    });
    const header = 'sku,name,category,size,finish,wholesale_price,currency,popular,prints_per_unit\n';
    const preview = csvImport.previewCatalogImport(header + 'SINGLE,5x7 Print,Prints,5x7,Lustre,2.00,CAD,no,1\nPAIR,Pair of 5x7 Prints,Prints,5x7,Lustre,4.00,CAD,no,2\n', undefined, 'CAD');
    assert.deepEqual(preview.issues, []);
    const requestId = randomUUID();
    await runImport(preview.rows, 0, requestId);
    assert.equal((await runImport(preview.rows, 0, requestId)).rows[0].value.replayed, true);
    const products = (await db.query('select * from studio_lab_catalog where lab_id=$1 order by sku', [labId])).rows;
    assert.deepEqual(products.map(row => [row.sku, row.prints_per_unit, row.verified, row.cost_source]), [['PAIR', 2, false, 'lab_upload'], ['SINGLE', 1, false, 'lab_upload']]);
    const single = products.find(row => row.sku === 'SINGLE');
    const photo = row => ({ id: row.id, labId, name: row.name, category: row.category, size: row.size, finish: row.finish, currency: row.currency, costCents: row.cost_cents, sku: row.sku, verified: row.verified, active: row.active, widthInches: Number(row.width_inches), heightInches: Number(row.height_inches), costSource: row.cost_source, printsPerUnit: row.prints_per_unit });
    assert.equal(starters.approvedStarterProduct(photo(single), labId, 'CAD'), false, 'Uploading count1 does not approve the product');
    await db.query("update studio_lab_catalog set verified=true,cost_source='lab_confirmed' where lab_id=$1", [labId]);
    let approved = (await db.query('select * from studio_lab_catalog where lab_id=$1', [labId])).rows;
    assert.equal(approved.filter(row => starters.approvedStarterProduct(photo(row), labId, 'CAD')).length, 1, 'Confirmed count2 cannot fill a single-print starter');
    const beforeBad = (await db.query('select * from studio_lab_catalog where lab_id=$1 order by id', [labId])).rows;
    for (const count of [0, 101, -1, 1.5, '1', true]) await assert.rejects(() => runImport([{ ...preview.rows[0], printsPerUnit: count }], 1), /LAB_IMPORT_INVALID_ROW/);
    await assert.rejects(() => runImport([{ ...preview.rows[0], name: 'Earlier valid row' }, { ...preview.rows[1], printsPerUnit: 0 }], 1), /LAB_IMPORT_INVALID_ROW/);
    assert.deepEqual((await db.query('select * from studio_lab_catalog where lab_id=$1 order by id', [labId])).rows, beforeBad);
    const oldFormat = csvImport.previewCatalogImport('sku,name,category,size,finish,wholesale_price\nSINGLE,Changed to unspecified pack,Prints,5x7,Lustre,5.00\n', undefined, 'CAD');
    assert.equal(oldFormat.rows[0].printsPerUnit, null);
    await runImport(oldFormat.rows, 1);
    let updated = (await db.query('select * from studio_lab_catalog where id=$1', [single.id])).rows[0];
    assert.equal(updated.prints_per_unit, null);
    assert.equal(updated.verified, false);
    assert.equal(updated.cost_source, 'lab_upload');
    assert.equal(starters.approvedStarterProduct(photo(updated), labId, 'CAD'), false);
    // Even older callers that omit the property entirely clear it safely.
    await db.query("update studio_lab_catalog set prints_per_unit=1,verified=true,cost_source='lab_confirmed' where id=$1", [single.id]);
    const missing = { ...preview.rows[0] }; delete missing.printsPerUnit;
    await runImport([missing], 2);
    updated = (await db.query('select * from studio_lab_catalog where id=$1', [single.id])).rows[0];
    assert.equal(updated.prints_per_unit, null);
    assert.equal(updated.verified, false);
    const absentPair = (await db.query("select * from studio_lab_catalog where lab_id=$1 and sku='PAIR'", [labId])).rows[0];
    assert.equal(absentPair.prints_per_unit, 2, 'An absent uploaded SKU is retained unchanged');
    assert.equal(await snapshotLegacyLabFixture(db), beforeLegacy);
  } finally { await db.close(); }
});
