import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260924160000_order_payment_safety.sql', import.meta.url),'utf8');
test('database replays interrupted/concurrent checkouts atomically and protects financial closure', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table orders (id uuid primary key, photographer_id uuid, parent_name text,parent_email text,parent_phone text,
      customer_name text,customer_email text,package_id uuid,package_name text,package_price numeric,special_notes text,notes text,
      status text,payment_status text,seen_by_photographer boolean,subtotal_cents integer,tax_cents integer,total_cents integer,total_amount numeric,
      currency text,cart_snapshot jsonb,school_id uuid,class_id uuid,student_id uuid,project_id uuid,order_group_id uuid,refund_status text,refund_amount_cents integer);
      create table order_items(id uuid default gen_random_uuid(), order_id uuid references orders(id),product_name text,quantity integer check(quantity>0),price numeric,unit_price_cents integer,line_total_cents integer,sku text);`);
    await db.exec(migration);
    const order = {id:crypto.randomUUID(),photographer_id:crypto.randomUUID(),total_cents:10360,subtotal_cents:9168,tax_cents:1192,currency:'cad'};
    const item = {order_id:order.id,product_name:'Prints',quantity:1,price:91.68,unit_price_cents:9168,line_total_cents:9168};
    const create = (key,hash,orders=[order],items=[item]) => db.query('select create_checkout_order_once($1,$2,$3,$4,$5) as result',[key,hash,JSON.stringify(orders),JSON.stringify(items),JSON.stringify({ok:true,orderId:orders[0].id})]);
    const results = await Promise.all(Array.from({length:12},()=>create('attempt','cart')));
    results.forEach(r=>assert.equal(r.rows[0].result.orderId,order.id));
    const duplicate = {...order,id:crypto.randomUUID()};
    const replay = await create('second-tab','cart',[duplicate],[{...item,order_id:duplicate.id}]);
    assert.equal(replay.rows[0].result.orderId,order.id);
    assert.equal((await db.query('select count(*)::int as n from orders')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int as n from order_items')).rows[0].n,1);
    await assert.rejects(()=>create('attempt','different-cart'));
    const broken = {...order,id:crypto.randomUUID()};
    await assert.rejects(()=>create('broken','broken-cart',[broken],[{...item,order_id:broken.id,quantity:0}]));
    assert.equal((await db.query('select count(*)::int as n from orders')).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int as n from checkout_attempts where key='broken'")).rows[0].n,0);
    const token=crypto.randomUUID();
    assert.equal((await db.query('select acquire_order_payment_lock($1,$2) as locked',[order.id,token])).rows[0].locked,true);
    assert.equal((await db.query('select acquire_order_payment_lock($1,$2) as locked',[order.id,crypto.randomUUID()])).rows[0].locked,false);
    await db.query("update orders set status='refunded',payment_status='refunded',refund_status='refunded',refund_amount_cents=10360 where id=$1",[order.id]);
    for(const stale of ['paid','ready','completed','refund_pending']) {
      await db.query('update orders set status=$1,payment_status=\'paid\' where id=$2',[stale,order.id]);
      const row=(await db.query('select status,payment_status from orders where id=$1',[order.id])).rows[0];
      assert.deepEqual(row,{status:'refunded',payment_status:'refunded'});
    }
    await db.exec('set role anon');
    await assert.rejects(()=>create('anon','anon-cart'));
    await assert.rejects(()=>db.query('select * from checkout_attempts'));
  } finally { await db.close(); }
});
