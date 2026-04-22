# Flutter Backdrop Manager (desktop app)

**Real source path:** `~/Downloads/Whitephoto_Studio_App_MVP_Source/`
**In-repo copy:** `/Users/harouthagopian/Projects/studio-os-cloud-site/.studio_os_flutter/` — **STALE SNAPSHOT, GITIGNORED, DO NOT EDIT.** Editing this changes nothing in Harout's running app.

**Built app path:** `~/Downloads/Whitephoto_Studio_App_MVP_Source/build/macos/Build/Products/Release/Studio OS.app`

## When to touch this repo

- Any bug that only reproduces in-studio on Harout's Mac and not in Safari.
- Anything involving "Push to Cloud" on backdrops (the web app does NOT do that upload — the Flutter app does).
- Anything where albums / rosters / projects show up on the desktop differently from the cloud dashboard.
- Noritsu export flows, SLIP generation, manual vs auto-send to the print lab.

## Build + deploy

Sandbox CANNOT run `flutter` or `dart`. Read/Write/Edit on the source path DO work.

```bash
# On Harout's Mac:
cd ~/Downloads/Whitephoto_Studio_App_MVP_Source
flutter pub get                       # only after pubspec.yaml changes
flutter analyze                       # static check
flutter build macos                   # release build (slower)
# OR:
flutter run -d macos                  # dev build with hot reload

# Relaunch:
open "build/macos/Build/Products/Release/Studio OS.app"
```

Verification of Dart edits inside the sandbox is **code inspection only** — no compiler feedback until Harout rebuilds. Be careful with types, null-safety, and imports.

## Key files (as of 2026-04-22)

| File | What it owns |
|------|-------------|
| `lib/services/backdrop_sync_service.dart` | Push-to-cloud for backdrops. Uses Supabase Storage + PostgREST directly. Now returns `BackdropSyncResult` with per-entry `BackdropSyncFailure` (stage: `file-missing` / `upload` / `insert` / `update`). |
| `lib/screens/backdrop_manager_panel.dart` | The Backdrop Manager UI. `_pushToCloud` consumes `BackdropSyncResult` and shows orange banner + failure dialog with copy-details button. |
| `lib/screens/project_admin_screen.dart` | Project admin view. `_filteredAlbums` getter now strips any album matching `^\s*rosters?\s*$` (case-insensitive). |
| `lib/services/cloud_sync_service*.dart` | R2 uploads for `nobg-photos` / `thumbs`. These go through `_r2.uploadBinary(...)` on the S3 API — they are NOT Supabase Storage writes despite the bucket name collision. |

## What the desktop app does NOT talk to

- `/api/dashboard/upload-to-r2` — only the web dashboard's backdrop uploader uses it.
- `/api/dashboard/generate-thumbnails` — same.
- `/api/dashboard/storage-folder` — same.
- Any parents-portal API route.

If you patch one of those routes hoping to fix a desktop-side bug, you're fixing the wrong thing. This mistake burned a day on 2026-04-21.

## Observability

The desktop app's primary debug output is `debugPrint` → Console.app on macOS. Harout can screenshot the app UI (he does this a lot) — make sure any surfaced error is user-legible, not just a debug log.

The `BackdropSyncFailure` dialog added 2026-04-22 has a **Copy details** button — ask Harout to paste that string verbatim when diagnosing push failures.
