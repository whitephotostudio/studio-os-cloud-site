import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createLabDatabase, LAB_FIXTURE, seedLegacyLabCanaries, snapshotLegacyLabFixture } from '../scripts/lab-system-fixture.mjs';

const migration = readFileSync(new URL('../supabase/migrations/20261016010000_lab_business_conflicts.sql', import.meta.url), 'utf8');
const correctedFunctions = new Map([
  ['save_lab_price_sheet', ['20261015200000_lab_price_sheets.sql', 2]],
  ['publish_lab_price_sheet', ['20261015200000_lab_price_sheets.sql', 1]],
  ['submit_lab_order', ['20261015220000_lab_orders.sql', 2]],
  ['transition_lab_order', ['20261015220000_lab_orders.sql', 2]],
]);

async function service(db, action) {
  return db.transaction(async tx => {
    await tx.exec('set local role service_role');
    return action(tx);
  });
}

async function conflict(action, message) {
  await assert.rejects(action, error => {
    assert.equal(error.code, 'PT409', 'A final business conflict must not signal retryable SQLSTATE 40001');
    assert.equal(error.message, message);
    return true;
  });
}

function sheetDocument() {
  return { name: 'Synthetic business-conflict sheet', labId: LAB_FIXTURE.lab, currency: 'CAD',
    pricing: { markupPercent: 100, rounding: 'none' },
    items: [{ catalogProductId: LAB_FIXTURE.productA, retailCents: 1200, enabled: true }],
    packages: [], shipping: { mode: 'pickup', feeCents: 0, title: 'Fixture pickup' }, terms: '', assignments: [] };
}

