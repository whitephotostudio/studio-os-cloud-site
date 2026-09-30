# Credit system and site audit — September 29, 2026

## Current production and intended revenue

The restored site is serving the restored `main` release, commit
`9436173cd4ec3775ca949e9e221e989f331e3374`, deployment
`dpl_2m7R3DmyKnP2MQ5dde1j7AT6aVp7`. Public home, tutorials, pricing, sign-in
and parents pages answer 200. Refund-email, CRM and billing crons answer protected
401, rather than missing-route 404. The owner overview route is present.
These checks establish route presence, not signed-in functionality.

Credit-pack checkout charges the Studio OS platform Stripe account. Gallery
orders charge the photographer's Stripe Connect account. The owner's service
fee is billed separately on the photographer's Studio OS subscription. Rates
are CAD 0.55 Starter, 0.35 Core and 0.25 Studio per paid order record. A combined
checkout can contain multiple records. A free app trial without a Stripe
subscription cannot be automatically invoiced. No live subscription records
were available to confirm an existing service-fee invoice.

The independent restore-only release was subsequently promoted from clean
commit `011bf81cb0e75c2aef0fe88763ba3e4ef88cd2ab`, deployment
`dpl_9Yqg3XvKEbFatjDQ2Q7CDN7JB3EZ`, and pushed to Git `main`. The Git hook then deployed the exact same commit as
`dpl_83cmYU5aS9mgVkx5TKm4RKfFwDMv`, verified on the primary domain through the
Vercel API. It restores fourteen
previously published September 25–28 commits that Claude had omitted: class
registration, mobile invoices, CRM/contact pagination and private sales assets.
The restore passed 386 tests and production builds, actual production Stripe
authentication and order-webhook verification, and thirteen candidate smoke
checks. Live route checks confirm these routes are present and protected;
Tutorials remains 200. The existing database and private bucket were already
correct, so this restoration required no database changes.

Production `/credits` is still 404 at the audit baseline and after that restore. The installed/public
Mac app is 0.1.11 (15). Premium Cloud has no configured platform provider key.
The corrections described below are release-candidate source, not live fixes.

## Verified defects and corrections

- **Purchases inaccessible from desktop.** The app opens `/credits`, which did
  not exist. The new page preserves the selected catalog package through sign-in,
  uses the signed-in account instead of trusting URL account/email/amount fields,
  creates platform Stripe checkout, and explains confirmation and expiry.
- **Credits could be manufactured.** Permissive ALL policies overrode later
  write restrictions on credit balances and transactions. Authenticated clients
  could directly change their own balance or create receipts. The migration
  removes all write policies/privileges and exposes authenticated, locked RPCs
  for debit, bounded processing refund and local completion. Stripe purchase and
  cash-refund mutations are service-only. An invoker-security profile trigger
  also prevents customers granting themselves owner or billing access.
- **Purchase grants and cash refunds were unreliable.** Balance and receipt
  writes were separate, and webhook claims could suppress retries after a crash.
  Atomic purchase grants use immutable payment references. Only verified paid
  platform sessions grant credits. Async payment success is supported. Customer,
  currency and price are validated. Cumulative successful cash refunds remove a
  proportional number of credits once, including refunds delivered before
  checkout confirmation. Refunded spent credits create debt; later purchases
  settle it. Pending/failed refunds do not remove credits.
- **Advertised monthly expiry was not enforced.** The owner explicitly selected
  expiry at the next monthly billing date. Purchase lots now retain that date;
  annual subscribers use monthly anniversaries. Existing balances are preserved
  at rollout and assigned their next future date. Debit, balance lookup and a
  scheduled worker expire unused amounts without granting expired processing
  refunds a new lifetime. Owner complimentary access remains separate.
- **Premium Cloud was not a usable platform service.** Desktop required the
  photographer's local provider key; the owner platform was not processing
  prepaid photos. The new server gateway authenticates the account, charges
  four credits, calls Photoroom with a private platform key, validates a real
  transparent PNG at the requested dimensions, stores it privately and returns
  a short-lived URL. Missing provider configuration charges nothing and is
  disclosed before purchase. Local Photoshop removal costs one credit.
