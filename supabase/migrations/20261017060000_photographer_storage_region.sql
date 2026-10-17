-- Regional photo storage: record which storage region a photographer's photos
-- live in (Cloudflare R2 legacy pool, Backblaze B2 Canada/US, Wasabi UK/AU, …).
--
-- NULL means "the deployment's default region" (STORAGE_DEFAULT_REGION), which
-- is how every pre-existing account is handled: their photos were migrated as
-- one group, so no backfill is needed. An explicit code is written only for
-- accounts deliberately homed in another region.
begin;

alter table public.photographers
  add column if not exists storage_region text
    check (storage_region is null or storage_region ~ '^[a-z0-9][a-z0-9-]{0,15}$');

comment on column public.photographers.storage_region is
  'Storage region code for this photographer''s photo objects (see lib/storage-regions.ts). NULL = deployment default region.';

commit;
