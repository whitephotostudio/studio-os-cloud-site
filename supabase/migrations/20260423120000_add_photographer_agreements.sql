-- photographer_agreements
--
-- Audit table capturing a photographer's acceptance of each versioned legal
-- agreement they're required to consent to before using Studio OS Cloud.
-- Rows are append-only by design: every acceptance is preserved so we can
-- prove who agreed to what, when, and from where, in case of a dispute.
--
-- The check that gates dashboard access is: "does this user have at least
-- one row matching the current agreement_version?"

create table if not exists public.photographer_agreements (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  agreement_version text not null,
  terms_version text not null,
  privacy_version text not null,
  accepted_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

comment on table public.photographer_agreements is
  'Audit log of photographer consent to Studio OS Cloud legal agreements. Append-only. One row per (user_id, agreement_version) accept event.';

comment on column public.photographer_agreements.agreement_version is
  'The master "agreement bundle" version the photographer is accepting, e.g. 2026-04-v1. Changing this in app code forces every user to re-accept on next load.';

comment on column public.photographer_agreements.terms_version is
  'Version of /terms at acceptance time.';

comment on column public.photographer_agreements.privacy_version is
  'Version of /privacy at acceptance time.';

comment on column public.photographer_agreements.ip_address is
  'Captured from x-forwarded-for / request headers at accept time. Best-effort audit trail.';

comment on column public.photographer_agreements.user_agent is
  'Browser/OS string captured at accept time. Best-effort audit trail.';

create index if not exists photographer_agreements_photographer_version_idx
  on public.photographer_agreements (photographer_id, agreement_version);

create index if not exists photographer_agreements_user_version_idx
  on public.photographer_agreements (user_id, agreement_version);

alter table public.photographer_agreements enable row level security;

-- Photographers can read their own acceptance history. Nothing else.
create policy "Photographers read own agreements"
  on public.photographer_agreements
  for select
  using (user_id = auth.uid());

-- Photographers can insert their own acceptance. user_id must match auth.uid()
-- so nobody can accept on another user's behalf.
create policy "Photographers insert own agreements"
  on public.photographer_agreements
  for insert
  with check (user_id = auth.uid());

-- Deliberately no UPDATE or DELETE policy: acceptance rows are append-only.
-- Service role (used by API routes) still has full access.
