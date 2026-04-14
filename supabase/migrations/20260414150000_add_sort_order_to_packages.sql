-- Add sort_order to packages for drag-to-reorder support
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS sort_order integer;

COMMENT ON COLUMN public.packages.sort_order
  IS 'Manual display order set by drag-and-drop reordering. Lower numbers appear first.';
