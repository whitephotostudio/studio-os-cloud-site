-- Private test copies of studio retail sheets. No catalog, school, package,
-- assignment, checkout, payment or production record is created or rewritten.
begin;

create table public.in_house_price_sheets (
  id uuid primary key,
  photographer_id uuid not null references public.photographers(id),
  source_profile_id text not null check(length(source_profile_id) between 1 and 200),
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  name text not null check(length(btrim(name)) between 1 and 100),
  studio_name text not null check(length(btrim(studio_name)) between 1 and 100),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  version integer not null default 1 check(version > 0),
  document jsonb not null check(jsonb_typeof(document)='object' and octet_length(document::text)<=2400000),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(photographer_id,source_profile_id,source_hash)
);
create index in_house_price_sheets_owner_idx on public.in_house_price_sheets(photographer_id,updated_at desc,id);
alter table public.in_house_price_sheets enable row level security;
alter table public.in_house_price_sheets force row level security;
revoke all on public.in_house_price_sheets from public,anon,authenticated,service_role;
grant select on public.in_house_price_sheets to authenticated,service_role;
create policy in_house_price_sheets_read_own on public.in_house_price_sheets for select to authenticated using(
  exists(select 1 from public.photographers p where p.id=in_house_price_sheets.photographer_id and p.user_id=auth.uid())
);

