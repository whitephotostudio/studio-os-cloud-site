-- Private, staged owner proposals only. No existing catalog, price or intake row is changed.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';

create table public.lab_setup_catalogs (
 id uuid primary key,lab_id uuid not null references public.studio_labs(id),actor_user_id uuid not null references auth.users(id),request_id uuid not null,
 source_name text not null check(length(source_name) between 1 and 150),content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),currency char(3) not null check(currency ~ '^[A-Z]{3}$'),
 source_csv text not null check(octet_length(source_csv) between 1 and 2000000),mapping jsonb not null,preview jsonb not null check(octet_length(preview::text)<=4000000),
 created_at timestamptz not null default now(),unique(lab_id,actor_user_id,request_id)
);
create table public.lab_setup_drafts (
 lab_id uuid primary key references public.studio_labs(id),version integer not null check(version between 1 and 1000000000),
 status text not null check(status in('draft','submitted')),document jsonb not null check(octet_length(document::text)<=200000),
 catalog_id uuid references public.lab_setup_catalogs(id),updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),submitted_at timestamptz,
 check((status='draft' and submitted_at is null) or (status='submitted' and submitted_at is not null))
);
create table public.lab_setup_revisions (
 lab_id uuid not null references public.studio_labs(id),version integer not null,actor_user_id uuid not null references auth.users(id),request_id uuid not null,
 request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),action text not null check(action in('save','stage_catalog','clear_catalog','submit')),
 document jsonb not null,catalog_id uuid references public.lab_setup_catalogs(id),status text not null check(status in('draft','submitted')),submitted_at timestamptz,created_at timestamptz not null default now(),
 primary key(lab_id,version),unique(actor_user_id,request_id)
);
create index lab_setup_catalog_lab_idx on public.lab_setup_catalogs(lab_id,created_at desc);
create function public.protect_lab_setup_history() returns trigger language plpgsql set search_path='' as $$begin raise exception 'LAB_SETUP_IMMUTABLE' using errcode='42501';end$$;
create trigger lab_setup_catalog_immutable before update or delete on public.lab_setup_catalogs for each row execute function public.protect_lab_setup_history();
create trigger lab_setup_revision_immutable before update or delete on public.lab_setup_revisions for each row execute function public.protect_lab_setup_history();
create function public.lab_setup_member(p_user_id uuid,p_lab_id uuid) returns boolean language sql stable security definer set search_path='' as $$select (auth.role()='service_role' or p_user_id=auth.uid()) and exists(select 1 from public.lab_memberships m where m.user_id=p_user_id and m.lab_id=p_lab_id and m.active)$$;
alter table public.lab_setup_catalogs enable row level security;
alter table public.lab_setup_catalogs force row level security;
alter table public.lab_setup_drafts enable row level security;
alter table public.lab_setup_drafts force row level security;
alter table public.lab_setup_revisions enable row level security;
alter table public.lab_setup_revisions force row level security;
create policy lab_setup_catalog_read on public.lab_setup_catalogs for select to authenticated using(coalesce(auth.jwt()->>'aal','')='aal2' and public.lab_setup_member(auth.uid(),lab_id));
create policy lab_setup_draft_read on public.lab_setup_drafts for select to authenticated using(coalesce(auth.jwt()->>'aal','')='aal2' and public.lab_setup_member(auth.uid(),lab_id));
create policy lab_setup_revision_read on public.lab_setup_revisions for select to authenticated using(coalesce(auth.jwt()->>'aal','')='aal2' and public.lab_setup_member(auth.uid(),lab_id));
revoke all on public.lab_setup_catalogs,public.lab_setup_drafts,public.lab_setup_revisions from public,anon,authenticated,service_role;
grant select on public.lab_setup_catalogs,public.lab_setup_drafts,public.lab_setup_revisions to authenticated,service_role;

