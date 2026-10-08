-- Prospective Connect application fees. NULL collection method keeps every
-- historical order and its existing monthly usage/refund ledger unchanged.
begin;

alter table public.orders
  add column if not exists platform_fee_collection_method text,
  add column if not exists platform_fee_amount_cents integer,
  add column if not exists platform_fee_currency text,
  add column if not exists platform_fee_rate_cents integer,
  add column if not exists stripe_application_fee_id text;

alter table public.orders drop constraint if exists orders_platform_fee_snapshot_valid;
alter table public.orders add constraint orders_platform_fee_snapshot_valid check (
  case when platform_fee_collection_method is null then
    platform_fee_amount_cents is null and platform_fee_currency is null and
    platform_fee_rate_cents is null and stripe_application_fee_id is null
  else
    platform_fee_collection_method in ('connect_application_fee','waived') and
    platform_fee_amount_cents is not null and platform_fee_amount_cents >= 0 and
    platform_fee_rate_cents is not null and platform_fee_rate_cents >= 0 and
    platform_fee_currency is not null and platform_fee_currency ~ '^[a-z]{3}$' and
    ((platform_fee_collection_method='waived' and platform_fee_amount_cents=0) or
     (platform_fee_collection_method='connect_application_fee' and platform_fee_amount_cents>0 and platform_fee_amount_cents=platform_fee_rate_cents)) and
    (stripe_application_fee_id is null or
      (platform_fee_collection_method='connect_application_fee' and stripe_application_fee_id ~ '^fee_[A-Za-z0-9]+$'))
  end
);

create or replace function public.protect_order_platform_fee_snapshot()
returns trigger language plpgsql set search_path = public as $$
declare field text; before_row jsonb; after_row jsonb:=to_jsonb(new);
begin
  before_row:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  -- Keep invoker identity: a desktop/browser must not waive its own fee or
  -- substitute an amount. Trusted service-only RPCs retain their SQL identity.
  if current_user in ('authenticated','anon') then
    foreach field in array array['platform_fee_collection_method','platform_fee_amount_cents',
      'platform_fee_currency','platform_fee_rate_cents','stripe_application_fee_id'] loop
      if coalesce(before_row->field,'null'::jsonb) is distinct from coalesce(after_row->field,'null'::jsonb) then
        raise exception 'Order service fees can only be changed by Studio OS billing.' using errcode='42501';
      end if;
    end loop;
  end if;
  if tg_op='UPDATE' then
    if old.platform_fee_collection_method is not null then
      foreach field in array array['platform_fee_collection_method','platform_fee_amount_cents',
        'platform_fee_currency','platform_fee_rate_cents'] loop
        if (before_row->field) is distinct from (after_row->field) then
          raise exception 'The order service-fee snapshot is already frozen.' using errcode='23514';
        end if;
      end loop;
    elsif new.platform_fee_collection_method is not null then
      -- Old/uncertain checkouts must keep their original collection policy.
      if old.paid_at is not null or old.counted_for_monthly_usage is true or
        lower(coalesce(old.payment_status,'')) in ('paid','succeeded','no_payment_required','partially_refunded','refunded') or
        lower(coalesce(old.refund_status,'')) in ('refunded','partially_refunded') or
        nullif(before_row->>'stripe_checkout_session_id','') is not null or
        nullif(before_row->>'stripe_payment_intent_id','') is not null or
        nullif(before_row->>'stripe_charge_id','') is not null or
        lower(coalesce(before_row->>'status','')) in
          ('checkout_starting','cancelled','canceled','cancel_pending','refunded','refund_pending','paid','ready','completed') or
        exists(select 1 from public.order_usage_fees where order_id=old.id) then
        raise exception 'This historical checkout must retain monthly service-fee billing.' using errcode='23514';
      end if;
    end if;
    if old.stripe_application_fee_id is not null and old.stripe_application_fee_id is distinct from new.stripe_application_fee_id then
      raise exception 'The Stripe application-fee reference is already recorded.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.protect_order_platform_fee_snapshot() from public,anon,authenticated;
drop trigger if exists protect_order_platform_fee_snapshot on public.orders;
create trigger protect_order_platform_fee_snapshot before insert or update on public.orders
for each row execute function public.protect_order_platform_fee_snapshot();

