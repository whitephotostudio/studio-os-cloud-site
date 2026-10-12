-- Exact pre-migration function definitions and ACLs from the live read-only catalog.
begin;
set local lock_timeout='5s';
lock table public.photographers,public.schools,public.projects in share row exclusive mode;
drop trigger if exists retain_r2_photographer_namespace_owner on public.photographers;
drop function if exists public.retain_r2_photographer_namespace_owner();
CREATE OR REPLACE FUNCTION public._claim_r2_namespace(p_kind text, p_root text, p_owner uuid, p_resource uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.r2_media_namespace_owner(p_kind text, p_root text, p_allow_photographer_root boolean DEFAULT false, p_allow_deleted_resource boolean DEFAULT false)
 RETURNS TABLE(photographer_id uuid, school_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
revoke all on function public._claim_r2_namespace(text,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.r2_media_namespace_owner(text,text,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.r2_media_namespace_owner(text,text,boolean,boolean) to service_role;
drop table if exists public.r2_photographer_namespace_ownership;
commit;
