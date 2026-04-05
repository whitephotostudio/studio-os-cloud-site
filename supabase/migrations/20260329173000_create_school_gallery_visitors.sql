create table if not exists public.school_gallery_visitors (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  viewer_email text not null,
  created_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  unique (school_id, viewer_email)
);

create index if not exists school_gallery_visitors_school_idx
  on public.school_gallery_visitors (school_id, last_opened_at desc);

alter table public.school_gallery_visitors enable row level security;
