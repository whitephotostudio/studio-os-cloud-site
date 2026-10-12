import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync(new URL('../../supabase/migrations/20261012050000_restrict_client_table_privileges.sql',import.meta.url),'utf8');
const defaultsMigration=readFileSync(new URL('../../supabase/migrations/20261012070000_restrict_default_client_table_privileges.sql',import.meta.url),'utf8');

async function fixture() {
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table public.client_data(id integer primary key,value text);
    insert into public.client_data values(1,'preserved');
    alter table public.client_data enable row level security;
    create policy own_row on public.client_data for all to authenticated using(id=1) with check(id=1);
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant all on public.client_data to anon,authenticated,service_role;
    create table auth.provider_data(id integer);
    grant all on auth.provider_data to authenticated;
    create function public.client_rpc() returns integer language sql as $$select 1$$;
    grant execute on function public.client_rpc() to authenticated,service_role;
  `);
  return db;
}

test('actual privilege migration removes only client table administration and prevents RLS-bypassing truncate',async()=>{
  const db=await fixture();
  try {
    const serviceBefore=(await db.query("select relacl::text acl from pg_class where oid='public.client_data'::regclass")).rows[0].acl;
    await db.exec(migration);
    for(const role of ['anon','authenticated'])for(const privilege of ['TRUNCATE','TRIGGER','REFERENCES']) {
      assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,'public.client_data',privilege])).rows[0].allowed,false);
    }
    for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']) {
      assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,'public.client_data',privilege])).rows[0].allowed,true);
    }
    for(const privilege of ['TRUNCATE','TRIGGER','REFERENCES'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',['service_role','public.client_data',privilege])).rows[0].allowed,true);
    assert.equal((await db.query("select has_table_privilege('authenticated','auth.provider_data','TRUNCATE') allowed")).rows[0].allowed,true,'provider schema is outside scope');
    assert.equal((await db.query("select has_function_privilege('authenticated','public.client_rpc()','EXECUTE') allowed")).rows[0].allowed,true);
    await db.exec('set role anon');
    assert.equal((await db.query('select count(*) count from public.client_data')).rows[0].count,0);
    await assert.rejects(()=>db.exec('truncate public.client_data'),/permission denied/);
    await db.exec('reset role; set role authenticated');
    assert.deepEqual((await db.query("update public.client_data set value='allowed' where id=1 returning id")).rows,[{id:1}]);
    assert.equal((await db.query('select public.client_rpc() value')).rows[0].value,1);
    await db.exec('reset role');
    assert.match(serviceBefore,/service_role=arwdDxt/);
    assert.equal((await db.query('select count(*) count from public.client_data')).rows[0].count,1);
    await db.exec(migration);
  }finally{await db.close();}
});

test('future public table defaults preserve CRUD/service privileges while removing client table administration',async()=>{
  const db=await fixture();
  try {
    await db.exec(`alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
      alter default privileges for role postgres in schema auth grant all on tables to authenticated;
      alter default privileges for role postgres in schema public grant execute on functions to authenticated;`);
    await db.exec(defaultsMigration);
    await db.exec('create table public.future_table(id integer);create table auth.future_provider_table(id integer);create function public.future_rpc() returns integer language sql as $$select 1$$;');
    for(const role of ['anon','authenticated'])for(const privilege of ['TRUNCATE','TRIGGER','REFERENCES'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,'public.future_table',privilege])).rows[0].allowed,false);
    for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,'public.future_table',privilege])).rows[0].allowed,true);
    for(const privilege of ['TRUNCATE','TRIGGER','REFERENCES'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',['service_role','public.future_table',privilege])).rows[0].allowed,true);
    assert.equal((await db.query("select has_table_privilege('authenticated','auth.future_provider_table','TRUNCATE') allowed")).rows[0].allowed,true);
    assert.equal((await db.query("select has_function_privilege('authenticated','public.future_rpc()','EXECUTE') allowed")).rows[0].allowed,true);
    await db.exec(defaultsMigration);
  }finally{await db.close();}
});

test('global defaults cannot silently override the scoped revoke',async()=>{
  const db=await fixture();
  try {
    await db.exec('alter default privileges for role postgres grant truncate on tables to anon;');
    await assert.rejects(()=>db.exec(defaultsMigration),/Unexpected global or PUBLIC default client table privilege/);
    await db.exec('rollback');
  }finally{await db.close();}
});

test('unexpected inherited or PUBLIC administrative privileges abort all revokes atomically',async()=>{
  for(const inherited of [false,true]) {
    const db=await fixture();
    try {
      await db.exec(inherited?`create role legacy_admin;grant legacy_admin to authenticated;grant truncate on public.client_data to legacy_admin;`:`grant truncate on public.client_data to public;`);
      await assert.rejects(()=>db.exec(migration),/Unexpected inherited client table privilege/);
      await db.exec('rollback');
      assert.equal((await db.query("select has_table_privilege('anon','public.client_data','TRIGGER') allowed")).rows[0].allowed,true,'failed migration preserves original ACLs');
    }finally{await db.close();}
  }
});
