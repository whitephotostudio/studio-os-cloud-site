# Checkout duplicate-payment investigation and refund controls

## Incident evidence

Read-only production order lookup on September 24, 2026 found two identical carts for the reported customer. Both database rows are `paid` / `succeeded`, each CAD 103.60, with distinct Stripe PaymentIntent references:

| Cloud order | Created (UTC, September 23) | Paid (UTC) | Payment reference |
|---|---|---|---|
| `7d42207e-bad1-4d14-8041-870304f807a8` | 21:59:23 | 22:00:12 | `pi_3UIyCyLqg5vdCgpU14DtxZrw` |
| `1d7498f7-4e57-4964-89d7-6d34e0093245` | 22:02:43 | 22:03:18 | `pi_3UIyFyLqg5vdCgpU2aPV7Wqe` |

Their saved carts match, including products, quantities, image selections, backdrop and retouching instructions. Direct production Stripe verification now confirms that both distinct PaymentIntents succeeded, both charges were paid and captured, and each received CAD 103.60. Both had CAD 0 refunded and no pending refunds at verification. This confirms the duplicate charge; it does not establish what the browser or network did. The local Stripe credential was expired. Follow-up diagnosis established that Vercel intentionally exports Secret values as `[SENSITIVE]`; the earlier hosting-export HTTP 401 tested that placeholder, not the actual production Stripe key. It is not evidence of a broken live key. A read-only release verification script now runs inside the remote build with the real environment, checks payment/webhook configuration and the selected incident payments, and blocks promotion on verification failure. No customer refund or cancellation has been authorized or performed.

## Findings and changes

- Order creation previously inserted a new draft for each retry. Stripe idempotency used the newly generated order ID, so it could not protect two different drafts for the same purchase. Both single and combined checkout creation now commit orders, items and a replayable response in one database transaction.
- The browser retains an attempt per cart across reloads/navigation, blocks simultaneous submissions, and stops safely if local persistence is unavailable. The server also combines identical submissions made with different keys within ten minutes. Explicit **Reorder** creates a new purchase intent.
- Checkout resumes its existing open Stripe session. Only a Stripe-confirmed expired session permits a replacement, with its own stable retry key. A durable lock serializes checkout with cancellation/refund. An ambiguous session-creation result remains marked for recovery and cannot be falsely cancelled.
- Signed-in studio owners can review the actual Stripe amount, customer, payment reference and all linked orders, then give a reason and confirm a full remaining refund or unpaid cancellation. Combined payments are handled as a whole; the UI does not offer a misleading per-child refund. Requests verify ownership, MFA where configured, currency, amount, order membership and payment metadata. Stripe secrets remain server-side.
- Refund requests first place production on hold, use a stable Stripe idempotency key, and distinguish pending from completed refunds. Refresh can repair a lost successful refund response. Cancellation expires an open Checkout session before closing the unpaid order. Paid orders require refunding.
- Late payment/failure events cannot reopen financial closures or erase existing payment references. Refund webhooks reconcile current Stripe status, including pending/failed refund updates. Combined refund reporting allocates the transaction amount once in stable order-ID order; partial refunds still need accounting review for tax/line allocation.
- Desktop print and digital panels include **Refund / cancel**. Closed orders remain in history. Cloud closures override cached ready/printed states, older orders are picked up by update time, and export/digital delivery performs a fresh financial-state check. Paid web orders use payment controls instead of local deletion.
- Files already at a printer or already downloaded cannot be recalled. The confirmation explains this. The export check is not a mechanism for stopping an already-running physical printer.

## Verification

The changes include executable database, API and widget tests for concurrent/repeated submissions, lost responses, transaction rollback, cross-studio access, missing MFA, amount changes, combined scope, pending refunds, cancellation races, refund allocation, production holds and small-screen layout. All Stripe mutations in tests use fakes; no real money was moved.

Website checks after merging the current production baseline: **275 tests passed**, TypeScript validation passed, focused lint passed, and `npm run build` succeeded.
Desktop checks: **698 tests passed**, `flutter analyze --no-pub` reported no issues, the refund dialog was rendered and visually reviewed, and `flutter build macos --release --no-pub` succeeded. Existing native build warnings remain (Objective-C architecture naming and Core Image deprecations); compilation completed.

## Release procedure

1. Apply `supabase/migrations/20260924160000_order_payment_safety.sql` to the matching Supabase project before deploying the website. It is additive and service-role only; it does not modify historical order amounts or issue refunds.
2. Verify the production Stripe environment and connected account. Exercise duplicate-submit, lost-response, cancellation and refund flows with Stripe test-mode credentials in staging. Confirm the endpoint receives `charge.refunded`, `refund.updated` and `refund.failed` events alongside existing payment events.
3. The website changes are committed on `codex/payment-safety`. Use the repository's guarded `npm run deploy:production` command from a clean checkout with `--skip-domain` and the `STUDIO_PAYMENT_RELEASE_VERIFY=1` build flag. Verify the read-only release-check output and deployment before promoting it. Do not use a direct production deployment command.
4. Distribute/install the matching desktop build on every production workstation after the website endpoint and migration are live, before using the new refund controls. The new desktop buttons report unavailable until that endpoint exists.
5. Review both incident payments directly in Stripe, identify the order to retain, and explicitly authorize one refund. Do not delete either financial record as a substitute for refunding.

