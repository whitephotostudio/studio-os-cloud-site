# Mobile Photographer + Sort Panel — Port Plan

_Goal: bring the Flutter desktop **Photographer** (capture) and **Sort** (review/organize)
panels into the `/m` mobile web app so a photographer can run picture day from a phone or
iPad — capture → view by student → delete bad shots → fix wrong‑QR mis‑files → manage roster
→ share a QR for clients — all syncing to the live gallery with no laptop._

Written 2026‑06‑26 after a deep read of the Flutter source (`photographer.dart`,
`sorter_screen.dart`, `project_sorter_screen.dart`) and the cloud web app.

---

## 1. What the Flutter panels actually do (so we replicate the right behavior)

### Photographer panel (`lib/screens/photographer.dart`, ~7.7k lines)
Live capture station. A USB/QR scan sets the **active subject**; every shot is auto‑filed into
that subject's folder. Review tools: filmstrip, flag **best/cover**, crop (8×10 / 5×7),
straighten, **soft‑delete** (move to `__deleted/`, local only), and **re‑assign** selected
photos to a different subject (`_reassignSelected` — a disk move + rename, no DB/cloud call;
the next cloud push reconciles it). It does **not** push to the cloud itself.

### Sort panel (`sorter_screen.dart` school, `project_sorter_screen.dart` event)
Cull & organize after the shoot. School = class‑tree sidebar + photo grid; **double‑tap a
photo → a per‑student focus page** showing only that student's shots with prev/next, delete,
reassign. Best/cover = a star → marker file `.studioos_best.txt` (local display only). Event =
flat album grid with **move‑to‑album** + bulk delete. All deletes/moves are **local disk
operations**; the cloud reflects them on the next full sync.

> The owner's mental model — "each student is a thumbnail folder with their cover photo; tap to
> see their individual photos" — is the **right UX to build on mobile**. It maps onto the
> desktop's per‑student focus page even though the desktop surfaces it via a class‑tree + grid.

---

## 2. Data model (the rules the mobile port must obey)

- Photos live in **R2 bucket `whitephoto-media`**, no Supabase `media` row. Galleries discover
  them by **listing the R2 prefix**.
- **Key convention:** `{school.local_school_id || school.id}/{class_name}/{folder_name}/file.jpg`.
- **Folder‑name nuance (important):** desktop capture writes folders as **"Last First PIN"**
  (spaces), but the DB/cloud `students.folder_name` is **"studentId_Last_First"**. The web
  upload route uses `students.folder_name` (fallback "Last First PIN"), and galleries read
  **both** the `folder_name` folder **and** the `photo_url`‑derived folder. ⇒ Always resolve
  folders with `buildSchoolCandidateFolders` (covers both); never hardcode one.
- **Cover photo** on the server = `students.photo_url` = the **alphabetically‑first preview**
  set on sync (NOT the desktop "best" star). Mobile can set `photo_url` directly if we ever
  want true best‑photo control.
- `students` has **no `updated_at`** — nothing to bump on mutations.
- Helpers to reuse: `lib/storage-folder.ts` (`buildSchoolCandidateFolders`,
  `loadFolderMediaRows`, `folderFromPhotoUrl`), `lib/r2.ts` (`listR2FolderImages`,
  `r2DeleteWithVariants`, `r2DeletePrefix`, `r2PublicUrl`).

---

## 3. What already exists

- **`/m/capture`** — scan QR/PIN locks a student; Phone‑camera or DSLR‑import shooting; offline
  upload queue → R2; per‑student **review + delete** strip. ≈ the Photographer panel's core.
- **APIs** (all: `resolveDashboardAuth` → photographer‑owns‑school → student‑in‑school; writes
  also `guardAgreement`):
  - `app/api/dashboard/capture/upload` — store a shot at the canonical key, set `photo_url` if empty.
  - `app/api/dashboard/capture/list` — a student's photos `[{key,url,name}]`.
  - `app/api/dashboard/capture/delete` — delete one key (+`_thumbnail`/`_preview` variants), guarded to the school prefix.

---

## 4. Mobile features → implementation

### A. Sort page (centerpiece) — student folders → tap → their photos
- **`/m/sort` (school picker) → `/m/sort/[schoolId]`**: grid of student tiles = cover
  (`photo_url`) + name + **shot count**, grouped by class; search box.
- Tap a student → their photo grid (**reuse `capture/list`**) with **delete** (reuse
  `capture/delete`) and **move** (below).
- **NEW `app/api/dashboard/capture/counts`** — `POST {schoolId, studentIds?}` →
  `{counts:{id:n}, cover:{id:url}}` via `listR2FolderImages` per student, concurrency‑limited.
  v1 fallback to ship fast: treat any student with a `photo_url` as "shot," load the exact
  count only when their folder is opened.

### B. Move / re‑assign a photo (the wrong‑kid / wrong‑QR fix)
- In a student's photo view: **"Move to…"** → search/pick another student → moves the R2 object.
- **NEW R2 helper** `r2CopyObject(srcKey, destKey)` (wire `CopyObjectCommand`,
  `CopySource = {bucket}/{srcKey}`) — copy‑then‑`r2Delete` (no re‑encode, no egress).
- **NEW `app/api/dashboard/capture/move`** — `POST {schoolId, key, toStudentId}`: validate
  `key` starts with the school prefix; resolve dest student (same school); destKey =
  `{schoolBaseId}/{dest.class_name}/{dest.folder_name||fallback}/{basename}` (synthesize +
  persist `folder_name` if missing); copy key + variants, delete source; if the moved file was
  the source's `photo_url` → repoint/null it; if dest `photo_url` empty → set it. Mirrors
  desktop `_reassignSelected`, done server‑side in R2.

### C. Delete a student (roster cleanup)
- **Gap found:** the existing student `DELETE`
  (`schools/[schoolId]/classes/[classId]/students/[studentId]`) removes the **DB row only** and
  **orphans the R2 folder**.
- **Fix:** augment that route (and/or a mobile `capture/student-delete`) to also
  `r2DeletePrefix` the student's folder(s) from `buildSchoolCandidateFolders`. Confirm dialog
  in the UI. Benefits desktop too.

### D. Event / school QR code (client self‑service)
- A **"Share / QR"** view per school/event: big scannable QR of the gallery URL + copy link.
  Generate QR client‑side. Schools → gallery login; events → `/g/<slug>` (or project PIN link).
  The booking system already produces gallery links to reuse.

---

## 5. Build sequence

1. **Sort page** + `capture/counts` (reuses list/delete) — the core the owner asked for.
2. **Move / re‑assign** (`r2CopyObject` + `capture/move`).
3. **Delete student** (R2 folder cleanup).
4. **Event QR** share view.

Each ships independently and appears in the installed iOS app automatically (Capacitor loads
the live `/m` site — no App Store resubmission). No native/Xcode changes for any of this.

---

## 6. Risks / notes

- Per‑student R2 listing is the cost center — concurrency‑limit and consider short‑TTL caching
  for large rosters.
- Move/delete reconcile the live gallery immediately (folder enumeration, `force-dynamic`).
- Keep every new endpoint on the capture‑route auth pattern (auth → photographer → ownership →
  `guardAgreement` on writes → school‑prefix key guard).
- Cover ≠ desktop "best" star; it's `photo_url`. Fine for v1; revisit if true best‑photo parity
  is wanted.
</content>
