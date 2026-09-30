# Separate financial sandbox setup

The candidate includes `config/financial-sandbox.env.example`,
`scripts/verify-financial-sandbox.mjs` and guard tests. These files prepare a
separate environment; they do not create a remote project, credential, customer,
payment, refund, database row or webhook. This setup checklist does not deploy
code or change production configuration.

The separate Vercel project `studio-os-credit-sandbox`
(`prj_Q8h5vYAhHAfW1ARiqu6ArOgpycFK`) exists in team
`team_i1VhiUxCf3SZPOKdmecBsu3r`. Read-only Vercel CLI/API inspection confirmed
no Git link, no environment variables and no deployments. The framework is
unconfigured (the CLI displays `Other`), with Node.js `24.x`; confirm the Next.js
framework settings before any later sandbox deployment. Its separate clean
checkout is
`/Users/harout/Downloads/Projects/studio-os-credit-financial-sandbox-20260930`,
currently at commit `63bc222` on `codex/credit-system-audit-20260929`, with no
environment files either at its root or under `.vercel`, and linked only to that
sandbox project. These checks do not establish financial-test readiness.
Stripe test, separate Supabase, media and provider settings remain unconfigured
in this sandbox project; resources elsewhere were not inspected.
The candidate checkout's `.env.local` uses production services; do not copy it
into the sandbox or paste credentials into chat.

## Owner setup

1. Identify a Stripe sandbox/test environment and a separate Supabase project.
   Use no customer data: a schema-only baseline is sufficient. Record their
   project/account identifiers, then place their secrets directly in the
   separate hosting project's Secret settings or an ignored local env file.
2. Use the existing `studio-os-credit-sandbox` project and its clean checkout
   with a Preview of
   `codex/credit-system-audit-20260929` and a stable HTTPS origin outside
   `studiooscloud.com`. Do not replace the current candidate Preview's production
   database settings. Configure Supabase Auth site/redirect URLs for this sandbox
   origin, including the app's sign-in callback. Ensure Stripe can reach the
   sandbox webhook despite any hosting deployment protection.
3. Create two Stripe **test** webhook destinations pointing to exactly
   `https://SANDBOX_ORIGIN/api/stripe/webhook`. The platform endpoint must listen
   to events from this platform account; the Connect endpoint must listen to
   connected-account events. Record each exact endpoint ID and its distinct
   test signing secret. Leave the legacy `STRIPE_WEBHOOK_SECRET` unset. The
   verifier never creates or changes destinations.
4. Add a sandbox-only cron credential before testing retry/expiry jobs. Keep
   outbound email disabled or routed only to owned test inboxes; leave production
   storage/provider credentials out of this setup. A later full image test needs
   separate non-customer media storage and an explicitly approved generated
   provider sample. This financial verifier makes no R2 or Photoroom requests.

