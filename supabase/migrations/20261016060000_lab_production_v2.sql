-- Independent print slots and linked reprints. No historical production function,
-- policy, row or asset is changed by this additive migration.
begin;
create table public.lab_production_v2_jobs (
 id uuid primary key default gen_random_uuid(), photographer_id uuid not null references public.photographers(id),
 lab_id uuid references public.studio_labs(id), gallery_id uuid not null references public.lab_production_galleries(id),
 reference text not null unique, request_id uuid not null, created_by uuid references auth.users(id),
 creation_payload jsonb not null, receipt_hash text not null unique check(receipt_hash~'^[a-f0-9]{64}$'),
 receipt_expires_at timestamptz not null default now()+interval '30 days', snapshot jsonb not null, work jsonb not null,
 status text not null default 'submitted' check(status in('submitted','accepted','in_production','ready','completed')),
 dispatch_state text not null default 'idle' check(dispatch_state in('idle','claimed','handed_off','printed')),
 reprint_of uuid references public.lab_production_v2_jobs(id), version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(gallery_id,request_id)
);
create table public.lab_production_v2_assets (
 id uuid primary key, photographer_id uuid not null references public.photographers(id),
 job_id uuid not null references public.lab_production_v2_jobs(id),
 slot_id text not null check(slot_id in('8x10','5x7-a','5x7-b')),
 kind text not null check(kind in('crop','corrected')), source_asset_id uuid not null,
 filename text not null, storage_key text not null unique, sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
 byte_size integer not null check(byte_size between 1 and 4000000),
 width_pixels integer not null, height_pixels integer not null, content_type text not null check(content_type='image/jpeg'),
 created_at timestamptz not null default now(),
 check((slot_id='8x10' and width_pixels=2400 and height_pixels=3000) or(slot_id in('5x7-a','5x7-b') and width_pixels=1500 and height_pixels=2100))
);
create table public.lab_production_v2_events (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.lab_production_v2_jobs(id),
 actor_user_id uuid references auth.users(id), actor_role text not null check(actor_role in('photographer','lab','policy')),
 request_id uuid not null, request_payload jsonb not null, action text not null, version integer not null,
 created_at timestamptz not null default now(), unique(job_id,version), unique(actor_user_id,request_id)
);
create index production_v2_owner_jobs on public.lab_production_v2_jobs(photographer_id,created_at desc,id);
create index production_v2_lab_jobs on public.lab_production_v2_jobs(lab_id,created_at desc,id);
create index production_v2_job_assets on public.lab_production_v2_assets(job_id,slot_id);
create index production_v2_job_events on public.lab_production_v2_events(job_id,version);
create index production_v2_reprints on public.lab_production_v2_jobs(reprint_of);

do $$declare t text;begin
 foreach t in array array['lab_production_v2_jobs','lab_production_v2_assets','lab_production_v2_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to authenticated,service_role',t);
 end loop;
end$$;
create function public.lab_production_v2_file_reader(p_user_id uuid,p_job_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.lab_production_v2_jobs j where j.id=p_job_id and
  (public.lab_production_owner(p_user_id,j.photographer_id) or
   (coalesce(auth.jwt()->>'aal','')='aal2' and public.lab_production_reader(p_user_id,j.photographer_id,j.lab_id))))
$$;
-- Full agreements contain photographer retail; lab APIs provide wholesale projections.
create policy production_v2_owner_read on public.lab_production_v2_jobs for select to authenticated using(public.lab_production_owner(auth.uid(),photographer_id));
create policy production_v2_assets_read on public.lab_production_v2_assets for select to authenticated using(public.lab_production_v2_file_reader(auth.uid(),job_id));
create policy production_v2_events_read on public.lab_production_v2_events for select to authenticated using(public.lab_production_v2_file_reader(auth.uid(),job_id));
create function public.protect_lab_production_v2() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' or tg_table_name in('lab_production_v2_assets','lab_production_v2_events') then raise exception 'PRODUCTION_IMMUTABLE' using errcode='42501';end if;
 if row(new.id,new.photographer_id,new.lab_id,new.gallery_id,new.reference,new.request_id,new.created_by,new.creation_payload,new.receipt_hash,new.receipt_expires_at,new.snapshot,new.reprint_of,new.created_at)
  is distinct from row(old.id,old.photographer_id,old.lab_id,old.gallery_id,old.reference,old.request_id,old.created_by,old.creation_payload,old.receipt_hash,old.receipt_expires_at,old.snapshot,old.reprint_of,old.created_at)
 then raise exception 'PRODUCTION_IMMUTABLE' using errcode='42501';end if;
 return new;
