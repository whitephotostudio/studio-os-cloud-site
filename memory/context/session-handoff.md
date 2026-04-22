# Session Handoff — 2026-04-22 (evening)

Read this first when resuming. Mirrors the ACTIVE HANDOFF block in `CLAUDE.md`.

## The one thing blocking "just works"

Uncommitted edit on disk: `app/parents/[pin]/page.tsx` around line ~10644. Sandbox couldn't commit because of `.git/*.lock` files (standard sandbox permissions quirk).

**User has to run on Mac:**
```bash
cd ~/Projects/studio-os-cloud-site
rm -f .git/HEAD.lock .git/index.lock
git add -A
git status --short   # expect only app/parents/[pin]/page.tsx modified
git commit -m "fix: scale backdrop picker Live Preview blur to match main view

CSS filter: blur(Npx) is absolute-pixel — same blurAmount on the 142px
thumbnail looked ~5-6x stronger than on the ~780px main viewer. Scaled
the panel preview's blur by (142/780) so the small thumbnail visually
matches the large photo. Main view is unchanged."
git push origin main
```

After push, Vercel redeploys in ~2 min; refresh the parents portal to verify the Live Preview tile's blur intensity now matches the main photo.

## What's in flight

- **#57 Mobile compatibility (in_progress)** — Tier 3 dashboard done (layout / home / orders). Remaining sub-pages need eyeballing on iPhone: `/dashboard/schools`, `/dashboard/projects/events`, `/dashboard/projects/[id]`, `/dashboard/projects/[id]/albums/[albumId]`, `/dashboard/packages`, `/dashboard/settings`, `/dashboard/membership`, `/dashboard/feature-requests`, `/dashboard/backdrops`. Pattern for each: `useIsMobile()` + conditional inline styles (grid-cols → stacked, smaller padding, tables wrapped in horizontal scroll at `minWidth: 720`).
- **#7 Data model + workflow for both modes (in_progress)** — long-standing design task. Not actively touched this session.

## Just landed

- **#58 Strip roster subfolders from Project mode** (commit `6345bd6`, already on `origin/main`). Web + Flutter both filter via `^\s*rosters?\s*$` regex. Flutter needs `flutter build macos` on Harout's Mac to pick up the change. Scope: UI filter only — DB + disk untouched.
- **Live Preview blur scale** (uncommitted — see top of this file).

## Don't re-discover these gotchas

- `proxy.ts` is LIVE on Next.js 16 (don't recreate `middleware.ts`).
- `backdrop_catalog` is the real table, not `backdrops`.
- Desktop app writes backdrops DIRECTLY to Supabase Storage + PostgREST. Patching Next.js routes won't fix desktop push bugs.
- `pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev` is dead — any new row referencing it is a regression.
- Flutter source: `~/Downloads/Whitephoto_Studio_App_MVP_Source/` — NOT `.studio_os_flutter/` (that's a stale snapshot).
- Sandbox can't push or clear git locks — user runs those on Mac.

## First message to send when resuming

Something like: "Picking up from the 2026-04-22 handoff. Did the Live Preview blur commit land on origin/main? If yes and the preview looks right, let's continue the mobile sweep on #57 — send an iPhone screenshot of whichever dashboard page still looks broken."
