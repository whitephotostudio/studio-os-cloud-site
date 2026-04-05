create table if not exists public.project_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  photographer_id uuid references public.photographers(id) on delete set null,
  recipient_email text not null,
  email_type text not null,
  dedupe_key text,
  resend_email_id text,
  subject text,
  status text not null default 'sent',
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  sent_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists project_email_deliveries_dedupe_idx
  on public.project_email_deliveries (dedupe_key)
  where dedupe_key is not null;

create index if not exists project_email_deliveries_project_idx
  on public.project_email_deliveries (project_id, sent_at desc);

create index if not exists project_email_deliveries_order_idx
  on public.project_email_deliveries (order_id, sent_at desc);

alter table public.project_email_deliveries enable row level security;