end$$;
create trigger production_v2_job_snapshot before update or delete on public.lab_production_v2_jobs for each row execute function public.protect_lab_production_v2();
create trigger production_v2_assets_immutable before update or delete on public.lab_production_v2_assets for each row execute function public.protect_lab_production_v2();
create trigger production_v2_events_immutable before update or delete on public.lab_production_v2_events for each row execute function public.protect_lab_production_v2();

create function public.lab_production_v2_holds(p_job public.lab_production_v2_jobs) returns jsonb language plpgsql stable set search_path='' as $$
declare out jsonb:='[]';sid text;s jsonb;begin
 if p_job.work->'photographerApproved' is distinct from 'true'::jsonb then out:=out||'"photographer_approval"'::jsonb;end if;
 foreach sid in array array['8x10','5x7-a','5x7-b'] loop
  s:=p_job.work#>array['slots',sid];
  if s->'cropApproved' is distinct from 'true'::jsonb or s->>'cropAssetId' is null then out:=out||to_jsonb('crop_'||sid);end if;
  if p_job.snapshot#>>'{policy,labColourCorrection}'='true' and s->>'colourAssetId' is null then out:=out||to_jsonb('colour_'||sid);end if;
  if s->>'finalReviewedAt' is null then out:=out||to_jsonb('final_review_'||sid);end if;
 end loop;return out;
end$$;
create function public.lab_production_v2_receipt(p_job public.lab_production_v2_jobs) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('workflowVersion',2,'id',p_job.id,'reference',p_job.reference,'version',p_job.version,'status',p_job.status,
 'studioName',p_job.snapshot->'studioName','targetLabel',p_job.snapshot->'targetLabel','policy',p_job.snapshot->'policy','offer',p_job.snapshot->'offer',
 'currency',p_job.snapshot->'currency','quantity',p_job.snapshot->'quantity','subtotalMinor',p_job.snapshot->'subtotalMinor',
 'testOnly',true,'payment','test_no_payment','printAllowed',false,'reprintOf',p_job.reprint_of,
 'holds',public.lab_production_v2_holds(p_job),'createdAt',p_job.created_at,'updatedAt',p_job.updated_at,
 'printSlots',(select jsonb_agg(jsonb_build_object('slotId',s.key,'photoId',s.value->>'photoId','filename',p.value->>'filename') order by s.key)
  from jsonb_each(p_job.work->'slots') s join public.lab_production_galleries g on g.id=p_job.gallery_id
  cross join lateral jsonb_array_elements(g.document->'photos') p where p.value->>'id'=s.value->>'photoId'),
 'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actorRole',e.actor_role,'version',e.version,'createdAt',e.created_at) order by e.version)
 from public.lab_production_v2_events e where e.job_id=p_job.id),'[]'::jsonb))
