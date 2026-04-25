-- 2026-04-25 hotfix: parents-portal combined-orders endpoint was failing
-- with HTTP 400 "Failed to create combined order. Please try again."
-- The root cause was a Postgres BEFORE INSERT trigger on `orders`
-- (`trg_orders_set_photographer_id` → `set_orders_photographer_id()`)
-- that unconditionally called `current_photographer_id()`, which queries
-- `auth.uid()`. The parents-portal endpoints insert as service role
-- (no JWT user), so auth.uid() returned NULL and the trigger raised
-- "No photographer profile for this user", killing the request.
--
-- Fix: branch on auth.uid().
--   • Authenticated dashboard inserts → force photographer_id from
--     current_photographer_id(), preserving the original
--     tenant-isolation property (request body cannot override it).
--   • Service-role inserts (parents portal, Stripe webhook fan-out,
--     maintenance scripts) → trust the explicit photographer_id but
--     require it to be present.
--
-- Both /api/portal/orders/create and /api/portal/orders/create-combined
-- already resolve photographer_id from the school row before the insert,
-- so this is a no-op in their happy path.

CREATE OR REPLACE FUNCTION public.set_orders_photographer_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
  if auth.uid() is not null then
    -- Authenticated dashboard insert: force photographer_id from the
    -- logged-in user context (defense in depth — request body cannot
    -- override the tenant binding).
    new.photographer_id := public.current_photographer_id();
    if new.photographer_id is null then
      raise exception 'No photographer profile for this user';
    end if;
  else
    -- Service-role insert (parents portal, webhooks, scripts).  Trust
    -- the explicit photographer_id but require it to be present.
    if new.photographer_id is null then
      raise exception 'photographer_id is required (service-role insert)';
    end if;
  end if;
  return new;
end;
$$;
