-- Isolated, synthetic in-house rehearsal only. No existing pricing, gallery,
-- school, partner lab, payment, customer order or production table is changed.
begin;

create table public.in_house_test_galleries (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id),
  request_id uuid not null, request_payload jsonb not null,
  sheet_id uuid not null references public.in_house_price_sheets(id),
  source jsonb not null, document jsonb not null check(jsonb_typeof(document)='object' and octet_length(document::text)<32000),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  version integer not null default 1 check(version between 1 and 2000000000),
  expires_at timestamptz not null default now()+interval '7 days', revoked_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(photographer_id,request_id)
);
create index in_house_test_galleries_owner_idx on public.in_house_test_galleries(photographer_id,created_at desc,id);
create table public.in_house_test_orders (
  id uuid primary key default gen_random_uuid(), reference text not null unique,
  photographer_id uuid not null references public.photographers(id),
  gallery_id uuid not null references public.in_house_test_galleries(id),
  request_id uuid not null, request_payload jsonb not null,
  receipt_hash text not null unique check(receipt_hash ~ '^[a-f0-9]{64}$'),
  receipt_expires_at timestamptz not null default now()+interval '30 days',
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<32000),
  status text not null default 'submitted' check(status in ('submitted','accepted','in_production','ready','completed')),
  version integer not null default 1 check(version between 1 and 2000000000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(gallery_id,request_id)
);
create index in_house_test_orders_owner_idx on public.in_house_test_orders(photographer_id,created_at desc,id);
create table public.in_house_test_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.in_house_test_orders(id),
  actor_user_id uuid references auth.users(id), request_id uuid not null, request_payload jsonb not null,
  status text not null check(status in ('submitted','accepted','in_production','ready','completed')),
  version integer not null check(version between 1 and 2000000000), created_at timestamptz not null default now(),
  unique(order_id,version), unique(actor_user_id,request_id)
);
create index in_house_test_order_events_order_idx on public.in_house_test_order_events(order_id,version);

alter table public.in_house_test_galleries enable row level security;
alter table public.in_house_test_galleries force row level security;
alter table public.in_house_test_orders enable row level security;
alter table public.in_house_test_orders force row level security;
alter table public.in_house_test_order_events enable row level security;
alter table public.in_house_test_order_events force row level security;
revoke all on public.in_house_test_galleries,public.in_house_test_orders,public.in_house_test_order_events from public,anon,authenticated,service_role;
grant select on public.in_house_test_galleries,public.in_house_test_orders,public.in_house_test_order_events to authenticated,service_role;
create policy in_house_test_galleries_owner_read on public.in_house_test_galleries for select to authenticated using(
  exists(select 1 from public.photographers p where p.id=in_house_test_galleries.photographer_id and p.user_id=auth.uid())
);
create policy in_house_test_orders_owner_read on public.in_house_test_orders for select to authenticated using(
  exists(select 1 from public.photographers p where p.id=in_house_test_orders.photographer_id and p.user_id=auth.uid())
);
create policy in_house_test_order_events_owner_read on public.in_house_test_order_events for select to authenticated using(
  exists(select 1 from public.in_house_test_orders o join public.photographers p on p.id=o.photographer_id where o.id=in_house_test_order_events.order_id and p.user_id=auth.uid())
);

create function public.protect_in_house_test_gallery() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'IN_HOUSE_TEST_IMMUTABLE' using errcode='42501'; end if;
  if row(new.id,new.photographer_id,new.request_id,new.request_payload,new.sheet_id,new.source,new.document,new.created_at)
    is distinct from row(old.id,old.photographer_id,old.request_id,old.request_payload,old.sheet_id,old.source,old.document,old.created_at) then
    raise exception 'IN_HOUSE_TEST_IMMUTABLE' using errcode='42501';
  end if;
  return new;
