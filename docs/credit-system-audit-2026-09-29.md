# Credit system and site audit — September 29, 2026

## Current production and intended revenue

The restored site is serving the restored `main` release, commit
`011bf81cb0e75c2aef0fe88763ba3e4ef88cd2ab`, deployment
`dpl_83cmYU5aS9mgVkx5TKm4RKfFwDMv`, rechecked September 30. Public home, tutorials, pricing, sign-in
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

Production `/credits` is still 404 at the audit baseline and after that restore. The public
Mac release row captured read-only on September 30 is `0.1.12+16`; the matching
credit candidate is `0.1.14+18`. Premium Cloud has no Production platform provider key.
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
  review. New full refunds of reported fees queue the original negative invoice item
  for the next subscription bill; partial refunds remain paid orders. The
  returned customer, currency, amount, pending invoice state and immutable
  references are verified before recording queue completion. Uncertain or
  previously completed meter cancellations require review without another
  adjustment, because cancellation cannot correct a finalized invoice. Gross
  usage and credits queued this cycle are displayed separately, and unresolved
  fee reviews remain visible across billing periods and canceled subscriptions.
  Historical already-reported fees are never guessed or recharged.
- **Existing Stripe meters could silently bill the wrong usage.** Catalog
  preflight now checks active raw sum meters, their customer/value mappings and
  all list pages before any product/price write. Incompatible, ambiguous,
  inactive or preaggregated definitions fail rather than being reused.
- **The rollout pause left other credit-grant paths running.** Status and all
  platform billing actions pause immediately after authentication, before
  profile, customer, catalog, subscription or wallet work. Platform invoice and
  subscription webhooks pause before event claims, and authenticated billing
  and credit-recovery crons stop before new-schema operations. Paid Connect
  orders retain their receipts/notifications when fee reporting is paused or
  unavailable; their uncounted flags remain available for current-period retry.

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

The latest release-preparation website suite passed 666 tests with no skips or failures.
TypeScript and the production build passed. Targeted lint of the new backend,
helpers and delivery changes passed. The parent page retains its baseline ten
errors and 43 warnings, with no increased rule counts; the previously reviewed
settings page retains six warnings. These are source/build checks; the
local build disables remote payment/provider diagnostic flags. The matching
Mac source passed 912 Flutter tests with one platform skip and zero direct
`lib` analysis diagnostics. The universal 0.1.14+18 archive was rebuilt from
this source and is notarized and stapled. Strict/deep Developer ID signature,
Gatekeeper, exact version/team, both architectures and the extracted ZIP pass.
The exact ZIP was uploaded to private distribution storage with a full-byte
SHA-256 readback; the public release row still points to 0.1.12+16. It is not
installed or publicly published. Fifty-five focused tests
passed after 37 authorized source/test files were copied back to the primary
checkout with baseline SHA checks, preserving its 0.1.11+15 version and all
unrelated work. The older archive/ZIP is retained as superseded.

The [managed cutout change](paid-cutout-enforcement-2026-09-29.md) implements
account-scoped paid photo access, server-verified revisions and private staging.
Selected-backdrop delivery now stops for review when the paid result is unavailable;
it cannot silently fall back to an original marked print-ready. Actual platform
credit checkout remains unverified. A separate
private fixture-only Photoshop package now passes nine Flutter behavior tests
and five isolation tests using generated JPEG/PNG bytes, copied service logic,
an in-memory ledger and network-fallback refusal. It has no native Runner,
production startup, persistent authentication or Keychain access; this does
not establish actual Adobe execution or remote SQL/Stripe behavior. A later
controlled Photoshop 2026 run on the generated portrait did produce an actual
subject-shaped transparent PNG and an opaque JPG. Three actual-output tests
passed alpha anchors, a rectangular-mask negative control, transparent/disguised
custom-output rejection and the offline one-debit/idempotent paid path. Existing
user actions were preserved and fixture documents closed. The accounting in
that fixture is simulated; full application dispatch and external SQL/Stripe
acceptance are still unverified.

All five exact migrations were tested together against the live database schema in one
rolled-back transaction. Both existing credit accounts retained their balances
and purchase/use totals; authenticated writes were revoked and cloud RPCs were
service-only within the transaction. A second read verified that all candidate
tables and the profile guard disappeared after rollback. No production schema
change or customer payment was made by this dry run.

The release now requires the matching desktop update plus five exact migrations
(the original four and `20260930120000_paid_cutout_entitlements.sql`);
old desktop builds write balances directly and will no longer process credits
once secure permissions are applied. The universal 0.1.14+18 Mac candidate is
notarized, verified and privately uploaded, with no public release publication.
The rebuilt candidate and copied source have the current evidence above. Existing apps have
no update banner, and registrations contain only release/debug, so the six
active release registrations cannot prove an upgrade. Publish the validated
matching Mac build before exposing the new web flow and arrange
for active users to update. The maintenance-only bridge is clean commit
`537a0412529116f261e1dde603311772b25d3f33` on
`codex/credit-maintenance-bridge-20260929`, based exactly on restored main
`011bf81`. It contains only pause guards on legacy billing/status/webhooks/cron and
narrow tests, with no new schema/accounting/cloud code. It passed 30 tests,
TypeScript and a production build; it has not been deployed.

