-- Lab reference costs are private draft inputs, never approval to sell or print.
-- No existing package, gallery, order, payment or production state is changed.
begin;

create table public.studio_labs (
  id uuid primary key default gen_random_uuid(), slug text not null unique,
  name text not null, location text not null default '',
  country_code char(2) not null check(country_code ~ '^[A-Z]{2}$'),
  city text not null default '' check(length(city)<=100), region text not null default '' check(length(region)<=100),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  status text not null default 'setup' check(status in ('setup','active','paused')),
  intake_enabled boolean not null default false, catalog_verified boolean not null default false,
  description text not null default '', created_at timestamptz not null default now(),
  check(not intake_enabled or (status = 'active' and catalog_verified))
);
create table public.studio_lab_catalog (
  id uuid primary key default gen_random_uuid(), lab_id uuid not null references public.studio_labs(id),
  category text not null check(category in ('prints','fine_art','canvas','metal')),
  name text not null, size text not null, finish text not null,
  cost_cents integer check(cost_cents between 0 and 100000000), currency text not null check(currency ~ '^[A-Z]{3}$'),
  sku text, verified boolean not null default false, active boolean not null default true, popular boolean not null default false,
  width_inches numeric not null check(width_inches > 0 and width_inches <= 120),
  height_inches numeric not null check(height_inches > 0 and height_inches <= 120),
  cost_source text not null check(cost_source in ('lab_confirmed','screenshot_reference','not_provided')),
  check(not verified or (nullif(btrim(sku),'') is not null and cost_source = 'lab_confirmed' and cost_cents is not null))
);
create index studio_lab_catalog_lab_idx on public.studio_lab_catalog(lab_id);
create index studio_lab_catalog_directory_idx on public.studio_lab_catalog(lab_id,category,width_inches,height_inches,id);
create index studio_labs_country_city_idx on public.studio_labs(country_code,lower(city));
create index studio_labs_city_idx on public.studio_labs(lower(city));
create index studio_labs_status_idx on public.studio_labs(status);

