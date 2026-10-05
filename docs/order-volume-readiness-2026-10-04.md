# Order intake readiness — October 4, 2026

This change protects customer order intake and recovery for a planned 800–1,000
orders. Provider tests use isolated fixtures: no customer order, charge, email,
credit debit, lab dispatch or print is created by the diagnostics. It does not
change camera capture or photography settings.

## Behavior

- Customer Stripe events use private durable claims with expiring leases. A
  terminated request can be replayed; an insert-only provider-event audit row no
  longer falsely proves fulfillment completed. Ownership, connected account,
  complete group, amount, currency and payment references must match.
- A secret-protected worker recovers due signed events and checks a rotating,
  bounded page of old pending checkouts using account-scoped provider reads.
  Abandoned drafts cannot permanently hide later paid checkouts.
- First future paid transitions stage receipt, studio notification and eligible
  digital-delivery work in the same PostgreSQL transaction as the order. Existing
  paid orders are not backfilled or resent.
- Email workers freeze the exact request before contacting the provider, retain
  stable idempotency keys and provider acknowledgement IDs, and retry interrupted
  delivery. One global lease and paced requests protect provider capacity. Refund,
  cancellation and owner eligibility are rechecked before delivery. Unresolved
  work older than the conservative dedupe window requires provider review.
- Both recovery workers run every minute. They are private, bounded and recover
  expired claims; a browser return is not required to retain paid work.

## Evidence and limits

The actual create-order handler, pricing/photo-scope helpers and PostgreSQL safety
RPC handled 1,000 orders plus 400 retry submissions: exactly 1,000 orders and 2,000
items with correct totals, 200 students and 17 class-photo choices. Wrong student
portraits and wrong class photos were rejected before committing an order.
A further 1,000 signed webhook requests execute the real payment finalizer and
actual SQL trigger, staging exactly 2,000 messages. Actual PostgreSQL claim tests
cover 1,000 events, overlapping retries, worker death,
before/after-paid failures and rotated pending checks. Actual outbox SQL stages
2,000 messages for 1,000 paid orders and drains them in ten bounded 200-job claims;
rollback, refunds, private grants, recipient/key freeze and expiry are covered.
Worker tests inject provider response loss, database acknowledgement loss, rate
limits and retry failures without using production credentials.

These checks demonstrate order correctness and recovery under fixtures; they do
not certify 1,000 simultaneous live buyers or a complete real card payment on a
physical phone. A separate Stripe test environment is needed for external test
payments. Production release guards verify the deployed database tables/RPCs,
provider authentication, webhook subscriptions, retry credentials, verified email
sender and private photo storage without financial mutations.

The separate V2 Mac sync repair is 2.0.11+33 in the active V2 source. It removes the
200-order incremental and 3,000-order Refresh caps, imports complete keyset pages,
serializes overlapping pulls, preserves local history, and checkpoints only after
complete durable saves. Seven importer cases pass; the full live-v2 suite passes
1,422 tests with two existing skips, and whole-library analysis is clean. All 26
captured Canon/Capture source hashes are unchanged. A separately prepared signed
update must be installed on a Mac receiving orders for that desktop repair to
apply; publishing the website cannot update the installed desktop importer.

## Changed cloud paths

Business code:
`app/api/stripe/webhook/route.ts`, `lib/customer-order-webhook.ts`,
`lib/payments.ts`, `lib/paid-order-emails.ts`, `lib/digital-delivery.ts`,
`app/api/cron/customer-order-payment-recovery/route.ts`,
`app/api/cron/paid-order-emails/route.ts`.

Release/schema:
`supabase/migrations/20261005004000_paid_order_email_outbox.sql`,
`supabase/migrations/20261005005000_customer_order_webhook_recovery.sql`,
`vercel.json`, `package.json`, `scripts/verify-order-volume-release.mjs`.

Tests:
`tests/customer-order-webhook-recovery.test.mjs`,
`tests/customer-order-payment-outbox-integration.test.mjs`,
`tests/order-volume-readiness.test.mjs`,
`tests/order-volume-release-verification.test.mjs`,
`tests/paid-order-email-outbox-database.test.mjs`,
`tests/paid-order-emails.test.mjs`, plus import/behavior compatibility fixtures in
`tests/credit-payment-flow.test.mjs`, `tests/order-refund-webhook.test.mjs`,
`tests/order-payment-maintenance.test.mjs`, `tests/delivery-cutout-refusal.test.mjs`,
`tests/photoroom-preview-verification.test.mjs`, and
`tests/r2-staging-preview-verification.test.mjs` (the approved new release guard).
This document records scope and evidence; release logs record the final checked
commit, build, migration and deployment outcomes.