end $$;
create trigger in_house_test_galleries_immutable before update or delete on public.in_house_test_galleries for each row execute function public.protect_in_house_test_gallery();
create function public.protect_in_house_test_order() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'IN_HOUSE_TEST_IMMUTABLE' using errcode='42501'; end if;
  if row(new.id,new.reference,new.photographer_id,new.gallery_id,new.request_id,new.request_payload,new.receipt_hash,new.receipt_expires_at,new.snapshot,new.created_at)
    is distinct from row(old.id,old.reference,old.photographer_id,old.gallery_id,old.request_id,old.request_payload,old.receipt_hash,old.receipt_expires_at,old.snapshot,old.created_at) then
    raise exception 'IN_HOUSE_TEST_IMMUTABLE' using errcode='42501';
  end if;
  return new;
end $$;
create trigger in_house_test_orders_immutable before update or delete on public.in_house_test_orders for each row execute function public.protect_in_house_test_order();
create function public.protect_in_house_test_event() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'IN_HOUSE_TEST_IMMUTABLE' using errcode='42501'; end $$;
create trigger in_house_test_events_immutable before update or delete on public.in_house_test_order_events for each row execute function public.protect_in_house_test_event();

create function public.in_house_test_gallery_projection(p_gallery public.in_house_test_galleries)
returns jsonb language sql stable set search_path='' as $$
  select p_gallery.document || jsonb_build_object('id',p_gallery.id,'version',p_gallery.version,'expiresAt',p_gallery.expires_at,'revokedAt',p_gallery.revoked_at,'createdAt',p_gallery.created_at)
$$;
create function public.in_house_test_receipt_projection(p_order public.in_house_test_orders)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',p_order.id,'reference',p_order.reference,'status',p_order.status,'version',p_order.version,
    'snapshot',p_order.snapshot-'source','events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'status',e.status,'version',e.version,'createdAt',e.created_at) order by e.version)
      from public.in_house_test_order_events e where e.order_id=p_order.id),'[]'::jsonb),'createdAt',p_order.created_at,'updatedAt',p_order.updated_at)
$$;

