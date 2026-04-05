create table if not exists public.school_gallery_downloads (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  viewer_email text not null,
  download_type text not null default 'gallery',
  download_count integer not null default 0,
  media_ids text[] not null default '{}'::text[],
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists school_gallery_downloads_school_viewer_idx
  on public.school_gallery_downloads (school_id, viewer_email, created_at desc);

create index if not exists school_gallery_downloads_school_type_idx
  on public.school_gallery_downloads (school_id, download_type, created_at desc);

alter table public.school_gallery_downloads enable row level security;
