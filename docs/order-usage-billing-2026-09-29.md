# Order service fees and owner revenue

Customer gallery orders are direct Stripe Connect charges on the photographer's
account. Studio OS receives separate platform subscription and credit-pack
payments. Order service fees are metered on the photographer's platform
subscription, rather than deducted from the customer's order payment.

Default platform currency is CAD. The configured paid-order rates are Starter
$0.55, Core $0.35, and Studio $0.25 per order record. Combined sibling orders can
contain multiple billable order records. An active or Stripe-trialing platform
subscription and its customer/meter item are required for automatic fee billing.
A free application trial without a Stripe subscription has no payment method to
invoice. Test, unpaid and zero-price orders are excluded.

## Refund behavior

Full customer-order refunds waive the order service fee. A partial refund remains
a paid order. This follows the existing advertised fee per paid order; no fee
is retroactively charged as part of this audit.

Each new fee retains the original Stripe customer, meter event name, paid
timestamp, billing period, currency and actual Stripe item unit amount in
`order_usage_fees`. A refund made before any report waives the reservation. A
recent reported event is canceled; an older event receives a negative invoice
item for the original cents/currency on the customer's next invoice. Credits
can offset the next subscription invoice even when the photographer changes
plans. An account with no future invoice retains that pending invoice credit.

Stripe only accepts meter-event cancellation within 24 hours. The worker uses a
23-hour safety window and never changes refund strategies after an uncertain
provider result. v1 meter event adjustments have no `id`; their returned event
name and cancellation identifier are verified instead.

## Recovery and limits

Staging, reporting claims and the reported-order flag are transactional. Stripe
receives an immutable identifier and idempotency key for every order. Requests
already staged are retried across renewal and plan changes using their original
payload. The daily billing worker paginates subscriptions and bounds provider
concurrency. A full refund also attempts its queued waiver immediately without
turning an already successful customer refund into a failed payment action.

If a provider response is uncertain beyond the safe idempotency window, the
ledger marks `review_required` and stops repeating the financial request. This
prevents duplicate charges or refund credits; an operator must reconcile that
event in Stripe. Historical `counted_for_monthly_usage=true` orders do not have
verified fee snapshots and are never guessed, recharged or automatically
credited by the new ledger. New unstaged paid orders are collected only from
the current Stripe usage-item period.

Stripe Basil moved billing periods from subscriptions onto individual items.
Annual plan renewal uses the annual item; service-fee reporting uses the monthly
usage item. Annual plans use flexible billing before that monthly item is
attached. Invoice webhooks accept Basil's parent subscription reference as well
as older payload shapes. Connected-account events cannot provision platform
plans or overwrite platform subscription access.

## Validation

The database and request tests cover concurrent reports, exact payload retry
after renewal, lost completion, partial/full refunds, recent event cancellation,
older original-amount invoice credits, uncertain-response review, platform versus
connected-account revenue routing, monthly usage on annual plans, period/parent
API shapes, rate-preserving summaries and more than 200 subscriber accounts.

Release verification reads the ledger columns and verifies all service RPCs in
PostgREST OpenAPI without creating charges, credits or test payments.
`STUDIO_CREDIT_RELEASE_VERIFY=1` enables these schema and platform-credit webhook
checks. An isolated preview candidate can leave that flag unset or `0` while
the migrations await application; enable it for the final guarded production
release after the fee, credit and cloud-job migrations are applied. Provider
keys are never needed for these read-only schema checks. Neither this flag nor
the verification script processes a photo, debits credits or posts a meter event.
Set `STUDIO_CREDIT_WEBHOOK_VERIFY=1` on that preview candidate to verify platform
Stripe event subscriptions independently of the unapplied schema checks. With
no explicit `STUDIO_PAYMENT_REFUND_WEBHOOK_ID`, verification issues only GET
requests and never changes webhook configuration. The legacy desktop-only
`finalize_background_credit_job` is authenticated-only and is not required in
the service-role OpenAPI schema.

Sources: [Stripe billing-period change](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end),
[mixed intervals](https://docs.stripe.com/billing/subscriptions/mixed-interval),
[meter-event cancellation](https://docs.stripe.com/api/billing/meter-event-adjustment/create),
[negative invoice items](https://docs.stripe.com/api/invoiceitems/create).
