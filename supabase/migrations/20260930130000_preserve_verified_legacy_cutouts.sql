-- Frozen, service-reviewed compatibility access for pre-upgrade gallery bytes.
-- These rows are not purchase receipts or reusable desktop paid entitlements.
begin;
create table public.credit_legacy_cutout_objects (
  object_key text primary key check(object_key like 'nobg-photos/%'),
  studio_id uuid not null,
  original_sha256 text not null check(original_sha256 ~ '^[a-f0-9]{64}$'),
  cutout_sha256 text not null check(cutout_sha256 ~ '^[a-f0-9]{64}$'),
  source_key text not null,
  scope_kind text not null check(scope_kind in ('school','project')),
  scope_id uuid not null,
  review_snapshot_at timestamptz not null,
  approved_at timestamptz not null default now(),
  check(review_snapshot_at <= approved_at)
);
alter table public.credit_legacy_cutout_objects enable row level security;
revoke all on public.credit_legacy_cutout_objects from public,anon,authenticated;
grant all on public.credit_legacy_cutout_objects to service_role;

create or replace function public.authorized_credit_cutout_keys(p_photographer_id uuid,p_keys text[])
returns table(object_key text,original_sha256 text,cutout_sha256 text) language sql stable security definer set search_path=public as $$
  select o.object_key,o.original_sha256,o.cutout_sha256 from public.credit_cutout_objects o join public.photographers p on p.user_id=o.studio_id
    where p.id=p_photographer_id and o.object_key=any(p_keys) and public._has_cutout_entitlement(o.studio_id,o.original_sha256,o.cutout_sha256)
  union all
  select l.object_key,l.original_sha256,l.cutout_sha256 from public.credit_legacy_cutout_objects l join public.photographers p on p.user_id=l.studio_id
    where p.id=p_photographer_id and l.object_key=any(p_keys)
    and not exists(select 1 from public.credit_cutout_objects o where o.object_key=l.object_key)
$$;
revoke all on function public.authorized_credit_cutout_keys(uuid,text[]) from public,anon,authenticated;
grant execute on function public.authorized_credit_cutout_keys(uuid,text[]) to service_role;
commit;
