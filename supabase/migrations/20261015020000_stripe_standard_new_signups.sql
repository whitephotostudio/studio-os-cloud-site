-- New Standard signups are distinct from the completed WhitePhoto migration.
-- Additive installation keeps creation disabled. Existing routes remain valid
-- independently of this creation switch.
alter table public.photographers add column stripe_account_history_required boolean not null default false;

create table public.stripe_standard_signup_release_controls (
  release_key text primary key check(release_key='standard-signup-v1'),
  platform_account_id text not null default 'acct_1TBlT4PxlnWeytFA' check(platform_account_id='acct_1TBlT4PxlnWeytFA'),
  project_ref text not null default 'bwqhzczxoevouiondjak' check(project_ref='bwqhzczxoevouiondjak'),
  enabled boolean not null default false,
  enrollment_starts_at timestamptz not null default now(),
  allowed_countries text[] not null default array['CA','US']::text[] check(allowed_countries=array['CA','US']::text[]),
  allowed_currencies text[] not null default array['cad','usd']::text[] check(allowed_currencies=array['cad','usd']::text[])
);
insert into public.stripe_standard_signup_release_controls(release_key) values('standard-signup-v1');
alter table public.stripe_standard_signup_release_controls enable row level security;
revoke all on public.stripe_standard_signup_release_controls from public,anon,authenticated;
grant select,update on public.stripe_standard_signup_release_controls to service_role;

