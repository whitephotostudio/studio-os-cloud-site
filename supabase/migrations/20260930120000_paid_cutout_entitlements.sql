-- Managed cutouts require immutable, account-scoped paid-photo proof.
-- Local filenames/manifests and old client-writable usage rows are not proof.
begin;
create table public.credit_cutout_security_epoch (
  singleton boolean primary key default true check(singleton),
  secured_at timestamptz not null default clock_timestamp()
);
insert into public.credit_cutout_security_epoch(singleton) values(true);
create table public.credit_cutout_claims (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  receipt_id uuid not null references public.credit_transactions(id),
  original_sha256 text not null check(original_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(studio_id,receipt_id,original_sha256)
);
create table public.credit_cutout_entitlements (
  claim_id uuid not null references public.credit_cutout_claims(id),
  cutout_sha256 text not null check(cutout_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key(claim_id,cutout_sha256)
);
create table public.credit_cutout_objects (
  object_key text primary key,
  studio_id uuid not null,
  original_sha256 text not null check(original_sha256 ~ '^[a-f0-9]{64}$'),
  cutout_sha256 text not null check(cutout_sha256 ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default now()
);
alter table public.credit_cutout_security_epoch enable row level security;
alter table public.credit_cutout_claims enable row level security;
alter table public.credit_cutout_entitlements enable row level security;
alter table public.credit_cutout_objects enable row level security;
revoke all on public.credit_cutout_security_epoch,public.credit_cutout_claims,
  public.credit_cutout_entitlements,public.credit_cutout_objects from public,anon,authenticated;
grant all on public.credit_cutout_security_epoch,public.credit_cutout_claims,
  public.credit_cutout_entitlements,public.credit_cutout_objects to service_role;
create index credit_cutout_claims_studio_original_idx on public.credit_cutout_claims(studio_id,original_sha256);
create index credit_cutout_entitlements_output_idx on public.credit_cutout_entitlements(cutout_sha256);

create function public._cutout_receipt_capacity(p_receipt_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare receipt public.credit_transactions; owner boolean; paid integer; secured timestamptz;
begin
  select * into receipt from public.credit_transactions where id=p_receipt_id;
  if not found then return 0; end if;
  select is_platform_admin into owner from public.photographers where user_id=receipt.studio_id;
  if exists(select 1 from public.studio_credits where studio_id=receipt.studio_id and credit_debt>0) then return 0; end if;
  if receipt.source='usage' and receipt.ai_operation='bg_removal_local' and receipt.amount=0 and owner then return 2147483647; end if;
  select secured_at into secured from public.credit_cutout_security_epoch where singleton;
  if receipt.source='usage' and receipt.created_at<secured then return 0; end if;
  select coalesce(sum(credits-refunded_credits),0)::integer into paid from public.credit_usage_allocations where transaction_id=receipt.id;
  if receipt.source='usage' and receipt.ai_operation='bg_removal_local' and receipt.amount<0 then return greatest(0,paid); end if;
  if receipt.source='cloud_processing' and receipt.amount=-4 then
    if exists(select 1 from public.credit_cloud_jobs where studio_id=receipt.studio_id
      and 'cloud:'||id::text=receipt.source_reference_id and status='succeeded') then return paid/4; end if;
  end if;
  return 0;
end $$;
revoke all on function public._cutout_receipt_capacity(uuid) from public,anon,authenticated;

create function public._cutout_claim_active(p_claim_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select public._cutout_receipt_capacity(c.receipt_id)>0
    and (select count(*) from public.credit_cutout_claims x where x.receipt_id=c.receipt_id)
      <=public._cutout_receipt_capacity(c.receipt_id)
    from public.credit_cutout_claims c where c.id=p_claim_id),false)
$$;
revoke all on function public._cutout_claim_active(uuid) from public,anon,authenticated;

create function public._has_cutout_entitlement(p_studio_id uuid,p_original_sha256 text,p_cutout_sha256 text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.credit_cutout_entitlements e join public.credit_cutout_claims c on c.id=e.claim_id
    where c.studio_id=p_studio_id and (p_original_sha256 is null or c.original_sha256=p_original_sha256)
    and e.cutout_sha256=p_cutout_sha256 and public._cutout_claim_active(c.id))
$$;
revoke all on function public._has_cutout_entitlement(uuid,text,text) from public,anon,authenticated;

create function public._grant_cutout_entitlement(p_studio_id uuid,p_receipt_id uuid,p_original_sha256 text,p_cutout_sha256 text)
returns boolean language plpgsql security definer set search_path=public as $$
declare claim uuid; capacity integer;
begin
  if p_studio_id is null or p_original_sha256 is null or p_cutout_sha256 is null
    or p_original_sha256!~'^[a-f0-9]{64}$' or p_cutout_sha256!~'^[a-f0-9]{64}$' then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_studio_id::text,3001));
  if not exists(select 1 from public.credit_transactions where id=p_receipt_id and studio_id=p_studio_id) then return false; end if;
  capacity:=public._cutout_receipt_capacity(p_receipt_id);
  if capacity<=0 then return false; end if;
  select id into claim from public.credit_cutout_claims where studio_id=p_studio_id and receipt_id=p_receipt_id and original_sha256=p_original_sha256;
  if found then
    -- A reservation buys one original and one initial output. Arbitrary new
    -- hashes cannot masquerade as free revisions of that same paid photo.
    return public._cutout_claim_active(claim) and exists(select 1 from public.credit_cutout_entitlements where claim_id=claim and cutout_sha256=p_cutout_sha256);
  else
    if (select count(*) from public.credit_cutout_claims where receipt_id=p_receipt_id)>=capacity then return false; end if;
    insert into public.credit_cutout_claims(studio_id,receipt_id,original_sha256) values(p_studio_id,p_receipt_id,p_original_sha256) returning id into claim;
  end if;
  if not public._cutout_claim_active(claim) then return false; end if;
  insert into public.credit_cutout_entitlements(claim_id,cutout_sha256) values(claim,p_cutout_sha256) on conflict do nothing;
  return true;
end $$;
revoke all on function public._grant_cutout_entitlement(uuid,uuid,text,text) from public,anon,authenticated;

create function public.get_studio_cutout_entitlement(p_original_sha256 text,p_cutout_sha256 text)
returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and public._has_cutout_entitlement(auth.uid(),p_original_sha256,p_cutout_sha256)
$$;
revoke all on function public.get_studio_cutout_entitlement(text,text) from public,anon;
grant execute on function public.get_studio_cutout_entitlement(text,text) to authenticated,service_role;

create function public.register_studio_cutout_entitlement(p_original_sha256 text,p_cutout_sha256 text,p_billing_reference text,p_cloud_job_id uuid default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare studio uuid:=auth.uid(); receipt uuid;
begin
  if studio is null then return false; end if;
  if p_cloud_job_id is null then
    select id into receipt from public.credit_transactions where studio_id=studio and source='usage'
      and ai_operation='bg_removal_local' and source_reference_id=p_billing_reference;
  else
    if not exists(select 1 from public.credit_cloud_jobs where id=p_cloud_job_id and studio_id=studio and status='succeeded'
      and original_sha256=p_original_sha256 and output_sha256=p_cutout_sha256) then return false; end if;
    select id into receipt from public.credit_transactions where studio_id=studio and source='cloud_processing'
      and source_reference_id='cloud:'||p_cloud_job_id::text;
  end if;
  if receipt is null then return false; end if;
  return public._grant_cutout_entitlement(studio,receipt,p_original_sha256,p_cutout_sha256);
end $$;
revoke all on function public.register_studio_cutout_entitlement(text,text,text,uuid) from public,anon;
grant execute on function public.register_studio_cutout_entitlement(text,text,text,uuid) to authenticated,service_role;

create function public.register_verified_cutout_revision(p_studio_id uuid,p_original_sha256 text,p_previous_cutout_sha256 text,p_cutout_sha256 text)
returns boolean language plpgsql security definer set search_path=public as $$
declare studio uuid:=p_studio_id; claim uuid;
begin
  if studio is null or p_cutout_sha256 is null or p_cutout_sha256!~'^[a-f0-9]{64}$' then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(studio::text,3001));
  select c.id into claim from public.credit_cutout_claims c join public.credit_cutout_entitlements e on e.claim_id=c.id
    where c.studio_id=studio and (p_original_sha256 is null or c.original_sha256=p_original_sha256)
    and e.cutout_sha256=p_previous_cutout_sha256 and public._cutout_claim_active(c.id) order by c.created_at limit 1;
  if claim is null then return false; end if;
  insert into public.credit_cutout_entitlements(claim_id,cutout_sha256) values(claim,p_cutout_sha256) on conflict do nothing;
  return true;
end $$;
-- The authenticated HTTP route verifies the paid previous PNG bytes and exact
-- decoded RGB equality before invoking this service-only mask revision grant.
revoke all on function public.register_verified_cutout_revision(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.register_verified_cutout_revision(uuid,text,text,text) to service_role;

-- Do not refund a source slot that already authorizes a successful cutout.
create or replace function public.refund_studio_credits(p_amount integer,p_billing_reference text,p_description text default null,p_operation text default null,p_method text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare studio uuid:=auth.uid(); receipt public.credit_transactions; claimed integer;
begin
  if studio is null then raise exception 'Authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(studio::text,3001));
  select * into receipt from public.credit_transactions where studio_id=studio and source='usage' and source_reference_id=p_billing_reference and type='usage';
  if not found then return false; end if;
  select count(*)::integer into claimed from public.credit_cutout_claims where receipt_id=receipt.id;
  if receipt.ai_operation='bg_removal_local' and p_amount>greatest(0,-receipt.amount-claimed) then return false; end if;
  return public._refund_credit_reservation(studio,p_amount,p_billing_reference,p_description,p_operation,p_method,'usage');
end $$;

alter table public.credit_cloud_jobs add column original_sha256 text check(original_sha256 ~ '^[a-f0-9]{64}$');
alter table public.credit_cloud_jobs add column output_sha256 text check(output_sha256 ~ '^[a-f0-9]{64}$');
create function public.bind_cloud_cutout_original(p_job_id uuid,p_token uuid,p_original_sha256 text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_original_sha256 is null or p_original_sha256!~'^[a-f0-9]{64}$' then return false; end if;
  update public.credit_cloud_jobs set original_sha256=p_original_sha256 where id=p_job_id and lease_token=p_token and status<>'failed'
    and (original_sha256 is null or original_sha256=p_original_sha256);
  return found;
end $$;
revoke all on function public.bind_cloud_cutout_original(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.bind_cloud_cutout_original(uuid,uuid,text) to service_role;
create function public.set_cloud_cutout_output(p_job_id uuid,p_token uuid,p_output_sha256 text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_output_sha256 is null or p_output_sha256!~'^[a-f0-9]{64}$' then return false; end if;
  update public.credit_cloud_jobs set output_sha256=p_output_sha256 where id=p_job_id and lease_token=p_token and status<>'failed'
    and (output_sha256 is null or output_sha256=p_output_sha256);
  return found;
end $$;
revoke all on function public.set_cloud_cutout_output(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.set_cloud_cutout_output(uuid,uuid,text) to service_role;

create or replace function public.finish_cloud_credit_job(p_job_id uuid,p_token uuid,p_succeeded boolean,p_error text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare job public.credit_cloud_jobs; refunded boolean; receipt uuid;
begin
  if p_job_id is null or p_token is null or p_succeeded is null then raise exception 'Invalid cloud credit outcome'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_job_id::text,3002));
  select * into job from public.credit_cloud_jobs where id=p_job_id for update;
  if not found or job.lease_token<>p_token then return false; end if;
  if job.status='failed' then return not p_succeeded; end if;
  if job.status='succeeded' and not p_succeeded then return false; end if;
  if not p_succeeded then
    refunded:=public._refund_credit_reservation(job.studio_id,4,'cloud:'||job.id::text,
      'Premium cloud background removal did not complete','bg_removal_cloud','cloud_gateway_refund','cloud_processing');
    if not refunded then raise exception 'Cloud credit reservation could not be refunded'; end if;
  elsif job.original_sha256 is null or job.output_sha256 is null then
    return false;
  end if;
  update public.credit_cloud_jobs set status=case when p_succeeded then 'succeeded' else 'failed' end,
    error=case when p_succeeded then null else left(p_error,500) end,finished_at=coalesce(finished_at,now()) where id=job.id;
  if p_succeeded then
    select id into receipt from public.credit_transactions where studio_id=job.studio_id and source='cloud_processing' and source_reference_id='cloud:'||job.id::text;
    if not public._grant_cutout_entitlement(job.studio_id,receipt,job.original_sha256,job.output_sha256) then raise exception 'Cannot establish paid cloud cutout proof'; end if;
  end if;
  return true;
end $$;

create function public.link_credit_cutout_object(p_studio_id uuid,p_object_key text,p_original_sha256 text,p_cutout_sha256 text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_object_key is null or p_object_key not like 'nobg-photos/%' or not public._has_cutout_entitlement(p_studio_id,p_original_sha256,p_cutout_sha256) then return false; end if;
  if exists(select 1 from public.credit_cutout_objects where object_key=p_object_key and studio_id<>p_studio_id) then return false; end if;
  insert into public.credit_cutout_objects(object_key,studio_id,original_sha256,cutout_sha256) values(p_object_key,p_studio_id,p_original_sha256,p_cutout_sha256)
    on conflict(object_key) do update set original_sha256=excluded.original_sha256,cutout_sha256=excluded.cutout_sha256,updated_at=now();
  return true;
end $$;
revoke all on function public.link_credit_cutout_object(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.link_credit_cutout_object(uuid,text,text,text) to service_role;
create function public.authorized_credit_cutout_keys(p_photographer_id uuid,p_keys text[])
returns table(object_key text,original_sha256 text,cutout_sha256 text) language sql stable security definer set search_path=public as $$
  select o.object_key,o.original_sha256,o.cutout_sha256 from public.credit_cutout_objects o join public.photographers p on p.user_id=o.studio_id
    where p.id=p_photographer_id and o.object_key=any(p_keys) and public._has_cutout_entitlement(o.studio_id,o.original_sha256,o.cutout_sha256)
$$;
revoke all on function public.authorized_credit_cutout_keys(uuid,text[]) from public,anon,authenticated;
grant execute on function public.authorized_credit_cutout_keys(uuid,text[]) to service_role;
create function public.has_studio_cutout_entitlement(p_studio_id uuid,p_original_sha256 text,p_cutout_sha256 text)
returns boolean language sql stable security definer set search_path=public as $$
  select public._has_cutout_entitlement(p_studio_id,p_original_sha256,p_cutout_sha256)
$$;
revoke all on function public.has_studio_cutout_entitlement(uuid,text,text) from public,anon,authenticated;
grant execute on function public.has_studio_cutout_entitlement(uuid,text,text) to service_role;
commit;
