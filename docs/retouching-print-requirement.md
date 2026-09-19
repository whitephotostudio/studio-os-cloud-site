# Retouching requires a print purchase

Retouching is now an add-on to a print or print package in the same gallery's order. Digital downloads and other services alone do not qualify. Canvas and metal photographic prints also qualify.

The previous add-on handler saved retouching while leaving the selected print as a transient draft. Browsing away could clear the print and leave only the service. Adding retouching now saves the selected product and service together, preserving their student/gallery tags. Retouching choices are limited to photos assigned to prints. The last qualifying print cannot be removed until its retouching add-on is removed. Older standalone service carts show an explanation and cannot check out.

The dialog explicitly states that retouching includes neither a printed photo nor a digital download. Both order-creation routes validate authoritative package definitions before inserting any order, separately for each student in combined carts. The Stripe checkout endpoint also checks previously saved unpaid drafts before creating a payment session. Already paid orders are not changed.

## Files changed

- `lib/retouching.ts`: shared print eligibility and per-gallery add-on requirement.
- `app/parents/[pin]/page.tsx`: basket/checkout guards, atomic product-plus-service saving, print-photo selection and clarification copy.
- `app/api/portal/orders/create/route.ts`: enforce the rule before single school/event order insertion.
- `app/api/portal/orders/create-combined/route.ts`: enforce the rule per student using database package rows.
- `app/api/stripe/checkout/route.ts`: reject old standalone retouching drafts before starting payment.
- `tests/retouch-print-purchase.test.mjs`: executable policy, actual client-handler and real route tests with external services stubbed.
- This verification report.

## Verification

Fifteen regression tests cover empty and digital-only baskets, legacy named/flagged services, draft preservation, print removal, sibling isolation, valid print-plus-retouching orders and unchanged print-only/digital-only payments. Route tests invoke the actual single-school, event, combined and Stripe handlers with isolated database/payment fixtures; rejected purchases perform no order insert or payment-session creation.

Browser verification used the actual gallery handlers and retouching dialog in an isolated local fixture: retouching alone left the basket empty with the print-required message; choosing a print enabled the dialog; adding retouching saved both lines and cleared the transient draft; removing the print was refused with an explanation. No customer order was created during these checks.

All 246 automated tests passed, along with TypeScript, focused ESLint, the clean-worktree release guard and the production build.

Released commit `e75a8cd` through `npm run deploy:production` on September 19, 2026. Deployment `dpl_ALAPd1FrGYs5Kg2FEcumQyMUA7BZ` is READY and aliased to `https://www.studiooscloud.com` (also `https://studiooscloud.com`).

Live Safari verification confirmed the new print-required explanation, adding retouching alongside a print package, and refusing to remove the last print while retouching remains. Removing retouching first then allowed the print to be removed. The temporary basket items were cleared; no customer order or payment was created.
