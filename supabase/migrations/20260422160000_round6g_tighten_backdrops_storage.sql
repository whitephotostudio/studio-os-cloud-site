-- Round 6g — cross-studio storage policy tightening.
-- Scope intentionally narrowed to the `backdrops` bucket only, because it is
-- the only bucket where every existing row's first folder is the owning
-- photographer's UUID.  The `nobg-photos` and `thumbs` buckets use mixed path
-- shapes (project slugs, "projects/", "schools/", etc.) and would break live
-- uploads if gated on `foldername[1] = photographer_id`; those will be handled
-- separately once we have a helper that resolves arbitrary path → owner.
--
-- Also cleans up the duplicate "authenticated can *" policy set on the
-- `thumbs` bucket so only one set remains ("Authenticated users can *").  No
-- tightening of `thumbs` write semantics here — just dedupe.

-- === backdrops ===
-- Drop old permissive policies (auth.role()='authenticated' only).
drop policy if exists "Auth upload backdrops" on storage.objects;
drop policy if exists "Auth update backdrops" on storage.objects;
drop policy if exists "Auth delete backdrops" on storage.objects;

-- Recreate as tenant-scoped.  `(storage.foldername(name))[1]` is the first
-- path segment.  Allow iff it matches a `photographers.id` owned by the
-- caller's `auth.uid()`.
create policy "Photographers insert own backdrops" on storage.objects
  as permissive for insert to authenticated
  with check (
    bucket_id = 'backdrops'::text
    and (storage.foldername(name))[1] in (
      select id::text from public.photographers where user_id = auth.uid()
    )
  );

create policy "Photographers update own backdrops" on storage.objects
  as permissive for update to authenticated
  using (
    bucket_id = 'backdrops'::text
    and (storage.foldername(name))[1] in (
      select id::text from public.photographers where user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'backdrops'::text
    and (storage.foldername(name))[1] in (
      select id::text from public.photographers where user_id = auth.uid()
    )
  );

create policy "Photographers delete own backdrops" on storage.objects
  as permissive for delete to authenticated
  using (
    bucket_id = 'backdrops'::text
    and (storage.foldername(name))[1] in (
      select id::text from public.photographers where user_id = auth.uid()
    )
  );

-- === thumbs === (dedupe duplicate policy set; no semantic tightening)
drop policy if exists "authenticated can upload thumbs"   on storage.objects;
drop policy if exists "authenticated can update thumbs"   on storage.objects;
drop policy if exists "authenticated can delete thumbs"   on storage.objects;
