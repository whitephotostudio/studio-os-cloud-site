begin;

-- Business location is independent of the studio's sales currency. Existing
-- studios keep their saved currency; only new, unconfigured profiles default
-- to USD when their owner explicitly chooses the United States.
alter table public.photographers
  add column if not exists business_country text check (business_country in ('CA','US')),
  add column if not exists stripe_connect_country text check (stripe_connect_country ~ '^[A-Z]{2}$'),
  add column if not exists sales_currency_configured boolean not null default false;
update public.photographers set sales_currency_configured = true;

-- Lock the country before the external creation request. A retry, including an
-- uncertain provider outcome, must reuse the same country and idempotency key.
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
  update public.photographers set business_country=chosen,
    stripe_connect_country=case when p_reserve_connect then chosen else p.stripe_connect_country end,
    billing_currency=coalesce(sales,'cad'),
    sales_currency_configured=p.sales_currency_configured or p_currency_explicit
    where id=p.id;
  return jsonb_build_object('businessCountry',chosen,'businessCountryLocked',p_reserve_connect or p.stripe_connect_country is not null,
    'salesCurrency',coalesce(sales,'cad'),'salesCurrencyConfigured',p.sales_currency_configured or p_currency_explicit);
end $$;

-- Persist provider state only when the live account agrees with the chosen or
-- reserved country. Never recreate an account to resolve a country mismatch.
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
    business_country=case when p_country in ('CA','US') then coalesce(p.business_country,p_country) else p.business_country end,
    stripe_connect_onboarding_complete=p_details_submitted and p_charges_enabled and p_payouts_enabled,
    stripe_connect_charges_enabled=p_charges_enabled,stripe_connect_payouts_enabled=p_payouts_enabled
    where id=p.id;
end $$;

-- Clients save these settings through the authenticated server endpoint. Row
-- ownership alone must not allow bypassing the country lock or reservation.
create or replace function public.protect_photographer_payment_country() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_op='INSERT' then
    if current_user not in ('postgres','service_role','supabase_admin') and
      (new.business_country is not null or new.stripe_connect_country is not null or new.sales_currency_configured
        or new.stripe_account_id is not null or new.stripe_connected_account_id is not null) then
      raise exception 'Save payment country settings through Studio OS settings.' using errcode='42501';
    end if;
    return new;
  end if;
  if current_user not in ('postgres','service_role','supabase_admin') and
    (new.business_country is distinct from old.business_country or
     new.stripe_connect_country is distinct from old.stripe_connect_country or
     new.sales_currency_configured is distinct from old.sales_currency_configured or
     new.stripe_account_id is distinct from old.stripe_account_id or
     new.stripe_connected_account_id is distinct from old.stripe_connected_account_id) then
    raise exception 'Save payment country settings through Studio OS settings.' using errcode='42501';
  end if;
  if current_user not in ('postgres','service_role','supabase_admin') and new.billing_currency is distinct from old.billing_currency then
    new.sales_currency_configured:=true;
  end if;
  return new;
end $$;
drop trigger if exists protect_photographer_payment_country on public.photographers;
create trigger protect_photographer_payment_country before insert or update on public.photographers
  for each row execute function public.protect_photographer_payment_country();

revoke all on function public.configure_photographer_payment_profile(uuid,text,text,boolean,boolean) from public,anon,authenticated;
revoke all on function public.sync_photographer_connect_state(uuid,text,text,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.configure_photographer_payment_profile(uuid,text,text,boolean,boolean) to service_role;
grant execute on function public.sync_photographer_connect_state(uuid,text,text,boolean,boolean,boolean) to service_role;

-- Read-only deployment guard. Exposes schema capabilities, never studio data.
create or replace function public.stripe_business_profile_schema_status() returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'version',1,
    'columns_ready',(select count(*)=3 from information_schema.columns where table_schema='public' and table_name='photographers'
      and ((column_name in ('business_country','stripe_connect_country') and data_type='text')
        or (column_name='sales_currency_configured' and data_type='boolean' and is_nullable='NO'))),
    'country_constraints_ready',(select count(*)=2 from pg_constraint c where c.conrelid='public.photographers'::regclass
      and c.contype='c' and c.convalidated and c.conname in ('photographers_business_country_check','photographers_stripe_connect_country_check')),
    'atomic_profile_guard_ready',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='configure_photographer_payment_profile' and p.prosecdef
        and pg_get_functiondef(p.oid) ilike '%for update%' and pg_get_functiondef(p.oid) like '%p_reserve_connect%'),
    'connect_sync_guard_ready',exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='sync_photographer_connect_state' and p.prosecdef
        and pg_get_functiondef(p.oid) ilike '%for update%' and pg_get_functiondef(p.oid) like '%p_country%'),
    'client_country_guard_ready',exists(select 1 from pg_trigger t where t.tgrelid='public.photographers'::regclass
      and t.tgname='protect_photographer_payment_country' and t.tgenabled<>'D' and not t.tgisinternal),
    'service_only',(select count(*)=3 and bool_and(has_function_privilege('service_role',p.oid,'EXECUTE')
        and not has_function_privilege('anon',p.oid,'EXECUTE') and not has_function_privilege('authenticated',p.oid,'EXECUTE'))
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname in ('configure_photographer_payment_profile','sync_photographer_connect_state','stripe_business_profile_schema_status'))
  );
$$;
revoke all on function public.stripe_business_profile_schema_status() from public,anon,authenticated;
grant execute on function public.stripe_business_profile_schema_status() to service_role;

commit;
