import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../supabase/migrations/20261012010000_enforce_session_mfa.sql', import.meta.url), 'utf8');
const users = ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004'];
const rpcs = [
  ['claim_desktop_app_access', 'p_device_id text,p_device_name text,p_platform text,p_app_version text', "'device',null,null,null"],
  ['deactivate_photography_key', 'p_key_id uuid', 'null'],
  ['deduct_studio_credits', 'p_amount integer,p_operation text,p_method text,p_photo_path text,p_description text,p_billing_reference text', '1,null,null,null,null,null'],
  ['finalize_background_credit_job', 'p_billing_reference text,p_description text', 'null,null'],
  ['get_studio_credit_balance', 'p_studio_id uuid', 'null'],
  ['refund_studio_credits', 'p_amount integer,p_billing_reference text,p_description text,p_operation text,p_method text', '1,null,null,null,null'],
  ['register_studio_cutout_entitlement', 'p_original_sha256 text,p_cutout_sha256 text,p_billing_reference text,p_cloud_job_id uuid', 'null,null,null,null'],
  ['release_desktop_app_access', 'p_device_id text', "'device'"],
];
const sales = [
  ['convert_sales_quote','p_quote_id uuid,p_expected_version bigint,p_client_request_id text'],
  ['create_sales_document','p_kind text,p_client_request_id text,p_document jsonb,p_preserve_number boolean'],
  ['delete_sales_document','p_document_id uuid,p_expected_version bigint'],
  ['ensure_sales_settings',''],
  ['transition_sales_document','p_document_id uuid,p_expected_version bigint,p_action text,p_paid_at timestamp with time zone'],
  ['update_sales_document','p_document_id uuid,p_expected_version bigint,p_document jsonb'],
  ['upsert_sales_settings','p_expected_version bigint,p_settings jsonb'],
];

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create table auth.mfa_factors(user_id uuid,status text);
    create table public.photographers(id uuid primary key,user_id uuid,is_platform_admin boolean default false);
    create table public.subscriptions(user_id uuid,is_admin boolean default false);
    create table public.private_rows(id integer primary key,user_id uuid,value text);
    create table public.rpc_writes(kind text);
    create table storage.objects(id integer primary key,bucket_id text,name text,user_id uuid);
    alter table public.photographers enable row level security;
    alter table public.subscriptions enable row level security;
    alter table public.private_rows enable row level security;
    alter table public.rpc_writes enable row level security;
    alter table storage.objects enable row level security;
    create policy own_profile on public.photographers for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    create policy own_subscription on public.subscriptions for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    create policy own_rows on public.private_rows for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    create policy own_objects on storage.objects for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
    create policy public_art on storage.objects for select to public using(bucket_id in('backdrops','studio-logos'));
    grant usage on schema auth,storage,public to anon,authenticated,service_role;
    grant all on all tables in schema public,storage to authenticated,service_role;
    grant select on public.private_rows,storage.objects to anon;
    create function public._has_cutout_entitlement(uuid,text,text) returns boolean language sql stable as $$select true$$;
    create function public.handle_new_user() returns trigger language plpgsql security definer as $$begin return new; end$$;
    create function public.lock_orders_photographer_id() returns trigger language plpgsql security definer as $$begin return new; end$$;
    create function public._sales_current_photographer_id() returns uuid language plpgsql security definer as $$
begin
      return auth.uid();
    end$$;
    revoke all on function public._sales_current_photographer_id() from public,anon,authenticated;
    grant execute on function public._sales_current_photographer_id() to service_role;
  `);
  for (let index=0; index<users.length; index++) {
    await db.query('insert into public.photographers values($1,$1,$2)',[users[index],index>=2]);
    await db.query('insert into public.private_rows values($1,$2,$3)',[index+1,users[index],'private']);
    await db.query('insert into storage.objects values($1,$2,$3,$4)',[index+1,'photos','private',users[index]]);
  }
  await db.exec(`insert into storage.objects values(99,'backdrops','public',null);
    insert into auth.mfa_factors values('${users[1]}','verified'),('${users[3]}','verified');`);
  for (const [name,args] of rpcs) await db.exec(`create function public.${name}(${args}) returns integer language plpgsql security definer as $$
