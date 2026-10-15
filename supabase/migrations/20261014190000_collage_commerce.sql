-- Reviewed preview only. Do not apply to production as part of development.
begin;
create table public.collage_commerce_attempts (
  photographer_id uuid not null references public.photographers(id),
  request_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key(photographer_id, request_id)
);
alter table public.collage_commerce_attempts enable row level security;
revoke all on public.collage_commerce_attempts from public, anon, authenticated;
grant all on public.collage_commerce_attempts to service_role;

create function public.collage_commerce_state(p_owner uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'owner', (select jsonb_build_object('id',p.id,'billing_currency',p.billing_currency,'default_package_profile_id',p.default_package_profile_id) from public.photographers p where p.id=p_owner),
    'profiles', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.package_profiles p where p.photographer_id=p_owner),'[]'::jsonb),
    'schools', coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'photographer_id',s.photographer_id,'school_name',s.school_name,'package_profile_id',s.package_profile_id,'gallery_settings',s.gallery_settings) order by s.id) from public.schools s where s.photographer_id=p_owner),'[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'photographer_id',p.photographer_id,'title',p.title,'workflow_type',p.workflow_type,'package_profile_id',p.package_profile_id,'gallery_settings',p.gallery_settings) order by p.id) from public.projects p where p.photographer_id=p_owner),'[]'::jsonb),
    'packages', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.packages p where p.photographer_id=p_owner),'[]'::jsonb)
  );
$$;
revoke all on function public.collage_commerce_state(uuid) from public, anon, authenticated;
grant execute on function public.collage_commerce_state(uuid) to service_role;

-- Mirrors filterPackagesForProfile used by both parent gallery context routes.
-- Package-profile fallback order is authoritative package price, then ID for ties.
create function public.collage_parent_profile(p_owner uuid,p_selected text) returns text language plpgsql volatile security definer set search_path = '' as $$
declare resolved text;
begin
  if p_selected is not null and exists(select 1 from public.packages p where p.photographer_id=p_owner and p.active=true and p.profile_id::text=p_selected) then return p_selected; end if;
  select p.profile_id::text into resolved from public.packages p where p.photographer_id=p_owner and p.active=true and p.profile_name ~* '\mdefault\M' order by p.price_cents,p.id limit 1;
  if nullif(btrim(resolved),'') is not null then return btrim(resolved); end if;
  select p.profile_id::text into resolved from public.packages p where p.photographer_id=p_owner and p.active=true and nullif(btrim(p.profile_id::text),'') is not null order by p.price_cents,p.id limit 1;
  return nullif(btrim(resolved),'');
end;
$$;
revoke all on function public.collage_parent_profile(uuid,text) from public, anon, authenticated, service_role;