- **Retries and interrupted work could lose or double-spend credits.** Durable
  jobs retain the exact prepared image hash and paid reference. Successful paid
  results can be recovered at zero balance. Duplicate submissions do not repeat
  the provider call. Lost upload/completion acknowledgements check saved output;
  uncertain storage results preserve the reservation for recovery. A five-minute
  cron recovers saved images or refunds confirmed missing output, even when the
  user never retries. Local processing refunds remain bounded by the original
  reservation and cumulative failed count. Automatic order backdrop cutouts
  also use the credit service.
- **Cloud photo privacy could be bypassed through legacy school paths.** The
  private `credits/` namespace is reserved across generic signing, image proxy,
  folder, upload ownership and storage operations. Only an authenticated owned
  immutable job can return its output URL.
- **Service-fee periods and reporting were fragile.** Stripe's current API uses
  item-level periods. Annual renewal and monthly usage now use their respective
  items, with flexible mixed-interval billing. Paginated reconciliation avoids
  the 200-subscriber and 1,000-summary-row caps. An immutable fee ledger retries
  exact requests after timeouts and stops unsafe old uncertain retries for
  review. Full order refunds waive the original fee; partial refunds remain
  paid orders. Historical already-reported fees are never guessed or recharged.

Details and Stripe references are in
[the service-fee accounting note](order-usage-billing-2026-09-29.md).

## Live Stripe configuration gap

The follow-up custom-action audit found another credit bypass in the desktop
candidate: arbitrary Photoshop actions could return transparent PNGs without
credits, and cutout import/use routes trusted matching files without paid
entitlement. The owner chose to keep ordinary custom actions free with JPG-only
results. Output restrictions and receipt-bound recovery fixes are prepared;
they are not a complete no-bypass guarantee. Managed cutout imports require a
shared, durable paid-photo entitlement check before such a claim or release.
See [the custom-action policy and remaining work](custom-photoshop-actions-credit-policy-2026-09-29.md).

A strict remote candidate check authenticated the real platform Stripe account
`acct_1TBlT4PxlnWeytFA` but stopped the build because the platform subscription
endpoint `we_1TIBPIPxlnWeytFAlrnRKuDI` is missing
`checkout.session.async_payment_succeeded`, `charge.refunded`, `refund.updated`
and `refund.failed`. The separate Connect order endpoint has the refund events;
it cannot fulfill platform credit refunds. No endpoint was modified.

An exact opt-in repair is prepared: `STUDIO_CREDIT_WEBHOOK_CONFIGURE=1` plus
`STUDIO_CREDIT_EXPECTED_ACCOUNT_ID=acct_1TBlT4PxlnWeytFA`. It selects only the
single existing live platform checkout destination, preserves existing invoice
and subscription events, changes only event subscriptions and verifies the
returned endpoint. Default checks remain read-only. Apply this only while the
compatible new database and webhook code are already serving or safely paused.

## Validation and release requirements

The complete website suite passed 461 tests. TypeScript and the production
build passed. Focused lint has zero errors and six existing settings-page
warnings. The matching desktop snapshot passed 799 tests with one skipped
platform test, and Flutter analysis was clean.

After the custom-action follow-up, desktop source passed 824 full-suite tests
with one platform skip and zero direct `lib` analysis diagnostics. The five
changed/new files were copied into the release snapshot with a separate review
patch. The old signed archive/ZIP is now explicitly marked for rebuild and
must not be published as matching this updated source. Native Photoshop action
execution and complete imported-cutout entitlement enforcement remain unverified
or unfinished respectively.

Four migrations were tested together against the live database schema in one
rolled-back transaction. Both existing credit accounts retained their balances
and purchase/use totals; authenticated writes were revoked and cloud RPCs were
service-only within the transaction. A second read verified that all candidate
tables and the profile guard disappeared after rollback. No production schema
change or customer payment was made by this dry run.

The release requires the matching desktop update plus the four exact migrations;
old desktop builds write balances directly and will no longer process credits
once secure permissions are applied. The signed universal 0.1.14+18 Mac candidate passed strict deep signature
verification; it is not notarized or published. Nine reviewed credit source
files were applied to the primary desktop checkout with baseline SHA checks,
preserving unrelated changes; 21 focused tests passed there. Existing apps have
no update banner, and registrations contain only release/debug, so the six
active release registrations cannot prove an upgrade. Notarize and publish the
validated matching Mac build before exposing the new web flow and arrange
for active users to update. The maintenance-only bridge is clean commit
`6f69b2b92ed91e812c783cc463b88eea2ec201d5` on
`codex/credit-maintenance-bridge-20260929`, based exactly on restored main
`011bf81`. It contains only the pause helper, old billing/webhook guards and
narrow tests, with no new schema/accounting/cloud code. It passed 28 tests,
TypeScript and a production build; it has not been deployed.

