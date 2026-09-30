import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const migration = readFileSync(new URL('../supabase/migrations/20260930012000_protect_photographer_billing.sql', import.meta.url), 'utf8');
test('photographers can edit their profile but cannot grant themselves free billing or reset access', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role;
      create table photographers(id uuid primary key default gen_random_uuid(),user_id uuid not null,business_name text,
        studio_email text,is_platform_admin boolean default false,subscription_status text default 'trial',
        subscription_plan_code text,order_usage_rate_cents integer default 55,stripe_platform_customer_id text,
        trial_ends_at timestamptz,created_at timestamptz default now());
      grant select,insert,update,delete on photographers to authenticated,service_role;
      insert into photographers(user_id,business_name) values('11111111-1111-4111-8111-111111111111','Test studio');`);
    await db.exec(migration);
    await db.exec('set role authenticated');
    await db.exec("update photographers set business_name='Updated studio',studio_email='studio@example.invalid'");
    for (const mutation of [
      'is_platform_admin=true',"subscription_status='active'", "subscription_plan_code='studio'",
      'order_usage_rate_cents=0', "stripe_platform_customer_id='cus_someone_else'",
      "trial_ends_at=now()+interval '10 years'", "created_at=now()+interval '10 years'",
      "user_id='22222222-2222-4222-8222-222222222222'",
    ]) await assert.rejects(() => db.exec(`update photographers set ${mutation}`), /Billing and access fields/);
    await assert.rejects(() => db.exec("insert into photographers(user_id,is_platform_admin) values(gen_random_uuid(),true)"), /permission denied/);
    await assert.rejects(() => db.exec('delete from photographers'), /permission denied/);
    await db.exec('reset role; set role service_role');
    await db.exec("update photographers set subscription_status='active',subscription_plan_code='core',order_usage_rate_cents=35");
    await db.exec('reset role');
    assert.deepEqual((await db.query('select business_name,is_platform_admin,subscription_status,order_usage_rate_cents from photographers')).rows[0], {
      business_name:'Updated studio',is_platform_admin:false,subscription_status:'active',order_usage_rate_cents:35,
    });
    await db.exec(`create function provision_trusted_trial() returns void language sql security definer as $$update photographers set trial_ends_at=now()+interval '30 days'$$;
      grant execute on function provision_trusted_trial() to authenticated; set role authenticated; select provision_trusted_trial();`);
    assert.ok((await db.query('select trial_ends_at from photographers')).rows[0].trial_ends_at);
  } finally { await db.close(); }
});
