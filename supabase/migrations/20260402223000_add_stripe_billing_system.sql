create table if not exists public.stripe_events (
  id text primary key,
  event_type text not null,
  stripe_account text,
  livemode boolean not null default false,
  payload jsonb,
  processed_at timestamptz not null default now()
);

alter table public.photographers
  add column if not exists stripe_connected_account_id text,
  add column if not exists stripe_connect_onboarding_complete boolean not null default false,
  add column if not exists stripe_connect_charges_enabled boolean not null default false,
  add column if not exists stripe_connect_payouts_enabled boolean not null default false,
  add column if not exists stripe_platform_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_item_base_id text,
  add column if not exists stripe_subscription_item_extra_keys_id text,
  add column if not exists stripe_subscription_item_usage_id text,
  add column if not exists subscription_plan_code text,
  add column if not exists subscription_current_period_start timestamptz,
  add column if not exists subscription_current_period_end timestamptz,
  add column if not exists billing_email text,
  add column if not exists billing_currency text default 'cad',
  add column if not exists order_usage_rate_cents integer not null default 25,
  add column if not exists extra_desktop_keys integer not null default 0;

update public.photographers
set
  stripe_connected_account_id = coalesce(stripe_connected_account_id, stripe_account_id),
  billing_email = coalesce(billing_email, studio_email),
  billing_currency = coalesce(nullif(lower(billing_currency), ''), 'cad'),
  extra_desktop_keys = coalesce(extra_desktop_keys, 0),
  order_usage_rate_cents = coalesce(order_usage_rate_cents, 25)
where true;

create unique index if not exists photographers_stripe_connected_account_id_key
  on public.photographers (stripe_connected_account_id)
  where stripe_connected_account_id is not null;

create unique index if not exists photographers_stripe_platform_customer_id_key
  on public.photographers (stripe_platform_customer_id)
  where stripe_platform_customer_id is not null;

create unique index if not exists photographers_stripe_subscription_id_key
  on public.photographers (stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.orders
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_status text,
  add column if not exists counted_for_monthly_usage boolean not null default false,
  add column if not exists monthly_usage_billing_period text,
  add column if not exists refund_status text,
  add column if not exists is_test boolean not null default false;

update public.orders
set
  payment_status = case
    when status in ('paid', 'digital_paid') then 'paid'
    when status = 'payment_pending' then 'pending'
    else coalesce(payment_status, 'unpaid')
  end,
  paid_at = case
    when paid_at is not null then paid_at
    when status in ('paid', 'digital_paid') then created_at
    else paid_at
  end,
  is_test = coalesce(is_test, false)
where true;

create index if not exists orders_stripe_payment_intent_id_idx
  on public.orders (stripe_payment_intent_id);

create index if not exists orders_stripe_checkout_session_id_idx
  on public.orders (stripe_checkout_session_id);

create index if not exists orders_monthly_usage_idx
  on public.orders (photographer_id, counted_for_monthly_usage, monthly_usage_billing_period);

alter table public.subscriptions
  add column if not exists photographer_id uuid references public.photographers(id) on delete set null,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_connected_account_id text,
  add column if not exists current_period_start timestamptz,
  add column if not exists current_period_end timestamptz,
  add column if not exists billing_email text,
  add column if not exists billing_currency text default 'cad',
  add column if not exists extra_desktop_keys integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

update public.subscriptions s
set
  photographer_id = p.id,
  billing_currency = coalesce(nullif(lower(s.billing_currency), ''), 'cad'),
  extra_desktop_keys = coalesce(s.extra_desktop_keys, 0),
  updated_at = coalesce(s.updated_at, now())
from public.photographers p
where p.user_id = s.user_id
  and s.photographer_id is null;

create unique index if not exists subscriptions_stripe_subscription_id_key
  on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.studio_credits
  add column if not exists photographer_id uuid references public.photographers(id) on delete set null;

update public.studio_credits sc
set photographer_id = p.id
from public.photographers p
where p.user_id = sc.studio_id
  and sc.photographer_id is null;

create index if not exists studio_credits_photographer_id_idx
  on public.studio_credits (photographer_id);

alter table public.credit_transactions
  add column if not exists photographer_id uuid references public.photographers(id) on delete set null,
  add column if not exists credits_delta integer,
  add column if not exists credit_transaction_type text,
  add column if not exists source text,
  add column if not exists source_reference_id text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text;

update public.credit_transactions ct
set
  photographer_id = p.id,
  credits_delta = coalesce(ct.credits_delta, ct.amount),
  credit_transaction_type = coalesce(ct.credit_transaction_type, ct.type),
  source = coalesce(
    ct.source,
    case
      when ct.type = 'purchase' then 'purchase'
      when ct.type = 'usage' then 'usage'
      when ct.type = 'refund' then 'refund'
      else 'manual_adjustment'
    end
  )
from public.photographers p
where p.user_id = ct.studio_id
  and (ct.photographer_id is null or ct.credits_delta is null or ct.credit_transaction_type is null or ct.source is null);

create index if not exists credit_transactions_source_reference_idx
  on public.credit_transactions (source_reference_id);

create index if not exists credit_transactions_photographer_id_idx
  on public.credit_transactions (photographer_id, created_at desc);

alter table public.credit_packages
  add column if not exists package_code text;

create unique index if not exists credit_packages_package_code_key
  on public.credit_packages (package_code);

insert into public.credit_packages (
  id,
  name,
  credits,
  price_cents,
  active,
  sort_order,
  created_at,
  package_code
)
values
  ('7bfc8311-1085-4f0d-a3be-6f48f126ceb2', 'Background Credits 250', 250, 1250, true, 1, now(), 'background_credits_250'),
  ('898c98b4-fd4f-4d71-bd60-29c52b4f3cbc', 'Background Credits 1000', 1000, 4500, true, 2, now(), 'background_credits_1000'),
  ('8b5d035d-b8c4-4760-a40e-58a60ea956ef', 'Background Credits 5000', 5000, 17500, true, 3, now(), 'background_credits_5000')
on conflict (package_code) do update
set
  name = excluded.name,
  credits = excluded.credits,
  price_cents = excluded.price_cents,
  active = excluded.active,
  sort_order = excluded.sort_order;

update public.credit_packages
set active = false
where package_code is null
  and active = true;
