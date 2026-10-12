-- Reserve legacy photographer UUID roots and bind every retained namespace
-- to its first authenticated account, including after photographer deletion.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.photographers,public.projects,public.schools,public.school_storage_root_claims in share row exclusive mode;
create table if not exists public.r2_photographer_namespace_ownership (
  photographer_id uuid primary key,
  user_id uuid not null,
  recorded_at timestamptz not null default now()
);
alter table public.r2_photographer_namespace_ownership enable row level security;
revoke all on public.r2_photographer_namespace_ownership from public,anon,authenticated;
grant select on public.r2_photographer_namespace_ownership to service_role;
-- No cascading FK: deletion cannot free an account's existing photo namespace.
insert into public.r2_photographer_namespace_ownership(photographer_id,user_id)
select id,user_id from public.photographers on conflict(photographer_id) do nothing;
do $verify$
begin
  if exists(select 1 from public.photographers p join public.r2_photographer_namespace_ownership r on r.photographer_id=p.id where p.user_id is distinct from r.user_id)
    or exists(select 1 from public.r2_namespace_ownership r join public.r2_photographer_namespace_ownership p on p.photographer_id::text=r.root
      where r.scope_kind='school' and r.photographer_id<>p.photographer_id) then
    raise exception 'R2 namespace belongs to its original studio owner' using errcode='42501';
  end if;
end
$verify$;
create or replace function public.retain_r2_photographer_namespace_owner()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare original_user uuid;
begin
  if new.user_id is null then raise exception 'R2 photographer requires an established account' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('studio-os-r2-root:'||new.id::text,0));
  if exists(select 1 from public.r2_namespace_ownership r where r.scope_kind='school'
      and r.root=new.id::text and r.photographer_id<>new.id) then
    raise exception 'R2 namespace belongs to its original studio owner' using errcode='42501';
  end if;
  insert into public.r2_photographer_namespace_ownership(photographer_id,user_id)
  values(new.id,new.user_id) on conflict(photographer_id) do nothing;
  select user_id into original_user from public.r2_photographer_namespace_ownership
  where photographer_id=new.id for key share;
  if original_user is distinct from new.user_id then
    raise exception 'R2 namespace belongs to its original authenticated account' using errcode='42501';
  end if;
  return new;
end
$function$;
revoke all on function public.retain_r2_photographer_namespace_owner() from public,anon,authenticated,service_role;
drop trigger if exists retain_r2_photographer_namespace_owner on public.photographers;
create trigger retain_r2_photographer_namespace_owner before insert or update of id,user_id on public.photographers
for each row execute function public.retain_r2_photographer_namespace_owner();
create or replace function public._claim_r2_namespace(p_kind text,p_root text,p_owner uuid,p_resource uuid)
returns void language plpgsql security definer set search_path=''
as $function$
declare existing_owner uuid; normalized_root text:=lower(btrim(p_root));
begin
  if p_owner is null or p_resource is null then
    raise exception 'R2 namespace requires an established studio owner' using errcode='42501';
  end if;
  -- Serialize both school and photographer claims for the same root.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('studio-os-r2-root:'||normalized_root,0));
  if p_kind='school' and exists(select 1 from public.r2_photographer_namespace_ownership p
      where p.photographer_id::text=normalized_root and p.photographer_id<>p_owner) then
    raise exception 'R2 namespace belongs to its original studio owner' using errcode='42501';
  end if;
  insert into public.r2_namespace_ownership(scope_kind,root,photographer_id,resource_id)
  values(p_kind,lower(btrim(p_root)),p_owner,p_resource)
  on conflict(scope_kind,root) do nothing;
  select photographer_id into existing_owner from public.r2_namespace_ownership
    where scope_kind=p_kind and root=lower(btrim(p_root)) for key share;
  if existing_owner is distinct from p_owner then
    raise exception 'R2 namespace belongs to its original studio owner' using errcode='42501';
  end if;
end
$function$;
revoke all on function public._claim_r2_namespace(text,text,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.r2_media_namespace_owner(
  p_kind text,p_root text,p_allow_photographer_root boolean default false,p_allow_deleted_resource boolean default false
) returns table(photographer_id uuid,school_id uuid)
language plpgsql stable security definer set search_path=''
as $function$
declare frozen public.r2_namespace_ownership%rowtype; current_owner uuid; current_school uuid; school_matches integer;
begin
  if p_root is null or p_root<>btrim(p_root) or p_root='' or position('/' in p_root)>0 then return; end if;
  if p_kind='photographer' then
    return query select p.id,null::uuid from public.photographers p join public.r2_photographer_namespace_ownership original on original.photographer_id=p.id and original.user_id=p.user_id where p.id::text=lower(p_root);
    return;
  end if;
  if p_kind not in ('project','school') then return; end if;
  select * into frozen from public.r2_namespace_ownership r where r.scope_kind=p_kind and r.root=lower(p_root);
  if not found then
    -- Legacy photographer-root paths remain valid only when no school has
    -- ever claimed that root and no current ambiguous school alias exists.
    if p_kind='school' and p_allow_photographer_root and not exists(
      select 1 from public.schools s where s.id::text=lower(p_root) or lower(btrim(s.local_school_id))=lower(p_root)
    ) then
      return query select p.id,null::uuid from public.photographers p join public.r2_photographer_namespace_ownership original on original.photographer_id=p.id and original.user_id=p.user_id where p.id::text=lower(p_root);
    end if;
    return;
  end if;
  if not exists(select 1 from public.photographers p join public.r2_photographer_namespace_ownership original on original.photographer_id=p.id and original.user_id=p.user_id where p.id=frozen.photographer_id) then return; end if;
  if p_kind='project' then
    select p.photographer_id into current_owner from public.projects p where p.id::text=lower(p_root);
    if found then
      if current_owner=frozen.photographer_id then return query select frozen.photographer_id,null::uuid; end if;
    elsif p_allow_deleted_resource then
      return query select frozen.photographer_id,null::uuid;
    end if;
    return;
  end if;
  select count(*)::integer into school_matches from public.schools s
    where s.id::text=lower(p_root) or lower(btrim(s.local_school_id))=lower(p_root);
  if school_matches>1 then return; end if;
  if school_matches=1 then
    select s.photographer_id,s.id into current_owner,current_school from public.schools s
      where s.id::text=lower(p_root) or lower(btrim(s.local_school_id))=lower(p_root);
  else
    -- An old local root remains usable after relabeling its original school.
    select s.photographer_id,s.id into current_owner,current_school from public.schools s where s.id=frozen.resource_id;
    if not found and p_allow_deleted_resource then
      return query select frozen.photographer_id,frozen.resource_id;
      return;
    end if;
  end if;
  if current_owner=frozen.photographer_id then return query select frozen.photographer_id,current_school; end if;
end
$function$;
revoke all on function public.r2_media_namespace_owner(text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.r2_media_namespace_owner(text,text,boolean,boolean) to service_role;
commit;
