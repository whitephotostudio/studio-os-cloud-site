-- Keep future postgres-owned public tables from restoring client DDL powers.
-- CRUD, RPC execution defaults and service_role remain unchanged.
begin;
alter default privileges for role postgres in schema public
revoke truncate,trigger,references on tables from anon,authenticated;

do $defaults$
begin
  if exists (
    select 1 from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    where d.defaclrole='postgres'::regrole and d.defaclobjtype='r'
      and (d.defaclnamespace=0 or d.defaclnamespace='public'::regnamespace)
      and a.grantee in(0,'anon'::regrole,'authenticated'::regrole)
      and a.privilege_type in('TRUNCATE','TRIGGER','REFERENCES')
  ) then
    raise exception 'Unexpected global or PUBLIC default client table privilege; review ACLs before retrying';
  end if;
end
$defaults$;
commit;
