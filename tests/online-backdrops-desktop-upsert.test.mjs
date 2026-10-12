import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const userA = id(1), userB = id(2), studioA = id(11), studioB = id(12);
const schools = [id(21), id(22), id(23)], foreignSchool = id(24);
const migration = readFileSync(new URL('../supabase/migrations/20261010190000_online_backdrop_controls.sql', import.meta.url), 'utf8');

test('authenticated legacy desktop upserts preserve studio Off and each school override, while RLS keeps other studios unchanged', async context => {
  const db = new PGlite();
  context.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table public.photographers(
      id uuid primary key,user_id uuid not null unique,business_name text,logo_url text);
    create table public.schools(
      id uuid primary key default gen_random_uuid(),photographer_id uuid not null,local_school_id text not null,
      school_name text,shoot_date date,status text,email_required boolean default true,
      gallery_settings jsonb default '{}',unique(local_school_id,photographer_id));
    insert into photographers(id,user_id,business_name) values
      ('${studioA}','${userA}','Studio A'),('${studioB}','${userB}','Studio B');
    insert into schools(id,photographer_id,local_school_id,school_name) values
      ('${schools[0]}','${studioA}','local-on','On school'),
      ('${schools[1]}','${studioA}','local-off','Off school'),
      ('${schools[2]}','${studioA}','local-inherit','Inherit school'),
      ('${foreignSchool}','${studioB}','local-foreign','Other studio school');
    alter table photographers enable row level security;
    create policy studio_owner on photographers for all to authenticated
      using(user_id=auth.uid()) with check(user_id=auth.uid());
    alter table schools enable row level security;
    create policy school_owner on schools for all to authenticated
      using(exists(select 1 from photographers p where p.id=photographer_id and p.user_id=auth.uid()))
      with check(exists(select 1 from photographers p where p.id=photographer_id and p.user_id=auth.uid()));
    grant select,insert,update on photographers,schools to authenticated;
  `);
  await db.exec(migration);
  await db.query('update photographers set online_backdrops_enabled=false where id=$1', [studioA]);
  for (const [index, override] of [true, false, null].entries()) {
    await db.query('update schools set online_backdrops_override=$1 where id=$2', [override, schools[index]]);
  }
  const foreignBefore = {
    photographer: (await db.query('select * from photographers where id=$1', [studioB])).rows,
    school: (await db.query('select * from schools where id=$1', [foreignSchool])).rows,
  };
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userA]);
  await db.exec('set role authenticated');

  // PostgREST's merge-duplicates upsert updates the JSON payload's supplied
  // columns, not every table column. The INSERT trigger still runs before
  // conflict resolution, so both trigger phases must accept old payloads.
  await db.query(`insert into photographers(id,user_id,business_name) values($1,$2,$3)
    on conflict(user_id) do update set business_name=excluded.business_name`,
  [studioA, userA, 'Desktop profile retry']);

  for (const [index, localId] of ['local-on', 'local-off', 'local-inherit'].entries()) {
    // supabase_service.dart addSchool: omitted policy columns must stay saved.
    await db.query(`insert into schools(photographer_id,local_school_id,school_name,shoot_date)
      values($1,$2,$3,$4) on conflict(local_school_id,photographer_id)
      do update set school_name=excluded.school_name,shoot_date=excluded.shoot_date`,
    [studioA, localId, `Desktop school retry ${index}`, '2026-10-19']);

    // cloud_sync_service.dart createCalendarBooking adds status/email fields
    // and then updates gallery_settings separately; neither resets policy.
    await db.query(`insert into schools(photographer_id,local_school_id,school_name,shoot_date,status,email_required)
      values($1,$2,$3,$4,$5,$6) on conflict(local_school_id,photographer_id)
      do update set school_name=excluded.school_name,shoot_date=excluded.shoot_date,
        status=excluded.status,email_required=excluded.email_required`,
    [studioA, localId, `Desktop calendar retry ${index}`, '2026-10-19', 'active', true]);
    await db.query('update schools set gallery_settings=$1 where id=$2',
      [{ schedule: { location: 'Desktop location' } }, schools[index]]);
  }
  assert.equal((await db.query('select online_backdrops_enabled from photographers where id=$1', [studioA])).rows[0].online_backdrops_enabled, false);
  assert.deepEqual((await db.query('select online_backdrops_override from schools order by id')).rows,
    [true, false, null].map(online_backdrops_override => ({ online_backdrops_override })));

  // A foreign target cannot use an otherwise valid legacy payload to bypass
  // tenant ownership or indirectly reset another studio's online policy.
  await assert.rejects(db.query(`insert into schools(photographer_id,local_school_id,school_name)
    values($1,$2,$3) on conflict(local_school_id,photographer_id)
    do update set school_name=excluded.school_name`,
  [studioB, 'local-foreign', 'Forged foreign retry']), /row-level security/);
  await assert.rejects(db.query(`insert into photographers(id,user_id,business_name)
    values($1,$2,$3) on conflict(user_id) do update set business_name=excluded.business_name`,
  [studioB, userB, 'Forged foreign profile']), /row-level security/);
  await db.exec('reset role');
  assert.deepEqual((await db.query('select * from photographers where id=$1', [studioB])).rows, foreignBefore.photographer);
  assert.deepEqual((await db.query('select * from schools where id=$1', [foreignSchool])).rows, foreignBefore.school);
  assert.deepEqual((await db.query('select school_name from schools where photographer_id=$1 order by id', [studioA])).rows,
    [0, 1, 2].map(index => ({ school_name: `Desktop calendar retry ${index}` })),
    'the legacy upserts actually update their intended fields while retaining policies');
});
