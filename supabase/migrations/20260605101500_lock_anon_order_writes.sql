-- 2026-06-05 hotfix: stop stale parent-gallery deployments from creating
-- placeholder order rows through the public anon key.
--
-- Current checkout creates orders only through:
--   /api/portal/orders/create
--   /api/portal/orders/create-combined
-- Those routes use the service role and compute totals server-side.  The
-- browser no longer needs INSERT/UPDATE/DELETE on orders or order_items.

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Drop legacy anonymous parent-order write policies if they exist on the
-- remote database.  Several names are included because the earliest schema
-- history was imported as placeholders and policy names differ by deploy.
drop policy if exists "parent_place_order" on public.orders;
drop policy if exists "Parent place order" on public.orders;
drop policy if exists "Parents can place orders" on public.orders;
drop policy if exists "Parents can insert orders" on public.orders;
drop policy if exists "Anon can insert orders" on public.orders;
drop policy if exists "Anon can create orders" on public.orders;
drop policy if exists "Public can insert orders" on public.orders;
drop policy if exists "Public can create orders" on public.orders;
drop policy if exists "Parent update own order" on public.orders;
drop policy if exists "Parents can update orders" on public.orders;
drop policy if exists "Anon can update orders" on public.orders;

drop policy if exists "parent_place_order_items" on public.order_items;
drop policy if exists "Parent place order items" on public.order_items;
drop policy if exists "Parents can place order items" on public.order_items;
drop policy if exists "Parents can insert order items" on public.order_items;
drop policy if exists "Anon can insert order items" on public.order_items;
drop policy if exists "Anon can create order items" on public.order_items;
drop policy if exists "Public can insert order items" on public.order_items;
drop policy if exists "Public can create order items" on public.order_items;
drop policy if exists "Parent update own order items" on public.order_items;
drop policy if exists "Parents can update order items" on public.order_items;
drop policy if exists "Anon can update order items" on public.order_items;

-- Defense in depth: remove table-level write grants for anon.  Service role
-- still bypasses RLS/grants, and authenticated photographers keep their
-- existing scoped dashboard policies.
revoke insert, update, delete on table public.orders from anon;
revoke insert, update, delete on table public.order_items from anon;
