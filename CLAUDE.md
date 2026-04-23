# Studio OS Cloud Site — Working Memory

Checkpoint for Claude so a context reset doesn't lose the thread. Update as work progresses.

Last updated: 2026-04-22 (late evening) — mobile-compat pass #2 + #3 (events, schools lists) staged + thumbs-path normalization defer-decision + orphan-delete script staged. All uncommitted in working tree (index.lock stuck).

---

## 🔴 ACTIVE HANDOFF — resume here

Open this block first. Everything below it is historical context.

### Committed in sandbox but NOT YET PUSHED (do this first on Mac)

Three commits sitting in `.git/` locally, newest first:
- `2fd7236` — docs: unified data model design (task #7)
- `5b8cdd5` — docs: note Textures dups already cleaned (54→36 rows)
- `4133b0d` — fix: mobile compat pass #2 (topbar, admin users, orders, school detail)

Sandbox can't push (no SSH key) and left stale `.git/index.lock` from a failed `git add`. Run on Mac:
```bash
cd ~/Projects/studio-os-cloud-site
rm -f .git/HEAD.lock .git/index.lock
git push origin main
```

What `4133b0d` does (mobile-compat pass #2 — driven by Harout's iPhone screenshots on 2026-04-22 late evening):

- **`app/dashboard/layout.tsx`** — mobile topbar background `#000` → `#fff`, hamburger `#fff on transparent` → `#111 on #fff with #e5e7eb border`. Logo now sits on a white backdrop matching the desktop sidebar's white logo area.
- **`app/dashboard/admin/users/page.tsx`** — added `useIsMobile`. The 6-col client grid (`2fr 2fr 1fr 1fr 1fr 40px`) was chopping the Trial / Plan columns to "Stud / mo" on iPhone. Wrapped the table container in `overflow:auto` + inner `minWidth: 820` so columns keep their natural proportions and the user swipes horizontally to reach the right side. Outer padding trimmed 32→18 on mobile.
- **`app/dashboard/orders/page.tsx`** — tapping "Open details" on mobile rendered the panel below the list off-screen, so it felt broken. Added `detailsPanelRef` + `useEffect` that calls `scrollIntoView({behavior:'smooth', block:'start'})` on `selected.id` change when `isMobile`. Also tightened the order card fonts (H3 name 20→15, order total 24→18, photo 110×138 → 72×92, Package/Originals/Export grid now 1-col stacked on mobile instead of three crushed columns, details-panel H1 28→18, `scrollMarginTop: 72` on the panel).
- **`app/dashboard/projects/schools/[schoolId]/page.tsx`** — the 320px fixed-width aside was eating the whole ~390px viewport, hiding the classes/roles/people album grid on the right. Added `useIsMobile` and flipped the outer grid to `"1fr"` on mobile (aside above, album grid below). Also `position: sticky` → `static`, aside padding 16→12, outer padding 24→14, H1 24→20, top button row stacks vertically.

Typecheck passed (`npx tsc --noEmit` → exit 0). Desktop path untouched across all four files.

### Also uncommitted in the working tree (staged by `git add -A`, commit failed on index.lock)

Everything below is staged in the git index but NOT committed — the sandbox couldn't clear its own `.git/index.lock` from a failed commit attempt. After clearing the lock on Mac, a single `git commit -m "…"` will pick them all up. Suggested message at the bottom.

- `CLAUDE.md` — this file (the handoff block + pending queue updates).
- `docs/design/thumbs-path-normalization.md` — NEW. Inventory + recommendation: defer the rename indefinitely.
- `scripts/cleanup-thumbs-orphans.mjs` — NEW. One-shot Supabase Storage cleanup for 651 orphan objects. Dry-run by default; `--commit` to execute. **Run from Mac** (sandbox has no service-role key). See "Pending task queue" block for env-bootstrap command.
- `app/dashboard/projects/events/page.tsx` — mobile pass #3: added `useIsMobile`; header stack (H1 48→28, "+ New Project" padding 20/28→12/18 + font 20→15); outer padding 24→14; grid minmax 240→160 (fits 2 cards per row on iPhone); floating action bar clamped full-width between 14px margins with smaller padding/fonts; context menu clamped to viewport.
- `app/dashboard/schools/page.tsx` — mobile pass #3: same pattern as events. outer padding 40→14; header stack (H1 26→22, subtitle 15→13); search+select row stacks vertically on mobile; grid minmax 240→160; floating action bar + context menu same clamps.

Typecheck clean (`npx tsc --noEmit` → exit 0) for both edited page files.

Suggested commit (run on Mac after `rm -f .git/*.lock` and before `git push`):
```bash
git commit -m "mobile pass #3: events + schools list, plus thumbs-cleanup staging" \
  -m "- Events list: header stack, grid 160px minmax (2-up), floating bar + menu clamp" \
  -m "- Schools list: same pattern" \
  -m "- thumbs-path-normalization.md: defer decision + rationale" \
  -m "- cleanup-thumbs-orphans.mjs: one-shot script for 651 orphans (dry-run/--commit)" \
  -m "- CLAUDE.md: handoff + queue state"
```

### Still owed to #57 mobile sweep (not yet on iPhone)

Tuned defensively this session (staged in the uncommitted-files block above) but still needs on-device screenshot verification:
- `/dashboard/projects/events` — mobile pass #3 applied
- `/dashboard/schools` (list) — mobile pass #3 applied

Not yet touched, apply the same `useIsMobile` pattern (grid collapse, reduce padding, wrap tables in horizontal scroll) when iPhone screenshots show breakage:
- `/dashboard/projects/[id]` (project detail)
- `/dashboard/projects/[id]/albums/[albumId]`
- `/dashboard/packages`
- `/dashboard/settings`
- `/dashboard/membership`
- `/dashboard/feature-requests`
- `/dashboard/backdrops`

Ask Harout to pull each up in Safari on iPhone, screenshot anything off, and tune in a fourth pass.

### Already landed this session (2026-04-22 evening)

- **#58 — Roster subfolders hidden in Project mode** (commit `6345bd6`, already on `origin/main`):
  - Web: `app/dashboard/projects/[id]/page.tsx` — added `isRosterCollection()` (regex `^\s*rosters?\s*$` against title/slug, or `kind === 'roster'`). `orderedCollections` filters them out; galleries chip subtracts `rosterCount`.
  - Desktop Flutter: `~/Downloads/Whitephoto_Studio_App_MVP_Source/lib/screens/project_admin_screen.dart` — `_filteredAlbums` getter now skips any album matching the same roster regex. **Rebuild required**: `cd ~/Downloads/Whitephoto_Studio_App_MVP_Source && flutter build macos`.
  - Scope per user: UI filter only. Disk folders and DB `collections` rows untouched (user explicitly picked "Hide via UI filter only" via AskUserQuestion).

- **#57 — Mobile compatibility sweep (Tier 3 dashboard)**:
  - `app/dashboard/layout.tsx` — mobile path now renders a sticky black topbar with `<Logo small />` + hamburger (Menu/X from lucide-react). Drawer is a full-height black overlay that locks `document.body.style.overflow` while open and auto-closes if viewport grows past the mobile breakpoint. Desktop path unchanged.
  - `app/dashboard/page.tsx` — `useIsMobile`; stat grid 4-col → 2-col; bottom panel grid 3-col → 1-col; main padding 32 → 14 on mobile.
  - `app/dashboard/orders/page.tsx` — `useIsMobile`; header flex column + smaller H1 + email badge hidden on mobile; detail panel goes full-width static on mobile; stat grid 4 → 2; **orders table wrapped in horizontal-scroll container** (`overflow: auto` + inner `minWidth: 720`) so all 8 columns stay readable.
  - `useIsMobile` hook lives at `lib/use-is-mobile.ts` (640px `window.matchMedia` breakpoint, already existed before this session).

### Not yet verified on device (still owed to #57)

User hasn't sent screenshots for these dashboard sub-pages on iPhone. All likely need the same mobile-tuning pass (grid → stacked, reduce padding, table → horizontal scroll):
- `/dashboard/schools`
- `/dashboard/projects/events`
- `/dashboard/projects/[id]` (project detail)
- `/dashboard/projects/[id]/albums/[albumId]`
- `/dashboard/packages`
- `/dashboard/settings`
- `/dashboard/membership`
- `/dashboard/feature-requests`
- `/dashboard/backdrops`

**Next step when resuming:** ask user to pull up each in Safari on iPhone, screenshot anything broken, and we'll tune those pages in a second pass. If no screenshots, pick the highest-traffic page (`/dashboard/projects/events` or `/dashboard/schools`) and eyeball the JSX to apply the same `useIsMobile` pattern.

### Sandbox gotchas that WILL bite again

- Git inside the Cowork bash sandbox CAN commit but CANNOT clear its own `.git/*.lock` files (permission denied on unlink). Harout has to run `rm -f .git/HEAD.lock .git/index.lock` on his Mac terminal between sessions when things get stuck. The sandbox also can't `git push` (no SSH key, no PAT) — every push must happen from Mac.
- The Flutter source at `~/Downloads/Whitephoto_Studio_App_MVP_Source/` is NOT mounted in the bash sandbox, so `flutter analyze` / `dart` won't run there. Read/Write/Edit DO work on that path though, and changes are picked up on the next `flutter build macos` Harout runs.
- Dart edits to the Flutter app are verified by **code inspection only** (no compiler feedback until Harout rebuilds). Be extra careful with types.

### Quick context pointers for deep memory

- `memory/glossary.md` — shorthand + acronyms ("PIN login", "backdrop", "proof", etc.)
- `memory/people/harout.md` — user profile, communication style, studio context
- `memory/projects/studio-os-cloud.md` — repo / stack / deploy paths
- `memory/projects/flutter-backdrop-manager.md` — desktop app structure + build commands
- `memory/context/supabase.md` — project id, tables, known policies, SQL gotchas

---

## Who / what

- **User:** Harout (harout@me.com as photographer, whitephotostudio@hotmail.com on Cowork)
- **Studio:** WHITE PHOTO
- **photographer_id:** `ed6b8a99-1f38-48f3-a198-447c49b5ac34`
- **Supabase project:** `bwqhzczxoevouiondjak`
- **Repo:** `/Users/harouthagopian/Projects/studio-os-cloud-site` (Next.js 16.1.6 w/ Turbopack, deployed on Vercel, origin/main)
- **Storage:**
  - **Gallery media (photos):** Cloudflare R2 bucket `whitephoto-media` is still the active write path, fronted by a private bucket + signed URLs. The standalone R2 scripts (`scripts/reupload-gallery-originals.mjs`, `compress-old-photos.mjs`, `migrate-to-r2.mjs`) still use it.
  - **Backdrops:** **Supabase Storage `backdrops` bucket (public) is the only live origin.** The desktop Flutter app writes here directly. The old Cloudflare R2 public hostname `pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev` is **DEAD for backdrops** — every URL there now fails to load in the browser ("Load failed"). Verified 2026-04-22 via `tmp-backdrop-probe.html` in Safari. All 53 old R2-hosted rows in `backdrop_catalog` were rewritten to Supabase URLs (same storage paths exist in Supabase). Any future catalog row referencing `r2.dev/backdrops/...` is a regression.
- **Desktop app:** Flutter/Dart "Backdrop Manager". **The REAL, active Flutter source lives at `~/Downloads/Whitephoto_Studio_App_MVP_Source/`** — NOT at `.studio_os_flutter/` inside the Next.js repo. The in-repo `.studio_os_flutter/` is a stale snapshot (and is gitignored); editing it will not change Harout's app. When patching Dart code, edit `~/Downloads/Whitephoto_Studio_App_MVP_Source/lib/...` directly, then `flutter build macos` from that folder. The built binary opens from `~/Downloads/Whitephoto_Studio_App_MVP_Source/build/macos/Build/Products/Release/Studio OS.app`. The desktop app talks **directly** to Supabase Storage + PostgREST — it does **NOT** call the Next.js `/api/dashboard/*` routes for backdrop push (older docs said otherwise — they were wrong).

---

## Architectural gotchas (don't re-learn these)

- **Real backdrops table is `backdrop_catalog`**, NOT `backdrops`. There is no `backdrops` table in `public`. Earlier ownership checks queried a non-existent table and silently rejected every upload.
- **`proxy.ts` at repo root is the LIVE middleware file on Next.js 16.** Next.js renamed `middleware.ts` → `proxy.ts` in v16 and the function export is `proxy(request)` (not `middleware`). If BOTH files exist the build fails hard with `Error: Both middleware file "./middleware.ts" and proxy file "./proxy.ts" are detected. Please use "./proxy.ts" only`. Do NOT recreate `middleware.ts`. Rate limiting + security headers live in `proxy.ts` and run on every request matching its matcher. (Earlier notes in this doc called proxy.ts "dead code" — that was true on Next 15 and is now wrong. Corrected 2026-04-22.)
- **Upstash env vars** (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) drive `lib/rate-limit.ts`. If missing or malformed it falls back to an in-memory map. Init is now wrapped in try/catch so a bad env var doesn't crash the route.
- **Safari's "The string did not match the expected pattern"** is a DOMException from `response.json()` on non-JSON (HTML 500). Always defensively parse JSON in client fetch handlers.
- **Git lock files:** The Cowork bash sandbox can't clear `.git/HEAD.lock` / `.git/index.lock` (permissions). Harout has to clear them from his Mac terminal: `rm -f .git/HEAD.lock .git/index.lock`.
- **Supabase MFA:** `getAuthenticatorAssuranceLevel()` gates the sign-in page. Stale TOTP factors live in `auth.mfa_factors` and their open challenges in `auth.mfa_challenges`. Delete challenges first, then the factor.
- **Supabase MCP `get_logs` valid services:** `api | branch-action | postgres | edge-function | auth | storage | realtime`. NOT `postgrest`.

---

## Today's work — 2026-04-21

### What broke
1. **Backdrop upload** had been 403'ing for weeks. Desktop app showed stale "Pushed 36 backdrops to cloud" banner but 37 total → new backdrops couldn't be pushed.
2. **Parents portal PIN login** failed with Safari DOMException "The string did not match the expected pattern".
3. **Photographer sign-in** blocked by a TOTP 2FA screen; Harout didn't have the authenticator.

### What we found
- `assertKeyOwnedByPhotographer` in `app/api/dashboard/upload-to-r2/route.ts` (and mirror in `generate-thumbnails/route.ts`) was querying `service.from("backdrops")` with column `storage_path`. Neither existed. Query returned null → `{ ok: false }` → 403. Introduced in commit `bff6c0e` (Post-breach hardening sweep).
- PIN login DOMException was the client choking on an HTML 500 from the API route. Most likely cause: `Redis.fromEnv()` or `new Ratelimit()` throwing synchronously if Upstash env vars are malformed, crashing the route before its JSON catch block runs.

### Fixes shipped (now on origin/main)
- `5313fc8` — Round 8: persistent rate limiter via Upstash Redis
- `f3b375d` — fix: backdrop upload blocked by broken ownership check
  - `app/api/dashboard/upload-to-r2/route.ts`: replaced broken DB lookup with path-shape check (`second === photographerId`) for `backdrops/{photographerId}/...`.
  - `app/api/dashboard/generate-thumbnails/route.ts`: same mirror fix.
- `51270c7` — harden login response parse + rate-limit init
  - `lib/rate-limit.ts`: wrapped `Redis.fromEnv()` and `new Ratelimit()` in try/catch with `redisInitFailed` flag; falls back to in-memory limiter on init failure instead of 500'ing.
  - `app/parents/LoginForm.tsx`: defensive `response.json()` parse in both `handleSchoolLogin` and `handleEventLogin` — shows friendly "Server error…" instead of raw DOMException.

### Supabase ops
- Deleted stale MFA factor `5750ddee-c88a-4f90-bad6-e1540b5c830a` enrolled at 2026-04-21 22:32 UTC. Cleared related rows in `auth.mfa_challenges` first, then `auth.mfa_factors`.

### Status
- First three commits (`5313fc8`, `f3b375d`, `51270c7`) pushed to `origin/main`. Vercel redeployed — but backdrop push STILL not working.
- Deeper dig found the real blocker: **a third route had the same broken `backdrops` table query**.
  - `app/api/dashboard/storage-folder/route.ts` — the desktop app calls this before uploading, and when it 403'd the app bailed before ever reaching upload-to-r2. Explains why Supabase shows **zero INSERTs into `backdrop_catalog` since 2026-04-04** despite the upload endpoint itself being fixed.
- Fourth commit `4e8e2ea` applies the same path-shape check (`second === photographerId`) to storage-folder. Committed locally in the Cowork sandbox; **sandbox can't push — user must push from Mac terminal**:
  ```bash
  cd ~/Projects/studio-os-cloud-site && git push origin main
  ```
- After user pushes and Vercel redeploys (~2 min), retry "Push to Cloud" on the Book backdrop.

### Diagnostic evidence
- `SELECT count(*) FROM backdrop_catalog WHERE photographer_id='ed6b8a99…'` → 53 rows, newest `created_at` = `2026-04-04 05:01:34`. No inserts in 17+ days, matching the post-breach hardening sweep deploy window.
- Desktop UI says 37 Total but DB has 53 — UI is counting local-only state, not cloud truth. Expected drift; will self-heal once pushes start succeeding.
- Supabase API logs show the Dart/3.11 client issuing PATCH /rest/v1/backdrop_catalog (metadata sync) but **no POSTs** to that table, confirming the upload pipeline never completes.

---

## 2026-04-22 — Permanent fix for silent sync drift (task #55)

### The real root cause of "Book won't push"
After the three Next.js route fixes (`f3b375d`, `51270c7`, `4e8e2ea`) deployed, the Book backdrop **still wouldn't push**. Reading the Flutter source at `.studio_os_flutter/lib/services/backdrop_sync_service.dart` revealed:

1. The desktop app's "Push to Cloud" button bypasses all Next.js routes entirely. It calls `Supabase.instance.client.storage.from('backdrops').uploadBinary(...)` and `_sb.from('backdrop_catalog').insert(...)` directly.
2. The per-entry loop in `syncBackdrops` had `catch (e, st) { debugPrint(...); }` — every error was **silently swallowed**. UI only showed the `synced` counter, so "Pushed 36 / 37 Total" gave no hint which entry failed or why.
3. This is why the Next.js route patches didn't help: the upload path they fixed isn't the one the desktop uses.
4. Supabase RLS on the `backdrops` bucket and `backdrop_catalog` table is permissive and correct — not the blocker. Whatever was breaking for Book was invisible to us.

### Permanent fix — make errors visible
Edited `.studio_os_flutter/lib/services/backdrop_sync_service.dart` and `.studio_os_flutter/lib/screens/backdrop_manager_panel.dart`:

- Introduced `BackdropSyncResult { int synced, int total, List<BackdropSyncFailure> failures }` and `BackdropSyncFailure { entryName, localPath, stage, message }`. `stage` = `file-missing | upload | insert | update`.
- `syncBackdrops` now returns `Future<BackdropSyncResult>` instead of `Future<int>`. Errors are captured with their stage context instead of silently discarded. The previously-silent "file missing → continue" branch now records a `file-missing` failure too.
- `_pushToCloud` in the UI panel consumes the result, stores `_lastSyncFailures` in state, sets a "⚠️ Pushed X/Y. Failed: …" status banner for partial success, and auto-opens a failure-details dialog.
- The dialog has a **Copy details** button so Harout can paste the exact error message. A persistent "Details (N)" button stays in the status bar after dismissal.

### Why this is the permanent fix
The bug is no longer "Book doesn't push" — it's "we don't know why Book doesn't push". Once the rebuilt Flutter app runs, the next push attempt will either succeed or will show the exact error on screen (RLS rejection text, file-not-found path, Postgres check violation, network hiccup, whatever). From there the fix is whatever the surfaced error calls out — and future invisible drifts become self-diagnosing.

### Deploy path
- The Flutter source at `.studio_os_flutter/` is **gitignored** in this repo — no `git push origin main` needed for these edits; they live only on Harout's disk.
- To pick up the fix, rebuild the desktop app:
  ```bash
  cd ~/Projects/studio-os-cloud-site/.studio_os_flutter
  flutter build macos   # (or flutter run for a dev build)
  ```
  Then relaunch the Backdrop Manager and click "Push to Cloud" on Book.
- Expected outcome: either the push succeeds (if the silent failure was transient), or an orange banner + dialog shows the exact failure for Book. Copy-paste that into the next Cowork message and we finish the diagnosis.

### Key files touched 2026-04-22
- `.studio_os_flutter/lib/services/backdrop_sync_service.dart` — added `BackdropSyncResult`, `BackdropSyncFailure`, changed `syncBackdrops` return type, added stage tracking.
- `.studio_os_flutter/lib/screens/backdrop_manager_panel.dart` — `_pushToCloud` now consumes result; `_showSyncFailuresDialog` added; status-bar "Details" button; orange color for ⚠️ status; import `flutter/services.dart` for Clipboard.

---

## 2026-04-22 (late) — Parents-portal backdrop grid empty (task #56)

### Symptom
After Book pushed successfully, the parents-portal backdrop grid still showed mostly empty gray tiles. `backdrop_catalog` had 54 rows with files in Supabase Storage, but the grid wouldn't render them.

### Root cause
**Cloudflare R2 public bucket `pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev` is dead.** Confirmed by loading 4 sample thumbnails in Safari (`tmp-backdrop-probe.html`): both R2 URLs → "Load failed"; both Supabase URLs → HTTP 200. 53 of the 54 rows in `backdrop_catalog` pointed at the dead R2 host for `image_url`, and 39 pointed there for `thumbnail_url`.

### Fix
Rewrote the 53 rows in-place via Supabase MCP SQL. Same storage paths, only the host changes:

```sql
UPDATE backdrop_catalog
SET image_url     = REPLACE(image_url,     'https://pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev/backdrops/', 'https://bwqhzczxoevouiondjak.supabase.co/storage/v1/object/public/backdrops/'),
    thumbnail_url = REPLACE(thumbnail_url, 'https://pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev/backdrops/', 'https://bwqhzczxoevouiondjak.supabase.co/storage/v1/object/public/backdrops/')
WHERE photographer_id = 'ed6b8a99-1f38-48f3-a198-447c49b5ac34'
  AND (image_url LIKE '%pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev%'
    OR thumbnail_url LIKE '%pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev%');
```

Verification query confirmed: `remaining_r2_rows=0`, `image_files_missing=0`, `thumb_files_missing=0` across all 54 rows. Every referenced object exists in the `backdrops` bucket.

### Followups worth doing
- ~~`backdrop_catalog` has 18 **duplicated Textures names**~~ **RESOLVED 2026-04-22 (late).** Verified via Supabase MCP: table is now 36 rows, zero duplicate names, every referenced image and thumbnail file exists in the `backdrops` bucket. 54 → 36 = 18 rows deleted — likely by Harout via the Backdrop Manager UI between the two checks. No SQL action needed.
- The old R2 migration helpers (`scripts/migrate-to-r2.mjs` etc.) still exist but write to the `whitephoto-media` bucket, not `backdrops`. Leave alone for now.
- `tmp-backdrop-probe.html` at repo root is a throwaway diagnostic — delete if you don't want it around.

---

## Pending task queue (picked up from prior context)

- **#7** [design drafted 2026-04-22] Design data model + workflow for both modes — v1 written to `docs/design/data-model.md`. Awaiting Harout's review before migration-plan follow-up (`docs/design/data-model-migration.md`). Core proposal: one `projects` anchor with `mode` enum + `project_schools` / `project_events` sidecars; unified `portal_access_tokens` replaces the three PIN fields; collapse visitor/download/favorite tables to one set of `portal_*` tables.
- **#47** Round 6g — cross-studio storage policy tightening (DONE 2026-04-22: backdrops tightened + thumbs dedup'd; nobg-photos/thumbs tenant isolation deferred until a path → owner resolver exists)
- **#49** Round 7b — Zod coverage fan-out to remaining dashboard routes (DONE)
- **#51** Round 9 — Audit logging design + schema (DONE)
- **#52** Round 10 — Refund revalidation design + impl (DONE)
- **#57** Mobile-compat sweep — pass #2 committed as `4133b0d` (NOT pushed). See top handoff block. Still owed: screenshot test on remaining dashboard sub-pages.
- **Cleanup:** `proxy.ts` at repo root — confirmed LIVE on Next.js 16 (NOT dead). See gotchas section.
- **Thumbs path normalization** — **DECIDED 2026-04-22: defer indefinitely.** Full rationale in `docs/design/thumbs-path-normalization.md`. Round 6g.2 already achieves tenant isolation for `thumbs` by requiring service-role for writes. The rename of 2,152 storage objects + 1,152 `media.storage_path` rows is non-atomic and would flicker live galleries for the benefit of re-enabling client-side writes we don't need. Revisit only if a future feature forces authenticated-browser writes to `thumbs`.
- **Thumbs orphan delete (side-cleanup)** — script staged at `scripts/cleanup-thumbs-orphans.mjs`, **NOT yet run**. Targets 651 orphan objects under 5 prefixes (`udz1lw0s1dmc/`, `st3xmgmyummu/`, `eeiikg7fc9pd/`, `ae3204ed-d549-45f8-ba13-b6cdde3a7e73/`, `schools/`). Cross-check against all 13 url-ish columns in `public` schema returned zero references. Harout must run from Mac with service-role key — sandbox has no credentials and can't reach Supabase Storage API:
  ```bash
  cd ~/Projects/studio-os-cloud-site
  # Dry-run first to confirm counts match expected 651:
  env $(grep -v '^#' .env.local | xargs) node scripts/cleanup-thumbs-orphans.mjs
  # Then commit:
  env $(grep -v '^#' .env.local | xargs) node scripts/cleanup-thumbs-orphans.mjs --commit
  ```
  Expected: bucket drops from 2,152 → 1,501 objects. Live galleries unaffected (zero DB refs).
- **Thumbs `media.thumbnail_url` R2 backfill (side-cleanup)** — **NOT scheduled.** All 1,152 rows in `media` have `thumbnail_url` pointing at the dead `pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev` host, but these values are **cosmetic** — `lib/storage-images.ts` derives URLs from `storage_path` via `buildStoredMediaUrls()`, which prefers an existing thumbnail URL only if it's non-empty AND different from the `originalUrl` AND not already an original-storage URL. Since the dead R2 URLs satisfy all three, `thumbnailUrl` resolves to the dead URL on read. **⚠ This means parents-portal thumbnails likely have the same rendering issue we fixed for backdrops on 2026-04-22.** Before backfilling, Harout should load a recent photo gallery and confirm whether thumbnails render (they might, if the client falls through to `originalUrl` via CSS onerror, but no such fallback exists in `storage-images.ts`). If broken, run the same `REPLACE(...)` SQL pattern we used for `backdrop_catalog` against `media.thumbnail_url` and `media.preview_url`. Deferred from this session because egress from the sandbox can't verify R2 liveness directly.

---

## 2026-04-22 (evening) — Round 6g landed, narrowed scope (task #47)

### What changed
- `backdrops` bucket now has proper tenant isolation on writes. Three permissive policies (`Auth upload/update/delete backdrops` — gated only on `auth.role()='authenticated'`) were dropped and replaced with `Photographers insert/update/delete own backdrops`, each gated on `(storage.foldername(name))[1] IN (select id::text from photographers where user_id = auth.uid())`. Service-role writes bypass RLS so webhooks/scripts still work. Public SELECT policy preserved.
- `thumbs` bucket had TWO duplicate permissive policy sets ("Authenticated users can …" + "authenticated can …"). Dropped the lowercase set; kept the "Authenticated users can …" set. No semantic tightening — just dedupe.

### Why scope was narrowed
Checked actual storage row path shapes before applying:
- `backdrops`: 100% of rows use `{photographerId-UUID}/…` as the first folder → safe to gate on photographer ownership.
- `nobg-photos`: MIXED path shapes (some UUID, some project slugs like `f0xb989xqhwj/…`). Gating on `foldername[1] = owned photographer_id` would lock out every project-slug path.
- `thumbs`: even messier — literal `projects/`, `schools/`, plus short slugs.

This explains why the previous Round 6g attempt (before today) was rolled back — it assumed uniform UUID paths.

### Deferred follow-ups
- ~~Build a `public.caller_owns_storage_path(bucket, name)` helper…~~ **Superseded by Round 6g.2 below.**
- Normalize stray `thumbs/projects/…` and `thumbs/schools/…` legacy paths into tenant-scoped folders if we ever want to allow client-side writes to `thumbs` again.

### Files / artifacts
- `supabase/migrations/20260422160000_round6g_tighten_backdrops_storage.sql` — the applied migration.
- `docs/rollback/round-6g-rollback.sql` — updated to reflect the narrowed scope. Runnable if we need to revert.

---

## 2026-04-22 (evening) — Round 6g.2 landed, nobg-photos + thumbs locked (task #47)

### What changed
- `nobg-photos` bucket now has zero authenticated write policies. Dropped `Auth upload nobg` and `Auth update nobg`. (No DELETE policy existed to begin with.) Public SELECT policy preserved.
- `thumbs` bucket now has zero authenticated write policies. Dropped the remaining `Authenticated users can upload/update/delete` set. Public SELECT policy preserved.
- Writes to both buckets now require the **service-role key** (bypasses RLS) — which is how the Next.js API routes and maintenance scripts already work.

### Why this is safe
Full code audit before applying:
- Desktop Flutter app writes to `nobg-photos` / `thumbs` are actually **R2 S3-compatible writes**, not Supabase Storage writes. The bucket name collision is incidental. Confirmed in `~/Downloads/Whitephoto_Studio_App_MVP_Source/lib/services/cloud_sync_service*.dart` — every write goes through `_r2.uploadBinary(...)`.
- Parents-portal web code (`app/parents/[pin]/page*.tsx`) only calls `.list()` and `.getPublicUrl()` on these buckets. Zero writes.
- Next.js API routes grep for `'nobg-photos'` / `'thumbs'` → zero hits. All writes live in `scripts/*.mjs` and `tmp_*.mjs` which use the service-role key.

### Net effect on attack surface
Before Round 6g: any authenticated photographer (any other tenant) could upload, update, or delete arbitrary files in `backdrops/`, `nobg-photos/`, and `thumbs/`. Major cross-tenant write risk.
After Rounds 6g + 6g.2: `backdrops/` writes require photographer-id-owned-by-auth.uid; `nobg-photos/` and `thumbs/` writes require service-role. All public SELECT reads preserved. `studio-logos/` untouched (already properly isolated).

### Files / artifacts
- `supabase/migrations/20260422170000_round6g2_lock_nobg_thumbs_writes.sql` — the applied migration.
- `docs/rollback/round-6g-rollback.sql` — updated again to cover 6g.1 + 6g.2 together.

---

## Next step after today's verify

Once Harout confirms the Book backdrop push succeeded and the PIN login works (or gives us a better error than the Safari DOMException), the obvious next pick from the queue is **Round 7b (Zod fan-out)** — it's mechanical, low-risk, and broadens the input validation the breach hardening started. Round 6g (storage policy tightening) is higher-value but previously got rolled back; revisit with a safer migration plan.

---

## Key files touched this session

- `app/api/dashboard/upload-to-r2/route.ts`
- `app/api/dashboard/generate-thumbnails/route.ts`
- `lib/rate-limit.ts`
- `app/parents/LoginForm.tsx`
- `proxy.ts` (flagged dead code, not modified)
- `app/sign-in/page.tsx` (read, not modified — standard Supabase MFA flow)
- `app/dashboard/backdrops/page.tsx` (read — confirmed writes go to `backdrop_catalog`, key shape is `backdrops/${pgId}/${Date.now()}_${i}_${random}.${ext}`)
