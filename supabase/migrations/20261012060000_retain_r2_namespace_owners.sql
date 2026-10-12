-- Retain the first tenant owner after deletion/relabeling, so orphan photo
-- namespaces cannot be reclaimed by another tenant. No object bytes change.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
-- Close the snapshot-to-trigger gap while ordinary reads remain available.
lock table public.projects,public.schools,public.school_storage_root_claims in share row exclusive mode;

create table if not exists public.r2_namespace_ownership (
  scope_kind text not null check(scope_kind in ('project','school')),
  root text not null check(root=lower(btrim(root)) and root<>'' and position('/' in root)=0),
  photographer_id uuid not null,
  resource_id uuid not null,
  recorded_at timestamptz not null default now(),
  primary key(scope_kind,root)
);
-- Deliberately no cascading FK: deletion must never release a namespace.
alter table public.r2_namespace_ownership enable row level security;
revoke all on public.r2_namespace_ownership from public,anon,authenticated;
grant select on public.r2_namespace_ownership to service_role;

create or replace function public._claim_r2_namespace(p_kind text,p_root text,p_owner uuid,p_resource uuid)
returns void language plpgsql security definer set search_path=''
as $function$
declare existing_owner uuid;
begin
  if p_owner is null or p_resource is null then
    raise exception 'R2 namespace requires an established studio owner' using errcode='42501';
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

-- Snapshot every current database and legacy school root; conflicting owners
-- abort the whole migration rather than silently omitting a valid namespace.
do $snapshot$
declare resource record;
begin
  for resource in select id,photographer_id from public.projects loop
    perform public._claim_r2_namespace('project',resource.id::text,resource.photographer_id,resource.id);
  end loop;
  for resource in select id,photographer_id,local_school_id from public.schools loop
    perform public._claim_r2_namespace('school',resource.id::text,resource.photographer_id,resource.id);
    if nullif(btrim(resource.local_school_id),'') is not null then
      perform public._claim_r2_namespace('school',resource.local_school_id,resource.photographer_id,resource.id);
    end if;
  end loop;
  for resource in
    select claim.root,school.id,school.photographer_id from public.school_storage_root_claims claim
    join public.schools school on school.id=claim.school_id
  loop
    perform public._claim_r2_namespace('school',resource.root,resource.photographer_id,resource.id);
  end loop;
end
$snapshot$;

create or replace function public.retain_r2_namespace_owner()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  if tg_table_name='projects' then
    perform public._claim_r2_namespace('project',new.id::text,new.photographer_id,new.id);
  elsif tg_table_name='schools' then
    perform public._claim_r2_namespace('school',new.id::text,new.photographer_id,new.id);
    if nullif(btrim(new.local_school_id),'') is not null then
      perform public._claim_r2_namespace('school',new.local_school_id,new.photographer_id,new.id);
    end if;
  else
    raise exception 'Unexpected R2 namespace source';
  end if;
  return new;
end
$function$;
revoke all on function public.retain_r2_namespace_owner() from public,anon,authenticated,service_role;
drop trigger if exists retain_r2_namespace_owner on public.projects;
create trigger retain_r2_namespace_owner before insert or update of id,photographer_id on public.projects
for each row execute function public.retain_r2_namespace_owner();
drop trigger if exists retain_r2_namespace_owner on public.schools;
create trigger retain_r2_namespace_owner before insert or update of id,photographer_id,local_school_id on public.schools
for each row execute function public.retain_r2_namespace_owner();

create or replace function public.r2_media_namespace_owner(
  p_kind text,p_root text,p_allow_photographer_root boolean default false,p_allow_deleted_resource boolean default false
) returns table(photographer_id uuid,school_id uuid)
language plpgsql stable security definer set search_path=''
as $function$
declare frozen public.r2_namespace_ownership%rowtype; current_owner uuid; current_school uuid; school_matches integer;
begin
  if p_root is null or p_root<>btrim(p_root) or p_root='' or position('/' in p_root)>0 then return; end if;
  if p_kind='photographer' then
    return query select p.id,null::uuid from public.photographers p where p.id::text=lower(p_root);
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
      return query select p.id,null::uuid from public.photographers p where p.id::text=lower(p_root);
    end if;
    return;
  end if;
  if not exists(select 1 from public.photographers p where p.id=frozen.photographer_id) then return; end if;
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
