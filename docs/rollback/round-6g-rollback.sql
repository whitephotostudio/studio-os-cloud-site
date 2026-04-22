-- Rollback for Round 6g — cross-studio storage policy tightening.
-- Applied 2026-04-22 via supabase/migrations/20260422160000_round6g_tighten_backdrops_storage.sql.
-- Scope was narrowed to `backdrops` only + dedupe of the duplicate `thumbs`
-- policy set.  Run this via Supabase SQL Editor (or apply_migration) to
-- restore the previous permissive write policies.

-- Drop the new tight policies
drop policy if exists "Photographers insert own backdrops" on storage.objects;
drop policy if exists "Photographers update own backdrops" on storage.objects;
drop policy if exists "Photographers delete own backdrops" on storage.objects;

-- === backdrops === (restore the three permissive policies)
create policy "Auth delete backdrops" on storage.objects
  as permissive for delete to public
  using ((bucket_id = 'backdrops'::text) and (auth.role() = 'authenticated'::text));

create policy "Auth update backdrops" on storage.objects
  as permissive for update to public
  using ((bucket_id = 'backdrops'::text) and (auth.role() = 'authenticated'::text));

create policy "Auth upload backdrops" on storage.objects
  as permissive for insert to public
  with check ((bucket_id = 'backdrops'::text) and (auth.role() = 'authenticated'::text));

-- === thumbs === (restore the dropped duplicate policy set)
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
