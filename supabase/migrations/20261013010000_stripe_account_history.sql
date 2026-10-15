-- Additive payment-account history. Installation never selects a new merchant.
-- Live migration remains disabled until the exact service-only pilot is enabled.
alter table public.photographers
  add column if not exists stripe_standard_migrated_at timestamptz,
  add column if not exists stripe_connect_route_version bigint not null default 0;

create table public.photographer_stripe_accounts (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id),
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  livemode boolean not null,
  account_type text not null check (account_type in ('express','standard')),
  status text not null check (status in ('pending','ready','active','legacy','blocked')),
  country text not null check (country in ('CA','US')),
  controller jsonb not null default '{}',
  capabilities jsonb not null default '{}',
  requirements jsonb not null default '{}',
  future_requirements jsonb not null default '{}',
  details_submitted boolean not null default false,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  verified_at timestamptz not null default now(),
  activated_at timestamptz,
  deauthorized_at timestamptz,
  created_at timestamptz not null default now(),
  unique(stripe_account_id,livemode)
);
create unique index photographer_stripe_one_active
  on public.photographer_stripe_accounts(photographer_id,livemode) where status='active';
alter table public.photographer_stripe_accounts enable row level security;
revoke all on public.photographer_stripe_accounts from public,anon,authenticated;
grant all on public.photographer_stripe_accounts to service_role;
revoke delete,truncate on public.photographer_stripe_accounts from service_role;

create table public.order_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id),
  stripe_account_id text not null,
  livemode boolean,
  anchor_order_id uuid not null references public.orders(id),
  order_group_id uuid,
  order_ids uuid[] not null check (cardinality(order_ids)>0),
  route_version bigint not null,
  amount_cents bigint not null check (amount_cents>=0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  fee_snapshot jsonb not null,
  idempotency_key text not null unique,
  request_hash text,
  checkout_session_id text,
  payment_intent_id text,
  charge_id text,
  application_fee_id text,
  state text not null default 'reserved' check (state in ('reserved','open','completed','expired','uncertain')),
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(stripe_account_id,checkout_session_id),
  unique(stripe_account_id,payment_intent_id)
);
alter table public.orders add column if not exists stripe_payment_account_binding_id uuid
  references public.order_payment_accounts(id);
alter table public.order_payment_accounts enable row level security;
revoke all on public.order_payment_accounts from public,anon,authenticated;
grant all on public.order_payment_accounts to service_role;
revoke delete,truncate on public.order_payment_accounts from service_role;

create function public.protect_stripe_payment_account_history() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Stripe financial history cannot be deleted.' using errcode='23514'; end if;
  if tg_table_name='photographer_stripe_accounts' then
    if new.photographer_id is distinct from old.photographer_id or new.stripe_account_id is distinct from old.stripe_account_id
      or new.livemode is distinct from old.livemode or new.country is distinct from old.country
      or new.account_type is distinct from old.account_type then
      raise exception 'A Stripe account history owner cannot be changed.' using errcode='23514';
    end if;
  else
    if new.photographer_id is distinct from old.photographer_id or new.stripe_account_id is distinct from old.stripe_account_id
      or new.livemode is distinct from old.livemode or new.anchor_order_id is distinct from old.anchor_order_id
      or new.order_group_id is distinct from old.order_group_id or new.order_ids is distinct from old.order_ids
      or new.route_version is distinct from old.route_version or new.amount_cents is distinct from old.amount_cents
      or new.currency is distinct from old.currency or new.fee_snapshot is distinct from old.fee_snapshot
      or new.idempotency_key is distinct from old.idempotency_key or new.request_hash is distinct from old.request_hash
      or new.evidence is distinct from old.evidence
      or (old.checkout_session_id is not null and new.checkout_session_id is distinct from old.checkout_session_id)
      or (old.payment_intent_id is not null and new.payment_intent_id is distinct from old.payment_intent_id)
      or (old.charge_id is not null and new.charge_id is distinct from old.charge_id)
      or (old.application_fee_id is not null and new.application_fee_id is distinct from old.application_fee_id) then
      raise exception 'A Stripe payment account binding is immutable.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
create trigger protect_stripe_account_owner before update or delete on public.photographer_stripe_accounts
for each row execute function public.protect_stripe_payment_account_history();
create trigger protect_stripe_payment_binding before update or delete on public.order_payment_accounts
for each row execute function public.protect_stripe_payment_account_history();

