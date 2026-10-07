begin;

-- Existing studios keep their current proof appearance until they save an
-- opacity. This affects gallery previews only; original photo bytes stay intact.
alter table public.photographers
  add column if not exists watermark_opacity double precision;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.photographers'::regclass
      and conname = 'photographers_watermark_opacity_range'
  ) then
    alter table public.photographers
      add constraint photographers_watermark_opacity_range
      check (watermark_opacity is null or (watermark_opacity >= 0 and watermark_opacity <= 1));
  end if;
end $$;

comment on column public.photographers.watermark_opacity is
  'Owner-selected gallery proof logo/text opacity from 0 to 1. Null preserves legacy per-surface defaults. Does not alter paid originals.';

commit;
