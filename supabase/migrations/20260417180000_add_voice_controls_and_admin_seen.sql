-- Studio Assistant — admin-controlled premium voice (ElevenLabs) access.
--
-- Per-photographer access is OFF by default; the platform admin grants it
-- one user at a time from /dashboard/admin/users. Each grant has a
-- monthly character cap that the TTS endpoint enforces server-side.
-- Admins (is_platform_admin = true) bypass both checks.
--
-- Also tracks when the admin last visited the admin users page so the
-- sidebar can show a badge with the count of new signups since that time.

alter table public.photographers
  add column if not exists voice_premium_enabled boolean not null default false,
  add column if not exists voice_monthly_char_limit integer not null default 1000,
  add column if not exists voice_chars_used_this_month integer not null default 0,
  add column if not exists voice_usage_period_start timestamptz not null default now(),
  add column if not exists admin_seen_users_at timestamptz;

-- Constraints — no negatives, sane upper bound (50k chars/month is plenty for
-- any single user; admins are exempt from the cap entirely).
alter table public.photographers
  drop constraint if exists photographers_voice_monthly_char_limit_chk;
alter table public.photographers
  add constraint photographers_voice_monthly_char_limit_chk
  check (voice_monthly_char_limit >= 0 and voice_monthly_char_limit <= 1000000);

alter table public.photographers
  drop constraint if exists photographers_voice_chars_used_chk;
alter table public.photographers
  add constraint photographers_voice_chars_used_chk
  check (voice_chars_used_this_month >= 0);

-- Indexes for the admin queries.
create index if not exists photographers_voice_premium_enabled_idx
  on public.photographers (voice_premium_enabled)
  where voice_premium_enabled = true;

create index if not exists photographers_created_at_idx
  on public.photographers (created_at);

comment on column public.photographers.voice_premium_enabled is
  'Whether this photographer can use the ElevenLabs premium voice. Off by default; admin-granted.';
comment on column public.photographers.voice_monthly_char_limit is
  'Monthly character budget for premium voice. 0 = no usage allowed even if enabled. Admins bypass this cap.';
comment on column public.photographers.voice_chars_used_this_month is
  'Running counter; reset to 0 when voice_usage_period_start rolls into a new month.';
comment on column public.photographers.voice_usage_period_start is
  'Start of the current monthly window for premium-voice usage tracking.';
comment on column public.photographers.admin_seen_users_at is
  'Last time the platform admin opened the admin users page; used to badge new signups.';
