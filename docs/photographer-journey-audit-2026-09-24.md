# Photographer journey audit — September 24, 2026

The broader audit reproduced additional access problems using a disposable account. These are application defects; the evidence does not support blaming a photographer's computer or connection.

## Reproduced and repaired

- **Direct desktop login:** the installed Mac app calls `claim_desktop_app_access`, a different path from the web activation API. A confirmed signup with a placeholder profile was refused before visiting the website. The RPC now initializes the trial and keys transactionally.
- **Sign-out and return:** releasing a desktop registration left its Photography Key occupied. Deactivating the key and signing back in then produced a unique-constraint error. Release now frees the caller's activation; return login reuses it safely.
- **Concurrent activation:** web and native activation now share account-locked database functions, consistent plan allowances, stable key codes and safe reactivation. Trials have two keys; Core has one; Studio includes two plus purchased extras. Expiration suspends access; owner bypass remains compatible. Revoked keys are never revived.
- **School uploads:** a text local school ID was compared against a UUID column, producing PostgreSQL `22P02` and a misleading permission denial. Upload authorization now resolves UUID and local IDs separately and rejects foreign or ambiguous namespaces.
- **Login navigation:** protected downloads supplied `next`, while sign-in read only `redirect`. Sign-in now supports both safely, retains same-site destinations, and bounds the optional welcome lookup to eight seconds. Invalid credentials no longer falsely claim the account exists.
- **Transient account checks:** agreement lookup failure now shows retry without signing the photographer out or falsely requesting legal acceptance again. Protected writes remain denied while verification is unavailable.
- **Trial administration:** revocation previously wrote an unsupported `inactive` status. It now expires a valid trial row; trial actions reject owner and billing-linked accounts and avoid overwriting a concurrent billing status change.

## Files

The main changes are the desktop lifecycle migration, `lib/studio-os-app.ts`, sign-in and upload helpers/routes, agreement status/gate helpers, and admin trial handling. Regression coverage is in `tests/trial-onboarding.test.mjs` and `tests/photographer-navigation-upload.test.mjs`.

## Verification and release

Release and live verification results will be recorded here after deployment. The normal guarded production release runs the complete website regression suite and build. Desktop source checks run against the frozen source corresponding to the installed 0.1.11 (15) release.

This audit does not establish that all possible bugs are absent. It targets onboarding, trial/device access, login recovery, gallery creation/upload and the existing payment safety regressions. No real purchase or refund is needed for these checks, and it is not a Windows hardware or camera/printer integration certification.
