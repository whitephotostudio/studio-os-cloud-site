# Flutter Import Hub — Cloud + SD Card + Folder

**Status:** Cloud tab implemented 2026-04-26 evening (task #127). SD Card + Folder tabs are scaffolded in the same screen but NOT wired up yet. Task #127 covers the shell + Cloud tab; SD + Folder ship next session.

## Architecture overview — three tabs in one screen

The screen is `lib/screens/import_hub_screen.dart`. Top-bar tabs:
- **From Cloud** — pull selected schools/projects from Supabase + R2 (this session)
- **From SD Card** — auto-detect plugged-in volumes, show photos, import into a school (next session)
- **From Folder** — manual folder picker, same import flow as SD (next session)

All three tabs share the same destination flow: photographer picks a target school + class, photos copy in, AI/bg-removal kicks off if enabled. Only the source differs.

## Driver

Photographer buys a new computer. Installs Studio OS, signs in with their existing Supabase account. Wants to keep working — composites, order edits, exports — on schools that were uploaded from a different computer. Today the desktop app's "Pull from Cloud" only fetches school **metadata** (name + linked cloud ID); the roster, photo binaries, and background-removed PNGs all stay in the cloud, so the new computer is a hollow shell.

For a studio with hundreds of schools, "pull everything" would take hours and gigabytes of disk. The right UX is a **picker**: show me what's in the cloud, let me tick the 2 or 3 schools I actually need today, pull just those.

## Scope decisions (locked 2026-04-26)

- **Pull scope per pick = "Everything."** Roster (students + teachers + classes) + original JPGs + nobg PNGs. Composites work the moment a pull finishes — no lazy loading mid-shoot.
- **Conflict policy = "Ask me each time."** If a school already exists locally with different data, pop a dialog: "York University — local roster has N changes you haven't pushed. Cloud roster is newer. Overwrite / merge / skip?" Interrupts the pull but never silently destroys unpushed work.
- **Both schools and projects in the same picker.** Same studio, two workflows; one screen handles both.

## Architecture

### New file
`lib/screens/cloud_browser_screen.dart` — picker UI. Reachable from the existing Cloud tab + a new top-bar button on the Admin screen.

### Local data model
No DB changes. We reuse the existing `LocalStore` JSON files (`schools.json`, `students_*.json`, `teachers_*.json`) and `CaptureBase/` filesystem layout.

### Cloud queries
1. `SupabaseService.fetchSchools()` — already exists, returns school metadata + cloud IDs.
2. `SupabaseService.fetchProjects()` — already exists, returns projects (events) for this photographer.
3. **NEW** `SupabaseService.fetchCloudInventory(photographerId)` — single round-trip that returns:
   ```dart
   class CloudInventoryItem {
     String id;
     String type;            // 'school' or 'project'
     String name;
     DateTime? lastSyncedAt; // updated_at from row
     int rosterCount;        // count of students+teachers
     int photoCount;         // count from media table
     int? sizeMb;            // sum of media bytes (optional, can defer)
     bool localExists;       // resolved client-side against LocalStore
     String? localStatus;    // 'has-unpushed-changes' / 'in-sync' / 'cloud-newer'
   }
   ```

### Pull pipeline (per item)
For each ticked item, run in order:
1. **School metadata** — upsert into `schools.json` via `LocalStore.upsertSchoolWithId()`.  Existing code path.
2. **Latest roster snapshot** — call `fetchCloudRosterSnapshot(schoolId)` (already exists), then `restoreCloudRosterSnapshot()` to write `students_*.json` + `teachers_*.json`.
3. **Photo binaries** — query `media` table where `school_id = X`, group by class folder, download originals via R2 (`R2StorageService.getPublicUrl()`).  Write to `~/CaptureBase/{schoolName}/{className}/{filename}.jpg`. Reuse the project-side `_downloadProjectMediaToLocal()` logic, generalized for school workflow.
4. **Nobg PNGs** — same query but filter on `media.kind = 'nobg'` or filename ending `_nobg.png`. Composite builder needs these.
5. **Mark item synced** — write a marker file or update `LocalStore.setSchoolPullCompletedAt(id, now)` so resume can skip.

For projects (events) the pipeline is shorter: existing `pullProjectAccess(projectId)` already does steps 1+3 in one call. We just wrap it in the new picker UI.

### Resume support
On every pull-attempt start, check `~/CaptureBase/{schoolName}/.studio-os-pull-state.json`. If it exists and references the current `roster_snapshot_id` + a partial `photos_pulled` set, skip already-downloaded files. Cancellation writes the partial state on exit.

### Conflict prompt
Triggered in step 1 when `LocalStore.getSchool(id) != null && localStatus != 'in-sync'`. Modal dialog with 3 options:
- **Overwrite local** — wipe `students_*.json` / `teachers_*.json`, replace with cloud version. Lose unpushed local edits.
- **Merge (cloud wins on conflicts)** — only adds rows that don't exist locally; existing local rows are kept (preserves unpushed renames). Slowest path, most data preservation.
- **Skip this school** — no changes, move on to next ticked item.

### UI sketch
```
┌─ Cloud Browser ─────────────────────────────────────────────┐
│ 47 schools · 12 projects on cloud           [⌕ Search...]   │
│                                                              │
│ Filters: [All ▾] [Has photos] [Already local] [Cloud only]  │
│                                                              │
│ ☐ ⓢ Maple Grove Elementary    142 photos · 75 students   ▾ │
│ ☐ ⓢ York University           340 photos · 280 students  ▾ │
│ ☑ ⓢ Riverside High            89 photos · 31 students    ▾ │
│ ☐ ⓟ Smith Wedding 2025        420 photos                 ▾ │
│ ...                                                          │
│                                                              │
│ ──────────────────────────────────────────────────────────── │
│ 1 selected · ~89 photos · ~340 MB                            │
│                              [Cancel]  [Pull Selected →]     │
└──────────────────────────────────────────────────────────────┘
```

Each row collapsible; expanded view shows class breakdown + last synced timestamp.

### Progress UI
Bottom-of-screen strip during pull:
```
Pulling 1 of 3 selected — Riverside High · photos 178/420   [Cancel]
```

## Estimated effort

- ~~0.5 day~~ Picker UI scaffold + cloud-inventory query
- ~~1 day~~ Per-item pull pipeline (school metadata → roster → photos → nobg) with resume support
- ~~0.5 day~~ Conflict prompt + merge logic
- ~~0.5 day~~ Polish + test on a real fresh-computer scenario

**Total: ~2.5 Flutter days.** Not a quick wire-up, but the underlying pieces (`fetchSchools`, `fetchCloudRosterSnapshot`, `R2StorageService`, `_downloadProjectMediaToLocal`) all exist — this is orchestration + UI, not new infrastructure.

## What ships unblocked

The web side is unchanged. This is desktop-only. After Harout rebuilds Flutter (`flutter build macos`), the new "Cloud Browser" appears as a tab/button. No DB migrations, no API route changes, no parents-portal impact.
