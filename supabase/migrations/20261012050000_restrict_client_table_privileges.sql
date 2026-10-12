-- Browser and desktop clients require CRUD, never table administration.
-- TRUNCATE bypasses row-level security; TRIGGER/REFERENCES are DDL privileges.
-- Preserve existing CRUD policies/grants, RPC execution and service privileges.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $privileges$
declare target record;
begin
  for target in
    select n.nspname schema_name,c.relname table_name
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
  loop
    execute format('revoke truncate,trigger,references on table %I.%I from anon,authenticated',target.schema_name,target.table_name);
  end loop;

  -- An unexpected PUBLIC grant, inherited role or client-owned table must
  -- abort atomically instead of leaving an effective administrative privilege.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    cross join (values ('anon'),('authenticated')) client(role_name)
    cross join (values ('TRUNCATE'),('TRIGGER'),('REFERENCES')) privilege(privilege_name)
    where n.nspname='public' and c.relkind in ('r','p')
      and has_table_privilege(client.role_name,c.oid,privilege.privilege_name)
  ) then
    raise exception 'Unexpected inherited client table privilege; review ACLs before retrying';
  end if;
end
$privileges$;
commit;
