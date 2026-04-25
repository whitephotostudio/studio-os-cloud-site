-- 2026-04-25 — capture the full cart entry payload at order-create time so
-- the parents portal can offer a one-click "Reorder" button.  Without
-- this we'd have to reverse-engineer the cart from order_items rows,
-- which only have product_name + quantity + sku — not enough to
-- reconstruct backdrop selections, slot assignments, composite settings,
-- or orientation.
--
-- Shape: array of objects matching the EntryPayload schema in
-- /api/portal/orders/create + /create-combined:
--   [{
--     packageId, packageName, quantity, backdrop?, slots[], orientation,
--     selectedImageUrl, isComposite, compositeTitle
--   }, ...]
--
-- Nullable: legacy orders predate this column and stay nullable forever.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cart_snapshot jsonb;

COMMENT ON COLUMN public.orders.cart_snapshot IS
  'Full cart entry payload captured at order creation. Powers the parents-portal one-click reorder. Nullable — pre-2026-04-25 orders do not have it.';
