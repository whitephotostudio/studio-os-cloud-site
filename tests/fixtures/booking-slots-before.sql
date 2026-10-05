BEGIN;
CREATE TEMP TABLE photographers(id uuid primary key,user_id uuid);
CREATE TEMP TABLE booking_events(id uuid primary key,photographer_id uuid references photographers(id),timezone text);
CREATE TEMP TABLE booking_days(id uuid primary key default gen_random_uuid(),event_id uuid references booking_events(id),photographer_id uuid,day date,start_time time,end_time time,unique(event_id,day));
CREATE TEMP TABLE booking_slots(id uuid primary key default gen_random_uuid(),event_id uuid references booking_events(id),day_id uuid references booking_days(id) on delete cascade,photographer_id uuid,start_at timestamptz,end_at timestamptz,capacity int,booked_count int,status text,unique(day_id,start_at));
CREATE TEMP TABLE bookings(id uuid default gen_random_uuid(),event_id uuid references booking_events(id),slot_id uuid references booking_slots(id) on delete restrict);
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
INSERT INTO photographers VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
INSERT INTO booking_events VALUES('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','America/Toronto');
