# Fees on every paid customer order

Harout corrected the published school-only fee policy on October 14 and explicitly requested that it work across all paid tiers and order types. Gallery charges 55 minor units per paid customer order; Core and Studio charge 45. The monthly and yearly subscription amounts remain unchanged.

| Paid plan | Monthly CAD | Yearly CAD paid upfront | Fee per paid order |
| --- | ---: | ---: | ---: |
| Gallery | 59.00 | 599.00 | 0.55 in the sales currency |
| Core | 99.00 | 1,069.20 | 0.45 in the sales currency |
| Studio | 199.00 | 2,149.20 | 0.45 in the sales currency |

Fees apply to ordinary client galleries, events, portraits and school orders. Rates apply per persisted internal order, including multiple orders grouped in one checkout, rather than per photo or item. Supported currencies retain nominal minor-unit pricing without FX conversion. Owner/admin, zero-value and existing fee-waiver rules remain intact. Stripe processing and AI credits are additional.

## Prospective version and payment history

The `gallery_v3` catalog has distinct `studio-os-{plan}-{monthly|annual}-gallery-v3` Stripe lookup keys and subscription metadata. `STUDIO_GALLERY_PRICING_V3_ENABLED=1` selects it ahead of the older V2 offer. Previous V2 and legacy prices, subscriptions and actual fee terms remain recognizable. A key-quantity change alone does not move a subscriber to the new fee policy; an explicit new-plan purchase/update can select it.

Fee eligibility comes from the actual Stripe subscription price, customer and ownership metadata. New V3 subscriptions have no second monthly order meter. Historical ledgers and refund credits continue to drain under their saved rates. Frozen/open checkout payloads and historical refunds retain their original fee and payment account. All free trials retain the disclosed 35-minor-unit fee.

Express remains the live photographer payment route. This release adds no Standard account routing, migration SQL, B2/storage change or unlimited-storage promise.

## Verification and release

Run required checkout, grouped/waived-order, nominal-currency, actual subscription-update, refund, disclosure, schema, TypeScript and full regression checks. Commit a clean worktree and create production only through `npm run deploy:production -- --skip-domain`.

The remote catalog guard verifies the exact platform account and all six V3 prices, using the existing Vercel server secret without exporting it. Old lookup keys cannot be transferred. With `STUDIO_GALLERY_PRICING_CHECKOUT_VERIFY=1`, it also creates six unpaid, customerless subscription Checkout Sessions, verifies each exact price and amount through provider GET, and expires each session. These probes never submit a payment or create a paid subscription. They validate provider checkout configuration; application-fee calculation and refund behavior are separately covered by actual backend regression fixtures. No genuine separate Stripe test credential was configured at this audit, so do not claim a real fee-bearing payment rehearsal occurred.

Review the ready candidate and enabled provider checks before promotion. Verify live monthly/yearly cards and selected-package signup fee disclosures. Update Thursday's automation to preserve this release and both old/new fee profiles. Do not deploy the old Stripe migration branch over current production.

For rollback of the public offer, disable only the V3 selection flag and redeploy compatible current code. Retain V3 recognition for subscriptions already created; never restore code that cannot identify their terms or rewrite frozen payments.
