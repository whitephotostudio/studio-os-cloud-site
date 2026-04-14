-- Add free trial tracking columns to photographers table.
-- trial_starts_at: when the 1-month free trial begins (set on first dashboard visit after email confirmation).
-- trial_ends_at: when the trial expires (trial_starts_at + 1 month).
-- All new users get full Studio-level access during their trial.

alter table public.photographers
  add column if not exists trial_starts_at timestamptz,
  add column if not exists trial_ends_at   timestamptz;

-- Index for efficient trial-expiration queries and cron checks.
create index if not exists photographers_trial_ends_at_idx
  on public.photographers (trial_ends_at)
  where trial_ends_at is not null;

-- Comment for clarity.
comment on column public.photographers.trial_starts_at is 'Start of the 1-month free trial (set on first dashboard visit after email confirmation)';
comment on column public.photographers.trial_ends_at   is 'End of the 1-month free trial (trial_starts_at + interval 1 month)';
