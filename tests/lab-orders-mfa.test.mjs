import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createLabDatabase, LAB_FIXTURE } from '../scripts/lab-system-fixture.mjs';

async function readAs(db, user, aal) {
  return db.transaction(async tx => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)", [user, JSON.stringify({ sub: user, role: 'authenticated', ...(aal ? { aal } : {}) })]);
    return {
      orders: (await tx.query('select id from lab_orders')).rows.length,
      assets: (await tx.query('select id from lab_order_assets')).rows.length,
      events: (await tx.query('select id from lab_order_events')).rows.length,
    };
  });
}

test('direct database reads cannot bypass lab portal MFA to access submitted addresses, assets or audit events', async () => {
  const db = await createLabDatabase();
  try {
    const assetId = randomUUID();
    await db.query(`insert into lab_order_assets(id,photographer_id,lab_id,filename,storage_key,sha256,width_pixels,height_pixels,content_type,byte_size,ready)
      values($1,$2,$3,'local-fixture.jpg',$4,$5,600,400,'image/jpeg',120,true)`, [assetId, LAB_FIXTURE.photographer, LAB_FIXTURE.lab, `local-fixture/${assetId}.jpg`, 'a'.repeat(64)]);
    const payload = { labId: LAB_FIXTURE.lab, reference: 'Private studio order', notes: '', delivery: { mode: 'ship_to_studio', name: 'Private studio', address: 'Private delivery address' }, items: [{ catalogProductId: LAB_FIXTURE.orderProduct, assetId, quantity: 1 }] };
    await db.query('select submit_lab_order($1,$2,$3::jsonb)', [LAB_FIXTURE.owner, randomUUID(), JSON.stringify(payload)]);
    for (const actor of [LAB_FIXTURE.labOwner, LAB_FIXTURE.labOperator, LAB_FIXTURE.labViewer]) {
      assert.deepEqual(await readAs(db, actor, 'aal1'), { orders: 0, assets: 0, events: 0 });
      assert.deepEqual(await readAs(db, actor, undefined), { orders: 0, assets: 0, events: 0 });
      assert.deepEqual(await readAs(db, actor, 'aal2'), { orders: 1, assets: 1, events: 1 });
    }
    assert.deepEqual(await readAs(db, LAB_FIXTURE.foreignLabOwner, 'aal2'), { orders: 0, assets: 0, events: 0 });
    assert.deepEqual(await readAs(db, LAB_FIXTURE.owner, 'aal1'), { orders: 1, assets: 1, events: 1 }, 'Own-studio reads retain existing photographer session policy behavior');
  } finally { await db.close(); }
});
