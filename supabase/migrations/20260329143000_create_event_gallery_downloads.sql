create table if not exists public.event_gallery_downloads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  collection_id uuid references public.collections(id) on delete set null,
  viewer_email text not null,
  download_type text not null default 'gallery',
  download_count integer not null default 0,
  media_ids text[] not null default '{}'::text[],
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists event_gallery_downloads_project_viewer_idx
  on public.event_gallery_downloads (project_id, viewer_email, created_at desc);

create index if not exists event_gallery_downloads_project_type_idx
  on public.event_gallery_downloads (project_id, download_type, created_at desc);

alter table public.event_gallery_downloads enable row level security;
