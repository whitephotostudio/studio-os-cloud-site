-- An expected-version mismatch is a final business conflict, not a transient
-- serialization failure. PostgREST 14 retries custom SQLSTATE 40001 indefinitely;
-- PT409 returns HTTP 409 promptly. Keep every ownership check, lock, immutable
-- catalog snapshot and durable retry rule unchanged. CREATE OR REPLACE preserves
-- existing service-only function privileges. No stored row or applied migration changes.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';

create or replace function public.save_lab_setup_draft(p_user_id uuid,p_lab_id uuid,p_expected_version integer,p_request_id uuid,p_action text,p_document jsonb,p_catalog_document jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_row public.lab_setup_drafts;prior public.lab_setup_revisions;cat public.lab_setup_catalogs;new_catalog_id uuid;payload_hash text;preview jsonb;entry jsonb;next_status text;submitted timestamptz;new_version integer;
begin
 if p_user_id is null or p_lab_id is null then raise exception 'LAB_SETUP_FORBIDDEN' using errcode='42501';end if;
 perform 1 from public.lab_memberships where user_id=p_user_id and lab_id=p_lab_id and active and role='owner' for share;
 if not found then raise exception 'LAB_SETUP_FORBIDDEN' using errcode='42501';end if;
 if p_expected_version is null or p_expected_version not between 0 and 999999999 or p_request_id is null or p_action is null or p_action not in('save','stage_catalog','clear_catalog','submit') then raise exception 'LAB_SETUP_INVALID' using errcode='22023';end if;
 if (p_action='submit' and p_document is not null) or (p_action<>'submit' and not public.lab_setup_document_valid(p_document)) or (p_action<>'stage_catalog' and p_catalog_document is not null) then raise exception 'LAB_SETUP_INVALID' using errcode='22023';end if;
 if p_action='stage_catalog' then
  if p_catalog_document is null or jsonb_typeof(p_catalog_document)<>'object' or (select count(*) from jsonb_object_keys(p_catalog_document))<>7 or exists(select 1 from jsonb_object_keys(p_catalog_document)key where key not in('id','sourceName','contentHash','currency','csv','mapping','preview')) or jsonb_typeof(p_catalog_document->'csv') is distinct from 'string' or octet_length(p_catalog_document->>'csv') not between 1 and 2000000 or jsonb_typeof(p_catalog_document->'sourceName') is distinct from 'string' or length(p_catalog_document->>'sourceName') not between 1 and 150 or p_catalog_document->>'sourceName'<>btrim(p_catalog_document->>'sourceName') or p_catalog_document->>'sourceName' ~ '[[:cntrl:]]' or jsonb_typeof(p_catalog_document->'contentHash') is distinct from 'string' or p_catalog_document->>'contentHash' is distinct from encode(sha256(convert_to(p_catalog_document->>'csv','UTF8')),'hex') or p_catalog_document->>'currency' is distinct from p_document->>'currency' or p_document->>'currency' is null or jsonb_typeof(p_catalog_document->'mapping') is distinct from 'object' then raise exception 'LAB_SETUP_INVALID_CATALOG' using errcode='22023';end if;
  new_catalog_id:=(p_catalog_document->>'id')::uuid;preview:=p_catalog_document->'preview';
  if new_catalog_id is null or preview is null or jsonb_typeof(preview)<>'object' or octet_length(preview::text)>4000000 or (select count(*) from jsonb_object_keys(preview))<>5 or exists(select 1 from jsonb_object_keys(preview)key where key not in('headers','mapping','rows','issues','sourceRowCount')) or jsonb_typeof(preview->'headers') is distinct from 'array' or jsonb_typeof(preview->'rows') is distinct from 'array' or jsonb_typeof(preview->'issues') is distinct from 'array' or preview->'mapping' is distinct from p_catalog_document->'mapping' or jsonb_typeof(preview->'sourceRowCount') is distinct from 'number' then raise exception 'LAB_SETUP_INVALID_CATALOG' using errcode='22023';end if;
  if jsonb_array_length(preview->'headers') not between 1 and 51 or jsonb_array_length(preview->'rows')>2000 or jsonb_array_length(preview->'issues')>24000 or (preview->>'sourceRowCount')::numeric not between 1 and 2000 or trunc((preview->>'sourceRowCount')::numeric)<>(preview->>'sourceRowCount')::numeric or jsonb_array_length(preview->'rows')>(preview->>'sourceRowCount')::numeric then raise exception 'LAB_SETUP_INVALID_CATALOG' using errcode='22023';end if;
  if exists(select 1 from jsonb_each(p_catalog_document->'mapping') x where x.key not in('sku','name','category','size','width','height','finish','cost','currency','popular','printsPerUnit') or jsonb_typeof(x.value)<>'number') or exists(select 1 from jsonb_array_elements(preview->'headers') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 5000) then raise exception 'LAB_SETUP_INVALID_CATALOG' using errcode='22023';end if;
  if exists(select 1 from jsonb_each(p_catalog_document->'mapping') x where (x.value::text)::numeric not between 0 and 49 or trunc((x.value::text)::numeric)<>(x.value::text)::numeric) or (jsonb_array_length(preview->'issues')=0 and jsonb_array_length(preview->'rows')<>(preview->>'sourceRowCount')::numeric) then raise exception 'LAB_SETUP_INVALID_CATALOG' using errcode='22023';end if;
  for entry in select value from jsonb_array_elements(preview->'rows') loop
   if jsonb_typeof(entry)<>'object' or (select count(*) from jsonb_object_keys(entry))<>11 or exists(select 1 from jsonb_object_keys(entry)key where key not in('sku','name','category','size','finish','costCents','currency','widthInches','heightInches','popular','printsPerUnit')) or jsonb_typeof(entry->'sku') is distinct from 'string' or length(entry->>'sku') not between 1 and 100 or jsonb_typeof(entry->'name') is distinct from 'string' or length(entry->>'name') not between 1 and 200 or jsonb_typeof(entry->'category') is distinct from 'string' or entry->>'category' not in('prints','fine_art','canvas','metal') or jsonb_typeof(entry->'size') is distinct from 'string' or length(entry->>'size') not between 1 and 100 or jsonb_typeof(entry->'finish') is distinct from 'string' or length(entry->>'finish')>100 or entry->>'sku'<>btrim(entry->>'sku') or entry->>'sku' ~ '[[:cntrl:]]' or entry->>'name' ~ '[[:cntrl:]]' or entry->>'finish' ~ '[[:cntrl:]]' or jsonb_typeof(entry->'costCents') is distinct from 'number' or jsonb_typeof(entry->'widthInches') is distinct from 'number' or jsonb_typeof(entry->'heightInches') is distinct from 'number' or entry->>'currency' is distinct from p_document->>'currency' or jsonb_typeof(entry->'popular') is distinct from 'boolean' or jsonb_typeof(entry->'printsPerUnit') not in('number','null') then raise exception 'LAB_SETUP_INVALID_CATALOG' using errcode='22023';end if;
   if (entry->>'costCents')::numeric not between 0 and 100000000 or trunc((entry->>'costCents')::numeric)<>(entry->>'costCents')::numeric or (entry->>'widthInches')::numeric<=0 or (entry->>'widthInches')::numeric>120 or (entry->>'heightInches')::numeric<=0 or (entry->>'heightInches')::numeric>120 or (entry->>'printsPerUnit' is not null and ((entry->>'printsPerUnit')::numeric not between 1 and 100 or trunc((entry->>'printsPerUnit')::numeric)<>(entry->>'printsPerUnit')::numeric)) then raise exception 'LAB_SETUP_INVALID_CATALOG' using errcode='22023';end if;
  end loop;
  if (select count(*) from jsonb_array_elements(preview->'rows'))<>(select count(distinct lower(x->>'sku')) from jsonb_array_elements(preview->'rows')x) then raise exception 'LAB_SETUP_INVALID_CATALOG' using errcode='22023';end if;
 end if;
 payload_hash:=encode(sha256(convert_to(jsonb_build_object('labId',p_lab_id,'expectedVersion',p_expected_version,'action',p_action,'document',p_document,'catalog',p_catalog_document)::text,'UTF8')),'hex');
 -- Serialize both first creation and subsequent CAS, including retries, per lab.
 perform pg_advisory_xact_lock(hashtextextended('lab-setup:'||p_lab_id::text,20261016));
 select * into prior from public.lab_setup_revisions where actor_user_id=p_user_id and request_id=p_request_id;
 if found then
  if prior.lab_id<>p_lab_id or prior.request_hash<>payload_hash then raise exception 'LAB_SETUP_REQUEST_CONFLICT' using errcode='23505';end if;
  select * into current_row from public.lab_setup_drafts where lab_id=p_lab_id;
  return to_jsonb(current_row)||jsonb_build_object('replayed',true);
 end if;
 select * into current_row from public.lab_setup_drafts where lab_id=p_lab_id for update;
 if coalesce(current_row.version,0)<>p_expected_version then raise exception 'LAB_SETUP_VERSION_CONFLICT' using errcode='PT409';end if;
 if (select count(*) from public.lab_setup_revisions where lab_id=p_lab_id)>=1000 then raise exception 'LAB_SETUP_LIMIT' using errcode='22023';end if;
 if p_action='submit' then
  select * into cat from public.lab_setup_catalogs where id=current_row.catalog_id and lab_id=p_lab_id;
  if not found or not public.lab_setup_ready(current_row.document,cat.preview,cat.currency) then raise exception 'LAB_SETUP_NOT_READY' using errcode='22023';end if;
  p_document:=current_row.document;new_catalog_id:=current_row.catalog_id;next_status:='submitted';submitted:=now();
 else
  next_status:='draft';submitted:=null;
  if p_action='save' then new_catalog_id:=current_row.catalog_id;end if;
  if p_action='stage_catalog' then
   if (select count(*) from public.lab_setup_catalogs where lab_id=p_lab_id)>=30 then raise exception 'LAB_SETUP_LIMIT' using errcode='22023';end if;
   insert into public.lab_setup_catalogs(id,lab_id,actor_user_id,request_id,source_name,content_hash,currency,source_csv,mapping,preview) values(new_catalog_id,p_lab_id,p_user_id,p_request_id,p_catalog_document->>'sourceName',p_catalog_document->>'contentHash',p_catalog_document->>'currency',p_catalog_document->>'csv',p_catalog_document->'mapping',preview);
  end if;
 end if;
 new_version:=coalesce(current_row.version,0)+1;
 insert into public.lab_setup_drafts(lab_id,version,status,document,catalog_id,updated_by,updated_at,submitted_at) values(p_lab_id,new_version,next_status,p_document,new_catalog_id,p_user_id,now(),submitted) on conflict(lab_id) do update set version=excluded.version,status=excluded.status,document=excluded.document,catalog_id=excluded.catalog_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at,submitted_at=excluded.submitted_at returning * into current_row;
 insert into public.lab_setup_revisions(lab_id,version,actor_user_id,request_id,request_hash,action,document,catalog_id,status,submitted_at) values(p_lab_id,new_version,p_user_id,p_request_id,payload_hash,p_action,p_document,new_catalog_id,next_status,submitted);
 return to_jsonb(current_row)||jsonb_build_object('replayed',false);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'LAB_SETUP_INVALID' using errcode='22023';
end$$;

commit;
