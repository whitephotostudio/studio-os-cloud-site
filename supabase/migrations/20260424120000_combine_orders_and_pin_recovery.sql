-- Combine Orders + PIN Recovery — Phase 1 migration
--
-- Spec: docs/design/combine-orders-and-recovery.md
--
-- Adds:
--   · orders.order_group_id                — groups orders placed in one combined checkout
--   · photographers.sibling_discount_tiers — tiered discount config
--   · photographers.shipping_fee_cents     — flat per-studio shipping fee
--   · photographers.late_handling_fee_percent — % handling fee after order_due_date
--   · schools.archive_date                 — (projects.archive_date + schools.archive_date)
--   · projects.archive_date                   for "last chance" past-year urgency copy
--   · students.parent_email                — strong identity link for recovery flow
--   · pin_recovery_attempts table          — rate limit + audit log (append-only)
--   · pin_recovery_requests table          — Tier 3 photographer-assisted recovery queue
--   · pin_recovery_tokens table            — single-use signed tokens for self-service recovery
--
-- Pre-existing columns skipped to avoid collision:
--   · schools.order_due_date   (timestamptz, already exists)
--   · projects.order_due_date  (date, already exists)
--
-- RLS: photographer_agreements-style — service-role-only writes, photographer SELECT
-- where appropriate. No public reads.

-- ── 1. Orders: group key ─────────────────────────────────────────────────────

alter table public.orders
  add column if not exists order_group_id uuid null;

comment on column public.orders.order_group_id is
  'Non-null when this order was placed as part of a combined checkout (multiple students in one cart). All orders in the same group share one payment + one shipping fee. Payment webhook updates every row sharing this id to paid simultaneously.';

create index if not exists orders_order_group_id_idx
  on public.orders (order_group_id)
  where order_group_id is not null;

-- ── 2. Photographers: studio-wide commerce knobs ────────────────────────────

alter table public.photographers
  add column if not exists sibling_discount_tiers jsonb
    not null default '{"2": 5, "3": 10}'::jsonb,
  add column if not exists shipping_fee_cents integer
    not null default 0,
  add column if not exists late_handling_fee_percent numeric(5,2)
    not null default 10.0;

comment on column public.photographers.sibling_discount_tiers is
  'Tiered sibling-combine discount config. Keys are kid counts (as strings because jsonb), values are percent-off applied to EACH additional kid''s subtotal beyond the first. Default: 2 kids = 5%, 3+ kids = 10%. Photographer edits in studio settings.';
comment on column public.photographers.shipping_fee_cents is
  'Flat shipping fee charged per combined order group when the parent picks Ship (not School Pickup). Never discounted by sibling logic. In cents.';
comment on column public.photographers.late_handling_fee_percent is
  'Percent handling fee applied on top of shipping when a parent orders AFTER the school/event order_due_date. 10% by default. Applied to the pre-shipping product subtotal.';

-- ── 3. Schools & projects: archive-date urgency ─────────────────────────────

alter table public.schools
  add column if not exists archive_date timestamptz null;

comment on column public.schools.archive_date is
  '"Last chance" date for the past-year flow. When non-null and within ~30 days, the past-year tab in the parents drawer shows urgency copy: "Archived on [date] — last chance for [year] photos."';

alter table public.projects
  add column if not exists archive_date timestamptz null;

comment on column public.projects.archive_date is
  'Event equivalent of schools.archive_date — used by the past-year tab.';

-- ── 4. Students: parent_email for strong identity match ─────────────────────

alter table public.students
  add column if not exists parent_email text null;

comment on column public.students.parent_email is
  'Parent contact email captured during roster import. Used by the PIN-recovery flow as a STRONG identity match: typed_email must equal this value. When null, the flow falls back to the pre-registration (pre_release_registrations / pre_release_emails) check which is softer but still gated by the in-gallery drawer.';

create index if not exists students_parent_email_idx
  on public.students (lower(parent_email))
  where parent_email is not null;

-- ── 5. pin_recovery_attempts (rate limit + audit log) ───────────────────────