Pause credit checkout and platform checkout/refund fulfillment before changing
the schema, so the old handler cannot make direct balance writes while the new
lot-based accounting is installed. The prepared bridge and new code honor
`STUDIO_CREDIT_MAINTENANCE=1`: all platform billing actions and billing status stop before creating or
synchronizing profiles/customers/subscriptions, and authenticated Stripe
platform checkout/refund/invoice/subscription fulfillment returns retryable
503 before claiming an event. Billing and credit-recovery crons pause after
authorization and before database/RPC work. Photographer Connect customer orders remain
eligible. The new cloud-processing GET/POST handlers also pause after authentication
and before request parsing, database reservation, storage or provider work;
paid jobs remain recoverable after the pause without a second debit. This flag
does not stop local Supabase RPCs, old direct database calls or native Photoshop.
Deploy the compatible new code while paused and confirm it stops issuing
canonical `nobg-photos` PUT URLs. Only then start the full 15-minute old PUT
drain; the maintenance-only bridge cannot start it. Finish that drain before
committing all five exact migration bodies in one transaction. Four source files
have outer BEGIN/COMMIT wrappers that must be removed when assembling this
single transaction. Verify the migration, then build the final candidate with the strict
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
`STUDIO_CREDIT_WEBHOOK_VERIFY=0` until the missing platform events are repaired,
`STUDIO_CREDIT_RELEASE_VERIFY=0` before schema application. Do not set
`STUDIO_PAYMENT_REFUND_WEBHOOK_ID` for read-only verification. After migrations,
require `STUDIO_CREDIT_RELEASE_VERIFY=1` before promotion. The platform endpoint
must receive completed checkout, async checkout success and refund updates.

September 30 release preparation added visible Mac `0.1.14 (18)` upgrade
guidance to `/credits` and `/studio-os/download`, plus a separate
[financial sandbox setup](financial-sandbox-setup-2026-09-30.md). The sandbox
verifier performs only bounded read-only requests, refuses the Production
database, live Stripe credentials and production origins, and does not claim
actual checkout or signing-secret verification. Its configuration template
contains placeholders only. A separate Vercel project and clean sandbox
checkout now exist, without environment settings or deployments; external
Stripe test, Supabase, media and provider settings remain unconfigured. The
read-only checker requires only service-role-exposed RPC metadata, verified
against actual SQL grants in thirteen tests; it explicitly leaves hosted Auth,
authenticated credit RPC, RLS, checkout and signing-secret acceptance false.
The historical migration directory lacks foundational table definitions, so a
reviewed schema-only baseline is needed before hosted Auth testing. The current Preview still targets the Production database
with credit checkout paused, so it must not be used for financial tests.

The matching Mac's notarization upload was attempted and stopped with Xcode
`No Accounts` and invalid existing account credentials. The Mac was unlocked for account inspection: Xcode Apple Accounts was empty
and a Sign In sheet was opened for the owner. Sign-in has not been confirmed,
and the Mac locked again before native Photoshop testing. No Apple ticket, final notarized ZIP, app
publication or persistent production migration has been completed for this
credit release. The current public release metadata was captured for rollback;
The guarded immutable upload/publication scripts pass nine focused tests and
require the exact verified notarized artifact and confirmed private bucket
before upload. The actual upload and full readback passed; publication has not
run. Final ZIP: 94,969,340 bytes, SHA-256
`ba748982a45b15f3e155b0319cf9fb9249571c6025762bbaed0ed3bb94d553bc`.

The parent compatibility review is an additional release gate. New proof tables
begin empty and cannot automatically authorize existing cutouts. The candidate
removes anonymous Supabase cutout discovery, gates the picker on actual usable
server-authorized output, and checks saved and multi-pose selections again.
Both parent order routes check retained selected backgrounds before the first
order write or payment request. Original-background and explicit retouch-only
products remain eligible. Existing active cutouts and promised background
orders require exact ownership/byte review and approved preservation before
strict enforcement; no legacy grants, reprocessing or bucket-privacy change
has been applied. See [managed cutout access](managed-cutout-storage-2026-09-29.md).

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


All five exact migrations were additionally verified together against the live
production schema in a BEGIN/ROLLBACK harness through the authenticated Supabase
SQL editor. Within the transaction, assertions confirmed that existing balances
and purchase/use totals stayed unchanged, authenticated wallet/private proof
writes were revoked, service-only completion/revision RPCs remained private and
desktop proof RPCs were available. A separate read after rollback confirmed two
existing credit accounts and absence of every candidate schema table. No persistent
production schema change or real customer charge occurred. The five-file harness
also matches the isolated PGlite lifecycle/security tests.

The matching managed-cutout Preview `dpl_EETTox2YEtvPEsAjCsdfNQPrddzA` is READY
at commit `b565c2e`. The opt-in build-only R2 staging test uploaded a real 100-byte
alpha PNG (200), read the identical full SHA256, rejected changed size/type
headers (403), and deleted/confirmed absence of all three private test objects.
The scoped diagnostic flag was removed afterward. This verifies the actual
signed staging storage protocol, not an authenticated credit purchase/processing
session. Preview `/credits` is 200 and all three cutout POSTs are protected (401).
The latest live check confirms restored public pages at 200, both refund/CRM
crons at 401 and the Stripe webhook at 405-on-GET. Production credit page/gateway
remain 404 and production is still restored commit `011bf81`.
