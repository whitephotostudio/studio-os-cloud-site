# Studio OS Cloud — Data Model & Workflow (Schools vs Events)

Status: **Draft v1** — design proposal, not yet implemented.
Author: Claude (via Cowork), on behalf of Harout.
Last updated: 2026-04-22.
Supersedes: nothing (first written checkpoint of this area).

---

## Purpose

Studio OS Cloud currently runs two distinct photographer workflows inside a
single codebase and a single Supabase schema:

- **Schools mode** — school picture days, roster-driven, PIN-per-student.
- **Events mode** — weddings, parties, portraits. Open gallery, PIN-per-project
  or per-album.

Both modes were added organically and now share some tables, fork others, and
leave a handful of fossil tables behind. This doc captures the current model,
names the problems it causes, and proposes a unified data model that both modes
can live inside without the ambiguity the current one has.

Scope is deliberately narrow: data model + end-to-end workflow. It does **not**
propose UI changes, pricing changes, or Flutter/desktop changes except where
the data model forces them. It does not include a SQL migration plan — that's a
follow-up doc once this design is agreed on.

---

## Current state

### Dual modes, one project table

Every photographer engagement — school picture day or wedding — becomes a row
in `public.projects` with a string `workflow_type` column set to either
`"school"` or `"event"`. Mode-specific columns live side-by-side on the same
table:

| Column family | Schools mode | Events mode |
|---|---|---|
| Link to roster | `linked_school_id`, `linked_local_school_id` | unused |
| Client metadata | unused | `client_name`, `event_date` |
| Access | `access_mode`, `access_pin` (often unused) | `access_mode`, `access_pin` (primary) |
| Portal state | `portal_status` | `portal_status` |
| Lifecycle | `status` (`active` / `inactive`) | same |

A second table, `public.schools`, stores school-specific state that
`projects` doesn't carry: `gallery_status`, `gallery_release_at`,
`gallery_expires_at`, `order_due_date`, `email_required`,
`checkout_contact_required`, plus the studio-created `local_school_id` that
the desktop app uses as a storage-folder root.

This means a school project has state spread across two tables
(`projects` + `schools`) with overlapping lifecycle fields
(`projects.portal_status` vs `schools.gallery_status`), while an event project
keeps everything on `projects`.

### Roster, classes, students

Schools mode layers three tables on top:

- `schools` — owned by a photographer via `photographer_id`.
- `classes` — owned by a school via `school_id`.
- `students` — owned by a school + class, one row per child. Holds
  `first_name`, `last_name`, `pin`, `photo_url`, `folder_name`.

A fourth table, `school_roster_snapshots`, keeps historical copies of roster
uploads per school for audit.

There is no equivalent hierarchy on the events side. An event is just a
`projects` row plus a tree of `collections` (see below).

### Albums / collections / media

Events mode uses `public.collections` (with `kind = 'album'`) to organise
media within a project. Collections support nesting via `parent_id`, per-album
PIN overrides via `access_pin`, and a sort order. Media is attached to a
project and optionally a collection:

```
projects (1) ─── (N) collections (self-referencing)
   │                  │
   └── (N) media ─────┘
```

Schools mode does **not** use collections. Student photos are organised on
disk by folder path (`<local_school_id>/<class_name>/<folder_name>/...`) and
resolved at read time by listing R2, not by DB rows. The `media.project_id`
column does get populated for school projects, but the link between a photo
and a student is purely filename/folder-based.

### PIN fragmentation

Schools PINs live on `students.pin`. To access a school gallery, a parent
chooses the school, types the student's PIN, and the server resolves the
student → class → folder path.

Event PINs live on `projects.access_pin` (whole project) or
`collections.access_pin` (per-album override). A parent types one of those
PINs and the server resolves it to the project or collection.

These are two different PIN concepts — one identifies a subject, the other
gates a gallery — and they've ended up in columns with similar names
(`pin` vs `access_pin`). The server has two completely separate route
handlers for them (`/api/portal/school-access` vs `/api/portal/event-access`)
with duplicated rate-limit code, email-capture code, and status-check code.

### Visitor / download tracking

Same pattern duplicated twice:

