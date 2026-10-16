-- Catalog uploads never enable checkout, production, payouts, or lab commissions.
begin;
alter table public.studio_labs add column catalog_version integer not null default 0 check(catalog_version >= 0);
alter table public.studio_lab_catalog drop constraint studio_lab_catalog_cost_source_check;
alter table public.studio_lab_catalog add constraint studio_lab_catalog_cost_source_check
  check(cost_source in ('lab_confirmed','lab_upload','screenshot_reference','not_provided'));
create unique index studio_lab_catalog_sku_unique on public.studio_lab_catalog(lab_id,lower(sku)) where sku is not null;

create table public.lab_catalog_imports (
  id uuid primary key default gen_random_uuid(), lab_id uuid not null references public.studio_labs(id),
  actor_user_id uuid not null references auth.users(id), request_id uuid not null,
  file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'), source_name text not null,
  catalog_version integer not null, product_count integer not null,
  snapshot jsonb not null, created_at timestamptz not null default now(),
  unique(actor_user_id,request_id)
);
alter table public.lab_catalog_imports enable row level security;
alter table public.lab_catalog_imports force row level security;
revoke all on public.lab_catalog_imports from public,anon,authenticated;
grant select,insert on public.lab_catalog_imports to service_role;

create function public.apply_lab_catalog_import(p_actor_user_id uuid,p_lab_id uuid,p_expected_version integer,
  p_rows jsonb,p_source_name text,p_file_hash text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  lab public.studio_labs%rowtype; prior public.lab_catalog_imports%rowtype;
  item jsonb; next_version integer; result_id uuid;
begin
  if p_actor_user_id is null or p_lab_id is null or p_request_id is null or p_expected_version is null
    or p_expected_version < 0 or p_file_hash is null or p_file_hash !~ '^[a-f0-9]{64}$'
    or p_source_name is null or length(btrim(p_source_name)) not between 1 and 200
    or p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 2000
    or octet_length(p_rows::text) > 2000000 then raise exception 'LAB_IMPORT_INVALID'; end if;
  if not exists(select 1 from public.photographers p where p.user_id=p_actor_user_id and p.is_platform_admin)
    and not exists(select 1 from public.lab_memberships m where m.lab_id=p_lab_id and m.user_id=p_actor_user_id and m.active and m.role='owner')
    then raise exception 'LAB_IMPORT_FORBIDDEN' using errcode='42501'; end if;
  -- Lock by actor/request as well as lab so idempotency cannot be raced across labs.
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text||p_request_id::text,0));
  select * into prior from public.lab_catalog_imports where actor_user_id=p_actor_user_id and request_id=p_request_id;
  if found then
    if prior.lab_id<>p_lab_id or prior.file_hash<>p_file_hash or prior.snapshot<>p_rows then raise exception 'LAB_IMPORT_REQUEST_CONFLICT'; end if;
    return jsonb_build_object('id',prior.id,'catalogVersion',prior.catalog_version,'productCount',prior.product_count,'replayed',true);
  end if;
  select * into lab from public.studio_labs where id=p_lab_id for update;
  if not found then raise exception 'LAB_IMPORT_NOT_FOUND'; end if;
  if lab.catalog_version<>p_expected_version then raise exception 'LAB_IMPORT_VERSION_CONFLICT'; end if;
  -- Live catalog replacement requires versioned production rollout, not a draft importer.
  if lab.intake_enabled or lab.status='active' or lab.catalog_verified then raise exception 'LAB_IMPORT_ACTIVE_CATALOG_HELD'; end if;
  if (select count(distinct lower(btrim(x->>'sku'))) from jsonb_array_elements(p_rows) x)<>jsonb_array_length(p_rows) then raise exception 'LAB_IMPORT_DUPLICATE_SKU'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(item)<>'object' or length(btrim(coalesce(item->>'sku',''))) not between 1 and 100
      or length(btrim(coalesce(item->>'name',''))) not between 1 and 200
      or coalesce(item->>'category','') not in ('prints','fine_art','canvas','metal')
      or item->>'currency' is distinct from lab.currency
      or coalesce(item->>'costCents','') !~ '^[0-9]{1,9}$' or (item->>'costCents')::numeric>100000000
      or coalesce(item->>'widthInches','') !~ '^[0-9]+(\.[0-9]+)?$'
      or coalesce(item->>'heightInches','') !~ '^[0-9]+(\.[0-9]+)?$'
      or (item->>'widthInches')::numeric not between 0.001 and 120
      or (item->>'heightInches')::numeric not between 0.001 and 120
      or length(coalesce(item->>'finish',''))>100 or length(coalesce(item->>'size',''))>100
      or jsonb_typeof(item->'popular') is distinct from 'boolean' then raise exception 'LAB_IMPORT_INVALID_ROW'; end if;
    insert into public.studio_lab_catalog(lab_id,sku,name,category,size,finish,cost_cents,currency,width_inches,height_inches,popular,verified,active,cost_source)
    values(p_lab_id,btrim(item->>'sku'),btrim(item->>'name'),item->>'category',item->>'size',coalesce(item->>'finish',''),
      (item->>'costCents')::integer,lab.currency,(item->>'widthInches')::numeric,(item->>'heightInches')::numeric,(item->>'popular')::boolean,false,true,'lab_upload')
    on conflict(lab_id,lower(sku)) where sku is not null do update set
      name=excluded.name,category=excluded.category,size=excluded.size,finish=excluded.finish,cost_cents=excluded.cost_cents,
      width_inches=excluded.width_inches,height_inches=excluded.height_inches,popular=excluded.popular,
      verified=false,active=true,cost_source='lab_upload';
  end loop;
  -- Samples cannot be mistaken for a second, approved version of the lab's file.
  update public.studio_lab_catalog set active=false where lab_id=p_lab_id and cost_source='screenshot_reference';
  next_version:=lab.catalog_version+1;
  update public.studio_labs set catalog_version=next_version,catalog_verified=false,intake_enabled=false,
    description='Catalog uploaded for review. Lab ordering and production remain in setup.' where id=p_lab_id;
  insert into public.lab_catalog_imports(lab_id,actor_user_id,request_id,file_hash,source_name,catalog_version,product_count,snapshot)
  values(p_lab_id,p_actor_user_id,p_request_id,p_file_hash,btrim(p_source_name),next_version,jsonb_array_length(p_rows),p_rows) returning id into result_id;
  return jsonb_build_object('id',result_id,'catalogVersion',next_version,'productCount',jsonb_array_length(p_rows),'replayed',false);
end $$;
revoke all on function public.apply_lab_catalog_import(uuid,uuid,integer,jsonb,text,text,uuid) from public,anon,authenticated;
grant execute on function public.apply_lab_catalog_import(uuid,uuid,integer,jsonb,text,text,uuid) to service_role;
commit;
