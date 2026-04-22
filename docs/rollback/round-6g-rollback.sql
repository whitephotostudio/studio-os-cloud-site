-- Rollback for Round 6g (+ 6g.2) — cross-studio storage policy tightening.
-- Applied 2026-04-22 via:
--   supabase/migrations/20260422160000_round6g_tighten_backdrops_storage.sql
--   supabase/migrations/20260422170000_round6g2_lock_nobg_thumbs_writes.sql
-- Run this via Supabase SQL Editor (or apply_migration) to restore the
-- previous permissive write policies.

-- === 6g.1: backdrops tight policies — drop, restore permissive ===
drop policy if exists "Photographers insert own backdrops" on storage.objects;
drop policy if exists "Photographers update own backdrops" on storage.objects;
drop policy if exists "Photographers delete own backdrops" on storage.objects;

create policy "Auth delete backdrops" on storage.objects
  as permissive for delete to public
  using ((bucket_id = 'backdrops'::text) and (auth.role() = 'authenticated'::text));

create policy "Auth update backdrops" on storage.objects
  as permissive for update to public
  using ((bucket_id = 'backdrops'::text) and (auth.role() = 'authenticated'::text));

create policy "Auth upload backdrops" on storage.objects
  as permissive for insert to public
  with check ((bucket_id = 'backdrops'::text) and (auth.role() = 'authenticated'::text));

-- === 6g.1: thumbs duplicate dedupe — re-create dropped duplicates ===
create policy "authenticated can delete thumbs" on storage.objects
  as permissive for delete to authenticated
  using (bucket_id = 'thumbs'::text);

create policy "authenticated can update thumbs" on storage.objects
  as permissive for update to authenticated
  using (bucket_id = 'thumbs'::text)
  with check (bucket_id = 'thumbs'::text);

create policy "authenticated can upload thumbs" on storage.objects
  as permissive for insert to authenticated
  with check (bucket_id = 'thumbs'::text);

-- === 6g.2: nobg-photos authenticated writes — restore ===
create policy "Auth upload nobg" on storage.objects
  as permissive for insert to public
  with check ((bucket_id = 'nobg-photos'::text) and (auth.role() = 'authenticated'::text));

create policy "Auth update nobg" on storage.objects
  as permissive for update to public
  using ((bucket_id = 'nobg-photos'::text) and (auth.role() = 'authenticated'::text));

-- === 6g.2: thumbs authenticated writes — restore the "Authenticated users can *" set ===
create policy "Authenticated users can upload to thumbs" on storage.objects
  as permissive for insert to authenticated
  with check (bucket_id = 'thumbs'::text);

create policy "Authenticated users can update in thumbs" on storage.objects
  as permissive for update to authenticated
  using (bucket_id = 'thumbs'::text);

create policy "Authenticated users can delete from thumbs" on storage.objects
  as permissive for delete to authenticated
  using (bucket_id = 'thumbs'::text);
