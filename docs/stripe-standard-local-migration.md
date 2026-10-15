# Stripe Standard switch: local build and rehearsal

This is the historical October 13 sandbox specification. Its blanket CAD45 fee and test-only release statements are superseded by [the current Standard release runbook](stripe-standard-release-20261015.md). Preserve the current V3 fees and use that runbook for deployment and activation gates.

This change is isolated on `codex/stripe-standard-switch-20261013`. It has not been deployed. No real photographer accounts, subscriptions, prices, storage, payments, refunds, or provider configuration have been changed.

## Scope and boundaries

The first implementation creates a **new Standard account in Stripe test mode** through hosted onboarding, verifies it, and changes only future unreserved checkouts. Existing-account OAuth reuse is deferred. It does not convert an Express account in place.

The switch is disabled by default. Onboarding, backfill, activation and rollback require all of:

- `STRIPE_STANDARD_MIGRATION_ENABLED=true` on the server;
- a Stripe test secret key;
- `NEXT_PUBLIC_SUPABASE_URL` pointing to localhost, 127.0.0.1 or loopback IPv6;
- authenticated photographer ownership and satisfied dashboard MFA checks;
- valid request-origin checks for mutations.

There is no live opt-in in this build. Do not use production database credentials or copy real photographer records into the rehearsal.

## Fees and existing billing

Fresh eligible CAD orders on the selected Standard route collect **C$0.45 per persisted internal order** as a direct application fee. A combined purchase with two eligible order rows collects C$0.90. This is not necessarily one fee per Stripe Checkout Session.

Existing frozen order fees remain unchanged. Owner, admin, test and zero-value exemptions remain. Existing Express checkouts and pre-existing monthly-metered fees retain their previous collection rules. Direct fees must not also enter a monthly usage invoice.

The public pricing catalog, subscriptions, credit sales and storage implementation are unchanged. Standard routing in this preview is CAD/test-only; other currencies require an explicit future policy. The requested account configuration is checked against Stripe's retrieved account: fees paid by the account, payment losses handled by Stripe, requirements collected by Stripe, and a full Stripe dashboard.

This proves the intended configuration in local fixtures; actual Stripe processing/Connect invoice allocation requires a genuine provider sandbox rehearsal and confirmation before production.

## Local schema

Review these migrations and apply them only to a disposable local Supabase database for rehearsal, in filename order:

1. `supabase/migrations/20261013010000_stripe_account_history.sql`
2. `supabase/migrations/20261013011000_stripe_payment_account_attempts.sql`
3. `supabase/migrations/20261013012000_stripe_merchant_event_recovery.sql`
4. `supabase/migrations/20261013021000_stripe_standard_creation_intents.sql`

They add account history, permanent migration markers, immutable payment-account reservations, verified historical bindings, recovery inbox/disputes, and idempotent account-creation intents. Financial history and routing functions are service-only. Old schema compatibility is allowed only for an explicitly unmigrated photographer and a recognized missing-schema error. Outages and permission errors do not fall back to the current account.

A new payment reserves its account, owner, complete order group, gross amount, currency, fee snapshot, canonical request hash and idempotency key **before** a Stripe POST. Provider references are saved before exposing the Checkout URL. An unknown result retries the same account and request within a 23-hour window; older unbound attempts require provider reconciliation. A known bound session is retrieved and its database references repaired without another Stripe POST. Unexpected completed/expired sessions in this repair path and provider events with unknown references require review. The checkout URL is never published before all references are saved. It must never create another charge on a replacement account.

## Rehearsal flow

Use synthetic studios and orders. The Settings test panel stays hidden until server status enables it.

1. Start with an Express **test** account and synthetic historical payments. Exercise an existing Checkout Session and refunds first.
2. `POST /api/stripe/standard/start`: reserves a durable creation intent and starts hosted test onboarding. An interrupted request retries frozen parameters with the same idempotency key. Unknown creation outcomes older than 23 hours require reconciliation.
3. Finish hosted onboarding. `GET /api/stripe/standard/status` retrieves the account again; a return URL is not proof of readiness. Country, controller settings, card capability, charges, payouts and requirements must pass.
4. `POST /api/stripe/standard/backfill`: bounded batches verify saved historical sessions/intents through original-account Stripe GETs. Complete grouped scope, identity, amounts, currencies and frozen fees must agree. Review unknown starting requests or unverifiable payments; they block activation. Repeat with the returned cursor until complete.
5. `POST /api/stripe/standard/activate`: requires the displayed account, explicit confirmation, expected current account and fresh readiness. SQL locks photographer routing and blocks any unbound historical checkout. Express becomes legacy; it remains connected and accessible.
6. Create a new non-owner CAD order and verify an actual C$0.45 application fee. Verify grouped C$0.90 and exempt C$0.00 examples. Confirm there is no additional monthly usage fee.
7. Finish an old Express Checkout after activation. Verify it completes on Express. Exercise old Express and new Standard partial/full refunds, pending refunds, application-fee refunds, duplicate and delayed events, and failed provider reads.
8. Verify account updates, deauthorization and unrelated merchant payments. Account history events must not replace the active routing pointer. Disputes retain their original account and verified provider state.
9. Run `POST /api/stripe/standard/rollback` with a freshly verified previous account. Only future unreserved checkouts change. Standard payments/refunds keep Standard; Express payments/refunds keep Express. Do not disconnect either account.

Rollback is not deletion or conversion. Disabling onboarding alone does not roll back an already selected Standard route; historical payment processing stays available independently of the flag.

## Webhooks and recovery

The connected-account webhook uses immutable account history. Application-fee resources are platform-scoped; customer charges/refunds use the original connected account. The merchant event inbox acknowledges effects only after successful handling and leases interrupted work for recovery. Unrelated payments created directly in a photographer's Standard dashboard are ignored.

The local `vercel.json` adds `/api/cron/stripe-merchant-event-recovery` every five minutes, guarded by `CRON_SECRET`. This schedule is not active until a future deployment. Existing customer-payment recovery remains in place. Before any eventual production release, review webhook subscriptions and set `STUDIO_STRIPE_ACCOUNT_HISTORY_VERIFY=1` so the read-only payment release audit requires the new schema and verifies historical routing.

## Verification performed and remaining

Final local verification on 2026-10-13:

- Full regression suite: **2,065 passed, 0 failed**.
- Next.js optimized build, including TypeScript: passed with local placeholder configuration and no Stripe key.
- ESLint over all 48 changed source/test files: **no new warnings or errors**. The Settings page retains two pre-existing effect-rule errors and seven pre-existing warnings, confirmed against the base commit.
- `git diff --check`: passed. Pricing, package manifests/lockfile and R2/storage implementation have no diff.


Automated tests run actual application helpers/routes, actual SQL migrations in embedded PGlite, and mocked Stripe responses. They cover fee collection, account isolation, cutover races, unchanged snapshots, old-payment refunds, replay/recovery, country/readiness, MFA, ownership, live/remote refusal, and compatibility with older schemas.

The local build deliberately runs Next directly instead of `npm run build`, because this repository's prebuild includes provider release checks and a photo-backup producer. No production prebuild, backups or deployment commands were run.

A genuine Stripe sandbox and disposable local Supabase browser rehearsal remain necessary to prove hosted onboarding, provider event delivery, actual application-fee balances, payout behavior, connected-account permissions and provider billing. Mocked provider responses and a successful build do not establish these external behaviors.

Production enablement, pricing changes, storage migration and live photographer migration are separate work and remain outside this implementation.