No test suite proves the absence of every bug. These checks target the observed failure modes; the precise trigger of the customer's incident remains unverified.

Stripe references used: [idempotent requests](https://docs.stripe.com/api/idempotent_requests), [create a refund](https://docs.stripe.com/api/refunds/create), [expire a Checkout session](https://docs.stripe.com/api/checkout/sessions/expire).

## Changed files

Website project (`/Users/harout/Downloads/Projects/studio-os-cloud-site`):

- Checkout: `app/parents/[pin]/page.tsx`, both `app/api/portal/orders/create*/route.ts` routes, `app/api/stripe/checkout/route.ts`, `lib/checkout-attempt.ts`, `lib/checkout-attempt-client.ts`.
- Payment controls and reconciliation: `app/api/dashboard/orders/payment/route.ts`, `components/order-payment-controls.tsx`, `app/dashboard/orders/page.tsx`, `lib/order-payment-policy.ts`, `lib/order-payment-lock.ts`, `lib/payments.ts`, `lib/dashboard-auth.ts`, `lib/digital-delivery.ts`, `app/api/stripe/webhook/route.ts`.
- Database/tests: `supabase/migrations/20260924160000_order_payment_safety.sql`, `tests/order-payment-{database,route,safety}.test.mjs`, `tests/stripe-combined-checkout.test.mjs`, `package.json`, `package-lock.json` (local PostgreSQL test dependency).

Desktop project (`/Users/harout/Downloads/Whitephoto_Studio_App_MVP_Source`):

- `lib/screens/orders_screen.dart`, `lib/screens/digital_orders_screen.dart`, `lib/services/supabase_sync.dart`.
- New `lib/services/order_payment_state.dart`, `lib/services/order_payment_service.dart`, `lib/widgets/order_payment_dialog.dart`, `test/order_payment_safety_test.dart`.
- This investigation/release note and `output/payment-safety/refund-dialog.png`.

The desktop project already contained substantial unrelated uncommitted work. It was not reset, committed or released as a whole. The companion website was clean before this task and the change is isolated on `codex/payment-safety`.

## Hosting verification

`scripts/verify-payment-release.mjs` is an opt-in prebuild check, enabled only for the requested release. Financial verification uses GET requests only. A separately supplied exact existing webhook ID permits adding only `refund.updated` and `refund.failed`, preserving its URL and existing events. It does not expose credentials or provider error bodies, and does not issue refunds, cancel orders, create checkout sessions, or send messages. Its seven regression tests cover masked credentials, read-only financial requests, canonical/www webhook matching, missing refund subscriptions, safe authentication failures and tightly scoped webhook configuration. Production migration access and schema compatibility were verified with the authenticated Supabase CLI. The migration must be applied in a transaction and recorded under version `20260924160000`; unrelated historical migration drift must not be pushed.

## Website release completed — September 24, 2026

- Applied and recorded migration `20260924160000` in production project `bwqhzczxoevouiondjak` as one transaction. Existing migration history was preserved. A production-schema transaction verified retry replay, second-tab replay, lock exclusion and terminal-state protection, then rolled back all synthetic records (zero persisted).
- Merged the existing September 19 production baseline, including retouching purchase rules, portrait previews, dashboard performance and mobile layouts. The retouching behavior tests were adapted to the transactional persistence API; their business assertions remain intact.
- Added `refund.updated` and `refund.failed` to existing Stripe payment webhook `we_1TIBXDPxlnWeytFA1UniR0oO`; all four previous events and its www URL remain configured. Production authentication and both incident payment checks passed.
- Ran the guarded production deployment from clean commit `1120ccb` with domain promotion held. All 275 tests and local/remote production builds passed. Verified homepage/sign-in availability, rejection of unauthenticated payment reads/actions, and rejection of unsigned webhook requests before promotion.
- Promoted deployment `dpl_B4u1ZxCgKEq38kiwSUiGPhHm9bpV` (`studio-os-cloud-site-9ix6l37jc-whitephotostudio-7289s-projects.vercel.app`). Verified `https://www.studiooscloud.com` and production alias assignment afterward.
- Previous production deployment retained for rollback: `dpl_ADbVPKeRRmufsHV54RjMZvyZpJHF`.
- Live verification also found the bare hostname redirects HTTP 308. The desktop payment service now addresses `www.studiooscloud.com` directly; a native Dart POST verified the canonical endpoint returns the expected unauthenticated rejection without redirecting.
- Live charges were read only. Refund/cancellation money movement remains covered by fakes; a Stripe test-mode end-to-end transaction was not run.