Platform events required by the checker:

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`
- `charge.refunded`, `refund.updated`, `refund.failed`
- `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`

Connect events required by the checker:

- `checkout.session.completed`, `payment_intent.succeeded`,
  `payment_intent.payment_failed`
- `charge.refunded`, `refund.updated`, `refund.failed`, `account.updated`

Stripe describes test/live mode on the [Balance object](https://docs.stripe.com/api/balance/object)
and platform/Connect event scope in [webhook endpoint creation](https://docs.stripe.com/api/webhook_endpoints/create).
The `whsec_` prefix does not establish which endpoint/mode a secret belongs to.
The verifier checks the exact remote endpoint's test mode, destination and event
subscriptions, and requires a platform endpoint without an application binding.
It cannot prove that the supplied signing secrets match their destinations, or
infer every Connect delivery setting from returned endpoint metadata. A real
signed sandbox event delivered successfully is the separate acceptance check.

## Database baseline and synthetic accounts

The local lifecycle harness in `tests/credit-lifecycle-integration.test.mjs`
creates fresh roles, an `auth.uid()` substitute and a small synthetic baseline,
then applies these exact migrations in order:

1. `20260930010000_atomic_credit_accounting.sql`
2. `20260930012000_protect_photographer_billing.sql`
3. `20260930013000_cloud_credit_jobs.sql`
4. `20260930100000_order_usage_fee_ledger.sql`
5. `20260930120000_paid_cutout_entitlements.sql`

Its synthetic profile has a platform customer, a billing anchor five days ago
and a next monthly billing date, plus separate authenticated and service roles.
Identifiers are fresh for each case; outcomes and network fixtures are
deterministic. It uses fake Stripe/Photoroom/R2 transports and actual JPEG/PNG
decoding. Run it without credentials:

```bash
node --test tests/credit-lifecycle-integration.test.mjs tests/cutout-entitlements-database.test.mjs
```

That minimal schema is **not** a complete hosted website/Auth bootstrap. For a
hosted sandbox, first install an audited schema-only baseline for the current
release, with the real Supabase Auth schema and existing subscription/order
dependencies. Apply the five candidate migrations only after their prerequisites
are present. Preserve migration ordering and grants; do not blindly push the
repository's divergent historical migration directory. No production data,
Auth users, Stripe IDs, credit receipts or media objects should be copied.

Use two owned test identities created through sandbox Supabase Auth and the
actual website sign-in/onboarding flow. Let the app create their photographer
profiles. Create a subscription/customer through sandbox Stripe billing so
the actual webhook establishes billing dates; do not insert a fake paid pack or
rewrite a balance to claim external purchase success. Use account A for purchase,
processing and refunds, and account B for wrong-owner rejection. Keep any owner
test identity separate from these paying photographers, since owner processing
is free and cannot prove a credit debit.

For the owner order-fee test, use a normal customer order backed by a test-mode
connected account and the paying photographer's platform subscription. The
application intentionally waives `is_test=true` orders, so toggling that flag
does not exercise the fee ledger. A normal order in an isolated sandbox can
exercise the fee without real money. Never perform this fixture in production.

## Read-only configuration check

Copy the tracked placeholder file to `.env.financial-sandbox.local` (ignored by
Git), replace every placeholder with the separate environment's settings, then
change `STUDIO_FINANCIAL_SANDBOX_VERIFY` to `1`. Run explicitly:

```bash
node --env-file=.env.financial-sandbox.local scripts/verify-financial-sandbox.mjs
```

Node loads only that explicit file; the verifier has no dotenv import or fallback
to `.env.local`. An already-exported process variable can take precedence, so
unset conflicting exported credentials before using the dedicated file. The
guards reject production keys/project/origins before network access. Do not run
the website's `npm run dev` from the checkout containing production `.env.local`:
Next.js has its own environment-file loading. Use the separate hosting project
or a clean sandbox-only checkout with only its sandbox `.env.local`.

The checker requires Preview metadata and the exact audited branch, test Stripe
keys, a different exact Supabase project, matching credential project/role metadata
where available, a separate HTTPS application origin, and exact account/webhook
IDs. It rejects inherited production release/webhook mutation flags, public live
Stripe keys, the legacy signing secret and production aliases. All requests are
bounded, redirect-disabled GETs. It authenticates Stripe, requires
`balance.livemode=false`, verifies both destinations and optionally checks up to
ten supplied test event IDs, including any nested payment object's mode.

Database checks use zero-row table/column probes and read-only OpenAPI RPC
metadata for the supplied service role. Only service-exposed RPCs are required
in that response: client-only `deduct_studio_credits`, `refund_studio_credits`
and `finalize_background_credit_job` are intentionally absent. Local tests apply
the audited SQL and check actual function privileges for service, authenticated
and anonymous roles. Do not broaden production-style grants to make a metadata
check pass. [PostgREST documents role-sensitive OpenAPI metadata](https://docs.postgrest.org/en/stable/references/api/openapi.html).

A limited live-event existence check refuses a database containing
`stripe_events.livemode=true`. These checks do not invoke any accounting RPC,
advance expiry, prove RLS or establish functioning Auth/user fixtures. Real
signed-in acceptance must exercise client RPCs under the test user's JWT and
check wrong-owner rejection. Logs expose check results only, without credentials,
URLs, balances, IDs or provider error bodies.

The verifier is off by default and is deliberately outside production prebuild.
Run it explicitly before a sandbox test session. Keep
`STUDIO_CREDIT_MAINTENANCE=1` until the separate environment passes isolation,
schema, Auth and webhook setup. This flag pauses all platform billing POST
actions (including subscription changes and portal access), billing status
refreshes, platform checkout/refund/invoice/subscription events, cloud credit
processing and billing/recovery crons before database work. Authentication and
webhook signature validation still run first. Genuine connected customer-order
payments/refunds remain eligible. Paid-order platform fee reporting waits for
maintenance to end; full customer refunds can still queue/reconcile fee waivers
with retry on a billing failure. Disable maintenance only in that sandbox before
the approved test checkout; production/candidate maintenance is unaffected.

## External acceptance still required

1. Sign into account A, buy a pack using Stripe test payment details and observe
   a successful signed platform webhook plus one exact credit grant. Retry the
   same event and confirm no second grant. Verify the pack's monthly deadline.
2. Test local Photoshop reservation/success/failure and cloud processing/replay
   using generated test images and isolated media storage. Check actual debit,
   refund and paid-cutout proof; account B must not access account A's proof.
3. Issue test partial/full cash refunds, retry their webhook events, and verify
   proportional reversal/debt. Advance expiry only with a supported sandbox
   fixture/time procedure; production clocks and balances are out of scope.
4. Pay a normal connected-account test order and verify one owner meter event,
   fee ledger result and eventual test invoice line. Repeat payment/refund
   events and check partial/full refunds. Fully refund a reported order after
   monthly invoice finalization: the paid invoice must remain unchanged and one
   original-amount pending credit must apply to the next subscription bill.
   Legacy uncertain cancellations must require review without a second credit.
   A locally mocked meter request or queued credit is not invoice settlement.

Passing PGlite, passing this environment verifier and passing an actual external
checkout are three distinct results. The verifier reports
`externalCheckoutVerified=false`, `webhookSigningSecretVerified=false`,
`authOnboardingVerified=false`, `authenticatedCreditRpcVerified=false` and
`rlsPoliciesVerified=false` even when all its read-only checks pass. No external
checkout or Auth acceptance has been performed by this setup change.
