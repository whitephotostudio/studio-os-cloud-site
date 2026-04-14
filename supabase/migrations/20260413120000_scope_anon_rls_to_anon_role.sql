-- ═══════════════════════════════════════════════════════════════════════════
-- CRITICAL SECURITY FIX — scope "Anon can read *" policies to anon role only
--
-- The previous migration (20260408110000_enable_rls_all_public_tables.sql)
-- created permissive policies like:
--
--   create policy "Anon can read projects"
--     on public.projects for select
--     using (true);
--
-- Without a `TO` clause these policies apply to BOTH the `anon` role AND
-- the `authenticated` role. Supabase combines multiple policies with OR,
-- so the photographer-scoped policy ("Photographer manages own projects")
-- was effectively bypassed: any signed-in user could SELECT every row
-- across every photographer in these tables.
--
-- Impact: signed-in photographers could see other photographers' projects,
-- orders, students, collections, packages, etc. via client-side queries,
-- and photos were fully readable by anyone. This caused the issue where
-- a brand-new account showed another photographer's event/photos.
--
-- Fix: scope the permissive read policies to `anon` only, so signed-in
-- (`authenticated`) users fall back to the per-photographer policies.
-- Also drop the `photos` public-read policy entirely — the `photos` table
-- is never queried client-side, so no role needs blanket access.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── projects ────────────────────────────────────────────────────────────────
drop policy if exists "Anon can read projects" on public.projects;
create policy "Anon can read projects"
  on public.projects for select
  to anon
  using (true);

-- ── schools ─────────────────────────────────────────────────────────────────
drop policy if exists "Anon can read schools" on public.schools;
create policy "Anon can read schools"
  on public.schools for select
  to anon
  using (true);

-- ── students ────────────────────────────────────────────────────────────────
drop policy if exists "Anon can read students" on public.students;
create policy "Anon can read students"
  on public.students for select
  to anon
  using (true);

-- ── orders ──────────────────────────────────────────────────────────────────
-- Parents portal checks an order by id via server-side /api/portal routes,
-- so no client-side anon read is required. Remove entirely.
drop policy if exists "Anon can read orders" on public.orders;

-- ── order_items ─────────────────────────────────────────────────────────────
drop policy if exists "Anon can read order items" on public.order_items;

-- ── packages ────────────────────────────────────────────────────────────────
-- Parents need to see packages when ordering (client-side in /parents).
drop policy if exists "Anon can read packages" on public.packages;
create policy "Anon can read packages"
  on public.packages for select
  to anon
  using (true);

-- ── package_profiles ────────────────────────────────────────────────────────
drop policy if exists "Anon can read package profiles" on public.package_profiles;
create policy "Anon can read package profiles"
  on public.package_profiles for select
  to anon
  using (true);

-- ── collections ─────────────────────────────────────────────────────────────
drop policy if exists "Anyone can read collections" on public.collections;
create policy "Anon can read collections"
  on public.collections for select
  to anon
  using (true);

-- ── photos ──────────────────────────────────────────────────────────────────
-- The `photos` table is not queried from the client at all. Drop the
-- blanket public-read policy entirely — media/storage access goes through
-- signed URLs and the `media` table, which already has proper per-project
-- RLS from the 20260405120000 migration.
drop policy if exists "Anon can read photos" on public.photos;
