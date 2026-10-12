import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const uuid = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const studio = uuid(90), school = uuid(80), student = uuid(70);
const migration = readFileSync(new URL('../supabase/migrations/20261008010000_abandoned_cart_reminder_policy.sql', import.meta.url), 'utf8');
async function fixture(fn) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table orders(id uuid primary key,photographer_id uuid,school_id uuid,project_id uuid,student_id uuid,
        customer_email text,parent_email text,status text,payment_status text,paid_at timestamptz,
        stripe_payment_intent_id text,stripe_checkout_session_id text,created_at timestamptz,is_test boolean default false,
        refund_status text,refund_amount_cents integer);
      create table project_email_deliveries(id uuid default gen_random_uuid(),order_id uuid,photographer_id uuid,
        recipient_email text,email_type text,status text,sent_at timestamptz);
    `);
    await db.exec(migration);
    const insert = async (id, change = {}) => {
      const row = { id: uuid(id), photographer_id: studio, school_id: school, project_id: null, student_id: student,
        customer_email: 'Buyer@Example.com', parent_email: 'stale@example.com', status: 'payment_pending', payment_status: 'pending',
        paid_at: null, stripe_payment_intent_id: null, stripe_checkout_session_id: 'cs_fixture',
        created_at: new Date(Date.now() - 96 * 3_600_000).toISOString(), ...change };
      const keys = Object.keys(row);
      await db.query(`insert into orders(${keys.join(',')}) values(${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
      return row;
    };
    const claim = async (ids = null, owner = null) => (await db.query('select * from claim_abandoned_cart_reminders($1::uuid[],$2::uuid,100)', [ids, owner])).rows;
    const complete = async (c, status = 'sent') => (await db.query('select complete_abandoned_cart_reminder($1,$2,$3,$4,null) as ok', [c.claim_id, c.lease_token, status, status === 'sent' ? 'resend-fixture' : null])).rows[0].ok;
    const authorize = async c => (await db.query('select authorize_abandoned_cart_reminder_send($1,$2) as ok', [c.claim_id, c.lease_token])).rows[0].ok;
    await fn({ db, insert, claim, complete, authorize });
  } finally { await db.close(); }
}

test('stop controls accept verified unpaid action-needed checkouts while rejecting processing and refund markers', async () => fixture(async ({ db, insert }) => {
  await insert(1, { payment_status: 'requires_action', stripe_payment_intent_id: 'pi_unpaid', refund_status: 'not_refunded' });
  assert.equal((await db.query('select stop_abandoned_cart_reminders($1,$2) as ok', [uuid(1), 'buyer@example.com'])).rows[0].ok, true);
  await insert(2, { payment_status: 'processing' });
  assert.equal((await db.query('select stop_abandoned_cart_reminders($1,$2) as ok', [uuid(2), 'buyer@example.com'])).rows[0].ok, false);
  await insert(3, { refund_status: 'pending' });
  assert.equal((await db.query('select stop_abandoned_cart_reminders($1,$2) as ok', [uuid(3), 'buyer@example.com'])).rows[0].ok, false);
}));

