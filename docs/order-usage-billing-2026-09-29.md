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

Full customer-order refunds made before fee reporting waive the unreported fee.
After reporting, a full refund queues a service fee credit on the photographer's
next subscription bill. A partial refund remains a paid order. No fee is
retroactively charged as part of this audit.

Each new fee retains the original Stripe customer, meter event name, paid
timestamp, billing period, currency and actual Stripe item unit amount in
`order_usage_fees`. Every new reported full refund, including one immediately
after reporting or monthly invoice finalization, receives a negative pending
invoice item for the original cents/currency and customer. Credits can offset
the next subscription invoice even when the photographer changes plans. An
account with no future invoice retains that pending invoice credit. This does
not amend a finalized invoice or return money to the photographer's card.

Stripe meter cancellation does not correct finalized invoices, so new refunds
never cancel meter events. Previously selected or completed cancellation
strategies require billing review without another cancellation or credit.
The worker verifies the full invoice-item receipt: object and ID, original
customer, currency, negative amount, pending `invoice=null`, and the original
flow/order/studio/meter-event metadata. Ledger `refund_status=completed` records
verified queueing, not financial settlement. The dashboard labels the amount
as credits queued this cycle, separately from the gross usage estimate before
credits. Queueing time does not establish the actual invoice where Stripe will
apply them. Outstanding refund/review counts include earlier billing periods
and remain visible after renewal or cancellation until resolved.

## Recovery and limits

Staging, reporting claims and the reported-order flag are transactional. Stripe
receives an immutable identifier and idempotency key for every order. Requests
already staged are retried across renewal and plan changes using their original
payload. The daily billing worker paginates subscriptions and bounds provider
concurrency. A full refund also attempts to queue its next-bill credit immediately
without turning an already successful customer refund into a failed payment action.

The safe idempotent retry window is 23 hours, leaving a margin inside Stripe's
minimum 24-hour retention. Requests retain the existing frozen description,
payload and key even after a plan change. If a provider response is uncertain
beyond that window, the ledger marks `review_required` and stops repeating the
financial request. This
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
after renewal, lost completion, partial/full refunds, recent refunds crossing
invoice finalization, original-amount next-bill credits, invalid receipt rejection,
legacy cancellation review without second adjustments, prior-period review
visibility and pagination, uncertain-response review, platform versus connected-account
revenue routing, monthly usage on annual plans, period/parent
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
no explicit `STUDIO_PAYMENT_REFUND_WEBHOOK_ID` and without
`STUDIO_CREDIT_WEBHOOK_CONFIGURE=1`, verification issues only GET requests and
never changes webhook configuration. Authenticated desktop RPCs, including
`deduct_studio_credits`, `refund_studio_credits` and
`finalize_background_credit_job`, are verified by database privilege tests;
they are not required in the service-role OpenAPI schema.

## Optional platform webhook repair

The platform credit webhook requires `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `charge.refunded`, `refund.updated`
and `refund.failed`. Read-only verification logs the selected platform endpoint
IDs and subscribed events before rejecting missing events. A Connect endpoint
cannot satisfy the platform-credit check.

After the compatible credit migrations and webhook code are already live, an
operator may explicitly set `STUDIO_CREDIT_WEBHOOK_CONFIGURE=1` together with
`STUDIO_CREDIT_EXPECTED_ACCOUNT_ID` containing the exact platform `acct_…` ID.
The existing `STUDIO_PAYMENT_RELEASE_VERIFY=1` switch remains required to run
the verifier. The configuration path checks the account returned by Stripe,
requires exactly one live enabled platform checkout endpoint at the production
webhook destination, preserves every existing subscription, and adds only
missing credit events. Its only POST body field is `enabled_events[]`; returned
endpoint ID, URL, live status, platform scope and event preservation are checked.
An ambiguous account or endpoint selection is refused before any update.
The legacy order-refund configuration ID must be unset for this step, so it
cannot also modify a second endpoint during the platform repair.

Do not set this configuration flag on the first preview or deployment build:
webhook configuration takes effect immediately, while that build's code is not
yet live. The old production credit refund handler is incompatible with the
new refund events. Deploy the compatible database and code first, then run the
separate guarded configuration step and remove the configuration opt-in. This
audit has prepared and tested the repair against mock Stripe responses only;
it has not changed live webhook subscriptions or moved money.

Sources: [Stripe billing-period change](https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end),
[mixed intervals](https://docs.stripe.com/billing/subscriptions/mixed-interval),
[finalized-invoice cancellation limitations](https://docs.stripe.com/billing/subscriptions/usage-based/meters/configure),
[negative invoice items](https://docs.stripe.com/api/invoiceitems/create).
