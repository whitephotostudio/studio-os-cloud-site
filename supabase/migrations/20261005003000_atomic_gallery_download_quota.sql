-- Direct deliveries continue counting preparation. ZIPs hold capacity while
-- streaming, and count only the exact successfully completed media IDs.
create table if not exists public.portal_gallery_download_reservations (
  id uuid primary key,
  project_id uuid references public.projects(id) on delete cascade,
  school_id uuid references public.schools(id) on delete cascade,
  photographer_id uuid,
  collection_id uuid references public.collections(id) on delete set null,
  viewer_email text not null,
  media_ids text[] not null,
  mode text not null check (mode in ('prepare','zip')),
  completed_media_ids text[] not null default '{}',
  reserved_count integer not null default 0 check (reserved_count >= 0),
  state text not null check (state in ('pending','completed','released')),
  attempt_id uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((project_id is null) <> (school_id is null))
);
create index if not exists portal_gallery_download_reservations_event_idx
  on public.portal_gallery_download_reservations(project_id, viewer_email) where state='pending';
create index if not exists portal_gallery_download_reservations_school_idx
  on public.portal_gallery_download_reservations(school_id, viewer_email) where state='pending';
alter table public.portal_gallery_download_reservations enable row level security;
revoke all on public.portal_gallery_download_reservations from public, anon, authenticated;
grant all on public.portal_gallery_download_reservations to service_role;

