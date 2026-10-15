# Standard Stripe connections for new photographers

Status: implementation and sandbox acceptance in progress. This document does not confirm a production release.

The ordinary authenticated `/api/stripe/connect` flow creates Standard accounts for eligible new photographers when `STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED=true` and the independently guarded database release control is enabled. Existing Express connections are reused. The completed WhitePhoto migration keeps its separate account-pair controls and original historical Express account.

Subscription billing and customer-order payments remain separate. Gallery V3 charges 55 minor units per eligible persisted paid order; Core and Studio V3 charge 45. Routing does not override subscription policy. Saved fee snapshots, prior V2/legacy/trial terms, grouped-order calculations and existing waiver rules remain authoritative. This release does not change prices or storage.

## Creation and readiness

- The database reserves an immutable, owner-bound signup before any provider POST. Original creation parameters and their canonical SHA-256 hash are saved alongside the complete provider request hash, signup UUID and idempotency key.
- Every unknown-result retry rechecks the database controls under a row lock and sends the identical original body and key. Unknown results older than 23 hours require reconciliation. A known account can resume onboarding when new creation is disabled.
- A fresh provider GET must verify Standard type, country, owner and signup metadata, account-paid fees, Stripe payment losses and a full Stripe dashboard. Pending account history is saved before a single-use AccountLink is exposed.
- First activation requires completed details, enabled charges and payouts, active card payments and transfers, and clean current/future requirements. Returning from Stripe alone does not establish readiness.
- CAD and USD are the initially supported new-Standard sales currencies. Existing Express and WhitePhoto fallback currency behavior remains intact.
- A permanent account-history marker prevents a signup-born Standard account from falling back to an unregistered Express route if schema or history is unavailable.

## Existing photographers and payment history

Profiles registered after the schema enrollment cutoff can use the new default. Older unlinked profiles need an explicit, complete Stripe-account inventory audit before enrollment; a null local account pointer does not prove a previous creation request failed. The private eligibility cohort records owner, platform, payment environment and the original provider inventory receipt. No blanket migration is performed.

Every reserved/open/paid payment keeps its original account, complete order group, gross, currency, fee snapshot, request hash, provider references and idempotency key. Refunds and delayed events use that saved binding. Neither disabling new account creation nor opening the full Stripe dashboard reassigns a historical payment.

Signed deauthorization is durably recorded even when it races the initial account-registration response. Registration and activation refuse that account thereafter. Ordinary unrelated Stripe payments remain outside Studio OS order reconciliation.

## Release and rollback

1. Verify current production/main, the exact Vercel project, Stripe platform and Supabase project. Take a fresh encrypted financial/schema checkpoint and verify decryption and hashes.
2. Complete genuine isolated Stripe TEST onboarding, non-owner V3 55/45 payment and application-fee/refund tests, original Express compatibility, duplicate/delayed events and interruption/retry checks. Run regression tests, TypeScript and the optimized build.
3. Install only the additive migration with creation disabled and verify current checkout/history routing. Keep parent ordering available.
4. Publish through guarded `npm run deploy:production`, with a committed clean worktree and required CI checks. Enable only the new signup control/flag after the release audit passes. Never disconnect existing Express accounts.
5. Recheck published settings, current parent flows, immutable historical routing and provider fee configuration. Do not charge or refund real customers as a test.

Rollback disables new signup creation in both the exact database control and the deployment environment. Retain the new code/schema needed to service existing Standard accounts. Do not revert account pointers, delete intents/history or restore an old financial snapshot over newly arriving orders.

`STUDIO_STANDARD_SIGNUP_RELEASE_VERIFY=1` runs a GET-only preparation audit. The enabled flag additionally requires the database control to be enabled. The audit verifies exact environment identity, private tables, service-only RPCs, immutable history protections and connected/platform webhook scopes; it performs no account or financial writes.

## Validation evidence

Local regression: 2,351 tests passed, including preserved Express history/refund behavior, strict signup origin, 55/45 fee policy, creation barriers and retry/deauthorization guards. TypeScript and the optimized build passed. Existing settings-page lint findings also occur unchanged on the previous production source; the changed server files lint cleanly.

Genuine new-account sandbox onboarding/payment acceptance and production release evidence are pending. Local tests and a successful build do not establish completed Stripe onboarding or actual fee collection on the new signup path.
