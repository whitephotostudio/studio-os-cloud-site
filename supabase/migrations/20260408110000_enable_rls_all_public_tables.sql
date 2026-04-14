-- ═══════════════════════════════════════════════════════════════════════════
-- Enable RLS on ALL public tables that were missing it.
-- Service-role calls (API routes, webhooks, cron) bypass RLS automatically.
-- Client-side calls (dashboard browser, Flutter app, parents portal) obey
-- these policies.
--
-- Only includes tables confirmed to exist via CREATE TABLE or ALTER TABLE
-- in prior migrations. Tables that may not exist are skipped.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── photographers ───────────────────────────────────────────────────────────

alter table public.photographers enable row level security;

-- Photographers can read their own record
drop policy if exists "Photographer reads own record" on public.photographers;
create policy "Photographer reads own record"
  on public.photographers for select
  using (user_id = auth.uid());

-- Photographers can update their own record
drop policy if exists "Photographer updates own record" on public.photographers;
create policy "Photographer updates own record"
  on public.photographers for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── orders ──────────────────────────────────────────────────────────────────

alter table public.orders enable row level security;

-- Photographers can CRUD their own orders
drop policy if exists "Photographer manages own orders" on public.orders;
create policy "Photographer manages own orders"
  on public.orders for all
  using (
    photographer_id in (
      select id from public.photographers where user_id = auth.uid()
    )
  );

-- Parents portal: anonymous read access to orders
drop policy if exists "Anon can read orders" on public.orders;
create policy "Anon can read orders"
  on public.orders for select
  using (true);

-- ── order_items ─────────────────────────────────────────────────────────────

alter table public.order_items enable row level security;

-- Photographers can manage items on their own orders
drop policy if exists "Photographer manages own order items" on public.order_items;
create policy "Photographer manages own order items"
  on public.order_items for all
  using (
    order_id in (
      select id from public.orders
      where photographer_id in (
        select id from public.photographers where user_id = auth.uid()
      )
    )
  );

-- Parents portal: read items for their order
drop policy if exists "Anon can read order items" on public.order_items;
create policy "Anon can read order items"
  on public.order_items for select
  using (true);

-- ── packages ────────────────────────────────────────────────────────────────

alter table public.packages enable row level security;

-- Photographers can CRUD their own packages
drop policy if exists "Photographer manages own packages" on public.packages;
create policy "Photographer manages own packages"
  on public.packages for all
  using (
    photographer_id in (
      select id from public.photographers where user_id = auth.uid()
    )
  );

-- Parents portal: read packages for ordering
drop policy if exists "Anon can read packages" on public.packages;
create policy "Anon can read packages"
  on public.packages for select
  using (true);

-- ── package_profiles ────────────────────────────────────────────────────────

alter table public.package_profiles enable row level security;

-- Photographers can CRUD their own package profiles
drop policy if exists "Photographer manages own package profiles" on public.package_profiles;
create policy "Photographer manages own package profiles"
  on public.package_profiles for all
  using (
    photographer_id in (
      select id from public.photographers where user_id = auth.uid()
    )
  );

-- Parents portal: read package profiles for ordering
drop policy if exists "Anon can read package profiles" on public.package_profiles;
create policy "Anon can read package profiles"
  on public.package_profiles for select
  using (true);

-- ── schools ─────────────────────────────────────────────────────────────────

alter table public.schools enable row level security;

-- Photographers can manage their own schools
drop policy if exists "Photographer manages own schools" on public.schools;
create policy "Photographer manages own schools"
  on public.schools for all
  using (
    photographer_id in (
      select id from public.photographers where user_id = auth.uid()
    )
  );

-- Parents portal: read schools for gallery access
drop policy if exists "Anon can read schools" on public.schools;
create policy "Anon can read schools"
  on public.schools for select
  using (true);

-- ── students ────────────────────────────────────────────────────────────────

alter table public.students enable row level security;

-- Photographers can manage students in their schools
drop policy if exists "Photographer manages own students" on public.students;
create policy "Photographer manages own students"
  on public.students for all
  using (
    school_id in (
      select id from public.schools
      where photographer_id in (
        select id from public.photographers where user_id = auth.uid()
      )
    )
  );

-- Parents portal: read students for gallery/ordering
drop policy if exists "Anon can read students" on public.students;
create policy "Anon can read students"
  on public.students for select
  using (true);

-- ── projects ────────────────────────────────────────────────────────────────

alter table public.projects enable row level security;

-- Photographers can manage their own projects
drop policy if exists "Photographer manages own projects" on public.projects;
create policy "Photographer manages own projects"
  on public.projects for all
  using (
    photographer_id in (
      select id from public.photographers where user_id = auth.uid()
    )
  );

-- Parents portal: read projects for event galleries
drop policy if exists "Anon can read projects" on public.projects;
create policy "Anon can read projects"
  on public.projects for select
  using (true);

-- ── collections ─────────────────────────────────────────────────────────────

alter table public.collections enable row level security;

-- Anyone can read collections (dashboard and parents portal)
drop policy if exists "Anyone can read collections" on public.collections;
create policy "Anyone can read collections"
  on public.collections for select
  using (true);

-- Photographers can manage their own collections (linked via project)
drop policy if exists "Photographer manages own collections" on public.collections;
create policy "Photographer manages own collections"
  on public.collections for all
  using (
    project_id in (
      select id from public.projects
      where photographer_id in (
        select id from public.photographers where user_id = auth.uid()
      )
    )
  );

-- ── photos ──────────────────────────────────────────────────────────────────

alter table public.photos enable row level security;

-- Public read (needed for parent galleries to load photo data)
drop policy if exists "Anon can read photos" on public.photos;
create policy "Anon can read photos"
  on public.photos for select
  using (true);

-- ── subscriptions ───────────────────────────────────────────────────────────

alter table public.subscriptions enable row level security;

-- Users can read their own subscription
drop policy if exists "User reads own subscription" on public.subscriptions;
create policy "User reads own subscription"
  on public.subscriptions for select
  using (user_id = auth.uid());

-- ── credit_packages ─────────────────────────────────────────────────────────

alter table public.credit_packages enable row level security;

-- Everyone can read active credit packages (Flutter app, dashboard)
drop policy if exists "Anyone can read credit packages" on public.credit_packages;
create policy "Anyone can read credit packages"
  on public.credit_packages for select
  using (true);