- `event_gallery_visitors` + `event_gallery_downloads` + `event_gallery_favorites`
  on the events side.
- `school_gallery_visitors` + `school_gallery_downloads` on the schools side
  (no favorites table for schools).

Both sets key off an email address. Both carry near-identical columns
(`viewer_email`, `last_opened_at`, etc.). The only structural difference is
that the events side has `collection_id` and `media_id` on the favorites and
downloads tables, whereas schools is always scoped to a school id.

### Orders, packages, checkout

Orders are unified — one `orders` table with nullable foreign keys to every
context:

```
orders.photographer_id  (NOT NULL)
orders.project_id       (nullable, either mode)
orders.school_id        (nullable, schools mode)
orders.student_id       (nullable, schools mode)
orders.class_id         (nullable, schools mode)
```

In practice a school order has `student_id` + `school_id` set and `project_id`
sometimes set; an event order has `project_id` set and the rest NULL. There's
no DB constraint enforcing a valid combination, so nothing stops a row from
having none of these set or all of them set.

`order_items` hangs off `orders.id`. `packages` is owned by photographer and
scoped via `package_profiles` for catalog filtering. Both are unambiguously
shared.

### Fossils

- `public.photos` — 0 rows. Replaced by `public.media` which holds all 1,152
  rows. `media.subject_id` points at `public.subjects`, also 0 rows. These
  were an earlier draft that shipped the table but not the code.
- `public.backdrop_selections` — 0 rows. The desktop app writes metadata to
  `backdrop_catalog` directly; the selection-tracking layer was never wired.

### Shared infrastructure

Good news: a lot is already shared cleanly.

- `photographers`, `studios`, `subscriptions`, `credit_*`, `stripe_events`
  — studio-level, mode-agnostic.
- `packages`, `package_profiles`, `orders`, `order_items` — checkout is one
  funnel.
- `backdrop_catalog` — photographer-level inventory, used in both gallery
  types.
- `media` — single asset table (once you stop reading `photos`).
- `portal_email_captures` — a unified email-signup table with nullable
  `project_id` and `school_id`. Already the pattern this doc is proposing
  more broadly.
- `audit_log`, `ai_action_logs` — cross-cutting.

---

## Problems the current model creates

**Ambiguous project rows.** `projects` conflates two workflows. Any code
that touches the table has to branch on `workflow_type` — every dashboard
query, every portal route, every analytics rollup. Worse, columns that only
apply to one mode are still readable for the other, which makes bugs subtle
(e.g. an event project with a stale `linked_school_id` from a copy-paste is
syntactically valid).

**State duplication between `projects` and `schools`.** When a school's
`gallery_status` changes, does `projects.portal_status` get updated too? The
code says "sometimes" — I've seen paths that update one and not the other.
The source of truth is unclear, which leaks into the parent-facing portal.

**Two PIN systems, two portal routes.** `school-access` and `event-access`
have drifted. Rate limiting was added twice. Email whitelist was added twice.
Whenever we harden one we have to remember to harden the other — that was the
exact class of bug behind the post-breach sweep in March.

**No DB-level link from photo to student.** Schools rely on R2 folder paths
to associate a photo with a student. A rename breaks the link silently. We
can't answer "give me every photo of student X" with a query.

**Loose orders.** A malformed order row that references neither a project
nor a school/student is possible. Refund flows and audit reports have to
defensively check every combination.

**Fossil tables drift into being load-bearing.** `media.subject_id` is a live
foreign key to `subjects`, even though `subjects` has never held a row.
Anyone reading the schema for the first time assumes it's used.

---

## Proposed unified model

The core idea: **one `projects` table, one PIN/access model, one visitor
model, mode-specific roster tables only where roster is actually a thing**.

### Renaming and scoping

1. Keep `projects` as the anchor. Every photographer engagement is a project.
   A project has exactly one `mode`: `school` or `event`. Rename
   `workflow_type` → `mode` and back it with a check constraint or (better)
   a Postgres enum.

