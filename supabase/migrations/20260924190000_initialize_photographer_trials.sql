-- Signup creates a placeholder profile. Initialize it exactly once after a
-- verified sign-in, rather than bypassing it because the row already exists.
create or replace function public.initialize_photographer_trial(p_user_id uuid)
returns table (photographer_id uuid, trial_initialized boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user auth.users%rowtype;
  v_profile public.photographers%rowtype;
  v_name text;
  v_start timestamptz;
  v_end timestamptz;
  v_initialized boolean := false;
begin
  -- Also serializes creation when multiple first-visit requests arrive together.
  select * into v_user from auth.users where id = p_user_id for update;
  if not found or v_user.email_confirmed_at is null then
    raise exception 'A confirmed account is required to initialize a trial.';
  end if;

  v_name := coalesce(nullif(btrim(v_user.raw_user_meta_data->>'business_name'), ''),
    nullif(split_part(v_user.email, '@', 1), ''), 'Studio OS Photographer');

  insert into public.photographers (user_id, business_name, billing_email)
  values (p_user_id, v_name, v_user.email)
  on conflict (user_id) do nothing;

  select * into strict v_profile from public.photographers where user_id = p_user_id for update;

  -- Never reset an established trial or rewrite a paid/canceled/owner account.
  if not v_profile.is_platform_admin
     and v_profile.subscription_status = 'trial'
     and v_profile.stripe_subscription_id is null
     and (nullif(btrim(v_profile.subscription_plan_code), '') is null
       or v_profile.trial_starts_at is null or v_profile.trial_ends_at is null) then
    v_start := coalesce(v_profile.trial_starts_at,
      v_profile.trial_ends_at - interval '720 hours', transaction_timestamp());
    v_end := coalesce(v_profile.trial_ends_at, v_start + interval '720 hours');
    update public.photographers set
      subscription_plan_code = coalesce(nullif(btrim(subscription_plan_code), ''), 'studio'),
      trial_starts_at = v_start,
      trial_ends_at = v_end,
      billing_email = coalesce(nullif(btrim(billing_email), ''), v_user.email),
      business_name = case when nullif(btrim(business_name), '') is null
        or business_name = 'My Photography Business' then v_name else business_name end
    where id = v_profile.id;
    v_initialized := true;
  end if;

  return query select v_profile.id, v_initialized;
end;
$$;

revoke all on function public.initialize_photographer_trial(uuid) from public, anon, authenticated;
grant execute on function public.initialize_photographer_trial(uuid) to service_role;

comment on function public.initialize_photographer_trial(uuid) is
  'Service-only, confirmed-user trial initialization; preserves existing expiry, billing, and owner state.';
