-- Additive standalone lab workflow. Existing school/project/customer orders,
-- package catalogs, pricing, payments and production flags are never written.
begin;

do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,"public",file_size_limit,allowed_mime_types)
      values('lab-production-files','lab-production-files',false,4000000,array['image/jpeg','image/png']) on conflict do nothing;
    if exists(select 1 from storage.buckets where id='lab-production-files' and "public") then
      raise exception 'LAB_ORDER_BUCKET_NOT_PRIVATE';
    end if;
  end if;
end $$;

create table public.lab_order_assets (
  id uuid primary key default gen_random_uuid(), photographer_id uuid not null references public.photographers(id),
  lab_id uuid not null references public.studio_labs(id), filename text not null check(length(btrim(filename)) between 1 and 180 and filename !~ '[[:cntrl:]/\\]'),
  storage_key text not null unique check(length(storage_key) between 1 and 1024 and storage_key !~ '[[:cntrl:]]'
    and storage_key !~ '^[A-Za-z][A-Za-z0-9+.-]*://' and storage_key !~ '(^|/)\.\.?(/|$)'),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  width_pixels integer not null check(width_pixels>0),height_pixels integer not null check(height_pixels>0),
  content_type text not null check(content_type in ('image/jpeg','image/png')),
  byte_size integer not null check(byte_size between 1 and 4000000),ready boolean not null default false,
  created_at timestamptz not null default now(),check(width_pixels::bigint*height_pixels::bigint<=100000000)
);
create index lab_order_assets_owner_idx on public.lab_order_assets(photographer_id,created_at desc,id);
create index lab_order_assets_lab_idx on public.lab_order_assets(lab_id);

create table public.lab_orders (
  id uuid primary key default gen_random_uuid(),photographer_id uuid not null references public.photographers(id),
  lab_id uuid not null references public.studio_labs(id),request_id uuid not null,request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  request_payload jsonb not null check(jsonb_typeof(request_payload)='object' and octet_length(request_payload::text)<=64000),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=256000),
  currency text not null check(currency ~ '^[A-Z]{3}$'),total_minor bigint not null check(total_minor between 0 and 500000000000),
  status text not null default 'submitted' check(status in ('submitted','accepted','declined','cancelled','in_production','ready','shipped','completed')),
  version integer not null default 1 check(version>0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(photographer_id,request_id),check(snapshot->>'currency'=currency and (snapshot->>'totalMinor')::bigint=total_minor)
);
create index lab_orders_studio_created_idx on public.lab_orders(photographer_id,created_at desc,id);
create index lab_orders_lab_created_idx on public.lab_orders(lab_id,created_at desc,id);
create index lab_orders_lab_status_idx on public.lab_orders(lab_id,status,created_at desc,id);
create index lab_orders_snapshot_idx on public.lab_orders using gin(snapshot jsonb_path_ops);

create table public.lab_order_events (
  id uuid primary key default gen_random_uuid(),order_id uuid not null references public.lab_orders(id),
  actor_user_id uuid not null references auth.users(id),request_id uuid not null,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  from_status text check(from_status in ('submitted','accepted','declined','cancelled','in_production','ready','shipped','completed')),
  to_status text not null check(to_status in ('submitted','accepted','declined','cancelled','in_production','ready','shipped','completed')),
  version integer not null check(version>0),reason text not null default '' check(length(reason)<=2000),
  carrier text not null default '' check(length(carrier)<=100),tracking_number text not null default '' check(length(tracking_number)<=200),
  created_at timestamptz not null default now(),unique(order_id,version),unique(actor_user_id,request_id)
);
create index lab_order_events_order_idx on public.lab_order_events(order_id,version);

create function public.protect_lab_order_asset() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'LAB_ORDER_ASSET_IMMUTABLE' using errcode='42501'; end $$;
create trigger lab_order_assets_immutable before update or delete on public.lab_order_assets for each row execute function public.protect_lab_order_asset();
create function public.protect_lab_order_event() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'LAB_ORDER_EVENT_IMMUTABLE' using errcode='42501'; end $$;
create trigger lab_order_events_immutable before update or delete on public.lab_order_events for each row execute function public.protect_lab_order_event();
create function public.protect_lab_order_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'LAB_ORDER_IMMUTABLE' using errcode='42501'; end if;
  if row(new.id,new.photographer_id,new.lab_id,new.request_id,new.request_hash,new.request_payload,new.snapshot,new.currency,new.total_minor,new.created_at)
    is distinct from row(old.id,old.photographer_id,old.lab_id,old.request_id,old.request_hash,old.request_payload,old.snapshot,old.currency,old.total_minor,old.created_at)
    or new.version<>old.version+1 or new.status=old.status then raise exception 'LAB_ORDER_IMMUTABLE' using errcode='42501'; end if;
  return new;
