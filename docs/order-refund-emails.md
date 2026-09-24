# Refund confirmation emails

Successful order refunds notify the buyer and photographer separately. Messages include the amount and currency of that individual refund, affected order references, refund reference and date, studio reply contact, and a note that bank posting time varies. Other orders remain unchanged. Partial refunds do not claim that an entire order is closed. No internal refund reason or payment credentials are included.

The buyer uses the order's customer email, falling back to parent email. The photographer uses the same billing-email then studio-email priority as new-order notices, with the owning authentication account's email as a final fallback. Reply-to uses the studio contact. Combined payments send one confirmation per audience for each successful Stripe refund, listing all affected orders. Mixed buyers, studios, currencies or payment references fail closed.

## Reliability

- Both direct Studio OS refunds and verified Stripe refund webhooks enqueue notifications. Payment refresh can recover missed notifications. Pending, failed, canceled and zero-amount refunds do not generate a success message.
- `order_refund_emails` is a service-only durable outbox. An atomic unique key identifies Stripe account + refund + audience. Recipient/content snapshots stay fixed across retries.
- Delivery runs after the HTTP response, using Next.js `after`, and a protected five-minute cron retries queued messages. An email problem does not turn a confirmed financial action into a failed refund.
- Database leases exclude concurrent workers. Resend receives the same idempotency key on every retry, including ambiguous accepted-but-response-lost attempts. Sent records never resend. Unresolved attempts older than 23 hours move to `needs_review`, before Resend's 24-hour idempotency window expires, for provider reconciliation rather than a risky automatic resend.
- `sent` means the email provider accepted the message. Inbox delivery is tracked by the provider and cannot be guaranteed by the application. Missing/ambiguous recipients are logged; Stripe webhook failures remain retryable.

## Validation and release

Executable tests cover client/photographer isolation, duplicate and concurrent events, lost provider responses, lost database acknowledgements, combined and partial refunds, ownership/currency mismatch, missing contact fallbacks, HTML escaping, pending/failed states, cron authentication, and PostgreSQL leases/RLS/expired retry handling. The opt-in remote release verifier checks the live outbox, real email credentials, verified sender domain and cron secret using read-only calls.

Apply and record `20260924180000_order_refund_emails.sql` transactionally before the guarded website deployment. No desktop rebuild is needed: installed apps use the existing server refund API. The user explicitly requested confirmation emails for Amber's already-issued CAD 103.60 duplicate refund; only that historical refund is to be backfilled. No additional refund or cancellation is authorized or necessary.

## Files changed

- `lib/order-refund-email.ts`: client and photographer templates.
- `lib/order-refund-notifications.ts`: validated recipient scope, outbox and delivery worker.
- `supabase/migrations/20260924180000_order_refund_emails.sql`: service-only ledger and lease function.
- `lib/payments.ts`, `app/api/dashboard/orders/payment/route.ts`: verified-refund hooks.
- `lib/resend.ts`: opt-in delivery timeout.
- `app/api/cron/order-refund-emails/route.ts`, `vercel.json`: authenticated retry worker.
- `scripts/verify-payment-release.mjs`, `tests/payment-release-verification.test.mjs`: live release checks.
- `tests/order-refund-emails.test.mjs`, `tests/order-payment-route.test.mjs`: behavior and regression checks.
- This release note.

Provider references: https://resend.com/docs/dashboard/emails/idempotency-keys and https://docs.stripe.com/refunds.
