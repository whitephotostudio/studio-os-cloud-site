# Owner overview

Implementation: `codex/owner-overview`, September 24, 2026.

The Supabase Small capacity upgrade was completed and checked before this work.
The deferred hourly implementation task was paused to prevent duplicate work.

## Delivered scope

- `/dashboard/admin/overview`, linked from the owner sidebar and Admin Users.
- Cross-account attention checks: missing login/profile, confirmed but incomplete
  trial setup, subscription billing issues, recorded payment/refund issues,
  failed or stalled notification queues, and recorded errors in the last seven days.
  Recent errors are evidence to review, not a claim that the failure is unresolved.
- Searchable, paginated photographer progress: confirmation, trial setup, first
  activation/gallery/photo record, available keys separately from deduplicated
  current device registrations, last sign-in/photo/roster/device timestamps.
- Owner-only account timelines with private append-only support notes, audit
  actions, notification status, and device releases. Future trial changes are
  audited; device release events survive reactivation.
- Recorded platform subscription invoice receipts, deduplicated by invoice and
  separated by currency. Customer gallery order totals/refunds appear only in
  the photographer detail. Neither figure claims to be a Stripe reconciliation.
- Email history labels provider acceptance separately from delivery. CRM provider
  delivery events are shown when present. Historical trial/refund notifications
  are never resent by these views.
- Explicit coverage and observation times. A failed read renders unavailable,
  never zero counts or an all-clear. Cloud Flow is identified as studio-scoped.

## Security and query design

Owner APIs require validated authentication, satisfied MFA when applicable, and
`photographers.is_platform_admin`. Reads do not create or repair accounts.
Database functions repeat the owner check and are executable only by the service
role. Notes have RLS enabled with no browser-role grants or policies. Note writes
validate origin, JSON body size, length, rate limits and an idempotency UUID.

Queries return explicit safe fields, not auth metadata, keys, device IDs, payment
credentials, raw audit JSON, email bodies, or customer order details. Account and
history pages are bounded to 25 records, device details to 20. No background
polling was added. Supporting indexes and an eight-second database query limit
bound the impact on the recently resized database.

## Validation

- 340 tests passed, including 14 new database/API regressions: access control,
  MFA, incomplete vs expired trials, literal search, missing profiles, pagination,
  device deduplication, key/privacy boundaries, note isolation/retry behavior,
  sent vs delivered mail, device release history and financial separation.
- TypeScript check passed; new overview files pass ESLint without warnings.
- Browser review at desktop and 390px mobile: populated/attention view, private
  note save and author history, empty search, and failed-query unavailable state.
  Browser fixtures were local only, with no production users or emails created.
- Transactional live-schema preflight ran both RPCs successfully and rolled back:
  eight profiles, five active trials, no confirmed logins missing profiles.

## Known coverage boundaries

Photo records confirm a saved database record; they do not verify every storage
object or capture all failed upload attempts. Last sign-in and device check-in
are not last successful product use. A device can remain registered while offline.
Legacy and project photo records may represent the same image, so the UI says
photo records. Galleries exclude school-backed project bridges from double counts.

Notification sources without delivery events remain unverified in the timeline,
even if a previous manual provider check established delivery. Recent recorded
errors need human review; no automatic resolution is inferred. Database capacity
and complete checkout/upload journeys are not continuously tested by this page.

The live snapshot completed in 175 ms and denied anonymous RPC access. The only
flagged account was the owner studio, with five failed gallery invitation records
from June 15, 2026. These are historical failures, not evidence of a new outage.
A follow-up migration exposes older flagged records alongside the current history
page so they cannot be hidden behind newer activity. No messages were resent.

Deployment and production verification will be recorded after the guarded release.
