-- iOS push notifications for new orders.
--
-- device_push_tokens: one row per (device) APNs token, owned by a photographer.
-- RLS is enabled with NO policies on purpose: these tokens are sensitive and
-- must never be readable from the browser. Every server route that touches this
-- table uses the service-role key (which bypasses RLS), so the table is
-- effectively service-role-only.
--
-- photographers.order_push_show_details: privacy switch for the lock-screen
-- banner. false (default) => generic "New order received."; true => include the
-- client name + amount.
--
-- This migration mirrors what was applied live on 2026-06-28; it is written
-- idempotently so it is safe to run against the live DB and fresh environments.

create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers (id) on delete cascade,
  token text not null unique,
  platform text not null default 'ios',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists device_push_tokens_photographer_id_idx
  on public.device_push_tokens (photographer_id);

alter table public.device_push_tokens enable row level security;

comment on table public.device_push_tokens is
  'APNs device tokens for new-order push. Service-role only (RLS on, no policies).';

alter table public.photographers
  add column if not exists order_push_show_details boolean not null default false;

comment on column public.photographers.order_push_show_details is
  'When true, new-order push banners include client name + amount; otherwise a generic message.';
