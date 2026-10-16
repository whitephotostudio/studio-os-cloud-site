# Australia and UK local billing — October 16, 2026

Harout requested enabling Australia and the United Kingdom with the same numeric subscription amounts as Canada and the United States. Australia uses AUD and the UK uses GBP. These are independent prices, not exchange-rate conversions.

| Plan | Monthly | Annual |
| --- | ---: | ---: |
| Gallery | 59 | 599 |
| Core | 99 | 1,069.20 |
| Studio | 199 | 2,149.20 |
| Extra Studio desktop key | 55 | 594 |

The country-specific currency applies to the whole subscription, including matching extra keys. New subscribers without an existing Stripe subscription use the saved legal business country. Posted currency, visitor location and the public pricing selector cannot change billing currency. Existing and returning subscribers keep their verified Stripe price currency and prior terms; this release does not migrate a saved contract after a country change. AI credit packs remain CAD. Customer-sales currency is separate; Gallery collects 55 minor units per qualifying paid order, Core and Studio 45, under the existing waiver and frozen-fee rules.

## Focused implementation

The public offers, signup links and Settings country choices include CA, US, AU and GB. Standard account creation and new signup sales accept CAD, USD, AUD and GBP. A hosted onboarding return alone does not activate customer payments: the provider account, ownership, country, controller, capabilities and current/future requirements must pass the existing readiness checks.

The additive migration `20261016010000_stripe_standard_regional_markets.sql` widens legal-country and account-history constraints and replaces the affected service-only functions. Installation leaves future enrollment controls unchanged. The operator must separately enable the exact future-signup pair: countries `CA,US,AU,GB` and currencies `cad,usd,aud,gbp` on `standard-signup-v1`.

Original CA/US signup intents retain their saved two-currency scope. A newly reserved regional intent copies the current release control. Existing intent parameters, idempotency keys, account pointers, order groups, payment references, fee snapshots and historical routing are not rewritten. The distinct WhitePhoto migration control remains scoped to its original account pair and CAD/USD.

## Release sequence

1. Complete isolated genuine Stripe TEST evidence for Australian and UK onboarding, subscriptions, customer orders and refunds. Verify CAD/USD regressions, grouped and waived orders, signed duplicate/delayed events, interrupted request recovery, disputes, deauthorization and rollback. Record the actual scope and any limitations; mocked regressions do not establish provider acceptance.
2. Review the additive SQL and run its database regressions, the full required suite, TypeScript, optimized build and CI. Commit the reviewed candidate before a production release.
3. Reverify main, production aliases, exact Vercel project, Stripe platform and Supabase project. Prepare a compatible artifact through `npm run deploy:production` with `--skip-domain` and new account creation disabled. Before the migration, the regional schema audit cannot pass: set `STRIPE_STANDARD_NEW_ACCOUNTS_ENABLED=false` and `STUDIO_STANDARD_SIGNUP_RELEASE_VERIFY=0` for both this preparation build and its runtime. Other release checks still apply. This preparation artifact is not regional-provider acceptance and must not receive public aliases. Do not deploy directly with `vercel --prod`.
4. Immediately before installation, save and independently verify a fresh encrypted schema/financial checkpoint and the exact migration/candidate/provider receipts. Install only the additive SQL; preserve existing enrollment lists and all financial/routing records. Confirm service-only ACLs, installed guards and unchanged historical state.
5. After the compatible Ready artifact and genuine provider proof are established, broaden only the future-signup control. Build a final artifact through `npm run deploy:production` with public alias promotion deferred, creation enabled and the regional schema audit enabled. Require all enabled guards to pass before promoting that exact Ready artifact to the public aliases. Never promote the disabled preparation artifact.
6. The enabled release audit requires schema version `20261016010000`, `regional_markets_present`, immutable history protections, service-only access, exact four-country/currency controls and connected/platform webhook scopes. A disabled compatibility audit may retain the exact legacy paired lists; enabled release cannot.
7. Recheck live AU/UK offers, normal signup and Settings, deployed source identity and protected GET-only provider/database results. Do not charge or refund production customers as a test.

Rollback disables new Standard creation in the deployment and exact database control. Keep compatible code/schema and servicing of existing accounts. Do not delete signup/history rows, restore a stale financial snapshot, replace account pointers or reassign old payments.

## Evidence and current status

The committed implementation passed `npm run release:check`: all 2,537 regression tests and the optimized production build, including TypeScript. This includes ten new database tests for regional enrollment, immutable legacy scopes, AU/UK readiness, fees and rollback. Focused lint returned no errors (one pre-existing test-file warning).

Genuine isolated Stripe TEST evidence at the reviewed implementation:

- Actual authenticated app requests created one Australian and one UK Standard account. Fresh provider reads verified country, owner/signup metadata, account-paid fees, Stripe payment losses and a full dashboard. Both remain pending, with empty selected payment-account pointers. Pending parent checkouts created no Session, payment binding or frozen fee.
- Sixteen actual app-generated unpaid Checkout cases verified all three plans in both cadences and Studio extra keys in both AUD and GBP. Exact nominal amounts, localized price identities and owner metadata matched; posted currency could not override saved country. Fourteen probes were expired.
- The two retained Gallery monthly Checkouts completed through hosted Stripe TEST card payment: AUD 5,900 and GBP 5,900 minor units. Independent provider reads verified paid invoices, active subscriptions and exact owner/customer/price. Each had two original signed CLI-to-Next HTTP 200 webhook captures and the correct local mirror and entitlements. No manual activation or production charge occurred.

Hosted merchant onboarding is awaiting user entry of new test credentials. Fee-bearing AU/UK customer orders, refunds and the remaining genuine merchant recovery/disconnection checks are still pending. CI, fresh checkpoint, production migration, control activation, publication and post-release verification must be completed before describing this rollout as live. Private receipts are kept outside the repository; no customer credentials or provider secrets belong in this document.
