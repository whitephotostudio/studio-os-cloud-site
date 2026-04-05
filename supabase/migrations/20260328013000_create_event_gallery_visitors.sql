create table if not exists public.event_gallery_visitors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  viewer_email text not null,
  created_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  unique (project_id, viewer_email)
);

create index if not exists event_gallery_visitors_project_idx
  on public.event_gallery_visitors (project_id, last_opened_at desc);

alter table public.event_gallery_visitors enable row level security;
