begin;

-- Add AU/GB capability without activating new markets during installation.
-- The independently reviewed release updates only the future signup control.
-- Existing signup currencies, creation identities, routes and paid orders are
-- immutable and are deliberately not rewritten by this migration.
lock table public.stripe_standard_signup_release_controls in share row exclusive mode;

alter table public.photographers drop constraint if exists photographers_business_country_check;
alter table public.photographers add constraint photographers_business_country_check
  check (business_country in ('CA','US','AU','GB'));
alter table public.photographer_stripe_accounts drop constraint photographer_stripe_accounts_country_check;
alter table public.photographer_stripe_accounts add constraint photographer_stripe_accounts_country_check
  check (country in ('CA','US','AU','GB'));

alter table public.stripe_standard_signup_release_controls
  drop constraint stripe_standard_signup_release_controls_allowed_countries_check,
  drop constraint stripe_standard_signup_release_control_allowed_currencies_check;
alter table public.stripe_standard_signup_release_controls
  add constraint stripe_standard_signup_release_controls_allowed_countries_check
    check (allowed_countries=array['CA','US']::text[] or allowed_countries=array['CA','US','AU','GB']::text[]),
  add constraint stripe_standard_signup_release_controls_regional_scope_check check (
    (allowed_countries=array['CA','US']::text[] and allowed_currencies=array['cad','usd']::text[]) or
    (allowed_countries=array['CA','US','AU','GB']::text[] and allowed_currencies=array['cad','usd','aud','gbp']::text[]));

alter table public.photographer_stripe_standard_signups
  drop constraint photographer_stripe_standard_signups_country_check,
  drop constraint photographer_stripe_standard_signups_allowed_currencies_check;
alter table public.photographer_stripe_standard_signups
  add constraint photographer_stripe_standard_signups_regional_scope_check check (
    (country in ('CA','US') and allowed_currencies=array['cad','usd']::text[]) or
    (country in ('CA','US','AU','GB') and allowed_currencies=array['cad','usd','aud','gbp']::text[]));

