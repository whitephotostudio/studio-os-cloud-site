alter table public.photographers
  add column if not exists studio_app_beta_access boolean not null default false;

create table if not exists public.studio_app_releases (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  release_state text not null default 'hidden'
    check (release_state in ('hidden', 'beta', 'public')),
  version text,
  release_notes text,
  beta_warning text not null default 'Beta builds are intended for approved photographers only. Download links, activations, and workflows may change during rollout.',
  mac_download_url text,
  windows_download_url text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.studio_app_releases (
  slug,
  release_state,
  version,
  release_notes
)
values (
  'studio-os-flutter',
  'hidden',
  'Beta 0.1.0',
  'Upload the current Mac and Windows installer links here when the Studio OS Flutter beta is ready to distribute.'
)
on conflict (slug) do nothing;

create table if not exists public.photography_keys (
  id uuid primary key default gen_random_uuid(),
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  slot_index integer not null default 1,
  label text,
  key_code text not null unique,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'revoked')),
  is_extra_key boolean not null default false,
  last_validated_at timestamptz,
  last_activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists photography_keys_photographer_slot_idx
  on public.photography_keys (photographer_id, slot_index)
  where status <> 'revoked';

create index if not exists photography_keys_photographer_status_idx
  on public.photography_keys (photographer_id, status, slot_index);

create table if not exists public.photography_key_activations (
  id uuid primary key default gen_random_uuid(),
  photography_key_id uuid not null references public.photography_keys(id) on delete cascade,
  device_id text not null,
  device_name text,
  platform text,
  app_version text,
  status text not null default 'active'
    check (status in ('active', 'deactivated')),
  activated_at timestamptz not null default now(),
  last_validated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (photography_key_id, device_id)
);

create unique index if not exists photography_key_activations_one_active_idx
  on public.photography_key_activations (photography_key_id)
  where status = 'active';

create index if not exists photography_key_activations_device_idx
  on public.photography_key_activations (device_id, status);
