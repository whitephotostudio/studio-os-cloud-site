-- Country-specific planning metadata only. No existing row is rewritten or enabled.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '10s';
create table public.lab_country_profiles (
 lab_id uuid not null references public.studio_labs(id),
 market_country_code char(2) not null check(market_country_code ~ '^[A-Z]{2}$'),
 revision integer not null check(revision between 1 and 1000000000),
 status text not null check(status in('pending','approved')),
 document jsonb check(document is null or (jsonb_typeof(document)='object' and octet_length(document::text)<=64000)),
 created_by uuid not null references auth.users(id), reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
 created_at timestamptz not null default now(), primary key(lab_id,market_country_code,revision),
 check((status='pending' and document is null and reviewed_by is null and reviewed_at is null) or (status='approved' and document is not null and reviewed_by is not null and reviewed_at is not null))
);
create index lab_country_profile_latest_idx on public.lab_country_profiles(lab_id,market_country_code,revision desc);
create function public.protect_lab_country_profile() returns trigger language plpgsql set search_path='' as $$begin raise exception 'LAB_COUNTRY_PROFILE_IMMUTABLE' using errcode='42501';end $$;
create trigger lab_country_profile_immutable before update or delete on public.lab_country_profiles for each row execute function public.protect_lab_country_profile();
alter table public.lab_country_profiles enable row level security;
alter table public.lab_country_profiles force row level security;
revoke all on public.lab_country_profiles from public,anon,authenticated,service_role;
grant select on public.lab_country_profiles to service_role;
-- Only current revisions are read into a workspace. Pending supersedes approval.
create view public.lab_country_profile_latest as select distinct on(lab_id,market_country_code) lab_id,market_country_code,revision,status,document,reviewed_by,reviewed_at from public.lab_country_profiles order by lab_id,market_country_code,revision desc;
revoke all on public.lab_country_profile_latest from public,anon,authenticated,service_role;
grant select on public.lab_country_profile_latest to service_role;
create function public.put_lab_country_profile(p_actor_user_id uuid,p_lab_id uuid,p_market_country_code text,p_revision integer,p_status text,p_document jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.lab_country_profiles;last_revision integer;
begin
 if p_actor_user_id is null or not exists(select 1 from public.photographers p where p.user_id=p_actor_user_id and p.is_platform_admin) then raise exception 'LAB_COUNTRY_PROFILE_FORBIDDEN' using errcode='42501';end if;
 if p_lab_id is null or not exists(select 1 from public.studio_labs l where l.id=p_lab_id) or p_market_country_code is null or p_market_country_code!~'^[A-Z]{2}$' or p_revision is null or p_revision not between 1 and 1000000000 or p_status is null or p_status not in('pending','approved') then raise exception 'LAB_COUNTRY_PROFILE_INVALID' using errcode='22023';end if;
 if p_status='pending' and p_document is not null then raise exception 'LAB_COUNTRY_PROFILE_INVALID' using errcode='22023';end if;
 if p_status='approved' then
  if p_document is null or jsonb_typeof(p_document)<>'object' or octet_length(p_document::text)>64000 then raise exception 'LAB_COUNTRY_PROFILE_INVALID' using errcode='22023';end if;
  if p_document->'version' is distinct from '1'::jsonb or p_document->>'labId' is distinct from p_lab_id::text or p_document->>'marketCountryCode' is distinct from p_market_country_code or p_document->'revision' is distinct from to_jsonb(p_revision) then raise exception 'LAB_COUNTRY_PROFILE_INVALID' using errcode='22023';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('lab-country-profile:'||p_lab_id::text||':'||p_market_country_code,20261016));
 select * into previous from public.lab_country_profiles where lab_id=p_lab_id and market_country_code=p_market_country_code and revision=p_revision;
 if found then
  if previous.status is distinct from p_status or previous.document is distinct from p_document or previous.created_by<>p_actor_user_id then raise exception 'LAB_COUNTRY_PROFILE_REQUEST_CONFLICT' using errcode='23505';end if;
  return jsonb_build_object('labId',p_lab_id,'marketCountryCode',p_market_country_code,'revision',p_revision,'replayed',true);
 end if;
 select coalesce(max(revision),0) into last_revision from public.lab_country_profiles where lab_id=p_lab_id and market_country_code=p_market_country_code;
 if p_revision<>last_revision+1 then raise exception 'LAB_COUNTRY_PROFILE_VERSION_CONFLICT' using errcode='40001';end if;
 insert into public.lab_country_profiles(lab_id,market_country_code,revision,status,document,created_by,reviewed_by,reviewed_at) values(p_lab_id,p_market_country_code,p_revision,p_status,p_document,p_actor_user_id,case when p_status='approved' then p_actor_user_id end,case when p_status='approved' then now() end);
 return jsonb_build_object('labId',p_lab_id,'marketCountryCode',p_market_country_code,'revision',p_revision,'replayed',false);
