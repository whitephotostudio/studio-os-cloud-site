# Photographer journey audit — September 24, 2026

The broader audit reproduced additional access problems using a disposable account. These are application defects; the evidence does not support blaming a photographer's computer or connection.

## Reproduced and repaired

- **Direct desktop login:** the installed Mac app calls `claim_desktop_app_access`, a different path from the web activation API. A confirmed signup with a placeholder profile was refused before visiting the website. The RPC now initializes the trial and keys transactionally.
- **Sign-out and return:** releasing a desktop registration left its Photography Key occupied. Deactivating the key and signing back in then produced a unique-constraint error. Release now frees the caller's activation; return login reuses it safely.
- **Concurrent activation:** web and native activation now share account-locked database functions, consistent plan allowances, stable key codes and safe reactivation. Trials have two keys; Core has one; Studio includes two plus purchased extras. Expiration suspends access; owner bypass remains compatible. Revoked keys are never revived.
- **School uploads:** a text local school ID was compared against a UUID column, producing PostgreSQL `22P02` and a misleading permission denial. Upload authorization now resolves UUID and local IDs separately and rejects foreign or ambiguous namespaces.
- **Login navigation:** protected downloads supplied `next`, while sign-in read only `redirect`. Sign-in now supports both safely, retains same-site destinations, and bounds the optional welcome lookup to eight seconds. Invalid credentials no longer falsely claim the account exists.
- **Transient account checks:** agreement lookup failure now shows retry without signing the photographer out or falsely requesting legal acceptance again. Protected writes remain denied while verification is unavailable.
- **Shoot dates:** the live gallery displayed September 24 as September 23 in Toronto. Project and school shoot dates now retain their calendar day across time zones; activity timestamps keep their existing time behavior.
- **Trial administration:** revocation previously wrote an unsupported `inactive` status. It now expires a valid trial row; trial actions reject owner and billing-linked accounts and avoid overwriting a concurrent billing status change.

## Files

The main changes are the desktop lifecycle migration, `lib/studio-os-app.ts`, sign-in and upload helpers/routes, agreement status/gate helpers, and admin trial handling. Regression coverage is in `tests/trial-onboarding.test.mjs` and `tests/photographer-navigation-upload.test.mjs`.

## Verification and release

Completed:

- Applied and recorded migration `20260924220000`. Its public native RPC signatures are unchanged, so the installed Mac app receives the access repair immediately without reinstalling. Only the service role can directly call the new key maintenance functions.
- **326 website tests pass**, including 17 additional cases in this audit. TypeScript and both local and remote production builds pass. Targeted lint has no errors; existing dashboard unused-variable/image warnings remain. **30 tests pass** against the frozen source of Mac release 0.1.11 (15), covering transport retry, MFA, payment/refund safeguards, upload confirmation and storage safety.
- Confirmed native RPC behavior on the live database using a disposable confirmed signup: first desktop login without a website visit, six simultaneous retries reusing one activation, two competing new devices admitting only the available seat, release/re-sign-in, stable key codes, trial expiry denying access, and authenticated callers being denied the service-only RPC. No customer device or identity was used.
- Tested deployed web activation, validation and reactivation, protected Mac download (HTTP 200; 94,645,774 bytes), sign-in return destination, pre-release school/gallery creation, local-ID school upload, project JPEG normalization, thumbnail generation for both, photo insertion with the photographer's normal database permissions, signed image retrieval and rejection of an unowned upload path.
- Browser checks verified Membership's 30-day trial and two keys, the ready-to-download welcome guide, dashboard counts, gallery/album navigation, the uploaded photo, and the corrected **September 24, 2026** shoot date in Toronto. Date regression checks also cover Los Angeles, Sydney, Honolulu and daylight-saving transition dates.
- All eight existing accounts retain their previous plan/status/admin/extra-key/studio fields. The five recovered trials still expire October 24, 2026 at 13:15:36 Toronto time and each retains two keys.
- Deleted the disposable account, profile, keys, activations, synthetic consent fixture, gallery, school and test photos. Verified both test storage folders are empty. No real charge, refund or customer email was performed by this audit.
- Code commits: `50db826` (access and recovery), `957cb1c` (thumbnail authorization), `171b587` (calendar dates). The final guarded production release is **`dpl_GvLEdWD91t5QVD9SCzndZAZTfGns`**, from `171b587`, promoted to https://www.studiooscloud.com. Homepage, sign-in and signup return HTTP 200 with this exact deployment ID; anonymous desktop status returns 401.

The pre-audit rollback deployment is `dpl_Gwj7wDfUL7e6NuxxMKBrx1tH2fo9`. The database migration is additive apart from replacing the native claim/release bodies; no customer data was migrated or reset. Do not revert restored trial windows during a website rollback.

One browser navigation on an intermediate build had a transient chunk load failure; reload recovered, the requested asset returned HTTP 200, and final-build navigation passed. The evidence does not establish a cause for that transient failure. Local development R2 credentials returned HTTP 401; production upload/read/delete succeeded, and cleanup used the authenticated production API. Local credentials were not changed.

This audit does not establish that all possible bugs are absent. It targets onboarding, trial/device access, login recovery, gallery creation/upload and the existing payment safety regressions. No real purchase or refund is needed for these checks, and it is not a Windows hardware or camera/printer integration certification.

## Changed files

- Access: `supabase/migrations/20260924220000_repair_desktop_access_lifecycle.sql`, `lib/studio-os-app.ts`.
- Login: `lib/sign-in-redirect.ts`, `app/sign-in/page.tsx`.
- Uploads: `lib/upload-ownership.ts`, `app/api/dashboard/upload-to-r2/route.ts`, `app/api/dashboard/generate-thumbnails/route.ts`.
- Account-check recovery: `lib/agreement-status.ts`, `lib/require-agreement.ts`, `components/agreement-gate.tsx`, `app/api/dashboard/agreement/status/route.ts`.
- Trial administration: `lib/admin-trial-change.ts`, `app/api/dashboard/admin/users/route.ts`.
- Calendar-day display: `lib/calendar-dates.ts`, `app/dashboard/projects/[id]/page.tsx`, `app/dashboard/projects/events/page.tsx`, `app/dashboard/schools/page.tsx`.
- Tests: `tests/trial-onboarding.test.mjs`, `tests/photographer-navigation-upload.test.mjs`.
- This audit report.
