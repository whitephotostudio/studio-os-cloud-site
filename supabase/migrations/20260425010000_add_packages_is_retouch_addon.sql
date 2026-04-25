-- 2026-04-26 — Mark certain packages as retouching add-ons.
--
-- Add-on packages are HIDDEN from the parents-portal main grid (where
-- parents kept clicking "Digital Retouching" thinking they were buying
-- digital photo files), and are instead surfaced via a popup upsell
-- modal that fires on every "Continue to Secure Checkout" click —
-- explicitly clarifying that retouching is a SERVICE, not digital files.
--
-- The auto-flag UPDATE at the end runs once on migration apply to mark
-- the existing "Retouching - 1 Image" / "Retouching - Multi Image"
-- packages without requiring photographer manual action.  Future
-- retouching packages get the flag set via the dashboard tickbox.

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS is_retouch_addon boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.packages.is_retouch_addon IS
  'When true, this package is hidden from the parents-portal main grid and surfaced only via the retouching upsell modal at checkout. Default false.';

UPDATE public.packages
SET is_retouch_addon = true
WHERE active = true
  AND name ILIKE 'retouch%';
