-- Adds an opt-in flag per backdrop indicating whether the backdrop scenery
-- works in landscape orientation. Parents-portal exposes a Portrait/Landscape
-- toggle inside the CHOOSE BACKDROP panel only when this flag is true on
-- the active backdrop. Default false keeps every existing backdrop in its
-- current portrait-only behavior.

ALTER TABLE public.backdrop_catalog
  ADD COLUMN IF NOT EXISTS supports_landscape boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.backdrop_catalog.supports_landscape IS
  'When true, parents can toggle Portrait/Landscape orientation in the backdrop picker. Default false (portrait only). Set per backdrop in the dashboard backdrop manager.';
