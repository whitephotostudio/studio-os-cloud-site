import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createLabDatabase, LAB_FIXTURE, fixtureToken, seedLegacyLabCanaries, snapshotLegacyLabFixture } from '../scripts/lab-system-fixture.mjs';

const jpeg = readFileSync(new URL('./helpers/lab-order-sample.jpg', import.meta.url));
const png = readFileSync(new URL('./helpers/lab-order-sample.png', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function role(db, name, user, action) {
  assert.ok(['service_role', 'authenticated', 'anon'].includes(name));
  return db.transaction(async tx => {
    await tx.exec(`set local role ${name}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)", [user || '', name, JSON.stringify({ sub: user, role: name, aal: 'aal2' })]);
    return action(tx);
  });
}
const payload = (assetId, mode = 'ship_to_studio') => ({ labId: LAB_FIXTURE.lab, reference: 'Synthetic order reference', notes: 'Local fixture only', delivery: { mode, name: 'Fixture studio', address: mode === 'pickup' ? '' : '123 Fixture Road, Toronto, ON' }, items: [{ catalogProductId: LAB_FIXTURE.orderProduct, assetId, quantity: 2 }] });

test('actual lab order ledger preserves every legacy table while validating files, permissions, status CAS and immutable production snapshots', async () => {
  let beforeMigration;
  const db = await createLabDatabase({ beforeLabOrdersMigration: async tx => { await seedLegacyLabCanaries(tx); beforeMigration = await snapshotLegacyLabFixture(tx); } });
  try {
    assert.equal(await snapshotLegacyLabFixture(db), beforeMigration, 'Applying the new migration preserves existing schools, gallery assignments, price lists, packages and paid orders byte for byte');
    const bucket = (await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='lab-production-files'")).rows[0];
    assert.equal(bucket.public, false);
    assert.equal(Number(bucket.file_size_limit), 4_000_000);
    assert.deepEqual(bucket.allowed_mime_types, ['image/jpeg', 'image/png']);
    const assetId = randomUUID(), foreignAsset = randomUUID(), wrongLabAsset = randomUUID(), unreadyAsset = randomUUID();
    for (const [id, photographer, lab, ready] of [[assetId, LAB_FIXTURE.photographer, LAB_FIXTURE.lab, true], [foreignAsset, LAB_FIXTURE.otherPhotographer, LAB_FIXTURE.lab, true], [wrongLabAsset, LAB_FIXTURE.photographer, LAB_FIXTURE.foreignLab, true], [unreadyAsset, LAB_FIXTURE.photographer, LAB_FIXTURE.lab, false]]) {
      await role(db, 'service_role', null, tx => tx.query('insert into lab_order_assets(id,photographer_id,lab_id,storage_key,sha256,width_pixels,height_pixels,content_type,byte_size,filename,ready) values ($1,$2,$3,$4,$5,600,400,$6,$7,$8,$9)', [id, photographer, lab, `local/${lab}/${photographer}/${id}.jpg`, hash(jpeg), 'image/jpeg', jpeg.length, 'Synthetic image.jpg', ready]));
    }
    for (const invalid of [{ storage_key: '../escaped.jpg' }, { content_type: 'application/pdf' }, { byte_size: 4_000_001 }, { sha256: 'bad-hash' }]) {
      const values = { id: randomUUID(), photographer_id: LAB_FIXTURE.photographer, lab_id: LAB_FIXTURE.lab, storage_key: `local/${randomUUID()}.jpg`, sha256: hash(jpeg), width_pixels: 600, height_pixels: 400, content_type: 'image/jpeg', byte_size: jpeg.length, filename: 'Synthetic image.jpg', ready: true, ...invalid };
      const columns = Object.keys(values);
      await assert.rejects(() => role(db, 'service_role', null, tx => tx.query(`insert into lab_order_assets(${columns.join(',')}) values (${columns.map((_, index) => `$${index + 1}`).join(',')})`, Object.values(values))), undefined, 'Invalid private asset metadata is rejected at the database boundary');
    }
    const getOrder = async id => (await db.query('select * from lab_orders where id=$1', [id])).rows[0];
    const events = async id => (await db.query('select * from lab_order_events where order_id=$1 order by version', [id])).rows;
    const submit = async (body, requestId = randomUUID(), actor = LAB_FIXTURE.owner) => {
      const response = await role(db, 'service_role', null, tx => tx.query('select submit_lab_order($1,$2,$3::jsonb) as result', [actor, requestId, JSON.stringify(body)]));
      return response.rows[0].result;
    };
    const transition = async (id, version, status, actor = LAB_FIXTURE.labOperator, requestId = randomUUID(), details = {}) => {
      const response = await role(db, 'service_role', null, tx => tx.query('select transition_lab_order($1,$2,$3,$4,$5,$6,$7,$8) as result', [actor, id, version, requestId, status, details.reason || '', details.carrier || '', details.trackingNumber || '']));
      return response.rows[0].result;
    };
    for (const body of [{ ...payload(assetId), items: [{ ...payload(assetId).items[0], quantity: 0 }] }, payload(foreignAsset), payload(wrongLabAsset), payload(unreadyAsset), { ...payload(assetId), items: [{ ...payload(assetId).items[0], catalogProductId: LAB_FIXTURE.foreignProduct }] }]) await assert.rejects(() => submit(body));
    const gta = (await db.query("select id from studio_labs where slug='gta-imaging'")).rows[0];
    await assert.rejects(() => submit({ ...payload(assetId), labId: gta.id }), /LAB_ORDER_/);
    assert.equal((await db.query('select count(*)::int as n from lab_orders')).rows[0].n, 0, 'Held submissions create no ledger rows');
    const labBeforeSubmit = await role(db, 'authenticated', LAB_FIXTURE.labViewer, tx => tx.query('select id from lab_order_assets where id=$1', [assetId]));
    assert.equal(labBeforeSubmit.rows.length, 0, 'Lab viewers cannot browse unsubmitted studio files');
    const requestId = randomUUID(), submitted = await submit(payload(assetId), requestId);
    const id = submitted.id || submitted.orderId;
    assert.ok(id, JSON.stringify(submitted));
    const first = await getOrder(id);
    assert.equal(first.status, 'submitted');
    assert.equal(first.version, 1);
    assert.equal(Number(first.total_minor), 240, 'Wholesale total is computed from the verified server catalog');
    assert.equal(first.snapshot.items[0].sku, 'SYNTHETIC-6X4');
    assert.equal(first.snapshot.items[0].asset.sha256, hash(jpeg));
    const replay = await submit(payload(assetId), requestId);
    assert.equal(replay.id || replay.orderId, id);
    assert.equal((await events(id)).length, 1);
    await assert.rejects(() => submit({ ...payload(assetId), reference: 'Different request body' }, requestId), /CONFLICT/);
    const ownRead = await role(db, 'authenticated', LAB_FIXTURE.owner, tx => tx.query('select id from lab_orders where id=$1', [id]));
    assert.equal(ownRead.rows.length, 1);
    for (const actor of [LAB_FIXTURE.labOwner, LAB_FIXTURE.labOperator, LAB_FIXTURE.labViewer]) {
      assert.equal((await role(db, 'authenticated', actor, tx => tx.query('select id from lab_orders where id=$1', [id]))).rows.length, 1);
      assert.equal((await role(db, 'authenticated', actor, tx => tx.query('select id from lab_order_assets where id=$1', [assetId]))).rows.length, 1);
    }
    for (const actor of [LAB_FIXTURE.otherOwner, LAB_FIXTURE.foreignLabOwner, LAB_FIXTURE.admin]) {
      assert.equal((await role(db, 'authenticated', actor, tx => tx.query('select id from lab_orders where id=$1', [id]))).rows.length, 0);
      assert.equal((await role(db, 'authenticated', actor, tx => tx.query('select id from lab_order_assets where id=$1', [assetId]))).rows.length, 0);
    }
    await assert.rejects(() => transition(id, 1, 'accepted', LAB_FIXTURE.owner));
    await assert.rejects(() => transition(id, 1, 'accepted', LAB_FIXTURE.labViewer));
    await assert.rejects(() => transition(id, 1, 'accepted', LAB_FIXTURE.foreignLabOwner));
    await assert.rejects(() => transition(id, 1, 'ready'));
    const acceptId = randomUUID();
    await transition(id, 1, 'accepted', LAB_FIXTURE.labOperator, acceptId);
    await transition(id, 1, 'accepted', LAB_FIXTURE.labOperator, acceptId);
    assert.equal((await events(id)).length, 2, 'Transition retry creates no duplicate audit event');
    await assert.rejects(() => transition(id, 1, 'in_production'), /VERSION_CONFLICT/);
    await transition(id, 2, 'in_production');
    await transition(id, 3, 'ready');
    await assert.rejects(() => transition(id, 4, 'shipped'), /TRACKING|INVALID/);
    await transition(id, 4, 'shipped', LAB_FIXTURE.labOwner, randomUUID(), { carrier: 'Fixture carrier', trackingNumber: 'LOCAL-ONLY-123' });
    await transition(id, 5, 'completed');
    await assert.rejects(() => transition(id, 6, 'in_production'));
    assert.deepEqual((await events(id)).map(event => event.to_status), ['submitted', 'accepted', 'in_production', 'ready', 'shipped', 'completed']);
    const frozen = JSON.stringify((await getOrder(id)).snapshot);
    await db.query('update studio_lab_catalog set cost_cents=99999,name=$1 where id=$2', ['New catalog revision', LAB_FIXTURE.orderProduct]);
    assert.equal(JSON.stringify((await getOrder(id)).snapshot), frozen, 'Later product changes cannot rewrite the submitted production agreement');
    await assert.rejects(() => role(db, 'service_role', null, tx => tx.query('update lab_order_events set reason=$1 where order_id=$2', ['Tampered history', id])));
    await assert.rejects(() => role(db, 'service_role', null, tx => tx.query('update lab_order_assets set sha256=$1 where id=$2', ['0'.repeat(64), assetId])));
    await assert.rejects(() => role(db, 'authenticated', LAB_FIXTURE.labOwner, tx => tx.query('delete from lab_order_events where order_id=$1', [id])));

    const pickup = await submit(payload(assetId, 'pickup'));
    const pickupId = pickup.id || pickup.orderId;
    await transition(pickupId, 1, 'accepted'); await transition(pickupId, 2, 'in_production'); await transition(pickupId, 3, 'ready');
    await assert.rejects(() => transition(pickupId, 4, 'shipped', LAB_FIXTURE.labOwner, randomUUID(), { carrier: 'Fixture', trackingNumber: 'Invalid for pickup' }));
    await transition(pickupId, 4, 'completed');
    const cancelled = await submit(payload(assetId, 'pickup'));
    await transition(cancelled.id || cancelled.orderId, 1, 'cancelled', LAB_FIXTURE.owner);
    assert.equal(await snapshotLegacyLabFixture(db), beforeMigration, 'The full production and pickup workflow preserves existing schools, profile assignments, prices and paid orders byte for byte');
  } finally { await db.close(); }
});

const origin = process.env.LAB_SYSTEM_HTTP_ORIGIN;
test('actual HTTP studio upload/submission and lab role workflow stay private and preserve legacy galleries and orders', { skip: !origin }, async () => {
  assert.match(origin, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  const call = async (path, body, actor = LAB_FIXTURE.owner, extraHeaders = {}) => {
    const response = await fetch(new URL(path, origin), { method: body ? 'POST' : 'GET', headers: { Origin: new URL(origin).origin, ...(actor ? { Authorization: `Bearer ${fixtureToken(actor)}` } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
    const type = response.headers.get('content-type') || '';
    return { status: response.status, body: type.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()), response };
  };
  const upload = (bytes = jpeg, mime = 'image/jpeg', actor = LAB_FIXTURE.owner, labId = LAB_FIXTURE.lab, name = 'Synthetic image.jpg') => {
    const form = new FormData(); form.append('labId', labId); form.append('file', new Blob([bytes], { type: mime }), name);
    return call('/api/dashboard/lab-order-assets', form, actor);
  };
  const workspace = result => result.body.workspace || result.body;
  const fixtureUrl = process.env.LAB_SYSTEM_FIXTURE_URL || 'http://127.0.0.1:55471';
  const legacy = async () => {
    const data = {};
    for (const table of ['schools', 'projects', 'packages', 'package_profiles', 'orders']) {
      const result = await fetch(`${fixtureUrl}/rest/v1/${table}?select=*&order=id`, { headers: { Authorization: `Bearer ${fixtureToken(null, 'service_role')}` } });
      assert.equal(result.status, 200); data[table] = await result.json();
    }
    return JSON.stringify(data);
  };
  const before = await legacy();
  assert.equal((await call('/api/dashboard/lab-orders', undefined, null)).status, 401);
  assert.equal((await upload(Buffer.from('not an image'), 'text/plain')).status, 400);
  assert.ok((await upload(Buffer.alloc(4_000_001), 'image/jpeg')).status >= 400);
  const file = await upload(); assert.equal(file.status, 200, JSON.stringify(file.body));
  assert.equal(file.body.asset.sha256, hash(jpeg));
  assert.equal(file.body.asset.widthPixels, 600); assert.equal(file.body.asset.heightPixels, 400);
  const pngFile = await upload(png, 'image/png', LAB_FIXTURE.otherOwner); assert.equal(pngFile.status, 200, JSON.stringify(pngFile.body));
  const command = { action: 'submit', requestId: randomUUID(), ...payload(file.body.asset.id) };
  const studioWorkspace = workspace(await call('/api/dashboard/lab-orders'));
  const gta = studioWorkspace.labs.find(lab => lab.slug === 'gta-imaging');
  assert.ok(gta);
  assert.equal((await upload(jpeg, 'image/jpeg', LAB_FIXTURE.owner, gta.id)).status, 409, 'GTA reference setup cannot receive uploads');
  assert.equal((await call('/api/dashboard/lab-orders', { ...command, requestId: randomUUID(), labId: gta.id })).status, 409);
  assert.equal((await call('/api/dashboard/lab-orders', { ...command, requestId: randomUUID(), items: [{ ...command.items[0], quantity: 0 }] })).status, 400);
  assert.ok((await call('/api/dashboard/lab-orders', { ...command, requestId: randomUUID(), items: [{ ...command.items[0], assetId: pngFile.body.asset.id }] })).status >= 400);
  assert.equal((await call('/api/dashboard/lab-orders', { ...command, requestId: randomUUID(), items: [{ ...command.items[0], unitCostMinor: 1 }] })).status, 400, 'A client cannot submit its own wholesale charge');
  assert.equal((await call('/api/dashboard/lab-orders', command, LAB_FIXTURE.owner, { Origin: 'https://untrusted.example' })).status, 401);
  const created = await call('/api/dashboard/lab-orders', command); assert.equal(created.status, 200, JSON.stringify(created.body));
  let order = created.body.order; assert.ok(order?.id, JSON.stringify(created.body));
  const id = order.id;
  const replay = await call('/api/dashboard/lab-orders', command); assert.equal(replay.status, 200); assert.equal(replay.body.order.id, id);
  assert.equal((await call('/api/dashboard/lab-orders', { ...command, reference: 'Conflicting duplicate' })).status, 409);
  const labRead = await call('/api/lab/orders', undefined, LAB_FIXTURE.labViewer); assert.equal(labRead.status, 200, JSON.stringify(labRead.body));
  assert.equal(workspace(labRead).orders.some(row => row.id === id), true);
  const foreignRead = await call('/api/lab/orders', undefined, LAB_FIXTURE.foreignLabOwner); assert.equal(foreignRead.status, 200, JSON.stringify(foreignRead.body));
  assert.equal(workspace(foreignRead).orders.some(row => row.id === id), false);
  const filePath = `/api/lab/orders/${id}/files/${file.body.asset.id}`;
  const downloaded = await call(filePath, undefined, LAB_FIXTURE.labViewer); assert.equal(downloaded.status, 200, JSON.stringify(downloaded.body));
  assert.equal(hash(downloaded.body), hash(jpeg));
  assert.match(downloaded.response.headers.get('content-disposition'), /attachment/);
  const studioDownload = await call(`${filePath}?audience=studio`); assert.equal(studioDownload.status, 200); assert.equal(hash(studioDownload.body), hash(jpeg));
  assert.ok((await call(`${filePath}?audience=studio`, undefined, LAB_FIXTURE.otherOwner)).status >= 400);
  assert.ok((await call(`/api/lab/orders/${id}/files/${pngFile.body.asset.id}`, undefined, LAB_FIXTURE.labViewer)).status >= 400, 'Membership does not grant files outside this order snapshot');
  assert.ok((await call(filePath, undefined, LAB_FIXTURE.foreignLabOwner)).status >= 400);
  assert.ok((await call(filePath, undefined, LAB_FIXTURE.otherOwner)).status >= 400);
  assert.equal((await call(filePath, undefined, null)).status, 401);
  assert.ok((await call(`/api/lab/orders/${id}/files/not-a-valid-id`, undefined, LAB_FIXTURE.labOwner)).status >= 400);
  const transition = async (status, actor = LAB_FIXTURE.labOperator, values = {}) => call('/api/lab/orders', { action: 'transition', orderId: id, expectedVersion: order.version, requestId: randomUUID(), status, reason: '', carrier: '', trackingNumber: '', ...values }, actor);
  assert.ok((await transition('accepted', LAB_FIXTURE.owner)).status >= 400);
  assert.ok((await transition('accepted', LAB_FIXTURE.labViewer)).status >= 400);
  assert.ok((await transition('accepted', LAB_FIXTURE.foreignLabOwner)).status >= 400);
  const acceptRequest = randomUUID(), accepted = await transition('accepted', LAB_FIXTURE.labOperator, { requestId: acceptRequest }); assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const acceptedRetry = await transition('accepted', LAB_FIXTURE.labOperator, { requestId: acceptRequest }); assert.equal(acceptedRetry.status, 200, JSON.stringify(acceptedRetry.body));
  assert.equal((await transition('in_production')).status, 409, 'Stale version cannot advance a lab job');
  order = accepted.body.order;
  for (const status of ['in_production', 'ready', 'shipped', 'completed']) {
    const result = await transition(status, LAB_FIXTURE.labOperator, status === 'shipped' ? { carrier: 'Fixture carrier', trackingNumber: 'LOCAL-ONLY-123' } : {});
    assert.equal(result.status, 200, JSON.stringify(result.body)); order = result.body.order;
  }
  const studioReload = await call('/api/dashboard/lab-orders');
  const finalOrder = workspace(studioReload).orders.find(row => row.id === id);
  assert.equal(finalOrder.status, 'completed');
  assert.deepEqual(finalOrder.events.map(event => event.toStatus), ['submitted', 'accepted', 'in_production', 'ready', 'shipped', 'completed']);
  const storageKey = order.snapshot.items[0].asset.storageKey;
  const storagePath = `${fixtureUrl}/storage/v1/object/lab-production-files/${storageKey.split('/').map(encodeURIComponent).join('/')}`;
  const replaceStorage = bytes => fetch(storagePath, { method: 'POST', headers: { Authorization: `Bearer ${fixtureToken(null, 'service_role')}`, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: bytes });
  const changed = Buffer.from(jpeg); changed[changed.length - 1] ^= 1;
  try {
    assert.equal((await replaceStorage(changed)).status, 200);
    const tampered = await call(filePath, undefined, LAB_FIXTURE.labViewer);
    assert.equal(tampered.status, 409);
    assert.equal(tampered.body.code, 'LAB_ORDER_FILE_CHANGED');
  } finally { await replaceStorage(jpeg); }
  assert.equal(await legacy(), before, 'Actual upload/submit/production HTTP never changes old galleries, price lists, packages or paid orders');
});