create function public.create_in_house_test_gallery(p_user_id uuid,p_request_id uuid,p_sheet_id uuid,p_expected_sheet_version integer,p_entry_id text,p_name text,p_token_hash text,p_assets jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid; sheet public.in_house_price_sheets%rowtype; gallery public.in_house_test_galleries%rowtype;
  chosen jsonb; item jsonb; asset jsonb; offer jsonb; payload jsonb; eight boolean:=false; five boolean:=false;
begin
  if p_user_id is null or p_request_id is null or p_sheet_id is null or p_expected_sheet_version is null or p_expected_sheet_version<1
    or p_entry_id is null or length(p_entry_id) not between 1 and 200 or p_name is null or length(btrim(p_name)) not between 1 and 100 or p_name ~ '[[:cntrl:]]'
    or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_assets is null or jsonb_typeof(p_assets)<>'array' or jsonb_array_length(p_assets)<>2 then
    raise exception 'IN_HOUSE_TEST_INVALID' using errcode='22023';
  end if;
  select p.id into owner_id from public.photographers p where p.user_id=p_user_id;
  if owner_id is null then raise exception 'IN_HOUSE_TEST_NOT_FOUND' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('in-house-test-owner:'||owner_id::text,20261016));
  payload:=jsonb_build_object('sheetId',p_sheet_id,'expectedSheetVersion',p_expected_sheet_version,'entryId',p_entry_id,'name',btrim(p_name),'tokenHash',p_token_hash,'assets',p_assets);
  select g.* into gallery from public.in_house_test_galleries g where g.photographer_id=owner_id and g.request_id=p_request_id;
  if found then
    if gallery.request_payload is distinct from payload then raise exception 'IN_HOUSE_TEST_REQUEST_CONFLICT' using errcode='PT409'; end if;
    return to_jsonb(gallery)||jsonb_build_object('replayed',true);
  end if;
  select s.* into sheet from public.in_house_price_sheets s where s.id=p_sheet_id and s.photographer_id=owner_id for share;
  if not found then raise exception 'IN_HOUSE_TEST_NOT_FOUND' using errcode='42501'; end if;
  if sheet.version<>p_expected_sheet_version then raise exception 'IN_HOUSE_TEST_VERSION_CONFLICT' using errcode='PT409'; end if;
  select e.value into chosen from jsonb_array_elements(sheet.document->'entries') e where e.value->>'id'=p_entry_id;
  if chosen is null or chosen->'active' is distinct from 'true'::jsonb or chosen->>'section' is distinct from 'package'
    or jsonb_typeof(chosen->'retailCents') is distinct from 'number' or (chosen->>'retailCents')::numeric not between 1 and 100000000
    or (chosen->>'retailCents')::numeric<>trunc((chosen->>'retailCents')::numeric)
    or jsonb_typeof(chosen->'contents') is distinct from 'array' or jsonb_array_length(chosen->'contents')<>2 then
    raise exception 'IN_HOUSE_TEST_OFFER_UNAVAILABLE' using errcode='PT409';
  end if;
  for item in select value from jsonb_array_elements(chosen->'contents') loop
    if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>2
      or not(item ? 'name' and item ? 'qty') or jsonb_typeof(item->'qty') is distinct from 'number' then
      raise exception 'IN_HOUSE_TEST_OFFER_UNAVAILABLE' using errcode='PT409';
    end if;
    if item->>'name'='8x10 Lustre' and item->'qty'='1'::jsonb and not eight then eight:=true;
    elsif item->>'name'='5x7 Lustre' and item->'qty'='2'::jsonb and not five then five:=true;
    else raise exception 'IN_HOUSE_TEST_OFFER_UNAVAILABLE' using errcode='PT409'; end if;
  end loop;
  if not eight or not five then raise exception 'IN_HOUSE_TEST_OFFER_UNAVAILABLE' using errcode='PT409'; end if;
  eight:=false; five:=false;
  for asset in select value from jsonb_array_elements(p_assets) loop
    if jsonb_typeof(asset)<>'object' or (select count(*) from jsonb_object_keys(asset))<>9
      or exists(select 1 from jsonb_object_keys(asset) k where k not in ('id','filename','widthInches','heightInches','widthPixels','heightPixels','sha256','byteSize','quantity'))
      or jsonb_typeof(asset->'filename') is distinct from 'string' or length(asset->>'filename')>100 or asset->>'filename' !~ '^[a-zA-Z0-9._-]+[.](jpg|png)$'
      or jsonb_typeof(asset->'sha256') is distinct from 'string' or coalesce(asset->>'sha256','') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(asset->'byteSize') is distinct from 'number' or (asset->>'byteSize')::numeric not between 1 and 4000000 or (asset->>'byteSize')::numeric<>trunc((asset->>'byteSize')::numeric)
      or jsonb_typeof(asset->'widthPixels') is distinct from 'number' or (asset->>'widthPixels')::numeric not between 1 and 100000 or (asset->>'widthPixels')::numeric<>trunc((asset->>'widthPixels')::numeric)
      or jsonb_typeof(asset->'heightPixels') is distinct from 'number' or (asset->>'heightPixels')::numeric not between 1 and 100000 or (asset->>'heightPixels')::numeric<>trunc((asset->>'heightPixels')::numeric)
      or (asset->>'widthPixels')::numeric*(asset->>'heightPixels')::numeric>100000000 then
      raise exception 'IN_HOUSE_TEST_ASSETS_INVALID' using errcode='22023';
    end if;
    if asset->>'id'='sample-8x10' and asset->'widthInches'='8'::jsonb and asset->'heightInches'='10'::jsonb and asset->'quantity'='1'::jsonb and not eight then eight:=true;
    elsif asset->>'id'='sample-5x7' and asset->'widthInches'='5'::jsonb and asset->'heightInches'='7'::jsonb and asset->'quantity'='2'::jsonb and not five then five:=true;
    else raise exception 'IN_HOUSE_TEST_ASSETS_INVALID' using errcode='22023'; end if;
    if abs(((asset->>'widthPixels')::numeric/(asset->>'heightPixels')::numeric)/((asset->>'widthInches')::numeric/(asset->>'heightInches')::numeric)-1)>0.02 then
      raise exception 'IN_HOUSE_TEST_ASSETS_INVALID' using errcode='22023';
    end if;
  end loop;
  if not eight or not five then raise exception 'IN_HOUSE_TEST_ASSETS_INVALID' using errcode='22023'; end if;
  if (select count(*) from public.in_house_test_galleries g where g.photographer_id=owner_id)>=30 then raise exception 'IN_HOUSE_TEST_LIMIT' using errcode='22023'; end if;
  if exists(select 1 from public.in_house_test_galleries g where g.token_hash=p_token_hash) then raise exception 'IN_HOUSE_TEST_REQUEST_CONFLICT' using errcode='PT409'; end if;
  -- Parent offer IDs are independent identifiers, never IDs from the private source copy.
  offer:=jsonb_build_object('id',gen_random_uuid(),'name',chosen->>'name','retailCents',chosen->'retailCents','contents',jsonb_build_array(jsonb_build_object('name','8x10 Lustre','qty',1),jsonb_build_object('name','5x7 Lustre','qty',2)));
  insert into public.in_house_test_galleries(photographer_id,request_id,request_payload,sheet_id,source,document,token_hash)
    values(owner_id,p_request_id,payload,p_sheet_id,
      jsonb_build_object('sheetId',sheet.id,'sheetVersion',sheet.version,'entryId',p_entry_id,'sourceHash',sheet.source_hash,'sourceProfileId',sheet.source_profile_id),
      jsonb_build_object('name',btrim(p_name),'studioName',sheet.studio_name,'currency',sheet.currency,'offer',offer,'photoId','studio-os-inhouse-demo-v1','assets',p_assets),p_token_hash)
    returning * into gallery;
  return to_jsonb(gallery)||jsonb_build_object('replayed',false);
