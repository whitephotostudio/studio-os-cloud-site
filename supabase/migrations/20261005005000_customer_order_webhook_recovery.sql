-- Customer order events need a recoverable claim, not an insert-only dedupe
-- row. Platform credits and refunds keep their separate fulfillment ledgers.
create table if not exists public.customer_order_webhooks (
  event_id text primary key,
  order_id uuid not null,
  stripe_account_id text not null,
  event_type text not null,
  payload_hash text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'review')),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_order_webhooks_retry_idx
  on public.customer_order_webhooks(next_attempt_at, event_id) where status in ('pending', 'processing');
alter table public.customer_order_webhooks enable row level security;
revoke all on public.customer_order_webhooks from public, anon, authenticated;
grant all on public.customer_order_webhooks to service_role;

create or replace function public.claim_customer_order_webhook(
  p_event_id text, p_order_id uuid, p_account text, p_event_type text,
  p_payload_hash text, p_payload jsonb, p_token uuid
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare current_event public.customer_order_webhooks;
begin
  if length(p_event_id) not between 1 and 255 or p_account not like 'acct_%' or
     p_event_type not in ('checkout.session.completed', 'checkout.session.async_payment_succeeded',
       'payment_intent.succeeded', 'payment_intent.payment_failed') or
     length(p_payload_hash) <> 64 or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid customer payment event';
  end if;
  insert into public.customer_order_webhooks(event_id,order_id,stripe_account_id,event_type,payload_hash,payload)
    values(p_event_id,p_order_id,p_account,p_event_type,p_payload_hash,p_payload)
    on conflict(event_id) do nothing;
  select * into current_event from public.customer_order_webhooks where event_id=p_event_id for update;
  if current_event.order_id <> p_order_id or current_event.stripe_account_id <> p_account or
     current_event.event_type <> p_event_type or current_event.payload_hash <> p_payload_hash then
    raise exception 'Customer payment event identity changed';
  end if;
  if current_event.status='processed' then return 'processed'; end if;
  if current_event.status='review' then return 'review'; end if;
  if current_event.status='processing' and current_event.lease_until > now() then return 'busy'; end if;
  update public.customer_order_webhooks set status='processing', lease_token=p_token,
    lease_until=now()+interval '5 minutes', next_attempt_at=now()+interval '5 minutes',
    attempts=attempts+1, updated_at=now(), last_error=null where event_id=p_event_id;
  return 'claimed';
end $$;
revoke all on function public.claim_customer_order_webhook(text,uuid,text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.claim_customer_order_webhook(text,uuid,text,text,text,jsonb,uuid) to service_role;

create or replace function public.finish_customer_order_webhook(p_event_id text, p_token uuid, p_result text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_result not in ('processed','pending','review') then raise exception 'Invalid customer payment result'; end if;
  update public.customer_order_webhooks set status=p_result, lease_token=null, lease_until=null,
    processed_at=case when p_result='processed' then now() else null end,
    next_attempt_at=case when p_result='pending' then now()+interval '1 minute' else next_attempt_at end,
    last_error=case when p_result='pending' then 'Payment processing interrupted; retry scheduled.'
      when p_result='review' then 'Payment identity did not match the saved order; review required.' else null end,
    updated_at=now()
    where event_id=p_event_id and lease_token=p_token and status='processing';
  return found;
end $$;
revoke all on function public.finish_customer_order_webhook(text,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_customer_order_webhook(text,uuid,text) to service_role;

-- Rotate pending checks so a page of abandoned/unpaid sessions cannot starve
-- later paid orders. No customer order state is changed by selecting work.
create table if not exists public.customer_order_payment_checks (
  order_id uuid primary key,
  checked_at timestamptz not null default now()
);
alter table public.customer_order_payment_checks enable row level security;
revoke all on public.customer_order_payment_checks from public, anon, authenticated;
grant all on public.customer_order_payment_checks to service_role;
create or replace function public.claim_pending_customer_order_payment_checks(p_limit integer default 20)
returns table(id uuid,photographer_id uuid,order_group_id uuid,stripe_checkout_session_id text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare candidate record;
begin
  perform pg_advisory_xact_lock(hashtextextended('customer-order-payment-checks', 0));
  for candidate in
    select o.id,o.photographer_id,o.order_group_id,o.stripe_checkout_session_id
    from public.orders o left join public.customer_order_payment_checks c on c.order_id=o.id
    where o.status in ('payment_pending','checkout_starting') and o.paid_at is null and
      o.stripe_checkout_session_id is not null and o.updated_at <= now()-interval '2 minutes' and
      (c.checked_at is null or c.checked_at < now()-interval '2 minutes')
    order by c.checked_at asc nulls first,o.updated_at asc,o.id asc limit greatest(1,least(20,p_limit))
  loop
    insert into public.customer_order_payment_checks(order_id,checked_at) values(candidate.id,now())
      on conflict(order_id) do update set checked_at=excluded.checked_at;
    id:=candidate.id; photographer_id:=candidate.photographer_id;
    order_group_id:=candidate.order_group_id; stripe_checkout_session_id:=candidate.stripe_checkout_session_id;
    return next;
  end loop;
end $$;
revoke all on function public.claim_pending_customer_order_payment_checks(integer) from public,anon,authenticated;
grant execute on function public.claim_pending_customer_order_payment_checks(integer) to service_role;
