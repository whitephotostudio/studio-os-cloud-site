alter table public.schools
add column if not exists gallery_settings jsonb not null default '{}'::jsonb;
