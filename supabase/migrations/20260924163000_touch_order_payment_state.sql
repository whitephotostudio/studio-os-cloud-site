-- Incremental desktop sync must see payment changes on older orders too.
-- Run after protect_closed_order_payment_state so rejected stale updates
-- do not look like real financial changes.
create or replace function public.touch_order_payment_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if row(new.status, new.payment_status, new.refund_status, new.refund_amount_cents)
     is distinct from
     row(old.status, old.payment_status, old.refund_status, old.refund_amount_cents) then
    new.updated_at := clock_timestamp();
  end if;
  return new;
end $$;
revoke all on function public.touch_order_payment_updated_at() from public, anon, authenticated;
drop trigger if exists touch_order_payment_updated_at on public.orders;
create trigger touch_order_payment_updated_at before update on public.orders
for each row execute function public.touch_order_payment_updated_at();