-- Financial account mappings and routing are always server controlled. Normal
-- desktop/browser order writes cannot attach another studio's payment account.
create function public.protect_order_stripe_account_binding() returns trigger
language plpgsql set search_path=public as $$
declare reservation_enforced boolean; binding public.order_payment_accounts%rowtype;
begin
  if current_user in ('anon','authenticated') and
    ((tg_op='INSERT' and new.stripe_payment_account_binding_id is not null) or
     (tg_op='UPDATE' and new.stripe_payment_account_binding_id is distinct from old.stripe_payment_account_binding_id)) then
    raise exception 'Payment account bindings are managed by Studio OS.' using errcode='42501';
  end if;
  if new.photographer_id='ed6b8a99-1f38-48f3-a198-447c49b5ac34' and new.status='checkout_starting' then
    if current_user in ('anon','authenticated') then
      if tg_op='INSERT' or old.status is distinct from new.status then
        raise exception 'Checkout must start through the authenticated server payment route.' using errcode='42501'; end if;
      -- Normal desktop/dashboard maintenance of an already-starting order may
      -- retain its status and binding. It has no Stripe key and must not read
      -- the private rollout controls; binding changes were rejected above.
      return new;
    end if;
    select reservation_required into reservation_enforced from public.stripe_standard_live_release_controls
      where release_key='whitephoto-20261015';
    if reservation_enforced and not (tg_op='UPDATE' and old.status='checkout_starting' and
      old.stripe_payment_account_binding_id is null and new.stripe_payment_account_binding_id is not null) then
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
create trigger protect_order_stripe_binding before insert or update on public.orders
for each row execute function public.protect_order_stripe_account_binding();

-- Separate rollout controls prevent installing history from enabling migration.
-- The row cannot authorize another merchant/account pair, even with a bad flag.
create table public.stripe_standard_live_release_controls (
  release_key text primary key check (release_key='whitephoto-20261015'),
  migration_enabled boolean not null default false,
  activation_enabled boolean not null default false,
  checkout_enabled boolean not null default false,
  reservation_required boolean not null default false,
  platform_account_id text not null default 'acct_1TBlT4PxlnWeytFA' check(platform_account_id='acct_1TBlT4PxlnWeytFA'),
  photographer_id uuid not null default 'ed6b8a99-1f38-48f3-a198-447c49b5ac34' check(photographer_id='ed6b8a99-1f38-48f3-a198-447c49b5ac34'),
  actor_user_id uuid not null default '4a9f37fe-d217-4edd-bcf9-3a561da2e2f0' check(actor_user_id='4a9f37fe-d217-4edd-bcf9-3a561da2e2f0'),
  express_account_id text not null default 'acct_1TIHTrLqg5vdCgpU' check(express_account_id='acct_1TIHTrLqg5vdCgpU'),
  standard_account_id text not null default 'acct_1UQHR5LZhEC2SlmP' check(standard_account_id='acct_1UQHR5LZhEC2SlmP'),
  allowed_currencies text[] not null default array['cad','usd']::text[] check(cardinality(allowed_currencies)>0 and
    allowed_currencies <@ array['usd','cad','eur','gbp','aud','aed','sar','amd']::text[])
);
insert into public.stripe_standard_live_release_controls(release_key) values('whitephoto-20261015');
alter table public.stripe_standard_live_release_controls enable row level security;
revoke all on public.stripe_standard_live_release_controls from public,anon,authenticated;
grant select,update on public.stripe_standard_live_release_controls to service_role;

create function public.assert_whitephoto_live_stripe_scope(p_photographer_id uuid,p_actor_user_id uuid,
  p_account_id text,p_expected_current_account_id text default null,p_provider_proof jsonb default null)
