-- One-time recovery explicitly approved by the owner on September 24, 2026.
-- Aborts atomically if an account changed or the recovery has already run.
begin;
do $$
declare
  v_ids uuid[] := array[
    'f1394731-8e13-4fd9-9311-dc8a0833ef68',
    '7302e8cc-13d4-4031-8c1d-3a919b608f81',
    'ab69794c-376c-4cb1-8134-bf7a422e8643',
    '18fa795a-958c-4a42-a2cf-a48c7d557be4',
    'c32cb242-801c-4396-bb63-b94fa9d7aa7b'
  ]::uuid[];
  v_id uuid;
  v_profile public.photographers%rowtype;
  v_after jsonb;
  v_key text;
  v_slot integer;
  v_start timestamptz := transaction_timestamp();
  v_end timestamptz := v_start + interval '720 hours';
begin
  foreach v_id in array v_ids loop
    select * into strict v_profile from public.photographers where id = v_id for update;
    if v_profile.is_platform_admin or v_profile.subscription_status <> 'trial'
       or v_profile.stripe_subscription_id is not null
       or v_profile.subscription_plan_code is not null
       or v_profile.trial_starts_at is not null or v_profile.trial_ends_at is not null
       or exists (select 1 from public.photography_keys where photographer_id = v_id)
       or not exists (select 1 from auth.users where id = v_profile.user_id and email_confirmed_at is not null)
       or exists (select 1 from public.audit_log where target_photographer_id = v_id
         and action = 'trial.onboarding_recovery_20260924') then
      raise exception 'Recovery preconditions changed for %. No accounts changed.', v_id;
    end if;

    update public.photographers set subscription_plan_code = 'studio',
      trial_starts_at = v_start, trial_ends_at = v_end where id = v_id;

    for v_slot in 1..2 loop
      v_key := upper(replace(gen_random_uuid()::text, '-', ''));
      insert into public.photography_keys
        (photographer_id,slot_index,label,key_code,status,is_extra_key)
      values (v_id,v_slot,'Photography Key ' || v_slot,
        'SOK-' || substr(v_key,1,4) || '-' || substr(v_key,5,4) || '-' ||
        substr(v_key,25,4) || '-' || substr(v_key,29,4), 'active', false);
    end loop;

    v_after := jsonb_build_object('subscription_plan_code','studio',
      'trial_starts_at',v_start,'trial_ends_at',v_end,'active_key_count',2);
    insert into public.audit_log(action,entity_type,entity_id,target_photographer_id,
      "before","after",metadata,result)
    values ('trial.onboarding_recovery_20260924','photographer',v_id::text,v_id,
      jsonb_build_object('subscription_plan_code',v_profile.subscription_plan_code,
        'trial_starts_at',v_profile.trial_starts_at,'trial_ends_at',v_profile.trial_ends_at,
        'active_key_count',0), v_after,
      jsonb_build_object('reason','Signup trial initialization defect',
        'authorization','Owner approved fresh 30-day trials in Codex on 2026-09-24'), 'ok');
  end loop;
end;
$$;
commit;

select action,count(*) as recovered_accounts,min("after"->>'trial_starts_at') as starts_at,
  min("after"->>'trial_ends_at') as ends_at
from public.audit_log where action = 'trial.onboarding_recovery_20260924' group by action;
