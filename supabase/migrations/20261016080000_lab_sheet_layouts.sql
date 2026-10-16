-- Isolated private TEST sheet drafts. No existing order, price or dispatch rows change.
begin;
create table public.lab_sheet_layout_drafts (
 id uuid primary key, created_by uuid not null references auth.users(id), photographer_id uuid not null references public.photographers(id),
 audience text not null check(audience in('studio','lab')), job_id uuid references public.lab_production_v2_jobs(id),
 name text not null check(length(name) between 1 and 100), document jsonb not null,
 version integer not null default 1 check(version between 1 and 100000), last_request_id uuid not null, last_request_payload jsonb not null,
 current_export_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(audience='studio' or job_id is not null)
);
create table public.lab_sheet_layout_exports (
 id uuid primary key, draft_id uuid not null references public.lab_sheet_layout_drafts(id), draft_version integer not null,
 request_id uuid not null, document jsonb not null, storage_key text not null unique,
 filename text not null, sha256 text not null check(sha256~'^[a-f0-9]{64}$'), byte_size integer not null check(byte_size between 1 and 4000000),
 width_pixels integer not null check(width_pixels between 1 and 5400), height_pixels integer not null check(height_pixels between 1 and 5400),
 manifest jsonb not null, reviewed_at timestamptz, reviewed_by uuid references auth.users(id), created_at timestamptz not null default now(),
 unique(draft_id,request_id), check(width_pixels::bigint*height_pixels<=19440000),check((reviewed_at is null)=(reviewed_by is null))
);
alter table public.lab_sheet_layout_drafts add constraint lab_sheet_current_export_fk foreign key(current_export_id) references public.lab_sheet_layout_exports(id);
create index lab_sheet_layout_drafts_creator on public.lab_sheet_layout_drafts(created_by,updated_at desc);
create function public.lab_sheet_layout_access(p_user_id uuid,p_audience text,p_owner uuid,p_job_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when p_audience='studio' then public.lab_production_owner(p_user_id,p_owner) and (p_job_id is null or exists(select 1 from public.lab_production_v2_jobs j where j.id=p_job_id and j.photographer_id=p_owner))
 when p_audience='lab' then p_job_id is not null and exists(select 1 from public.lab_production_v2_jobs j where j.id=p_job_id and j.photographer_id=p_owner and j.lab_id is not null and public.lab_production_receiver(p_user_id,j.photographer_id,j.lab_id)) else false end
$$;
create function public.lab_sheet_layout_source_allowed(p_user_id uuid,p_audience text,p_owner uuid,p_job_id uuid,p_asset_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.lab_sheet_layout_access(p_user_id,p_audience,p_owner,p_job_id) and exists(select 1 from public.lab_production_assets a where a.id=p_asset_id and a.photographer_id=p_owner and a.kind='original')
 and (p_job_id is null or exists(select 1 from public.lab_production_v2_jobs j cross join lateral jsonb_each(j.work->'slots') s where j.id=p_job_id and s.value->>'sourceAssetId'=p_asset_id::text))
$$;
create function public.lab_sheet_layout_geometry(p_document jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare pw numeric;ph numeric;tw numeric;th numeric;cells jsonb;ci jsonb;ids text[];k text;
begin
 if p_document is null or jsonb_typeof(p_document)<>'object' then raise exception 'SHEET_INVALID_DOCUMENT' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_document))<>5 or exists(select 1 from jsonb_object_keys(p_document) key where key not in('paperId','orientation','templateId','copies','cells')) then raise exception 'SHEET_INVALID_DOCUMENT' using errcode='22023';end if;
 if jsonb_typeof(p_document->'paperId')<>'string' or jsonb_typeof(p_document->'templateId')<>'string' or jsonb_typeof(p_document->'orientation')<>'number' or jsonb_typeof(p_document->'copies')<>'number' or p_document->>'orientation' not in('0','90') or coalesce(p_document->>'copies','')!~'^[0-9]+$' then raise exception 'SHEET_INVALID_DOCUMENT' using errcode='22023';end if;
 if (p_document->>'copies')::numeric not between 1 and 10 then raise exception 'SHEET_INVALID_COPIES' using errcode='22023';end if;
 case p_document->>'paperId' when '4x6' then pw:=4;ph:=6;when '5x7' then pw:=5;ph:=7;when '7x10' then pw:=7;ph:=10;when '8x10' then pw:=8;ph:=10;when '8x12' then pw:=8;ph:=12;when '12x18' then pw:=12;ph:=18;else raise exception 'SHEET_INVALID_PAPER' using errcode='22023';end case;
 if p_document->>'orientation'='90' then tw:=pw;pw:=ph;ph:=tw;end if;
 case p_document->>'templateId'
 when 'single-8x10' then tw:=8;th:=10;cells:='[{"id":"a","xInches":0,"yInches":0,"widthInches":8,"heightInches":10}]';
 when 'two-5x7' then tw:=10;th:=7;cells:='[{"id":"a","xInches":0,"yInches":0,"widthInches":5,"heightInches":7},{"id":"b","xInches":5,"yInches":0,"widthInches":5,"heightInches":7}]';
 when 'single-5x7' then tw:=5;th:=7;cells:='[{"id":"a","xInches":0,"yInches":0,"widthInches":5,"heightInches":7}]';
 when 'four-wallets' then tw:=5;th:=7;cells:='[{"id":"a","xInches":0,"yInches":0,"widthInches":2.5,"heightInches":3.5},{"id":"b","xInches":2.5,"yInches":0,"widthInches":2.5,"heightInches":3.5},{"id":"c","xInches":0,"yInches":3.5,"widthInches":2.5,"heightInches":3.5},{"id":"d","xInches":2.5,"yInches":3.5,"widthInches":2.5,"heightInches":3.5}]';
 when 'single-4x6' then tw:=4;th:=6;cells:='[{"id":"a","xInches":0,"yInches":0,"widthInches":4,"heightInches":6}]';
 else raise exception 'SHEET_INVALID_TEMPLATE' using errcode='22023';end case;
 if tw>pw or th>ph then raise exception 'SHEET_LAYOUT_DOES_NOT_FIT' using errcode='22023';end if;
 if jsonb_typeof(p_document->'cells')<>'array' then raise exception 'SHEET_INVALID_CELLS' using errcode='22023';end if;
 if jsonb_array_length(p_document->'cells')<>jsonb_array_length(cells) then raise exception 'SHEET_INVALID_CELLS' using errcode='22023';end if;
 ids:='{}';
 for ci in select value from jsonb_array_elements(p_document->'cells') loop
  if jsonb_typeof(ci)<>'object' then raise exception 'SHEET_INVALID_CELLS' using errcode='22023';end if;
  if (select count(*) from jsonb_object_keys(ci))<>3 or exists(select 1 from jsonb_object_keys(ci) key where key not in('id','assetId','crop')) or jsonb_typeof(ci->'id')<>'string' or ci->>'id'=any(ids) or not exists(select 1 from jsonb_array_elements(cells) g where g->>'id'=ci->>'id') then raise exception 'SHEET_INVALID_CELLS' using errcode='22023';end if;
  ids:=array_append(ids,ci->>'id');
  if ci->'assetId'<>'null'::jsonb and (jsonb_typeof(ci->'assetId')<>'string' or coalesce(ci->>'assetId','')!~'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$') then raise exception 'SHEET_INVALID_ASSET' using errcode='22023';end if;
  if ci->'crop'<>'null'::jsonb then
   if ci->'assetId'='null'::jsonb or jsonb_typeof(ci->'crop')<>'object' then raise exception 'SHEET_INVALID_CROP' using errcode='22023';end if;
   if (select count(*) from jsonb_object_keys(ci->'crop'))<>5 or exists(select 1 from jsonb_object_keys(ci->'crop') key where key not in('x','y','width','height','rotation')) then raise exception 'SHEET_INVALID_CROP' using errcode='22023';end if;
   foreach k in array array['x','y','width','height','rotation'] loop
    if jsonb_typeof(ci->'crop'->k)<>'number' or coalesce(ci->'crop'->>k,'')!~'^[0-9]+$' then raise exception 'SHEET_INVALID_CROP' using errcode='22023';end if;
   end loop;
   if (ci->'crop'->>'x')::numeric>16000 or (ci->'crop'->>'y')::numeric>16000 or (ci->'crop'->>'width')::numeric not between 1 and 16000 or (ci->'crop'->>'height')::numeric not between 1 and 16000 or ci->'crop'->>'rotation' not in('0','90','180','270') then raise exception 'SHEET_INVALID_CROP' using errcode='22023';end if;
  end if;
 end loop;
 select jsonb_agg(c || jsonb_build_object('xInches',(c->>'xInches')::numeric+(pw-tw)/2,'yInches',(c->>'yInches')::numeric+(ph-th)/2) order by c->>'id') into cells from jsonb_array_elements(cells)c;
 return jsonb_build_object('widthInches',pw,'heightInches',ph,'widthPixels',pw*300,'heightPixels',ph*300,'cells',cells);
end $$;
create function public.lab_sheet_layout_validate_sources(p_user_id uuid,p_audience text,p_owner uuid,p_job_id uuid,p_document jsonb,p_complete boolean) returns void language plpgsql stable security definer set search_path='' as $$
declare geometry jsonb;ci jsonb;g jsonb;a public.lab_production_assets;r jsonb;w numeric;h numeric;wi numeric;hi numeric;
begin
 geometry:=public.lab_sheet_layout_geometry(p_document);
 for ci in select value from jsonb_array_elements(p_document->'cells') loop
  if ci->'assetId'='null'::jsonb then if p_complete then raise exception 'SHEET_INVALID_INCOMPLETE' using errcode='22023';end if;continue;end if;
  if not public.lab_sheet_layout_source_allowed(p_user_id,p_audience,p_owner,p_job_id,(ci->>'assetId')::uuid) then raise exception 'SHEET_FORBIDDEN' using errcode='42501';end if;
  if ci->'crop'='null'::jsonb then if p_complete then raise exception 'SHEET_INVALID_INCOMPLETE' using errcode='22023';end if;continue;end if;
  select * into a from public.lab_production_assets where id=(ci->>'assetId')::uuid;
  r:=ci->'crop';select value into g from jsonb_array_elements(geometry->'cells') where value->>'id'=ci->>'id';
  if (r->>'x')::numeric+(r->>'width')::numeric>a.width_pixels or (r->>'y')::numeric+(r->>'height')::numeric>a.height_pixels then raise exception 'SHEET_INVALID_CROP' using errcode='22023';end if;
  w:=(r->>'width')::numeric;h:=(r->>'height')::numeric;if r->>'rotation' in('90','270') then wi:=w;w:=h;h:=wi;end if;
  wi:=(g->>'widthInches')::numeric;hi:=(g->>'heightInches')::numeric;
  if abs((w/h)/(wi/hi)-1)>0.002 or w/wi<200 or h/hi<200 then raise exception 'SHEET_INVALID_CROP_DETAIL' using errcode='22023';end if;
 end loop;
end $$;
create function public.save_lab_sheet_layout_draft(p_user_id uuid,p_audience text,p_draft_id uuid,p_request_id uuid,p_expected_version integer,p_job_id uuid,p_name text,p_document jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if d.version<>p_expected_version then raise exception 'SHEET_VERSION_CONFLICT' using errcode='40001';end if;
  update public.lab_sheet_layout_drafts set name=btrim(p_name),document=p_document,version=version+1,last_request_id=p_request_id,last_request_payload=payload,current_export_id=null,updated_at=now() where id=d.id;
 else
  if p_expected_version<>0 then raise exception 'SHEET_VERSION_CONFLICT' using errcode='40001';end if;
  if (select count(*) from public.lab_sheet_layout_drafts where created_by=p_user_id)>=60 then raise exception 'SHEET_INVALID_LIMIT' using errcode='22023';end if;
  insert into public.lab_sheet_layout_drafts(id,created_by,photographer_id,audience,job_id,name,document,last_request_id,last_request_payload)values(p_draft_id,p_user_id,owner_id,p_audience,p_job_id,btrim(p_name),p_document,p_request_id,payload);
 end if;
 return jsonb_build_object('id',p_draft_id,'replayed',false);
end $$;
create function public.register_lab_sheet_layout_export(p_user_id uuid,p_audience text,p_draft_id uuid,p_request_id uuid,p_expected_version integer,p_export jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.lab_sheet_layout_drafts;e public.lab_sheet_layout_exports;g jsonb;ci jsonb;m jsonb;a public.lab_production_assets;ix integer:=0;
begin
 if p_user_id is null or p_audience is null or p_request_id is null or p_expected_version is null or p_export is null or jsonb_typeof(p_export)<>'object' then raise exception 'SHEET_INVALID_EXPORT' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_export))<>9 or exists(select 1 from jsonb_object_keys(p_export) key where key not in('id','filename','storageKey','sha256','byteSize','widthPixels','heightPixels','document','manifest')) then raise exception 'SHEET_INVALID_EXPORT' using errcode='22023';end if;
 select * into d from public.lab_sheet_layout_drafts where id=p_draft_id for update;
 if not found or d.created_by<>p_user_id or d.audience<>p_audience or not public.lab_sheet_layout_access(p_user_id,p_audience,d.photographer_id,d.job_id) then raise exception 'SHEET_FORBIDDEN' using errcode='42501';end if;
 if d.version<>p_expected_version or d.document is distinct from p_export->'document' then raise exception 'SHEET_VERSION_CONFLICT' using errcode='40001';end if;
 perform public.lab_sheet_layout_validate_sources(p_user_id,p_audience,d.photographer_id,d.job_id,d.document,true);
 select * into e from public.lab_sheet_layout_exports where draft_id=d.id and request_id=p_request_id;
 if found then
  if e.id::text is distinct from p_export->>'id' or e.sha256 is distinct from p_export->>'sha256' or e.storage_key is distinct from p_export->>'storageKey' or e.filename is distinct from p_export->>'filename' or e.byte_size::text is distinct from p_export->>'byteSize' or e.width_pixels::text is distinct from p_export->>'widthPixels' or e.height_pixels::text is distinct from p_export->>'heightPixels' or e.manifest is distinct from p_export->'manifest' then raise exception 'SHEET_REQUEST_CONFLICT' using errcode='23505';end if;
  if d.current_export_id is distinct from e.id then raise exception 'SHEET_VERSION_CONFLICT' using errcode='40001';end if;return jsonb_build_object('id',e.id,'replayed',true);
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
create function public.review_lab_sheet_layout_export(p_user_id uuid,p_audience text,p_draft_id uuid,p_render_id uuid,p_expected_version integer,p_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.lab_sheet_layout_drafts;e public.lab_sheet_layout_exports;replayed boolean;
begin
 select * into d from public.lab_sheet_layout_drafts where id=p_draft_id for update;
 if not found or p_user_id is null or p_audience is null or d.created_by<>p_user_id or d.audience<>p_audience or not public.lab_sheet_layout_access(p_user_id,p_audience,d.photographer_id,d.job_id) then raise exception 'SHEET_FORBIDDEN' using errcode='42501';end if;
 if p_expected_version is distinct from d.version or p_render_id is distinct from d.current_export_id then raise exception 'SHEET_VERSION_CONFLICT' using errcode='40001';end if;
 select * into e from public.lab_sheet_layout_exports where id=p_render_id and draft_id=d.id for update;
 if not found or p_sha256 is distinct from e.sha256 or e.draft_version<>d.version then raise exception 'SHEET_VERSION_CONFLICT' using errcode='40001';end if;
 perform public.lab_sheet_layout_validate_sources(p_user_id,p_audience,d.photographer_id,d.job_id,d.document,true);
 replayed:=e.reviewed_at is not null;
 if not replayed then update public.lab_sheet_layout_exports set reviewed_at=now(),reviewed_by=p_user_id where id=e.id;end if;
 return jsonb_build_object('id',e.id,'replayed',replayed);
end $$;
create function public.protect_lab_sheet_layout_export() returns trigger language plpgsql set search_path='' as $$begin if tg_op='DELETE' or (to_jsonb(new)-'reviewed_at'-'reviewed_by') is distinct from (to_jsonb(old)-'reviewed_at'-'reviewed_by') or old.reviewed_at is not null or new.reviewed_at is null or new.reviewed_by is null then raise exception 'SHEET_IMMUTABLE' using errcode='42501';end if;return new;end $$;
create trigger lab_sheet_export_immutable before update or delete on public.lab_sheet_layout_exports for each row execute function public.protect_lab_sheet_layout_export();
alter table public.lab_sheet_layout_drafts enable row level security;alter table public.lab_sheet_layout_drafts force row level security;
alter table public.lab_sheet_layout_exports enable row level security;alter table public.lab_sheet_layout_exports force row level security;
create policy lab_sheet_creator_read on public.lab_sheet_layout_drafts for select to authenticated using(created_by=auth.uid() and (audience='studio' or coalesce(auth.jwt()->>'aal','')='aal2') and public.lab_sheet_layout_access(auth.uid(),audience,photographer_id,job_id));
create policy lab_sheet_export_creator_read on public.lab_sheet_layout_exports for select to authenticated using(exists(select 1 from public.lab_sheet_layout_drafts d where d.id=draft_id));
revoke all on public.lab_sheet_layout_drafts,public.lab_sheet_layout_exports from public,anon,authenticated;
grant select on public.lab_sheet_layout_drafts,public.lab_sheet_layout_exports to authenticated,service_role;
revoke all on function public.lab_sheet_layout_access(uuid,text,uuid,uuid),public.lab_sheet_layout_source_allowed(uuid,text,uuid,uuid,uuid),public.lab_sheet_layout_geometry(jsonb),public.lab_sheet_layout_validate_sources(uuid,text,uuid,uuid,jsonb,boolean),public.save_lab_sheet_layout_draft(uuid,text,uuid,uuid,integer,uuid,text,jsonb),public.register_lab_sheet_layout_export(uuid,text,uuid,uuid,integer,jsonb),public.review_lab_sheet_layout_export(uuid,text,uuid,uuid,integer,text),public.protect_lab_sheet_layout_export() from public,anon,authenticated,service_role;
grant execute on function public.lab_sheet_layout_access(uuid,text,uuid,uuid) to authenticated,service_role;
grant execute on function public.save_lab_sheet_layout_draft(uuid,text,uuid,uuid,integer,uuid,text,jsonb),public.register_lab_sheet_layout_export(uuid,text,uuid,uuid,integer,jsonb),public.review_lab_sheet_layout_export(uuid,text,uuid,uuid,integer,text) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('lab-sheet-layout-files','lab-sheet-layout-files',false,4000000,array['image/jpeg']) on conflict(id) do nothing;
commit;
