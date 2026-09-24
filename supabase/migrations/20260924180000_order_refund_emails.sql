-- Durable, service-only delivery ledger. Financial actions never depend on
-- an email provider being available, and webhook retries reuse each message.
create table public.order_refund_emails (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  photographer_id uuid not null,
  order_ids uuid[] not null,
  stripe_account_id text not null,
  stripe_refund_id text not null,
  audience text not null check (audience in ('client','photographer')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','needs_review')),
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  resend_email_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (stripe_account_id, stripe_refund_id, audience)
);
alter table public.order_refund_emails enable row level security;
revoke all on public.order_refund_emails from public, anon, authenticated;
grant all on public.order_refund_emails to service_role;
create index order_refund_emails_pending_idx on public.order_refund_emails(next_attempt_at) where status in ('pending','sending');

create or replace function public.claim_order_refund_emails(p_ids uuid[] default null, p_limit integer default 10)
returns setof public.order_refund_emails language plpgsql security definer set search_path = public as $$
begin
  -- Resend retains idempotency keys for 24h. Ambiguous old attempts need
  -- provider reconciliation, never an automatic send with an expired key.
  update public.order_refund_emails set status='needs_review', last_error='Delivery needs provider reconciliation before retry.', lease_token=null, lease_until=null
    where status in ('pending','sending') and first_attempt_at < now()-interval '23 hours'
      and (lease_until is null or lease_until < now()) and (p_ids is null or id=any(p_ids));
  return query
  with candidates as (
    select id from public.order_refund_emails
    where status in ('pending','sending') and next_attempt_at <= now()
      and (lease_until is null or lease_until < now())
      and (p_ids is null or id=any(p_ids))
    order by created_at,id limit greatest(1,least(p_limit,10)) for update skip locked
  )
  update public.order_refund_emails e
  set status='sending', lease_token=gen_random_uuid(), lease_until=now()+interval '5 minutes',
    first_attempt_at=coalesce(e.first_attempt_at,now()), attempts=e.attempts+1
  from candidates c where e.id=c.id returning e.*;
end $$;
revoke all on function public.claim_order_refund_emails(uuid[],integer) from public, anon, authenticated;
grant execute on function public.claim_order_refund_emails(uuid[],integer) to service_role;