-- Freeze an entire combined checkout atomically under the caller's existing
-- payment lock. A failure in any row rolls back every row in this RPC.
create or replace function public.freeze_order_platform_fees(p_photographer_id uuid,p_snapshots jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ids uuid[]; expected integer; distinct_ids integer; locked integer; snapshot jsonb; saved jsonb;
begin
  if p_photographer_id is null or jsonb_typeof(p_snapshots) is distinct from 'array' or jsonb_array_length(p_snapshots)<1 then
    raise exception 'An owned order service-fee snapshot is required';
  end if;
  if exists(select 1 from jsonb_array_elements(p_snapshots) where
    jsonb_typeof(value) is distinct from 'object' or
    coalesce(value->>'platform_fee_collection_method','') not in ('connect_application_fee','waived')) then
    raise exception 'A complete direct or waived order service-fee snapshot is required';
  end if;
  select array_agg((value->>'id')::uuid),count(*),count(distinct (value->>'id')::uuid)
    into ids,expected,distinct_ids from jsonb_array_elements(p_snapshots);
  if expected<>distinct_ids then raise exception 'Duplicate or missing order service-fee IDs'; end if;
  perform id from public.orders where id=any(ids) order by id for update;
  get diagnostics locked = row_count;
  if locked<>expected or exists(select 1 from public.orders where id=any(ids) and photographer_id is distinct from p_photographer_id) then
    raise exception 'Order service-fee snapshots do not belong to this studio';
  end if;
  for snapshot in select value from jsonb_array_elements(p_snapshots) loop
    update public.orders set
      platform_fee_collection_method=snapshot->>'platform_fee_collection_method',
      platform_fee_amount_cents=(snapshot->>'platform_fee_amount_cents')::integer,
      platform_fee_currency=snapshot->>'platform_fee_currency',
      platform_fee_rate_cents=(snapshot->>'platform_fee_rate_cents')::integer
    where id=(snapshot->>'id')::uuid;
  end loop;
  select jsonb_agg(to_jsonb(o) order by o.id) into saved from public.orders o where id=any(ids);
  return saved;
end $$;
revoke all on function public.freeze_order_platform_fees(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.freeze_order_platform_fees(uuid,jsonb) to service_role;

create or replace function public.stage_order_usage_fee(
  p_order_id uuid,p_photographer_id uuid,p_customer_id text,p_event_name text,
  p_usage_timestamp bigint,p_amount_cents integer,p_currency text,p_billing_period text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype; v_fee public.order_usage_fees%rowtype;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.photographer_id is distinct from p_photographer_id then
    raise exception 'Order does not belong to this studio';
  end if;
  select * into v_fee from public.order_usage_fees where order_id=p_order_id;
  if found then return to_jsonb(v_fee); end if;
  -- Direct and waived orders must never acquire a second monthly charge.
  if v_order.platform_fee_collection_method is not null then return null; end if;
  -- Preserve historical counted orders and every existing ledger snapshot.
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
revoke all on function public.stage_order_usage_fee(uuid,uuid,text,text,bigint,integer,text,text) from public,anon,authenticated;
grant execute on function public.stage_order_usage_fee(uuid,uuid,text,text,bigint,integer,text,text) to service_role;

-- Stable, service-only GET probe: no synthetic checkout, order or charge.
create or replace function public.order_platform_fee_schema_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version','20261007010000',
    'columns_present',(select count(*)=5 from information_schema.columns where table_schema='public' and table_name='orders'
      and column_name in ('platform_fee_collection_method','platform_fee_amount_cents','platform_fee_currency','platform_fee_rate_cents','stripe_application_fee_id')),
    'constraint_present',exists(select 1 from pg_constraint where conrelid='public.orders'::regclass and conname='orders_platform_fee_snapshot_valid'),
    'snapshot_guard_present',exists(select 1 from pg_trigger where tgrelid='public.orders'::regclass and tgname='protect_order_platform_fee_snapshot' and tgenabled<>'D'),
    'legacy_usage_guard_present',position('v_order.platform_fee_collection_method is not null' in
      pg_get_functiondef('public.stage_order_usage_fee(uuid,uuid,text,text,bigint,integer,text,text)'::regprocedure))>0,
    'atomic_freeze_present',to_regprocedure('public.freeze_order_platform_fees(uuid,jsonb)') is not null
  );
$$;
revoke all on function public.order_platform_fee_schema_status() from public,anon,authenticated;
grant execute on function public.order_platform_fee_schema_status() to service_role;

notify pgrst,'reload schema';
commit;