create or replace function public.reserve_portal_gallery_download(
  p_gallery_kind text, p_gallery_id uuid, p_photographer_id uuid,
  p_viewer_email text, p_media_ids text[], p_reservation_id uuid,
  p_attempt_id uuid, p_collection_id uuid default null, p_mode text default 'prepare', p_gallery_settings jsonb default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  settings jsonb; owner_id uuid; extras jsonb; viewer text:=lower(btrim(p_viewer_email));
  ids text[]; used_count bigint; held_count bigint; quota integer; remaining_count bigint;
  reservation public.portal_gallery_download_reservations%rowtype;
  prior_ids text[]:='{}'; selected_ids text[]; new_count integer;
  prior_log public.event_gallery_downloads%rowtype;
begin
  if p_gallery_kind not in ('event','school') or p_mode not in ('prepare','zip')
    or (p_mode='zip' and p_gallery_kind<>'event') or p_reservation_id is null
    or p_attempt_id is null or coalesce(viewer,'')='' or length(viewer)>320
    or coalesce(cardinality(p_media_ids),0) not between 1 and 5000
    or exists(select 1 from unnest(p_media_ids) i where i is null or btrim(i)='' or length(i)>2048)
  then raise exception 'Invalid gallery download reservation'; end if;
  select array_agg(i order by first_position) into ids from
    (select i,min(n) first_position from unnest(p_media_ids) with ordinality u(i,n) group by i) d;
  -- Lock the actual gallery row before reading either ledger. Every admission
  -- and completion uses this same lock, including different server instances.
  if p_gallery_kind='event' then
    select gallery_settings,photographer_id into settings,owner_id from public.projects where id=p_gallery_id for update;
    if not found then raise exception 'Gallery not found'; end if;
    if exists(select 1 from unnest(ids) i where not exists
      (select 1 from public.media m where m.id::text=i and m.project_id=p_gallery_id
        and (p_collection_id is null or m.collection_id=p_collection_id)))
    then raise exception 'Gallery media scope changed'; end if;
  else
    select gallery_settings,photographer_id into settings,owner_id from public.schools where id=p_gallery_id for update;
    if not found or p_collection_id is not null then raise exception 'Gallery not found'; end if;
    -- The service caller has authorized each exact media/student/class using
    -- this settings snapshot. Reject any concurrent policy change, including
    -- class overrides, rather than applying only a stale root-level rule.
    if p_gallery_settings is null or settings is distinct from p_gallery_settings then
      raise exception 'School class download policy changed'; end if;
  end if;
  if owner_id is distinct from p_photographer_id then raise exception 'Gallery owner changed'; end if;
  if p_gallery_settings is null or settings is distinct from p_gallery_settings then
    raise exception 'Gallery download policy changed'; end if;
  extras:=coalesce(settings->'extras','{}');
  if not coalesce((extras->>'freeDigitalRuleEnabled')::boolean,false)
    or not coalesce((extras->>'showDownloadAllButton')::boolean,false)
  then raise exception 'Gallery downloads are disabled'; end if;
  quota:=case coalesce(extras->>'freeDigitalDownloadLimit','unlimited')
    when 'unlimited' then null when '1' then 1 when '5' then 5 when '10' then 10 else 0 end;
  select * into reservation from public.portal_gallery_download_reservations where id=p_reservation_id for update;
  if found then
    if reservation.project_id is distinct from (case when p_gallery_kind='event' then p_gallery_id end)
      or reservation.school_id is distinct from (case when p_gallery_kind='school' then p_gallery_id end)
      or reservation.photographer_id is distinct from p_photographer_id or reservation.viewer_email<>viewer
      or reservation.collection_id is distinct from p_collection_id or reservation.media_ids<>ids or reservation.mode<>p_mode
    then raise exception 'Download reservation scope changed'; end if;
    if reservation.state='pending' and reservation.lease_expires_at>clock_timestamp()
      and reservation.attempt_id<>p_attempt_id
    then return jsonb_build_object('allowedMediaIds','[]'::jsonb,'busy',true); end if;
    prior_ids:=reservation.completed_media_ids;
  elsif p_gallery_kind='event' and p_mode='zip' then
    -- Previously completed signed batches used this same immutable log ID.
    select * into prior_log from public.event_gallery_downloads where id=p_reservation_id;
    if found then
      if prior_log.project_id<>p_gallery_id or lower(btrim(prior_log.viewer_email))<>viewer
        or prior_log.download_type<>'gallery' or prior_log.collection_id is distinct from p_collection_id
        or not coalesce(prior_log.media_ids,'{}')<@ids
      then raise exception 'Existing download scope changed'; end if;
      prior_ids:=coalesce(prior_log.media_ids,'{}');
    end if;
  end if;
  if p_gallery_kind='event' then
    select coalesce(sum(greatest(download_count,0)),0) into used_count from public.event_gallery_downloads
      where project_id=p_gallery_id and lower(btrim(viewer_email))=viewer and download_type='gallery';
  else
    select coalesce(sum(greatest(download_count,0)),0) into used_count from public.school_gallery_downloads
      where school_id=p_gallery_id and lower(btrim(viewer_email))=viewer and download_type='gallery';
  end if;
  select coalesce(sum(reserved_count),0) into held_count from public.portal_gallery_download_reservations
    where viewer_email=viewer and state='pending' and lease_expires_at>clock_timestamp() and id<>p_reservation_id
      and (case when p_gallery_kind='event' then project_id=p_gallery_id else school_id=p_gallery_id end);
  remaining_count:=case when quota is null then null else greatest(0,quota-used_count-held_count) end;
  if p_mode='prepare' and reservation.state='completed' then
    return jsonb_build_object('allowedMediaIds',to_jsonb(prior_ids),'downloadsUsed',used_count,'downloadsRemaining',remaining_count);
  end if;
  if p_mode='prepare' then
    selected_ids:=case when remaining_count is null then ids else ids[1:remaining_count::integer] end;
    if coalesce(cardinality(selected_ids),0)=0 then
      return jsonb_build_object('allowedMediaIds','[]'::jsonb,'downloadsUsed',used_count,'downloadsRemaining',remaining_count);
    end if;
    insert into public.portal_gallery_download_reservations(id,project_id,school_id,photographer_id,collection_id,viewer_email,media_ids,mode,completed_media_ids,state)
      values(p_reservation_id,case when p_gallery_kind='event' then p_gallery_id end,case when p_gallery_kind='school' then p_gallery_id end,
        owner_id,p_collection_id,viewer,ids,p_mode,selected_ids,'completed');
    if p_gallery_kind='event' then
      insert into public.event_gallery_downloads(id,project_id,collection_id,viewer_email,download_type,download_count,media_ids)
        values(p_reservation_id,p_gallery_id,p_collection_id,viewer,'gallery',cardinality(selected_ids),selected_ids);
    else
      insert into public.school_gallery_downloads(id,school_id,viewer_email,download_type,download_count,media_ids)
        values(p_reservation_id,p_gallery_id,viewer,'gallery',cardinality(selected_ids),selected_ids);
    end if;
    return jsonb_build_object('allowedMediaIds',to_jsonb(selected_ids),'downloadsUsed',used_count+cardinality(selected_ids),
      'downloadsRemaining',case when remaining_count is null then null else remaining_count-cardinality(selected_ids) end);
  end if;
  select count(*) into new_count from unnest(ids) i where not i=any(prior_ids);
  if remaining_count is not null and new_count>remaining_count then
    return jsonb_build_object('allowedMediaIds','[]'::jsonb,'downloadsUsed',used_count,'downloadsRemaining',remaining_count);
  end if;
  insert into public.portal_gallery_download_reservations(id,project_id,photographer_id,collection_id,viewer_email,media_ids,mode,completed_media_ids,reserved_count,state,attempt_id,lease_expires_at)
    values(p_reservation_id,p_gallery_id,owner_id,p_collection_id,viewer,ids,p_mode,prior_ids,new_count,
      case when new_count=0 then 'completed' else 'pending' end,p_attempt_id,clock_timestamp()+interval '10 minutes')
    on conflict(id) do update set reserved_count=excluded.reserved_count,state=excluded.state,
      attempt_id=excluded.attempt_id,lease_expires_at=excluded.lease_expires_at,updated_at=now();
  return jsonb_build_object('allowedMediaIds',to_jsonb(ids),'downloadsUsed',used_count,
    'downloadsRemaining',case when remaining_count is null then null else remaining_count-new_count end);
end $$;

create or replace function public.finish_portal_gallery_download(
  p_reservation_id uuid,p_attempt_id uuid,p_completed_media_ids text[],p_release boolean default false
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare reservation public.portal_gallery_download_reservations%rowtype; ids text[]; gallery_id uuid; owner_id uuid;
  prior_log public.event_gallery_downloads%rowtype;
begin
  select project_id into gallery_id from public.portal_gallery_download_reservations where id=p_reservation_id;
  if gallery_id is null then raise exception 'ZIP reservation not found'; end if;
  select photographer_id into owner_id from public.projects where id=gallery_id for update;
  select * into reservation from public.portal_gallery_download_reservations where id=p_reservation_id for update;
  if reservation.attempt_id is distinct from p_attempt_id then raise exception 'ZIP reservation attempt changed'; end if;
  if p_release then
    update public.portal_gallery_download_reservations set state='released',
      reserved_count=0,lease_expires_at=null,updated_at=now() where id=p_reservation_id;
    return;
  end if;
  if owner_id is distinct from reservation.photographer_id then raise exception 'Gallery owner changed'; end if;
  if reservation.state='released' or (reservation.state='pending' and reservation.lease_expires_at<=clock_timestamp())
    or p_completed_media_ids is null or exists(select 1 from unnest(p_completed_media_ids) i where i is null)
    or not p_completed_media_ids<@reservation.media_ids
  then raise exception 'ZIP reservation expired or media scope changed'; end if;
  -- A completed attempt has relinquished its unused capacity. Only a newly
  -- admitted attempt may add IDs after a partial completion.
  if reservation.state='completed' then
    if not p_completed_media_ids<@reservation.completed_media_ids then raise exception 'ZIP attempt already completed'; end if;
    return;
  end if;
  select * into prior_log from public.event_gallery_downloads where id=p_reservation_id;
  if found and (prior_log.project_id<>reservation.project_id or lower(btrim(prior_log.viewer_email))<>reservation.viewer_email
    or prior_log.download_type<>'gallery' or prior_log.collection_id is distinct from reservation.collection_id)
  then raise exception 'Existing download scope changed'; end if;
  select coalesce(array_agg(i order by i),'{}') into ids from
    (select distinct unnest(reservation.completed_media_ids || p_completed_media_ids) i) d;
  if cardinality(ids)>0 then
    insert into public.event_gallery_downloads(id,project_id,collection_id,viewer_email,download_type,download_count,media_ids)
      values(reservation.id,reservation.project_id,reservation.collection_id,reservation.viewer_email,'gallery',cardinality(ids),ids)
      on conflict(id) do update set download_count=excluded.download_count,media_ids=excluded.media_ids;
  end if;
  update public.portal_gallery_download_reservations set completed_media_ids=ids,state='completed',reserved_count=0,
    lease_expires_at=null,updated_at=now() where id=p_reservation_id;
end $$;

revoke all on function public.reserve_portal_gallery_download(text,uuid,uuid,text,text[],uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.finish_portal_gallery_download(uuid,uuid,text[],boolean) from public,anon,authenticated;
grant execute on function public.reserve_portal_gallery_download(text,uuid,uuid,text,text[],uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.finish_portal_gallery_download(uuid,uuid,text[],boolean) to service_role;
