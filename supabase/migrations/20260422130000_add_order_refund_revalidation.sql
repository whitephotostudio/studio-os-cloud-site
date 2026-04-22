-- Round 10: Refund revalidation
-- Adds refunded_at timestamp + refund_amount_cents to orders so we can tell
-- dashboards, print queues, and audit reports exactly when and how much was
-- refunded.  Backfills existing refunded rows using updated_at as a best-effort
-- approximation; new refunds will be stamped precisely by the Stripe webhook.

alter table public.orders
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_amount_cents integer;

-- Backfill historic refunded rows with their updated_at so reporting queries
-- filtering by refunded_at don't miss them.  Leaves already-stamped rows
-- alone.
update public.orders
  set refunded_at = coalesce(refunded_at, updated_at)
  where refund_status in ('refunded', 'partially_refunded')
    and refunded_at is null;

create index if not exists orders_refunded_at_idx
  on public.orders (refunded_at)
  where refunded_at is not null;

comment on column public.orders.refunded_at is
  'Timestamp of the most recent refund event (full or partial).  Set by the Stripe charge.refunded webhook.';
comment on column public.orders.refund_amount_cents is
  'Total amount refunded across all refund events for this order, in cents.';
