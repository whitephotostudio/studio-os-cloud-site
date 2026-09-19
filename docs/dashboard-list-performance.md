# Faster Schools and Projects lists

Schools previously held the entire list behind a scan of every school's original photo objects in cloud storage. It also waited for all roster statistics before showing a card. Projects fetched every media record, in sequential 1,000-row batches, just to calculate photo totals; it also fetched student rows to distinguish actual schools from event shells.

Schools now renders usable cards after its primary school/project queries finish in parallel. Database-side student counts preserve school/event filtering. Roster details and authoritative storage counts arrive independently in the background. Unavailable class/photo details display a dash while loading. Roster statistics paginate beyond 1,000 people.

Projects now obtains media totals in the project query and student totals in the school query, without transferring those individual records. The two queries run concurrently; album semantics and owner filters are preserved. A redundant client-side remote user lookup has been removed; the API still verifies authentication.

Both lists keep a five-minute, account-scoped memory snapshot for immediate return visits while revalidating on every visit. It is cleared on sign-out and account changes, never written to browser storage, and updated/invalidated for list mutations. Late responses cannot overwrite a newer load or restore removed cards. Hard refreshes and first visits still require network access; this does not promise zero latency or cache cover-image bytes.

## Files changed

- `app/dashboard/schools/page.tsx`: primary/secondary loading, immediate cache display, roster pagination and stale-response guards.
- `app/dashboard/projects/events/page.tsx`: cached list display and background refresh; keep existing cards on a transient refresh error.
- `app/api/dashboard/events/route.ts`: database-side counts, parallel queries and preserved owner/school filtering.
- `lib/dashboard-list-cache.ts`: expiring, memory-only, account-scoped snapshots.
- `app/dashboard/layout.tsx`: clear snapshots on sign-out.
- `tests/dashboard-list-performance.test.mjs`: executable real-loader/route tests for progressive display, warm visits, pagination, cover preservation, exact large counts, authentication and cache isolation.
- `tests/dashboard-school-cover-thumbnails.test.mjs`: adapt the existing cover regression to the two loading phases.
- This report.

## Verification

- All 255 automated tests pass; TypeScript passes.
- Focused ESLint passes for the changed lists, API, cache and tests with existing unused-code/image warnings. The layout's existing mobile-drawer effect still triggers its pre-existing `react-hooks/set-state-in-effect` error; that effect was not changed.
- Isolated browser verification used the actual Schools and Projects components with synthetic data and deliberately delayed queries. Return visits displayed cards immediately, before refresh responses returned.
- Read-only production database comparison, September 19, 2026: the old count scan transferred 6,890 records (675,221 JSON bytes) over seven sequential requests in 2,683 ms. The replacement returned the same count across 22 projects in 1,039 ms and 1,534 bytes. These are individual query-path measurements, not full page-load timings or a guaranteed benchmark.
- Database relationship-count support was verified on the deployed schema; no schema changes or migrations are required. [PostgREST relationship documentation](https://docs.postgrest.org/en/stable/references/api/resource_embedding.html).

Production release and live-page verification follow the guarded deployment.