returns void language plpgsql stable security definer set search_path=public as $$
declare c public.stripe_standard_live_release_controls%rowtype; verified timestamptz;
begin
  select * into c from public.stripe_standard_live_release_controls where release_key='whitephoto-20261015';
  if c.release_key is null or not c.migration_enabled or not c.checkout_enabled or not c.reservation_required or
    p_photographer_id is distinct from c.photographer_id or p_actor_user_id is distinct from c.actor_user_id or
    p_account_id is null or p_account_id not in(c.express_account_id,c.standard_account_id) or
    (p_expected_current_account_id is not null and p_expected_current_account_id not in(c.express_account_id,c.standard_account_id)) then
    raise exception 'Live Standard migration is disabled or outside its authorized account pair.' using errcode='23514'; end if;
  if p_provider_proof->>'platformAccountId' is distinct from c.platform_account_id or
    p_provider_proof->>'accountId' is distinct from p_account_id or p_provider_proof->>'livemode' is distinct from 'true' or
    p_provider_proof->>'verifiedAt' is null then
    raise exception 'Fresh live Stripe platform and account GET proof is required.' using errcode='23514'; end if;
  verified:=(p_provider_proof->>'verifiedAt')::timestamptz;
  if verified>now() or verified<now()-interval '5 minutes' then
    raise exception 'Live Stripe account proof is stale.' using errcode='23514'; end if;
end $$;

