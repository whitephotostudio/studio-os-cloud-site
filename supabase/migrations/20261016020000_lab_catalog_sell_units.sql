-- Explicit physical print pieces per priced catalog unit; unspecified is not one.
-- No historical catalog row is backfilled and no existing sheet/order is rewritten.
-- Re-importing an omitted/blank count clears it and already resets verification,
-- so a changed catalog cannot inherit a stale single-print approval.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '10s';
alter table public.studio_lab_catalog add column prints_per_unit integer
  check(prints_per_unit between 1 and 100);
comment on column public.studio_lab_catalog.prints_per_unit is
  'Physical print pieces per one priced catalog unit; NULL means unspecified. Uploaded values remain unverified.';

create or replace function public.apply_lab_catalog_import(p_actor_user_id uuid,p_lab_id uuid,p_expected_version integer,
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
      or jsonb_typeof(item->'popular') is distinct from 'boolean'
      or (item ? 'printsPerUnit' and item->'printsPerUnit'<>'null'::jsonb
        and (jsonb_typeof(item->'printsPerUnit') is distinct from 'number'
          or coalesce(item->>'printsPerUnit','') !~ '^([1-9]|[1-9][0-9]|100)$'))
      then raise exception 'LAB_IMPORT_INVALID_ROW'; end if;
    insert into public.studio_lab_catalog(lab_id,sku,name,category,size,finish,cost_cents,currency,width_inches,height_inches,popular,verified,active,cost_source,prints_per_unit)
    values(p_lab_id,btrim(item->>'sku'),btrim(item->>'name'),item->>'category',item->>'size',coalesce(item->>'finish',''),
      (item->>'costCents')::integer,lab.currency,(item->>'widthInches')::numeric,(item->>'heightInches')::numeric,(item->>'popular')::boolean,false,true,'lab_upload',
      (item->>'printsPerUnit')::integer)
    on conflict(lab_id,lower(sku)) where sku is not null do update set
      name=excluded.name,category=excluded.category,size=excluded.size,finish=excluded.finish,cost_cents=excluded.cost_cents,
      width_inches=excluded.width_inches,height_inches=excluded.height_inches,popular=excluded.popular,
      verified=false,active=true,cost_source='lab_upload',prints_per_unit=excluded.prints_per_unit;
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

commit;
