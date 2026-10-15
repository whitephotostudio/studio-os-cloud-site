# Genuine Stripe Standard sandbox evidence — October 15, 2026

The primary financial rehearsal verified **20 genuine paid TEST order Checkout cases**, plus the subscription flow, against real local Supabase Auth/PostgREST and the actual Next application. Payments used hosted Stripe Sandbox Checkout; webhook evidence used original Stripe CLI signatures and bodies. This was an ordinary, non-admin synthetic photographer, not eligible for the platform-owner waiver. Paid subscription status was established through Stripe billing and signed events, not a manually activated fixture.

| Approved TEST scope | Account |
| --- | --- |
| Dedicated isolated platform | `acct_1UQo3XLkdaBBHhB9` |
| Original Express | `acct_1UQoJJLghbZLnG5t` |
| New Standard | `acct_1UQoJMQ9EOPSxHSm` |

The rehearsal pinned the exact platform identity and checked a genuine balance response with `livemode=false` before API mutation stages. Auth credentials, cookies, signing secrets, customer details and complete Checkout URLs remain outside Git.

## Actual application and fee collection

| Actual subscription | Collected order fee in CAD | Collected order fee in USD |
| --- | ---: | ---: |
| Gallery | C$0.55 | US$0.55 |
| Core | C$0.45 | US$0.45 |
| Studio | C$0.45 | US$0.45 |

Provider PaymentIntents, charges and application-fee balances agreed with frozen SQL fees, immutable account bindings and processed signed webhooks. The genuine Gallery subscription and authenticated Core/Studio changes verified owned V3 monthly prices of C$59/C$99/C$199, active subscription mirrors, 0/1/2 desktop keys and no monthly order meter.

School print and ordinary/event digital paths were exercised. Ordinary galleries share the shipped event-project branch; this does not claim a separate portrait endpoint. Gallery groups collected C$1.10 for two billable rows; a mixed group collected US$0.55 with one waived row; a fully test-waived paid order collected no application fee.

A separate real parent browser journey passed PIN/email access, photo selection, basket, actual order creation, hosted TEST payment and the same private gallery return displaying **Order Placed!** Financial verification independently matched that browser-created order.

## Original payments, failures and refunds

- **History and cutover:** activation rejected before backfill. Deliberately unbound synthetic historical fixtures were reconciled by the actual authenticated handler using original-account Stripe GETs: five rows, three paid/open/expired payment scopes, complete groups and zero review items. After Standard activation, held Express USD and grouped CAD checkouts still completed on Express. A provider-confirmed expired Express USD group received a Standard replacement while retaining its frozen US$1.10 fee.
- **Interrupted requests:** one successful Stripe response was lost; another response was lost after the database binding committed. Actual HTTP retries retained the original account, request hash, idempotency key and Session. Complete bounded provider enumeration found exactly one Session for each fault order.
- **Refunds:** original Express single/group and new Standard partial-to-full refunds passed. Customer balances and proportional/full application-fee refunds matched SQL. Genuine signed customer refund events **and platform-scoped application-fee refund events** reached actual Next HTTP 200 and processed merchant records.
- **First delayed paid delivery:** a Core C$0.45 case held both original paid events before any application delivery. SQL remained unpaid and the paid-event ledger was empty. A genuine C$30 customer/C$0.45 fee refund closed the order first. Both original paid bodies/signatures were then delivered within their original tolerance: HTTP 200, first ledger attempts of one, refunded status retained, `paid_at` still null, zero paid-email outbox rows and two refund outbox rows. Separate genuine duplicate replays also passed. Customer recovery cron recovered five, then ten stored genuine events with unchanged payload hashes and zero retry/review results.
- **Dispute:** the official dispute test card produced a genuine dispute on a Standard C$0.45 order. Guarded winning evidence produced `won`; the signed closed event reached HTTP 200 and the original-account merchant ledger. Ownership and fee remained unchanged. This order was not refunded.
- **Rollback:** authenticated rollback restored Express for future orders. A historical Standard US$30/US$0.45 refund still completed through the actual dashboard route, with signed customer and platform-fee evidence. A fresh unreserved Studio order then actually paid on Express and collected C$0.45. Both primary accounts remained connected.

## Checkpoint and limits

The separate merchant interruption/deauthorization gate also passed. A new, empty disposable Standard TEST account produced a genuine signed `account.updated` delivery that reached Next HTTP 503 after its durable processing claim. The real retry worker recovered the same event at its scheduled retry time, preserving its payload and advancing attempts from one to two. Only that separately created empty account was then deleted after zero-balance, zero-charge, zero-intent and no-payment-binding checks. Its genuine signed deauthorization reached Next HTTP 200, blocked only its history, and preserved the primary Express route at version 2. Post-deauthorization event retrieval was explicitly unavailable (platform 404 and revoked connected access 403); the acceptance proof uses the original verified signature/body, successful scoped deletion receipt and processed ledger with its unchanged payload hash, without claiming a successful provider event GET. All 14 merchant acceptance guards passed.

The primary financial checkpoint ended with local Express routing at version 2 and the genuine Studio subscription active. Harness guards passed 14 tests and ESLint; runtime source remained frozen while private evidence was recorded.

**No production mutations or live payments were performed for this rehearsal.** It did not change live routing, accounts, prices or storage, charge parents, or refund actual sales. Production compatibility, ownership, backup and release gates remain separate work; their current status belongs in the [release runbook](stripe-standard-release-20261015.md). Email-provider delivery and actual digital-file delivery are outside this financial evidence claim.

Private evidence includes the HTTP acceptance ledger, original signed captures, first-delayed terminal snapshot, provider Session uniqueness check, browser observations and independent merchant dispute proof. The reproducible guarded entry points are `scripts/stripe-standard-http-acceptance.mjs`, `scripts/stripe-standard-webhook-proxy.mjs` and `scripts/stripe-standard-merchant-acceptance.mjs`; private credentials are required explicitly and must never be committed.
