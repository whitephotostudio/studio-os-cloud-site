# Gallery Upload Audit — April 20, 2026

Source of truth: Supabase project `bwqhzczxoevouiondjak` (whitephoto-cloud), tables `students`, `photos`, `media`, `projects`, `schools`.

**The bug pattern:** `_makePngThumbnail` was used as the "original" uploader, producing 1600 px / ~2.6 MB PNG files. The same URL was written to both `image_url` (or `students.photo_url`) and `thumbnail_url`, so the gallery served the fake "original" for every download AND loaded it 316× on every grid view. Pattern signatures in the database:

- `preview_url ILIKE '%.png'`
- `students.photo_url ILIKE '%.png'`
- `preview_url = thumbnail_url`
- `mime_type = 'image/png'` (when set)

## Headline numbers

Five galleries carry uploaded media. Two are clean. Three need re-upload.

| Gallery                                          | Mode    | Media | PNG (broken) | JPG (clean) | Same URL preview/thumb | Status |
|--------------------------------------------------|---------|------:|-------------:|------------:|-----------------------:|--------|
| MONTE BAPTISM (KRIKOR)                           | event   |   316 |        0     |      316    |               0        | ✅ fixed (re-upload script ran) |
| TAMAR AND DANTE                                  | event   |   134 |        0     |      134    |               0        | ✅ clean |
| Riverside Preparatory School (project media)     | school  |    40 |        0     |       40    |               0        | ✅ clean |
| Maple Grove (project media)                      | school  |   438 |      306     |      132    |             306        | ⚠️ 70 % broken |
| ST. SAHAG & ST. MESROB ARMENIAN SATURDAY SCHOOL  | event   |    22 |       22     |        0    |              22        | ❌ 100 % broken |
| Maple Grove (students.photo_url)                 | school  |    75 |       75     |        0    |               —        | ❌ 100 % broken |
| Riverside Preparatory School (students.photo_url)| school  |    15 |       15     |        0    |               —        | ❌ 100 % broken |

Two notes on the table:

`Maple Grove` shows up twice because that gallery has both `media` rows (project-mode) and `students` rows (school-mode student profiles with a primary `photo_url`). Both sides are affected. The 132 JPG rows in `media` for Maple Grove are likely a later upload session that ran after part of the upload pipeline was patched on disk, or a partial re-shoot — worth confirming with Harout. The PNG rows on the same project must still be re-uploaded.

`MONTE BAPTISM`'s 316/316 JPG count confirms the re-upload script we ran last session **actually delivered**. This validates the patched pipeline end-to-end on real photos.

## What needs to happen, per gallery

**ST. SAHAG & ST. MESROB ARMENIAN SATURDAY SCHOOL** — 22 photos. Re-upload the entire event from the local source folder using the patched Flutter app. Smallest one, do this first as a sanity check.

**Maple Grove** — 306 broken `media` rows (project-mode) + 75 broken `students.photo_url` (school-mode). Largest exposure. Two passes: one to re-sync the project media, one to re-trigger the school sync so each student's `photo_url` rewrites to the new 1600 px JPEG preview key.

**Riverside Preparatory School** — `media` table is already clean (40 JPG), but the 15 `students.photo_url` entries still point at PNGs from the old run. Re-trigger only the school-mode student sync.

## Re-upload procedure

Two options, in order of preference:

1. **Rebuild the Flutter app with the new `cloud_sync_service.dart` + `backdrop_sync_service.dart` and re-trigger sync from the gallery.** This is the right long-term fix — every future shoot will use the three-tier pipeline (full-res original JPG + 1600 px preview JPG + 560 px thumbnail JPG). Once rebuilt, opening each affected gallery and pressing "Sync to Cloud" will overwrite the broken PNGs with proper three-tier JPEG sets.

2. **Re-run the standalone re-upload script per gallery** — the same one used for MONTE BAPTISM. Faster if you don't want to rebuild and ship the app right now. Targets one project at a time. Doesn't touch `students.photo_url`, so school-mode galleries still need pass #1 to fully heal.

For both approaches the local source files must still be on disk (the originals from the camera). If any local source is gone, that photo is unrecoverable at full resolution from cloud storage — only the 1600 px PNG remains.

## What this audit did NOT verify

- **Cutout PNGs (`_nobg.png`)** for school-mode background-swap. The `_syncNobgForImage` patch removes the 1200 px downscale, so any cutout uploaded before today is also reduced. The audit didn't enumerate cutouts because they live on a different storage prefix and aren't tracked in `students` / `media` directly. After re-syncing the affected schools, all cutouts will also be re-uploaded at full resolution.
- **Backdrops** (`backdrop_catalog.image_url`). The new three-tier backdrop upload only takes effect on next sync. Existing backdrops in the catalog are still 1600 px caps — should be re-synced from the local backdrops folder (`~/Documents/StudioOS/Backdrops`) on next opportunity. Doesn't break anything that's currently in production, but composites done before the next backdrop re-sync are working from the older 1600 px plate.

## SQL used

```sql
-- School-mode audit (students.photo_url + photos.image_url)
SELECT s.id, s.school_name, s.shoot_date,
  COUNT(DISTINCT st.id) AS students_total,
  COUNT(DISTINCT st.id) FILTER (WHERE st.photo_url ILIKE '%.png') AS students_png_url,
  COUNT(DISTINCT st.id) FILTER (WHERE st.photo_url ILIKE '%.jpg' OR st.photo_url ILIKE '%.jpeg') AS students_jpg_url
FROM schools s
LEFT JOIN students st ON st.school_id = s.id
GROUP BY s.id, s.school_name, s.shoot_date
ORDER BY students_total DESC NULLS LAST;

-- Project-mode audit (media.preview_url)
SELECT pr.id, pr.title, pr.workflow_type, pr.event_date,
  COUNT(*) AS media_total,
  COUNT(*) FILTER (WHERE m.preview_url ILIKE '%.png') AS preview_png,
  COUNT(*) FILTER (WHERE m.preview_url ILIKE '%.jpg' OR m.preview_url ILIKE '%.jpeg') AS preview_jpg,
  COUNT(*) FILTER (WHERE m.preview_url = m.thumbnail_url) AS preview_eq_thumb
FROM projects pr
JOIN media m ON m.project_id = pr.id
GROUP BY pr.id, pr.title, pr.workflow_type, pr.event_date
ORDER BY media_total DESC;
```

Re-run anytime to track progress.
