-- Phase 1 only: no bucket flags, object bytes or existing gallery/order rows change.
-- Freeze existing ownership before changing legacy bucket privacy. A future
-- tenant-edited media URL or recreated namespace cannot claim an orphan object.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create table if not exists public.legacy_student_storage_ownership (
  bucket_id text not null check (bucket_id in ('photos','thumbs','nobg-photos')),
  object_key text not null,
  object_id uuid not null,
  photographer_id uuid not null references public.photographers(id) on delete cascade,
  owner_source text not null check (owner_source in ('uploader','existing_namespace')),
  recorded_at timestamptz not null default now(),
  primary key (bucket_id,object_key)
);
alter table public.legacy_student_storage_ownership enable row level security;
revoke all on public.legacy_student_storage_ownership from public, anon, authenticated;
grant select,insert,update,delete on public.legacy_student_storage_ownership to service_role;

with source as (
  select o.id,o.bucket_id,o.name,o.owner_id,
    split_part(o.name,'/',1) first_part,split_part(o.name,'/',2) second_part,split_part(o.name,'/',3) third_part
  from storage.objects o where o.bucket_id in ('photos','thumbs','nobg-photos')
), candidates as (
  select o.*,u.ids uploaded_owners,n.ids namespace_owners
  from source o
  cross join lateral (
    select array_agg(distinct p.id) ids from public.photographers p where p.user_id::text=o.owner_id
  ) u
  cross join lateral (
    select array_agg(distinct x.id) ids from (
      select p.photographer_id id from public.projects p
      where p.id::text=case when o.first_part in ('projects','probes') then o.second_part
        when o.first_part='nobg-photos' and o.second_part='projects' then o.third_part else null end
      union all
      select s.photographer_id from public.schools s
      where s.id::text=case when o.first_part in ('schools','photos') then o.second_part else o.first_part end
         or s.local_school_id=case when o.first_part in ('schools','photos') then o.second_part else o.first_part end
      union all
      select p.id from public.photographers p where p.id::text=o.first_part
    ) x where x.id is not null
  ) n
)
insert into public.legacy_student_storage_ownership(bucket_id,object_key,object_id,photographer_id,owner_source)
select bucket_id,name,id,
  case when cardinality(uploaded_owners)=1 then uploaded_owners[1] else namespace_owners[1] end,
  case when cardinality(uploaded_owners)=1 then 'uploader' else 'existing_namespace' end
from candidates
where cardinality(uploaded_owners)=1 or (owner_id is null and cardinality(namespace_owners)=1)
on conflict (bucket_id,object_key) do nothing;

create or replace function public.legacy_student_storage_owner(p_bucket text,p_key text)
returns uuid language sql stable security definer set search_path=''
as $$
  select proof.photographer_id
  from public.legacy_student_storage_ownership proof
  join storage.objects stored_object on stored_object.id=proof.object_id and stored_object.bucket_id=proof.bucket_id and stored_object.name=proof.object_key
  join public.photographers photographer on photographer.id=proof.photographer_id
  where proof.bucket_id=p_bucket and proof.object_key=p_key;
$$;
revoke all on function public.legacy_student_storage_owner(text,text) from public,anon,authenticated;
grant execute on function public.legacy_student_storage_owner(text,text) to service_role;
commit;