test('new paid package suppresses all old attempts and new cart after checkout stays eligible', async () => fixture(async ({ insert, claim }) => {
  await insert(1); await insert(2, { created_at: new Date(Date.now() - 90 * 3_600_000).toISOString() });
  await insert(3, { created_at: new Date(Date.now() - 80 * 3_600_000).toISOString(), status: 'paid', payment_status: 'succeeded',
    paid_at: new Date(Date.now() - 70 * 3_600_000).toISOString(), stripe_payment_intent_id: 'pi_verified' });
  assert.equal((await claim()).length, 0);
  await insert(4, { created_at: new Date(Date.now() - 75 * 3_600_000).toISOString() });
  assert.deepEqual((await claim()).map(c => c.order_id), [uuid(4)]);
}));
test('scope isolation uses exact gallery, child, studio and normalized purchase email', async () => fixture(async ({ insert, claim }) => {
  await insert(1); await insert(2, { student_id: uuid(71), customer_email: 'other@example.com' });
  await insert(3, { school_id: uuid(81), customer_email: 'third@example.com' });
  await insert(4, { photographer_id: uuid(91) });
  await insert(5, { status: 'paid', payment_status: 'paid', paid_at: new Date().toISOString(),
    created_at: new Date(Date.now() - 80 * 3_600_000).toISOString(), stripe_payment_intent_id: 'pi_verified', customer_email: '  buyer@example.COM ' });
  assert.deepEqual((await claim()).map(c => c.order_id).sort(), [uuid(2), uuid(3), uuid(4)]);
}));
test('concurrent claim, manual old selections and changed packages cannot reset episode cap', async () => fixture(async ({ db, insert, claim, complete, authorize }) => {
  await insert(1); await insert(2, { created_at: new Date(Date.now() - 90 * 3_600_000).toISOString() });
  assert.equal((await claim([uuid(1)], studio)).length, 0);
  const batches = await Promise.all([claim(), claim()]);
  const first = batches.flat(); assert.equal(first.length, 1); assert.equal(first[0].order_id, uuid(2));
  assert.equal(await authorize(first[0]), true); assert.equal(await complete(first[0]), true);
  assert.equal((await claim()).length, 0);
  await db.query("update cart_reminder_claims set sent_at=now()-interval '49 hours' where id=$1", [first[0].claim_id]);
  await insert(3, { created_at: new Date(Date.now() - 80 * 3_600_000).toISOString() });
  const second = (await claim())[0]; assert.equal(second.stage, 2); assert.equal(second.order_id, uuid(3));
  assert.equal(await complete(second), true);
  await db.exec("update cart_reminder_claims set sent_at=now()-interval '50 hours'");
  await insert(4, { created_at: new Date(Date.now() - 76 * 3_600_000).toISOString() });
  assert.equal((await claim()).length, 0);
}));
test('24h and 72h timing plus 48h gap are enforced by authoritative claims', async () => fixture(async ({ db, insert, claim, complete }) => {
  await insert(1, { created_at: new Date(Date.now() - 23 * 3_600_000).toISOString() });
  assert.equal((await claim()).length, 0);
  await db.exec("update orders set created_at=now()-interval '25 hours'");
  const first = (await claim())[0]; assert.equal(first.stage, 1); await complete(first);
  await db.exec("update orders set created_at=now()-interval '71 hours'; update cart_reminder_claims set sent_at=now()-interval '49 hours'");
  assert.equal((await claim()).length, 0);
  await db.exec("update orders set created_at=now()-interval '73 hours'; update cart_reminder_claims set sent_at=now()-interval '47 hours'");
  assert.equal((await claim()).length, 0);
  await db.exec("update cart_reminder_claims set sent_at=now()-interval '49 hours'");
  assert.equal((await claim())[0].stage, 2);
}));
test('one studio recipient cooldown spaces reminders across different children', async () => fixture(async ({ db, insert, claim, complete }) => {
  await insert(1); await insert(2, { student_id: uuid(71) });
  const first = await claim(); assert.equal(first.length, 1); await complete(first[0]);
  assert.equal((await claim()).length, 0);
  await db.exec("update cart_reminder_claims set sent_at=now()-interval '25 hours'");
  const next = await claim(); assert.equal(next.length, 1); assert.notEqual(next[0].order_id, first[0].order_id);
}));
test('stopping authentic draft suppresses it and older drafts while preserving future carts and order bytes', async () => fixture(async ({ db, insert, claim }) => {
  await insert(1); await insert(2, { created_at: new Date(Date.now() - 90 * 3_600_000).toISOString() });
  const before = (await db.query('select * from orders order by id')).rows;
  assert.equal((await db.query('select stop_abandoned_cart_reminders($1,$2) as ok', [uuid(2), 'wrong@example.com'])).rows[0].ok, false);
  assert.equal((await db.query('select stop_abandoned_cart_reminders($1,$2) as ok', [uuid(2), '  buyer@example.COM '])).rows[0].ok, true);
  assert.equal((await claim()).length, 0);
  assert.deepEqual((await db.query('select * from orders order by id')).rows, before);
  await insert(3, { created_at: new Date(Date.now() - 80 * 3_600_000).toISOString() });
  assert.deepEqual((await claim()).map(c => c.order_id), [uuid(3)]);
}));
test('immediate authorization catches newer purchase, replacement, stop and own payment proof', async () => {
  for (const change of ['paid', 'replacement', 'stop', 'own-paid', 'closed']) await fixture(async ({ db, insert, claim, authorize }) => {
    await insert(1); const c = (await claim())[0];
    if (change === 'paid') await insert(2, { status: 'paid', payment_status: 'succeeded', paid_at: new Date().toISOString(), stripe_payment_intent_id: 'pi_verified', created_at: new Date(Date.now() - 80 * 3_600_000).toISOString() });
    if (change === 'replacement') await insert(2, { created_at: new Date(Date.now() - 80 * 3_600_000).toISOString() });
    if (change === 'stop') await db.query('select stop_abandoned_cart_reminders($1,$2)', [uuid(1), 'buyer@example.com']);
    if (change === 'own-paid') await db.exec("update orders set paid_at=now() where id='00000001-1111-4111-8111-111111111111'");
    if (change === 'closed') await db.exec("update orders set status='cancel_pending'");
    assert.equal(await authorize(c), false, change);
  });
});
test('uncertain provider outcome or attempted expired lease never gets a blind duplicate retry', async () => fixture(async ({ db, insert, claim, complete, authorize }) => {
  await insert(1); const c = (await claim())[0]; assert.equal(await authorize(c), true);
  assert.equal(await authorize(c), false); assert.equal(await complete(c, 'uncertain'), true);
  await db.exec("update cart_reminder_claims set claimed_at=now()-interval '96 hours'");
  assert.equal((await claim()).length, 0);
  await db.exec("update cart_reminder_claims set status='claimed',lease_until=now()-interval '1 second'");
  assert.equal((await claim()).length, 0);
  assert.equal((await db.query('select status from cart_reminder_claims')).rows[0].status, 'uncertain');
}));
test('untouched expired leases release safely without consuming a recipient stage', async () => fixture(async ({ db, insert, claim }) => {
  await insert(1); const first = (await claim())[0];
  await db.exec("update cart_reminder_claims set lease_until=now()-interval '1 second'");
  const retried = (await claim())[0];
  assert.equal(retried.claim_id, first.claim_id); assert.notEqual(retried.lease_token, first.lease_token);
  assert.equal(retried.dedupe_key, first.dedupe_key); assert.equal(retried.stage, 1);
}));
test('stopping held and unpaid cancelled checkout is idempotent but paid/refund markers always refuse', async () => {
  for (const status of ['payment_pending','cancel_pending','cancelled','canceled']) await fixture(async ({ db, insert }) => {
    await insert(1, { status, stripe_payment_intent_id: 'pi_failed_unpaid' });
    for (let retry=0;retry<2;retry++) assert.equal((await db.query('select stop_abandoned_cart_reminders($1,$2) as ok', [uuid(1),'buyer@example.com'])).rows[0].ok, true);
    const initial = (await db.query('select stop_through from cart_reminder_scopes')).rows[0].stop_through;
    await db.exec("update orders set created_at=created_at-interval '1 hour'");
    assert.equal((await db.query('select stop_abandoned_cart_reminders($1,$2) as ok', [uuid(1),'buyer@example.com'])).rows[0].ok, true);
    assert.deepEqual((await db.query('select stop_through from cart_reminder_scopes')).rows[0].stop_through, initial);
    await db.exec("update orders set payment_status='processing'");
    assert.equal((await db.query('select stop_abandoned_cart_reminders($1,$2) as ok', [uuid(1),'buyer@example.com'])).rows[0].ok, false);
    await db.exec("update orders set payment_status='pending',refund_status='pending'");
    assert.equal((await db.query('select stop_abandoned_cart_reminders($1,$2) as ok', [uuid(1),'buyer@example.com'])).rows[0].ok, false);
  });
});
test('existing web and manual reminders preserve caps and cooldown on upgrade', async () => fixture(async ({ db, insert, claim }) => {
  await insert(1); await insert(2, { created_at: new Date(Date.now() - 90 * 3_600_000).toISOString() });
  await db.query("insert into project_email_deliveries(order_id,photographer_id,recipient_email,email_type,status,sent_at) values($1,$2,'buyer@example.com','abandoned_cart','sent',now()-interval '80 hours')", [uuid(1), studio]);
  assert.equal((await claim())[0].stage, 2);
  await db.exec("delete from cart_reminder_claims; update orders set cart_reminder_sent_at=now()-interval '70 hours' where id='00000002-1111-4111-8111-111111111111'");
  assert.equal((await claim()).length, 0);
}));
test('missing identity, test rows and own paid markers are excluded; service-only privileges hold', async () => fixture(async ({ db, insert, claim }) => {
  await insert(1, { student_id: null }); await insert(2, { is_test: true }); await insert(3, { paid_at: new Date().toISOString() });
  await insert(4, { payment_status: 'succeeded' }); await insert(5, { stripe_payment_intent_id: 'pi_possible' });
  await insert(6, { refund_status: 'pending' }); await insert(7, { refund_amount_cents: 1 });
  assert.equal((await claim()).length, 0);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(() => db.query('select * from claim_abandoned_cart_reminders()'));
    await assert.rejects(() => db.query('select * from cart_reminder_claims'));
    await assert.rejects(() => db.query('select stop_abandoned_cart_reminders($1,$2)', [uuid(1), 'buyer@example.com']));
    await db.exec('reset role');
  }
  assert.equal((await db.query("select column_name from information_schema.columns where table_name='orders' and column_name='parent_dismissed_at'")).rows.length, 1);
}));
