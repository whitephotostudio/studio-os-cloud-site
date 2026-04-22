-- Round 6g.2 — lock `nobg-photos` and `thumbs` bucket writes to service-role only.
--
-- Investigation confirmed:
--   - Desktop Flutter app writes to R2 (S3-compatible) using those bucket
--     names, NOT Supabase Storage.
--   - Parents-portal web code only `.list()` / `.getPublicUrl()` on these
--     buckets — zero client-side writes.
--   - All Supabase writes to nobg-photos/thumbs originate from Next.js
--     server routes or maintenance scripts using the service-role key,
--     which bypasses RLS.
--
-- Dropping the authenticated write policies therefore removes cross-tenant
-- write risk without breaking any live code path.  Public SELECT policies
-- remain, so parents-portal reads still work.

-- === nobg-photos ===
drop policy if exists "Auth upload nobg"  on storage.objects;
drop policy if exists "Auth update nobg"  on storage.objects;
-- (no "Auth delete nobg" policy existed — nothing to drop)

-- === thumbs ===
drop policy if exists "Authenticated users can upload to thumbs"   on storage.objects;
drop policy if exists "Authenticated users can update in thumbs"   on storage.objects;
drop policy if exists "Authenticated users can delete from thumbs" on storage.objects;
