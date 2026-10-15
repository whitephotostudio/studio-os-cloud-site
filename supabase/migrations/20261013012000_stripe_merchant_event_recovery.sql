-- Recover signed account/refund/dispute events without consuming a webhook
-- before its effects finish. This ledger is separate from platform billing.
create table if not exists public.stripe_merchant_events (
  event_id text primary key,
  stripe_account_id text not null,
  livemode boolean not null,
  event_type text not null,
  payload_hash text not null,
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','processing','processed','review')),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stripe_merchant_events_retry_idx on public.stripe_merchant_events(next_attempt_at,event_id)
  where status in ('pending','processing');
alter table public.stripe_merchant_events enable row level security;
revoke all on public.stripe_merchant_events from public,anon,authenticated;
grant all on public.stripe_merchant_events to service_role;

create or replace function public.claim_stripe_merchant_event(p_event_id text,p_account text,p_livemode boolean,
  p_event_type text,p_payload_hash text,p_payload jsonb,p_token uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare current_event public.stripe_merchant_events;
begin
  if length(p_event_id) not between 1 and 255 or p_account !~ '^acct_[A-Za-z0-9_]+$' or p_livemode is null or p_token is null or
    p_event_type not in ('account.updated','account.application.deauthorized','charge.refunded','refund.updated','refund.failed',
      'charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_withdrawn',
      'charge.dispute.funds_reinstated','application_fee.refunded','application_fee.refund.updated') or
    length(p_payload_hash)<>64 or jsonb_typeof(p_payload)<>'object' or p_payload->>'id' is distinct from p_event_id or
    p_payload->>'type' is distinct from p_event_type or (p_payload->>'livemode')::boolean is distinct from p_livemode then
    raise exception 'Invalid merchant event';
  end if;
  insert into public.stripe_merchant_events(event_id,stripe_account_id,livemode,event_type,payload_hash,payload)
    values(p_event_id,p_account,p_livemode,p_event_type,p_payload_hash,p_payload) on conflict(event_id) do nothing;
  select * into current_event from public.stripe_merchant_events where event_id=p_event_id for update;
  if current_event.stripe_account_id<>p_account or current_event.livemode<>p_livemode or
    current_event.event_type<>p_event_type or current_event.payload_hash<>p_payload_hash then
    raise exception 'Merchant event identity changed';
  end if;
  if current_event.status='processed' then return 'processed'; end if;
  if current_event.status='review' then return 'review'; end if;
  if current_event.status='processing' and current_event.lease_until>now() then return 'busy'; end if;
  update public.stripe_merchant_events set status='processing',lease_token=p_token,lease_until=now()+interval '5 minutes',
    next_attempt_at=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() where event_id=p_event_id;
  return 'claimed';
end $$;
revoke all on function public.claim_stripe_merchant_event(text,text,boolean,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.claim_stripe_merchant_event(text,text,boolean,text,text,jsonb,uuid) to service_role;

create or replace function public.finish_stripe_merchant_event(p_event_id text,p_token uuid,p_result text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_result not in ('processed','pending','review') then raise exception 'Invalid merchant event result'; end if;
  update public.stripe_merchant_events set status=p_result,lease_token=null,lease_until=null,
    processed_at=case when p_result='processed' then now() else null end,
    next_attempt_at=case when p_result='pending' then now()+interval '1 minute' else next_attempt_at end,updated_at=now()
    where event_id=p_event_id and lease_token=p_token and status='processing';
  return found;
end $$;
revoke all on function public.finish_stripe_merchant_event(text,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_stripe_merchant_event(text,uuid,text) to service_role;

-- The latest provider-verified dispute state is recorded without issuing a
-- refund or altering an order's purchased items/fulfillment state.
create table if not exists public.stripe_merchant_disputes (
  stripe_account_id text not null,
  dispute_id text not null,
  photographer_id uuid not null references public.photographers(id),
  payment_intent_id text not null,
  charge_id text not null,
  livemode boolean not null,
  status text not null,
  amount_cents bigint not null check(amount_cents>=0),
  currency text not null,
  evidence_due_at timestamptz,
  observed_at timestamptz not null,
  verified_at timestamptz not null,
  primary key(stripe_account_id,dispute_id)
);
alter table public.stripe_merchant_disputes enable row level security;
revoke all on public.stripe_merchant_disputes from public,anon,authenticated;
grant all on public.stripe_merchant_disputes to service_role;

create or replace function public.guard_verified_merchant_dispute()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.photographer_id<>old.photographer_id or new.payment_intent_id<>old.payment_intent_id or
    new.charge_id<>old.charge_id or new.livemode<>old.livemode then
    raise exception 'Verified dispute ownership is immutable';
  end if;
  -- A slower earlier GET must not overwrite a later observation. Stripe also
  -- documents late wins (lost -> won); allow those while preventing delayed
  -- open-state snapshots from reopening a closed decision.
  if new.observed_at<old.observed_at or (old.status='won' and new.status<>'won') or
    (old.status='lost' and new.status not in ('lost','won')) or
    (old.status='warning_closed' and new.status<>'warning_closed') then return null; end if;
  return new;
end $$;
drop trigger if exists stripe_merchant_dispute_monotonic_update on public.stripe_merchant_disputes;
create trigger stripe_merchant_dispute_monotonic_update before update on public.stripe_merchant_disputes
  for each row execute function public.guard_verified_merchant_dispute();