create function public.save_in_house_price_sheet(p_user_id uuid,p_action text,p_id uuid,p_expected_version integer,p_document jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid; current_row public.in_house_price_sheets%rowtype;
  entry jsonb; edits jsonb; next_entries jsonb; next_document jsonb;
begin
  if p_user_id is null or p_id is null or p_action is null or p_action not in ('import','save')
    or p_expected_version is null or p_expected_version<0 or p_document is null
    or jsonb_typeof(p_document)<>'object' or octet_length(p_document::text)>2400000 then
    raise exception 'IN_HOUSE_INVALID' using errcode='22023';
  end if;
  select p.id into owner_id from public.photographers p where p.user_id=p_user_id;
  if owner_id is null then raise exception 'IN_HOUSE_OWNER' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('in-house-sheet-owner:'||owner_id::text,20261016));
  if p_action='import' then
    if p_expected_version<>0 or exists(select 1 from jsonb_object_keys(p_document) k where k not in ('name','studioName','currency','source','entries','warnings','tax','sourceSnapshot'))
      or jsonb_typeof(p_document->'source') is distinct from 'object'
      or jsonb_typeof(p_document->'sourceSnapshot') is distinct from 'object'
      or jsonb_typeof(p_document->'warnings') is distinct from 'array'
      or jsonb_typeof(p_document->'tax') is distinct from 'object'
      or jsonb_typeof(p_document->'entries') is distinct from 'array'
      or jsonb_typeof(p_document->'name') is distinct from 'string' or length(btrim(p_document->>'name')) not between 1 and 100
      or jsonb_typeof(p_document->'studioName') is distinct from 'string' or length(btrim(p_document->>'studioName')) not between 1 and 100
      or coalesce(p_document->>'currency','') !~ '^[A-Z]{3}$'
      or jsonb_typeof(p_document#>'{source,profileId}') is distinct from 'string' or length(btrim(p_document#>>'{source,profileId}')) not between 1 and 200
      or jsonb_typeof(p_document#>'{source,profileName}') is distinct from 'string' or length(btrim(p_document#>>'{source,profileName}')) not between 1 and 200
      or coalesce(p_document#>>'{source,contentHash}','') !~ '^[a-f0-9]{64}$'
      or exists(select 1 from jsonb_object_keys(p_document->'source') k where k not in ('profileId','profileName','contentHash'))
      or exists(select 1 from jsonb_object_keys(p_document->'tax') k where k not in ('enabled','percent','label'))
      or jsonb_typeof(p_document#>'{tax,enabled}') is distinct from 'boolean'
      or jsonb_typeof(p_document#>'{tax,percent}') is distinct from 'number'
      or (p_document#>>'{tax,percent}')::numeric not between 0 and 100
      or jsonb_typeof(p_document#>'{tax,label}') is distinct from 'string' or length(p_document#>>'{tax,label}')>100
      or jsonb_array_length(p_document->'entries') not between 1 and 1000 or jsonb_array_length(p_document->'warnings')>100 then
      raise exception 'IN_HOUSE_INVALID' using errcode='22023';
    end if;
    for entry in select value from jsonb_array_elements(p_document->'warnings') loop
      if jsonb_typeof(entry)<>'string' or length(entry#>>'{}')>1000 then raise exception 'IN_HOUSE_INVALID' using errcode='22023'; end if;
    end loop;
    for entry in select value from jsonb_array_elements(p_document->'entries') loop
      if jsonb_typeof(entry)<>'object' or exists(select 1 from jsonb_object_keys(entry) k where k not in ('id','sourceKey','section','name','retailCents','active','category','contents','original'))
        or jsonb_typeof(entry->'id') is distinct from 'string' or length(btrim(entry->>'id')) not between 1 and 200
        or jsonb_typeof(entry->'sourceKey') is distinct from 'string' or length(btrim(entry->>'sourceKey')) not between 1 and 200
        or coalesce(entry->>'section','') not in ('individual','package','specialty')
        or jsonb_typeof(entry->'name') is distinct from 'string' or length(btrim(entry->>'name')) not between 1 and 200
        or jsonb_typeof(entry->'retailCents') is distinct from 'number' or (entry->>'retailCents')::numeric not between 0 and 100000000
        or (entry->>'retailCents')::numeric<>trunc((entry->>'retailCents')::numeric)
        or jsonb_typeof(entry->'active') is distinct from 'boolean'
        or jsonb_typeof(entry->'category') is distinct from 'string' or length(entry->>'category')>100
        or jsonb_typeof(entry->'contents') is distinct from 'array' or jsonb_array_length(entry->'contents')>1000
        or jsonb_typeof(entry->'original') is distinct from 'object' then
        raise exception 'IN_HOUSE_INVALID' using errcode='22023';
      end if;
    end loop;
    if (select count(*)<>count(distinct value->>'id') or count(*)<>count(distinct value->>'sourceKey') from jsonb_array_elements(p_document->'entries')) then
      raise exception 'IN_HOUSE_INVALID' using errcode='22023';
    end if;
    select s.* into current_row from public.in_house_price_sheets s
      where s.photographer_id=owner_id and s.source_profile_id=p_document#>>'{source,profileId}' and s.source_hash=p_document#>>'{source,contentHash}' for update;
    if found then
      if current_row.document->'sourceSnapshot' is distinct from p_document->'sourceSnapshot' then raise exception 'IN_HOUSE_SOURCE_CHANGED' using errcode='PT409'; end if;
      -- An import retry must never overwrite edits already made to this copy.
      return to_jsonb(current_row)||jsonb_build_object('replayed',true);
    end if;
    if (select count(*) from public.in_house_price_sheets s where s.photographer_id=owner_id)>=200 then raise exception 'IN_HOUSE_LIMIT' using errcode='22023'; end if;
    if exists(select 1 from public.in_house_price_sheets s where s.id=p_id) then raise exception 'IN_HOUSE_VERSION_CONFLICT' using errcode='PT409'; end if;
    insert into public.in_house_price_sheets(id,photographer_id,source_profile_id,source_hash,name,studio_name,currency,document)
      values(p_id,owner_id,p_document#>>'{source,profileId}',p_document#>>'{source,contentHash}',btrim(p_document->>'name'),btrim(p_document->>'studioName'),p_document->>'currency',p_document) returning * into current_row;
    return to_jsonb(current_row)||jsonb_build_object('replayed',false);
  end if;
  select s.* into current_row from public.in_house_price_sheets s where s.id=p_id for update;
  if current_row.id is null or current_row.photographer_id<>owner_id then raise exception 'IN_HOUSE_NOT_FOUND' using errcode='42501'; end if;
  if current_row.version<>p_expected_version then raise exception 'IN_HOUSE_VERSION_CONFLICT' using errcode='PT409'; end if;
  if exists(select 1 from jsonb_object_keys(p_document) k where k not in ('name','entries'))
    or jsonb_typeof(p_document->'name') is distinct from 'string' or length(btrim(p_document->>'name')) not between 1 and 100
    or jsonb_typeof(p_document->'entries') is distinct from 'array'
    or jsonb_array_length(p_document->'entries')<>jsonb_array_length(current_row.document->'entries') then raise exception 'IN_HOUSE_INVALID' using errcode='22023'; end if;
  for entry in select value from jsonb_array_elements(p_document->'entries') loop
    if jsonb_typeof(entry)<>'object' or exists(select 1 from jsonb_object_keys(entry) k where k not in ('id','retailCents','active'))
      or jsonb_typeof(entry->'id') is distinct from 'string'
      or jsonb_typeof(entry->'retailCents') is distinct from 'number' or (entry->>'retailCents')::numeric not between 0 and 100000000
      or (entry->>'retailCents')::numeric<>trunc((entry->>'retailCents')::numeric)
      or jsonb_typeof(entry->'active') is distinct from 'boolean'
      or not exists(select 1 from jsonb_array_elements(current_row.document->'entries') old where old->>'id'=entry->>'id') then
      raise exception 'IN_HOUSE_INVALID' using errcode='22023';
    end if;
  end loop;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_document->'entries')) then raise exception 'IN_HOUSE_INVALID' using errcode='22023'; end if;
  edits:=p_document->'entries';
  select jsonb_agg(old.value||jsonb_build_object('retailCents',edit.value->'retailCents','active',edit.value->'active') order by old.ordinality)
    into next_entries from jsonb_array_elements(current_row.document->'entries') with ordinality old(value,ordinality)
    join jsonb_array_elements(edits) edit(value) on edit.value->>'id'=old.value->>'id';
  next_document:=jsonb_set(jsonb_set(current_row.document,'{name}',to_jsonb(btrim(p_document->>'name'))),'{entries}',next_entries);
  update public.in_house_price_sheets s set name=btrim(p_document->>'name'),document=next_document,version=s.version+1,updated_at=now()
    where s.id=p_id returning * into current_row;
  return to_jsonb(current_row)||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.save_in_house_price_sheet(uuid,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_in_house_price_sheet(uuid,text,uuid,integer,jsonb) to service_role;

commit;
