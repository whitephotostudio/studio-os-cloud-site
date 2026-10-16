-- Business conflicts are final client decisions, not transient serialization failures.
-- PostgREST 14 retries custom SQLSTATE 40001, potentially without returning a receipt.
-- PT409 returns HTTP 409 while keeping the existing exception messages and all
-- ownership checks, advisory/row locks, frozen snapshots and retry semantics.
-- Source: https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
-- CREATE OR REPLACE preserves the four existing lab functions and their grants.
-- This migration changes no school, package, in-house price or order records.

begin;
set local lock_timeout = '2s';
set local statement_timeout = '10s';

create or replace function public.save_lab_price_sheet(p_user_id uuid,p_id uuid,p_expected_version integer,p_document jsonb,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid; current_row public.lab_price_sheets%rowtype; lab public.studio_labs%rowtype;
  chosen_lab uuid; entry jsonb; pack jsonb; assigned jsonb; product_id uuid;
begin
  if p_user_id is null or p_id is null or p_action is null or p_action not in ('create','save','delete')
    or p_expected_version is null or p_expected_version < 0 then raise exception 'LAB_INVALID' using errcode='22023'; end if;
  select p.id into owner_id from public.photographers p where p.user_id = p_user_id;
  if owner_id is null then raise exception 'LAB_OWNER' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('lab-sheet-owner:'||owner_id::text,20261015));
  select s.* into current_row from public.lab_price_sheets s where s.id=p_id for update;
  if p_action = 'create' then
    if found or p_expected_version <> 0 then raise exception 'LAB_VERSION_CONFLICT' using errcode='PT409'; end if;
    if (select count(*) from public.lab_price_sheets s where s.photographer_id=owner_id) >= 200 then raise exception 'LAB_INVALID'; end if;
  else
    if current_row.id is null or current_row.photographer_id <> owner_id then raise exception 'LAB_NOT_FOUND' using errcode='42501'; end if;
    if current_row.version <> p_expected_version then raise exception 'LAB_VERSION_CONFLICT' using errcode='PT409'; end if;
    if p_action='delete' then
      -- Published catalogs and historical orders remain intact.
      delete from public.lab_price_sheets s where s.id=p_id;
      return pg_catalog.jsonb_build_object('deleted',true,'id',p_id);
    end if;
  end if;
  if p_document is null or jsonb_typeof(p_document) <> 'object' or octet_length(p_document::text)>256000
    or coalesce(length(btrim(p_document->>'name')),0) not between 1 and 100
    or jsonb_typeof(p_document->'items') is distinct from 'array'
    or jsonb_typeof(p_document->'packages') is distinct from 'array'
    or jsonb_typeof(p_document->'assignments') is distinct from 'array'
    or jsonb_typeof(p_document->'pricing') is distinct from 'object'
    or jsonb_typeof(p_document->'shipping') is distinct from 'object'
    or jsonb_typeof(p_document->'terms') is distinct from 'string'
    or length(p_document->>'terms')>10000 then raise exception 'LAB_INVALID' using errcode='22023'; end if;
  chosen_lab := (p_document->>'labId')::uuid;
  select l.* into lab from public.studio_labs l where l.id=chosen_lab;
  if lab.id is null or p_document->>'currency' is distinct from lab.currency then raise exception 'LAB_INVALID'; end if;
  if p_action='save' and (chosen_lab<>current_row.lab_id or lab.currency<>current_row.currency) then raise exception 'LAB_INVALID'; end if;
  if jsonb_array_length(p_document->'items')>500 or jsonb_array_length(p_document->'packages')>100 or jsonb_array_length(p_document->'assignments')>200 then raise exception 'LAB_INVALID'; end if;
  if coalesce(p_document#>>'{pricing,rounding}','') not in ('none','nearest-dollar','0.99')
    or coalesce((p_document#>>'{pricing,markupPercent}')::numeric,-1) not between 0 and 10000
    or coalesce(p_document#>>'{shipping,mode}','') not in ('lab','custom','pickup')
    or coalesce((p_document#>>'{shipping,feeCents}')::numeric,-1) not between 0 and 100000000
    or (p_document#>>'{shipping,feeCents}')::numeric <> trunc((p_document#>>'{shipping,feeCents}')::numeric)
    or length(coalesce(p_document#>>'{shipping,title}',''))>100
    or (p_document#>>'{shipping,mode}'<>'custom' and (p_document#>>'{shipping,feeCents}')::numeric<>0) then raise exception 'LAB_INVALID'; end if;
  for entry in select value from jsonb_array_elements(p_document->'items') loop
    product_id := (entry->>'catalogProductId')::uuid;
    if jsonb_typeof(entry->'enabled') is distinct from 'boolean' or coalesce((entry->>'retailCents')::numeric,-1) not between 0 and 100000000
      or (entry->>'retailCents')::numeric<>trunc((entry->>'retailCents')::numeric) then raise exception 'LAB_INVALID'; end if;
    if not exists(select 1 from public.studio_lab_catalog c where c.id=product_id and c.lab_id=chosen_lab) then raise exception 'LAB_CATALOG_SCOPE' using errcode='42501'; end if;
  end loop;
  if (select count(*)<>count(distinct value->>'catalogProductId') from jsonb_array_elements(p_document->'items')) then raise exception 'LAB_INVALID'; end if;
  for pack in select value from jsonb_array_elements(p_document->'packages') loop
    perform (pack->>'id')::uuid;
    if coalesce(length(btrim(pack->>'name')),0) not between 1 and 100
      or length(coalesce(pack->>'description',''))>1000
      or coalesce((pack->>'retailCents')::numeric,-1) not between 0 and 100000000
      or (pack->>'retailCents')::numeric<>trunc((pack->>'retailCents')::numeric)
      or jsonb_typeof(pack->'items') is distinct from 'array' then raise exception 'LAB_INVALID'; end if;
    if jsonb_array_length(pack->'items') not between 1 and 100 then raise exception 'LAB_INVALID'; end if;
    for entry in select value from jsonb_array_elements(pack->'items') loop
      product_id := (entry->>'catalogProductId')::uuid;
      if coalesce((entry->>'quantity')::numeric,-1) not between 1 and 100 or (entry->>'quantity')::numeric<>trunc((entry->>'quantity')::numeric) then raise exception 'LAB_INVALID'; end if;
      if not exists(select 1 from public.studio_lab_catalog c where c.id=product_id and c.lab_id=chosen_lab) then raise exception 'LAB_CATALOG_SCOPE' using errcode='42501'; end if;
    end loop;
    if (select sum((value->>'quantity')::integer)>100 or count(*)<>count(distinct value->>'catalogProductId') from jsonb_array_elements(pack->'items')) then raise exception 'LAB_INVALID'; end if;
  end loop;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_document->'packages')) then raise exception 'LAB_INVALID'; end if;
  for assigned in select value from jsonb_array_elements(p_document->'assignments') loop
    if assigned->>'kind'='school' then
      if not exists(select 1 from public.schools s where s.id=(assigned->>'id')::uuid and s.photographer_id=owner_id) then raise exception 'LAB_GALLERY_SCOPE' using errcode='42501'; end if;
    elsif assigned->>'kind'='project' then
      if not exists(select 1 from public.projects p where p.id=(assigned->>'id')::uuid and p.photographer_id=owner_id and p.workflow_type='event') then raise exception 'LAB_GALLERY_SCOPE' using errcode='42501'; end if;
    else raise exception 'LAB_INVALID'; end if;
  end loop;
  if (select count(*)<>count(distinct (value->>'kind')||':'||(value->>'id')) from jsonb_array_elements(p_document->'assignments')) then raise exception 'LAB_INVALID'; end if;
  if p_action='create' then
    insert into public.lab_price_sheets(id,photographer_id,lab_id,name,currency,document)
      values(p_id,owner_id,chosen_lab,btrim(p_document->>'name'),lab.currency,p_document) returning * into current_row;
  else
    update public.lab_price_sheets s set name=btrim(p_document->>'name'),document=p_document,version=s.version+1,status='draft',updated_at=now()
      where s.id=p_id returning * into current_row;
  end if;
  return to_jsonb(current_row);
end;
$$;

create or replace function public.publish_lab_price_sheet(p_user_id uuid,p_id uuid,p_expected_version integer,p_assignments jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid; sheet public.lab_price_sheets%rowtype; lab public.studio_labs%rowtype;
  product public.studio_lab_catalog%rowtype; entry jsonb; part jsonb; pack jsonb; assigned jsonb;
  chosen_profile text; purchase_items jsonb; sequence integer:=0; selected_count integer:=0;
begin
  if p_user_id is null or p_id is null or p_expected_version is null or p_expected_version<1 then raise exception 'LAB_INVALID'; end if;
  select p.id into owner_id from public.photographers p where p.user_id=p_user_id;
  if owner_id is null then raise exception 'LAB_OWNER' using errcode='42501'; end if;
  select s.* into sheet from public.lab_price_sheets s where s.id=p_id for update;
  if sheet.id is null or sheet.photographer_id<>owner_id then raise exception 'LAB_NOT_FOUND' using errcode='42501'; end if;
  if sheet.version<>p_expected_version then raise exception 'LAB_VERSION_CONFLICT' using errcode='PT409'; end if;
  select l.* into lab from public.studio_labs l where l.id=sheet.lab_id for share;
  if lab.status<>'active' or not lab.catalog_verified or not lab.intake_enabled then raise exception 'LAB_NOT_READY'; end if;
  if jsonb_typeof(p_assignments) is distinct from 'array' then raise exception 'LAB_INVALID'; end if;
  if jsonb_array_length(p_assignments) not between 1 and 200 then raise exception 'LAB_INVALID'; end if;
  if (select count(*)<>count(distinct (value->>'kind')||':'||(value->>'id')) from jsonb_array_elements(p_assignments)) then raise exception 'LAB_INVALID'; end if;
  for assigned in select value from jsonb_array_elements(p_assignments) loop
    if assigned->>'kind'='school' then
      perform 1 from public.schools s where s.id=(assigned->>'id')::uuid and s.photographer_id=owner_id for update;
    elsif assigned->>'kind'='project' then
      perform 1 from public.projects p where p.id=(assigned->>'id')::uuid and p.photographer_id=owner_id and p.workflow_type='event' for update;
    else raise exception 'LAB_INVALID'; end if;
    if not found then raise exception 'LAB_GALLERY_SCOPE' using errcode='42501'; end if;
  end loop;
  -- Lock every selected catalog row so administrative changes cannot race
  -- between validation and the immutable purchase mapping.
  for entry in select value from jsonb_array_elements(sheet.document->'items') where (value->>'enabled')::boolean
    union all select parts.item from jsonb_array_elements(sheet.document->'packages') as packages(pack)
      cross join lateral jsonb_array_elements(packages.pack->'items') as parts(item) loop
    select c.* into product from public.studio_lab_catalog c where c.id=(entry->>'catalogProductId')::uuid and c.lab_id=lab.id for share;
    if product.id is null or not product.verified or not product.active or nullif(btrim(product.sku),'') is null
      or product.cost_source<>'lab_confirmed' or product.cost_cents is null or product.currency<>sheet.currency
      then raise exception 'LAB_SKU_NOT_VERIFIED'; end if;
    selected_count:=selected_count+1;
  end loop;
  if selected_count=0 then raise exception 'LAB_EMPTY'; end if;
  if exists(select 1 from jsonb_array_elements(sheet.document->'items') where (value->>'enabled')::boolean and (value->>'retailCents')::integer<=0)
    or exists(select 1 from jsonb_array_elements(sheet.document->'packages') where (value->>'retailCents')::integer<=0)
    then raise exception 'LAB_RETAIL_PRICE_REQUIRED'; end if;
  chosen_profile:='lab_'||replace(sheet.id::text,'-','')||'_v'||(sheet.version+1)::text;
  insert into public.package_profiles(id,name,photographer_id,lab_configuration)
    values(chosen_profile,sheet.name,owner_id,jsonb_build_object('version',1,'labId',lab.id,'priceSheetId',sheet.id,
      'priceSheetVersion',sheet.version+1,'shipping',sheet.document->'shipping','terms',sheet.document->'terms'));
  for entry in select value from jsonb_array_elements(sheet.document->'items') where (value->>'enabled')::boolean loop
    select c.* into product from public.studio_lab_catalog c where c.id=(entry->>'catalogProductId')::uuid;
    purchase_items:=jsonb_build_array(jsonb_build_object('name',product.name||' · '||product.finish,'qty',1,'type','print','size',product.size,'finish',product.finish,
      'lab',jsonb_build_object('version',1,'labId',lab.id,'catalogProductId',product.id,'sku',product.sku,
        'currency',product.currency,'widthInches',product.width_inches,'heightInches',product.height_inches,'priceSheetId',sheet.id,'priceSheetVersion',sheet.version+1)));
    insert into public.packages(local_id,photographer_id,profile_id,profile_name,name,description,price_cents,items,active,category,sort_order)
      values(chosen_profile||'_'||product.id::text,owner_id,chosen_profile,sheet.name,product.name||' · '||product.finish,'',
        (entry->>'retailCents')::integer,purchase_items,true,case product.category when 'canvas' then 'canvas' when 'metal' then 'metal' else 'print' end,sequence);
    sequence:=sequence+1;
  end loop;
  for pack in select value from jsonb_array_elements(sheet.document->'packages') loop
    purchase_items:='[]'::jsonb;
    for part in select value from jsonb_array_elements(pack->'items') loop
      select c.* into product from public.studio_lab_catalog c where c.id=(part->>'catalogProductId')::uuid;
      purchase_items:=purchase_items||jsonb_build_array(jsonb_build_object('name',product.name||' · '||product.finish,'qty',(part->>'quantity')::integer,'type','print','size',product.size,'finish',product.finish,
        'lab',jsonb_build_object('version',1,'labId',lab.id,'catalogProductId',product.id,'sku',product.sku,
          'currency',product.currency,'widthInches',product.width_inches,'heightInches',product.height_inches,'priceSheetId',sheet.id,'priceSheetVersion',sheet.version+1)));
    end loop;
    insert into public.packages(local_id,photographer_id,profile_id,profile_name,name,description,price_cents,items,active,category,sort_order)
      values(chosen_profile||'_'||(pack->>'id'),owner_id,chosen_profile,sheet.name,pack->>'name',pack->>'description',
        (pack->>'retailCents')::integer,purchase_items,true,'package',sequence);
    sequence:=sequence+1;
  end loop;
  for assigned in select value from jsonb_array_elements(p_assignments) loop
    if assigned->>'kind'='school' then update public.schools set package_profile_id=chosen_profile where id=(assigned->>'id')::uuid and photographer_id=owner_id;
    else update public.projects set package_profile_id=chosen_profile where id=(assigned->>'id')::uuid and photographer_id=owner_id; end if;
  end loop;
  update public.lab_price_sheets s set version=s.version+1,status='published',published_profile_id=chosen_profile,
    document=jsonb_set(s.document,'{assignments}',p_assignments),updated_at=now() where s.id=sheet.id returning * into sheet;
  return to_jsonb(sheet);
end;
$$;

create or replace function public.submit_lab_order(p_actor_user_id uuid,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  studio public.photographers%rowtype; lab public.studio_labs%rowtype; existing public.lab_orders%rowtype;
  product public.studio_lab_catalog%rowtype; asset public.lab_order_assets%rowtype; item jsonb; order_row public.lab_orders%rowtype;
  body_hash text; frozen jsonb; lines jsonb:='[]'::jsonb; unit_count integer; line_number integer:=0; line_total bigint; total bigint:=0;
  image_ratio numeric; print_ratio numeric;
begin
  if p_actor_user_id is null or p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or octet_length(p_payload::text)>64000 then raise exception 'LAB_ORDER_INVALID' using errcode='22023'; end if;
  select p.* into studio from public.photographers p where p.user_id=p_actor_user_id for share;
  if studio.id is null then raise exception 'LAB_ORDER_STUDIO_REQUIRED' using errcode='42501'; end if;
  body_hash:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('lab-order-request:'||p_actor_user_id::text||p_request_id::text,20261015));
  select o.* into existing from public.lab_orders o where o.photographer_id=studio.id and o.request_id=p_request_id;
  if found then
    if existing.request_hash<>body_hash or existing.request_payload<>p_payload then raise exception 'LAB_ORDER_REQUEST_CONFLICT' using errcode='PT409'; end if;
    return jsonb_build_object('id',existing.id,'version',existing.version,'status',existing.status,'replayed',true);
  end if;
  if exists(select 1 from public.lab_order_events e where e.actor_user_id=p_actor_user_id and e.request_id=p_request_id) then raise exception 'LAB_ORDER_REQUEST_CONFLICT' using errcode='PT409'; end if;
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('labId','reference','notes','delivery','items'))
    or jsonb_typeof(p_payload->'labId') is distinct from 'string'
    or jsonb_typeof(p_payload->'reference') is distinct from 'string' or length(btrim(p_payload->>'reference')) not between 1 and 120
    or jsonb_typeof(p_payload->'notes') is distinct from 'string' or length(p_payload->>'notes')>2000
    or jsonb_typeof(p_payload->'delivery') is distinct from 'object' or jsonb_typeof(p_payload->'items') is distinct from 'array'
    then raise exception 'LAB_ORDER_INVALID' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_payload->'delivery') k where k not in ('mode','name','address'))
    or coalesce(p_payload#>>'{delivery,mode}','') not in ('pickup','ship_to_studio')
    or jsonb_typeof(p_payload#>'{delivery,name}') is distinct from 'string' or length(btrim(p_payload#>>'{delivery,name}')) not between 1 and 200
    or jsonb_typeof(p_payload#>'{delivery,address}') is distinct from 'string' or length(p_payload#>>'{delivery,address}')>1000
    or (p_payload#>>'{delivery,mode}'='ship_to_studio' and length(btrim(p_payload#>>'{delivery,address}'))=0)
    or jsonb_array_length(p_payload->'items') not between 1 and 50 then raise exception 'LAB_ORDER_INVALID' using errcode='22023'; end if;
  if (select count(*)<>count(distinct (value->>'catalogProductId')||':'||(value->>'assetId')) from jsonb_array_elements(p_payload->'items')) then raise exception 'LAB_ORDER_INVALID' using errcode='22023'; end if;
  select l.* into lab from public.studio_labs l where l.id=(p_payload->>'labId')::uuid for share;
  if lab.id is null or lab.status<>'active' or not lab.intake_enabled or not lab.catalog_verified then raise exception 'LAB_ORDER_NOT_READY'; end if;
  for item in select value from jsonb_array_elements(p_payload->'items') loop
    if jsonb_typeof(item)<>'object' or exists(select 1 from jsonb_object_keys(item) k where k not in ('catalogProductId','assetId','quantity'))
      or jsonb_typeof(item->'catalogProductId') is distinct from 'string' or jsonb_typeof(item->'assetId') is distinct from 'string'
      or jsonb_typeof(item->'quantity') is distinct from 'number' or coalesce(item->>'quantity','') !~ '^[0-9]{1,3}$'
      or (item->>'quantity')::integer not between 1 and 100 then raise exception 'LAB_ORDER_INVALID' using errcode='22023'; end if;
    unit_count:=(item->>'quantity')::integer;
    select c.* into product from public.studio_lab_catalog c where c.id=(item->>'catalogProductId')::uuid and c.lab_id=lab.id for share;
    if product.id is null or not product.active or not product.verified or product.cost_source<>'lab_confirmed' or product.cost_cents is null
      or nullif(btrim(product.sku),'') is null or product.currency<>lab.currency then raise exception 'LAB_ORDER_SKU_NOT_VERIFIED'; end if;
    select a.* into asset from public.lab_order_assets a where a.id=(item->>'assetId')::uuid and a.photographer_id=studio.id and a.lab_id=lab.id and a.ready for share;
    if asset.id is null then raise exception 'LAB_ORDER_ASSET_UNAVAILABLE' using errcode='42501'; end if;
    image_ratio:=asset.width_pixels::numeric/asset.height_pixels; print_ratio:=product.width_inches/product.height_inches;
    if abs(image_ratio/print_ratio-1)>0.02 and abs(image_ratio*print_ratio-1)>0.02 then raise exception 'LAB_ORDER_ASPECT_MISMATCH'; end if;
    line_number:=line_number+1; line_total:=product.cost_cents::bigint*unit_count; total:=total+line_total;
    lines:=lines||jsonb_build_array(jsonb_build_object('line',line_number,'catalogProductId',product.id,'sku',product.sku,'name',product.name,
      'category',product.category,'size',product.size,'finish',product.finish,'widthInches',product.width_inches,'heightInches',product.height_inches,
      'unitCostMinor',product.cost_cents,'quantity',unit_count,'lineCostMinor',line_total,
      'asset',jsonb_build_object('id',asset.id,'photographerId',asset.photographer_id,'labId',asset.lab_id,'filename',asset.filename,
        'storageKey',asset.storage_key,'sha256',asset.sha256,'contentType',asset.content_type,'byteSize',asset.byte_size,
        'widthPixels',asset.width_pixels,'heightPixels',asset.height_pixels,'ready',asset.ready,'createdAt',asset.created_at)));
  end loop;
  frozen:=jsonb_build_object('version',1,'lab',jsonb_build_object('id',lab.id,'name',lab.name,'currency',lab.currency),
    'studio',jsonb_build_object('photographerId',studio.id,'name',coalesce(studio.business_name,'')),
    'reference',p_payload->>'reference','notes',p_payload->>'notes','delivery',p_payload->'delivery','items',lines,'currency',lab.currency,'totalMinor',total);
  insert into public.lab_orders(photographer_id,lab_id,request_id,request_hash,request_payload,snapshot,currency,total_minor)
    values(studio.id,lab.id,p_request_id,body_hash,p_payload,frozen,lab.currency,total) returning * into order_row;
  insert into public.lab_order_events(order_id,actor_user_id,request_id,request_hash,from_status,to_status,version)
    values(order_row.id,p_actor_user_id,p_request_id,body_hash,null,'submitted',1);
  return jsonb_build_object('id',order_row.id,'version',1,'status','submitted','replayed',false);
end $$;

create or replace function public.transition_lab_order(p_actor_user_id uuid,p_order_id uuid,p_expected_version integer,p_request_id uuid,
  p_status text,p_reason text,p_carrier text,p_tracking_number text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  order_row public.lab_orders%rowtype; prior public.lab_order_events%rowtype; body_hash text;
  studio_actor boolean; lab_actor boolean; valid boolean:=false; delivery_mode text; old_status text;
begin
  if p_actor_user_id is null or p_order_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1
    or p_status is null or p_status not in ('accepted','declined','cancelled','in_production','ready','shipped','completed')
    or p_reason is null or length(p_reason)>2000 or p_carrier is null or length(p_carrier)>100
    or p_tracking_number is null or length(p_tracking_number)>200 then raise exception 'LAB_ORDER_INVALID' using errcode='22023'; end if;
  body_hash:=encode(sha256(convert_to(jsonb_build_object('orderId',p_order_id,'expectedVersion',p_expected_version,'status',p_status,
    'reason',p_reason,'carrier',p_carrier,'trackingNumber',p_tracking_number)::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('lab-order-request:'||p_actor_user_id::text||p_request_id::text,20261015));
  select o.* into order_row from public.lab_orders o where o.id=p_order_id for update;
  if order_row.id is null then raise exception 'LAB_ORDER_NOT_FOUND' using errcode='42501'; end if;
  perform 1 from public.photographers p where p.id=order_row.photographer_id and p.user_id=p_actor_user_id for share;
  studio_actor:=found;
  perform 1 from public.lab_memberships m where m.lab_id=order_row.lab_id and m.user_id=p_actor_user_id and m.active and m.role in ('owner','operator') for share;
  lab_actor:=found;
  if (p_status='cancelled' and not studio_actor) or (p_status<>'cancelled' and not lab_actor) then raise exception 'LAB_ORDER_FORBIDDEN' using errcode='42501'; end if;
  select e.* into prior from public.lab_order_events e where e.actor_user_id=p_actor_user_id and e.request_id=p_request_id;
  if found then
    if prior.order_id<>p_order_id or prior.request_hash<>body_hash then raise exception 'LAB_ORDER_REQUEST_CONFLICT' using errcode='PT409'; end if;
    return jsonb_build_object('id',order_row.id,'version',order_row.version,'status',order_row.status,'replayed',true);
  end if;
  if order_row.version<>p_expected_version then raise exception 'LAB_ORDER_VERSION_CONFLICT' using errcode='PT409'; end if;
  delivery_mode:=order_row.snapshot#>>'{delivery,mode}'; old_status:=order_row.status;
  valid:=(old_status='submitted' and p_status in ('accepted','declined','cancelled'))
    or (old_status='accepted' and p_status='in_production') or (old_status='in_production' and p_status='ready')
    or (old_status='ready' and p_status in ('shipped','completed')) or (old_status='shipped' and p_status='completed');
  if not valid then raise exception 'LAB_ORDER_INVALID_TRANSITION' using errcode='22023'; end if;
  if p_status='declined' and length(btrim(p_reason))=0 then raise exception 'LAB_ORDER_REASON_REQUIRED' using errcode='22023'; end if;
  if p_status='shipped' and (length(btrim(p_carrier))=0 or length(btrim(p_tracking_number))=0) then raise exception 'LAB_ORDER_TRACKING_REQUIRED' using errcode='22023'; end if;
  if p_status<>'shipped' and (length(p_carrier)>0 or length(p_tracking_number)>0) then raise exception 'LAB_ORDER_INVALID' using errcode='22023'; end if;
  if (p_status='shipped' and delivery_mode<>'ship_to_studio') or (old_status='ready' and p_status='completed' and delivery_mode<>'pickup') then raise exception 'LAB_ORDER_DELIVERY_MISMATCH' using errcode='22023'; end if;
  update public.lab_orders set status=p_status,version=version+1,updated_at=clock_timestamp() where id=p_order_id returning * into order_row;
  insert into public.lab_order_events(order_id,actor_user_id,request_id,request_hash,from_status,to_status,version,reason,carrier,tracking_number)
    values(p_order_id,p_actor_user_id,p_request_id,body_hash,old_status,p_status,order_row.version,btrim(p_reason),btrim(p_carrier),btrim(p_tracking_number));
  return jsonb_build_object('id',order_row.id,'version',order_row.version,'status',order_row.status,'replayed',false);
end $$;

commit;