2. Move mode-specific columns off `projects` onto sidecar tables, one-to-one
   with the project:
   - `project_schools` — currently the `schools` table, renamed, with
     `project_id` as the only key back. Drops `linked_school_id` noise.
     Holds `local_school_id`, `gallery_status`, `gallery_release_at`,
     `gallery_expires_at`, `order_due_date`, `email_required`,
     `checkout_contact_required`.
   - `project_events` — new. Holds `client_name`, `event_date`, and any
     future event-only columns (venue, package tier, etc.).

3. A school project has a row in `project_schools` and none in
   `project_events`. An event project has the mirror image. Enforce via a
   check constraint + two one-to-one FKs (both nullable, exactly one set).

### Roster

Keep `classes`, `students`, `school_roster_snapshots`. Repoint their FKs from
`school_id` to `project_id` (because "school" becomes a sidecar on the
project now). Keep `students.pin` as the subject-identifier.

### Collections & media

Extend `collections` to both modes. School mode can model each class as a
top-level collection and each student as a nested sub-collection. This gives
us a DB-backed link from media to student:

```
project (school mode)
  ├── collection: Class "Mrs. Smith's Grade 4"  (kind='class')
  │     ├── collection: Student "Ava Patel"     (kind='student', student_id FK)
  │     │     └── media (N)
  │     └── collection: Student "Ben Kim"
  │           └── media (N)
  └── collection: Roles  (kind='role-folder')
        └── collection: "Teacher Portraits"     (kind='role')
              └── media (N)
```

Events mode keeps its current tree: `album` collections under a project, with
arbitrary nesting.

`media` keeps `project_id` + optional `collection_id`. Drop `subject_id` (it
points at a fossil table); re-introduce as a proper FK to `students` only if
we choose to keep the current R2-folder mechanism as a fallback.

### Unified access (PIN) model

Introduce one access-token table, `portal_access_tokens`:

| column | meaning |
|---|---|
| `id` | uuid |
| `project_id` | what this token unlocks |
| `scope` | enum: `project` \| `collection` \| `student` |
| `scope_ref` | id of the collection or student (NULL if `scope='project'`) |
| `token` | the PIN/access code shown to parents |
| `token_hash` | optional: hash for secure comparison |
| `expires_at` | nullable |
| `metadata` | JSONB (source, last-rotated-at, etc.) |

Delete `projects.access_pin`, `collections.access_pin`, and
`students.pin`-as-access-token (keep `students.pin` only as a roster
identifier if we actually use it for roster matching, otherwise drop). All
PIN lookups go through this table.

This gives us:
- One rate-limit code path.
- One place to rotate keys / expire access.
- Consistent analytics on which PIN was used.
- Room to add per-parent tokens, magic-link tokens, etc. later without
  another schema change.

### Unified visitor and download tracking

Collapse the four tables into two:

- `portal_visitors (project_id, viewer_email, first_opened_at, last_opened_at, visit_count, metadata)`
- `portal_downloads (project_id, viewer_email, media_id, downloaded_at, download_type, metadata)`

Favorites become a third, already-project-scoped table:

- `portal_favorites (project_id, viewer_email, media_id, collection_id, created_at)`

All three work identically across school and event projects. Schools rollup
queries join via `project_id → project_schools.local_school_id` when needed.

### Orders

Tighten with a check constraint: an order must have either
`(project_id IS NOT NULL)` (sufficient — all other context can be derived
from collections / students) or an explicit photographer-initiated override
flag. Deprecate direct writes to `orders.school_id` / `orders.class_id` —
derive them from the project on read instead.

### Fossils

Drop `public.photos` and `public.subjects` after confirming no code reads
them. (They have zero rows, so no data risk.)

---

## Workflows against the unified model

### Schools mode

1. **Create project** — photographer hits "New School Project". Server
   inserts `projects` (mode=`school`) and `project_schools` (with fresh
   `local_school_id`). Desktop app picks up the `local_school_id` via the
   existing desktop-sync route.

2. **Upload roster** — photographer imports CSV. Server upserts `classes`
   + `students` rows, takes a `school_roster_snapshots` copy.

3. **Picture day / composite build** — desktop app captures, uploads to R2
   under `<local_school_id>/<class>/<student>/...`. As media is uploaded,
   server inserts `collections` rows (`kind='class'` then `kind='student'`)
   and `media` rows linked to the right collection. Student photos gain a
   real DB link to their student.