-- Older unlinked profiles require an explicit complete provider-inventory
-- audit. A null local pointer alone never proves that Express was not created.
create table public.stripe_standard_signup_eligible_profiles (
  photographer_id uuid not null references public.photographers(id) on delete restrict,
  actor_user_id uuid not null,
  platform_account_id text not null check(platform_account_id ~ '^acct_[A-Za-z0-9]+$'),
  livemode boolean not null,
  audit_source text not null check(audit_source='verified_stripe_account_inventory'),
  provider_inventory_sha256 text not null check(provider_inventory_sha256 ~ '^[a-f0-9]{64}$'),
  provider_verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key(photographer_id,livemode),
  check(provider_verified_at<=created_at+interval '30 seconds' and provider_verified_at>=created_at-interval '5 minutes'),
  check(not livemode or platform_account_id='acct_1TBlT4PxlnWeytFA')
);
alter table public.stripe_standard_signup_eligible_profiles enable row level security;
revoke all on public.stripe_standard_signup_eligible_profiles from public,anon,authenticated;
grant select,insert,update on public.stripe_standard_signup_eligible_profiles to service_role;
create function public.protect_standard_signup_eligibility() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare p public.photographers%rowtype;
begin
  if tg_op='INSERT' then
    select * into strict p from public.photographers where id=new.photographer_id for update;
    if p.user_id is distinct from new.actor_user_id or p.stripe_account_id is not null or p.stripe_connected_account_id is not null or
      p.stripe_connect_country is not null or p.stripe_account_history_required or p.stripe_standard_migrated_at is not null or p.stripe_connect_route_version<>0 or
      new.created_at>now() or new.created_at<now()-interval '5 minutes' or
      exists(select 1 from public.photographer_stripe_accounts where photographer_id=p.id) or
      exists(select 1 from public.photographer_stripe_standard_intents where photographer_id=p.id) or
      exists(select 1 from public.order_payment_accounts where photographer_id=p.id) or
      exists(select 1 from public.orders where photographer_id=p.id and
        (stripe_checkout_session_id is not null or stripe_payment_intent_id is not null or status='checkout_starting')) then
      raise exception 'Only an explicitly audited fresh unlinked profile may join Standard signup eligibility.' using errcode='23514'; end if;
    return new;
  end if;
  if tg_op='DELETE' then raise exception 'A Standard signup eligibility audit cannot be deleted.' using errcode='23514'; end if;
  if (to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at') or
    (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'The Standard signup eligibility audit is immutable.' using errcode='23514'; end if;
  return new;
end $$;
create trigger protect_standard_signup_eligibility before insert or update or delete on public.stripe_standard_signup_eligible_profiles
  for each row execute function public.protect_standard_signup_eligibility();

create table public.photographer_stripe_standard_signups (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete restrict,
  actor_user_id uuid not null,
  platform_account_id text not null check(platform_account_id ~ '^acct_[A-Za-z0-9]+$'),
  livemode boolean not null,
  country text not null check(country in ('CA','US')),
  status text not null default 'creating' check(status in ('creating','registered','activated','blocked')),
  stripe_account_id text,
  creation_params jsonb not null,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  provider_request_hash text not null check(provider_request_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null unique,
  allowed_currencies text[] not null check(allowed_currencies=array['cad','usd']::text[]),
  attempted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(photographer_id,livemode),
  unique(stripe_account_id,livemode),
  check(stripe_account_id is null or stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  check(status not in ('registered','activated') or stripe_account_id is not null)
);
alter table public.photographer_stripe_standard_signups enable row level security;
revoke all on public.photographer_stripe_standard_signups from public,anon,authenticated;
grant select,insert,update on public.photographer_stripe_standard_signups to service_role;

create function public.protect_photographer_stripe_history_required() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if current_user in ('anon','authenticated') then
    if tg_op='INSERT' then new.created_at:=now();
    elsif new.created_at is distinct from old.created_at then
      raise exception 'The photographer enrollment date is managed by Studio OS.' using errcode='42501'; end if;
  end if;
  if tg_op='UPDATE' and old.stripe_account_history_required and not new.stripe_account_history_required then
    raise exception 'The Stripe account history requirement cannot be erased.' using errcode='23514';
  end if;
  if current_user not in ('postgres','supabase_admin','service_role') and
    ((tg_op='INSERT' and new.stripe_account_history_required) or
     (tg_op='UPDATE' and new.stripe_account_history_required is distinct from old.stripe_account_history_required)) then
    raise exception 'Stripe account history is managed by Studio OS.' using errcode='42501';
  end if;
  return new;
end $$;
create trigger protect_photographer_stripe_history_required before insert or update on public.photographers
  for each row execute function public.protect_photographer_stripe_history_required();

create function public.protect_photographer_standard_signup() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'A Standard signup reservation cannot be deleted.' using errcode='23514'; end if;
  if new.id is distinct from old.id or new.photographer_id is distinct from old.photographer_id or
    new.actor_user_id is distinct from old.actor_user_id or new.platform_account_id is distinct from old.platform_account_id or
    new.livemode is distinct from old.livemode or new.country is distinct from old.country or
    new.creation_params is distinct from old.creation_params or new.request_hash is distinct from old.request_hash or
    new.provider_request_hash is distinct from old.provider_request_hash or new.idempotency_key is distinct from old.idempotency_key or
    new.allowed_currencies is distinct from old.allowed_currencies or new.attempted_at is distinct from old.attempted_at or
    new.created_at is distinct from old.created_at or
    (old.stripe_account_id is not null and new.stripe_account_id is distinct from old.stripe_account_id) or
    (old.activated_at is not null and new.activated_at is distinct from old.activated_at) or
    (old.status='blocked' and new.status<>'blocked') or
    (old.status='activated' and new.status not in ('activated','blocked')) then
    raise exception 'The Standard signup identity and original request are immutable.' using errcode='23514';
  end if;
  return new;
end $$;
create trigger protect_photographer_standard_signup before update or delete on public.photographer_stripe_standard_signups
  for each row execute function public.protect_photographer_standard_signup();

-- The request is a flat map of strings with a small ASCII-only key allowlist.
-- This matches JSON.stringify of sorted entries without JSONB's display spaces.
create function public.stripe_standard_signup_params_hash(p_params jsonb) returns text
language sql immutable strict set search_path=public,pg_temp as $$
  select encode(sha256(convert_to('{'||coalesce(string_agg(to_jsonb(key)::text||':'||value::text,',' order by key collate "C"),'')||'}','UTF8')),'hex')
  from jsonb_each(p_params);
$$;

create function public.get_photographer_standard_signup_eligibility(
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
      when not c.enabled then 'creation_disabled' when s.attempted_at<=now()-interval '23 hours' then 'reconciliation_required' else 'retry' end;
  elsif p.stripe_account_id is not null or p.stripe_connected_account_id is not null then reason:='existing_account';
  elsif p.stripe_account_history_required then reason:='history_required';
  elsif p.stripe_connect_country is not null then reason:='uncertain_legacy_creation';
  elsif lower(coalesce(p.billing_currency,'cad')) not in ('cad','usd') then reason:='unsupported_sales_currency';
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

create function public.reserve_photographer_standard_signup(
  p_photographer_id uuid,p_actor_user_id uuid,p_country text,p_livemode boolean,p_platform_account_id text,
  p_creation_params jsonb,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.photographers%rowtype; s public.photographer_stripe_standard_signups%rowtype;
  eligibility jsonb; signup_id uuid:=gen_random_uuid();
begin
  select * into strict p from public.photographers where id=p_photographer_id for update;
  eligibility:=public.get_photographer_standard_signup_eligibility(p.id,p_actor_user_id,p_livemode,p_platform_account_id);
  if eligibility->>'eligible'<>'true' then
    raise exception 'Standard signup is unavailable: %.',eligibility->>'reason' using errcode='23514'; end if;
  if p_country is null or p_country not in ('CA','US') or coalesce(p.business_country,p.stripe_connect_country) is distinct from p_country then
    raise exception 'Business country must match the photographer profile.' using errcode='23514'; end if;
  select * into s from public.photographer_stripe_standard_signups where photographer_id=p.id and livemode=p_livemode for update;
  if s.id is not null then
    if s.country<>p_country then raise exception 'The original Standard signup country is immutable.' using errcode='23514'; end if;
    return to_jsonb(s);
  end if;
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
    'studio-os-standard-signup-'||signup_id::text,array['cad','usd']::text[]) returning * into s;
  update public.photographers set stripe_account_history_required=true,stripe_connect_country=p_country where id=p.id;
  return to_jsonb(s);
end $$;

create function public.record_photographer_standard_signup_account(
  p_signup_id uuid,p_actor_user_id uuid,p_account jsonb,p_platform_account_id text,p_livemode boolean,p_provider_verified_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.photographer_stripe_standard_signups%rowtype; p public.photographers%rowtype;
  r public.photographer_stripe_accounts%rowtype; aid text:=p_account->>'id'; target_status text;
begin
  select * into strict s from public.photographer_stripe_standard_signups where id=p_signup_id;
  if aid is null or aid !~ '^acct_[A-Za-z0-9]+$' then
    raise exception 'The Standard account identity is required.' using errcode='23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended('studio-os-standard-signup:'||aid||':'||p_livemode::text,0));
  select * into strict p from public.photographers where id=s.photographer_id for update;
  select * into strict s from public.photographer_stripe_standard_signups where id=p_signup_id for update;
  if p_actor_user_id is null or p.user_id is distinct from p_actor_user_id or s.actor_user_id<>p_actor_user_id then
    raise exception 'Photographer ownership is required.' using errcode='42501'; end if;
  if s.status='blocked' or not p.stripe_account_history_required or s.platform_account_id is distinct from p_platform_account_id or
    s.livemode is distinct from p_livemode or p_provider_verified_at is null or
    p_provider_verified_at>now()+interval '30 seconds' or p_provider_verified_at<now()-interval '5 minutes' or
    aid is null or aid !~ '^acct_[A-Za-z0-9]+$' or aid=p_platform_account_id or p_account->>'type' is distinct from 'standard' or
    upper(p_account->>'country') is distinct from s.country or coalesce(p.business_country,p.stripe_connect_country) is distinct from s.country or
    (p_account ? 'livemode' and p_account->>'livemode' is distinct from p_livemode::text) or
    p_account#>>'{metadata,photographer_id}' is distinct from s.photographer_id::text or
    p_account#>>'{metadata,user_id}' is distinct from p_actor_user_id::text or
    p_account#>>'{metadata,standard_signup_id}' is distinct from s.id::text or
    p_account#>>'{controller,fees,payer}' is distinct from 'account' or
    p_account#>>'{controller,losses,payments}' is distinct from 'stripe' or
    p_account#>>'{controller,requirement_collection}' is distinct from 'stripe' or
    p_account#>>'{controller,stripe_dashboard,type}' is distinct from 'full' then
    raise exception 'Fresh owned Standard account and original signup proof are required.' using errcode='23514'; end if;
  if (s.stripe_account_id is not null and s.stripe_account_id<>aid) or
    (p.stripe_account_id is not null and p.stripe_account_id<>aid) or
    (p.stripe_connected_account_id is not null and p.stripe_connected_account_id<>aid) or
    exists(select 1 from public.photographer_stripe_accounts where stripe_account_id=aid and (photographer_id<>p.id or livemode<>p_livemode)) or
    exists(select 1 from public.stripe_merchant_events where stripe_account_id=aid and livemode=p_livemode and event_type='account.application.deauthorized') then
    raise exception 'The original signup account is immutable, foreign or deauthorized.' using errcode='23514'; end if;
  select * into r from public.photographer_stripe_accounts where photographer_id=p.id and stripe_account_id=aid and livemode=p_livemode for update;
  if r.deauthorized_at is not null or r.status='blocked' then raise exception 'The Standard account was deauthorized.' using errcode='23514'; end if;
  target_status:=case when s.status='activated' then 'active' when public.stripe_standard_account_ready(p_account) then 'ready' else 'pending' end;
  insert into public.photographer_stripe_accounts(photographer_id,stripe_account_id,livemode,account_type,status,country,
    controller,capabilities,requirements,future_requirements,details_submitted,charges_enabled,payouts_enabled,verified_at)
  values(p.id,aid,p_livemode,'standard',target_status,s.country,p_account->'controller',coalesce(p_account->'capabilities','{}'),
    coalesce(p_account->'requirements','{}'),coalesce(p_account->'future_requirements','{}'),
    coalesce((p_account->>'details_submitted')::boolean,false),coalesce((p_account->>'charges_enabled')::boolean,false),
    coalesce((p_account->>'payouts_enabled')::boolean,false),p_provider_verified_at)
  on conflict(stripe_account_id,livemode) do update set status=excluded.status,controller=excluded.controller,capabilities=excluded.capabilities,
    requirements=excluded.requirements,future_requirements=excluded.future_requirements,details_submitted=excluded.details_submitted,
    charges_enabled=excluded.charges_enabled,payouts_enabled=excluded.payouts_enabled,verified_at=excluded.verified_at;
  update public.photographer_stripe_standard_signups set stripe_account_id=coalesce(stripe_account_id,aid),
    status=case when status='activated' then status else 'registered' end,updated_at=now() where id=s.id returning * into s;
  return to_jsonb(s);
end $$;

create function public.activate_photographer_standard_signup(
  p_signup_id uuid,p_actor_user_id uuid,p_account jsonb,p_platform_account_id text,p_livemode boolean,p_provider_verified_at timestamptz
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.photographer_stripe_standard_signups%rowtype; p public.photographers%rowtype;
begin
  perform public.record_photographer_standard_signup_account(p_signup_id,p_actor_user_id,p_account,p_platform_account_id,p_livemode,p_provider_verified_at);
  select * into strict s from public.photographer_stripe_standard_signups where id=p_signup_id for update;
  select * into strict p from public.photographers where id=s.photographer_id for update;
  if not public.stripe_standard_account_ready(p_account) then
    raise exception 'Stripe verification and payment/payout activation must finish first.' using errcode='23514'; end if;
  if s.status='activated' then
    if p.stripe_account_id<>s.stripe_account_id or p.stripe_connected_account_id<>s.stripe_account_id or p.stripe_connect_route_version<>1 then
      raise exception 'The original Standard signup route changed.' using errcode='23514'; end if;
    return jsonb_build_object('accountId',s.stripe_account_id,'previousAccountId',null,'routeVersion',1,'signupIntentId',s.id);
  end if;
  if p.stripe_account_id is not null or p.stripe_connected_account_id is not null or p.stripe_standard_migrated_at is not null or
    p.stripe_connect_route_version<>0 or exists(select 1 from public.photographer_stripe_accounts where photographer_id=p.id and stripe_account_id<>s.stripe_account_id) or
    exists(select 1 from public.order_payment_accounts where photographer_id=p.id) or
    exists(select 1 from public.orders where photographer_id=p.id and
      (stripe_checkout_session_id is not null or stripe_payment_intent_id is not null or status='checkout_starting')) then
    raise exception 'Only the first account of a new photographer can be activated here.' using errcode='23514'; end if;
  update public.photographer_stripe_accounts set status='active',activated_at=now()
    where photographer_id=p.id and stripe_account_id=s.stripe_account_id and livemode=s.livemode;
  update public.photographers set stripe_account_id=s.stripe_account_id,stripe_connected_account_id=s.stripe_account_id,
    stripe_connect_route_version=1,stripe_connect_country=s.country,stripe_connect_onboarding_complete=true,
    stripe_connect_charges_enabled=true,stripe_connect_payouts_enabled=true where id=p.id;
  update public.photographer_stripe_standard_signups set status='activated',activated_at=now(),updated_at=now() where id=s.id;
  return jsonb_build_object('accountId',s.stripe_account_id,'previousAccountId',null,'routeVersion',1,'signupIntentId',s.id);
end $$;

-- Preserve the existing implementations; add only the distinct signup guards.
create or replace function public.configure_photographer_payment_profile(
  p_photographer_id uuid, p_business_country text, p_sales_currency text,
  p_currency_explicit boolean, p_reserve_connect boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.photographers%rowtype; chosen text; sales text;
begin
  select * into strict p from public.photographers where id=p_photographer_id for update;
  if p_business_country is not null and p_business_country not in ('CA','US') then
    raise exception 'Choose Canada or the United States as your business country.' using errcode='23514';
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
  if chosen is not null and chosen not in ('CA','US') then
    raise exception 'Contact Studio OS support to review this Stripe account country.' using errcode='23514';
  end if;
  if p.stripe_connect_country is not null and chosen is distinct from p.stripe_connect_country then
    raise exception 'The business country is locked to your Stripe account. Contact Studio OS support before changing it.' using errcode='23514';
  end if;
  if p_reserve_connect and chosen is null then
    raise exception 'Choose your business country before connecting Stripe.' using errcode='23514';
  end if;
  sales:=p.billing_currency;
  if p_currency_explicit then
    if p_sales_currency is null then raise exception 'Choose a supported sales currency.' using errcode='23514'; end if;
    sales:=p_sales_currency;
  elsif not p.sales_currency_configured and chosen is not null then
    sales:=case when chosen='US' then 'usd' else 'cad' end;
  end if;
  if (p.stripe_account_history_required or exists(select 1 from public.photographer_stripe_standard_signups where photographer_id=p.id) or
    exists(select 1 from public.stripe_standard_signup_eligible_profiles where photographer_id=p.id and revoked_at is null)) and
    lower(coalesce(sales,'cad')) not in ('cad','usd') then
    raise exception 'New Standard accounts currently support Canadian dollars or US dollars for sales.' using errcode='23514'; end if;
  update public.photographers set business_country=chosen,
    stripe_connect_country=case when p_reserve_connect then chosen else p.stripe_connect_country end,
    billing_currency=coalesce(sales,'cad'),
    sales_currency_configured=p.sales_currency_configured or p_currency_explicit
    where id=p.id;
  return jsonb_build_object('businessCountry',chosen,'businessCountryLocked',p_reserve_connect or p.stripe_connect_country is not null,
    'salesCurrency',coalesce(sales,'cad'),'salesCurrencyConfigured',p.sales_currency_configured or p_currency_explicit);
end $$;

create or replace function public.find_photographer_stripe_account(p_account_id text,p_livemode boolean default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if (select count(*) from public.photographer_stripe_accounts where stripe_account_id=p_account_id and
    (p_livemode is null or livemode=p_livemode))>1 then
    raise exception 'The Stripe account environment is ambiguous.' using errcode='23514'; end if;
  if p_livemode is not null and exists(select 1 from public.photographer_stripe_accounts where stripe_account_id=p_account_id)
    and not exists(select 1 from public.photographer_stripe_accounts where stripe_account_id=p_account_id and livemode=p_livemode) then
    raise exception 'The Stripe account environment does not match.' using errcode='23514'; end if;
  select jsonb_build_object('photographerId',a.photographer_id,'accountId',a.stripe_account_id,
    'status',a.status,'livemode',a.livemode,'migratedAt',p.stripe_standard_migrated_at,'historyRequired',p.stripe_account_history_required)
    into result from public.photographer_stripe_accounts a join public.photographers p on p.id=a.photographer_id
    where a.stripe_account_id=p_account_id and (p_livemode is null or a.livemode=p_livemode);
  if result is not null then return result; end if;
  select jsonb_build_object('photographerId',p.id,'accountId',p_account_id,'status','active','livemode',null,'migratedAt',null,'historyRequired',false)
    into result from public.photographers p where p.stripe_standard_migrated_at is null and not p.stripe_account_history_required and
    coalesce(p.stripe_connected_account_id,p.stripe_account_id)=p_account_id;
  return result;
end $$;

create or replace function public.deauthorize_photographer_stripe_account(p_account_id text,p_livemode boolean)
returns void language plpgsql security definer set search_path=public as $$
declare r public.photographer_stripe_accounts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('studio-os-standard-signup:'||p_account_id||':'||p_livemode::text,0));
  update public.photographer_stripe_standard_signups set status='blocked',updated_at=now()
    where stripe_account_id=p_account_id and livemode=p_livemode;
  select * into r from public.photographer_stripe_accounts where stripe_account_id=p_account_id and livemode=p_livemode;
  if r.id is null then return; end if;
  perform id from public.photographers where id=r.photographer_id for update;
  select * into strict r from public.photographer_stripe_accounts where id=r.id for update;
  update public.photographer_stripe_accounts set deauthorized_at=coalesce(deauthorized_at,now()),status='blocked',
    charges_enabled=false,payouts_enabled=false where id=r.id;
  update public.photographers set stripe_connect_onboarding_complete=false,stripe_connect_charges_enabled=false,
    stripe_connect_payouts_enabled=false where id=r.photographer_id and
    coalesce(stripe_connected_account_id,stripe_account_id)=p_account_id;
end $$;

create or replace function public.claim_stripe_merchant_event(p_event_id text,p_account text,p_livemode boolean,
  p_event_type text,p_payload_hash text,p_payload jsonb,p_token uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare current_event public.stripe_merchant_events;
begin
  if length(p_event_id) not between 1 and 255 or p_account !~ '^acct_[A-Za-z0-9_]+$' or p_livemode is null or p_token is null or
    p_event_type not in ('account.updated','account.application.deauthorized','charge.refunded','refund.updated','refund.failed',
      'charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_withdrawn',
      'charge.dispute.funds_reinstated','application_fee.refunded','application_fee.refund.updated') or
    length(p_payload_hash)<>64 or jsonb_typeof(p_payload)<>'object' or p_payload->>'id' is distinct from p_event_id or
    p_payload->>'type' is distinct from p_event_type or (p_payload->>'livemode')::boolean is distinct from p_livemode then
    raise exception 'Invalid merchant event';
  end if;
  if p_event_type='account.application.deauthorized' then
    if p_payload->>'account' is distinct from p_account then raise exception 'Deauthorization account scope differs'; end if;
    perform pg_advisory_xact_lock(hashtextextended('studio-os-standard-signup:'||p_account||':'||p_livemode::text,0));
  end if;
  insert into public.stripe_merchant_events(event_id,stripe_account_id,livemode,event_type,payload_hash,payload)
    values(p_event_id,p_account,p_livemode,p_event_type,p_payload_hash,p_payload) on conflict(event_id) do nothing;
  select * into current_event from public.stripe_merchant_events where event_id=p_event_id for update;
  if current_event.stripe_account_id<>p_account or current_event.livemode<>p_livemode or
    current_event.event_type<>p_event_type or current_event.payload_hash<>p_payload_hash then
    raise exception 'Merchant event identity changed';
  end if;
  if current_event.status='processed' then return 'processed'; end if;
  if current_event.status='review' then return 'review'; end if;
  if current_event.status='processing' and current_event.lease_until>now() then return 'busy'; end if;
  update public.stripe_merchant_events set status='processing',lease_token=p_token,lease_until=now()+interval '5 minutes',
    next_attempt_at=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() where event_id=p_event_id;
  return 'claimed';
end $$;

create or replace function public.get_photographer_checkout_routing(p_photographer_id uuid,p_currency text default 'cad',
  p_order_id uuid default null,p_previous_expired_session_id text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.photographers%rowtype; r public.photographer_stripe_accounts%rowtype;
  a public.order_payment_accounts%rowtype; aid text; c public.stripe_standard_live_release_controls%rowtype;
  s public.photographer_stripe_standard_signups%rowtype;
begin
  select * into strict p from public.photographers where id=p_photographer_id;
  if p_order_id is not null and p_previous_expired_session_id is null then
    select b.* into a from public.orders o join public.order_payment_accounts b on b.id=o.stripe_payment_account_binding_id
      where o.id=p_order_id and o.photographer_id=p.id and b.photographer_id=p.id;
    if a.id is not null then
      select * into r from public.photographer_stripe_accounts where stripe_account_id=a.stripe_account_id
        and photographer_id=p.id and (a.livemode is null or livemode=a.livemode);
      if p.stripe_account_history_required then
        select * into s from public.photographer_stripe_standard_signups where photographer_id=p.id and stripe_account_id=a.stripe_account_id
          and livemode=a.livemode and status in ('activated','blocked');
        if s.id is null or r.id is null then raise exception 'The original Standard signup history is unavailable.' using errcode='23514'; end if;
        return jsonb_build_object('accountId',a.stripe_account_id,'routeVersion',a.route_version,'feeRateCents',null,
          'connectionType',r.account_type,'livemode',a.livemode,'origin','standard_signup','signupIntentId',s.id,
          'platformAccountId',s.platform_account_id,'historyRequired',true);
      end if;
      return jsonb_build_object('accountId',a.stripe_account_id,'routeVersion',a.route_version,
        'feeRateCents',null,'connectionType',coalesce(r.account_type,'express'),'livemode',a.livemode);
    end if;
  end if;
  aid:=coalesce(p.stripe_connected_account_id,p.stripe_account_id);
  if aid is null then raise exception 'The studio has no payment connection.' using errcode='23514'; end if;
  select * into r from public.photographer_stripe_accounts where photographer_id=p.id and stripe_account_id=aid and status='active';
  if (p.stripe_standard_migrated_at is not null or p.stripe_account_history_required) and r.id is null then
    raise exception 'The historical payment routing is unavailable.' using errcode='23514'; end if;
  if r.id is not null and (r.deauthorized_at is not null or not r.charges_enabled or not r.payouts_enabled) then
    raise exception 'The payment connection is unavailable.' using errcode='23514'; end if;
  if r.account_type='standard' and not public.stripe_standard_account_ready(jsonb_build_object(
    'type',r.account_type,'controller',r.controller,'capabilities',r.capabilities,'requirements',r.requirements,'future_requirements',r.future_requirements,
    'details_submitted',r.details_submitted,'charges_enabled',r.charges_enabled,'payouts_enabled',r.payouts_enabled)) then
    raise exception 'The Standard account is no longer ready for new orders.' using errcode='23514'; end if;
  if lower(p_currency) not in('usd','cad','eur','gbp','aud','aed','sar','amd') then
    raise exception 'Unsupported checkout currency.' using errcode='23514'; end if;
  if p.stripe_account_history_required then
    select * into s from public.photographer_stripe_standard_signups where photographer_id=p.id and stripe_account_id=aid and livemode=r.livemode and status='activated';
    if s.id is null or s.actor_user_id<>p.user_id or p.stripe_standard_migrated_at is not null or p.stripe_connect_route_version<>1 or
      r.account_type<>'standard' or not lower(p_currency)=any(s.allowed_currencies) or
      exists(select 1 from public.stripe_merchant_events where stripe_account_id=aid and livemode=r.livemode and event_type='account.application.deauthorized') then
      raise exception 'The new Standard signup route or sales currency is unavailable.' using errcode='23514'; end if;
    return jsonb_build_object('accountId',aid,'routeVersion',p.stripe_connect_route_version,'feeRateCents',null,
      'connectionType','standard','livemode',r.livemode,'origin','standard_signup','signupIntentId',s.id,
      'platformAccountId',s.platform_account_id,'historyRequired',true);
  end if;
  if r.account_type='standard' and r.livemode then
    if p.stripe_standard_migrated_at is null then
      raise exception 'Live Standard routing requires a completed guarded activation.' using errcode='23514'; end if;
    select * into c from public.stripe_standard_live_release_controls where release_key='whitephoto-20261015';
    if c.release_key is null or not c.checkout_enabled or p.id<>c.photographer_id or aid<>c.standard_account_id then
      raise exception 'Live Standard checkout is outside its enabled scope.' using errcode='23514'; end if;
    if not lower(p_currency)=any(c.allowed_currencies) then
      select * into r from public.photographer_stripe_accounts where photographer_id=p.id
        and stripe_account_id=c.express_account_id and livemode=true and status='legacy' and deauthorized_at is null
        and charges_enabled and payouts_enabled;
      if r.id is null then raise exception 'The original Express route is unavailable for this currency.' using errcode='23514'; end if;
      aid:=r.stripe_account_id;
    end if;
  end if;
  return jsonb_build_object('accountId',aid,'routeVersion',p.stripe_connect_route_version,
    'feeRateCents',null,
    'connectionType',coalesce(r.account_type,'express'),'livemode',r.livemode);
end $$;

create or replace function public.resolve_order_payment_account(
  p_photographer_id uuid,p_order_id uuid default null,p_order_group_id uuid default null,
  p_checkout_session_id text default null,p_payment_intent_id text default null,p_expected_account text default null,
  p_livemode boolean default null
) returns text language plpgsql stable security definer set search_path=public as $$
declare p public.photographers%rowtype; seed public.orders%rowtype; a public.order_payment_accounts%rowtype;
  ids uuid[]; gross bigint; binding_currency text; group_id uuid; binding_fee_snapshot jsonb;
begin
  select * into strict p from public.photographers where id=p_photographer_id;
  select * into seed from public.orders o where o.photographer_id=p.id and
    (case when p_order_id is not null then o.id=p_order_id
      when p_order_group_id is not null then o.order_group_id=p_order_group_id
      when p_checkout_session_id is not null then o.stripe_checkout_session_id=p_checkout_session_id
      when p_payment_intent_id is not null then o.stripe_payment_intent_id=p_payment_intent_id else false end)
    order by o.id limit 1;
  if seed.id is null then raise exception 'The saved payment order is unavailable.' using errcode='23514'; end if;
  group_id:=seed.order_group_id;
  if p_order_group_id is not null and group_id is distinct from p_order_group_id then raise exception 'Payment group mismatch.' using errcode='23514'; end if;
  select array_agg(o.id order by o.id),sum(coalesce(o.total_cents,round(o.total_amount*100)::bigint)),min(lower(coalesce(o.currency,'cad')))
    into ids,gross,binding_currency from public.orders o where case when group_id is null then o.id=seed.id else o.order_group_id=group_id end;
  if exists(select 1 from public.orders o where o.id=any(ids) and (o.photographer_id is distinct from p.id or
    lower(coalesce(o.currency,'cad'))<>binding_currency or
    (p_checkout_session_id is not null and o.stripe_checkout_session_id is distinct from p_checkout_session_id) or
    (p_payment_intent_id is not null and o.stripe_payment_intent_id is not null and o.stripe_payment_intent_id<>p_payment_intent_id))) then
    raise exception 'The complete payment scope does not match.' using errcode='23514'; end if;
  select jsonb_agg(jsonb_build_object('id',id,'platform_fee_collection_method',platform_fee_collection_method,
    'platform_fee_amount_cents',platform_fee_amount_cents,'platform_fee_currency',platform_fee_currency,
    'platform_fee_rate_cents',platform_fee_rate_cents) order by id) into binding_fee_snapshot from public.orders where id=any(ids);
  select * into a from public.order_payment_accounts where id=seed.stripe_payment_account_binding_id;
  if a.id is not null then
    if a.photographer_id<>p.id or a.order_ids<>ids or a.order_group_id is distinct from group_id or
      a.amount_cents<>gross or a.currency<>binding_currency or a.fee_snapshot is distinct from binding_fee_snapshot or
      (p_livemode is not null and a.livemode is not null and a.livemode<>p_livemode) or
      (p_checkout_session_id is not null and a.checkout_session_id is distinct from p_checkout_session_id) or
      (p_payment_intent_id is not null and a.payment_intent_id is not null and a.payment_intent_id<>p_payment_intent_id) or
      exists(select 1 from public.orders where id=any(ids) and stripe_payment_account_binding_id is distinct from a.id) then
      raise exception 'The historical account binding does not match this payment.' using errcode='23514'; end if;
  elsif p.stripe_standard_migrated_at is not null or p.stripe_account_history_required then
    raise exception 'The original Stripe account has not been verified.' using errcode='23514';
  end if;
  if p_expected_account is not null and p_expected_account is distinct from coalesce(a.stripe_account_id,p.stripe_connected_account_id,p.stripe_account_id) then
    raise exception 'The payment account does not match its saved checkout.' using errcode='23514'; end if;
  return coalesce(a.stripe_account_id,p.stripe_connected_account_id,p.stripe_account_id);
end $$;

create or replace function public.reserve_order_payment_account(
  p_photographer_id uuid,p_order_ids uuid[],p_anchor_order_id uuid,p_expected_account_id text,
  p_expected_route_version bigint,p_amount_cents bigint,p_currency text,p_idempotency_key text,
  p_request_hash text default null,p_previous_expired_session_id text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.photographers%rowtype; a public.order_payment_accounts%rowtype; old_binding public.order_payment_accounts%rowtype;
  ids uuid[]; group_id uuid; gross bigint; curr text; aid text; snapshot jsonb; mode boolean; locked integer; routing jsonb;
begin
  select * into strict p from public.photographers where id=p_photographer_id for update;
  if p.stripe_account_history_required and (p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'A new Standard checkout requires its immutable request hash.' using errcode='23514'; end if;
  if p_order_ids is null or cardinality(p_order_ids)=0 or p_anchor_order_id is null or
    not p_anchor_order_id=any(p_order_ids) or p_idempotency_key is null or length(p_idempotency_key)>255 or
    p_amount_cents is null or p_amount_cents<=0 then raise exception 'A complete payment reservation is required.' using errcode='23514'; end if;
  select array_agg(x order by x) into ids from (select distinct unnest(p_order_ids) x) v;
  if cardinality(ids)<>cardinality(p_order_ids) then raise exception 'Duplicate payment orders.' using errcode='23514'; end if;
  perform id from public.orders where id=any(ids) order by id for update;
  get diagnostics locked=row_count;
  if locked<>cardinality(ids) or exists(select 1 from public.orders where id=any(ids) and photographer_id is distinct from p.id) then
    raise exception 'The payment orders do not belong to this studio.' using errcode='23514'; end if;
  select order_group_id into group_id from public.orders where id=p_anchor_order_id;
  if exists(select 1 from public.orders where id=any(ids) and order_group_id is distinct from group_id) or
    (group_id is not null and exists(select 1 from public.orders where order_group_id=group_id and not id=any(ids))) then
    raise exception 'The complete checkout group is required.' using errcode='23514'; end if;
  select sum(coalesce(total_cents,round(total_amount*100)::bigint)),min(lower(coalesce(currency,'cad'))),
    jsonb_agg(jsonb_build_object('id',id,'platform_fee_collection_method',platform_fee_collection_method,
      'platform_fee_amount_cents',platform_fee_amount_cents,'platform_fee_currency',platform_fee_currency,
      'platform_fee_rate_cents',platform_fee_rate_cents) order by id)
    into gross,curr,snapshot from public.orders where id=any(ids);
  if gross is null or gross<>p_amount_cents or curr<>lower(p_currency) or exists(select 1 from public.orders
    where id=any(ids) and (lower(coalesce(currency,'cad'))<>curr or coalesce(total_cents,round(total_amount*100)::bigint)<0)) then
    raise exception 'The payment total or currency changed.' using errcode='23514'; end if;
  select * into a from public.order_payment_accounts where idempotency_key=p_idempotency_key for update;
  if a.id is not null then
    if a.photographer_id<>p.id or a.order_ids<>ids or a.anchor_order_id<>p_anchor_order_id or
      a.amount_cents<>gross or a.currency<>curr or a.fee_snapshot<>snapshot or a.request_hash is distinct from p_request_hash then
      raise exception 'The retry does not match the immutable request.' using errcode='23514'; end if;
    -- Stripe may discard idempotency keys after 24 hours. Never repeat an
    -- unknown creation after that window; require original provider proof.
    if a.checkout_session_id is null and a.created_at<=now()-interval '23 hours' then
      raise exception 'The unknown checkout is too old to retry safely. Verify its original Stripe session.' using errcode='23514'; end if;
    return jsonb_build_object('attemptId',a.id,'accountId',a.stripe_account_id,'idempotencyKey',a.idempotency_key,'routeVersion',a.route_version,
      'checkoutSessionId',a.checkout_session_id,'paymentIntentId',a.payment_intent_id);
  end if;
  select b.* into old_binding from public.orders o join public.order_payment_accounts b on b.id=o.stripe_payment_account_binding_id
    where o.id=p_anchor_order_id for update of b;
  if old_binding.id is not null then
    if old_binding.order_ids<>ids or exists(select 1 from public.orders where id=any(ids) and stripe_payment_account_binding_id is distinct from old_binding.id) then
      raise exception 'Payment group bindings disagree.' using errcode='23514'; end if;
    if p_previous_expired_session_id is null or old_binding.checkout_session_id is distinct from p_previous_expired_session_id then
      raise exception 'An existing or uncertain checkout must be reused.' using errcode='23514'; end if;
    if exists(select 1 from public.orders where id=any(ids) and (paid_at is not null or
      lower(coalesce(payment_status,'')) in ('paid','succeeded','partially_refunded','refunded') or
      lower(coalesce(status,'')) in ('paid','ready','completed','refunded','refund_pending','cancel_pending','cancelled','canceled'))) then
      raise exception 'This checkout already has a terminal payment.' using errcode='23514'; end if;
    update public.order_payment_accounts set state='expired' where id=old_binding.id;
  elsif exists(select 1 from public.orders where id=any(ids) and
    (stripe_checkout_session_id is not null or stripe_payment_intent_id is not null or status='checkout_starting')) then
    raise exception 'The original checkout account must be backfilled first.' using errcode='23514';
  end if;
  routing:=public.get_photographer_checkout_routing(p.id,curr,p_anchor_order_id,p_previous_expired_session_id);
  aid:=routing->>'accountId';
  if aid is null or aid is distinct from p_expected_account_id or p.stripe_connect_route_version<>p_expected_route_version then
    raise exception 'The account changed before checkout was reserved. Refresh and retry.' using errcode='23514'; end if;
  if exists(select 1 from public.photographer_stripe_accounts where photographer_id=p.id and stripe_account_id=aid and
    (deauthorized_at is not null or status='blocked' or not charges_enabled or not payouts_enabled)) then
    raise exception 'The payment connection is unavailable.' using errcode='23514'; end if;
  select livemode into mode from public.photographer_stripe_accounts where photographer_id=p.id and stripe_account_id=aid and status in('active','legacy');
  if (p.stripe_standard_migrated_at is not null or p.stripe_account_history_required) and mode is null then raise exception 'The active history is unavailable.' using errcode='23514'; end if;
  insert into public.order_payment_accounts(photographer_id,stripe_account_id,livemode,anchor_order_id,order_group_id,order_ids,
    route_version,amount_cents,currency,fee_snapshot,idempotency_key,request_hash)
    values(p.id,aid,mode,p_anchor_order_id,group_id,ids,p.stripe_connect_route_version,gross,curr,snapshot,p_idempotency_key,p_request_hash)
    returning * into a;
  update public.orders set stripe_payment_account_binding_id=a.id where id=any(ids);
  return jsonb_build_object('attemptId',a.id,'accountId',aid,'idempotencyKey',a.idempotency_key,'routeVersion',a.route_version,
    'checkoutSessionId',a.checkout_session_id,'paymentIntentId',a.payment_intent_id);
end $$;

create or replace function public.protect_order_stripe_account_binding() returns trigger
language plpgsql set search_path=public as $$
declare reservation_enforced boolean; born_standard boolean; binding public.order_payment_accounts%rowtype;
begin
  if current_user in ('anon','authenticated') and
    ((tg_op='INSERT' and new.stripe_payment_account_binding_id is not null) or
     (tg_op='UPDATE' and new.stripe_payment_account_binding_id is distinct from old.stripe_payment_account_binding_id)) then
    raise exception 'Payment account bindings are managed by Studio OS.' using errcode='42501';
  end if;
  select coalesce(bool_or(stripe_account_history_required),false) into born_standard from public.photographers where id=new.photographer_id;
  if (new.photographer_id='ed6b8a99-1f38-48f3-a198-447c49b5ac34' or born_standard) and new.status='checkout_starting' then
    if current_user in ('anon','authenticated') then
      if tg_op='INSERT' or old.status is distinct from new.status then
        raise exception 'Checkout must start through the authenticated server payment route.' using errcode='42501'; end if;
      -- Normal desktop/dashboard maintenance of an already-starting order may
      -- retain its status and binding. It has no Stripe key and must not read
      -- the private rollout controls; binding changes were rejected above.
      return new;
    end if;
    if born_standard then reservation_enforced:=true;
    else select reservation_required into reservation_enforced from public.stripe_standard_live_release_controls where release_key='whitephoto-20261015'; end if;
    if reservation_enforced and (born_standard or not (tg_op='UPDATE' and old.status='checkout_starting' and
      old.stripe_payment_account_binding_id is null and new.stripe_payment_account_binding_id is not null)) then
      -- Provider-backed backfill may attach original history to an already
      -- starting row. A later retry still needs a reserved request hash.
      select * into binding from public.order_payment_accounts where id=new.stripe_payment_account_binding_id;
      if binding.id is null or binding.photographer_id is distinct from new.photographer_id or
        not new.id=any(binding.order_ids) or binding.request_hash is null or binding.state='expired' then
        raise exception 'Checkout must reserve its immutable original account before contacting Stripe.' using errcode='23514'; end if;
    end if;
  end if;
  return new;
end $$;

create function public.stripe_standard_signup_schema_status() returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('version','20261015020000',
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

do $$ declare fn record; begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('stripe_standard_signup_schema_status','stripe_standard_signup_params_hash','get_photographer_standard_signup_eligibility',
      'reserve_photographer_standard_signup','record_photographer_standard_signup_account','activate_photographer_standard_signup',
      'protect_photographer_stripe_history_required','protect_photographer_standard_signup','protect_standard_signup_eligibility') loop
    execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end $$;