begin
    insert into public.rpc_writes values('${name}');
    return 1;
  end$$;`);
  for (const [name,args] of sales) await db.exec(`create function public.${name}(${args}) returns uuid language sql security definer as $$select public._sales_current_photographer_id()$$;`);
  return db;
}

async function asUser(db,index,aal='aal1',role='authenticated') {
  await db.exec(`reset role; set role ${role};`);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:users[index],aal,role})]);
}

test('actual MFA SQL migration preserves tenant isolation, native no-factor accounts and enrollment access', async () => {
  const db=await fixture();
  try {
    await db.exec(migration);
    await asUser(db,0);
    assert.deepEqual((await db.query('select id from private_rows')).rows,[{id:1}]);
    await db.query('update private_rows set value=$1 where id=1',['native allowed']);
    assert.equal((await db.query('select release_desktop_app_access($1) as result',['native-device'])).rows[0].result,1);
    await assert.rejects(()=>db.query('select * from auth.mfa_factors'),/permission denied/);
    await asUser(db,1);
    assert.equal((await db.query('select * from private_rows')).rows.length,0);
    assert.equal((await db.query('update private_rows set value=\'blocked\' returning id')).rows.length,0);
    await assert.rejects(()=>db.query('insert into private_rows values(20,$1,$2)',[users[1],'blocked']),/row-level security/);
    assert.deepEqual((await db.query('select id from storage.objects')).rows,[{id:99}]);
    assert.equal((await db.query('delete from storage.objects where id=2 returning id')).rows.length,0);
    await asUser(db,1,'aal2');
    assert.deepEqual((await db.query('select id from private_rows')).rows,[{id:2}]);
    assert.deepEqual((await db.query('select id from storage.objects order by id')).rows,[{id:2},{id:99}]);
    assert.equal((await db.query('update private_rows set value=\'verified\' returning id')).rows.length,1);
    await asUser(db,2);
    assert.deepEqual((await db.query('select id from photographers')).rows,[{id:users[2]}]);
    assert.equal((await db.query('select * from private_rows')).rows.length,0);
    assert.equal((await db.query('update photographers set is_platform_admin=false returning id')).rows.length,0);
    await db.exec('reset role');
    await db.query('insert into auth.mfa_factors values($1,$2)',[users[2],'verified']);
    await asUser(db,2,'aal2');
    assert.deepEqual((await db.query('select id from private_rows')).rows,[{id:3}]);
    await asUser(db,3,'aal1','service_role');
    assert.equal((await db.query('select * from private_rows')).rows.length,4);
    assert.equal((await db.query("select release_desktop_app_access('server') as result")).rows[0].result,1);
    await db.exec('reset role; set role anon');
    assert.equal((await db.query('select * from private_rows')).rows.length,0);
    assert.deepEqual((await db.query('select id from storage.objects')).rows,[{id:99}]);
  } finally {await db.close();}
});

test('actual SQL guards prevent SECURITY DEFINER bypass through every reviewed native/credit and sales RPC', async () => {
  const db=await fixture();
  try {
    await db.exec(migration);
    for (const user of [1,2]) {
      await asUser(db,user);
      for (const [name,,args] of rpcs) await assert.rejects(()=>db.query(`select public.${name}(${args})`),/two-step verification/);
      await assert.rejects(()=>db.query('select ensure_sales_settings()'),/two-step verification/);
      assert.equal((await db.query('select current_photographer_id() as id')).rows[0].id,null);
      assert.equal((await db.query("select get_studio_cutout_entitlement('source','cutout') as allowed")).rows[0].allowed,false);
    }
    await asUser(db,3,'aal2');
    for (const [name,,args] of rpcs) assert.equal((await db.query(`select public.${name}(${args}) as result`)).rows[0].result,1);
    assert.equal((await db.query('select ensure_sales_settings() as id')).rows[0].id,users[3]);
    assert.equal((await db.query('select current_photographer_id() as id')).rows[0].id,users[3]);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::integer as count from rpc_writes')).rows[0].count,8);
    assert.equal((await db.query("select has_function_privilege('anon','public.deactivate_photography_key(uuid)','execute') as allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege('authenticated','public.handle_new_user()','execute') as allowed")).rows[0].allowed,false);
  } finally {await db.close();}
});

test('unreviewed elevated client RPC aborts the migration transaction instead of silently leaving a bypass', async () => {
  const db=await fixture();
  try {
    await db.exec('create function public.unreviewed_rpc() returns integer language sql security definer as $$select 1$$;');
    await assert.rejects(()=>db.exec(migration),/unreviewed authenticated SECURITY DEFINER/);
    await db.exec('rollback');
    assert.equal((await db.query("select count(*)::integer as count from pg_policies where policyname like 'session_mfa_%'")).rows[0].count,0);
  } finally {await db.close();}
});
