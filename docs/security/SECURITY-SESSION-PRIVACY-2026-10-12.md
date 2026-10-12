# Parent-session security and recovery follow-up — 2026-10-12

This follows the [earlier production hardening record](./SECURITY-HARDENING-2026-10-12.md). It records a bounded security change, not a guarantee against compromise or future data loss.

**Release status: integration and independent review in progress; this follow-up has not been deployed.** The earlier production runtime is `51101a332a98c71e83f8ac7c1226ec5b4ac5230a`. Do not interpret source tests as proof of the new live behavior.

## Changes prepared

- New parent access uses a random host-only, Secure, HttpOnly, SameSite=Lax browser cookie. Only its SHA-256 hash is stored. Gallery lane IDs select an authorized scope; they are not access credentials. Every action rechecks the current PIN, gallery, studio, expiry and applicable email whitelist, then retains the original route's media, price and order authorization.
- New gallery URLs, JSON action requests, recovery redirects and Stripe return URLs omit the parent PIN/email. Browser cart persistence keeps products, quantities, photo choices, backdrop settings and sibling identities while replacing authentication copies with opaque lane references. Active event favorite/ratio choices migrate before navigation. Unavailable reauthentication retains the basket for reopening.
- New Stripe checkouts require authenticated order provenance and an immutable browser/studio/order-group/child binding. Return handles are persisted under the existing payment lock before provider creation, and retries retain the provider idempotency key. The original purchased child's current PIN is checked even when another sibling retains the former family PIN. Edited billing/receipt email remains separate from gallery authorization.
- Missing, expired or different-browser payment returns show QR reopening and payment-status instructions. They do not start another charge or clear a basket. Historical paid-provider confirmation remains compatible; possession of an order ID alone cannot create a fresh checkout.
- Newly issued preview, download, batch, digital-delivery and favorites capabilities encrypt their payloads with authenticated, purpose-specific encryption. Previously issued signed links retain their existing MAC, expiry, ownership and payment checks. Failed encrypted-token parsing never falls back to the legacy format. Expired preview tokens can identify a saved cart choice only; current allowed-photo validation still controls purchases and photo access.
- New share and prepared receipt links use a separate encrypted seven-day entry capability. Redemption rechecks current gallery authorization and the original studio before setting a private browser session. Sharing keeps its browser share-sheet behavior without copying a cookie-bound URL or the current checkout markers. Historical frozen email payloads retain their original idempotent retry bytes.
- PIN attempts reserve both shared windows atomically. Successful exact validation refunds its own single-use reservation; failed guesses retain the ten-per-minute and sixty-per-fifteen-minute budget. Registered browser sessions have separate verified API/action counters. Ten simultaneous initial validations can still be pending on one shared IP; success releases those slots promptly.
- Website and mobile development/runtime dependency audits are clear. The Next ESLint glob adapter preserves its actual root-directory API without the vulnerable `braces` chain. Mobile asset generation uses the maintained Sharp pipeline, retaining the checked-in artwork and native runtime versions.

## Release and preservation gates

The additive migrations create three service-only tables and four service-only functions. They do not delete or rewrite photos, students, orders or order items. Production application must follow reviewed migration order `20261012110000` then `20261012120000`, with fresh catalog/record checkpoints and exact function/ACL/RLS verification. The prebuild check reads all three schemas with `limit=0` and requires anonymous denial; it issues no session, order, email or payment.

Release requires a clean committed checkout, the complete test suite, production build and provider preflights through `npm run deploy:production`. Live checks must cover printed QR/legacy entry, a clean private URL, photo/backdrop navigation, saved-basket reload and existing paid-order access. Pre/post record comparisons must distinguish legitimate customer activity from an unintended change.

Rollback must retain the new private tables, capability decoders, session views and checkout-return compatibility once new URLs have been issued. The old `51101a3` runtime preserves customer data but cannot by itself serve the new URLs. Use a reviewed corrective release or compatible rollback; do not drop private metadata or rewrite customer orders to roll back application behavior.

## Recovery evidence

The earlier encrypted photo backup remains intact: 48,080 objects and 204,209,791,892 source bytes, plus its independently checked fresh-inventory delta. The 132-file final encrypted source/database/catalog checkpoint was separately authenticated and verified from the external drive.

This follow-up also completed an offline partial data recovery rehearsal using the authenticated final checkpoint. It recovered all 111 saved relation snapshots and 33,290 records, preserved original JSON numeric lexemes, and found zero violations across 169 internal foreign-key checks. Twenty-three references into managed authentication data were explicitly deferred. No archived SQL, application jobs, triggers, policies or provider functions were executed; no production request or mutation occurred. This proves a bounded data-mirror recovery, not a full Supabase/application disaster-recovery rehearsal.

## Remaining owner actions and limits

- The owner explicitly deferred Supabase management-account MFA and a second protected recovery-key/verification-receipt copy away from the Mac and photo drive. Those actions remain unfinished. The earlier exposed pending authenticator enrollment must be discarded when setup resumes. Vercel and GitHub management MFA were previously verified; Cloudflare/Stripe management MFA remains unverified after their browser sessions expired.
- The RSA private recovery key remains on the encrypted Mac. External ciphertext cannot recover itself if that sole key is lost. The new offline rehearsal does not solve that separate-key requirement.
- Printed legacy QR/PIN links remain supported and immediately bootstrap private access. Historical email links, browser histories/caches, provider logs and already issued tokens cannot be erased retroactively by this release. Intentionally shared encrypted entry links remain bearer access until expiry and must be protected; current PIN/gallery revocation is rechecked on redemption.
- Full provider/application recovery, managed authentication reconstruction, installed native iPhone app redistribution and an external penetration test remain outside the completed evidence. The existing unsigned patched-native simulator build does not prove a distributed app update.
- No live test charge, receipt send, destructive exploit, customer-photo content change or customer-order/payment mutation is authorized as part of verification. Local synthetic payment/order fixtures and ordinary authorized reads provide the bounded evidence.

Keep secrets, raw links, student records and recovery material out of this report. Protected verification receipts identify the exact source, release, snapshots and observation times.
