-- Add default_package_profile_id to photographers
-- Used to auto-assign a price sheet when creating new events or
-- when a school/gallery doesn't have an explicit price sheet set.
alter table public.photographers
  add column if not exists default_package_profile_id uuid;

comment on column public.photographers.default_package_profile_id
  is 'The photographer''s preferred default price sheet, auto-applied to new events and used as fallback for schools/galleries without an explicit sheet.';