-- Memberships are granted by a trusted provisioning process only. Browser
-- sessions cannot enroll themselves or grant another user a role.
create table public.lab_memberships (
  lab_id uuid not null references public.studio_labs(id), user_id uuid not null references auth.users(id),
  role text not null check(role in ('owner','operator','viewer')), active boolean not null default true,
  created_at timestamptz not null default now(), primary key(lab_id,user_id)
);
create table public.lab_price_sheets (
  id uuid primary key, photographer_id uuid not null references public.photographers(id),
  lab_id uuid not null references public.studio_labs(id), version integer not null default 1 check(version > 0),
  name text not null check(length(name) between 1 and 100), currency text not null check(currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft' check(status in ('draft','published')),
  document jsonb not null check(jsonb_typeof(document) = 'object' and octet_length(document::text) <= 256000),
  published_profile_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index lab_price_sheets_owner_idx on public.lab_price_sheets(photographer_id,updated_at desc);
alter table public.package_profiles add column if not exists lab_configuration jsonb;

alter table public.studio_labs enable row level security;
alter table public.studio_labs force row level security;
alter table public.studio_lab_catalog enable row level security;
alter table public.studio_lab_catalog force row level security;
alter table public.lab_memberships enable row level security;
alter table public.lab_memberships force row level security;
alter table public.lab_price_sheets enable row level security;
alter table public.lab_price_sheets force row level security;
revoke all on public.studio_labs, public.studio_lab_catalog, public.lab_memberships, public.lab_price_sheets from public, anon, authenticated;
grant select on public.studio_labs, public.studio_lab_catalog, public.lab_memberships, public.lab_price_sheets to authenticated;
grant select,insert,update,delete on public.studio_labs, public.studio_lab_catalog, public.lab_memberships to service_role;
grant select on public.lab_price_sheets to service_role;
create policy lab_memberships_read_own on public.lab_memberships for select to authenticated using(user_id = auth.uid() and active);
create policy studio_labs_read on public.studio_labs for select to authenticated using(
  exists(select 1 from public.photographers p where p.user_id = auth.uid()) or
  exists(select 1 from public.lab_memberships m where m.lab_id = studio_labs.id and m.user_id = auth.uid() and m.active)
);
create policy studio_lab_catalog_read on public.studio_lab_catalog for select to authenticated using(
  exists(select 1 from public.photographers p where p.user_id = auth.uid()) or
  exists(select 1 from public.lab_memberships m where m.lab_id = studio_lab_catalog.lab_id and m.user_id = auth.uid() and m.active)
);
create policy lab_price_sheets_read_own on public.lab_price_sheets for select to authenticated using(
  exists(select 1 from public.photographers p where p.id = lab_price_sheets.photographer_id and p.user_id = auth.uid())
);

insert into public.studio_labs(id,slug,name,location,country_code,city,region,currency,status,intake_enabled,catalog_verified,description)
values('a1500000-0000-4000-8000-000000000001','gta-imaging','GTA Imaging','Toronto, Ontario','CA','Toronto','Ontario','CAD','setup',false,false,
  'Reference catalog for planning. Costs were transcribed from user-provided screenshots and require written lab confirmation. Ordering, publication and production intake are disabled.');
insert into public.studio_lab_catalog(id,lab_id,category,name,size,finish,cost_cents,currency,sku,verified,active,popular,width_inches,height_inches,cost_source)
select ('a1510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'a1500000-0000-4000-8000-000000000001'::uuid,category,name,size,finish,cost,'CAD',null,false,true,popular,w,h,'screenshot_reference'
from (values
 (1,'prints','4×6 Print','4x6','Deep Matte',317,true,4,6),
 (2,'prints','4×6 Print','4x6','Lustre',240,true,4,6),
 (3,'prints','5×7 Print','5x7','Deep Matte',475,true,5,7),
 (4,'prints','5×7 Print','5x7','Lustre',335,true,5,7),
 (5,'prints','8×10 Print','8x10','Deep Matte',949,true,8,10),
 (6,'prints','8×10 Print','8x10','Lustre',672,true,8,10),
 (7,'prints','11×14 Print','11x14','Deep Matte',2532,false,11,14),
 (8,'prints','11×14 Print','11x14','Lustre',1534,false,11,14),
 (9,'prints','16×20 Print','16x20','Deep Matte',5695,false,16,20),
 (10,'prints','16×20 Print','16x20','Lustre',3451,false,16,20),
 (11,'canvas','8×10 Canvas','8x10','Canvas',7499,true,8,10),
 (12,'canvas','11×14 Canvas','11x14','Canvas',9130,false,11,14),
 (13,'canvas','16×20 Canvas','16x20','Canvas',16116,false,16,20),
 (14,'canvas','20×30 Canvas','20x30','Canvas',23564,false,20,30),
 (15,'fine_art','8×10 Fine Art','8x10','Enhanced Matte',1955,false,8,10),
 (16,'fine_art','8×10 Fine Art','8x10','Photo Rag',2488,false,8,10),
 (17,'metal','8×8 Metal Print','8x8','Float Mount',5265,true,8,8)
) as seed(n,category,name,size,finish,cost,popular,w,h);

-- Only this bounded, owned RPC may create or edit a sheet. It uses a row lock
-- and an expected version so an old tab cannot overwrite a newer save/delete.
create function public.save_lab_price_sheet(p_user_id uuid,p_id uuid,p_expected_version integer,p_document jsonb,p_action text)
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
    if found or p_expected_version <> 0 then raise exception 'LAB_VERSION_CONFLICT' using errcode='40001'; end if;
    if (select count(*) from public.lab_price_sheets s where s.photographer_id=owner_id) >= 200 then raise exception 'LAB_INVALID'; end if;
  else
    if current_row.id is null or current_row.photographer_id <> owner_id then raise exception 'LAB_NOT_FOUND' using errcode='42501'; end if;
    if current_row.version <> p_expected_version then raise exception 'LAB_VERSION_CONFLICT' using errcode='40001'; end if;
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

-- Publish adds a fresh immutable price-sheet snapshot and maps only explicitly
-- selected owned galleries. It never rewrites old profiles, packages or orders.
create function public.publish_lab_price_sheet(p_user_id uuid,p_id uuid,p_expected_version integer,p_assignments jsonb)
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
  if sheet.version<>p_expected_version then raise exception 'LAB_VERSION_CONFLICT' using errcode='40001'; end if;
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

revoke all on function public.save_lab_price_sheet(uuid,uuid,integer,jsonb,text),public.publish_lab_price_sheet(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_lab_price_sheet(uuid,uuid,integer,jsonb,text),public.publish_lab_price_sheet(uuid,uuid,integer,jsonb) to service_role;
commit;
