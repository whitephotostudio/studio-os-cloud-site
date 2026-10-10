begin;

-- These columns live outside gallery_settings, which desktop sync replaces.
-- Existing galleries retain On; a nullable school value means Use default.
-- No original/cutout objects, roster rows or order snapshots are rewritten.
alter table public.photographers
  add column if not exists online_backdrops_enabled boolean not null default true;
alter table public.schools
  add column if not exists online_backdrops_override boolean default null;

-- Owners save through the authenticated server endpoints. Old desktop sync
-- omits these fields and remains valid, including new-school inserts.
create or replace function public.protect_online_backdrop_policy() returns trigger
language plpgsql set search_path=public as $$
begin
  if current_user in ('postgres','service_role','supabase_admin') then return new; end if;
  if tg_table_name='photographers' then
    if (tg_op='INSERT' and new.online_backdrops_enabled is distinct from true)
      or (tg_op='UPDATE' and new.online_backdrops_enabled is distinct from old.online_backdrops_enabled) then
      raise exception 'Save online backdrop settings through Studio OS.' using errcode='42501';
    end if;
  elsif tg_table_name='schools' then
    if (tg_op='INSERT' and new.online_backdrops_override is not null)
      or (tg_op='UPDATE' and new.online_backdrops_override is distinct from old.online_backdrops_override) then
      raise exception 'Save gallery backdrop settings through Studio OS.' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_online_backdrop_policy on public.photographers;
create trigger protect_online_backdrop_policy before insert or update on public.photographers
  for each row execute function public.protect_online_backdrop_policy();
drop trigger if exists protect_online_backdrop_policy on public.schools;
create trigger protect_online_backdrop_policy before insert or update on public.schools
  for each row execute function public.protect_online_backdrop_policy();

create or replace function public.online_backdrop_policy_schema_status() returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'version',1,
    'columns_ready',(select count(*)=2 from information_schema.columns
      where table_schema='public' and data_type='boolean' and
        ((table_name='photographers' and column_name='online_backdrops_enabled' and is_nullable='NO' and column_default='true')
          or (table_name='schools' and column_name='online_backdrops_override' and is_nullable='YES'))),
    'client_policy_guard_ready',(select count(*)=2 from pg_trigger t
      where t.tgrelid in ('public.photographers'::regclass,'public.schools'::regclass)
        and t.tgname='protect_online_backdrop_policy' and t.tgenabled<>'D' and not t.tgisinternal),
    'service_only',has_function_privilege('service_role','public.online_backdrop_policy_schema_status()','EXECUTE')
      and not has_function_privilege('anon','public.online_backdrop_policy_schema_status()','EXECUTE')
      and not has_function_privilege('authenticated','public.online_backdrop_policy_schema_status()','EXECUTE')
  );
$$;
revoke all on function public.online_backdrop_policy_schema_status() from public,anon,authenticated;
grant execute on function public.online_backdrop_policy_schema_status() to service_role;

commit;
