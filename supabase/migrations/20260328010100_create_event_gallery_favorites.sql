create table if not exists public.event_gallery_favorites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  media_id uuid not null references public.media(id) on delete cascade,
  collection_id uuid null references public.collections(id) on delete set null,
  viewer_email text not null,
  viewer_key text not null,
  created_at timestamptz not null default now(),
  unique (project_id, media_id, viewer_key)
);

create index if not exists event_gallery_favorites_project_idx
  on public.event_gallery_favorites (project_id, viewer_key, created_at desc);

create index if not exists event_gallery_favorites_media_idx
  on public.event_gallery_favorites (media_id);

alter table public.event_gallery_favorites enable row level security;
