-- Disposable isolated Supabase acceptance fixture only. Never a production migration.
alter table public.subscriptions
  add column if not exists photographer_id uuid,
  add column if not exists status text,
  add column if not exists plan text,
  add column if not exists billing_interval text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_connected_account_id text,
  add column if not exists current_period_start timestamptz,
  add column if not exists current_period_end timestamptz,
  add column if not exists billing_email text,
  add column if not exists billing_currency text,
  add column if not exists extra_desktop_keys integer,
  add column if not exists updated_at timestamptz;
create unique index if not exists synthetic_subscription_user_unique on public.subscriptions(user_id);
alter table public.photographers add column if not exists studio_app_beta_access boolean default false;
alter table public.schools add column if not exists status text default 'active',add column if not exists portal_status text default 'active',add column if not exists expiration_date date;
alter table public.projects
  add column if not exists status text default 'active',add column if not exists portal_status text default 'active',
  add column if not exists access_mode text default 'pin',add column if not exists email_required boolean default false,
  add column if not exists gallery_settings jsonb default '{}',add column if not exists client_name text,
  add column if not exists order_due_date date,add column if not exists expiration_date date;
create table if not exists public.subjects(id uuid primary key default gen_random_uuid(),project_id uuid,external_ref text);
create table if not exists public.pre_release_emails(id uuid primary key default gen_random_uuid(),project_id uuid,email text);
create table if not exists public.collections(id uuid primary key default gen_random_uuid(),project_id uuid,title text,kind text,slug text,access_mode text,access_pin text,sort_order integer default 0,created_at timestamptz default now());
grant all on public.subjects,public.pre_release_emails,public.collections to service_role;
revoke all on public.subjects,public.pre_release_emails,public.collections from anon,authenticated;
-- Photography-key tables are created by the exact beta migration afterward;
-- the fixture runner then grants service-only access, as production does.
