begin;

-- PostgREST emits `ON CONFLICT (dedupe_key)` for the delivery-ledger upsert.
-- PostgreSQL cannot infer a partial unique index for that conflict target, so
-- the original `where dedupe_key is not null` index caused every recorded
-- school campaign delivery to fail with SQLSTATE 42P10 after Resend accepted
-- the message. A normal unique index still allows any number of NULL values
-- while making non-NULL delivery keys safe for atomic retry/upsert handling.
drop index if exists public.project_email_deliveries_dedupe_idx;

create unique index project_email_deliveries_dedupe_idx
  on public.project_email_deliveries (dedupe_key);

commit;
