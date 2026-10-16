-- Final sheet-layout and country-profile business conflicts must not trigger
-- PostgREST 14's automatic SQLSTATE 40001 retry loop. PT409 preserves HTTP 409
-- and every prior exception message, ownership check, lock and snapshot rule.
-- CREATE OR REPLACE keeps existing function privileges. No stored row, schema,
-- approval, intake flag or applied migration is rewritten by this patch.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';

create or replace function public.save_lab_sheet_layout_draft(p_user_id uuid,p_audience text,p_draft_id uuid,p_request_id uuid,p_expected_version integer,p_job_id uuid,p_name text,p_document jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.lab_sheet_layout_drafts;owner_id uuid;payload jsonb;
begin
 if p_user_id is null or p_draft_id is null or p_request_id is null or p_expected_version is null or p_expected_version not between 0 and 99999 or p_audience is null or p_audience not in('studio','lab') or p_name is null or length(btrim(p_name)) not between 1 and 100 then raise exception 'SHEET_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,8060));
 if p_job_id is null then select id into owner_id from public.photographers where user_id=p_user_id;else select photographer_id into owner_id from public.lab_production_v2_jobs where id=p_job_id;end if;
 if owner_id is null or not public.lab_sheet_layout_access(p_user_id,p_audience,owner_id,p_job_id) then raise exception 'SHEET_FORBIDDEN' using errcode='42501';end if;
 perform public.lab_sheet_layout_validate_sources(p_user_id,p_audience,owner_id,p_job_id,p_document,false);
 payload:=jsonb_build_object('expectedVersion',p_expected_version,'jobId',p_job_id,'name',btrim(p_name),'document',p_document,'audience',p_audience);
 select * into d from public.lab_sheet_layout_drafts where id=p_draft_id for update;
 if found then
  if d.created_by<>p_user_id or d.audience<>p_audience or d.photographer_id<>owner_id or d.job_id is distinct from p_job_id then raise exception 'SHEET_FORBIDDEN' using errcode='42501';end if;
  if d.last_request_id=p_request_id then if d.last_request_payload<>payload then raise exception 'SHEET_REQUEST_CONFLICT' using errcode='23505';end if;return jsonb_build_object('id',d.id,'replayed',true);end if;
  if d.version<>p_expected_version then raise exception 'SHEET_VERSION_CONFLICT' using errcode='PT409';end if;
  update public.lab_sheet_layout_drafts set name=btrim(p_name),document=p_document,version=version+1,last_request_id=p_request_id,last_request_payload=payload,current_export_id=null,updated_at=now() where id=d.id;
 else
  if p_expected_version<>0 then raise exception 'SHEET_VERSION_CONFLICT' using errcode='PT409';end if;
  if (select count(*) from public.lab_sheet_layout_drafts where created_by=p_user_id)>=60 then raise exception 'SHEET_INVALID_LIMIT' using errcode='22023';end if;
  insert into public.lab_sheet_layout_drafts(id,created_by,photographer_id,audience,job_id,name,document,last_request_id,last_request_payload)values(p_draft_id,p_user_id,owner_id,p_audience,p_job_id,btrim(p_name),p_document,p_request_id,payload);
 end if;
 return jsonb_build_object('id',p_draft_id,'replayed',false);
end $$;

create or replace function public.register_lab_sheet_layout_export(p_user_id uuid,p_audience text,p_draft_id uuid,p_request_id uuid,p_expected_version integer,p_export jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.lab_sheet_layout_drafts;e public.lab_sheet_layout_exports;g jsonb;ci jsonb;m jsonb;a public.lab_production_assets;ix integer:=0;
begin
 if p_user_id is null or p_audience is null or p_request_id is null or p_expected_version is null or p_export is null or jsonb_typeof(p_export)<>'object' then raise exception 'SHEET_INVALID_EXPORT' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_export))<>9 or exists(select 1 from jsonb_object_keys(p_export) key where key not in('id','filename','storageKey','sha256','byteSize','widthPixels','heightPixels','document','manifest')) then raise exception 'SHEET_INVALID_EXPORT' using errcode='22023';end if;
 select * into d from public.lab_sheet_layout_drafts where id=p_draft_id for update;
 if not found or d.created_by<>p_user_id or d.audience<>p_audience or not public.lab_sheet_layout_access(p_user_id,p_audience,d.photographer_id,d.job_id) then raise exception 'SHEET_FORBIDDEN' using errcode='42501';end if;
 if d.version<>p_expected_version or d.document is distinct from p_export->'document' then raise exception 'SHEET_VERSION_CONFLICT' using errcode='PT409';end if;
 perform public.lab_sheet_layout_validate_sources(p_user_id,p_audience,d.photographer_id,d.job_id,d.document,true);
 select * into e from public.lab_sheet_layout_exports where draft_id=d.id and request_id=p_request_id;
 if found then
  if e.id::text is distinct from p_export->>'id' or e.sha256 is distinct from p_export->>'sha256' or e.storage_key is distinct from p_export->>'storageKey' or e.filename is distinct from p_export->>'filename' or e.byte_size::text is distinct from p_export->>'byteSize' or e.width_pixels::text is distinct from p_export->>'widthPixels' or e.height_pixels::text is distinct from p_export->>'heightPixels' or e.manifest is distinct from p_export->'manifest' then raise exception 'SHEET_REQUEST_CONFLICT' using errcode='23505';end if;
  if d.current_export_id is distinct from e.id then raise exception 'SHEET_VERSION_CONFLICT' using errcode='PT409';end if;return jsonb_build_object('id',e.id,'replayed',true);
 end if;
 if (select count(*) from public.lab_sheet_layout_exports where draft_id=d.id)>=20 then raise exception 'SHEET_INVALID_LIMIT' using errcode='22023';end if;
 if jsonb_typeof(p_export->'id')<>'string' or coalesce(p_export->>'id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or jsonb_typeof(p_export->'sha256')<>'string' or coalesce(p_export->>'sha256','')!~'^[a-f0-9]{64}$' or jsonb_typeof(p_export->'filename')<>'string' or p_export->>'filename' is distinct from 'TEST-sheet-'||d.id::text||'-v'||d.version::text||'.jpg' or p_export->>'storageKey' is distinct from p_user_id::text||'/'||(p_export->>'id')||'.jpg' then raise exception 'SHEET_INVALID_EXPORT' using errcode='22023';end if;
 if jsonb_typeof(p_export->'byteSize')<>'number' or coalesce(p_export->>'byteSize','')!~'^[0-9]+$' or jsonb_typeof(p_export->'widthPixels')<>'number' or coalesce(p_export->>'widthPixels','')!~'^[0-9]+$' or jsonb_typeof(p_export->'heightPixels')<>'number' or coalesce(p_export->>'heightPixels','')!~'^[0-9]+$' then raise exception 'SHEET_INVALID_EXPORT' using errcode='22023';end if;
 g:=public.lab_sheet_layout_geometry(d.document);m:=p_export->'manifest';
 if jsonb_typeof(m)<>'object' then raise exception 'SHEET_INVALID_EXPORT' using errcode='22023';end if;
 if (p_export->>'byteSize')::numeric not between 1 and 4000000 or (p_export->>'widthPixels')::numeric<>(g->>'widthPixels')::numeric or (p_export->>'heightPixels')::numeric<>(g->>'heightPixels')::numeric or (select count(*) from jsonb_object_keys(m))<>12 or exists(select 1 from jsonb_object_keys(m) key where key not in('version','testOnly','printAllowed','draftId','draftVersion','paper','templateId','copies','dpi','cells','file','notice')) then raise exception 'SHEET_INVALID_EXPORT' using errcode='22023';end if;
 if jsonb_typeof(m->'cells') is distinct from 'array' then raise exception 'SHEET_INVALID_EXPORT' using errcode='22023';end if;
 if m->'version' is distinct from '1'::jsonb or m->'testOnly' is distinct from 'true'::jsonb or m->'printAllowed' is distinct from 'false'::jsonb or m->>'draftId' is distinct from d.id::text or m->'draftVersion' is distinct from to_jsonb(d.version) or m->'paper' is distinct from jsonb_build_object('id',d.document->>'paperId','orientation',d.document->'orientation','widthInches',g->'widthInches','heightInches',g->'heightInches','widthPixels',g->'widthPixels','heightPixels',g->'heightPixels') or m->>'templateId' is distinct from d.document->>'templateId' or m->'copies' is distinct from d.document->'copies' or m->'dpi' is distinct from '300'::jsonb or m->>'notice' is distinct from 'TEST sheet only. No order, payment, printer or dispatch was changed.' or m->'file' is distinct from jsonb_build_object('filename',p_export->>'filename','sha256',p_export->>'sha256','byteSize',p_export->'byteSize','contentType','image/jpeg') or jsonb_array_length(m->'cells')<>jsonb_array_length(d.document->'cells') then raise exception 'SHEET_INVALID_EXPORT' using errcode='22023';end if;
 for ci in select value from jsonb_array_elements(g->'cells') loop
  select * into a from public.lab_production_assets where id=(select (value->>'assetId')::uuid from jsonb_array_elements(d.document->'cells') where value->>'id'=ci->>'id');
  if (m->'cells'->ix) is distinct from ci||jsonb_build_object('assetId',a.id,'sourceSha256',a.sha256,'crop',(select value->'crop' from jsonb_array_elements(d.document->'cells') where value->>'id'=ci->>'id')) then raise exception 'SHEET_INVALID_EXPORT' using errcode='22023';end if;ix:=ix+1;
 end loop;
 insert into public.lab_sheet_layout_exports(id,draft_id,draft_version,request_id,document,storage_key,filename,sha256,byte_size,width_pixels,height_pixels,manifest)values((p_export->>'id')::uuid,d.id,d.version,p_request_id,d.document,p_export->>'storageKey',p_export->>'filename',p_export->>'sha256',(p_export->>'byteSize')::integer,(p_export->>'widthPixels')::integer,(p_export->>'heightPixels')::integer,m);
 update public.lab_sheet_layout_drafts set current_export_id=(p_export->>'id')::uuid where id=d.id;
 return jsonb_build_object('id',p_export->>'id','replayed',false);
end $$;

create or replace function public.review_lab_sheet_layout_export(p_user_id uuid,p_audience text,p_draft_id uuid,p_render_id uuid,p_expected_version integer,p_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.lab_sheet_layout_drafts;e public.lab_sheet_layout_exports;replayed boolean;
begin
 select * into d from public.lab_sheet_layout_drafts where id=p_draft_id for update;
 if not found or p_user_id is null or p_audience is null or d.created_by<>p_user_id or d.audience<>p_audience or not public.lab_sheet_layout_access(p_user_id,p_audience,d.photographer_id,d.job_id) then raise exception 'SHEET_FORBIDDEN' using errcode='42501';end if;
 if p_expected_version is distinct from d.version or p_render_id is distinct from d.current_export_id then raise exception 'SHEET_VERSION_CONFLICT' using errcode='PT409';end if;
 select * into e from public.lab_sheet_layout_exports where id=p_render_id and draft_id=d.id for update;
 if not found or p_sha256 is distinct from e.sha256 or e.draft_version<>d.version then raise exception 'SHEET_VERSION_CONFLICT' using errcode='PT409';end if;
 perform public.lab_sheet_layout_validate_sources(p_user_id,p_audience,d.photographer_id,d.job_id,d.document,true);
 replayed:=e.reviewed_at is not null;
 if not replayed then update public.lab_sheet_layout_exports set reviewed_at=now(),reviewed_by=p_user_id where id=e.id;end if;
 return jsonb_build_object('id',e.id,'replayed',replayed);
end $$;

create or replace function public.put_lab_country_profile(p_actor_user_id uuid,p_lab_id uuid,p_market_country_code text,p_revision integer,p_status text,p_document jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if p_revision<>last_revision+1 then raise exception 'LAB_COUNTRY_PROFILE_VERSION_CONFLICT' using errcode='PT409';end if;
 insert into public.lab_country_profiles(lab_id,market_country_code,revision,status,document,created_by,reviewed_by,reviewed_at) values(p_lab_id,p_market_country_code,p_revision,p_status,p_document,p_actor_user_id,case when p_status='approved' then p_actor_user_id end,case when p_status='approved' then now() end);
 return jsonb_build_object('labId',p_lab_id,'marketCountryCode',p_market_country_code,'revision',p_revision,'replayed',false);
end $$;

create or replace function public.create_country_lab_price_sheet(p_user_id uuid,p_id uuid,p_document jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if context->'profileRevision' is distinct from 'null'::jsonb or country<>lab.country_code then raise exception 'LAB_COUNTRY_PROFILE_PENDING' using errcode='PT409';end if;
  perform 1 from public.studio_lab_catalog c where c.lab_id=lab.id and c.active and c.currency=lab.currency for share;
  select array_agg(c.id::text order by c.id::text) into expected_ids from public.studio_lab_catalog c where c.lab_id=lab.id and c.active and c.currency=lab.currency;
 else
  if jsonb_typeof(context->'profileRevision') is distinct from 'number' or coalesce(context->>'profileRevision','')!~'^[0-9]{1,10}$' then raise exception 'LAB_COUNTRY_PROFILE_INVALID' using errcode='22023';end if;
  if (context->>'profileRevision')::numeric not between 1 and 1000000000 then raise exception 'LAB_COUNTRY_PROFILE_INVALID' using errcode='22023';end if;
  revision:=(context->>'profileRevision')::integer;
  select * into current_profile from public.lab_country_profiles r where r.lab_id=lab.id and r.market_country_code=country order by r.revision desc limit 1 for share;
  if not found or current_profile.status<>'approved' or current_profile.revision<>revision or lab.status='paused' or not lab.catalog_verified then raise exception 'LAB_COUNTRY_PROFILE_PENDING' using errcode='PT409';end if;
  if current_profile.document->>'labId' is distinct from lab.id::text or current_profile.document->>'marketCountryCode' is distinct from country or current_profile.document->'revision' is distinct from to_jsonb(revision) or current_profile.document->>'currency' is distinct from lab.currency or current_profile.document#>>'{location,countryCode}' is distinct from lab.country_code::text or current_profile.document#>>'{location,city}' is distinct from lab.city or current_profile.document#>>'{transport,kind}' is distinct from 'manual_download' or current_profile.document#>>'{transport,state}' is distinct from 'configured' or jsonb_typeof(current_profile.document->'products') is distinct from 'array' then raise exception 'LAB_COUNTRY_PROFILE_PENDING' using errcode='PT409';end if;
  expected_ids:='{}';
  for entry in select value from jsonb_array_elements(current_profile.document->'products') loop
   select * into product from public.studio_lab_catalog c where c.id=(entry->>'productId')::uuid and c.lab_id=lab.id for share;
   if not found or not product.active or not product.verified or product.cost_source<>'lab_confirmed' or product.cost_cents is null or product.prints_per_unit is distinct from 1 or product.currency<>lab.currency or product.sku is distinct from entry->>'sku' or coalesce(entry#>>'{finishedSize,unit}','') not in('in','mm') or jsonb_typeof(entry#>'{finishedSize,width}') is distinct from 'number' or jsonb_typeof(entry#>'{finishedSize,height}') is distinct from 'number' then raise exception 'LAB_COUNTRY_PROFILE_PENDING' using errcode='PT409';end if;
   if product.width_inches*(case when entry#>>'{finishedSize,unit}'='mm' then 25.4 else 1 end) is distinct from (entry#>>'{finishedSize,width}')::numeric or product.height_inches*(case when entry#>>'{finishedSize,unit}'='mm' then 25.4 else 1 end) is distinct from (entry#>>'{finishedSize,height}')::numeric then raise exception 'LAB_COUNTRY_PROFILE_PENDING' using errcode='PT409';end if;
   expected_ids:=array_append(expected_ids,product.id::text);
  end loop;
  select array_agg(value order by value) into expected_ids from unnest(expected_ids)value;
 end if;
 if allowed_ids is distinct from expected_ids then raise exception 'LAB_COUNTRY_PROFILE_PENDING' using errcode='PT409';end if;
 if exists(select 1 from jsonb_array_elements(p_document->'items') i where not((i->>'catalogProductId')=any(allowed_ids))) or exists(select 1 from jsonb_array_elements(p_document->'packages') p cross join lateral jsonb_array_elements(p->'items') i where not((i->>'catalogProductId')=any(allowed_ids))) then raise exception 'LAB_CATALOG_SCOPE' using errcode='42501';end if;
 return public.save_lab_price_sheet(p_user_id,p_id,0,p_document,'create');
end $$;

commit;
