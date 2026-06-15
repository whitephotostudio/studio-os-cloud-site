create table if not exists public.school_gallery_favorites (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  media_id text not null,
  viewer_email text not null,
  viewer_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (school_id, media_id, viewer_key)
);

create index if not exists school_gallery_favorites_school_idx
  on public.school_gallery_favorites (school_id, viewer_key, created_at desc);

create index if not exists school_gallery_favorites_media_idx
  on public.school_gallery_favorites (school_id, media_id);

alter table public.school_gallery_favorites enable row level security;
