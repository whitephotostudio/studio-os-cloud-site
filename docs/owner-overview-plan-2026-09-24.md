# Owner overview — implementation plan

Requested on September 24, 2026. The database capacity upgrade is complete.
Implementation and verification are recorded in
[the release report](owner-overview-release-2026-09-24.md).

## First delivery

1. **Needs attention.** Show confirmed account-access problems and recorded
   upload, payment, refund, and email failures. Each item must identify the
   photographer, evidence and event time, and an appropriate support action.
   Inactivity alone is not a technical failure. If a failure source is not
   instrumented, say that coverage is unavailable instead of reporting healthy.
2. **Photographer progress.** Show email confirmation, trial initialization and
   expiry, actual app activation, first gallery, and first successful photo
   upload. Distinguish available keys, active device registrations, last
   sign-in, and last recorded product activity. Make it possible to inspect a
   photographer directly from an attention item.
3. **Account history.** Provide an owner-only, paginated timeline of existing
   audit events, trial changes, device releases, notification events and
   recorded errors. Add owner support notes with author and timestamp; notes
   must not be exposed to other photographers or customers. Do not surface raw
   audit payloads, credentials, payment data, or private customer details.

## Remaining requested coverage

- Actual usage: gallery/photo/order counts, last successful upload or sync,
  app version and activated devices. Display absent telemetry as unknown.
- Payments: separate platform subscription revenue from photographers'
  customer sales. Use authoritative amounts and payment/refund state, not
  current package prices or trial status as a proxy for collected revenue.
- Email history: recipient, purpose, send time and provider-confirmed delivery
  or failure. Distinguish accepted/sent from delivered. Do not resend historical
  trial or Amber refund emails as part of this work.
- System health: name each check, its last successful observation, whether it
  covers the platform or one studio, and any known affected photographers.
  Existing Cloud Flow checks frequently cover the signed-in owner's studio.
  Configured credentials do not prove that payments or uploads work.

## Implementation constraints

- Extend the existing admin navigation and account directory; retain existing
  support controls. Start with an overview that links to photographer detail.
- Enforce platform-owner access on the server for all cross-account reads and
  writes. Keep ordinary photographer data isolation intact.
- Inventory existing tables/events before adding telemetry. Reuse audit_log
  and existing notification state where possible, with explicit safe fields.
- Use bounded, paginated queries and appropriate indexes. Avoid full-history
  downloads, frequent polling, or per-account network fan-out. Add cache/freshness
  information where useful; never turn query failures into zero counts.
- Build and test locally. Do not add production load tests, change infrastructure
  spending, or apply migrations while the capacity incident remains pending.
- Before release, verify meaningful cases: unauthorized access, incomplete
  signup, expired vs valid trial, available vs activated keys, inactive but
  healthy account, real recorded failure, stale/failed telemetry, owner notes,
  email delivery state, and subscription/customer-sales separation.
- Follow AGENTS.md release safety: clean worktree, focused commits, required
  checks and the guarded production deployment command. Browser-check empty,
  populated and error states. Report exactly which coverage is live and any
  sources still unavailable.

## Starting points

- `app/dashboard/admin/users/page.tsx`
- `app/api/dashboard/admin/users/route.ts`
- `app/dashboard/admin/cloud-flow/page.tsx`
- `app/api/dashboard/admin/cloud-flow/route.ts`
- `lib/dashboard-auth.ts`
- `lib/audit.ts`
- `lib/admin-notification-center.ts`
- `lib/order-refund-notifications.ts`

Existing work to preserve: the five refreshed trials and delivered recovery
emails, Amber's single duplicate-order refund and delivered notifications, and
the September 24 photographer-journey fixes. None should be repeated or reset.
