-- Phase 2, deliberately outside auto-applied migrations.
-- Apply only after the ownership migration, deployed authenticated gateway,
-- owner/foreign/anonymous browser checks, and verified storage/DB backups.
-- In the same SQL session, explicitly set:
-- SET studio_os.legacy_storage_cutover_verified='gateway-and-backup-verified';
-- This file changes only two bucket flags and their exact public SELECT policies.
-- It does not change, move, overwrite, or delete any object or customer row.
-- Direct SQL bypasses the Storage API's public-to-private CDN purge side effect.
-- After commit, explicitly purge each photo bucket's CDN cache through the
-- documented /storage/v1/cdn/<bucket> endpoint, then require anonymous HTTP
-- denial and authorized reads after propagation. Cache purging deletes no object.
-- https://supabase.com/docs/guides/storage/cdn/purge-cdn-cache
begin;
do $$
begin
  if current_setting('studio_os.legacy_storage_cutover_verified',true) is distinct from 'gateway-and-backup-verified' then
    raise exception 'Verify deployed legacy gateway and completed backups before legacy storage cutover';
  end if;
  if to_regprocedure('public.legacy_student_storage_owner(text,text)') is null then
    raise exception 'Install and verify legacy storage ownership gateway first';
  end if;
  if (select count(*) from storage.buckets where id in ('thumbs','nobg-photos')) <> 2 then
    raise exception 'Legacy bucket catalog changed; review before cutover';
  end if;
  if exists (
    select 1 from storage.objects o
    join public.photographers p on p.user_id::text=o.owner_id
    where o.bucket_id in ('photos','thumbs','nobg-photos')
      and public.legacy_student_storage_owner(o.bucket_id,o.name) is distinct from p.id
  ) then
    raise exception 'A legacy uploaded object has no matching frozen owner';
  end if;
  if exists (
    select 1 from storage.objects o
    where o.bucket_id in ('photos','thumbs','nobg-photos')
      and public.legacy_student_storage_owner(o.bucket_id,o.name) is null
      and (
        exists(select 1 from public.media r where strpos(to_jsonb(r)::text,o.name)>0 or strpos(to_jsonb(r)::text,replace(o.name,' ','%20'))>0)
        or exists(select 1 from public.students r where strpos(to_jsonb(r)::text,o.name)>0 or strpos(to_jsonb(r)::text,replace(o.name,' ','%20'))>0)
        or exists(select 1 from public.projects r where strpos(to_jsonb(r)::text,o.name)>0 or strpos(to_jsonb(r)::text,replace(o.name,' ','%20'))>0)
        or exists(select 1 from public.schools r where strpos(to_jsonb(r)::text,o.name)>0 or strpos(to_jsonb(r)::text,replace(o.name,' ','%20'))>0)
        or exists(select 1 from public.orders r where strpos(to_jsonb(r)::text,o.name)>0 or strpos(to_jsonb(r)::text,replace(o.name,' ','%20'))>0)
      )
  ) then
    raise exception 'An active legacy photo reference has no frozen owner; review ownership before cutover';
  end if;
  if exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects'
      and cmd in ('SELECT','ALL') and ('public'=any(roles) or 'anon'=any(roles))
      and policyname not in ('Anyone can view studio logos','Public read access for thumbs','Public read backdrops','Public read nobg')
  ) then
    raise exception 'Anonymous storage SELECT policy catalog changed; review before cutover';
  end if;
end $$;
drop policy if exists "Public read access for thumbs" on storage.objects;
drop policy if exists "Public read nobg" on storage.objects;
update storage.buckets set public=false where id in ('thumbs','nobg-photos');
do $$
begin
  if exists(select 1 from storage.buckets where id in ('thumbs','nobg-photos') and public) then
    raise exception 'Legacy private bucket verification failed';
  end if;
  if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname in ('Public read access for thumbs','Public read nobg')) then
    raise exception 'Legacy public SELECT policy removal failed';
  end if;
end $$;
commit;
