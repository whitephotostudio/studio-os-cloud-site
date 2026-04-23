# Thumbs Bucket Path Normalization — Inventory & Recommendation

Status: **Decision pending — recommendation: defer indefinitely.**
Author: Claude (via Cowork), on behalf of Harout.
Last updated: 2026-04-22.
Context: Followup deferred from Round 6g.2 (2026-04-22 evening).

---

## TL;DR

The `thumbs` bucket has mixed path shapes (UUID, short slugs, literal
`projects/`, literal `schools/`). The Round 6g.2 lockdown makes all writes
require the service role, which already delivers the tenant-isolation goal.
Renaming 2,152 storage objects and back-writing 1,152 `media.storage_path`
rows carries non-trivial risk (downtime window, DB/storage drift, Flutter +
maintenance-script churn) for a benefit we don't currently need (re-opening
client-side writes). **Recommendation: don't normalize. Document the
decision, drop the followup from the queue.**

---

## Current shape of the `thumbs` bucket

2,152 objects total, broken down by first path segment:

| First segment | Count | What it is | Live? |
|---|---:|---|---|
| `projects/` (literal) | 683 | `projects/{projectId-uuid}/albums/{albumId-uuid}/...` — events path | Yes — 472 rows in `media.storage_path` |
| `12mchspahxr2/` | 626 | `schools.local_school_id` for WHITE PHOTO → Maple Grove | Yes — 590 rows in `media.storage_path` |
| `udz1lw0s1dmc/` | 241 | Unknown slug, not in DB | Orphan |
| `ae3204ed-…/` (UUID) | 240 | Not a `photographer_id`; not in `schools` or `projects` | Orphan |
| `f0xb989xqhwj/` | 192 | `schools.local_school_id` for WHITE PHOTO → Riverside Prep | Yes — ~90 rows |
| `st3xmgmyummu/` | 162 | Unknown slug, not in DB | Orphan |
| `schools/` (literal) | 6 | `schools/{schoolId-uuid}/composites/...` | Orphan (no `media.storage_path` matches) |
| `eeiikg7fc9pd/` | 2 | Unknown slug, not in DB | Orphan |

Roughly half the bucket is orphan objects left from earlier import / slug
churn; the other half is live, split between the events layout
(`projects/{id}/albums/{id}/...`) and the schools layout
(`{local_school_id}/{class}/{student}/...`).

`media.storage_path` (1,152 rows total) first-segment distribution:

| First segment | Count |
|---|---:|
| `12mchspahxr2/` | 590 |
| `projects/` | 472 |
| `f0xb989xqhwj/` | 90 |

All 1,152 `media.thumbnail_url` values point at
`pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev` (the same dead R2 public
hostname we confirmed on 2026-04-22 for backdrops). The live code doesn't
actually use `thumbnail_url` for rendering — `lib/storage-images.ts`
derives URLs from `storage_path` at read time. So the stale CDN URLs are
cosmetic, not a functional bug. Worth a separate one-shot backfill though,
same pattern as the backdrops fix.

---

## What "normalize" would mean

The deferred proposal from Round 6g.2: rename every path to be prefixed
with the owning `photographer_id`, so storage RLS can gate client-side
writes using the same pattern as `backdrops`:

```
12mchspahxr2/Grade 12 A/Anahid/…
  →  ed6b8a99-1f38-48f3-a198-447c49b5ac34/12mchspahxr2/Grade 12 A/Anahid/…

projects/170d1df8-…/albums/6f1b4242-…/foo.jpg
  →  ed6b8a99-…/projects/170d1df8-…/albums/6f1b4242-…/foo.jpg
```

The RLS policy would then be:

```
(storage.foldername(name))[1] IN (
  SELECT id::text FROM photographers WHERE user_id = auth.uid()
)
```

exactly matching the backdrops policy shipped in Round 6g.

---

## Why this isn't worth doing (right now)

**The write risk is already mitigated.** Round 6g.2 dropped every
authenticated-user write policy on `thumbs`. Writes require the service
role, which bypasses RLS. Tenants cannot collide on writes; they never
could, since the Flutter desktop app writes thumbnails via R2 (not via
Supabase Storage) and the Next.js API writes all go through
`createServiceClient`. Cross-tenant write risk is zero today.

**The read path doesn't care about path shape.** `media.storage_path` is
the canonical key. Any change has to keep storage and DB perfectly in sync
— the moment we rename an object but leave the `storage_path` unchanged,
that photo stops rendering in both the dashboard and the parents portal.

**The rename is non-atomic.** Supabase Storage doesn't offer a
transactional "rename + update DB row" primitive. A realistic script:

1. For each of 1,152 live objects:
   a. `supabase.storage.from('thumbs').move(oldPath, newPath)`
   b. `UPDATE media SET storage_path = newPath WHERE id = ?`
   c. Handle per-object failure + retry

2. Live galleries during the window show 404s until the DB row is updated.

3. Any parent currently on a PIN page would see thumbnails disappear and
   reappear.

Even with careful ordering (DB update first, then move, with a
`public SELECT` policy that allows stale URLs to serve while the move is
in flight), there's a real-world minutes-to-hours window where a subset
of galleries will flicker.

**The payoff is speculative.** The whole point of normalizing is to make
future client-side writes tenable. We don't need those:
- Desktop: Flutter writes to R2 (S3-compatible API), not Supabase.
- Web dashboard: all writes go through `/api/dashboard/*` → service role.
- Scripts: `scripts/*.mjs` use the service-role key.

There is no current or planned code path that wants an authenticated
photographer's browser to write directly to `thumbs`.

**Orphan sprawl doesn't need a rename to address.** ~1,000 objects have no
`media` row. They're wasting R2/Supabase storage quota but they're not
hurting RLS. Cleanup is a separate, smaller, unambiguously-useful job
(`DELETE FROM storage.objects WHERE bucket_id='thumbs' AND name ~ '^(udz1lw0s1dmc|st3xmgmyummu|eeiikg7fc9pd|ae3204ed-...|schools)/'`
— or whatever subset survives reference-checking).

---

## What we should actually do

1. **Drop the "normalize paths" followup.** Replace it in CLAUDE.md with
   the decision recorded here. Unblock the queue.

2. **Keep the Round 6g.2 lockdown as the tenant-isolation strategy for
   `thumbs`.** Revisit only if a future requirement forces
   authenticated-browser writes to this bucket.

3. **Optional side-cleanups, separately scoped:**
   - One-shot delete of the ~1,000 orphan objects in `thumbs` (needs a
     cautious reference scan first — some might be referenced by
     `media.storage_path` variants we missed).
   - One-shot backfill of `media.thumbnail_url` / `media.preview_url` off
     the dead R2 host. Low-risk because the fields are unused by the live
     render path (`storage-images.ts` rederives from `storage_path`), but
     cleans up the DB so future debugging isn't confused by dead URLs.
     Mirror the backdrops-fix SQL from 2026-04-22.

   Neither of these requires the full rename.

4. **If a future requirement does force authenticated-browser writes to
   `thumbs`,** revisit this doc. The rename is still doable — it's just
   not free, so we should only pay the cost once the benefit is concrete.

---

## Decision requested

Sign-off needed on: "Defer normalization indefinitely. Remove from
followup queue. Optionally pick up the two side-cleanups as separate
small tasks."

If Harout disagrees and wants the rename done anyway, the follow-up doc
would be `docs/design/thumbs-path-rename-plan.md` with: ownership
resolution SQL (orphan classification), per-object move + backfill
script, rollback path, deploy window, and a Flutter + maintenance-script
impact list.
