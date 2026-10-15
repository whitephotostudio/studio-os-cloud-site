-- Local/test migration foundation only. No live Stripe account creation is enabled.
create table if not exists public.photographer_stripe_standard_intents (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete restrict,
  actor_user_id uuid not null,
  livemode boolean not null default false check (livemode = false),
  country text not null check (country in ('CA', 'US')),
  status text not null default 'reserved' check (status in ('reserved', 'creating', 'uncertain', 'registered')),
  stripe_account_id text,
  creation_params jsonb not null,
  created_at timestamptz not null default now(),
  attempted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (photographer_id, livemode)
);
alter table public.photographer_stripe_standard_intents enable row level security;
revoke all on public.photographer_stripe_standard_intents from public, anon, authenticated;
grant select, insert, update on public.photographer_stripe_standard_intents to service_role;

create or replace function public.reserve_photographer_standard_intent(
  p_photographer_id uuid, p_actor_user_id uuid, p_country text, p_livemode boolean, p_creation_params jsonb
) returns public.photographer_stripe_standard_intents
language plpgsql security definer set search_path = public, pg_temp as $$
declare result public.photographer_stripe_standard_intents; actual_country text;
begin
  if p_livemode is distinct from false then raise exception 'Standard migration is test-only' using errcode = '23514'; end if;
  if p_country is null or p_country not in ('CA', 'US') then raise exception 'Unsupported business country' using errcode = '23514'; end if;
  select coalesce(business_country, stripe_connect_country) into actual_country
  from public.photographers where id = p_photographer_id and user_id = p_actor_user_id for update;
  if not found then raise exception 'Photographer ownership is required' using errcode = '42501'; end if;
  if actual_country is distinct from p_country then raise exception 'Business country must match the photographer profile' using errcode = '23514'; end if;
  if jsonb_typeof(p_creation_params) is distinct from 'object' or
     p_creation_params->>'type' is distinct from 'standard' or
     p_creation_params->>'country' is distinct from p_country or
     p_creation_params->>'metadata[photographer_id]' is distinct from p_photographer_id::text then
    raise exception 'Invalid Standard creation parameters' using errcode = '23514';
  end if;
  insert into public.photographer_stripe_standard_intents (photographer_id, actor_user_id, country, livemode, creation_params)
  values (p_photographer_id, p_actor_user_id, p_country, false, p_creation_params)
  on conflict (photographer_id, livemode) do nothing;
  select * into result from public.photographer_stripe_standard_intents
  where photographer_id = p_photographer_id and livemode = false for update;
  if result.country <> p_country or result.actor_user_id <> p_actor_user_id then
    raise exception 'A different Standard account creation is already reserved' using errcode = '23514';
  end if;
  update public.photographer_stripe_standard_intents
  set status = case when status = 'reserved' then 'creating' else status end,
      attempted_at = coalesce(attempted_at, now()), updated_at = now()
  where id = result.id returning * into result;
  return result;
end $$;

create or replace function public.record_photographer_standard_intent(
  p_intent_id uuid, p_actor_user_id uuid, p_status text, p_account_id text default null
) returns public.photographer_stripe_standard_intents
language plpgsql security definer set search_path = public, pg_temp as $$
declare result public.photographer_stripe_standard_intents;
begin
  select * into result from public.photographer_stripe_standard_intents where id = p_intent_id for update;
  if not found or result.actor_user_id <> p_actor_user_id then
    raise exception 'Standard creation intent ownership is required' using errcode = '42501';
  end if;
  perform 1 from public.photographers where id = result.photographer_id and user_id = p_actor_user_id;
  if not found then raise exception 'Photographer ownership is required' using errcode = '42501'; end if;
  if p_status not in ('uncertain', 'registered') then raise exception 'Invalid intent state' using errcode = '23514'; end if;
  if p_account_id is not null and p_account_id !~ '^acct_[A-Za-z0-9]+$' then raise exception 'Invalid Stripe account' using errcode = '23514'; end if;
  if result.stripe_account_id is not null and p_account_id is not null and result.stripe_account_id <> p_account_id then
    raise exception 'A creation intent cannot change its Stripe account' using errcode = '23514';
  end if;
  if p_status = 'registered' and coalesce(result.stripe_account_id, p_account_id) is null then
    raise exception 'A registered intent requires a Stripe account' using errcode = '23514';
  end if;
  update public.photographer_stripe_standard_intents
  set status = case when status = 'registered' then status else p_status end,
      stripe_account_id = coalesce(stripe_account_id, p_account_id), updated_at = now()
  where id = p_intent_id returning * into result;
  return result;
end $$;
revoke all on function public.reserve_photographer_standard_intent(uuid, uuid, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.record_photographer_standard_intent(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_photographer_standard_intent(uuid, uuid, text, boolean, jsonb) to service_role;
grant execute on function public.record_photographer_standard_intent(uuid, uuid, text, text) to service_role;
