# School yearbook portrait selection

School Settings → General contains the yearbook controls. Parent selection is
off until the photographer enables it. The optional deadline closes at the end
of that day in America/Toronto (Eastern Time, including daylight saving).

In the parent gallery, Yearbook portrait opens a separate choice panel. Each
student gets one designated original pose; students sharing a family PIN have
separate choices. Save writes to the server and reloads the saved record before
showing confirmation. Shopping favorites, cart photo choices, and desktop best
shots remain independent. A stale browser revision cannot overwrite a newer
choice without reloading.

The photographer can review or change a choice after the parent deadline. CSV
export includes every roster student, selected storage key, output filename,
source, time, and current availability. Original ZIP exports contain at most
72 chosen portraits per batch plus a manifest. Missing or deleted chosen
portraits stop a ZIP export with a review message; CSV flags them. Export reads
revalidate exact student folders, original object existence, and tombstones.

These exports are inputs for a yearbook publisher. They are not a claim of
certified PSPA output. The dedicated yearbook choice does not automatically
replace the Mac app's `.studioos_best.txt` marker; no desktop files were changed.
The CSV uses the immutable cloud student UUID to avoid filename collisions.

## Deployment

Apply `20261008030000_school_yearbook_selections.sql` before releasing the
frontend. It adds two RLS-protected tables with owner-only authenticated reads,
no anon access, and no direct authenticated writes. Both save functions and
the schema-status function are callable only by the service role.

`school_yearbook_schema_status()` returns version 1 plus `settingsRls`,
`selectionsRls`, `clientWritesRevoked`, `settingsSaveServiceOnly`,
`selectionSaveServiceOnly`, `atomicRevision`, and `currentPhotoScope`.
The last field confirms the installed SQL snapshot/PIN/tombstone boundaries;
the endpoint checks current R2 object membership because SQL cannot inspect R2.

Parent writes also require an active published school, an active studio
subscription, the school's enabled selection window, and a student PIN. The
atomic save locks the school row and rechecks the owner's identity, student
school/folder snapshot, PIN, deadline, deletion state, and selection revision.
No payment, notification, or background processing occurs during selection.

## Verification

`tests/school-yearbook.test.mjs` exercises the actual endpoints with isolated
provider fixtures: persistence/readback, sibling/cross-school boundaries,
current objects, deleted/derived/nested photos, closed/expired galleries,
subscription/deadline gates, owner/MFA/agreement gates, revision conflicts,
rate limits, export availability and CSV formula protection.

`tests/school-yearbook-database.test.mjs` executes the actual migration using
PGlite and verifies RLS isolation, revoked client writes/RPC execution,
atomic revisions, updated PIN/folder/owner checks, tombstones, deadline and
subscription rechecks. These checks do not prove a live browser or production
yearbook workflow. Save → reload → selected-image export still needs visible
verification using an authorized fixture school.