end $$;
create trigger lab_orders_snapshot_immutable before update or delete on public.lab_orders for each row execute function public.protect_lab_order_snapshot();

alter table public.lab_order_assets enable row level security;
alter table public.lab_order_assets force row level security;
alter table public.lab_orders enable row level security;
alter table public.lab_orders force row level security;
alter table public.lab_order_events enable row level security;
alter table public.lab_order_events force row level security;
revoke all on public.lab_order_assets,public.lab_orders,public.lab_order_events from public,anon,authenticated,service_role;
grant select on public.lab_order_assets,public.lab_orders,public.lab_order_events to authenticated,service_role;
grant insert on public.lab_order_assets to service_role;
create policy lab_orders_read on public.lab_orders for select to authenticated using(
  exists(select 1 from public.photographers p where p.id=lab_orders.photographer_id and p.user_id=auth.uid()) or
  (coalesce(auth.jwt()->>'aal','')='aal2' and
    exists(select 1 from public.lab_memberships m where m.lab_id=lab_orders.lab_id and m.user_id=auth.uid() and m.active))
);
create policy lab_order_events_read on public.lab_order_events for select to authenticated using(
  exists(select 1 from public.lab_orders o where o.id=lab_order_events.order_id)
);
-- Labs cannot see uploaded, unsubmitted studio assets. A submitted order's
-- frozen snapshot grants its active lab staff read access to those exact assets.
create policy lab_order_assets_read on public.lab_order_assets for select to authenticated using(
  exists(select 1 from public.photographers p where p.id=lab_order_assets.photographer_id and p.user_id=auth.uid()) or
  exists(select 1 from public.lab_orders o where o.lab_id=lab_order_assets.lab_id
    and o.snapshot @> jsonb_build_object('items',jsonb_build_array(jsonb_build_object('asset',jsonb_build_object('id',lab_order_assets.id::text))))
    and coalesce(auth.jwt()->>'aal','')='aal2'
    and exists(select 1 from public.lab_memberships m where m.lab_id=o.lab_id and m.user_id=auth.uid() and m.active))
);

create function public.submit_lab_order(p_actor_user_id uuid,p_request_id uuid,p_payload jsonb)
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
    if existing.request_hash<>body_hash or existing.request_payload<>p_payload then raise exception 'LAB_ORDER_REQUEST_CONFLICT' using errcode='40001'; end if;
    return jsonb_build_object('id',existing.id,'version',existing.version,'status',existing.status,'replayed',true);
  end if;
  if exists(select 1 from public.lab_order_events e where e.actor_user_id=p_actor_user_id and e.request_id=p_request_id) then raise exception 'LAB_ORDER_REQUEST_CONFLICT' using errcode='40001'; end if;
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

create function public.transition_lab_order(p_actor_user_id uuid,p_order_id uuid,p_expected_version integer,p_request_id uuid,
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
    if prior.order_id<>p_order_id or prior.request_hash<>body_hash then raise exception 'LAB_ORDER_REQUEST_CONFLICT' using errcode='40001'; end if;
    return jsonb_build_object('id',order_row.id,'version',order_row.version,'status',order_row.status,'replayed',true);
  end if;
  if order_row.version<>p_expected_version then raise exception 'LAB_ORDER_VERSION_CONFLICT' using errcode='40001'; end if;
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

revoke all on function public.submit_lab_order(uuid,uuid,jsonb),public.transition_lab_order(uuid,uuid,integer,uuid,text,text,text,text),
  public.protect_lab_order_asset(),public.protect_lab_order_event(),public.protect_lab_order_snapshot() from public,anon,authenticated;
grant execute on function public.submit_lab_order(uuid,uuid,jsonb),public.transition_lab_order(uuid,uuid,integer,uuid,text,text,text,text) to service_role;
commit;