end $$;
revoke all on function public.put_lab_country_profile(uuid,uuid,text,integer,text,jsonb),public.protect_lab_country_profile() from public,anon,authenticated,service_role;
grant execute on function public.put_lab_country_profile(uuid,uuid,text,integer,text,jsonb) to service_role;
-- New country-aware drafts serialize against profile replacement. Legacy
-- creates/saves/duplicates continue using the existing RPC without rewrites.
create function public.create_country_lab_price_sheet(p_user_id uuid,p_id uuid,p_document jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;lab public.studio_labs;current_profile public.lab_country_profiles;product public.studio_lab_catalog;entry jsonb;allowed_ids text[];expected_ids text[];country text;revision integer;
begin
 if p_user_id is null or not exists(select 1 from public.photographers p where p.user_id=p_user_id) then raise exception 'LAB_COUNTRY_PROFILE_FORBIDDEN' using errcode='42501';end if;
 if p_document is null or jsonb_typeof(p_document)<>'object' then raise exception 'LAB_COUNTRY_PROFILE_INVALID' using errcode='22023';end if;
 context:=p_document->'marketContext';
 if context is null or jsonb_typeof(context)<>'object' then raise exception 'LAB_COUNTRY_PROFILE_INVALID' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(context))<>4 or exists(select 1 from jsonb_object_keys(context) k where k not in('marketCountryCode','profileRevision','referenceOnly','catalogProductIds')) or jsonb_typeof(context->'referenceOnly') is distinct from 'boolean' or coalesce(context->>'marketCountryCode','')!~'^[A-Z]{2}$' or jsonb_typeof(context->'catalogProductIds') is distinct from 'array' then raise exception 'LAB_COUNTRY_PROFILE_INVALID' using errcode='22023';end if;
 if jsonb_array_length(context->'catalogProductIds') not between 1 and 500 then raise exception 'LAB_COUNTRY_PROFILE_INVALID' using errcode='22023';end if;
 select array_agg(value order by value) into allowed_ids from jsonb_array_elements_text(context->'catalogProductIds');
 if (select count(distinct value) from unnest(allowed_ids)value)<>cardinality(allowed_ids) then raise exception 'LAB_COUNTRY_PROFILE_INVALID' using errcode='22023';end if;
 country:=context->>'marketCountryCode';
 perform pg_advisory_xact_lock(hashtextextended('lab-country-profile:'||(p_document->>'labId')::uuid::text||':'||country,20261016));
 select * into lab from public.studio_labs where id=(p_document->>'labId')::uuid for share;
 if not found or lab.currency is distinct from p_document->>'currency' then raise exception 'LAB_COUNTRY_PROFILE_INVALID' using errcode='22023';end if;
 if context->'referenceOnly'='true'::jsonb then
  if context->'profileRevision' is distinct from 'null'::jsonb or country<>lab.country_code then raise exception 'LAB_COUNTRY_PROFILE_PENDING' using errcode='40001';end if;
  perform 1 from public.studio_lab_catalog c where c.lab_id=lab.id and c.active and c.currency=lab.currency for share;
  select array_agg(c.id::text order by c.id::text) into expected_ids from public.studio_lab_catalog c where c.lab_id=lab.id and c.active and c.currency=lab.currency;
 else
  if jsonb_typeof(context->'profileRevision') is distinct from 'number' or coalesce(context->>'profileRevision','')!~'^[0-9]{1,10}$' then raise exception 'LAB_COUNTRY_PROFILE_INVALID' using errcode='22023';end if;
  if (context->>'profileRevision')::numeric not between 1 and 1000000000 then raise exception 'LAB_COUNTRY_PROFILE_INVALID' using errcode='22023';end if;
  revision:=(context->>'profileRevision')::integer;
  select * into current_profile from public.lab_country_profiles r where r.lab_id=lab.id and r.market_country_code=country order by r.revision desc limit 1 for share;
  if not found or current_profile.status<>'approved' or current_profile.revision<>revision or lab.status='paused' or not lab.catalog_verified then raise exception 'LAB_COUNTRY_PROFILE_PENDING' using errcode='40001';end if;
  if current_profile.document->>'labId' is distinct from lab.id::text or current_profile.document->>'marketCountryCode' is distinct from country or current_profile.document->'revision' is distinct from to_jsonb(revision) or current_profile.document->>'currency' is distinct from lab.currency or current_profile.document#>>'{location,countryCode}' is distinct from lab.country_code::text or current_profile.document#>>'{location,city}' is distinct from lab.city or current_profile.document#>>'{transport,kind}' is distinct from 'manual_download' or current_profile.document#>>'{transport,state}' is distinct from 'configured' or jsonb_typeof(current_profile.document->'products') is distinct from 'array' then raise exception 'LAB_COUNTRY_PROFILE_PENDING' using errcode='40001';end if;
  expected_ids:='{}';
  for entry in select value from jsonb_array_elements(current_profile.document->'products') loop
   select * into product from public.studio_lab_catalog c where c.id=(entry->>'productId')::uuid and c.lab_id=lab.id for share;
   if not found or not product.active or not product.verified or product.cost_source<>'lab_confirmed' or product.cost_cents is null or product.prints_per_unit is distinct from 1 or product.currency<>lab.currency or product.sku is distinct from entry->>'sku' or coalesce(entry#>>'{finishedSize,unit}','') not in('in','mm') or jsonb_typeof(entry#>'{finishedSize,width}') is distinct from 'number' or jsonb_typeof(entry#>'{finishedSize,height}') is distinct from 'number' then raise exception 'LAB_COUNTRY_PROFILE_PENDING' using errcode='40001';end if;
   if product.width_inches*(case when entry#>>'{finishedSize,unit}'='mm' then 25.4 else 1 end) is distinct from (entry#>>'{finishedSize,width}')::numeric or product.height_inches*(case when entry#>>'{finishedSize,unit}'='mm' then 25.4 else 1 end) is distinct from (entry#>>'{finishedSize,height}')::numeric then raise exception 'LAB_COUNTRY_PROFILE_PENDING' using errcode='40001';end if;
   expected_ids:=array_append(expected_ids,product.id::text);
  end loop;
  select array_agg(value order by value) into expected_ids from unnest(expected_ids)value;
 end if;
 if allowed_ids is distinct from expected_ids then raise exception 'LAB_COUNTRY_PROFILE_PENDING' using errcode='40001';end if;
 if exists(select 1 from jsonb_array_elements(p_document->'items') i where not((i->>'catalogProductId')=any(allowed_ids))) or exists(select 1 from jsonb_array_elements(p_document->'packages') p cross join lateral jsonb_array_elements(p->'items') i where not((i->>'catalogProductId')=any(allowed_ids))) then raise exception 'LAB_CATALOG_SCOPE' using errcode='42501';end if;
 return public.save_lab_price_sheet(p_user_id,p_id,0,p_document,'create');
end $$;
revoke all on function public.create_country_lab_price_sheet(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_country_lab_price_sheet(uuid,uuid,jsonb) to service_role;
commit;