4. **Publish** — photographer sets `project_schools.gallery_status = 'live'`
   and `gallery_release_at`. Server issues PIN tokens into
   `portal_access_tokens` — one per student, `scope='student'`.

5. **Parent access** — parent enters school name + student PIN in
   `/parents/...`. Portal resolves via `portal_access_tokens` with
   `scope='student'`, returns the student's collection and media.

6. **Order** — parent checks out. `orders` row references `project_id` only;
   student and school derived via joins.

### Events mode

1. **Create project** — `projects` (mode=`event`) + `project_events`.

2. **Build album tree** — photographer creates collections under the project
   (`kind='album'`). Uploads media tagged with the right `collection_id`.

3. **Publish** — photographer sets access. Can issue either a single
   `scope='project'` token or per-album `scope='collection'` tokens into
   `portal_access_tokens`.

4. **Parent access** — parent enters PIN. Portal resolves via
   `portal_access_tokens`, returns the project or collection.

5. **Browse, favorite, download** — writes land in `portal_favorites` /
   `portal_downloads`, same as schools.

6. **Order** — same flow as schools.

The two workflows now differ only where they actually differ — in whether a
roster exists and in what the collection tree represents. Everything else —
access, tracking, checkout — is one code path.

---

## Migration path (high level)

The model above is schema-destructive to reach, so staged rollout matters.
Rough plan, to be fleshed out in a follow-up migration doc:

- **Phase 1, additive.** Create `project_events`, `portal_access_tokens`,
  `portal_visitors`, `portal_downloads`, `portal_favorites`. Backfill from
  existing tables. Keep the old tables in place but dual-write during the
  transition so we can A/B the read path.

- **Phase 2, cut over reads.** Switch dashboard, portal, and Flutter reads
  to the new tables behind a feature flag. Verify parity for a full billing
  cycle.

- **Phase 3, freeze writes to legacy.** Stop writing `projects.access_pin`,
  `collections.access_pin`, `students.pin` (as access token), and the four
  gallery-visitor tables. Keep them readable for analytics rollback.

- **Phase 4, drop.** Remove `photos`, `subjects`, the legacy columns, and the
  duplicate visitor/download tables. Rename `workflow_type` → `mode`.

Each phase ships its own migration + rollback SQL, following the
`docs/rollback/*` pattern already in the repo.

---

## Open questions

- **Does schools mode still need `students.pin` at all once access tokens
  exist?** If rosters are matched purely by name + school, PIN on the roster
  row becomes redundant. If envelopes still get physically printed with a PIN
  per student, we keep it — but it's a roster ID, not an access token.

- **Access token hashing.** Store tokens in plaintext (current reality) or
  hash them at rest? Hashing prevents a DB compromise from leaking parent
  gallery access, at the cost of not being able to show the photographer
  which PIN is assigned to which student without regenerating.

- **One-to-one enforcement of sidecar tables.** Do we use a deferred check
  constraint (`(project_schools IS NOT NULL) <> (project_events IS NOT NULL)`)
  or handle it in app code + triggers? Check constraints on cross-table rows
  are awkward in Postgres — probably app-layer invariants + an integrity
  cron.

- **Desktop app compatibility.** The Flutter app at
  `~/Downloads/Whitephoto_Studio_App_MVP_Source/` currently reads `schools`,
  `classes`, `students` directly. A rename from `schools` → `project_schools`
  breaks it. Either keep `schools` as a view, or ship a Flutter release
  alongside the migration.

- **Historical orders.** Old `orders` rows with `project_id = NULL` but
  `school_id + student_id` set need a retroactive `project_id` via join.
  Doable, but worth a specific backfill script.

- **`backdrop_selections`.** Zero-row table. Drop it too, or keep as
  scaffolding for future roster-based backdrop assignments?

---

## What this doc is not

Not a migration plan, not code. Once the shape is agreed, the next
deliverable is `docs/design/data-model-migration.md` with the concrete SQL,
phase-by-phase rollout, rollback path, and Flutter-side impact list.
