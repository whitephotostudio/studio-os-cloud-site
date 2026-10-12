-- Restore only the exact two public flags and SELECT policies recorded before
-- cutover. This restores the historical public exposure, so use only to recover
-- a demonstrated compatibility failure while repairing the authenticated path.
-- Existing photos, ownership proofs, orders, and galleries remain untouched.
begin;
update storage.buckets set public=true where id in ('thumbs','nobg-photos');
drop policy if exists "Public read access for thumbs" on storage.objects;
create policy "Public read access for thumbs" on storage.objects for select to public using (bucket_id='thumbs');
drop policy if exists "Public read nobg" on storage.objects;
create policy "Public read nobg" on storage.objects for select to public using (bucket_id='nobg-photos');
commit;