create function public.publish_collage_commerce(p_photographer_id uuid,p_request_id uuid,p_payload_hash text,p_expected_state jsonb,
  p_template_id uuid,p_design jsonb,p_artwork_key text,p_content_hash text,p_galleries jsonb,p_product jsonb,p_currency text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare prior public.collage_commerce_attempts; studio public.photographers; existing public.packages; saved public.collage_template_versions;
  target_id uuid; template_id uuid; target_profile text; sheet_name text; target_price integer; copies integer; item_index integer;
  next_items jsonb; item jsonb; old_item jsonb; g jsonb; selected_profile text; resolved_profile text; settings jsonb;
  result jsonb; product_row jsonb; total_copies integer:=0; item_copies integer; school_ids uuid[]:='{}'; project_ids uuid[]:='{}';
begin
  if p_photographer_id is null or p_request_id is null or p_payload_hash is null or p_payload_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid publication identity' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_photographer_id::text||':'||p_request_id::text,23));
  select * into prior from public.collage_commerce_attempts where photographer_id=p_photographer_id and request_id=p_request_id;
  if found then
    if prior.payload_hash<>p_payload_hash then raise exception 'Publication request contents changed' using errcode='40001'; end if;
    return prior.response || jsonb_build_object('replayed',true);
  end if;
  select * into studio from public.photographers where id=p_photographer_id for update;
  if not found then raise exception 'Studio unavailable' using errcode='42501'; end if;
  -- Lock current owner rows before comparing the reviewed catalogue. Target
  -- item updates never overwrite another editor's unseen package metadata.
  perform 1 from public.package_profiles where photographer_id=p_photographer_id order by id for share;
  perform 1 from public.schools where photographer_id=p_photographer_id order by id for share;
  perform 1 from public.projects where photographer_id=p_photographer_id order by id for share;
  perform 1 from public.packages where photographer_id=p_photographer_id order by id for update;
  if public.collage_commerce_state(p_photographer_id) is distinct from p_expected_state then raise exception 'Catalogue changed' using errcode='40001'; end if;
  if p_currency is distinct from coalesce(nullif(lower(btrim(studio.billing_currency)),''),'cad') or p_currency not in ('usd','cad','eur','gbp','aud','aed','sar','amd') then raise exception 'Sales currency changed' using errcode='40001'; end if;
  if jsonb_typeof(p_product) is distinct from 'object' or coalesce(p_product->>'mode','') not in ('create','update')
    or jsonb_typeof(p_product->'priceCents') is distinct from 'number' or coalesce(p_product->>'priceCents','') !~ '^[0-9]{1,9}$'
    or jsonb_typeof(p_product->'copyCount') is distinct from 'number' or coalesce(p_product->>'copyCount','') !~ '^[0-9]{1,2}$' then raise exception 'Invalid product configuration' using errcode='22023'; end if;
  target_price:=(p_product->>'priceCents')::integer; copies:=(p_product->>'copyCount')::integer;
  if target_price not between 1 and 100000000 or copies not between 1 and 20 then raise exception 'Invalid price or quantity' using errcode='22023'; end if;
  target_profile:=nullif(btrim(p_product->>'profileId'),'');
  if length(target_profile)>200 then raise exception 'Invalid price sheet' using errcode='22023'; end if;
  if target_profile is not null then
    select name into sheet_name from public.package_profiles where id::text=target_profile and photographer_id=p_photographer_id;
    if not found then
      if exists(select 1 from public.package_profiles where id::text=target_profile) or not exists(select 1 from public.packages where photographer_id=p_photographer_id and profile_id::text=target_profile) then raise exception 'Price sheet belongs to another studio' using errcode='42501'; end if;
      select profile_name into sheet_name from public.packages where photographer_id=p_photographer_id and profile_id::text=target_profile order by id limit 1;
    end if;
  end if;
  if p_product->>'mode'='update' then
    target_id:=(p_product->>'id')::uuid;
    select * into existing from public.packages where id=target_id and photographer_id=p_photographer_id;
    if not found then raise exception 'Product belongs to another studio' using errcode='42501'; end if;
    if existing.profile_id::text is distinct from target_profile or existing.active is distinct from true or existing.is_retouch_addon=true
      or coalesce(existing.category,'') ~* 'digital|download|usb|jpeg|jpg|png|\mfiles?\M|composite' then raise exception 'Product is not an active matching physical package' using errcode='22023'; end if;
    next_items:=existing.items;
  else
    if nullif(btrim(p_product->>'name'),'') is null or length(btrim(p_product->>'name'))>100 or p_product->>'id' is not null or p_product->>'itemIndex' is not null then raise exception 'Invalid new product' using errcode='22023'; end if;
    target_id:=gen_random_uuid(); next_items:='[]'::jsonb;
  end if;
  if jsonb_typeof(next_items) is distinct from 'array' then raise exception 'Invalid existing package items' using errcode='22023'; end if;
  if p_product->>'itemIndex' is not null then
    if (p_product->>'itemIndex') !~ '^[0-9]{1,2}$' then raise exception 'Invalid collage item index' using errcode='22023'; end if;
    item_index:=(p_product->>'itemIndex')::integer; old_item:=next_items->item_index;
    if old_item is null or jsonb_typeof(old_item) is distinct from 'object' or jsonb_typeof(old_item->'collage') is distinct from 'object' then raise exception 'Only an existing collage item can be replaced' using errcode='22023'; end if;
  end if;
  if jsonb_typeof(p_galleries) is distinct from 'array' or jsonb_array_length(p_galleries) not between 1 and 100
    or jsonb_array_length(p_galleries)<>(select count(distinct (value->>'kind',value->>'id')) from jsonb_array_elements(p_galleries)) then raise exception 'Invalid galleries' using errcode='22023'; end if;
  for g in select value from jsonb_array_elements(p_galleries) loop
    if g->>'kind'='school' then
      if not exists(select 1 from public.schools where id=(g->>'id')::uuid and photographer_id=p_photographer_id) then raise exception 'Gallery belongs to another studio' using errcode='42501'; end if;
      school_ids:=array_append(school_ids,(g->>'id')::uuid);
    elsif g->>'kind'='project' then
      if not exists(select 1 from public.projects where id=(g->>'id')::uuid and photographer_id=p_photographer_id and lower(btrim(workflow_type))='event') then raise exception 'Event gallery belongs to another studio' using errcode='42501'; end if;
      project_ids:=array_append(project_ids,(g->>'id')::uuid);
    else raise exception 'Invalid gallery type' using errcode='22023'; end if;
  end loop;
  template_id:=coalesce(p_template_id,gen_random_uuid());
  saved:=public.save_collage_template_version(template_id,p_photographer_id,p_design->>'name',p_design,p_artwork_key,p_content_hash,true,school_ids,project_ids);
  item:=coalesce(old_item,'{}'::jsonb)||jsonb_build_object('name',(p_design->>'widthInches')||'×'||(p_design->>'heightInches')||' '||(p_design->>'name'),'qty',copies,
    'size',(p_design->>'widthInches')||'x'||(p_design->>'heightInches'),'type','print','composite',false,'collage',jsonb_build_object('templateVersionId',saved.id));
  if item_index is null then next_items:=next_items||jsonb_build_array(item); else next_items:=jsonb_set(next_items,array[item_index::text],item,false); end if;
  for item in select value from jsonb_array_elements(next_items) loop
    if jsonb_typeof(item) not in ('object','string') or coalesce(item->>'type','') ~* 'digital|download|usb|jpeg|jpg|png|\mfiles?\M' then raise exception 'Mixed packages require physical prints' using errcode='22023'; end if;
    if coalesce(item->>'qty','1') !~ '^[1-9][0-9]?$' then raise exception 'Invalid included print quantity' using errcode='22023'; end if;
    item_copies:=coalesce(item->>'qty','1')::integer;
    if item_copies>20 then raise exception 'Too many included copies' using errcode='22023'; end if;
    total_copies:=total_copies+item_copies;
  end loop;
  if total_copies>20 then raise exception 'Too many finished prints per package set' using errcode='22023'; end if;
  if p_product->>'mode'='update' then
    update public.packages set items=next_items,price_cents=target_price where id=target_id and photographer_id=p_photographer_id;
  else
    insert into public.packages(id,photographer_id,local_id,profile_id,profile_name,name,price_cents,items,active,category,is_retouch_addon)
      values(target_id,p_photographer_id,'collage_'||p_request_id::text,target_profile,sheet_name,btrim(p_product->>'name'),target_price,next_items,true,'print',false);
  end if;
  -- Check the actual post-update catalogue, including inherited gallery/default
  -- sheets and legacy all-catalogue fallback. Never reassign a gallery profile.
  for g in select value from jsonb_array_elements(p_galleries) loop
    if g->>'kind'='school' then select s.package_profile_id::text,s.gallery_settings into selected_profile,settings from public.schools s where s.id=(g->>'id')::uuid;
    else select p.package_profile_id::text,p.gallery_settings into selected_profile,settings from public.projects p where p.id=(g->>'id')::uuid; end if;
    selected_profile:=coalesce(nullif(btrim(selected_profile),''),case when jsonb_typeof(settings#>'{extras,priceSheetProfileId}')='string' then nullif(btrim(settings#>>'{extras,priceSheetProfileId}'),'') end,studio.default_package_profile_id::text);
    resolved_profile:=public.collage_parent_profile(p_photographer_id,selected_profile);
    if resolved_profile is not null and lower(resolved_profile)<>'default' and resolved_profile is distinct from target_profile then raise exception 'Product is not offered by the gallery price sheet' using errcode='22023'; end if;
  end loop;
  select to_jsonb(p) into product_row from public.packages p where p.id=target_id;
  result:=jsonb_build_object('version',to_jsonb(saved),'product',product_row,'currency',p_currency,'requestId',p_request_id,'replayed',false);
  insert into public.collage_commerce_attempts(photographer_id,request_id,payload_hash,response) values(p_photographer_id,p_request_id,p_payload_hash,result);
  return result;
end;
$$;
revoke all on function public.publish_collage_commerce(uuid,uuid,text,jsonb,uuid,jsonb,text,text,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.publish_collage_commerce(uuid,uuid,text,jsonb,uuid,jsonb,text,text,jsonb,jsonb,text) to service_role;
commit;