$$;
create function public.submit_lab_production_v2_order(p_gallery_id uuid,p_token_hash text,p_request_id uuid,p_receipt_hash text,p_selections jsonb,p_quantity integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.lab_production_galleries%rowtype;j public.lab_production_v2_jobs%rowtype;payload jsonb;slots jsonb:='{}';sid text;aid uuid;jid uuid;auto boolean;begin
 if p_request_id is null or p_quantity is null or p_quantity not between 1 and 10 or coalesce(p_receipt_hash,'')!~'^[a-f0-9]{64}$'
 or jsonb_typeof(p_selections) is distinct from 'object' then raise exception 'PRODUCTION_INVALID' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_selections))<>3 or exists(select 1 from jsonb_object_keys(p_selections) k where k not in('8x10','5x7-a','5x7-b')) then raise exception 'PRODUCTION_INVALID' using errcode='22023';end if;
 select * into g from public.lab_production_galleries where id=p_gallery_id and token_hash=p_token_hash and revoked_at is null and expires_at>now() for update;
 if not found then raise exception 'PRODUCTION_NOT_FOUND' using errcode='42501';end if;
 payload:=jsonb_build_object('tokenHash',p_token_hash,'receiptHash',p_receipt_hash,'selections',p_selections,'quantity',p_quantity);
 select * into j from public.lab_production_v2_jobs where gallery_id=g.id and request_id=p_request_id;
 if found then if j.creation_payload is distinct from payload then raise exception 'PRODUCTION_REQUEST_CONFLICT' using errcode='PT409';end if;return public.lab_production_v2_receipt(j)||jsonb_build_object('replayed',true);end if;
 if g.lab_id is not null and not exists(select 1 from public.studio_labs l where l.id=g.lab_id and l.status='active' and l.intake_enabled and l.catalog_verified) then raise exception 'PRODUCTION_LAB_NOT_READY' using errcode='PT409';end if;
 if(select count(*) from public.lab_production_v2_jobs where gallery_id=g.id)>=20 then raise exception 'PRODUCTION_LIMIT' using errcode='22023';end if;
 foreach sid in array array['8x10','5x7-a','5x7-b'] loop
  if jsonb_typeof(p_selections->sid) is distinct from 'string' then raise exception 'PRODUCTION_INVALID' using errcode='22023';end if;
  aid:=(g.photo_map->>(p_selections->>sid))::uuid;
  if aid is null or not exists(select 1 from public.lab_production_assets a where a.id=aid and a.photographer_id=g.photographer_id and a.kind='original') then raise exception 'PRODUCTION_NOT_FOUND' using errcode='42501';end if;
  slots:=slots||jsonb_build_object(sid,jsonb_build_object('sourceAssetId',aid,'photoId',p_selections->>sid,'cropApproved',false));
 end loop;
 auto:=(g.document#>>'{policy,autoApprove}')::boolean;jid:=gen_random_uuid();
 insert into public.lab_production_v2_jobs(id,photographer_id,lab_id,gallery_id,reference,request_id,creation_payload,receipt_hash,snapshot,work)
 values(jid,g.photographer_id,g.lab_id,g.id,'PROOF2-'||upper(replace(jid::text,'-','')),p_request_id,payload,p_receipt_hash,
 (g.document-'photos'-'name')||jsonb_build_object('source',g.source,'initialSelections',p_selections,'quantity',p_quantity,'subtotalMinor',(g.document#>>'{offer,retailCents}')::bigint*p_quantity,'workflowVersion',2,'testOnly',true,'payment','test_no_payment','printAllowed',false),
 jsonb_build_object('photographerApproved',auto,'photographerApprovedAt',case when auto then now() else null end,'slots',slots)) returning * into j;
 insert into public.lab_production_v2_events(job_id,actor_role,request_id,request_payload,action,version) values(j.id,case when auto then 'policy' else 'photographer' end,p_request_id,payload,case when auto then 'submitted_auto_approved' else 'submitted' end,1);
 return public.lab_production_v2_receipt(j)||jsonb_build_object('replayed',false);
end$$;
create function public.read_lab_production_v2_receipt(p_receipt_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lab_production_v2_jobs%rowtype;begin
 select * into j from public.lab_production_v2_jobs where receipt_hash=p_receipt_hash and receipt_expires_at>now();
 if not found then raise exception 'PRODUCTION_NOT_FOUND' using errcode='42501';end if;return public.lab_production_v2_receipt(j);
end$$;

create function public.register_lab_production_v2_asset(p_user_id uuid,p_document jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lab_production_v2_jobs%rowtype;a public.lab_production_v2_assets%rowtype;s public.lab_production_v2_assets%rowtype;w jsonb;field_name text;begin
 if jsonb_typeof(p_document) is distinct from 'object' then raise exception 'PRODUCTION_INVALID_ASSET' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_document))<>12 or exists(select 1 from jsonb_object_keys(p_document) k where k not in('id','kind','jobId','slotId','sourceAssetId','filename','storageKey','sha256','byteSize','widthPixels','heightPixels','contentType'))
 or coalesce(p_document->>'kind','') not in('crop','corrected') or coalesce(p_document->>'slotId','') not in('8x10','5x7-a','5x7-b')
 or jsonb_typeof(p_document->'sha256') is distinct from 'string' or coalesce(p_document->>'sha256','')!~'^[a-f0-9]{64}$'
 or coalesce(p_document->>'filename','')='' or length(p_document->>'filename')>200 or p_document->>'filename'~'[[:cntrl:]]'
 or p_document->>'contentType' is distinct from 'image/jpeg' then raise exception 'PRODUCTION_INVALID_ASSET' using errcode='22023';end if;
 foreach field_name in array array['byteSize','widthPixels','heightPixels'] loop
  if jsonb_typeof(p_document->field_name) is distinct from 'number' then raise exception 'PRODUCTION_INVALID_ASSET' using errcode='22023';end if;
  if (p_document->>field_name)::numeric<>trunc((p_document->>field_name)::numeric) then raise exception 'PRODUCTION_INVALID_ASSET' using errcode='22023';end if;
 end loop;
 select * into j from public.lab_production_v2_jobs where id=(p_document->>'jobId')::uuid for update;
 if not found or not public.lab_production_reader(p_user_id,j.photographer_id,j.lab_id) then raise exception 'PRODUCTION_NOT_FOUND' using errcode='42501';end if;
 w:=j.work#>array['slots',p_document->>'slotId'];
 if j.status not in('submitted','accepted') or j.dispatch_state<>'idle' then raise exception 'PRODUCTION_TRANSITION' using errcode='PT409';end if;
 if p_document->>'kind'='crop' then
  if not(public.lab_production_owner(p_user_id,j.photographer_id) and j.snapshot#>>'{policy,cropResponsibility}'='photographer') and not(public.lab_production_receiver(p_user_id,j.photographer_id,j.lab_id) and j.snapshot#>>'{policy,cropResponsibility}'='lab') then raise exception 'PRODUCTION_FORBIDDEN' using errcode='42501';end if;
  if p_document->>'sourceAssetId' is distinct from w->>'sourceAssetId' then raise exception 'PRODUCTION_STALE_RENDER' using errcode='PT409';end if;
 else
  if j.status<>'accepted' or not public.lab_production_receiver(p_user_id,j.photographer_id,j.lab_id) or j.snapshot#>>'{policy,labColourCorrection}' is distinct from 'true' then raise exception 'PRODUCTION_FORBIDDEN' using errcode='42501';end if;
  select * into s from public.lab_production_v2_assets where id=(p_document->>'sourceAssetId')::uuid;
  if s.job_id is distinct from j.id or s.slot_id is distinct from p_document->>'slotId' or s.kind is distinct from 'crop' or s.id::text is distinct from w->>'cropAssetId' or w->'cropApproved' is distinct from 'true'::jsonb then raise exception 'PRODUCTION_STALE_RENDER' using errcode='PT409';end if;
 end if;
 if p_document->>'storageKey' is distinct from j.photographer_id::text||'/'||(p_document->>'id')||'.jpg' then raise exception 'PRODUCTION_INVALID_ASSET' using errcode='22023';end if;
 select * into a from public.lab_production_v2_assets where id=(p_document->>'id')::uuid;
 if found then
  if row(a.photographer_id,a.job_id,a.slot_id,a.kind,a.source_asset_id,a.filename,a.storage_key,a.sha256,a.byte_size,a.width_pixels,a.height_pixels,a.content_type)
   is distinct from row(j.photographer_id,j.id,p_document->>'slotId',p_document->>'kind',(p_document->>'sourceAssetId')::uuid,p_document->>'filename',p_document->>'storageKey',p_document->>'sha256',(p_document->>'byteSize')::integer,(p_document->>'widthPixels')::integer,(p_document->>'heightPixels')::integer,p_document->>'contentType')
  then raise exception 'PRODUCTION_REQUEST_CONFLICT' using errcode='PT409';end if;return to_jsonb(a);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('production-v2-assets:'||j.photographer_id::text,20261016));
 if(select count(*) from public.lab_production_v2_assets where photographer_id=j.photographer_id)>=4000 then raise exception 'PRODUCTION_LIMIT' using errcode='22023';end if;
 insert into public.lab_production_v2_assets(id,photographer_id,job_id,slot_id,kind,source_asset_id,filename,storage_key,sha256,byte_size,width_pixels,height_pixels,content_type)
 values((p_document->>'id')::uuid,j.photographer_id,j.id,p_document->>'slotId',p_document->>'kind',(p_document->>'sourceAssetId')::uuid,p_document->>'filename',p_document->>'storageKey',p_document->>'sha256',(p_document->>'byteSize')::integer,(p_document->>'widthPixels')::integer,(p_document->>'heightPixels')::integer,p_document->>'contentType') returning * into a;
 return to_jsonb(a);
end$$;

create function public.act_lab_production_v2_job(p_user_id uuid,p_job_id uuid,p_expected_version integer,p_request_id uuid,p_action text,p_details jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lab_production_v2_jobs%rowtype;e public.lab_production_v2_events%rowtype;a public.lab_production_v2_assets%rowtype;g public.lab_production_galleries%rowtype;
 payload jsonb;receiver boolean;own boolean;role_name text:='lab';sid text;w jsonb;next_status text;aid uuid;begin
 if p_user_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1 or p_action is null
 or p_action not in('approve_order','accept','set_slot_source','approve_crop','complete_colour','final_review','transition','reopen')
 or jsonb_typeof(p_details) is distinct from 'object' then raise exception 'PRODUCTION_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('production-v2-request:'||p_user_id::text||p_request_id::text,20261016));
 select * into j from public.lab_production_v2_jobs where id=p_job_id for update;
 if not found or not public.lab_production_reader(p_user_id,j.photographer_id,j.lab_id) then raise exception 'PRODUCTION_NOT_FOUND' using errcode='42501';end if;
 payload:=jsonb_build_object('jobId',p_job_id,'expectedVersion',p_expected_version,'action',p_action,'details',p_details);
 select * into e from public.lab_production_v2_events where actor_user_id=p_user_id and request_id=p_request_id;
 if found then if e.request_payload is distinct from payload then raise exception 'PRODUCTION_REQUEST_CONFLICT' using errcode='PT409';end if;return to_jsonb(j)||jsonb_build_object('replayed',true);end if;
 if j.version<>p_expected_version then raise exception 'PRODUCTION_VERSION_CONFLICT' using errcode='PT409';end if;
 receiver:=public.lab_production_receiver(p_user_id,j.photographer_id,j.lab_id);own:=public.lab_production_owner(p_user_id,j.photographer_id);
 if p_action='transition' then
  if not receiver or (select count(*) from jsonb_object_keys(p_details))<>1 or not(p_details?'status') then raise exception 'PRODUCTION_FORBIDDEN' using errcode='42501';end if;
  next_status:=case j.status when 'accepted' then 'in_production' when 'in_production' then 'ready' when 'ready' then 'completed' else null end;
  if next_status is null or p_details->>'status' is distinct from next_status then raise exception 'PRODUCTION_TRANSITION' using errcode='PT409';end if;
  if public.lab_production_v2_holds(j)<>'[]'::jsonb then raise exception 'PRODUCTION_HELD' using errcode='PT409';end if;j.status:=next_status;
 elsif p_action='reopen' then
  if not receiver or j.status not in('in_production','ready') or j.dispatch_state<>'idle' then raise exception 'PRODUCTION_DISPATCH_LOCKED' using errcode='PT409';end if;
  if (select count(*) from jsonb_object_keys(p_details))<>1 or coalesce(length(p_details->>'reason'),0) not between 5 and 500 or p_details->>'reason'~'[[:cntrl:]]' then raise exception 'PRODUCTION_INVALID' using errcode='22023';end if;
  foreach sid in array array['8x10','5x7-a','5x7-b'] loop j.work:=jsonb_set(j.work,array['slots',sid],(j.work#>array['slots',sid])-'finalReviewedAt');end loop;j.status:='accepted';
 else
  if j.status not in('submitted','accepted') or j.dispatch_state<>'idle' then raise exception 'PRODUCTION_TRANSITION' using errcode='PT409';end if;
  if p_action='approve_order' then
   if not own or p_details<>'{}'::jsonb then raise exception 'PRODUCTION_FORBIDDEN' using errcode='42501';end if;role_name:='photographer';j.work:=j.work||jsonb_build_object('photographerApproved',true,'photographerApprovedAt',now());
  elsif p_action='accept' then
   if not receiver or j.status<>'submitted' or p_details<>'{}'::jsonb then raise exception 'PRODUCTION_TRANSITION' using errcode='PT409';end if;j.status:='accepted';
  else
   sid:=p_details->>'slotId';if sid is null or sid not in('8x10','5x7-a','5x7-b') then raise exception 'PRODUCTION_INVALID' using errcode='22023';end if;
   w:=j.work#>array['slots',sid];
   if p_action='set_slot_source' then
    if not own then raise exception 'PRODUCTION_FORBIDDEN' using errcode='42501';end if;
    if (select count(*) from jsonb_object_keys(p_details))<>2 or not(p_details?'photoId') then raise exception 'PRODUCTION_INVALID' using errcode='22023';end if;
    select * into g from public.lab_production_galleries where id=j.gallery_id;
    aid:=(g.photo_map->>(p_details->>'photoId'))::uuid;
    if aid is null or not exists(select 1 from public.lab_production_assets s where s.id=aid and s.kind='original' and s.photographer_id=j.photographer_id) then raise exception 'PRODUCTION_NOT_FOUND' using errcode='42501';end if;
    w:=jsonb_build_object('sourceAssetId',aid,'photoId',p_details->>'photoId','cropApproved',false);role_name:='photographer';
   else
    if exists(select 1 from jsonb_object_keys(p_details) k where k not in('slotId','assetId','reviewNoChange')) or not(p_details?'assetId') or(p_action<>'complete_colour' and p_details?'reviewNoChange') then raise exception 'PRODUCTION_INVALID' using errcode='22023';end if;
    select * into a from public.lab_production_v2_assets where id=(p_details->>'assetId')::uuid and job_id=j.id and slot_id=sid;
    if not found then raise exception 'PRODUCTION_STALE_RENDER' using errcode='PT409';end if;
    if p_action='approve_crop' then
     if not(own and j.snapshot#>>'{policy,cropResponsibility}'='photographer') and not(receiver and j.snapshot#>>'{policy,cropResponsibility}'='lab') then raise exception 'PRODUCTION_FORBIDDEN' using errcode='42501';end if;
     if a.kind<>'crop' or a.id::text is distinct from w->>'cropAssetId' or a.source_asset_id::text is distinct from w->>'sourceAssetId' then raise exception 'PRODUCTION_STALE_RENDER' using errcode='PT409';end if;
     role_name:=case when j.snapshot#>>'{policy,cropResponsibility}'='photographer' then 'photographer' else 'lab' end;w:=w||jsonb_build_object('cropApproved',true,'cropApprovedAt',now());
    elsif p_action='complete_colour' then
     if not receiver or j.status<>'accepted' or j.snapshot#>>'{policy,labColourCorrection}' is distinct from 'true' or w->'cropApproved' is distinct from 'true'::jsonb then raise exception 'PRODUCTION_FORBIDDEN' using errcode='42501';end if;
     if p_details->'reviewNoChange'='true'::jsonb then
      if a.kind<>'crop' or a.id::text is distinct from w->>'cropAssetId' then raise exception 'PRODUCTION_STALE_RENDER' using errcode='PT409';end if;
     elsif p_details->'reviewNoChange'='false'::jsonb then
      if a.kind<>'corrected' or a.source_asset_id::text is distinct from w->>'cropAssetId' then raise exception 'PRODUCTION_STALE_RENDER' using errcode='PT409';end if;
     else raise exception 'PRODUCTION_INVALID' using errcode='22023';end if;
     w:=(w-'finalReviewedAt')||jsonb_build_object('colourAssetId',a.id,'colourCompletedAt',now());
    else
     if not receiver or j.status<>'accepted' or w->'cropApproved' is distinct from 'true'::jsonb or a.id::text is distinct from (case when j.snapshot#>>'{policy,labColourCorrection}'='true' then w->>'colourAssetId' else w->>'cropAssetId' end) then raise exception 'PRODUCTION_STALE_RENDER' using errcode='PT409';end if;
     w:=w||jsonb_build_object('finalReviewedAt',now());
    end if;
   end if;j.work:=jsonb_set(j.work,array['slots',sid],w);
  end if;
 end if;
 update public.lab_production_v2_jobs set work=j.work,status=j.status,version=version+1,updated_at=now() where id=j.id returning * into j;
 insert into public.lab_production_v2_events(job_id,actor_user_id,actor_role,request_id,request_payload,action,version)
 values(j.id,p_user_id,role_name,p_request_id,payload,case when p_action='complete_colour' and p_details->'reviewNoChange'='true'::jsonb then 'reviewed_no_colour_change' else p_action end,j.version);
 return to_jsonb(j)||jsonb_build_object('replayed',false);
end$$;

create function public.save_lab_production_v2_crop(p_user_id uuid,p_job_id uuid,p_expected_version integer,p_request_id uuid,p_slot_id text,p_crop jsonb,p_asset_document jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lab_production_v2_jobs%rowtype;e public.lab_production_v2_events%rowtype;s public.lab_production_assets%rowtype;payload jsonb;w jsonb;a jsonb;field_name text;cw integer;ch integer;role_name text;begin
 if p_user_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1 or p_slot_id is null or p_slot_id not in('8x10','5x7-a','5x7-b') or jsonb_typeof(p_crop) is distinct from 'object' then raise exception 'PRODUCTION_INVALID_CROP' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_crop))<>5 or exists(select 1 from jsonb_object_keys(p_crop) k where k not in('x','y','width','height','rotation')) then raise exception 'PRODUCTION_INVALID_CROP' using errcode='22023';end if;
 foreach field_name in array array['x','y','width','height','rotation'] loop
  if jsonb_typeof(p_crop->field_name) is distinct from 'number' then raise exception 'PRODUCTION_INVALID_CROP' using errcode='22023';end if;
  if (p_crop->>field_name)::numeric<>trunc((p_crop->>field_name)::numeric) then raise exception 'PRODUCTION_INVALID_CROP' using errcode='22023';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('production-v2-request:'||p_user_id::text||p_request_id::text,20261016));
 select * into j from public.lab_production_v2_jobs where id=p_job_id for update;
 if not found or not public.lab_production_reader(p_user_id,j.photographer_id,j.lab_id) then raise exception 'PRODUCTION_NOT_FOUND' using errcode='42501';end if;
 payload:=jsonb_build_object('jobId',p_job_id,'expectedVersion',p_expected_version,'slotId',p_slot_id,'crop',p_crop,'asset',p_asset_document);
 select * into e from public.lab_production_v2_events where actor_user_id=p_user_id and request_id=p_request_id;
 if found then if e.request_payload is distinct from payload then raise exception 'PRODUCTION_REQUEST_CONFLICT' using errcode='PT409';end if;return to_jsonb(j)||jsonb_build_object('replayed',true);end if;
 if j.version<>p_expected_version then raise exception 'PRODUCTION_VERSION_CONFLICT' using errcode='PT409';end if;
 if j.status not in('submitted','accepted') or j.dispatch_state<>'idle' then raise exception 'PRODUCTION_TRANSITION' using errcode='PT409';end if;
 if not(public.lab_production_owner(p_user_id,j.photographer_id) and j.snapshot#>>'{policy,cropResponsibility}'='photographer') and not(public.lab_production_receiver(p_user_id,j.photographer_id,j.lab_id) and j.snapshot#>>'{policy,cropResponsibility}'='lab') then raise exception 'PRODUCTION_FORBIDDEN' using errcode='42501';end if;
 w:=j.work#>array['slots',p_slot_id];select * into s from public.lab_production_assets where id=(w->>'sourceAssetId')::uuid;
 cw:=(p_crop->>'width')::integer;ch:=(p_crop->>'height')::integer;
 if (p_crop->>'rotation')::integer not in(0,90,180,270) or (p_crop->>'x')::integer<0 or(p_crop->>'y')::integer<0 or cw<1 or ch<1 or(p_crop->>'x')::bigint+cw>s.width_pixels or(p_crop->>'y')::bigint+ch>s.height_pixels then raise exception 'PRODUCTION_INVALID_CROP' using errcode='22023';end if;
 if (p_crop->>'rotation')::integer in(90,270) then cw:=(p_crop->>'height')::integer;ch:=(p_crop->>'width')::integer;end if;
 if abs((cw::numeric/ch)/(case p_slot_id when '8x10' then 8.0/10 else 5.0/7 end)-1)>0.002 or cw<(case p_slot_id when '8x10' then 1600 else 1000 end) or ch<(case p_slot_id when '8x10' then 2000 else 1400 end) then raise exception 'PRODUCTION_CROP_DETAIL' using errcode='22023';end if;
 if p_asset_document->>'kind' is distinct from 'crop' or p_asset_document->>'jobId' is distinct from j.id::text or p_asset_document->>'slotId' is distinct from p_slot_id then raise exception 'PRODUCTION_INVALID_ASSET' using errcode='22023';end if;
 a:=public.register_lab_production_v2_asset(p_user_id,p_asset_document);
 w:=(w-'cropApprovedAt'-'colourAssetId'-'colourCompletedAt'-'finalReviewedAt')||jsonb_build_object('crop',p_crop,'cropAssetId',a->>'id','cropApproved',false);
 update public.lab_production_v2_jobs set work=jsonb_set(j.work,array['slots',p_slot_id],w),version=version+1,updated_at=now() where id=j.id returning * into j;
 role_name:=case when j.snapshot#>>'{policy,cropResponsibility}'='photographer' then 'photographer' else 'lab' end;
 insert into public.lab_production_v2_events(job_id,actor_user_id,actor_role,request_id,request_payload,action,version) values(j.id,p_user_id,role_name,p_request_id,payload,'save_crop',j.version);
 return to_jsonb(j)||jsonb_build_object('replayed',false);
end$$;

create function public.reprint_lab_production_v2_job(p_user_id uuid,p_job_id uuid,p_expected_version integer,p_request_id uuid,p_reason text,p_receipt_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.lab_production_v2_jobs%rowtype;j public.lab_production_v2_jobs%rowtype;payload jsonb;sid text;slots jsonb:='{}';auto boolean;jid uuid;begin
 if p_user_id is null or p_request_id is null or p_expected_version is null or p_expected_version<1 or coalesce(length(p_reason),0) not between 5 and 500 or p_reason~'[[:cntrl:]]' or coalesce(p_receipt_hash,'')!~'^[a-f0-9]{64}$' then raise exception 'PRODUCTION_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('production-v2-request:'||p_user_id::text||p_request_id::text,20261016));
 select * into old from public.lab_production_v2_jobs where id=p_job_id for update;
 if not found or not(public.lab_production_owner(p_user_id,old.photographer_id) or public.lab_production_receiver(p_user_id,old.photographer_id,old.lab_id)) then raise exception 'PRODUCTION_NOT_FOUND' using errcode='42501';end if;
 payload:=jsonb_build_object('jobId',p_job_id,'expectedVersion',p_expected_version,'reason',p_reason,'receiptHash',p_receipt_hash);
 select * into j from public.lab_production_v2_jobs where created_by=p_user_id and request_id=p_request_id;
 if found then if j.creation_payload is distinct from payload then raise exception 'PRODUCTION_REQUEST_CONFLICT' using errcode='PT409';end if;return to_jsonb(j)||jsonb_build_object('replayed',true);end if;
 if exists(select 1 from public.lab_production_v2_events where actor_user_id=p_user_id and request_id=p_request_id) then raise exception 'PRODUCTION_REQUEST_CONFLICT' using errcode='PT409';end if;
 if old.version<>p_expected_version then raise exception 'PRODUCTION_VERSION_CONFLICT' using errcode='PT409';end if;
 if old.status not in('ready','completed') and old.dispatch_state not in('claimed','handed_off','printed') then raise exception 'PRODUCTION_TRANSITION' using errcode='PT409';end if;
 perform pg_advisory_xact_lock(hashtextextended('production-v2-reprints:'||old.photographer_id::text,20261016));
 if(select count(*) from public.lab_production_v2_jobs where reprint_of=old.id)>=10 then raise exception 'PRODUCTION_LIMIT' using errcode='22023';end if;
 if old.lab_id is not null and not exists(select 1 from public.studio_labs l where l.id=old.lab_id and l.status='active' and l.intake_enabled and l.catalog_verified) then raise exception 'PRODUCTION_LAB_NOT_READY' using errcode='PT409';end if;
 foreach sid in array array['8x10','5x7-a','5x7-b'] loop slots:=slots||jsonb_build_object(sid,jsonb_build_object('sourceAssetId',old.work#>>array['slots',sid,'sourceAssetId'],'photoId',old.work#>>array['slots',sid,'photoId'],'cropApproved',false));end loop;
 auto:=(old.snapshot#>>'{policy,autoApprove}')::boolean;jid:=gen_random_uuid();
 insert into public.lab_production_v2_jobs(id,photographer_id,lab_id,gallery_id,reference,request_id,created_by,creation_payload,receipt_hash,snapshot,work,reprint_of)
 values(jid,old.photographer_id,old.lab_id,old.gallery_id,'PROOF2-'||upper(replace(jid::text,'-','')),p_request_id,p_user_id,payload,p_receipt_hash,old.snapshot||jsonb_build_object('initialSelections',(select jsonb_object_agg(s.key,s.value->'photoId') from jsonb_each(old.work->'slots') s)),
 jsonb_build_object('photographerApproved',auto,'photographerApprovedAt',case when auto then now() else null end,'slots',slots),old.id) returning * into j;
 insert into public.lab_production_v2_events(job_id,actor_user_id,actor_role,request_id,request_payload,action,version) values(j.id,p_user_id,case when public.lab_production_owner(p_user_id,j.photographer_id) then 'photographer' else 'lab' end,p_request_id,payload,'reprint_created',1);
 return to_jsonb(j)||jsonb_build_object('replayed',false);
end$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('lab-production-v2-files','lab-production-v2-files',false,4000000,array['image/jpeg']) on conflict(id) do nothing;
do $$declare r record;begin
 for r in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and(p.proname like '%lab_production_v2%' or p.proname='protect_lab_production_v2') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.signature);
  if r.proname in('submit_lab_production_v2_order','read_lab_production_v2_receipt','register_lab_production_v2_asset','act_lab_production_v2_job','save_lab_production_v2_crop','reprint_lab_production_v2_job') then execute format('grant execute on function %s to service_role',r.signature);
  elsif r.proname='lab_production_v2_file_reader' then execute format('grant execute on function %s to authenticated,service_role',r.signature);end if;
 end loop;
end$$;
commit;
