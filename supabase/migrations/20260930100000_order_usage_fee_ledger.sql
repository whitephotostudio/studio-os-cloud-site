-- Immutable service-fee requests survive payment webhooks, cycle changes and
-- provider timeouts. Only the service role can report or adjust owner revenue.
create table if not exists public.order_usage_fees (
  order_id uuid primary key references public.orders(id) on delete restrict,
  photographer_id uuid not null references public.photographers(id) on delete restrict,
  stripe_customer_id text not null,
  event_name text not null,
  event_identifier text not null unique,
  usage_timestamp bigint not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null,
  billing_period text not null,
  report_status text not null default 'pending' check (report_status in ('pending','processing','reported','waived','review_required')),
  report_first_attempt_at timestamptz,
  reported_at timestamptz,
  refund_requested_at timestamptz,
  refund_status text not null default 'none' check (refund_status in ('none','pending','processing','completed','review_required')),
  refund_strategy text check (refund_strategy in ('cancel_meter_event','invoice_credit')),
  refund_first_attempt_at timestamptz,
  refund_completed_at timestamptz,
  stripe_adjustment_id text,
  lock_token uuid,
  lock_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.order_usage_fees enable row level security;
revoke all on public.order_usage_fees from anon, authenticated;
grant all on public.order_usage_fees to service_role;
create index if not exists order_usage_fees_pending_idx on public.order_usage_fees(photographer_id, report_status, refund_status);

create or replace function public.stage_order_usage_fee(
  p_order_id uuid, p_photographer_id uuid, p_customer_id text, p_event_name text,
  p_usage_timestamp bigint, p_amount_cents integer, p_currency text, p_billing_period text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype; v_fee public.order_usage_fees%rowtype;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.photographer_id is distinct from p_photographer_id then
    raise exception 'Order does not belong to this studio';
  end if;
  select * into v_fee from public.order_usage_fees where order_id=p_order_id;
  if found then return to_jsonb(v_fee); end if;
  -- Historical reported fees have no verified amount snapshot; never invent a
  -- refund amount or post them a second time.
  if v_order.counted_for_monthly_usage is true then return null; end if;
  if v_order.is_test is true or v_order.paid_at is null or
     lower(coalesce(v_order.payment_status,'')) not in ('paid','succeeded','partially_refunded') or
     lower(coalesce(v_order.refund_status,''))='refunded' or
     coalesce(v_order.total_cents,0)<=0 then return null; end if;
  insert into public.order_usage_fees(order_id,photographer_id,stripe_customer_id,event_name,event_identifier,
    usage_timestamp,amount_cents,currency,billing_period)
  values(p_order_id,p_photographer_id,p_customer_id,p_event_name,'studio-os-usage-order-'||p_order_id,
    p_usage_timestamp,p_amount_cents,lower(p_currency),p_billing_period)
  returning * into v_fee;
  return to_jsonb(v_fee);
end $$;

create or replace function public.claim_order_usage_fee(p_order_id uuid,p_operation text,p_token uuid,p_refund_strategy text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fee public.order_usage_fees%rowtype;
begin
  select * into v_fee from public.order_usage_fees where order_id=p_order_id for update;
  if not found or (v_fee.lock_expires_at>now()) then return null; end if;
  if p_operation='report' then
    if v_fee.report_status not in ('pending','processing') then return null; end if;
    update public.order_usage_fees set report_status='processing',
      report_first_attempt_at=coalesce(report_first_attempt_at,now()),lock_token=p_token,
      lock_expires_at=now()+interval '2 minutes',updated_at=now() where order_id=p_order_id returning * into v_fee;
  elsif p_operation='refund' then
    if v_fee.report_status<>'reported' or v_fee.refund_status not in ('pending','processing') then return null; end if;
    update public.order_usage_fees set refund_status='processing',
      refund_strategy=coalesce(refund_strategy,p_refund_strategy),
      refund_first_attempt_at=coalesce(refund_first_attempt_at,now()),lock_token=p_token,
      lock_expires_at=now()+interval '2 minutes',updated_at=now() where order_id=p_order_id returning * into v_fee;
  else raise exception 'Invalid fee operation'; end if;
  return to_jsonb(v_fee);
end $$;

create or replace function public.complete_order_usage_fee_report(p_order_id uuid,p_token uuid,p_reported_at timestamptz default now())
returns void language plpgsql security definer set search_path = public as $$
declare v_fee public.order_usage_fees%rowtype;
begin
  update public.order_usage_fees set report_status='reported',reported_at=coalesce(reported_at,p_reported_at),
    lock_token=null,lock_expires_at=null,updated_at=now()
  where order_id=p_order_id and lock_token=p_token and report_status='processing' returning * into v_fee;
  if found then
    update public.orders set counted_for_monthly_usage=true,monthly_usage_billing_period=v_fee.billing_period where id=p_order_id;
  end if;
end $$;

create or replace function public.request_order_usage_fee_refund()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(new.refund_status,''))='refunded' or lower(coalesce(new.payment_status,''))='refunded' then
    update public.order_usage_fees set refund_requested_at=coalesce(refund_requested_at,now()),
      refund_status=case when refund_status='none' then 'pending' else refund_status end,updated_at=now()
    where order_id=new.id;
  end if;
  return new;
end $$;
drop trigger if exists request_order_usage_fee_refund on public.orders;
create trigger request_order_usage_fee_refund after update of refund_status,payment_status on public.orders
for each row execute function public.request_order_usage_fee_refund();

revoke all on function public.stage_order_usage_fee(uuid,uuid,text,text,bigint,integer,text,text) from public,anon,authenticated;
revoke all on function public.claim_order_usage_fee(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.complete_order_usage_fee_report(uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.request_order_usage_fee_refund() from public,anon,authenticated;
grant execute on function public.stage_order_usage_fee(uuid,uuid,text,text,bigint,integer,text,text) to service_role;
grant execute on function public.claim_order_usage_fee(uuid,text,uuid,text) to service_role;
grant execute on function public.complete_order_usage_fee_report(uuid,uuid,timestamptz) to service_role;