end $$;

create function public.manage_in_house_test_gallery(p_user_id uuid,p_gallery_id uuid,p_expected_version integer,p_action text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare gallery public.in_house_test_galleries%rowtype; owner_id uuid;
begin
  if p_user_id is null or p_gallery_id is null or p_expected_version is null or p_expected_version<1 or p_action is null or p_action not in ('rotate','revoke')
    or p_action='rotate' and (p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$') or p_action='revoke' and p_token_hash is not null then
    raise exception 'IN_HOUSE_TEST_INVALID' using errcode='22023';
  end if;
  select p.id into owner_id from public.photographers p where p.user_id=p_user_id;
  select g.* into gallery from public.in_house_test_galleries g where g.id=p_gallery_id and g.photographer_id=owner_id for update;
  if not found then raise exception 'IN_HOUSE_TEST_NOT_FOUND' using errcode='42501'; end if;
  if gallery.version=p_expected_version+1 and ((p_action='revoke' and gallery.revoked_at is not null) or (p_action='rotate' and gallery.token_hash=p_token_hash and gallery.revoked_at is null)) then
    return to_jsonb(gallery)||jsonb_build_object('replayed',true);
  end if;
  if gallery.version<>p_expected_version or gallery.version>=2000000000 then raise exception 'IN_HOUSE_TEST_VERSION_CONFLICT' using errcode='PT409'; end if;
  if p_action='rotate' then
    if gallery.token_hash=p_token_hash or exists(select 1 from public.in_house_test_galleries g where g.token_hash=p_token_hash) then raise exception 'IN_HOUSE_TEST_REQUEST_CONFLICT' using errcode='PT409'; end if;
    update public.in_house_test_galleries set token_hash=p_token_hash,expires_at=now()+interval '7 days',revoked_at=null,version=version+1,updated_at=now() where id=p_gallery_id returning * into gallery;
  else
    if gallery.revoked_at is not null then raise exception 'IN_HOUSE_TEST_VERSION_CONFLICT' using errcode='PT409'; end if;
    update public.in_house_test_galleries set revoked_at=now(),version=version+1,updated_at=now() where id=p_gallery_id returning * into gallery;
  end if;
  return to_jsonb(gallery)||jsonb_build_object('replayed',false);
end $$;

create function public.read_in_house_test_gallery(p_gallery_id uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare gallery public.in_house_test_galleries%rowtype;
begin
  if p_gallery_id is null or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'IN_HOUSE_TEST_NOT_FOUND' using errcode='42501'; end if;
  select g.* into gallery from public.in_house_test_galleries g where g.id=p_gallery_id and g.token_hash=p_token_hash and g.revoked_at is null and g.expires_at>now();
  if not found then raise exception 'IN_HOUSE_TEST_NOT_FOUND' using errcode='42501'; end if;
  return public.in_house_test_gallery_projection(gallery);
end $$;

create function public.submit_in_house_test_order(p_gallery_id uuid,p_token_hash text,p_request_id uuid,p_receipt_hash text,p_offer_id text,p_photo_id text,p_quantity integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare gallery public.in_house_test_galleries%rowtype; saved public.in_house_test_orders%rowtype; payload jsonb; frozen jsonb; assets jsonb; order_id uuid; subtotal bigint;
begin
  if p_gallery_id is null or p_request_id is null or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$' or p_offer_id is null or length(p_offer_id) not between 1 and 200
    or p_photo_id is distinct from 'studio-os-inhouse-demo-v1' or p_quantity is null or p_quantity not between 1 and 10 then raise exception 'IN_HOUSE_TEST_INVALID' using errcode='22023'; end if;
  select g.* into gallery from public.in_house_test_galleries g where g.id=p_gallery_id and g.token_hash=p_token_hash and g.revoked_at is null and g.expires_at>now() for update;
  if not found then raise exception 'IN_HOUSE_TEST_NOT_FOUND' using errcode='42501'; end if;
  payload:=jsonb_build_object('tokenHash',p_token_hash,'receiptHash',p_receipt_hash,'offerId',p_offer_id,'photoId',p_photo_id,'quantity',p_quantity);
  select o.* into saved from public.in_house_test_orders o where o.gallery_id=p_gallery_id and o.request_id=p_request_id;
  if found then
    if saved.request_payload is distinct from payload then raise exception 'IN_HOUSE_TEST_REQUEST_CONFLICT' using errcode='PT409'; end if;
    return public.in_house_test_receipt_projection(saved)||jsonb_build_object('replayed',true);
  end if;
  if gallery.document#>>'{offer,id}' is distinct from p_offer_id then raise exception 'IN_HOUSE_TEST_OFFER_UNAVAILABLE' using errcode='PT409'; end if;
  if (select count(*) from public.in_house_test_orders o where o.gallery_id=p_gallery_id)>=20 then raise exception 'IN_HOUSE_TEST_LIMIT' using errcode='22023'; end if;
  if exists(select 1 from public.in_house_test_orders o where o.receipt_hash=p_receipt_hash) then raise exception 'IN_HOUSE_TEST_REQUEST_CONFLICT' using errcode='PT409'; end if;
  subtotal:=(gallery.document#>>'{offer,retailCents}')::bigint*p_quantity;
  select jsonb_agg(a.value||jsonb_build_object('quantity',(a.value->>'quantity')::integer*p_quantity) order by a.ordinality)
    into assets from jsonb_array_elements(gallery.document->'assets') with ordinality a(value,ordinality);
  frozen:=jsonb_build_object('schemaVersion',1,'testOnly',true,'galleryName',gallery.document->>'name','studioName',gallery.document->>'studioName',
    'currency',gallery.document->>'currency','offer',gallery.document->'offer','photoId',p_photo_id,'quantity',p_quantity,'subtotalMinor',subtotal,
    'taxMinor',0,'shippingMinor',0,'paymentCollectedMinor',0,'fulfillment','in_house','delivery','pickup','assets',assets,'source',gallery.source);
  order_id:=gen_random_uuid();
  insert into public.in_house_test_orders(id,reference,photographer_id,gallery_id,request_id,request_payload,receipt_hash,snapshot)
    values(order_id,'TEST-'||upper(replace(order_id::text,'-','')),gallery.photographer_id,p_gallery_id,p_request_id,payload,p_receipt_hash,frozen) returning * into saved;
  insert into public.in_house_test_order_events(order_id,actor_user_id,request_id,request_payload,status,version) values(saved.id,null,p_request_id,payload,'submitted',1);
  return public.in_house_test_receipt_projection(saved)||jsonb_build_object('replayed',false);
end $$;

create function public.read_in_house_test_receipt(p_receipt_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.in_house_test_orders%rowtype;
begin
  if p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$' then raise exception 'IN_HOUSE_TEST_NOT_FOUND' using errcode='42501'; end if;
  select o.* into saved from public.in_house_test_orders o where o.receipt_hash=p_receipt_hash and o.receipt_expires_at>now();
  if not found then raise exception 'IN_HOUSE_TEST_NOT_FOUND' using errcode='42501'; end if;
  return public.in_house_test_receipt_projection(saved);
end $$;

create function public.transition_in_house_test_order(p_user_id uuid,p_order_id uuid,p_expected_version integer,p_request_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.in_house_test_orders%rowtype; prior public.in_house_test_order_events%rowtype; owner_id uuid; payload jsonb; next_status text;
begin
  if p_user_id is null or p_order_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1
    or p_status is null or p_status not in ('accepted','in_production','ready','completed') then raise exception 'IN_HOUSE_TEST_INVALID' using errcode='22023'; end if;
  select p.id into owner_id from public.photographers p where p.user_id=p_user_id;
  if owner_id is null then raise exception 'IN_HOUSE_TEST_NOT_FOUND' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('in-house-test-transition:'||p_user_id::text||p_request_id::text,20261016));
  select o.* into saved from public.in_house_test_orders o where o.id=p_order_id and o.photographer_id=owner_id for update;
  if not found then raise exception 'IN_HOUSE_TEST_NOT_FOUND' using errcode='42501'; end if;
  payload:=jsonb_build_object('orderId',p_order_id,'expectedVersion',p_expected_version,'status',p_status);
  select e.* into prior from public.in_house_test_order_events e where e.actor_user_id=p_user_id and e.request_id=p_request_id;
  if found then
    if prior.request_payload is distinct from payload or prior.order_id<>p_order_id then raise exception 'IN_HOUSE_TEST_REQUEST_CONFLICT' using errcode='PT409'; end if;
    return to_jsonb(saved)||jsonb_build_object('replayed',true);
  end if;
  if saved.version<>p_expected_version or saved.version>=2000000000 then raise exception 'IN_HOUSE_TEST_VERSION_CONFLICT' using errcode='PT409'; end if;
  next_status:=case saved.status when 'submitted' then 'accepted' when 'accepted' then 'in_production' when 'in_production' then 'ready' when 'ready' then 'completed' else null end;
  if p_status is distinct from next_status then raise exception 'IN_HOUSE_TEST_TRANSITION' using errcode='PT409'; end if;
  update public.in_house_test_orders set status=p_status,version=version+1,updated_at=now() where id=p_order_id returning * into saved;
  insert into public.in_house_test_order_events(order_id,actor_user_id,request_id,request_payload,status,version) values(saved.id,p_user_id,p_request_id,payload,p_status,saved.version);
  return to_jsonb(saved)||jsonb_build_object('replayed',false);
end $$;

revoke all on function public.protect_in_house_test_gallery(),public.protect_in_house_test_order(),public.protect_in_house_test_event(),
  public.in_house_test_gallery_projection(public.in_house_test_galleries),public.in_house_test_receipt_projection(public.in_house_test_orders),
  public.create_in_house_test_gallery(uuid,uuid,uuid,integer,text,text,text,jsonb),public.manage_in_house_test_gallery(uuid,uuid,integer,text,text),
  public.read_in_house_test_gallery(uuid,text),public.submit_in_house_test_order(uuid,text,uuid,text,text,text,integer),
  public.read_in_house_test_receipt(text),public.transition_in_house_test_order(uuid,uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.create_in_house_test_gallery(uuid,uuid,uuid,integer,text,text,text,jsonb),public.manage_in_house_test_gallery(uuid,uuid,integer,text,text),
  public.read_in_house_test_gallery(uuid,text),public.submit_in_house_test_order(uuid,text,uuid,text,text,text,integer),
  public.read_in_house_test_receipt(text),public.transition_in_house_test_order(uuid,uuid,integer,uuid,text) to service_role;

commit;