create or replace function public.get_photographer_standard_signup_eligibility(
  p_photographer_id uuid,p_actor_user_id uuid,p_livemode boolean,p_platform_account_id text
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p public.photographers%rowtype; s public.photographer_stripe_standard_signups%rowtype;
  c public.stripe_standard_signup_release_controls%rowtype; reason text;
begin
  select * into strict p from public.photographers where id=p_photographer_id;
  if p_actor_user_id is null or p.user_id is distinct from p_actor_user_id then
    raise exception 'Photographer ownership is required.' using errcode='42501'; end if;
  select * into strict c from public.stripe_standard_signup_release_controls where release_key='standard-signup-v1';
  if p_livemode is null or p_platform_account_id is null or p_platform_account_id !~ '^acct_[A-Za-z0-9]+$' or
    (p_livemode and p_platform_account_id<>c.platform_account_id) or
    (not p_livemode and p_platform_account_id=c.platform_account_id) then
    raise exception 'The exact Stripe platform and payment environment are required.' using errcode='23514'; end if;
  select * into s from public.photographer_stripe_standard_signups where photographer_id=p.id and livemode=p_livemode;
  if s.id is not null then
    if s.actor_user_id<>p_actor_user_id or s.platform_account_id<>p_platform_account_id then
      raise exception 'The Standard signup reservation belongs to another platform or owner.' using errcode='23514'; end if;
    reason:=case when s.status='blocked' then 'blocked'
      when (p.stripe_account_id is not null and p.stripe_account_id is distinct from s.stripe_account_id) or
        (p.stripe_connected_account_id is not null and p.stripe_connected_account_id is distinct from s.stripe_account_id) then 'existing_account'
      when s.stripe_account_id is null and (exists(select 1 from public.photographer_stripe_accounts where photographer_id=p.id) or
        exists(select 1 from public.order_payment_accounts where photographer_id=p.id) or
        exists(select 1 from public.orders where photographer_id=p.id and
          (stripe_checkout_session_id is not null or stripe_payment_intent_id is not null or status='checkout_starting'))) then 'existing_payment_history'
      when s.stripe_account_id is null and exists(select 1 from public.stripe_standard_signup_eligible_profiles e
        where e.photographer_id=p.id and e.livemode=p_livemode and e.revoked_at is not null) then 'eligibility_revoked'
      when s.stripe_account_id is not null then 'resume'
      when not s.country=any(c.allowed_countries) then 'unsupported_business_country'
      when not c.enabled then 'creation_disabled' when s.attempted_at<=now()-interval '23 hours' then 'reconciliation_required' else 'retry' end;
  elsif p.stripe_account_id is not null or p.stripe_connected_account_id is not null then reason:='existing_account';
  elsif p.stripe_account_history_required then reason:='history_required';
  elsif p.stripe_connect_country is not null then reason:='uncertain_legacy_creation';
  elsif p.business_country is not null and not p.business_country=any(c.allowed_countries) then reason:='unsupported_business_country';
  elsif not lower(coalesce(p.billing_currency,'cad'))=any(c.allowed_currencies) then reason:='unsupported_sales_currency';
  elsif p.stripe_standard_migrated_at is not null or p.stripe_connect_route_version<>0 or
    exists(select 1 from public.photographer_stripe_accounts where photographer_id=p.id) or
    exists(select 1 from public.photographer_stripe_standard_intents where photographer_id=p.id) or
    exists(select 1 from public.order_payment_accounts where photographer_id=p.id) or
    exists(select 1 from public.orders where photographer_id=p.id and
      (stripe_checkout_session_id is not null or stripe_payment_intent_id is not null or status='checkout_starting')) then reason:='existing_payment_history';
  elsif (p.created_at is null or p.created_at<c.enrollment_starts_at) and not exists(
    select 1 from public.stripe_standard_signup_eligible_profiles e where e.photographer_id=p.id and e.actor_user_id=p_actor_user_id
      and e.platform_account_id=p_platform_account_id and e.livemode=p_livemode and e.revoked_at is null) then reason:='preexisting_profile';
  elsif not c.enabled then reason:='creation_disabled';
  else reason:='new'; end if;
  return jsonb_build_object('eligible',reason in ('new','retry','resume'),'reason',reason,'creationEnabled',c.enabled,
    'signupIntentId',s.id,'status',s.status,'accountId',s.stripe_account_id,'historyRequired',p.stripe_account_history_required,
    'allowedCountries',c.allowed_countries,'allowedCurrencies',c.allowed_currencies);
end $$;

create or replace function public.reserve_photographer_standard_signup(
  p_photographer_id uuid,p_actor_user_id uuid,p_country text,p_livemode boolean,p_platform_account_id text,
  p_creation_params jsonb,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.photographers%rowtype; s public.photographer_stripe_standard_signups%rowtype;
  eligibility jsonb; signup_id uuid:=gen_random_uuid(); allowed text[];
begin
  select * into strict p from public.photographers where id=p_photographer_id for update;
  -- Serialize an enrollment-control change with the provider-create reservation.
  perform 1 from public.stripe_standard_signup_release_controls where release_key='standard-signup-v1' for share;
  eligibility:=public.get_photographer_standard_signup_eligibility(p.id,p_actor_user_id,p_livemode,p_platform_account_id);
  if eligibility->>'eligible'<>'true' then
    raise exception 'Standard signup is unavailable: %.',eligibility->>'reason' using errcode='23514'; end if;
  if p_country is null or p_country not in ('CA','US','AU','GB') or coalesce(p.business_country,p.stripe_connect_country) is distinct from p_country then
    raise exception 'Business country must match the photographer profile.' using errcode='23514'; end if;
  select * into s from public.photographer_stripe_standard_signups where photographer_id=p.id and livemode=p_livemode for update;
  if s.id is not null then
    if s.country<>p_country then raise exception 'The original Standard signup country is immutable.' using errcode='23514'; end if;
    return to_jsonb(s);
  end if;
  if not p_country=any(array(select jsonb_array_elements_text(eligibility->'allowedCountries'))) then
    raise exception 'This business country is not enabled for new Standard connections.' using errcode='23514'; end if;
  allowed:=array(select jsonb_array_elements_text(eligibility->'allowedCurrencies'));
  if jsonb_typeof(p_creation_params) is distinct from 'object' or p_request_hash is null or
    p_creation_params->>'type' is distinct from 'standard' or p_creation_params->>'country' is distinct from p_country or
    p_creation_params->>'metadata[photographer_id]' is distinct from p.id::text or
    p_creation_params->>'metadata[user_id]' is distinct from p_actor_user_id::text or
    p_creation_params->>'capabilities[card_payments][requested]' is distinct from 'true' or
    p_creation_params->>'capabilities[transfers][requested]' is distinct from 'true' or
    exists(select 1 from jsonb_each(p_creation_params) where jsonb_typeof(value)<>'string' or
      key not in ('type','country','email','business_profile[name]','metadata[photographer_id]','metadata[user_id]',
        'capabilities[card_payments][requested]','capabilities[transfers][requested]')) or
    public.stripe_standard_signup_params_hash(p_creation_params) is distinct from p_request_hash then
    raise exception 'Invalid frozen Standard creation parameters or request hash.' using errcode='23514'; end if;
  insert into public.photographer_stripe_standard_signups(id,photographer_id,actor_user_id,platform_account_id,livemode,country,
    creation_params,request_hash,provider_request_hash,idempotency_key,allowed_currencies)
  values(signup_id,p.id,p_actor_user_id,p_platform_account_id,p_livemode,p_country,p_creation_params,p_request_hash,
    public.stripe_standard_signup_params_hash(p_creation_params||jsonb_build_object('metadata[standard_signup_id]',signup_id::text)),
    'studio-os-standard-signup-'||signup_id::text,allowed) returning * into s;
  update public.photographers set stripe_account_history_required=true,stripe_connect_country=p_country where id=p.id;
  return to_jsonb(s);
end $$;

create or replace function public.configure_photographer_payment_profile(
  p_photographer_id uuid, p_business_country text, p_sales_currency text,
  p_currency_explicit boolean, p_reserve_connect boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.photographers%rowtype; chosen text; sales text; allowed text[]; s public.photographer_stripe_standard_signups%rowtype;
  c public.stripe_standard_signup_release_controls%rowtype;
begin
  select * into strict p from public.photographers where id=p_photographer_id for update;
  if p_business_country is not null and p_business_country not in ('CA','US','AU','GB') then
    raise exception 'Choose Canada, the United States, Australia or the United Kingdom as your business country.' using errcode='23514';
  end if;
  if p_sales_currency is not null and p_sales_currency not in ('usd','cad','eur','gbp','aud','aed','sar','amd') then
    raise exception 'Choose a supported sales currency.' using errcode='23514';
  end if;
  if p_reserve_connect and p.stripe_account_id is null and p.stripe_connected_account_id is null and (
    p.stripe_account_history_required or exists(select 1 from public.photographer_stripe_standard_signups where photographer_id=p.id) or
    exists(select 1 from public.stripe_standard_signup_eligible_profiles where photographer_id=p.id and revoked_at is null) or
    (p.stripe_connect_country is null and exists(select 1 from public.stripe_standard_signup_release_controls
      where release_key='standard-signup-v1' and enabled and p.created_at>=enrollment_starts_at))) then
    raise exception 'Resume the reserved Standard signup; an Express account cannot be created.' using errcode='23514'; end if;
  chosen:=coalesce(p_business_country,p.business_country,p.stripe_connect_country);
  if chosen is not null and chosen not in ('CA','US','AU','GB') then
    raise exception 'Contact Studio OS support to review this Stripe account country.' using errcode='23514';
  end if;
  if p.stripe_connect_country is not null and chosen is distinct from p.stripe_connect_country then
    raise exception 'The business country is locked to your Stripe account. Contact Studio OS support before changing it.' using errcode='23514';
  end if;
  select * into strict c from public.stripe_standard_signup_release_controls where release_key='standard-signup-v1';
  select * into s from public.photographer_stripe_standard_signups where photographer_id=p.id;
  if chosen in ('AU','GB') and s.id is null and not chosen=any(c.allowed_countries) then
    raise exception 'This business country is not enabled for new Standard connections.' using errcode='23514'; end if;
  if p_reserve_connect and chosen in ('AU','GB') then
    raise exception 'Resume the reserved Standard signup; an Express account cannot be created.' using errcode='23514'; end if;
  if p_reserve_connect and chosen is null then
    raise exception 'Choose your business country before connecting Stripe.' using errcode='23514';
  end if;
  sales:=p.billing_currency;
  if p_currency_explicit then
    if p_sales_currency is null then raise exception 'Choose a supported sales currency.' using errcode='23514'; end if;
    sales:=p_sales_currency;
  elsif not p.sales_currency_configured and chosen is not null then
    sales:=case chosen when 'US' then 'usd' when 'AU' then 'aud' when 'GB' then 'gbp' else 'cad' end;
  end if;
  allowed:=coalesce(s.allowed_currencies,c.allowed_currencies);
  if (p.stripe_account_history_required or exists(select 1 from public.photographer_stripe_standard_signups where photographer_id=p.id) or
    exists(select 1 from public.stripe_standard_signup_eligible_profiles where photographer_id=p.id and revoked_at is null)) and
    not lower(coalesce(sales,'cad'))=any(allowed) then
    raise exception 'Choose a sales currency supported by your saved Standard connection.' using errcode='23514'; end if;
  update public.photographers set business_country=chosen,
    stripe_connect_country=case when p_reserve_connect then chosen else p.stripe_connect_country end,
    billing_currency=coalesce(sales,'cad'),
    sales_currency_configured=p.sales_currency_configured or p_currency_explicit
    where id=p.id;
  return jsonb_build_object('businessCountry',chosen,'businessCountryLocked',p_reserve_connect or p.stripe_connect_country is not null,
    'salesCurrency',coalesce(sales,'cad'),'salesCurrencyConfigured',p.sales_currency_configured or p_currency_explicit);
end $$;

create or replace function public.sync_photographer_connect_state(
  p_photographer_id uuid, p_account_id text, p_country text,
  p_details_submitted boolean, p_charges_enabled boolean, p_payouts_enabled boolean
) returns void language plpgsql security definer set search_path = public as $$
declare p public.photographers%rowtype;
begin
  if p_country is null or p_country !~ '^[A-Z]{2}$' then
    raise exception 'Unable to verify the Stripe account business country.' using errcode='23514';
  end if;
  select * into strict p from public.photographers where id=p_photographer_id for update;
  if coalesce(p.business_country,p.stripe_connect_country,p_country) <> p_country
    or (p.stripe_connect_country is not null and p.stripe_connect_country<>p_country) then
    raise exception 'The Stripe account country does not match your studio. Contact Studio OS support before continuing.' using errcode='23514';
  end if;
  if (p.stripe_connected_account_id is not null and p.stripe_connected_account_id<>p_account_id)
    or (p.stripe_account_id is not null and p.stripe_account_id<>p_account_id) then
    raise exception 'The Stripe account does not match this studio.' using errcode='23514';
  end if;
  update public.photographers set stripe_account_id=p_account_id,stripe_connected_account_id=p_account_id,
    stripe_connect_country=p_country,
    business_country=case when p_country in ('CA','US','AU','GB') then coalesce(p.business_country,p_country) else p.business_country end,
    stripe_connect_onboarding_complete=p_details_submitted and p_charges_enabled and p_payouts_enabled,
    stripe_connect_charges_enabled=p_charges_enabled,stripe_connect_payouts_enabled=p_payouts_enabled
    where id=p.id;
end $$;

create or replace function public.stripe_standard_signup_schema_status() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('version','20261016010000',
    'regional_markets_present',(select count(*)=5 and bool_and(c.convalidated and position('AU' in pg_get_constraintdef(c.oid))>0
      and position('GB' in pg_get_constraintdef(c.oid))>0) from pg_constraint c where
      (c.conrelid='public.photographers'::regclass and c.conname='photographers_business_country_check') or
      (c.conrelid='public.photographer_stripe_accounts'::regclass and c.conname='photographer_stripe_accounts_country_check') or
      (c.conrelid='public.photographer_stripe_standard_signups'::regclass and c.conname='photographer_stripe_standard_signups_regional_scope_check') or
      (c.conrelid='public.stripe_standard_signup_release_controls'::regclass and c.conname in
        ('stripe_standard_signup_release_controls_allowed_countries_check','stripe_standard_signup_release_controls_regional_scope_check'))),
    'service_only_tables',(select count(*)=3 and bool_and(c.relrowsecurity and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
      and has_table_privilege('service_role',c.oid,'SELECT') and has_table_privilege('service_role',c.oid,'UPDATE'))
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in
        ('photographer_stripe_standard_signups','stripe_standard_signup_release_controls','stripe_standard_signup_eligible_profiles')),
    'signup_schema_present',to_regclass('public.photographer_stripe_standard_signups') is not null
      and to_regclass('public.stripe_standard_signup_release_controls') is not null
      and to_regclass('public.stripe_standard_signup_eligible_profiles') is not null
      and (select count(*)=3 and bool_and(c.relrowsecurity and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
        and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
        and has_table_privilege('service_role',c.oid,'SELECT') and has_table_privilege('service_role',c.oid,'UPDATE')) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname in ('photographer_stripe_standard_signups','stripe_standard_signup_release_controls','stripe_standard_signup_eligible_profiles'))
      and exists(select 1 from information_schema.columns where table_schema='public' and table_name='photographers'
        and column_name='stripe_account_history_required' and data_type='boolean' and is_nullable='NO'),
    'history_required_guard_present',exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid where
      t.tgrelid='public.photographers'::regclass and t.tgname='protect_photographer_stripe_history_required' and t.tgenabled in ('O','A')
      and p.proname='protect_photographer_stripe_history_required') and exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='resolve_order_payment_account' and position('stripe_account_history_required' in pg_get_functiondef(p.oid))>0),
    'legacy_creation_barrier_present',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='configure_photographer_payment_profile'
        and position('photographer_stripe_standard_signups' in pg_get_functiondef(p.oid))>0
        and position('stripe_standard_signup_eligible_profiles' in pg_get_functiondef(p.oid))>0),
    'service_only_rpcs',(select count(*)=6 and bool_and(not has_function_privilege('anon',p.oid,'EXECUTE')
        and not has_function_privilege('authenticated',p.oid,'EXECUTE') and has_function_privilege('service_role',p.oid,'EXECUTE'))
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
        ('stripe_standard_signup_schema_status','stripe_standard_signup_params_hash','get_photographer_standard_signup_eligibility',
         'reserve_photographer_standard_signup','record_photographer_standard_signup_account','activate_photographer_standard_signup')));
$$;

-- CREATE OR REPLACE retains existing service-only grants. Explicitly pin every
-- updated endpoint so this additive release cannot expose payment mutations.
revoke all on function public.get_photographer_standard_signup_eligibility(uuid,uuid,boolean,text),
  public.reserve_photographer_standard_signup(uuid,uuid,text,boolean,text,jsonb,text),
  public.configure_photographer_payment_profile(uuid,text,text,boolean,boolean),
  public.sync_photographer_connect_state(uuid,text,text,boolean,boolean,boolean),
  public.stripe_standard_signup_schema_status() from public,anon,authenticated;
grant execute on function public.get_photographer_standard_signup_eligibility(uuid,uuid,boolean,text),
  public.reserve_photographer_standard_signup(uuid,uuid,text,boolean,text,jsonb,text),
  public.configure_photographer_payment_profile(uuid,text,text,boolean,boolean),
  public.sync_photographer_connect_state(uuid,text,text,boolean,boolean,boolean),
  public.stripe_standard_signup_schema_status() to service_role;

commit;
