-- Preserve pre-security owner Photoshop reservations whose reference was
-- stored in photo_path before the atomic usage source fields were introduced.
-- This recognizes existing zero-cost server-owner receipts only. It never
-- changes a wallet, receipt, provider job or frozen gallery object binding.
begin;

create function public._is_legacy_owner_cutout_receipt(p_receipt_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.credit_transactions receipt
    join public.photographers owner on owner.user_id=receipt.studio_id
    cross join public.credit_cutout_security_epoch epoch
    where receipt.id=p_receipt_id and owner.is_platform_admin=true
      and epoch.singleton=true and receipt.created_at<epoch.secured_at
      and receipt.type='usage' and receipt.amount=0
      and receipt.ai_operation='bg_removal_local'
      and receipt.processing_method='photoshop_reservation'
      and receipt.source is null
      and receipt.photo_path ~ ('^studio-bg-job:'||receipt.studio_id::text||
        ':[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{64}$')
      and not exists(select 1 from public.studio_credits account
        where account.studio_id=receipt.studio_id and account.credit_debt>0)
      and (select count(*) from public.credit_transactions duplicate
        where duplicate.studio_id=receipt.studio_id and duplicate.photo_path=receipt.photo_path
          and duplicate.type='usage' and duplicate.amount=0 and duplicate.source is null
          and duplicate.ai_operation='bg_removal_local'
          and duplicate.processing_method='photoshop_reservation'
          and duplicate.created_at<epoch.secured_at)=1
  )
$$;
revoke all on function public._is_legacy_owner_cutout_receipt(uuid) from public,anon,authenticated;

create or replace function public._cutout_receipt_capacity(p_receipt_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare receipt public.credit_transactions; owner boolean; paid integer; secured timestamptz;
begin
  select * into receipt from public.credit_transactions where id=p_receipt_id;
  if not found then return 0; end if;
  select is_platform_admin into owner from public.photographers where user_id=receipt.studio_id;
  if exists(select 1 from public.studio_credits where studio_id=receipt.studio_id and credit_debt>0) then return 0; end if;
  if receipt.source='usage' and receipt.ai_operation='bg_removal_local' and receipt.amount=0 and owner then return 2147483647; end if;
  if public._is_legacy_owner_cutout_receipt(p_receipt_id) then return 2147483647; end if;
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

create or replace function public.register_studio_cutout_entitlement(p_original_sha256 text,p_cutout_sha256 text,p_billing_reference text,p_cloud_job_id uuid default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare studio uuid:=auth.uid(); receipt uuid;
begin
  if studio is null then return false; end if;
  if p_cloud_job_id is null then
    -- Keep the modern reference authoritative, including an inactive receipt.
    select id into receipt from public.credit_transactions where studio_id=studio and source='usage'
      and ai_operation='bg_removal_local' and source_reference_id=p_billing_reference;
    if receipt is null then
      select id into receipt from public.credit_transactions
        where studio_id=studio and photo_path=p_billing_reference
          and public._is_legacy_owner_cutout_receipt(id);
    end if;
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

commit;
