# Australia and UK local billing — October 16, 2026

Harout requested enabling Australia and the United Kingdom with the same numeric subscription amounts as Canada and the United States. Australia uses AUD and the UK uses GBP. These are independent prices, not exchange-rate conversions.

| Plan | Monthly | Annual |
| --- | ---: | ---: |
| Gallery | 59 | 599 |
| Core | 99 | 1,069.20 |
| Studio | 199 | 2,149.20 |
| Extra Studio desktop key | 55 | 594 |

The country-specific currency applies to the whole subscription, including matching extra keys. New subscriptions use the saved legal business country. Posted currency, visitor location and the public pricing selector cannot change billing currency. Existing subscriptions keep their verified Stripe price currency and prior terms. AI credit packs remain CAD. Customer-sales currency is separate; Gallery collects 55 minor units per qualifying paid order, Core and Studio 45, under the existing waiver and frozen-fee rules.

## Focused implementation

The public offers, signup links and Settings country choices include CA, US, AU and GB. Standard account creation and new signup sales accept CAD, USD, AUD and GBP. A hosted onboarding return alone does not activate customer payments: the provider account, ownership, country, controller, capabilities and current/future requirements must pass the existing readiness checks.

The additive migration `20261016010000_stripe_standard_regional_markets.sql` widens legal-country and account-history constraints and replaces the affected service-only functions. Installation leaves future enrollment controls unchanged. The operator must separately enable the exact future-signup pair: countries `CA,US,AU,GB` and currencies `cad,usd,aud,gbp` on `standard-signup-v1`.

Original CA/US signup intents retain their saved two-currency scope. A newly reserved regional intent copies the current release control. Existing intent parameters, idempotency keys, account pointers, order groups, payment references, fee snapshots and historical routing are not rewritten. The distinct WhitePhoto migration control remains scoped to its original account pair and CAD/USD.

## Release sequence

1. Complete isolated genuine Stripe TEST evidence for Australian and UK onboarding, subscriptions, customer orders and refunds. Verify CAD/USD regressions, grouped and waived orders, signed duplicate/delayed events, interrupted request recovery, disputes, deauthorization and rollback. Record the actual scope and any limitations; mocked regressions do not establish provider acceptance.
2. Review the additive SQL and run its database regressions, the full required suite, TypeScript, optimized build and CI. Commit the reviewed candidate before a production release.
3. Reverify main, production aliases, exact Vercel project, Stripe platform and Supabase project. Prepare a compatible artifact through `npm run deploy:production` with public alias promotion deferred and new account creation disabled. Do not deploy directly with `vercel --prod`.
4. Immediately before installation, save and independently verify a fresh encrypted schema/financial checkpoint and the exact migration/candidate/provider receipts. Install only the additive SQL; preserve existing enrollment lists and all financial/routing records. Confirm service-only ACLs, installed guards and unchanged historical state.
5. Publish the exact compatible Ready artifact through the guarded release workflow. Broaden only the future-signup control after compatible code and genuine provider proof are established. Enable new creation in the exact deployment environment and publish through the same guard.
6. The enabled release audit requires schema version `20261016010000`, `regional_markets_present`, immutable history protections, service-only access, exact four-country/currency controls and connected/platform webhook scopes. A disabled compatibility audit may retain the exact legacy paired lists; enabled release cannot.
7. Recheck live AU/UK offers, normal signup and Settings, deployed source identity and protected GET-only provider/database results. Do not charge or refund production customers as a test.

Rollback disables new Standard creation in the deployment and exact database control. Keep compatible code/schema and servicing of existing accounts. Do not delete signup/history rows, restore a stale financial snapshot, replace account pointers or reassign old payments.

## Evidence and current status

Implementation validation so far: 124 focused backend, billing, status, Settings, inventory and release-guard tests passed. TypeScript passed. Focused lint returned no errors (one pre-existing test-file warning). This is isolated automated evidence.

Genuine AU/UK Stripe TEST acceptance, full regression/build/CI, fresh checkpoint, production migration, control activation, publication and post-release verification are pending in this working document. No completed provider onboarding, paid transaction or production activation is claimed by this entry. The release owner must replace this paragraph with exact receipts and the final scope before describing the rollout as live.