test('corrective migration changes only seven business SQLSTATEs in four lab functions, preserving all other code, grants and existing rows', async () => {
  const db = await createLabDatabase();
  try {
    await seedLegacyLabCanaries(db);
    // Restore the already-shipped definitions inside this disposable database
    // so this verifies a real upgrade rather than comparing two corrected copies.
    for (const [name, [file, expected]] of correctedFunctions) {
      const original = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
      const matches = original.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'g'));
      assert.equal(matches?.length, 1);
      assert.equal(matches[0].split("errcode='40001'").length - 1, expected);
      await db.exec(matches[0].replace('create function ', 'create or replace function '));
    }
    const functions = async () => (await db.query("select p.oid,p.proname,p.proowner,p.proacl,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.oid")).rows;
    const rows = async () => {
      const tables = (await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
      const snapshot = {};
      for (const { tablename } of tables) {
        assert.match(tablename, /^[a-z_][a-z_0-9]*$/);
        snapshot[tablename] = (await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from "${tablename}" t`)).rows[0].rows;
      }
      return snapshot;
    };
    const before = await functions(), beforeRows = await rows();
    await db.exec(migration);
    const expected = before.map(row => correctedFunctions.has(row.proname)
      ? { ...row, definition: row.definition.replaceAll("errcode='40001'", "errcode='PT409'") }
      : row);
    assert.deepEqual(await functions(), expected, 'Function identity, body, security-definer setting, search path and ACLs are preserved');
    assert.deepEqual(await rows(), beforeRows, 'Applying this correction writes no school, price, order, lab or catalog rows');
    assert.equal(expected.filter(row => correctedFunctions.has(row.proname)).reduce((count, row) => count + row.definition.split("errcode='PT409'").length - 1, 0), 7);
    await db.exec(migration);
    assert.deepEqual(await functions(), expected, 'Corrective migration can be reapplied without changing its result');
    assert.deepEqual(await rows(), beforeRows);
  } finally { await db.close(); }
});

test('lab sheet create/save/delete/publish version conflicts return PT409 while successful saves and ownership checks remain unchanged', async () => {
  const db = await createLabDatabase();
  try {
    await seedLegacyLabCanaries(db);
    const legacy = await snapshotLegacyLabFixture(db), id = randomUUID(), document = sheetDocument();
    const save = (version, action = 'save', user = LAB_FIXTURE.owner, chosenId = id) => service(db, tx => tx.query('select save_lab_price_sheet($1,$2,$3,$4::jsonb,$5) as result', [user, chosenId, version, JSON.stringify(document), action]));
    const read = async () => (await db.query('select * from lab_price_sheets where id=$1', [id])).rows[0];
    await save(0, 'create');
    assert.equal((await read()).version, 1);
    await conflict(() => save(0, 'create'), 'LAB_VERSION_CONFLICT');
    await conflict(() => save(1, 'create', LAB_FIXTURE.owner, randomUUID()), 'LAB_VERSION_CONFLICT');
    await save(1);
    assert.equal((await read()).version, 2);
    const frozen = await read();
    await conflict(() => save(1), 'LAB_VERSION_CONFLICT');
    await conflict(() => save(1, 'delete'), 'LAB_VERSION_CONFLICT');
    await conflict(() => service(db, tx => tx.query('select publish_lab_price_sheet($1,$2,$3,$4::jsonb)', [LAB_FIXTURE.owner, id, 1, JSON.stringify([{ kind: 'school', id: LAB_FIXTURE.school }])])), 'LAB_VERSION_CONFLICT');
    await assert.rejects(() => save(2, 'save', LAB_FIXTURE.otherOwner), error => error.code === '42501' && error.message === 'LAB_NOT_FOUND');
    await assert.rejects(() => db.transaction(async tx => { await tx.exec('set local role authenticated'); return tx.query('select save_lab_price_sheet($1,$2,2,$3::jsonb,$4)', [LAB_FIXTURE.owner, id, JSON.stringify(document), 'save']); }), error => error.code === '42501');
    assert.deepEqual(await read(), frozen, 'Rejected conflicts and unauthorized requests do not modify the saved sheet');
    assert.equal(await snapshotLegacyLabFixture(db), legacy);
  } finally { await db.close(); }
});

test('lab order payload, cross-action request and stale-version conflicts return PT409 without duplicates or changes to snapshots and audit history', async () => {
  const db = await createLabDatabase();
  try {
    await seedLegacyLabCanaries(db);
    const legacy = await snapshotLegacyLabFixture(db), assetId = randomUUID();
    const bytes = readFileSync(new URL('./helpers/lab-order-sample.jpg', import.meta.url));
    await service(db, tx => tx.query('insert into lab_order_assets(id,photographer_id,lab_id,storage_key,sha256,width_pixels,height_pixels,content_type,byte_size,filename,ready) values ($1,$2,$3,$4,$5,600,400,$6,$7,$8,true)',
      [assetId, LAB_FIXTURE.photographer, LAB_FIXTURE.lab, `local/${LAB_FIXTURE.lab}/${LAB_FIXTURE.photographer}/${assetId}.jpg`, createHash('sha256').update(bytes).digest('hex'), 'image/jpeg', bytes.length, 'Synthetic conflict sample.jpg']));
    const payload = { labId: LAB_FIXTURE.lab, reference: 'Synthetic business-conflict order', notes: 'Local fixture only', delivery: { mode: 'pickup', name: 'Fixture studio', address: '' }, items: [{ catalogProductId: LAB_FIXTURE.orderProduct, assetId, quantity: 2 }] };
    const submit = (request, body = payload) => service(db, tx => tx.query('select submit_lab_order($1,$2,$3::jsonb) as result', [LAB_FIXTURE.owner, request, JSON.stringify(body)]));
    const submittedRequest = randomUUID(), first = (await submit(submittedRequest)).rows[0].result;
    const id = first.id, read = async () => ({ order: (await db.query('select * from lab_orders where id=$1', [id])).rows[0], events: (await db.query('select * from lab_order_events where order_id=$1 order by version', [id])).rows });
    assert.equal((await submit(submittedRequest)).rows[0].result.id, id);
    const beforeConflict = await read();
    await conflict(() => submit(submittedRequest, { ...payload, notes: 'Changed payload must not retry' }), 'LAB_ORDER_REQUEST_CONFLICT');
    assert.deepEqual(await read(), beforeConflict);
    const transition = (request, version, status, reason = '', actor = LAB_FIXTURE.labOperator) => service(db, tx => tx.query('select transition_lab_order($1,$2,$3,$4,$5,$6,$7,$8) as result', [actor, id, version, request, status, reason, '', '']));
    const acceptedRequest = randomUUID();
    await transition(acceptedRequest, 1, 'accepted');
    await transition(acceptedRequest, 1, 'accepted');
    const accepted = await read();
    assert.equal(accepted.order.version, 2);
    assert.equal(accepted.events.length, 2, 'The exact transition retry creates no duplicate event');
    await conflict(() => transition(acceptedRequest, 1, 'accepted', 'Different retry details'), 'LAB_ORDER_REQUEST_CONFLICT');
    await conflict(() => transition(randomUUID(), 1, 'in_production'), 'LAB_ORDER_VERSION_CONFLICT');
    assert.deepEqual(await read(), accepted);
    await assert.rejects(() => transition(randomUUID(), 2, 'in_production', '', LAB_FIXTURE.labViewer), error => error.code === '42501' && error.message === 'LAB_ORDER_FORBIDDEN');
    await transition(randomUUID(), 2, 'in_production');
    await transition(randomUUID(), 3, 'ready');
    await transition(randomUUID(), 4, 'completed');
    const completed = await read();
    assert.deepEqual(completed.events.map(event => event.to_status), ['submitted', 'accepted', 'in_production', 'ready', 'completed']);
    assert.deepEqual(completed.order.snapshot, beforeConflict.order.snapshot);
    const cancelledRequest = randomUUID(), anotherRequest = randomUUID(), another = (await submit(anotherRequest)).rows[0].result;
    await service(db, tx => tx.query('select transition_lab_order($1,$2,1,$3,$4,$5,$6,$7)', [LAB_FIXTURE.owner, another.id, cancelledRequest, 'cancelled', '', '', '']));
    await conflict(() => submit(cancelledRequest), 'LAB_ORDER_REQUEST_CONFLICT');
    assert.equal((await db.query('select count(*)::int as count from lab_orders')).rows[0].count, 2, 'Cross-action request reuse cannot create another order');
    assert.equal(await snapshotLegacyLabFixture(db), legacy);
  } finally { await db.close(); }
});