Pause credit checkout and platform checkout/refund fulfillment before changing
the schema, so the old handler cannot make direct balance writes while the new
lot-based accounting is installed. The prepared bridge and new code honor
`STUDIO_CREDIT_MAINTENANCE=1`: credit checkout stops before creating a customer
or payment, and authenticated Stripe platform fulfillment returns retryable
503 before claiming an event. Photographer Connect customer orders remain
eligible. Deploy the compatible new code while paused, apply the four migrations
in one transaction, verify them, then build the final candidate with the strict
schema checks, exact webhook repair and maintenance disabled. Promote only
after its checks pass and retain the updated line in main.

Do not run
`supabase db push` across divergent migration history. Do not auto-recharge
historical orders or auto-refund forgeable legacy processing receipts.

Use the repository's guarded `npm run deploy:production` from the clean audited
commit, initially with `--skip-domain`. Its remote prebuild can verify actual
production Stripe credentials and platform webhook subscriptions with
`STUDIO_PAYMENT_RELEASE_VERIFY=1`,
`STUDIO_PAYMENT_EXPECTED_PROJECT_REF=bwqhzczxoevouiondjak`,
`STUDIO_PAYMENT_EXPECTED_APP_URL=https://www.studiooscloud.com`,
`STUDIO_CREDIT_WEBHOOK_VERIFY=1`,
`STUDIO_CREDIT_RELEASE_VERIFY=0` before schema application. Do not set
`STUDIO_PAYMENT_REFUND_WEBHOOK_ID` for read-only verification. After migrations,
require `STUDIO_CREDIT_RELEASE_VERIFY=1` before promotion. The platform endpoint
must receive completed checkout, async checkout success and refund updates.

Add the private `PHOTOROOM_API_KEY` to Vercel production to enable Premium Cloud.
The key must never be placed in a client bundle, source control or chat.
Provider configuration is not proof of provider availability or successful
paid processing. Validate a real sample in the candidate before promising it.

The owner has now saved the Live key as a Secret restricted to Preview branch
`codex/credit-system-audit-20260929`. Git Preview deployment
`dpl_D5Bnmr86zFDEWjCH1Gcou2km3QrX`, source commit `13b3b05`, successfully verified
Photoroom account authentication (HTTP 200) and processed one committed,
generated marketing portrait using the same multipart request as the cloud
gateway. The result decoded as a 1024 by 683 PNG, with alpha ranging from 0 to
255 and visible foreground. The remote Next.js build also passed. This proves
the provider connection and sample processing, not a photographer's complete
paid workflow or visual quality across different portraits.

`scripts/verify-photoroom-preview.mjs` is opt-in, build-only and refuses
production, other branches and Sandbox credentials. It makes no database,
Stripe, customer-wallet or R2 requests and never exposes credentials, provider
response bodies or image URLs. Its one-time verification flags were removed
after deployment capture, so subsequent pushes cannot repeat the provider
sample accidentally. Credit checkout remains paused on this Preview branch via
`STUDIO_CREDIT_MAINTENANCE=1`. All 474 website tests passed, including 13 provider
diagnostic tests; the existing 18 payment-verifier tests also remain green.

The Mac was locked during UI inspection. Signed-in purchase, desktop account
refresh and visual workflow validation therefore remain unverified. Automated
fixtures are not a real Stripe settlement; the generated provider sample above
does not verify credit reservation, R2 storage, retry recovery or paid output
delivery. No real customer charge, refund, invoice, meter event or message was
created for testing. Production remains on restored commit `011bf81`, and the
Live key has not been added to its Production environment.

Keep Git `main` synchronized with every promoted release while Vercel's Git
production branch remains `main`; otherwise a later push can redeploy stale
code. Do not push this schema-dependent candidate to `main` before coordinated
release. The dirty original desktop and website workspaces are preserved.
