alter table public.projects
add column if not exists gallery_settings jsonb not null default '{}'::jsonb;
