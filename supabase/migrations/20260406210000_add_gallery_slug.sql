-- Add gallery_slug for short public gallery URLs (like ShootProof)
alter table public.projects
  add column if not exists gallery_slug text;

alter table public.schools
  add column if not exists gallery_slug text;

-- Create unique index so slugs are globally unique across projects
create unique index if not exists idx_projects_gallery_slug
  on public.projects (gallery_slug)
  where gallery_slug is not null;

-- Create unique index so slugs are globally unique across schools
create unique index if not exists idx_schools_gallery_slug
  on public.schools (gallery_slug)
  where gallery_slug is not null;
