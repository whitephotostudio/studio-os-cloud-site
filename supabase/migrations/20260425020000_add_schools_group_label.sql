-- 2026-04-26 — Configurable per-school grouping label.
--
-- Some studios shoot universities (groups are "Faculties"), elementary
-- (groups are "Grades"), corporate (groups are "Departments").  The data
-- model still calls the field `class_name` internally, but the UI now
-- looks up the school-level label and renders it instead of "Class".
--
-- Defaults preserve current behavior — every existing school keeps
-- saying "Class" / "Classes".
--
-- Already applied live to bwqhzczxoevouiondjak — this file ships the
-- DDL alongside the source so a fresh `supabase db reset` on a clone
-- comes up with the same schema.

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS group_label_singular text NOT NULL DEFAULT 'Class',
  ADD COLUMN IF NOT EXISTS group_label_plural   text NOT NULL DEFAULT 'Classes';

COMMENT ON COLUMN public.schools.group_label_singular IS
  'User-visible singular label for the per-school grouping (default: Class). Photographers shooting universities can set to Faculty, elementary to Grade, etc.';

COMMENT ON COLUMN public.schools.group_label_plural IS
  'User-visible plural label for the per-school grouping (default: Classes). Mirrors group_label_singular (Faculties / Grades / Departments).';
