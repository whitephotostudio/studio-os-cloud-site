-- Add focal point columns for cover photo cropping on projects and collections
alter table public.projects
  add column if not exists cover_focal_x real not null default 0.5,
  add column if not exists cover_focal_y real not null default 0.5;

alter table public.collections
  add column if not exists cover_focal_x real not null default 0.5,
  add column if not exists cover_focal_y real not null default 0.5;
