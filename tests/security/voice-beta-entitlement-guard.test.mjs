import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../supabase/migrations/20261012100000_guard_voice_beta_entitlements.sql', import.meta.url), 'utf8');
const billingMigration = readFileSync(new URL('../../supabase/migrations/20260930012000_protect_photographer_billing.sql', import.meta.url), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const neighbor = '22222222-2222-4222-8222-222222222222';

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role anon;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    create table public.photographers(
      id uuid primary key default gen_random_uuid(), user_id uuid not null,
      business_name text, email text, phone text, address text, logo_url text,
      tax_enabled boolean default false, tax_percent numeric default 0,
      is_platform_admin boolean default false,
      subscription_status text default 'trial', subscription_plan_code text,
      trial_ends_at timestamptz, created_at timestamptz default now(),
      studio_app_beta_access boolean not null default false,
      voice_premium_enabled boolean not null default false,
      voice_monthly_char_limit integer not null default 1000
        check(voice_monthly_char_limit between 0 and 1000000),
      voice_chars_used_this_month integer not null default 0
        check(voice_chars_used_this_month>=0),
      voice_usage_period_start timestamptz not null default now()
    );
    alter table public.photographers enable row level security;
    create policy own_profile on public.photographers for all to authenticated
      using(user_id=auth.uid()) with check(user_id=auth.uid());
    grant select,insert,update,delete on public.photographers to authenticated,service_role;
  `);
  await db.query('insert into photographers(user_id,business_name) values($1,$2),($3,$4)', [owner, 'Own studio', neighbor, 'Other studio']);
  await db.exec(billingMigration);
  return db;
}

async function asOwner(db) {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
}

test('actual SQL blocks all five own-row entitlement changes while preserving normal desktop profile edits', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await asOwner(db);
    assert.equal((await db.query('select user_id from photographers')).rows.length, 1);
    const writes = [
      ['voice_premium_enabled', true],
      ['voice_monthly_char_limit', 1000000],
      ['voice_chars_used_this_month', 42],
      ['voice_usage_period_start', '2000-01-01T00:00:00Z'],
      ['studio_app_beta_access', true],
    ];
    for (const [column, value] of writes) {
      await assert.rejects(() => db.query(`update photographers set ${column}=$1 where user_id=$2`, [value, owner]),
        (error) => error.code === '42501' && /Voice and beta access fields/.test(error.message));
    }
    // A forged JWT role claim cannot change the invoker's SQL authority.
    await db.query("select set_config('request.jwt.claim.role','service_role',false)");
    await assert.rejects(() => db.query('update photographers set studio_app_beta_access=true'), /Voice and beta access fields/);
    await db.query(`update photographers set business_name=$1,email=$2,phone=$3,address=$4,
      logo_url=$5,tax_enabled=true,tax_percent=13,
      voice_premium_enabled=voice_premium_enabled,
      voice_monthly_char_limit=voice_monthly_char_limit,
      voice_chars_used_this_month=voice_chars_used_this_month,
      voice_usage_period_start=voice_usage_period_start,
      studio_app_beta_access=studio_app_beta_access`,
    ['Updated studio', 'owner@example.invalid', '+15555550100', 'Sample address', 'https://example.invalid/logo.png']);
    const current = (await db.query('select business_name,tax_enabled,tax_percent,voice_premium_enabled,voice_monthly_char_limit,voice_chars_used_this_month,studio_app_beta_access from photographers')).rows[0];
    assert.equal(current.business_name, 'Updated studio');
    assert.equal(current.tax_enabled, true);
    assert.equal(Number(current.tax_percent), 13);
    assert.equal(current.voice_premium_enabled, false);
    assert.equal(current.voice_monthly_char_limit, 1000);
    assert.equal(current.voice_chars_used_this_month, 0);
    assert.equal(current.studio_app_beta_access, false);
    assert.equal((await db.query('update photographers set business_name=$1 where user_id=$2 returning id', ['foreign', neighbor])).rows.length, 0);
    for (const mutation of ['is_platform_admin=true', "subscription_status='active'", "subscription_plan_code='studio'", "trial_ends_at=now()+interval '10 years'", `user_id='${neighbor}'`]) {
      await assert.rejects(() => db.exec(`update photographers set ${mutation}`), /Billing and access fields/);
    }
    await assert.rejects(() => db.query('insert into photographers(user_id,studio_app_beta_access) values($1,true)', [owner]), /permission denied/);
    await assert.rejects(() => db.exec('delete from photographers'), /permission denied/);
    await db.exec('reset role');
    assert.equal((await db.query('select business_name from photographers where user_id=$1', [neighbor])).rows[0].business_name, 'Other studio');
  } finally { await db.close(); }
});

test('actual SQL permits trusted entitlement administration, quota accounting and default signup inserts', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await db.exec('set role service_role');
    await db.query(`update photographers set voice_premium_enabled=true,voice_monthly_char_limit=50000,
      voice_chars_used_this_month=100,voice_usage_period_start='2026-01-01',studio_app_beta_access=true where user_id=$1`, [owner]);
    await db.query('insert into photographers(user_id) values($1)', ['33333333-3333-4333-8333-333333333333']);
    await db.exec('reset role');
    assert.deepEqual((await db.query('select voice_premium_enabled,voice_monthly_char_limit,voice_chars_used_this_month,studio_app_beta_access from photographers where user_id=$1', [owner])).rows[0], {
      voice_premium_enabled: true, voice_monthly_char_limit: 50000,
      voice_chars_used_this_month: 100, studio_app_beta_access: true,
    });
    const defaults = (await db.query('select voice_premium_enabled,voice_monthly_char_limit,voice_chars_used_this_month,studio_app_beta_access,voice_usage_period_start is not null as has_window from photographers where user_id=$1', ['33333333-3333-4333-8333-333333333333'])).rows[0];
    assert.deepEqual(defaults, { voice_premium_enabled: false, voice_monthly_char_limit: 1000, voice_chars_used_this_month: 0, studio_app_beta_access: false, has_window: true });
    // Synthetic trusted RPC verifies invoker behavior; no such new RPC is added
    // by the migration. Existing service-only quota routines retain this path.
    await db.exec(`create function trusted_voice_accounting(p_owner uuid) returns void language sql security definer as
      $$update public.photographers set voice_chars_used_this_month=voice_chars_used_this_month+5 where user_id=p_owner$$;
      revoke all on function trusted_voice_accounting(uuid) from public,anon,authenticated;
      grant execute on function trusted_voice_accounting(uuid) to service_role;
      set role service_role;`);
    await db.query('select trusted_voice_accounting($1)', [owner]);
    await asOwner(db);
    assert.equal((await db.query('select voice_chars_used_this_month from photographers')).rows[0].voice_chars_used_this_month, 105);
    await assert.rejects(() => db.query('update photographers set voice_chars_used_this_month=0'), /Voice and beta access fields/);
    await assert.rejects(() => db.query('select trusted_voice_accounting($1)', [owner]), /permission denied/);
  } finally { await db.close(); }
});

test('additive guard is repeatable, not client executable, and preserves existing billing guard and ACL', async () => {
  const db = await fixture();
  try {
    const snapshot = async () => (await db.query(`select
      pg_get_functiondef('public.protect_photographer_billing_fields()'::regprocedure) as billing_function,
      (select proacl::text from pg_proc where oid='public.protect_photographer_billing_fields()'::regprocedure) as billing_acl,
      (select relacl::text from pg_class where oid='public.photographers'::regclass) as table_acl,
      (select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.photographers'::regclass and tgname='protect_photographer_billing') as billing_trigger`)).rows[0];
    const before = await snapshot();
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual(await snapshot(), before);
    const state = (await db.query(`select
      (select count(*)::integer from pg_trigger where tgrelid='public.photographers'::regclass and tgname='protect_photographer_voice_beta_entitlements' and tgenabled='O') as triggers,
      (select prosecdef from pg_proc where oid='public.protect_photographer_voice_beta_entitlements()'::regprocedure) as definer,
      has_function_privilege('authenticated','public.protect_photographer_voice_beta_entitlements()','execute') as authenticated_execute,
      has_function_privilege('anon','public.protect_photographer_voice_beta_entitlements()','execute') as anon_execute`)).rows[0];
    assert.deepEqual(state, { triggers: 1, definer: false, authenticated_execute: false, anon_execute: false });
    await db.exec(`drop trigger protect_photographer_voice_beta_entitlements on public.photographers;
      drop function public.protect_photographer_voice_beta_entitlements();`);
    assert.deepEqual(await snapshot(), before);
    assert.equal((await db.query("select to_regprocedure('public.protect_photographer_voice_beta_entitlements()') as f")).rows[0].f, null);
  } finally { await db.close(); }
});
