# Security Patch 9: Studio OS Desktop Administrator MFA

Date: July 22-23, 2026 (EDT)

## Outcome

Studio OS for macOS now completes the Supabase TOTP challenge after a fresh
password sign-in when the account has a verified authenticator factor. An AAL1
(password-only) session cannot enter the app, start order polling, synchronize a
school, pull packages at startup, or report the account as online.

The challenge is not shown on every normal application launch. A restored AAL2
session remains signed in. The challenge is required after a deliberate sign
out/new password sign-in, on a new device, or after the authenticated session
must be re-established.

## Scope

Desktop source files changed for this patch:

- `lib/services/supabase_sync.dart`
- `lib/screens/sign_in_screen.dart`
- `lib/widgets/auth_status_pill.dart`
- `lib/main.dart`
- `test/mfa_enforcement_source_test.dart`

No Studio OS Cloud website code, Vercel deployment, Cloudflare configuration,
Supabase schema, booking data, order data, gallery data, or R2 objects were
changed during this patch.

## Security behavior

- The desktop client refreshes the enrolled factor list after password sign-in.
- On macOS, the challenge opens Apple Passwords automatically and provides an
  **Open Apple Passwords** fallback button. Studio OS never reads the password,
  TOTP secret, or current code from Apple Passwords.
- Apple-style grouped codes are normalized to six digits, and pasted input
  accepts digits only.
- When Supabase reports that AAL2 is available but the session is AAL1, the app
  requests the current six-digit TOTP code.
- Verification uses Supabase `challengeAndVerify`; the code is not logged or
  stored by Studio OS.
- Subscription/device access is checked only after MFA succeeds.
- The app shell keeps AAL1 sessions out of `HomeScreen`.
- Background order polling and package/school sync are blocked at AAL1.
- The account pill reports Online only after MFA is satisfied.
- A restored password-only session resumes the code challenge instead of
  entering the app.

## Validation completed before installation

- Targeted Flutter analysis: no compilation errors. Existing unrelated style
  warnings remain in older synchronization code.
- Flutter tests: 14 of 14 passed, including five MFA enforcement regression
  tests.
- macOS release build: succeeded.
- Built app size: 162.2 MB.
- Apple deep/strict code-signature verification: passed.
- Signing identity: Developer ID Application, team `NLLWH8S9S7`.
- Bundle identifier: `com.whitephoto.studioos`.
- Installed executable SHA-256:
  `fa189185e9a6da7aa0eada423f7a2f87f6bf9b45c79a0e5d51ab860387eb5902`.
- Installed bundle: `/Applications/Studio OS.app`.
- Launch verification: the installed bundle started successfully.
- Release signing used `macos/Runner/Release.entitlements`; the final app does
  not contain the development-only `get-task-allow` entitlement.
- Production HTTP checks after installation: home, booking, and sign-in routes
  returned HTTP 200.

The app is Developer-ID signed but not Apple-notarized because the
`STUDIO_OS_NOTARY` Keychain profile is not configured. The two preceding
installed copies have the same unnotarized status, so this is not a regression.
Configure the existing `macos/scripts/build_and_notarize.sh` workflow before
distributing the application to other Macs.

## Verified pre-install rollbacks

The actively used `/Applications` copy and the older Desktop copy were copied
before installation. Every copy passed deep/strict code-signature verification,
and each copied executable matched its source SHA-256.

Local:

`/Users/harout/StudioOS_Security_Backups/App_Rollbacks/MFA_Patch_9_Preinstall_2026-07-22_2132`

External:

`/Volumes/StudioOS Security Backup/2026-07-22_post_security/post-security/app-rollbacks/MFA_Patch_9_Preinstall_2026-07-22_2132`

Executable hashes:

- Pre-patch `/Applications` copy:
  `4c9b4270edfe80e839eaf4d0951313d7845dfc726b22cae7c8ec5e1c3b4ba4ec`
- Pre-patch Desktop copy:
  `4e0fdd1e796633184a9acdf51ff5dcd3751947ed896982be5792cd56a40635b3`

An additional immediate rollback remains at:

`/Applications/.Studio OS Pre-MFA 2026-07-22 2132.app`

The first MFA test build, preserved before adding Apple Passwords convenience,
remains at:

`/Applications/.Studio OS Initial-MFA 2026-07-22 2133.app`

The older `/Users/harout/Desktop/Studio OS.app` was not replaced.

## Rollback

If the manual authentication test fails, quit Studio OS, preserve the failed
bundle for diagnosis, and restore the verified pre-patch `/Applications` bundle
from either rollback directory above. Do not change the website, Supabase, R2,
or Cloudflare to roll back this desktop-only patch.

## Manual acceptance completed

Completed July 23, 2026:

1. The owner enrolled a fresh TOTP factor and completed website verification.
2. The authenticated website displayed **Two-factor authentication enabled
   successfully** and removed the enrollment QR form.
3. A read-only Supabase administrator check found exactly one TOTP factor:
   one verified and zero unverified factors.
4. The password exposed during troubleshooting was replaced privately with a
   new password saved in Apple Passwords.
5. The owner deliberately signed out of the installed Studio OS app, signed in
   with the new password, completed the six-digit challenge, and confirmed the
   app reached the home screen and reported Online.
6. The installed `/Applications/Studio OS.app` process remained running after
   the acceptance test.
7. Production home, booking, and sign-in routes returned HTTP 200 after the
   authentication and password changes.

### Apple Passwords recovery note

Apple Passwords intentionally hides a verification code in screenshots. If a
factor is re-enrolled, an existing saved verification code can still be based
on the old TOTP secret. Replace only the saved verification-code setup with the
new private setup key, confirm the entry was modified on the current date, and
then use the newest changing code. Do not delete the password item.

Never place a password, TOTP code, TOTP seed, recovery code, access token, or
cookie in this runbook.
