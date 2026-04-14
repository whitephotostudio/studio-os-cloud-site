-- Add composites_enabled toggle to package_profiles
-- When enabled, packages in this price sheet can include composite/class photo items
-- that auto-fill with the student's class composite during ordering.
ALTER TABLE public.package_profiles
  ADD COLUMN IF NOT EXISTS composites_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.package_profiles.composites_enabled
  IS 'When true, packages in this profile can include composite items that auto-fill with the class composite photo during client ordering.';