create table if not exists public.pin_recovery_attempts (
  id uuid primary key default gen_random_uuid(),
  -- Captured context (all nullable because a brute-force attempt may not
  -- match any real student — we still want the row for rate limiting).
  ip_address text,
  user_agent text,
  photographer_id uuid references public.photographers(id) on delete cascade,
  student_id uuid references public.students(id) on delete set null,
  -- What the user typed (lowercased). Useful for spotting patterns.
  email_tried text,
  first_name_tried text,
  last_name_tried text,
  school_id_tried uuid,
  project_id_tried uuid,
  -- Outcome.
  succeeded boolean not null default false,
  failure_reason text, -- 'no_student_match' | 'email_not_registered' | 'email_mismatch' | 'rate_limited' | 'photographer_fallback' | 'internal_error'
  created_at timestamptz not null default now()
);

comment on table public.pin_recovery_attempts is
  'Append-only log of every PIN recovery attempt. Doubles as the rate-limit table (queries by ip_address + created_at within the last 15 minutes). RLS: photographers can read their own, service role writes.';

create index if not exists pin_recovery_attempts_ip_recent_idx
  on public.pin_recovery_attempts (ip_address, created_at desc)
  where ip_address is not null;
create index if not exists pin_recovery_attempts_student_recent_idx
  on public.pin_recovery_attempts (student_id, created_at desc)
  where student_id is not null;
create index if not exists pin_recovery_attempts_photographer_idx
  on public.pin_recovery_attempts (photographer_id, created_at desc)
  where photographer_id is not null;

alter table public.pin_recovery_attempts enable row level security;

create policy "Photographers read own recovery attempts"
  on public.pin_recovery_attempts
  for select
  using (
    photographer_id in (
      select id from public.photographers where user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policy: service role only.

-- ── 6. pin_recovery_requests (Tier 3 photographer-assisted queue) ───────────

create table if not exists public.pin_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  student_id uuid null references public.students(id) on delete set null,
  parent_email text not null,
  -- Best-effort captured context so the photographer can resolve without follow-up.
  typed_first_name text,
  typed_last_name text,
  typed_school_label text,
  school_id uuid null references public.schools(id) on delete set null,
  project_id uuid null references public.projects(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  photographer_note text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null references public.photographers(id) on delete set null
);

comment on table public.pin_recovery_requests is
  'Tier 3 fallback: surfaces in /dashboard/admin/recovery-requests when a parent''s recovery attempt fails door #3 (email not pre-registered) or when no roster parent_email is available. Photographer one-click resolves by sending a recovery token.';

create index if not exists pin_recovery_requests_photographer_status_idx
  on public.pin_recovery_requests (photographer_id, status, requested_at desc);

alter table public.pin_recovery_requests enable row level security;

create policy "Photographers read own recovery requests"
  on public.pin_recovery_requests
  for select
  using (
    photographer_id in (
      select id from public.photographers where user_id = auth.uid()
    )
  );

create policy "Photographers update own recovery requests"
  on public.pin_recovery_requests
  for update
  using (
    photographer_id in (
      select id from public.photographers where user_id = auth.uid()
    )
  )
  with check (
    photographer_id in (
      select id from public.photographers where user_id = auth.uid()
    )
  );

-- Service role inserts (from the portal API when the recovery fails at door 3).

-- ── 7. pin_recovery_tokens (single-use magic link) ──────────────────────────

create table if not exists public.pin_recovery_tokens (
  id uuid primary key default gen_random_uuid(),
  -- Stored as SHA-256 hex of the plaintext token. The plaintext is only
  -- ever held in memory long enough to email it; never persisted.
  token_hash text not null unique,
  student_id uuid not null references public.students(id) on delete cascade,
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  parent_email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null,
  ip_used text,
  user_agent_used text,
  -- Optional link back to a Tier 3 request if a photographer approved this.
  manual_request_id uuid null references public.pin_recovery_requests(id) on delete set null
);

comment on table public.pin_recovery_tokens is
  'Single-use signed tokens for PIN recovery. Issued either by the automated 5-door check in /api/portal/recovery/request or manually by a photographer from the Tier 3 dashboard. Token plaintext is emailed once; only the hash is stored. Validated + consumed by /api/portal/recovery/claim.';

create index if not exists pin_recovery_tokens_active_idx
  on public.pin_recovery_tokens (expires_at)
  where used_at is null;

alter table public.pin_recovery_tokens enable row level security;

-- No client-side policy — tokens are issued + consumed exclusively by
-- service-role API routes. The absence of policies blocks all other access.
