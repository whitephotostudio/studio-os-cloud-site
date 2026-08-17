# Security Patch 8 — Studio OS Administrator MFA and Local QR Rendering

Date: July 22, 2026 (EDT)

## Final outcome

Studio OS administrator TOTP authentication was enabled successfully for the primary owner account on July 22, 2026.

Before enrollment, the settings page was found to render the TOTP QR code through `api.qrserver.com`. That design would send the enrollment URI, including its TOTP secret, to an external QR-rendering service. Enrollment was stopped before that screen was used. The website was then changed to render the QR code locally in the browser with `qrcode.react` 4.2.0.

The primary owner enrolled the locally rendered QR code in Apple Passwords and completed verification. The live Studio OS interface reports that two-factor authentication is enabled. Supabase's dedicated administrator MFA endpoint independently confirms:

- 3 authentication users total;
- 1 user with a verified TOTP factor;
- 1 verified TOTP factor total;
- 0 unverified TOTP factors; and
- 0 other MFA factors.

No TOTP secret, six-digit verification code, password, recovery credential, email address, or user identifier is stored in this document.

## Source change

- Added `qrcode.react` 4.2.0 as an exact production dependency.
- Replaced the external QR image URL in `app/dashboard/settings/page.tsx` with the local `QRCodeSVG` component.
- Updated the enrollment instructions to include Apple Passwords and state that the QR is generated locally.
- Added `tests/security/mfa-enrollment.test.mjs`.
- The regression test requires local QR rendering and fails if `api.qrserver.com` is reintroduced.

The MFA API, sign-in challenge, booking flow, payment flow, roster, galleries, downloads, printing, and Desktop application were not redesigned by this patch.

## Verification

- Website security tests: 28/28 passed.
- New local-QR regression test: passed.
- Local Next.js production build: passed; all 76 pages generated.
- Vercel preview production build: passed; all 76 pages generated.
- External QR domain absent from source and compiled output.
- `qrcode.react` lockfile version and registry integrity entry verified.
- Preview home, booking, parent portal, portal choices, and settings: HTTP 200.
- Preview anonymous media gateway: HTTP 401.
- Production home, booking, parent portal, portal choices, sign-in, and settings: HTTP 200.
- Production anonymous media gateway: HTTP 401.
- Installed Studio OS Desktop process remained running.
- Live UI reports `Two-factor authentication enabled successfully.`
- Live UI shows `Disable 2FA` and no longer shows `Enable 2FA` for the owner.
- Supabase dedicated MFA factor verification reports one verified TOTP factor and zero unverified factors.

No booking, payment, order, email, photo, student, database business row, R2 object, Cloudflare token, Vercel environment variable, or Desktop installation was changed by the verification tests.

## Deployments

Current production:

- Deployment: `dpl_36WCurofAEqH9ESj1VcDVgvKNCRa`
- URL: `https://studio-os-cloud-site-b231fj9jy-whitephotostudio-7289s-projects.vercel.app`
- Primary alias: `https://www.studiooscloud.com`

Tested preview used before promotion:

- Deployment: `dpl_6uGddHSRoEKMAMznEpAqmEcCJsRh`
- URL: `https://studio-os-cloud-site-7pd1j9fk8-whitephotostudio-7289s-projects.vercel.app`

Immediate website rollback:

- Deployment: `dpl_2puo3FCtBHdPTSM6ckoREq4fa5M7`
- URL: `https://studio-os-cloud-site-bbs9ayfbp-whitephotostudio-7289s-projects.vercel.app`

Important rollback limitation: the rollback deployment contains the older external QR renderer. Existing verified MFA remains stored in Supabase and continues to work, but do not start a new MFA enrollment while that rollback is active. Restore the local-QR patch before enrolling another user.

## Administrator recovery

Supabase TOTP enrollment does not provide Cloudflare-style recovery codes in the current Studio OS interface.

- Keep the Studio OS verification code in Apple Passwords with iCloud Passwords and Keychain available on another trusted Apple device where possible.
- Do not store the TOTP secret or screenshots of its QR code in source control, email, support messages, or project documentation.
- If the primary owner permanently loses every trusted Apple device, verify the owner's identity first, then use the Supabase administrator MFA controls to remove only that user's verified factor and immediately re-enroll a new factor.
- Never disable MFA for all users as a general troubleshooting step.

A full sign-out/sign-in challenge should be tested while the current authenticated session and Supabase owner recovery access remain available.

## Dependency-audit follow-up

The dependency installation exposed pre-existing production dependency advisories. A read-only `npm audit --omit=dev` reported 7 affected production packages: 4 high and 3 moderate. The findings include Next.js 16.1.6, Sharp 0.34.5, AWS XML helper dependencies, and a transitive WebSocket dependency.

These upgrades are intentionally not combined with the MFA patch. They must be handled as a separate preview-tested security patch so any compatibility regression has one clear cause and rollback.

## Rollback procedure

If the new settings bundle causes an unrelated production regression:

1. Promote deployment `dpl_2puo3FCtBHdPTSM6ckoREq4fa5M7`.
2. Verify home, booking, parent portal, portal choices, and settings return HTTP 200.
3. Confirm anonymous media access still returns HTTP 401.
4. Confirm the installed Desktop process remains running.
5. Do not disable the already verified Supabase TOTP factor.
6. Do not enroll any additional MFA user until local QR rendering is restored.

The MFA factor itself is server-side account state and is not removed by a website deployment rollback.
