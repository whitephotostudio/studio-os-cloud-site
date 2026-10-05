-- Availability regeneration is one transaction. Existing appointments retain
-- their slot IDs even when a booking arrives while regeneration begins.
create or replace function public.replace_booking_slots(
  p_event_id uuid, p_days jsonb
) returns integer
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_event public.booking_events%rowtype;
  v_day jsonb;
  v_slot jsonb;
  v_day_id uuid;
  v_total integer := 0;
  v_date date;
  v_start time;
  v_end time;
  v_slot_start timestamptz;
  v_slot_end timestamptz;
  v_seen date[] := '{}';
begin
  select e.* into v_event from public.booking_events e
  join public.photographers p on p.id=e.photographer_id
  where e.id=p_event_id and p.user_id=auth.uid()
  for update of e;
  if not found then raise exception 'Booking event is unavailable to this account'; end if;
  if jsonb_typeof(p_days) is distinct from 'array' or
     jsonb_array_length(p_days) not between 1 and 366 then
    raise exception 'Choose between 1 and 366 booking days';
  end if;
  -- Validate every day before deleting any existing availability.
  for v_day in select value from jsonb_array_elements(p_days) loop
    v_date := (v_day->>'day')::date;
    v_start := (v_day->>'start_time')::time;
    v_end := (v_day->>'end_time')::time;
    if v_date is null or v_start is null or v_end is null or v_end <= v_start or
       v_date=any(v_seen) or
       jsonb_typeof(v_day->'slots') is distinct from 'array' or
       jsonb_array_length(v_day->'slots') not between 1 and 1440 then
      raise exception 'Invalid or duplicate booking day';
    end if;
    v_seen := array_append(v_seen,v_date);
    for v_slot in select value from jsonb_array_elements(v_day->'slots') loop
      v_slot_start := (v_slot->>'start_at')::timestamptz;
      v_slot_end := (v_slot->>'end_at')::timestamptz;
      if v_slot_start is null or v_slot_end is null or v_slot_end <= v_slot_start or
         (v_slot_start at time zone v_event.timezone)::date <> v_date or
         (v_slot_start at time zone v_event.timezone)::time < v_start or
         v_slot_end > ((v_date + v_end) at time zone v_event.timezone) then
        raise exception 'Invalid booking slot';
      end if;
    end loop;
  end loop;
  if exists (select 1 from public.bookings where event_id=p_event_id) then
    raise exception 'This event already has bookings; its slots cannot be regenerated';
  end if;
  -- The event lock also blocks a concurrent booking's event foreign-key check.
  -- The existing RESTRICT slot foreign key provides a second preservation guard.
  delete from public.booking_days where event_id=p_event_id;
  for v_day in select value from jsonb_array_elements(p_days) loop
    insert into public.booking_days(event_id,photographer_id,day,start_time,end_time)
    values(p_event_id,v_event.photographer_id,(v_day->>'day')::date,
           (v_day->>'start_time')::time,(v_day->>'end_time')::time)
    returning id into v_day_id;
    insert into public.booking_slots(event_id,day_id,photographer_id,start_at,end_at,capacity,booked_count,status)
    select p_event_id,v_day_id,v_event.photographer_id,(value->>'start_at')::timestamptz,
           (value->>'end_at')::timestamptz,1,0,'open'
    from jsonb_array_elements(v_day->'slots');
    v_total := v_total + jsonb_array_length(v_day->'slots');
  end loop;
  return v_total;
end;
$$;
revoke all on function public.replace_booking_slots(uuid,jsonb) from public, anon;
grant execute on function public.replace_booking_slots(uuid,jsonb) to authenticated;
