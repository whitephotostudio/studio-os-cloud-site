# Immediate subscription pricing release

Harout authorized updating the live website now, independently of Thursday's photographer Stripe account migration. This release starts from `082225f454dbcbb6183e3da03ab0a7b457dd2c49`, whose tree matches the verified production `75a7d299bc59c5cd77db85f757866c9be36aaae3`. It retains the released student-search fix and contains no Standard/history migration, new webhook recovery, SQL or cron changes.

## New paid subscriptions

| Plan | Monthly CAD | Annual CAD paid upfront | New paid order policy |
| --- | ---: | ---: | --- |
| Gallery | 59.00 | 599.00 | No ordinary gallery platform order fee |
| Core | 99.00 | 1,069.20 | No ordinary gallery fee; 0.45 per qualifying school production order |
| Studio | 199.00 | 2,149.20 | No ordinary gallery fee; 0.45 per qualifying school production order |

Subscriptions remain CAD. School production fees retain the existing nominal sales-currency model: 45 minor units per qualifying persisted internal order in supported two-decimal currencies, including CAD and USD; no exchange-rate conversion. Grouped purchases may include multiple qualifying internal orders. Owner/admin/test/zero-value exemptions remain. Card processing is additional and paid by the photographer for their customer orders.

Existing subscriptions keep their real Stripe prices and verified legacy usage rates. Existing frozen fees and open checkouts retain their original payloads/accounts. The new fee policy is resolved from the actual platform subscription price, customer and ownership metadata, not merely a global flag or a browser parameter. New paid subscriptions have no monthly usage meter; old retained meters finish historical ledger/refund entries without staging new monthly fees after a move to the new offer. Free trials retain the current Studio 35-cent paid-order rule; the optional trial cutover timestamp is not being activated in this release.

## Storage and provider boundaries

`STUDIO_GALLERY_PRICING_V2_ENABLED=1` activates this paid catalog. `STUDIO_GALLERY_UNLIMITED_STORAGE_ENABLED` remains absent/off, so published copy promises photo gallery hosting rather than unverified unlimited storage. B2 has not been migrated. The JPEG/50 MB/unlimited offer still requires its separate storage/economics/upload/retention checks.

WhitePhoto's Express account remains selected. Its new Standard candidate is not activated by this release. Subscription billing uses the Studio OS platform independently of merchant onboarding. Existing photos, customer orders, refunds, app releases, credentials and other worktrees are preserved.

## Catalog gate and release procedure

The remote build runs `verify-gallery-pricing-release.mjs` after the existing payment release checks. With the pricing flag on, it requires the exact expected live platform account (`STUDIO_GALLERY_PRICING_EXPECTED_ACCOUNT_ID=acct_1TBlT4PxlnWeytFA`). It checks all six versioned prices/products before any creation; incompatible existing entries block release. Missing entries are created with the same deterministic payloads and idempotency keys as normal checkout. A fresh provider GET must prove the final amounts, CAD currency and single licensed month/year interval. Legacy lookup keys are never used or transferred.

The gate makes catalog configuration writes only: no customer, subscription, checkout, charge, refund, transfer or photographer account writes. It uses Vercel's existing server secret without exporting it locally. Other enabled production checks remain unchanged. No backup or credential-recovery flags are added.

Commit the focused change and release only through `npm run deploy:production`. Stage with `--skip-domain`, review the remote provider/build results, recheck the current production source and then promote the ready deployment. Verify published monthly/annual prices, signup, schemas and authenticated billing status after promotion. Do not use real parent purchases or actual sales refunds as tests.

For rollback of new offer selection, keep the new compatible code and disable its offer flag, then redeploy through the same guard. Paid v2 subscription recognition remains available with the flag off. Do not blindly restore old code that cannot recognize v2 prices once a customer has subscribed, or rewrite existing subscriptions/payment history.

## Validation and outcome

The first full local regression passed 2,047 tests and the optimized build. Additional tests cover USD fees, licensed-price reuse and the remote catalog gate. Final guarded release and live provider/browser results will be recorded separately; a working build/configuration does not establish a completed real paid subscription.
