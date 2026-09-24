# Mac payment-safety release 0.1.11+15

The Mac release contains the native order refund/cancellation controls and fresh cloud payment checks before fulfillment. It is a universal Apple Silicon / Intel app requiring macOS 13.5 or later, signed with Developer ID, notarized by Apple and stapled. The production website and both payment-safety migrations are live.

## Build and verification

The desktop source tree was frozen under `/Users/harout/Downloads/Projects/studio-os-macos-payment-release-20260924`. Its `.release/source-sha256.json` records the source inventory. Existing unrelated desktop work was preserved; the desktop repository was not reset or committed wholesale.

Final archive: `.release/StudioOS-0.1.11-15-final.xcarchive`. Final notarized app: `.release/notarized/Studio OS.app`. The archive without `-final` predates the canonical API hostname correction and must not be distributed.

Artifact: `release/StudioOS-0.1.11-15-macOS-universal.zip`, **94,645,774 bytes**.
SHA-256: `72bdd3786b8e92d1da07b420922f2851e15a971ce5b8ba5e751456b9519583ba`.

Flutter analysis and all 698 tests passed. The five focused payment tests and payment-service analysis passed after correcting the API URL to `https://www.studiooscloud.com`. The final universal archive, notarization export, deep strict signature verification, stapled-ticket validation and Gatekeeper assessment passed. The ZIP was extracted and its app's signature and staple verified.

## Installation

Installed `/Applications/Studio OS.app` is version 0.1.11 (15). It launched successfully and the temporary QA copy was closed. Normal Orders PIN protection remains enabled. Existing application data and settings were preserved.

The previous installed 0.1.10 (14) app is backed up at `/Users/harout/Downloads/Studio OS Backups/Studio OS 0.1.10 (14) before payment safety 2026-09-24.app`.

The studio owner used the new controls to refund only duplicate order #10e5a686. Stripe, cloud and native UI showed CAD 103.60 refunded. The other order #5e51bd3c remains paid and requires review/retouching. See `payment-safety-2026-09-24.md` for the investigation and incident evidence.

## Distribution

Published September 24, 2026 at 16:37:29 UTC. The immutable private storage object is `storage://studio-os-downloads/StudioOS-0.1.11-15-macOS-universal.zip`.

The artifact was uploaded with resumable transfer, downloaded in full, and verified against both the local SHA-256 and byte length before publication. The release row was updated only if its previous timestamp still matched, preserving its public release state and Windows configuration. The previous Mac artifact remains available for rollback.

The public download route returned HTTP 307 to the new versioned artifact; the artifact returned HTTP 200 with the expected 94,645,774 bytes. Download page: https://www.studiooscloud.com/studio-os/download.

The snapshot's `.release/distribution.json`, `.release/published-website-release.json`, and `.release/previous-website-release.json` retain verification and rollback metadata.

## Files changed

Native payment files: `lib/screens/orders_screen.dart`, `lib/screens/digital_orders_screen.dart`, `lib/services/supabase_sync.dart`, `lib/services/order_payment_state.dart`, `lib/services/order_payment_service.dart`, `lib/widgets/order_payment_dialog.dart`, `test/order_payment_safety_test.dart`, `pubspec.yaml`, and the two payment/release documents.

Website payment implementation and migration files are listed in `payment-safety-2026-09-24.md`. Release verification additionally changed `scripts/verify-payment-release.mjs`, `tests/payment-release-verification.test.mjs`, `package.json`, and the retouching tests adapted to the transactional API. No website marketing copy or download-page component needed changing for this version.
