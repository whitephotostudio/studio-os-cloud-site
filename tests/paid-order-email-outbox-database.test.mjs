import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationUrl = new URL('../supabase/migrations/20261005004000_paid_order_email_outbox.sql', import.meta.url);
const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), ownerUser = id(2), otherOwner = id(3), project = id(4), school = id(5), student = id(6);

async function fixture({ historical = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.photographers(
      id uuid primary key,user_id uuid,business_name text,billing_email text,studio_email text,
      studio_phone text,studio_address text,logo_url text,watermark_logo_url text,
      stripe_account_id text,stripe_connected_account_id text);
    create table public.projects(id uuid primary key,title text,photographer_id uuid,access_pin text);
    create table public.schools(id uuid primary key,school_name text,photographer_id uuid);
    create table public.students(id uuid primary key,first_name text,last_name text,pin text,school_id uuid);
    create table public.orders(
      id uuid primary key,photographer_id uuid,order_group_id uuid,project_id uuid,school_id uuid,student_id uuid,
      customer_name text,parent_name text,customer_email text,parent_email text,parent_phone text,
      package_id uuid,package_name text,package_price numeric,currency text default 'cad',
      total_cents integer,total_amount numeric,subtotal_cents integer,tax_cents integer,
      status text default 'payment_pending',payment_status text default 'pending',paid_at timestamptz,
      refund_status text,refund_amount_cents integer default 0,notes text,special_notes text,
      cart_snapshot jsonb default '[]',created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.order_items(
      id uuid primary key default gen_random_uuid(),order_id uuid references public.orders(id),
      product_name text,quantity integer,price numeric,unit_price_cents integer,line_total_cents integer,sku text);
  `);
  await db.query('insert into auth.users values($1,$2)', [ownerUser, 'owner-auth@example.test']);
  await db.query(`insert into photographers(id,user_id,business_name,billing_email,studio_email,studio_phone,studio_address)
    values($1,$2,'Frozen Studio','owner-billing@example.test','owner-studio@example.test','555-0100','Original studio address'),
    ($3,null,'Another Studio','other-owner@example.test','other-studio@example.test',null,null)`, [owner, ownerUser, otherOwner]);
  await db.query("insert into projects values($1,'Frozen event',$2,'event-pin')", [project, owner]);
  await db.query("insert into schools values($1,'Frozen school',$2)", [school, owner]);
  await db.query("insert into students values($1,'Jamie','Example','90876',$2)", [student, school]);
  async function insertOrder(orderId = id(100), { digital = false, paid = false } = {}) {
    await db.query(`insert into orders(id,photographer_id,project_id,school_id,student_id,
      parent_name,parent_email,customer_email,package_name,total_cents,total_amount,subtotal_cents,tax_cents,
      status,payment_status,paid_at,cart_snapshot)
      values($1,$2,$3,$4,$5,'Frozen Parent','parent@example.test','parent@example.test',$6,1800,18,1800,0,
      $7,$8,case when $8='paid' then now() else null end,$9)`,
    [orderId, owner, project, school, student, digital ? 'Single digital photo' : '8x10 print', paid ? 'paid' : 'payment_pending', paid ? 'paid' : 'pending', digital ? [{ category: 'digital', packageName: 'Single digital photo', digitalLimit: 1 }] : []]);
    await db.query("insert into order_items(order_id,product_name,quantity,price,unit_price_cents,line_total_cents,sku) values($1,$2,1,18,1800,1800,'fixture/private-photo.jpg')", [orderId, digital ? 'Digital download order x1' : '8x10 print']);
    return orderId;
  }
  if (historical) await insertOrder(id(99), { paid: true });
  await db.exec(readFileSync(migrationUrl, 'utf8'));
  const pay = orderId => db.query("update orders set status='paid',payment_status='paid',paid_at=now() where id=$1", [orderId]);
  const emails = () => db.query('select * from paid_order_emails order by order_id,kind').then(result => result.rows);
  const ensure = orderId => db.query('select * from ensure_paid_order_emails($1)', [orderId]).then(result => result.rows);
  const claim = (ids = null, limit = 200) => db.query('select * from claim_paid_order_emails($1,$2)', [ids, limit]).then(result => result.rows);
  const release = token => db.query('select release_paid_order_email_worker($1)', [token]);
  const prepare = (row, payload = message(row), token = row.lease_token) => db.query('select * from prepare_paid_order_email($1,$2,$3)', [row.id, token, payload]).then(result => result.rows);
  const close = () => db.close();
  return { db, insertOrder, pay, emails, ensure, claim, release, prepare, close };
}

function message(row, values = {}) {
  const idempotencyKey = row.kind === 'receipt' ? `order-receipt-${row.order_id}`
    : row.kind === 'photographer' ? `order-notify-${row.order_id}`
      : `digital-delivery-${row.order_id}-${row.recipient_email}`;
  return { to: row.recipient_email, subject: 'Frozen receipt', html: '<p>Original paid order</p>', text: 'Original paid order', idempotencyKey, ...values };
}

test('actual trigger stages 1000 future paid transitions once and 10 bounded worker batches drain all 2000 messages', async () => {
  const f = await fixture();
  try {
    await f.db.query(`insert into orders(id,photographer_id,project_id,parent_name,parent_email,customer_email,
      package_name,total_cents,total_amount,status,payment_status)
      select ('20000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,$1,$2,
        'Parent '||n,'parent-'||n||'@example.test','parent-'||n||'@example.test','8x10 print',1800,18,'payment_pending','pending'
      from generate_series(1,1000) n`, [owner, project]);
    await f.db.exec("update orders set status='paid',payment_status='paid',paid_at=now()");
    assert.equal((await f.emails()).length, 2000);
    assert.deepEqual((await f.db.query('select kind,count(*)::int count from paid_order_emails group by kind order by kind')).rows,
      [{ kind: 'photographer', count: 1000 }, { kind: 'receipt', count: 1000 }]);
    await f.db.exec("update orders set paid_at=now(); update orders set payment_status='pending'; update orders set payment_status='paid'");
    assert.equal((await f.emails()).length, 2000, 'replayed and repeated transitions must not duplicate an order/kind');
    const seen = new Set();
    for (let batch = 0; batch < 10; batch += 1) {
      const rows = await f.claim(null, 1000);
      assert.equal(rows.length, 200, 'the database must clamp even a larger requested batch');
      assert.equal(new Set(rows.map(row => row.lease_token)).size, 1);
      for (const row of rows) {
        assert.equal(row.attempts, 1);
        assert.equal(row.first_attempt_at, null, 'a claim alone is not a provider attempt');
        assert.equal(seen.has(row.id), false); seen.add(row.id);
      }
      await f.db.query("update paid_order_emails set status='sent',sent_at=now(),lease_token=null,lease_until=null where id=any($1::uuid[])", [rows.map(row => row.id)]);
      await f.release(rows[0].lease_token);
    }
    assert.equal(seen.size, 2000);
    assert.deepEqual(await f.claim(), []);
    assert.equal((await f.db.query("select count(*)::int count from paid_order_emails where status='sent'")).rows[0].count, 2000);
    assert.equal((await f.db.query('select lease_token from paid_order_email_worker')).rows[0].lease_token, null);
  } finally { await f.close(); }
});

test('migration and ensure never backfill historical paid orders; payment rollback also rolls back outbox staging', async () => {
  const f = await fixture({ historical: true });
  try {
    assert.deepEqual(await f.emails(), []);
    assert.deepEqual(await f.ensure(id(99)), []);
    await f.db.query('update orders set paid_at=now() where id=$1', [id(99)]);
    assert.deepEqual(await f.ensure(id(99)), []);
    const orderId = await f.insertOrder();
    await f.db.exec('begin'); await f.pay(orderId);
    assert.equal((await f.emails()).length, 2);
    await f.db.exec('rollback');
    assert.deepEqual(await f.emails(), []);
    assert.equal((await f.db.query('select payment_status from orders where id=$1', [orderId])).rows[0].payment_status, 'pending');
    await f.pay(orderId);
    const tracked = await f.ensure(orderId);
    assert.equal(tracked.length, 2);
    assert.deepEqual(tracked.map(row => row.id).sort(), (await f.emails()).map(row => row.id).sort());
  } finally { await f.close(); }
});

test('future paid messages freeze original order, line items, studio, recipients and owner-scoped gallery context', async () => {
  const f = await fixture();
  try {
    const orderId = await f.insertOrder(); await f.pay(orderId);
    const before = await f.emails();
    assert.deepEqual(before.map(row => [row.kind, row.recipient_email]), [['photographer', 'owner-billing@example.test'], ['receipt', 'parent@example.test']]);
    const frozen = before[0].snapshot;
    assert.equal(frozen.order.parent_name, 'Frozen Parent');
    assert.equal(frozen.order.total_cents, 1800);
    assert.equal(frozen.items[0].product_name, '8x10 print');
    assert.equal(frozen.photographer.business_name, 'Frozen Studio');
    assert.deepEqual(frozen.context, { project_title: 'Frozen event', project_pin: 'event-pin', school_name: 'Frozen school', student_name: 'Jamie Example', student_pin: '90876' });
    await f.db.query("update orders set customer_email='changed@example.test',parent_email='changed@example.test',parent_name='Changed parent',total_cents=9900 where id=$1", [orderId]);
    await f.db.query("update order_items set product_name='Changed product',line_total_cents=9900 where order_id=$1", [orderId]);
    await f.db.query("update photographers set business_name='Changed Studio',billing_email='changed-owner@example.test' where id=$1", [owner]);
    await f.db.query("update projects set title='Changed event',access_pin='changed-pin' where id=$1", [project]);
    await f.db.query("update schools set school_name='Changed school' where id=$1", [school]);
    await f.db.query("update students set first_name='Changed',pin='changed-student-pin' where id=$1", [student]);
    await f.ensure(orderId); await f.pay(orderId);
    assert.deepEqual(await f.emails(), before, 'replays and mutable source data must not rewrite frozen messages');
    const claimed = await f.claim();
    assert.equal(claimed.length, 2);
    assert.deepEqual(claimed[0].snapshot, frozen);
  } finally { await f.close(); }
});

test('digital purchases stage an additional unique message while pending and cancelled payments stage none', async () => {
  const f = await fixture();
  try {
    const physical = await f.insertOrder(id(100));
    const digital = await f.insertOrder(id(101), { digital: true });
    const cancelled = await f.insertOrder(id(102));
    await f.db.query("update orders set status='cancelled',payment_status='paid',paid_at=now() where id=$1", [cancelled]);
    assert.deepEqual(await f.emails(), []);
    await f.pay(physical); await f.pay(digital);
    assert.deepEqual((await f.emails()).map(row => [row.order_id, row.kind]), [
      [physical, 'photographer'], [physical, 'receipt'], [digital, 'digital'], [digital, 'photographer'], [digital, 'receipt'],
    ]);
    await f.pay(digital);
    assert.equal((await f.emails()).length, 5);
  } finally { await f.close(); }
});

test('Digital Retouching is a service and stages digital delivery only when a separate digital file product is present', async () => {
  const f = await fixture();
  try {
    const retouchOnly = await f.insertOrder(id(100));
    const withDigital = await f.insertOrder(id(101));
    await f.db.query("update orders set package_name='Digital Retouching' where id=any($1::uuid[])", [[retouchOnly, withDigital]]);
    await f.db.query("update order_items set product_name='Digital Retouching service' where order_id=any($1::uuid[])", [[retouchOnly, withDigital]]);
    await f.db.query("insert into order_items(order_id,product_name,quantity,price,unit_price_cents,line_total_cents) values($1,'Single digital file',1,25,2500,2500)", [withDigital]);
    await f.pay(retouchOnly); await f.pay(withDigital);
    const rows = await f.emails();
    assert.deepEqual(rows.filter(row => row.order_id === retouchOnly).map(row => row.kind), ['photographer', 'receipt']);
    assert.deepEqual(rows.filter(row => row.order_id === withDigital).map(row => row.kind), ['digital', 'photographer', 'receipt']);
  } finally { await f.close(); }
});

test('first-paid staging rejects refund authority and partially refunded payment states even if status remains paid', async () => {
  const f = await fixture();
  try {
    const cases = [
      { amount: 1, refund: null, payment: 'paid' },
      { amount: -1, refund: null, payment: 'paid' },
      { amount: 0, refund: 'refunded', payment: 'paid' },
      { amount: 0, refund: 'partial', payment: 'paid' },
      { amount: 0, refund: 'refund_pending', payment: 'paid' },
      { amount: 0, refund: 'none', payment: 'partially_refunded' },
    ];
    for (const [index, entry] of cases.entries()) {
      const orderId = await f.insertOrder(id(100 + index));
      await f.db.query("update orders set status='paid',payment_status=$2,paid_at=now(),refund_status=$3,refund_amount_cents=$4 where id=$1", [orderId, entry.payment, entry.refund, entry.amount]);
      assert.deepEqual(await f.ensure(orderId), [], `refund authority must reject case ${index + 1}`);
    }
    assert.deepEqual(await f.emails(), []);
    for (const [index, refund] of [null, '', 'none', 'not_refunded', 'not_requested'].entries()) {
      const orderId = await f.insertOrder(id(200 + index));
      await f.db.query("update orders set status='paid',payment_status=$2,paid_at=now(),refund_status=$3,refund_amount_cents=0 where id=$1", [orderId, ['paid', 'succeeded', 'no_payment_required'][index % 3], refund]);
      assert.equal((await f.ensure(orderId)).length, 2, `current paid state must permit refund marker ${String(refund)}`);
    }
    assert.equal((await f.emails()).length, 10);
  } finally { await f.close(); }
});

test('refund fields revoke already-leased preparation and cancel pending work while payment status remains paid', async () => {
  const f = await fixture();
  try {
    const cases = [
      { amount: 100, refund: 'none' },
      { amount: 0, refund: 'refunded' },
      { amount: 0, refund: 'refund_pending' },
    ];
    for (const index of cases.keys()) await f.pay(await f.insertOrder(id(100 + index)));
    const rows = await f.claim(); assert.equal(rows.length, 6);
    for (const [index, entry] of cases.entries()) await f.db.query('update orders set refund_amount_cents=$2,refund_status=$3 where id=$1', [id(100 + index), entry.amount, entry.refund]);
    for (const row of rows) assert.deepEqual(await f.prepare(row), [], 'current refund authority must stop provider preparation');
    assert.ok((await f.emails()).every(row => row.payload === null && row.first_attempt_at === null));
    await f.db.exec("update paid_order_emails set lease_until=now()-interval '1 second'");
    await f.release(rows[0].lease_token);
    assert.deepEqual(await f.claim(), []);
    assert.ok((await f.emails()).every(row => row.status === 'cancelled'));
    assert.ok((await f.db.query('select status,payment_status from orders')).rows.every(row => row.status === 'paid' && row.payment_status === 'paid'));
  } finally { await f.close(); }
});

test('frozen context excludes a foreign owner gallery and student even when order IDs point to them', async () => {
  const f = await fixture();
  try {
    await f.db.query('update projects set photographer_id=$1 where id=$2', [otherOwner, project]);
    await f.db.query('update schools set photographer_id=$1 where id=$2', [otherOwner, school]);
    await f.pay(await f.insertOrder());
    const rows = await f.emails(); assert.equal(rows.length, 2);
    for (const row of rows) assert.deepEqual(row.snapshot.context,
      { project_title: null, project_pin: null, school_name: null, student_name: null, student_pin: null });
  } finally { await f.close(); }
});

test('one global worker owns concurrent claims and only its token can release the three-minute lease', async () => {
  const f = await fixture();
  try {
    await f.pay(await f.insertOrder());
    const results = await Promise.all([f.claim(), f.claim()]);
    assert.deepEqual(results.map(rows => rows.length).sort(), [0, 2]);
    const first = results.find(rows => rows.length);
    const lease = (await f.db.query('select lease_token,extract(epoch from (lease_until-now()))::int seconds from paid_order_email_worker')).rows[0];
    assert.equal(lease.lease_token, first[0].lease_token);
    assert.ok(lease.seconds >= 178 && lease.seconds <= 180);
    await f.release(id(999));
    assert.deepEqual(await f.claim(), []);
    await f.db.exec("update paid_order_emails set lease_until=now()-interval '1 second'");
    assert.deepEqual(await f.claim(), [], 'row expiry cannot bypass a still-active global worker');
    await f.db.exec("update paid_order_email_worker set lease_until=now()-interval '1 second'");
    const recovered = await f.claim();
    assert.equal(recovered.length, 2);
    assert.notEqual(recovered[0].lease_token, first[0].lease_token);
    assert.equal(recovered[0].attempts, 2);
    assert.deepEqual(await f.prepare(first[0]), [], 'stale worker cannot prepare a recovered row');
    await f.release(first[0].lease_token);
    assert.deepEqual(await f.claim(), [], 'old release token cannot clear the new worker');
    await f.release(recovered[0].lease_token);
    assert.equal((await f.db.query('select lease_token from paid_order_email_worker')).rows[0].lease_token, null);
  } finally { await f.close(); }
});

test('prepare validates frozen recipient and stable key, persists before sending, and never changes a stored payload', async () => {
  const f = await fixture();
  try {
    await f.pay(await f.insertOrder(id(100), { digital: true }));
    const claimed = await f.claim();
    for (const row of claimed) {
      assert.deepEqual(await f.prepare(row, message(row, { to: 'foreign@example.test' })), []);
      assert.deepEqual(await f.prepare(row, message(row, { idempotencyKey: 'changed-key' })), []);
      assert.deepEqual(await f.prepare(row, message(row), id(999)), []);
      const payload = message(row);
      const first = await f.prepare(row, payload);
      assert.equal(first.length, 1);
      assert.deepEqual(first[0].payload, payload);
      assert.ok(first[0].first_attempt_at);
      const again = await f.prepare(row, message(row, { subject: 'Changed subject', html: '<p>Changed content</p>' }));
      assert.equal(again.length, 1);
      assert.deepEqual(again[0].payload, payload);
      assert.equal(again[0].first_attempt_at.getTime(), first[0].first_attempt_at.getTime());
    }
  } finally { await f.close(); }
});

test('expired provider idempotency windows and twenty attempts require review while cancellation stays terminal', async () => {
  const f = await fixture();
  try {
    for (const n of [100, 101, 102]) await f.pay(await f.insertOrder(id(n)));
    await f.db.query("update paid_order_emails set first_attempt_at=now()-interval '23 hours 1 second' where order_id=$1", [id(100)]);
    await f.db.query('update paid_order_emails set attempts=20 where order_id=$1', [id(101)]);
    await f.db.query("update paid_order_emails set status='cancelled' where order_id=$1", [id(102)]);
    assert.deepEqual(await f.claim(), []);
    assert.deepEqual((await f.emails()).map(row => row.status), ['needs_review', 'needs_review', 'needs_review', 'needs_review', 'cancelled', 'cancelled']);
    await f.pay(id(102)); await f.ensure(id(102));
    assert.deepEqual(await f.claim(), []);
    assert.equal((await f.emails()).filter(row => row.status === 'cancelled').length, 2);
  } finally { await f.close(); }
});

test('owner transfers, refund and cancellation invalidate claimed work before provider preparation', async () => {
  const f = await fixture();
  try {
    for (const n of [100, 101, 102]) await f.pay(await f.insertOrder(id(n)));
    const rows = await f.claim();
    await f.db.query('update orders set photographer_id=$1 where id=$2', [otherOwner, id(100)]);
    await f.db.query("update orders set status='refunded',payment_status='refunded',refund_status='refunded',refund_amount_cents=1800 where id=$1", [id(101)]);
    await f.db.query("update orders set status='cancelled' where id=$1", [id(102)]);
    for (const row of rows) assert.deepEqual(await f.prepare(row), []);
    assert.equal((await f.emails()).filter(row => row.payload !== null || row.first_attempt_at !== null).length, 0);
    assert.deepEqual(await f.ensure(id(100)), [], 'tracked work belongs to its original owner');
    await f.db.exec("update paid_order_emails set lease_until=now()-interval '1 second'");
    await f.release(rows[0].lease_token);
    assert.deepEqual(await f.claim(), []);
    assert.ok((await f.emails()).every(row => row.status === 'cancelled'));
  } finally { await f.close(); }
});

test('unprepared work older than the safe cutover window needs review instead of a historical automatic send', async () => {
  const f = await fixture();
  try {
    await f.pay(await f.insertOrder());
    await f.db.exec("update paid_order_emails set created_at=now()-interval '23 hours 1 second'");
    assert.ok((await f.emails()).every(row => row.first_attempt_at === null && row.payload === null && row.attempts === 0));
    assert.deepEqual(await f.claim(), []);
    assert.ok((await f.emails()).every(row => row.status === 'needs_review' && row.first_attempt_at === null && row.payload === null && row.attempts === 0));
    assert.equal((await f.db.query('select lease_token from paid_order_email_worker')).rows[0].lease_token, null);
  } finally { await f.close(); }
});

test('anonymous and authenticated roles cannot read, mutate, claim, prepare, ensure or release private email work', async () => {
  const f = await fixture();
  try {
    const orderId = await f.insertOrder(); await f.pay(orderId);
    const row = (await f.emails())[0];
    assert.ok((await f.db.query("select relrowsecurity from pg_class where oid in ('public.paid_order_emails'::regclass,'public.paid_order_email_worker'::regclass)")).rows.every(entry => entry.relrowsecurity));
    for (const role of ['anon', 'authenticated']) {
      await f.db.exec(`set role ${role}`);
      await assert.rejects(f.emails(), /permission denied/);
      await assert.rejects(f.db.query('select * from paid_order_email_worker'), /permission denied/);
      await assert.rejects(f.db.query("update paid_order_emails set status='sent' where id=$1", [row.id]), /permission denied/);
      await assert.rejects(f.ensure(orderId), /permission denied/);
      await assert.rejects(f.claim(), /permission denied/);
      await assert.rejects(f.prepare({ ...row, lease_token: id(999) }), /permission denied/);
      await assert.rejects(f.release(id(999)), /permission denied/);
      await f.db.exec('reset role');
    }
    await f.db.exec('set role service_role');
    assert.equal((await f.emails()).length, 2);
    assert.equal((await f.ensure(orderId)).length, 2);
    const rows = await f.claim(); assert.equal(rows.length, 2);
    assert.equal((await f.prepare(rows[0])).length, 1);
    await f.release(rows[0].lease_token);
    await f.db.exec('reset role');
  } finally { await f.close(); }
});
