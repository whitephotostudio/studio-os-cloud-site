-- photographers.seen_features
--
-- Per-photographer dismissal log for the "what's new" blue-dot system.
-- An array of feature ids the photographer has clicked / interacted with.
-- Append-only from the client's perspective: once a feature id is in this
-- array, the blue dot for that feature never reappears for that user.
--
-- The list of features is defined in code (lib/whats-new.ts), so adding
-- a new feature dot is purely a code change — no DB migration required
-- per release. This column just records who has dismissed which.

alter table public.photographers
  add column if not exists seen_features jsonb not null default '[]'::jsonb;

comment on column public.photographers.seen_features is
  'Array of feature ids (text) the photographer has acknowledged via the WhatsNewDot UI. Append-only from clients via /api/dashboard/whats-new/seen. Source of truth for which features still show a blue dot for a given user.';
