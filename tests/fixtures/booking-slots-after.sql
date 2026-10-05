DO $test$
DECLARE e uuid := '30000000-0000-0000-0000-000000000001';
 d jsonb := '[{"day":"2026-10-06","start_time":"09:00","end_time":"10:00","slots":[{"start_at":"2026-10-06T13:00:00Z","end_at":"2026-10-06T13:30:00Z"},{"start_at":"2026-10-06T13:30:00Z","end_at":"2026-10-06T14:00:00Z"}]}]';
 sid uuid; did uuid; rejected boolean;
BEGIN
 if pg_temp.replace_booking_slots(e,d) <> 2 then raise exception 'Valid plan count failed'; end if;
 select id into sid from pg_temp.booking_slots limit 1;
 select id into did from pg_temp.booking_days limit 1;
 rejected := false;
 begin perform pg_temp.replace_booking_slots(e,d || '[{"day":"2026-10-07","start_time":"10:00","end_time":"09:00","slots":[]}]'::jsonb); exception when others then rejected := true; end;
 if not rejected or not exists(select 1 from pg_temp.booking_slots where id=sid) then raise exception 'Invalid later day changed availability'; end if;
 rejected := false;
 begin perform pg_temp.replace_booking_slots(e,d || d); exception when others then rejected := true; end;
 if not rejected then raise exception 'Duplicate dates accepted'; end if;
 -- A duplicate slot fails the INSERT after DELETE; the statement transaction
 -- must restore every previous day/slot ID.
 rejected := false;
 begin perform pg_temp.replace_booking_slots(e,jsonb_set(d,'{0,slots}',(d->0->'slots') || (d->0->'slots'))); exception when others then rejected := true; end;
 if not rejected or not exists(select 1 from pg_temp.booking_slots where id=sid) or not exists(select 1 from pg_temp.booking_days where id=did) then raise exception 'Partial write lost old availability'; end if;
 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
 rejected := false;
 begin perform pg_temp.replace_booking_slots(e,d); exception when others then rejected := true; end;
 if not rejected then raise exception 'Other owner accepted'; end if;
 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
 insert into pg_temp.bookings(event_id,slot_id) values(e,sid);
 rejected := false;
 begin perform pg_temp.replace_booking_slots(e,d); exception when others then rejected := true; end;
 if not rejected or not exists(select 1 from pg_temp.booking_slots where id=sid) or (select count(*) from pg_temp.bookings) <> 1 then raise exception 'Booked slot lost'; end if;
END;
$test$;
SELECT '6 SQL fixtures passed; all temporary tables and function rolled back' AS verification;
ROLLBACK;
