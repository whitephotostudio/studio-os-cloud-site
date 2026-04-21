-- ─────────────────────────────────────────────────────────────────────────
-- school_roster_snapshots
--
-- Versioned history of roster uploads from Studio OS. Every time the
-- desktop app syncs a school it writes a snapshot here so another
-- machine can hit "Download data" and restore to a known-good version.
--
-- Mirrors the local snapshot system (admin_screen.dart `_openRosterVersions`
-- + LocalStore.saveStudentsForSchoolWithSnapshot) on the cloud side.
--
-- Retention: keep only the latest 20 versions per school. Older rows are
-- pruned by trigger on insert.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists school_roster_snapshots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  version int not null,
  -- Full roster payload: both students and teachers/coaches in a single
  -- JSON blob so one fetch rehydrates everything.
  -- Shape: { students: Student[], teachers: Teacher[] }
  roster_json jsonb not null,
  student_count int not null default 0,
  teacher_count int not null default 0,
  -- 'auto_upload'  — tagged along with the standard cloud sync
  -- 'manual_sync'  — explicit "Sync roster now" button
  -- 'pre_download' — written locally before a cloud→local restore replaces state
  -- 'restore'      — written after a cloud version was restored into the app
  source text not null default 'auto_upload'
    check (source in ('auto_upload', 'manual_sync', 'pre_download', 'restore')),
  -- Human-friendly machine label, e.g. "Studio Mac" or "Harout-MBP"
  uploaded_by_machine text,
  -- The photographer (auth user) who wrote the snapshot
  uploaded_by_user_id uuid references auth.users(id) on delete set null,
  -- Only one row per school has is_current=true — the latest saved state.
  is_current boolean not null default false,
  -- Optional free-text note the caller can attach ("after Principal edits", etc.)
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (school_id, version)
);

create index if not exists idx_school_roster_snapshots_school_created
  on school_roster_snapshots(school_id, created_at desc);

create index if not exists idx_school_roster_snapshots_school_version
  on school_roster_snapshots(school_id, version desc);

-- One-current-per-school guarantee
create unique index if not exists idx_school_roster_snapshots_is_current
  on school_roster_snapshots(school_id)
  where is_current = true;

-- ─────────────────────────────────────────────────────────────────────────
-- Trigger: auto-assign next version + prune to 20 per school
-- ─────────────────────────────────────────────────────────────────────────

create or replace function school_roster_snapshots_before_insert()
returns trigger
language plpgsql
as $$
begin
  if new.version is null or new.version <= 0 then
    select coalesce(max(version), 0) + 1
      into new.version
      from school_roster_snapshots
      where school_id = new.school_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_school_roster_snapshots_before_insert
  on school_roster_snapshots;
create trigger trg_school_roster_snapshots_before_insert
  before insert on school_roster_snapshots
  for each row execute function school_roster_snapshots_before_insert();

create or replace function school_roster_snapshots_after_insert()
returns trigger
language plpgsql
as $$
begin
  -- Clear is_current on older rows; new row is now canonical.
  if new.is_current then
    update school_roster_snapshots
       set is_current = false
     where school_id = new.school_id
       and id <> new.id
       and is_current = true;
  end if;

  -- Retention: keep only the most recent 20 snapshots per school.
  delete from school_roster_snapshots
   where school_id = new.school_id
     and id not in (
       select id from school_roster_snapshots
        where school_id = new.school_id
        order by version desc
        limit 20
     );

  return new;
end;
$$;

drop trigger if exists trg_school_roster_snapshots_after_insert
  on school_roster_snapshots;
create trigger trg_school_roster_snapshots_after_insert
  after insert on school_roster_snapshots
  for each row execute function school_roster_snapshots_after_insert();

-- ─────────────────────────────────────────────────────────────────────────
-- RLS: photographers can read/write snapshots for their own schools
-- ─────────────────────────────────────────────────────────────────────────

alter table school_roster_snapshots enable row level security;

create policy "Photographers read own roster snapshots"
  on school_roster_snapshots for select
  to authenticated
  using (
    school_id in (
      select s.id from schools s
      join photographers p on p.id = s.photographer_id
      where p.user_id = auth.uid()
    )
  );

create policy "Photographers insert own roster snapshots"
  on school_roster_snapshots for insert
  to authenticated
  with check (
    school_id in (
      select s.id from schools s
      join photographers p on p.id = s.photographer_id
      where p.user_id = auth.uid()
    )
  );

-- No update/delete from client — retention is trigger-managed. Cascade
-- deletes still work through the schools FK.
