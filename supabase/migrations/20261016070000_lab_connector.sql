-- Additive, isolated rehearsal connector. No printer or payment permission exists.
begin;
create table public.lab_connector_pairs (
 id uuid primary key default gen_random_uuid(), created_by uuid not null references auth.users(id),
 target_kind text not null check(target_kind in('in_house','partner_lab')), target_id uuid not null,
 name text not null check(length(name) between 1 and 80), code_hash text not null unique check(code_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '10 minutes', device_id uuid
);
create table public.lab_connector_devices (
 id uuid primary key, created_by uuid not null references auth.users(id), target_kind text not null check(target_kind in('in_house','partner_lab')),
 target_id uuid not null, name text not null, token_hash text not null unique check(token_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '90 days',
 last_seen_at timestamptz, revoked_at timestamptz
);
alter table public.lab_connector_pairs add foreign key(device_id) references public.lab_connector_devices(id);
create table public.lab_connector_dispatches (
 id uuid primary key, job_id uuid not null unique references public.lab_production_v2_jobs(id),
 created_by uuid not null references auth.users(id), request_id uuid not null, expected_version integer not null,
 target_kind text not null check(target_kind in('in_house','partner_lab')), target_id uuid not null,
 manifest jsonb not null, manifest_sha256 text not null check(manifest_sha256~'^[a-f0-9]{64}$'),
 device_id uuid references public.lab_connector_devices(id), state text not null default 'queued' check(state in('queued','claimed','staged_for_review')),
 created_at timestamptz not null default now(), claimed_at timestamptz, staged_at timestamptz, receipt jsonb,
 unique(created_by,request_id), check(manifest->>'testOnly'='true' and manifest->>'printAllowed'='false' and manifest->>'payment'='test_no_payment')
);
create index lab_connector_dispatch_target_idx on public.lab_connector_dispatches(target_kind,target_id,created_at);
create function public.protect_lab_connector_dispatch() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' then raise exception 'CONNECTOR_IMMUTABLE' using errcode='42501';end if;
 if row(new.id,new.job_id,new.created_by,new.request_id,new.expected_version,new.target_kind,new.target_id,new.manifest,new.manifest_sha256,new.created_at) is distinct from row(old.id,old.job_id,old.created_by,old.request_id,old.expected_version,old.target_kind,old.target_id,old.manifest,old.manifest_sha256,old.created_at) or (old.device_id is not null and new.device_id is distinct from old.device_id) or (old.receipt is not null and new.receipt is distinct from old.receipt) then raise exception 'CONNECTOR_IMMUTABLE' using errcode='42501';end if;
 if old.state='staged_for_review' and new is distinct from old then raise exception 'CONNECTOR_IMMUTABLE' using errcode='42501';end if;return new;
end$$;
revoke all on function public.protect_lab_connector_dispatch() from public,anon,authenticated;
create trigger connector_dispatch_immutable before update or delete on public.lab_connector_dispatches for each row execute function public.protect_lab_connector_dispatch();
do $$declare t text;begin foreach t in array array['lab_connector_pairs','lab_connector_devices','lab_connector_dispatches'] loop
 execute format('alter table public.%I enable row level security',t);execute format('alter table public.%I force row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);execute format('grant select on public.%I to service_role',t);
end loop;end$$;

create function public.lab_connector_scope_allowed(p_user_id uuid,p_kind text,p_target uuid) returns boolean language sql stable security definer set search_path='' as $$
select case when p_kind='in_house' then public.lab_production_owner(p_user_id,p_target) when p_kind='partner_lab' then exists(select 1 from public.lab_memberships m where m.user_id=p_user_id and m.lab_id=p_target and m.active and m.role in('owner','operator')) else false end$$;

create function public.create_lab_connector_pair(p_user_id uuid,p_kind text,p_target uuid,p_name text,p_code_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.lab_connector_pairs%rowtype;begin
 if public.lab_connector_scope_allowed(p_user_id,p_kind,p_target) is distinct from true then raise exception 'CONNECTOR_FORBIDDEN' using errcode='42501';end if;
 if p_name is null or length(trim(p_name)) not between 1 and 80 or p_name~'[[:cntrl:]]' or coalesce(p_code_hash,'')!~'^[a-f0-9]{64}$' then raise exception 'CONNECTOR_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('connector:'||p_kind||p_target::text,20261016));
 if (select count(*) from public.lab_connector_devices where target_kind=p_kind and target_id=p_target and revoked_at is null and expires_at>now())>=20 or (select count(*) from public.lab_connector_pairs where target_kind=p_kind and target_id=p_target and device_id is null and expires_at>now())>=5 then raise exception 'CONNECTOR_LIMIT' using errcode='22023';end if;
 insert into public.lab_connector_pairs(created_by,target_kind,target_id,name,code_hash) values(p_user_id,p_kind,p_target,trim(p_name),p_code_hash) returning * into r;return jsonb_build_object('expiresAt',r.expires_at);
end$$;

create function public.pair_lab_connector(p_code_hash text,p_device_id uuid,p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.lab_connector_pairs%rowtype;d public.lab_connector_devices%rowtype;begin
 if coalesce(p_code_hash,'')!~'^[a-f0-9]{64}$' or coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$' or p_device_id is null then raise exception 'CONNECTOR_AUTH' using errcode='42501';end if;
 select * into r from public.lab_connector_pairs where code_hash=p_code_hash for update;
 if not found or r.expires_at<=now() or public.lab_connector_scope_allowed(r.created_by,r.target_kind,r.target_id) is distinct from true then raise exception 'CONNECTOR_AUTH' using errcode='42501';end if;
 if r.device_id is not null then select * into d from public.lab_connector_devices where id=r.device_id;
  if d.id<>p_device_id or d.token_hash<>p_token_hash or d.revoked_at is not null then raise exception 'CONNECTOR_AUTH' using errcode='42501';end if;
 else insert into public.lab_connector_devices(id,created_by,target_kind,target_id,name,token_hash) values(p_device_id,r.created_by,r.target_kind,r.target_id,r.name,p_token_hash) returning * into d;
  update public.lab_connector_pairs set device_id=d.id where id=r.id;
 end if;
 return jsonb_build_object('id',d.id,'name',d.name,'expiresAt',d.expires_at,'testOnly',true,'printAllowed',false);
end$$;

create function public.authorize_lab_connector(p_device_id uuid,p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.lab_connector_devices%rowtype;begin
 select * into d from public.lab_connector_devices where id=p_device_id for update;
 if not found or d.token_hash is distinct from p_token_hash or d.expires_at<=now() or d.revoked_at is not null or public.lab_connector_scope_allowed(d.created_by,d.target_kind,d.target_id) is distinct from true then raise exception 'CONNECTOR_AUTH' using errcode='42501';end if;
 update public.lab_connector_devices set last_seen_at=now() where id=d.id;
 return jsonb_build_object('id',d.id,'targetKind',d.target_kind,'targetId',d.target_id,'createdBy',d.created_by);
end$$;

create function public.revoke_lab_connector(p_user_id uuid,p_device_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.lab_connector_devices%rowtype;begin
 select * into d from public.lab_connector_devices where id=p_device_id for update;
 if not found or public.lab_connector_scope_allowed(p_user_id,d.target_kind,d.target_id) is distinct from true then raise exception 'CONNECTOR_FORBIDDEN' using errcode='42501';end if;
 update public.lab_connector_devices set revoked_at=coalesce(revoked_at,now()) where id=d.id;return jsonb_build_object('revoked',true);
end$$;

create function public.queue_lab_connector_dispatch(p_user_id uuid,p_job_id uuid,p_expected_version integer,p_request_id uuid,p_dispatch_id uuid,p_manifest jsonb,p_manifest_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lab_production_v2_jobs%rowtype;r public.lab_connector_dispatches%rowtype;kind text;target uuid;s jsonb;n integer;sz text;begin
 if p_user_id is null or p_job_id is null or p_expected_version is null or p_expected_version<1 or p_request_id is null or p_dispatch_id is null then raise exception 'CONNECTOR_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('connector-queue:'||p_user_id::text||p_request_id::text,20261016));
 select * into j from public.lab_production_v2_jobs where id=p_job_id for update;
 if not found or public.lab_production_receiver(p_user_id,j.photographer_id,j.lab_id) is distinct from true then raise exception 'CONNECTOR_FORBIDDEN' using errcode='42501';end if;
 select * into r from public.lab_connector_dispatches where created_by=p_user_id and request_id=p_request_id;
 if found then if r.job_id is distinct from p_job_id or r.expected_version is distinct from p_expected_version or r.id is distinct from p_dispatch_id or r.manifest is distinct from p_manifest or r.manifest_sha256 is distinct from p_manifest_sha256 then raise exception 'CONNECTOR_REQUEST_CONFLICT' using errcode='PT409';end if;return jsonb_build_object('id',r.id,'replayed',true);end if;
 if j.version<>p_expected_version then raise exception 'CONNECTOR_VERSION_CONFLICT' using errcode='PT409';end if;
 if j.status<>'in_production' or j.dispatch_state<>'idle' or jsonb_array_length(public.lab_production_v2_holds(j))<>0 then raise exception 'CONNECTOR_HELD' using errcode='PT409';end if;
 kind:=case when j.lab_id is null then 'in_house' else 'partner_lab' end;target:=coalesce(j.lab_id,j.photographer_id);
 if p_manifest is null or jsonb_typeof(p_manifest) is distinct from 'object' or octet_length(p_manifest::text)>50000 or p_manifest->>'jobId' is distinct from j.id::text or p_manifest->>'dispatchId' is distinct from p_dispatch_id::text or p_manifest->>'reference' is distinct from j.reference or p_manifest->'version' is distinct from to_jsonb(j.version) or p_manifest->'testOnly' is distinct from 'true'::jsonb or p_manifest->'printAllowed' is distinct from 'false'::jsonb or p_manifest->>'payment' is distinct from 'test_no_payment' or p_manifest->'schemaVersion' is distinct from '2'::jsonb or coalesce(p_manifest_sha256,'')!~'^[a-f0-9]{64}$' or jsonb_typeof(p_manifest->'sheets') is distinct from 'array' then raise exception 'CONNECTOR_INVALID' using errcode='22023';end if;
 if jsonb_array_length(p_manifest->'sheets')<>2 or p_manifest->'quantity' is distinct from j.snapshot->'quantity' or p_manifest->'densityPpi' is distinct from '300'::jsonb or p_manifest->>'outputProfile' is distinct from 'sRGB' or p_manifest->'finishedPrints' is distinct from to_jsonb((j.snapshot->>'quantity')::integer*3) or p_manifest->'paperSheets' is distinct from to_jsonb((j.snapshot->>'quantity')::integer*2) then raise exception 'CONNECTOR_INVALID' using errcode='22023';end if;
 for n in 0..1 loop s:=p_manifest->'sheets'->n;sz:=case when n=0 then '8x10' else '10x7' end;
  if jsonb_typeof(s) is distinct from 'object' or (select count(*) from jsonb_object_keys(s))<>9 or s->>'size' is distinct from sz or s->>'filename' is distinct from j.reference||'-'||sz||'.jpg' or s->'copies' is distinct from j.snapshot->'quantity' or s->'printsPerSheet' is distinct from to_jsonb(n+1) or s->'widthPixels' is distinct from to_jsonb(case when n=0 then 2400 else 3000 end) or s->'heightPixels' is distinct from to_jsonb(case when n=0 then 3000 else 2100 end) or s->'slots' is distinct from (case when n=0 then '["8x10"]'::jsonb else '["5x7-a","5x7-b"]'::jsonb end) or coalesce(s->>'sha256','')!~'^[a-f0-9]{64}$' or jsonb_typeof(s->'byteSize') is distinct from 'number' then raise exception 'CONNECTOR_INVALID' using errcode='22023';end if;
  if (s->>'byteSize')::numeric not between 1 and 4000000 or (s->>'byteSize')::numeric<>trunc((s->>'byteSize')::numeric) then raise exception 'CONNECTOR_INVALID' using errcode='22023';end if;
 end loop;
 insert into public.lab_connector_dispatches(id,job_id,created_by,request_id,expected_version,target_kind,target_id,manifest,manifest_sha256) values(p_dispatch_id,j.id,p_user_id,p_request_id,p_expected_version,kind,target,p_manifest,p_manifest_sha256) returning * into r;
 update public.lab_production_v2_jobs set dispatch_state='claimed',version=version+1,updated_at=now() where id=j.id;
 insert into public.lab_production_v2_events(job_id,actor_user_id,actor_role,request_id,request_payload,action,version) values(j.id,p_user_id,case when j.lab_id is null then 'photographer' else 'lab' end,p_request_id,jsonb_build_object('dispatchId',r.id),'connector_queued',j.version+1);
 return jsonb_build_object('id',r.id,'replayed',false);
end$$;

create function public.claim_lab_connector_dispatch(p_device_id uuid,p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb;r public.lab_connector_dispatches%rowtype;begin
 d:=public.authorize_lab_connector(p_device_id,p_token_hash);
 select * into r from public.lab_connector_dispatches where device_id=p_device_id and state='claimed' order by created_at limit 1 for update;
 if not found then
  select * into r from public.lab_connector_dispatches where target_kind=d->>'targetKind' and target_id=(d->>'targetId')::uuid and state='queued' order by created_at limit 1 for update skip locked;
  if not found then return null;end if;
  update public.lab_connector_dispatches set device_id=p_device_id,state='claimed',claimed_at=now() where id=r.id returning * into r;
 end if;
 return jsonb_build_object('id',r.id,'manifestSha256',r.manifest_sha256,'reference',r.manifest->>'reference','testOnly',true,'printAllowed',false);
end$$;

create function public.receipt_lab_connector_dispatch(p_device_id uuid,p_token_hash text,p_dispatch_id uuid,p_receipt jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb;r public.lab_connector_dispatches%rowtype;j public.lab_production_v2_jobs%rowtype;expected jsonb;begin
 d:=public.authorize_lab_connector(p_device_id,p_token_hash);
 select * into r from public.lab_connector_dispatches where id=p_dispatch_id for update;
 if not found or r.device_id is distinct from p_device_id or r.state not in('claimed','staged_for_review') or r.target_kind is distinct from d->>'targetKind' or r.target_id is distinct from (d->>'targetId')::uuid then raise exception 'CONNECTOR_FORBIDDEN' using errcode='42501';end if;
 expected:=jsonb_build_object('state','staged_for_review','manifestSha256',r.manifest_sha256,'files',(select jsonb_agg(jsonb_build_object('name',s->>'filename','sha256',s->>'sha256','byteSize',(s->>'byteSize')::integer) order by n) from jsonb_array_elements(r.manifest->'sheets') with ordinality a(s,n)));
 if p_receipt is distinct from expected then raise exception 'CONNECTOR_RECEIPT_INVALID' using errcode='22023';end if;
 if r.state='staged_for_review' then return jsonb_build_object('id',r.id,'state',r.state,'replayed',true);end if;
 select * into j from public.lab_production_v2_jobs where id=r.job_id for update;
 if j.dispatch_state<>'claimed' then raise exception 'CONNECTOR_HELD' using errcode='PT409';end if;
 update public.lab_connector_dispatches set state='staged_for_review',receipt=p_receipt,staged_at=now() where id=r.id;
 update public.lab_production_v2_jobs set dispatch_state='handed_off',version=version+1,updated_at=now() where id=j.id;
 insert into public.lab_production_v2_events(job_id,actor_user_id,actor_role,request_id,request_payload,action,version) values(j.id,null,'policy',gen_random_uuid(),jsonb_build_object('dispatchId',r.id),'connector_staged_test_only',j.version+1);
 return jsonb_build_object('id',r.id,'state','staged_for_review','replayed',false);
end$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('lab-connector-files','lab-connector-files',false,4000000,array['image/jpeg','application/json']);
do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('lab_connector_scope_allowed','create_lab_connector_pair','pair_lab_connector','authorize_lab_connector','revoke_lab_connector','queue_lab_connector_dispatch','claim_lab_connector_dispatch','receipt_lab_connector_dispatch') loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end$$;
commit;
