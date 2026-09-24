-- Transactional order creation + durable response replay. Never grant these
-- service-only operations to browser/desktop database roles.
create table if not exists public.checkout_attempts (
  key text primary key, payload_hash text not null, response jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists checkout_attempts_hash_created_idx on public.checkout_attempts(payload_hash,created_at);
alter table public.checkout_attempts enable row level security;
revoke all on public.checkout_attempts from anon, authenticated;
grant all on public.checkout_attempts to service_role;

create or replace function public.create_checkout_order_once(
  p_key text, p_hash text, p_orders jsonb, p_items jsonb, p_response jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare saved public.checkout_attempts; o jsonb; i jsonb;
begin
  -- Also serialize identical cart submissions from two tabs/devices. The
  -- explicit attempt key protects long retries; this short content window
  -- catches independently generated keys for the same accidental submission.
  perform pg_advisory_xact_lock(hashtextextended(p_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_key, 1));
  select * into saved from public.checkout_attempts where key = p_key;
  if found then
    if saved.payload_hash <> p_hash then raise exception 'Checkout contents changed; reload your cart.'; end if;
    return saved.response;
  end if;
  select * into saved from public.checkout_attempts where payload_hash = p_hash
    and created_at > now() - interval '10 minutes' order by created_at limit 1;
  if found then
    insert into public.checkout_attempts(key,payload_hash,response) values(p_key,p_hash,saved.response);
    return saved.response;
  end if;
  if jsonb_array_length(p_orders) < 1 or jsonb_array_length(p_items) < 1 then raise exception 'Empty checkout'; end if;
  for o in select value from jsonb_array_elements(p_orders) loop
    insert into public.orders (id, photographer_id, parent_name, parent_email, parent_phone,
      customer_name, customer_email, package_id, package_name, package_price,
      special_notes, notes, status, payment_status, seen_by_photographer, subtotal_cents,
      tax_cents, total_cents, total_amount, currency, cart_snapshot, school_id, class_id,
      student_id, project_id, order_group_id)
    values ((o->>'id')::uuid, (o->>'photographer_id')::uuid, o->>'parent_name', o->>'parent_email', o->>'parent_phone',
      o->>'customer_name', o->>'customer_email', (o->>'package_id')::uuid, o->>'package_name', (o->>'package_price')::numeric,
      o->>'special_notes', o->>'notes', 'payment_pending', 'pending', false, (o->>'subtotal_cents')::integer,
      (o->>'tax_cents')::integer, (o->>'total_cents')::integer, (o->>'total_amount')::numeric, o->>'currency',
      o->'cart_snapshot', (o->>'school_id')::uuid, (o->>'class_id')::uuid,
      (o->>'student_id')::uuid, (o->>'project_id')::uuid, (o->>'order_group_id')::uuid);
  end loop;
  for i in select value from jsonb_array_elements(p_items) loop
    insert into public.order_items (order_id, product_name, quantity, price, unit_price_cents, line_total_cents, sku)
    values ((i->>'order_id')::uuid, i->>'product_name', (i->>'quantity')::integer,
      (i->>'price')::numeric, (i->>'unit_price_cents')::integer, (i->>'line_total_cents')::integer, i->>'sku');
  end loop;
  insert into public.checkout_attempts(key, payload_hash, response) values (p_key, p_hash, p_response);
  return p_response;
end $$;
revoke all on function public.create_checkout_order_once(text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_checkout_order_once(text,text,jsonb,jsonb,jsonb) to service_role;

-- Serialize session creation with cancellation/refund for the entire checkout.
create table if not exists public.order_payment_locks (
  key text primary key, token uuid not null, expires_at timestamptz not null
);
alter table public.order_payment_locks enable row level security;
revoke all on public.order_payment_locks from anon, authenticated;
grant all on public.order_payment_locks to service_role;
create or replace function public.acquire_order_payment_lock(p_key text, p_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.order_payment_locks(key,token,expires_at) values(p_key,p_token,now()+interval '2 minutes')
  on conflict(key) do update set token=excluded.token,expires_at=excluded.expires_at
  where order_payment_locks.expires_at < now();
  return found;
end $$;
revoke all on function public.acquire_order_payment_lock(text,uuid) from public, anon, authenticated;
grant execute on function public.acquire_order_payment_lock(text,uuid) to service_role;

-- A stale desktop, delayed payment webhook, or in-flight fulfillment update
-- must never put a cancelled/refunded order back into production.
create or replace function public.protect_closed_order_payment_state()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'refunded' then
    new.status := old.status;
    new.payment_status := old.payment_status;
    new.refund_status := old.refund_status;
    new.refund_amount_cents := greatest(old.refund_amount_cents, new.refund_amount_cents);
  end if;
  if old.status in ('cancelled','canceled','cancel_pending','refunded','refund_pending') and
     new.status not in ('cancelled','canceled','cancel_pending','refunded','refund_pending') then
    new.status := old.status;
    new.payment_status := old.payment_status;
    new.refund_status := old.refund_status;
  end if;
  if old.payment_status in ('paid','succeeded','no_payment_required','refunded','partially_refunded') and
     new.payment_status in ('pending','failed') then new.payment_status := old.payment_status; end if;
  return new;
end $$;
drop trigger if exists protect_closed_order_payment_state on public.orders;
create trigger protect_closed_order_payment_state before update on public.orders
for each row execute function public.protect_closed_order_payment_state();