create function public.stripe_standard_account_ready(p_account jsonb) returns boolean
language sql immutable set search_path=public as $$
  select coalesce(p_account->>'type'='standard',false)
    and coalesce(p_account#>>'{controller,fees,payer}'='account',false)
    and coalesce(p_account#>>'{controller,losses,payments}'='stripe',false)
    and coalesce(p_account#>>'{controller,requirement_collection}'='stripe',false)
    and coalesce(p_account#>>'{controller,stripe_dashboard,type}'='full',false)
    and coalesce((p_account->>'details_submitted')::boolean,false)
    and coalesce((p_account->>'charges_enabled')::boolean,false)
    and coalesce((p_account->>'payouts_enabled')::boolean,false)
    and coalesce(p_account#>>'{capabilities,card_payments}'='active',false)
    and coalesce(p_account#>>'{capabilities,transfers}'='active',false)
    and nullif(p_account#>>'{requirements,disabled_reason}','') is null
    and nullif(p_account#>>'{future_requirements,disabled_reason}','') is null
    and not exists(select 1 from(values('requirements'),('future_requirements')) r(field)
      cross join(values('currently_due'),('eventually_due'),('past_due'),('pending_verification'),('errors')) k(field)
      where case when jsonb_typeof(p_account#>array[r.field,k.field])='array'
        then jsonb_array_length(p_account#>array[r.field,k.field])<>0 else true end);
$$;

create function public.register_photographer_stripe_account(
  p_photographer_id uuid,p_actor_user_id uuid,p_account jsonb,p_livemode boolean,p_provider_proof jsonb default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.photographers%rowtype; r public.photographer_stripe_accounts%rowtype;
  account_id text:=p_account->>'id'; country text:=upper(p_account->>'country'); kind text:=p_account->>'type'; target_status text;
begin
  select * into strict p from public.photographers where id=p_photographer_id for update;
  if p_actor_user_id is null or p.user_id is distinct from p_actor_user_id then
    raise exception 'The connected account owner is unavailable.' using errcode='42501';
  end if;
  if p_livemode then
    perform public.assert_whitephoto_live_stripe_scope(p.id,p_actor_user_id,account_id,null,p_provider_proof);
    if p_account#>>'{metadata,photographer_id}' is distinct from p.id::text or
      p_account#>>'{metadata,user_id}' is distinct from p_actor_user_id::text then
      raise exception 'The live Stripe account secure ownership metadata must match.' using errcode='23514'; end if;
  end if;
  if p_livemode is null or account_id is null or account_id !~ '^acct_[A-Za-z0-9]+$'
    or country is null or country not in ('CA','US') or kind is null or kind not in ('express','standard') then
    raise exception 'The Stripe account identity cannot be verified.' using errcode='23514';
  end if;
  if coalesce(p.business_country,p.stripe_connect_country,country)<>country or
    (p.stripe_connect_country is not null and p.stripe_connect_country<>country) then
    raise exception 'The account country does not match this studio.' using errcode='23514';
  end if;
  if kind='standard' and (p_account#>>'{controller,fees,payer}' is distinct from 'account'
    or p_account#>>'{controller,losses,payments}' is distinct from 'stripe'
    or p_account#>>'{controller,requirement_collection}' is distinct from 'stripe'
    or p_account#>>'{controller,stripe_dashboard,type}' is distinct from 'full') then
    raise exception 'This account does not have the required Standard configuration.' using errcode='23514';
  end if;
  select * into r from public.photographer_stripe_accounts where stripe_account_id=account_id and livemode=p_livemode for update;
  if found and r.photographer_id<>p.id then raise exception 'This Stripe account is already assigned.' using errcode='23514'; end if;
  target_status:=case when coalesce(p.stripe_connected_account_id,p.stripe_account_id)=account_id then 'active'
    when public.stripe_standard_account_ready(p_account) then 'ready' else 'pending' end;
  if r.id is not null and r.status in ('legacy','blocked') then target_status:=r.status; end if;
  insert into public.photographer_stripe_accounts(photographer_id,stripe_account_id,livemode,account_type,status,country,
    controller,capabilities,requirements,future_requirements,details_submitted,charges_enabled,payouts_enabled,verified_at)
  values(p.id,account_id,p_livemode,kind,target_status,country,coalesce(p_account->'controller','{}'),
    coalesce(p_account->'capabilities','{}'),coalesce(p_account->'requirements','{}'),coalesce(p_account->'future_requirements','{}'),
    coalesce((p_account->>'details_submitted')::boolean,false),coalesce((p_account->>'charges_enabled')::boolean,false),
    coalesce((p_account->>'payouts_enabled')::boolean,false),now())
  on conflict(stripe_account_id,livemode) do update set status=excluded.status,controller=excluded.controller,
    capabilities=excluded.capabilities,requirements=excluded.requirements,future_requirements=excluded.future_requirements,details_submitted=excluded.details_submitted,
    charges_enabled=excluded.charges_enabled,payouts_enabled=excluded.payouts_enabled,verified_at=now()
  returning * into r;
  return to_jsonb(r);
end $$;

create function public.find_photographer_stripe_account(p_account_id text,p_livemode boolean default null)
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
    'status',a.status,'livemode',a.livemode,'migratedAt',p.stripe_standard_migrated_at)
    into result from public.photographer_stripe_accounts a join public.photographers p on p.id=a.photographer_id
    where a.stripe_account_id=p_account_id and (p_livemode is null or a.livemode=p_livemode);
  if result is not null then return result; end if;
  select jsonb_build_object('photographerId',p.id,'accountId',p_account_id,'status','active','livemode',null,'migratedAt',null)
    into result from public.photographers p where p.stripe_standard_migrated_at is null and
    coalesce(p.stripe_connected_account_id,p.stripe_account_id)=p_account_id;
  return result;
end $$;

create function public.sync_photographer_stripe_account_history(p_account jsonb,p_livemode boolean default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.photographer_stripe_accounts%rowtype; p public.photographers%rowtype;
  aid text:=p_account->>'id'; ready boolean:=public.stripe_standard_account_ready(p_account); active boolean;
begin
  if (select count(*) from public.photographer_stripe_accounts where stripe_account_id=aid and
    (p_livemode is null or livemode=p_livemode))>1 then
    raise exception 'The Stripe account environment is ambiguous.' using errcode='23514'; end if;
  select * into r from public.photographer_stripe_accounts where stripe_account_id=aid and
    (p_livemode is null or livemode=p_livemode);
  if r.id is null then return null; end if;
  select * into strict p from public.photographers where id=r.photographer_id for update;
  select * into strict r from public.photographer_stripe_accounts where id=r.id for update;
  if upper(coalesce(p_account->>'country',''))<>r.country then
    raise exception 'Stripe account country changed unexpectedly.' using errcode='23514';
  end if;
  update public.photographer_stripe_accounts set controller=coalesce(p_account->'controller','{}'),
    capabilities=coalesce(p_account->'capabilities','{}'),requirements=coalesce(p_account->'requirements','{}'),future_requirements=coalesce(p_account->'future_requirements','{}'),
    details_submitted=coalesce((p_account->>'details_submitted')::boolean,false),
    charges_enabled=coalesce((p_account->>'charges_enabled')::boolean,false),
    payouts_enabled=coalesce((p_account->>'payouts_enabled')::boolean,false),verified_at=now(),
    status=case when status in ('pending','ready') then case when ready then 'ready' else 'pending' end else status end
    where id=r.id;
  active:=r.status='active' and coalesce(p.stripe_connected_account_id,p.stripe_account_id)=aid and r.deauthorized_at is null;
  if active then update public.photographers set stripe_connect_onboarding_complete=
      coalesce((p_account->>'details_submitted')::boolean,false) and coalesce((p_account->>'charges_enabled')::boolean,false)
      and coalesce((p_account->>'payouts_enabled')::boolean,false),
      stripe_connect_charges_enabled=coalesce((p_account->>'charges_enabled')::boolean,false),
      stripe_connect_payouts_enabled=coalesce((p_account->>'payouts_enabled')::boolean,false) where id=p.id; end if;
  return jsonb_build_object('photographerId',p.id,'isActive',active);
end $$;

create function public.deauthorize_photographer_stripe_account(p_account_id text,p_livemode boolean)
returns void language plpgsql security definer set search_path=public as $$
declare r public.photographer_stripe_accounts%rowtype;
begin
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

create function public.get_photographer_checkout_routing(p_photographer_id uuid,p_currency text default 'cad',
  p_order_id uuid default null,p_previous_expired_session_id text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.photographers%rowtype; r public.photographer_stripe_accounts%rowtype;
  a public.order_payment_accounts%rowtype; aid text; c public.stripe_standard_live_release_controls%rowtype;
begin
  select * into strict p from public.photographers where id=p_photographer_id;
  if p_order_id is not null and p_previous_expired_session_id is null then
    select b.* into a from public.orders o join public.order_payment_accounts b on b.id=o.stripe_payment_account_binding_id
      where o.id=p_order_id and o.photographer_id=p.id and b.photographer_id=p.id;
    if a.id is not null then
      select * into r from public.photographer_stripe_accounts where stripe_account_id=a.stripe_account_id
        and photographer_id=p.id and (a.livemode is null or livemode=a.livemode);
      return jsonb_build_object('accountId',a.stripe_account_id,'routeVersion',a.route_version,
        'feeRateCents',null,'connectionType',coalesce(r.account_type,'express'),'livemode',a.livemode);
    end if;
  end if;
  aid:=coalesce(p.stripe_connected_account_id,p.stripe_account_id);
  if aid is null then raise exception 'The studio has no payment connection.' using errcode='23514'; end if;
  select * into r from public.photographer_stripe_accounts where photographer_id=p.id and stripe_account_id=aid and status='active';
  if p.stripe_standard_migrated_at is not null and r.id is null then
    raise exception 'The historical payment routing is unavailable.' using errcode='23514'; end if;
  if r.id is not null and (r.deauthorized_at is not null or not r.charges_enabled or not r.payouts_enabled) then
    raise exception 'The payment connection is unavailable.' using errcode='23514'; end if;
  if r.account_type='standard' and not public.stripe_standard_account_ready(jsonb_build_object(
    'type',r.account_type,'controller',r.controller,'capabilities',r.capabilities,'requirements',r.requirements,'future_requirements',r.future_requirements,
    'details_submitted',r.details_submitted,'charges_enabled',r.charges_enabled,'payouts_enabled',r.payouts_enabled)) then
    raise exception 'The Standard account is no longer ready for new orders.' using errcode='23514'; end if;
  if lower(p_currency) not in('usd','cad','eur','gbp','aud','aed','sar','amd') then
    raise exception 'Unsupported checkout currency.' using errcode='23514'; end if;
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

create function public.activate_photographer_standard_account(
  p_photographer_id uuid,p_actor_user_id uuid,p_account_id text,p_expected_current_account_id text,p_livemode boolean,p_provider_proof jsonb default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.photographers%rowtype; r public.photographer_stripe_accounts%rowtype; old_id text; historical record;
begin
  if p_livemode is null then raise exception 'Payment environment is required.' using errcode='23514'; end if;
  if p_livemode then
    perform public.assert_whitephoto_live_stripe_scope(p_photographer_id,p_actor_user_id,p_account_id,p_expected_current_account_id,p_provider_proof);
    if not exists(select 1 from public.stripe_standard_live_release_controls
      where release_key='whitephoto-20261015' and activation_enabled) then
      raise exception 'Live Standard activation is disabled during preparation.' using errcode='23514'; end if;
    if p_account_id<>'acct_1UQHR5LZhEC2SlmP' or p_expected_current_account_id<>'acct_1TIHTrLqg5vdCgpU' then
      raise exception 'Live activation direction is invalid.' using errcode='23514'; end if;
  end if;
  select * into strict p from public.photographers where id=p_photographer_id for update;
  if p_actor_user_id is null or p.user_id is distinct from p_actor_user_id then raise exception 'Studio ownership mismatch.' using errcode='42501'; end if;
  old_id:=coalesce(p.stripe_connected_account_id,p.stripe_account_id);
  if old_id is distinct from p_expected_current_account_id then raise exception 'The active account changed; refresh before continuing.' using errcode='23514'; end if;
  select * into r from public.photographer_stripe_accounts where photographer_id=p.id and stripe_account_id=p_account_id and livemode=p_livemode for update;
  if r.id is null or r.account_type<>'standard' or r.status not in ('ready','active') or r.deauthorized_at is not null
    or r.verified_at<now()-interval '5 minutes' or not public.stripe_standard_account_ready(jsonb_build_object(
      'type',r.account_type,'controller',r.controller,'capabilities',r.capabilities,'requirements',r.requirements,'future_requirements',r.future_requirements,
      'details_submitted',r.details_submitted,'charges_enabled',r.charges_enabled,'payouts_enabled',r.payouts_enabled)) then
    raise exception 'A freshly verified Standard account is required.' using errcode='23514'; end if;
  if coalesce(p.business_country,p.stripe_connect_country,r.country)<>r.country then raise exception 'Account country mismatch.' using errcode='23514'; end if;
  if old_id=p_account_id then return jsonb_build_object('accountId',p_account_id,'previousAccountId',old_id,'routeVersion',p.stripe_connect_route_version); end if;
  if old_id is not null and not exists(select 1 from public.photographer_stripe_accounts
    where photographer_id=p.id and stripe_account_id=old_id and livemode=p_livemode and status='active' and verified_at>=now()-interval '5 minutes') then
    raise exception 'The previous account must be freshly verified before switching.' using errcode='23514'; end if;
  if exists(select 1 from public.orders o where o.photographer_id=p.id and
    (o.stripe_checkout_session_id is not null or o.stripe_payment_intent_id is not null or o.status='checkout_starting')
    and (o.stripe_payment_account_binding_id is null or not exists(select 1 from public.order_payment_accounts a
      where a.id=o.stripe_payment_account_binding_id and a.photographer_id=p.id and o.id=any(a.order_ids)))) then
    raise exception 'Historical checkouts must be verified before switching.' using errcode='23514'; end if;
  if exists(select 1 from public.order_payment_accounts a where a.photographer_id=p.id
    and a.checkout_session_id is null and a.created_at<=now()-interval '23 hours') then
    raise exception 'An old unresolved checkout requires original provider reconciliation before switching.' using errcode='23514'; end if;
  -- Recheck complete saved scope inside the routing lock, including histories
  -- that changed after their bounded provider-backed backfill batch.
  for historical in select distinct on(o.stripe_payment_account_binding_id)
      o.id,o.order_group_id,o.stripe_checkout_session_id,o.stripe_payment_intent_id
    from public.orders o where o.photographer_id=p.id and o.stripe_payment_account_binding_id is not null
    order by o.stripe_payment_account_binding_id,o.id loop
    perform public.resolve_order_payment_account(p.id,historical.id,historical.order_group_id,
      historical.stripe_checkout_session_id,historical.stripe_payment_intent_id,null,p_livemode);
  end loop;
  update public.photographer_stripe_accounts set status='legacy' where photographer_id=p.id and livemode=p_livemode and status='active';
  update public.photographer_stripe_accounts set status='active',activated_at=coalesce(activated_at,now()) where id=r.id;
  update public.photographers set stripe_account_id=p_account_id,stripe_connected_account_id=p_account_id,
    stripe_standard_migrated_at=coalesce(stripe_standard_migrated_at,now()),stripe_connect_route_version=stripe_connect_route_version+1,
    stripe_connect_country=r.country,business_country=coalesce(business_country,r.country),
    stripe_connect_onboarding_complete=true,stripe_connect_charges_enabled=true,stripe_connect_payouts_enabled=true where id=p.id;
  return jsonb_build_object('accountId',p_account_id,'previousAccountId',old_id,'routeVersion',p.stripe_connect_route_version+1);
end $$;

create function public.rollback_photographer_standard_account(
  p_photographer_id uuid,p_actor_user_id uuid,p_account_id text,p_expected_current_account_id text,p_livemode boolean,p_provider_proof jsonb default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.photographers%rowtype; r public.photographer_stripe_accounts%rowtype; old_id text;
begin
  if p_livemode is null then raise exception 'Payment environment is required.' using errcode='23514'; end if;
  if p_livemode then
    perform public.assert_whitephoto_live_stripe_scope(p_photographer_id,p_actor_user_id,p_account_id,p_expected_current_account_id,p_provider_proof);
    if p_account_id<>'acct_1TIHTrLqg5vdCgpU' or p_expected_current_account_id<>'acct_1UQHR5LZhEC2SlmP' then
      raise exception 'Live rollback direction is invalid.' using errcode='23514'; end if;
  end if;
  select * into strict p from public.photographers where id=p_photographer_id for update;
  if p_actor_user_id is null or p.user_id is distinct from p_actor_user_id then raise exception 'Studio ownership mismatch.' using errcode='42501'; end if;
  old_id:=coalesce(p.stripe_connected_account_id,p.stripe_account_id);
  if old_id is distinct from p_expected_current_account_id then raise exception 'The active account changed; refresh before continuing.' using errcode='23514'; end if;
  select * into r from public.photographer_stripe_accounts where photographer_id=p.id and stripe_account_id=p_account_id and livemode=p_livemode for update;
  if r.id is null or r.status not in ('legacy','active') or r.deauthorized_at is not null or not r.charges_enabled or not r.payouts_enabled
    or r.verified_at<now()-interval '5 minutes' then raise exception 'The previous account is not ready.' using errcode='23514'; end if;
  if old_id=p_account_id then return jsonb_build_object('accountId',p_account_id,'previousAccountId',old_id,'routeVersion',p.stripe_connect_route_version); end if;
  update public.photographer_stripe_accounts set status='legacy' where photographer_id=p.id and livemode=p_livemode and status='active';
  update public.photographer_stripe_accounts set status='active' where id=r.id;
  update public.photographers set stripe_account_id=p_account_id,stripe_connected_account_id=p_account_id,
    stripe_connect_route_version=stripe_connect_route_version+1,stripe_connect_onboarding_complete=r.details_submitted and r.charges_enabled and r.payouts_enabled,
    stripe_connect_charges_enabled=r.charges_enabled,stripe_connect_payouts_enabled=r.payouts_enabled where id=p.id;
  return jsonb_build_object('accountId',p_account_id,'previousAccountId',old_id,'routeVersion',p.stripe_connect_route_version+1);
end $$;

-- Validate immutable provider scope against current saved orders before making
-- an API request. A historical row is proof of routing, never proof of payment.
create function public.resolve_order_payment_account(
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
  elsif p.stripe_standard_migrated_at is not null then
    raise exception 'The original Stripe account has not been verified.' using errcode='23514';
  end if;
  if p_expected_account is not null and p_expected_account is distinct from coalesce(a.stripe_account_id,p.stripe_connected_account_id,p.stripe_account_id) then
    raise exception 'The payment account does not match its saved checkout.' using errcode='23514'; end if;
  return coalesce(a.stripe_account_id,p.stripe_connected_account_id,p.stripe_account_id);
end $$;

-- GET-only deployment proof for the additive schema and its old-instance barrier.
create function public.stripe_account_history_schema_status() returns jsonb
language sql stable security definer set search_path=public as $$
  select jsonb_build_object('version','20261015010000',
    'history_schema_present',to_regclass('public.photographer_stripe_accounts') is not null
      and to_regclass('public.order_payment_accounts') is not null
      and to_regclass('public.stripe_standard_live_release_controls') is not null
      and exists(select 1 from information_schema.columns where table_schema='public'
        and table_name='photographer_stripe_accounts' and column_name='future_requirements')
      and exists(select 1 from public.stripe_standard_live_release_controls where release_key='whitephoto-20261015'),
    'reservation_guard_present',exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      join pg_namespace n on n.oid=p.pronamespace where t.tgrelid='public.orders'::regclass
      and t.tgname='protect_order_stripe_binding' and not t.tgisinternal and t.tgenabled in('O','A')
      and n.nspname='public' and p.proname='protect_order_stripe_account_binding'
      and position('reservation_required' in pg_get_functiondef(p.oid))>0
      and position('request_hash' in pg_get_functiondef(p.oid))>0));
$$;

-- Every exposed mutator is service-only, including server-side actor checks.
do $$ declare fn record; begin
  for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('stripe_account_history_schema_status','register_photographer_stripe_account','find_photographer_stripe_account',
      'assert_whitephoto_live_stripe_scope','sync_photographer_stripe_account_history','deauthorize_photographer_stripe_account','get_photographer_checkout_routing',
      'activate_photographer_standard_account','rollback_photographer_standard_account','resolve_order_payment_account') loop
    execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end $$;