create function public.lab_setup_document_valid(d jsonb) returns boolean language plpgsql stable set search_path='' as $$
declare p jsonb;m jsonb;v jsonb;
begin
 if d is null or jsonb_typeof(d)<>'object' or octet_length(d::text)>200000 then return false;end if;
 if (select count(*) from jsonb_object_keys(d))<>11 or exists(select 1 from jsonb_object_keys(d) key where key not in('version','marketCountryCode','currency','timeZone','papers','inputModes','labCropping','labColourCorrection','deliveryModes','deliveryCountries','productMappings')) or d->'version' is distinct from '1'::jsonb then return false;end if;
 if jsonb_typeof(d->'marketCountryCode') not in('string','null') or (d->>'marketCountryCode' is not null and d->>'marketCountryCode'!~'^[A-Z]{2}$') or jsonb_typeof(d->'currency') not in('string','null') or (d->>'currency' is not null and d->>'currency'!~'^[A-Z]{3}$') or jsonb_typeof(d->'timeZone') not in('string','null') or (d->>'timeZone' is not null and not exists(select 1 from pg_catalog.pg_timezone_names where name=d->>'timeZone')) or jsonb_typeof(d->'labCropping') not in('boolean','null') or jsonb_typeof(d->'labColourCorrection') not in('boolean','null') then return false;end if;
 if (d->>'marketCountryCode' is not null and not(d->>'marketCountryCode'=any(array['AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW']))) or (d->>'currency' is not null and not(d->>'currency'=any(array['AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF','CLP','CNY','COP','CRC','CUC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HRK','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SLL','SOS','SRD','SSP','STN','SVC','SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','UYU','UZS','VES','VND','VUV','WST','XAF','XCD','XCG','XDR','XOF','XPF','XSU','YER','ZAR','ZMW','ZWG','ZWL']))) then return false;end if;
 if jsonb_typeof(d->'papers') is distinct from 'array' or jsonb_typeof(d->'inputModes') is distinct from 'array' or jsonb_typeof(d->'deliveryModes') is distinct from 'array' or jsonb_typeof(d->'deliveryCountries') is distinct from 'array' or jsonb_typeof(d->'productMappings') is distinct from 'array' then return false;end if;
 if jsonb_array_length(d->'papers')>50 or jsonb_array_length(d->'inputModes')>2 or jsonb_array_length(d->'deliveryModes')>3 or jsonb_array_length(d->'deliveryCountries')>250 or jsonb_array_length(d->'productMappings')>500 then return false;end if;
 if exists(select 1 from jsonb_array_elements(d->'inputModes') x where jsonb_typeof(x)<>'string' or x#>>'{}' not in('individual','composite')) or exists(select 1 from jsonb_array_elements(d->'deliveryModes') x where jsonb_typeof(x)<>'string' or x#>>'{}' not in('pickup','ship_to_studio','ship_to_client')) or exists(select 1 from jsonb_array_elements(d->'deliveryCountries') x where jsonb_typeof(x)<>'string' or not(x#>>'{}'=any(array['AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW']))) then return false;end if;
 foreach v in array array[d->'inputModes',d->'deliveryModes',d->'deliveryCountries'] loop if (select count(*) from jsonb_array_elements(v))<>(select count(distinct x) from jsonb_array_elements(v)x) then return false;end if;end loop;
 if (select count(*) from jsonb_array_elements(d->'papers'))<>(select count(distinct x->>'paperId') from jsonb_array_elements(d->'papers')x) or (select count(*) from jsonb_array_elements(d->'productMappings'))<>(select count(distinct x->>'sku') from jsonb_array_elements(d->'productMappings')x) then return false;end if;
 for p in select value from jsonb_array_elements(d->'papers') loop
  if jsonb_typeof(p)<>'object' or (select count(*) from jsonb_object_keys(p))<>5 or exists(select 1 from jsonb_object_keys(p) key where key not in('paperId','name','size','dpi','colorSpace')) or jsonb_typeof(p->'paperId') is distinct from 'string' or coalesce(p->>'paperId','')!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' or jsonb_typeof(p->'name') is distinct from 'string' or length(p->>'name') not between 1 and 100 or p->>'name'<>btrim(p->>'name') or p->>'name' ~ '[[:cntrl:]]' or p->>'colorSpace' is distinct from 'sRGB' then return false;end if;
  if jsonb_typeof(p->'size') is distinct from 'object' or (select count(*) from jsonb_object_keys(p->'size'))<>3 or exists(select 1 from jsonb_object_keys(p->'size') key where key not in('unit','width','height')) or p#>>'{size,unit}' not in('mm','in') or jsonb_typeof(p#>'{size,unit}') is distinct from 'string' then return false;end if;
  foreach v in array array[p#>'{size,width}',p#>'{size,height}'] loop
   if jsonb_typeof(v) not in('number','null') then return false;end if;
   if jsonb_typeof(v)='number' and ((v::text)::numeric<=0 or (v::text)::numeric>(case when p#>>'{size,unit}'='in' then 120 else 3048 end) or round((v::text)::numeric,3)<>(v::text)::numeric) then return false;end if;
  end loop;
  if jsonb_typeof(p->'dpi') not in('number','null') then return false;end if;
  if jsonb_typeof(p->'dpi')='number' and ((p->>'dpi')::numeric not between 72 and 1200 or trunc((p->>'dpi')::numeric)<>(p->>'dpi')::numeric) then return false;end if;
 end loop;
 for m in select value from jsonb_array_elements(d->'productMappings') loop
  if jsonb_typeof(m)<>'object' or (select count(*) from jsonb_object_keys(m))<>3 or exists(select 1 from jsonb_object_keys(m) key where key not in('sku','paperIds','inputModes')) or jsonb_typeof(m->'sku') is distinct from 'string' or length(m->>'sku') not between 1 and 100 or m->>'sku'<>btrim(m->>'sku') or m->>'sku' ~ '[[:cntrl:]]' or jsonb_typeof(m->'paperIds') is distinct from 'array' or jsonb_typeof(m->'inputModes') is distinct from 'array' then return false;end if;
  if jsonb_array_length(m->'paperIds')>50 or jsonb_array_length(m->'inputModes')>2 or exists(select 1 from jsonb_array_elements(m->'paperIds') x where jsonb_typeof(x)<>'string' or x#>>'{}'!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$') or exists(select 1 from jsonb_array_elements(m->'inputModes') x where jsonb_typeof(x)<>'string' or x#>>'{}' not in('individual','composite')) then return false;end if;
  foreach v in array array[m->'paperIds',m->'inputModes'] loop if (select count(*) from jsonb_array_elements(v))<>(select count(distinct x) from jsonb_array_elements(v)x) then return false;end if;end loop;
 end loop;
 return true;
exception when others then return false;
end$$;

create function public.lab_setup_ready(d jsonb,c jsonb,currency_code text) returns boolean language plpgsql stable set search_path='' as $$
declare m jsonb;r jsonb;p jsonb;paper_id text;w numeric;h numeric;pw numeric;ph numeric;has_exact boolean;
begin
 if not public.lab_setup_document_valid(d) or c is null or jsonb_typeof(c)<>'object' then return false;end if;
 if d->>'marketCountryCode' is null or d->>'currency' is null or d->>'timeZone' is null or jsonb_typeof(d->'labCropping')<>'boolean' or jsonb_typeof(d->'labColourCorrection')<>'boolean' or jsonb_array_length(d->'papers')=0 or jsonb_array_length(d->'inputModes')=0 or jsonb_array_length(d->'deliveryModes')=0 or jsonb_array_length(d->'productMappings')=0 or currency_code is distinct from d->>'currency' then return false;end if;
 if jsonb_typeof(c->'issues') is distinct from 'array' or jsonb_typeof(c->'rows') is distinct from 'array' then return false;end if;
 if jsonb_array_length(c->'issues')<>0 or jsonb_array_length(c->'rows')=0 or exists(select 1 from jsonb_array_elements(d->'papers')x where x#>>'{size,width}' is null or x#>>'{size,height}' is null or x->>'dpi' is null) or (exists(select 1 from jsonb_array_elements_text(d->'deliveryModes')x where x<>'pickup') and jsonb_array_length(d->'deliveryCountries')=0) then return false;end if;
 for m in select value from jsonb_array_elements(d->'productMappings') loop
  select value into r from jsonb_array_elements(c->'rows') where value->>'sku'=m->>'sku';
  if not found or r->'printsPerUnit' is distinct from '1'::jsonb or r->>'currency' is distinct from currency_code or jsonb_array_length(m->'paperIds')=0 or jsonb_array_length(m->'inputModes')=0 or exists(select 1 from jsonb_array_elements(m->'inputModes')x where not(d->'inputModes' @> jsonb_build_array(x))) then return false;end if;
  w:=(r->>'widthInches')::numeric;h:=(r->>'heightInches')::numeric;
  if round(w,3)<>w or round(h,3)<>h then return false;end if;
  has_exact:=false;
  for paper_id in select jsonb_array_elements_text(m->'paperIds') loop
   select value into p from jsonb_array_elements(d->'papers') where value->>'paperId'=paper_id;
   if not found then return false;end if;
   pw:=(p#>>'{size,width}')::numeric*(case when p#>>'{size,unit}'='mm' then 1 else 25.4 end);ph:=(p#>>'{size,height}')::numeric*(case when p#>>'{size,unit}'='mm' then 1 else 25.4 end);
   if w*25.4>pw or h*25.4>ph then return false;end if;
   if w*25.4=pw and h*25.4=ph then has_exact:=true;end if;
  end loop;
  if m->'inputModes' @> '["individual"]'::jsonb and not has_exact then return false;end if;
 end loop;
 return true;
exception when others then return false;
end$$;

create function public.save_lab_setup_draft(p_user_id uuid,p_lab_id uuid,p_expected_version integer,p_request_id uuid,p_action text,p_document jsonb,p_catalog_document jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if coalesce(current_row.version,0)<>p_expected_version then raise exception 'LAB_SETUP_VERSION_CONFLICT' using errcode='40001';end if;
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
revoke all on function public.protect_lab_setup_history(),public.lab_setup_member(uuid,uuid),public.lab_setup_document_valid(jsonb),public.lab_setup_ready(jsonb,jsonb,text),public.save_lab_setup_draft(uuid,uuid,integer,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lab_setup_member(uuid,uuid) to authenticated,service_role;
grant execute on function public.save_lab_setup_draft(uuid,uuid,integer,uuid,text,jsonb,jsonb) to service_role;
commit;
