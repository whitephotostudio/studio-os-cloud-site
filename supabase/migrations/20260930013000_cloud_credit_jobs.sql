-- Durable per-photo platform cloud reservations. Only the authenticated server
-- may reserve, finalize or refund these; clients cannot claim a failed outcome.
begin;
create table if not exists public.credit_cloud_jobs (
  id uuid primary key,
  studio_id uuid not null,
  photographer_id uuid not null references public.photographers(id),
  input_sha256 text not null check(input_sha256 ~ '^[a-f0-9]{64}$'),
  output_key text not null,
  status text not null default 'processing' check(status in ('processing','succeeded','failed')),
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.credit_cloud_jobs enable row level security;
revoke all on public.credit_cloud_jobs from public,anon,authenticated;
grant all on public.credit_cloud_jobs to service_role;
create index if not exists credit_cloud_jobs_studio_created_idx on public.credit_cloud_jobs(studio_id,created_at);

create or replace function public.reserve_cloud_credit_job(
  p_job_id uuid,p_studio_id uuid,p_photographer_id uuid,p_input_sha256 text,p_output_key text,p_token uuid
) returns table(claimed boolean,state text,token uuid,output_key text,lease_expired boolean)
language plpgsql security definer set search_path=public as $$
declare job public.credit_cloud_jobs; adjustment record;
begin
  if p_job_id is null or p_studio_id is null or p_photographer_id is null or p_token is null
      or p_input_sha256 is null or p_input_sha256 !~ '^[a-f0-9]{64}$'
      or nullif(p_output_key,'') is null then raise exception 'Invalid cloud credit job'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_job_id::text,3002));
  select * into job from public.credit_cloud_jobs j where j.id=p_job_id for update;
  if found then
    if job.studio_id<>p_studio_id or job.photographer_id<>p_photographer_id
        or job.input_sha256<>p_input_sha256 or job.output_key<>p_output_key then
      raise exception 'Cloud credit job contents changed'; end if;
    -- Never hand out a second provider execution claim, even after a lease
    -- expires. The server checks deterministic R2 output, or refunds the job.
    return query select false,job.status,job.lease_token,job.output_key,
      job.status='processing' and job.lease_expires_at<=now();
    return;
  end if;
  select * into adjustment from public.apply_credit_adjustment(
    p_studio_id,p_photographer_id,-4,'usage','cloud_processing','Premium cloud background removal',
    null,'cloud:'||p_job_id::text,null,null);
  insert into public.credit_cloud_jobs(id,studio_id,photographer_id,input_sha256,output_key,lease_token,lease_expires_at)
    values(p_job_id,p_studio_id,p_photographer_id,p_input_sha256,p_output_key,p_token,now()+interval '5 minutes');
  return query select true,'processing'::text,p_token,p_output_key,false;
end $$;
revoke all on function public.reserve_cloud_credit_job(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_cloud_credit_job(uuid,uuid,uuid,text,text,uuid) to service_role;

create or replace function public.finish_cloud_credit_job(p_job_id uuid,p_token uuid,p_succeeded boolean,p_error text default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare job public.credit_cloud_jobs; refunded boolean;
begin
  if p_job_id is null or p_token is null or p_succeeded is null then raise exception 'Invalid cloud credit outcome'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_job_id::text,3002));
  select * into job from public.credit_cloud_jobs j where j.id=p_job_id for update;
  if not found or job.lease_token<>p_token then return false; end if;
  if job.status<>'processing' then return job.status=case when p_succeeded then 'succeeded' else 'failed' end; end if;
  if not p_succeeded then
    refunded:=public._refund_credit_reservation(job.studio_id,4,'cloud:'||job.id::text,
      'Premium cloud background removal did not complete','bg_removal_cloud','cloud_gateway_refund','cloud_processing');
    if not refunded then raise exception 'Cloud credit reservation could not be refunded'; end if;
  end if;
  update public.credit_cloud_jobs j set status=case when p_succeeded then 'succeeded' else 'failed' end,
    error=case when p_succeeded then null else left(p_error,500) end,finished_at=now() where j.id=job.id;
  return true;
end $$;
revoke all on function public.finish_cloud_credit_job(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.finish_cloud_credit_job(uuid,uuid,boolean,text) to service_role;
commit;
