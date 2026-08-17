# Security Patch 2: R2 credential removal runbook

Status: completed on 2026-07-21 for the Studio OS desktop app and the production
R2 gateway. No booking, payment, roster, student, order, printing, or gallery
records were changed during this patch.

Current production deployment:

`https://studio-os-cloud-site-27ltlebfa-whitephotostudio-7289s-projects.vercel.app`

Production alias: `https://www.studiooscloud.com`

## Objective

Remove the Cloudflare R2 master write credential from distributed Flutter
binaries without interrupting:

- school and event photo uploads;
- preview and thumbnail repair;
- cloud restore and object listing;
- digital-delivery uploads;
- full-resolution print downloads and Noritsu output.

## Current architecture

The signed-in Flutter app calls `POST /api/dashboard/r2-access` with its
Supabase bearer token. The server:

1. verifies the user and current Studio OS Cloud agreement;
2. resolves the user's photographer profile;
3. validates that the exact object key or listing prefix belongs to one of that
   photographer's schools, projects, backdrops, or delivery folders;
4. returns a short-lived, exact-key R2 PUT/GET URL, or performs a server-side
   HEAD/list operation;
5. never returns the R2 access key or secret.

Supported key layouts include legacy school-root paths, `schools/{id}`,
`projects/{id}`, `probes/{projectId}`, `photos/{schoolId}`,
`nobg-photos/{schoolId}`, and `backdrops/{photographerId}`.

The Flutter R2 storage service is now gateway-only. The legacy AWS Signature V4
fallback and the R2 access key, secret, and account identifier were removed
from the Flutter source and fresh release artifact.

## Completed checks

- `npm run test:security`: 14/14 pass.
- Targeted ESLint: pass.
- Full Next.js production build: pass.
- Focused Flutter gateway tests: 3/3 pass.
- Focused Flutter gateway analysis: no issues.
- Exact Flutter `R2StorageService` debug smoke with legacy fallback disabled:
  upload, existence, list, download, and content verification all passed.
- The debug smoke used a uniquely named tiny text object under an owned
  `_security-tests` path. The object was deleted and confirmed missing.
- Fresh macOS release build and code-signature verification: pass.
- Exact scans of the fresh release and installed desktop app found zero copies
  of the former R2 access key and secret.
- The updated app was installed at `/Users/harout/Desktop/Studio OS.app`,
  launched successfully, restored its signed-in session, and synchronized its
  schools and packages without errors.
- A new Cloudflare R2 account token was created with Object Read & Write access
  restricted to only the `whitephoto-media` bucket.
- Direct new-token R2 PUT, GET, list, delete, and missing-object checks: pass.
- Vercel Production and Preview R2 environment credentials were updated.
- A new production deployment was built and aliased to
  `www.studiooscloud.com`.
- Authenticated production gateway PUT, HEAD/existence, scoped list, signed GET,
  and content verification: pass.
- Production request without a session: HTTP 401.
- Production authenticated request for a path outside the user's ownership:
  HTTP 403.
- Temporary production R2 test objects were deleted and confirmed missing.
- The former all-buckets R2 token `studio-os-2026-04-30` was deleted in
  Cloudflare. A direct request with that credential now receives HTTP 401.
- A final post-revocation production PUT and signed download passed, proving the
  live gateway uses the new restricted token.

## Deliberately deferred checks and changes

- No real client email was sent. Patch 1 already secured the server-side
  digital-delivery endpoint, and sending an email to a real client was avoided.
- No print was sent to the Noritsu. The updated app's secure download path was
  exercised with a synthetic object, but a real production order was not
  touched.
- A large multi-photo performance run was not performed. This remains an
  optional operational test using non-student test images.
- The separate older token `studio-os-cloud-site-2026-04` remains active while
  its consumer is audited. It is already restricted to `whitephoto-media` and
  must not be deleted until its use is identified or ruled out.
- The website's local `.env.local` still contains the now-revoked former
  credentials. They receive HTTP 401 and are not usable. Production and Preview
  have the current credentials; local direct-R2 development needs a deliberate,
  secure refresh before it will work again.

## Separate public-photo exposure requirement

Rotating/removing the write credential does not by itself make the bucket
private. Do not disable the public R2 URL yet: database photo URLs, galleries,
and digital-delivery emails still contain public URL shapes. First migrate every
parent/client delivery path to authenticated or short-lived downloads and test
gallery viewing, paid downloads, email delivery, and printing.

This is the next major privacy phase. Turning off public access before those
paths are migrated would break existing galleries and downloads.

## Rollback and recovery

The current secure desktop app is:

`/Users/harout/Desktop/Studio OS.app`

The preserved pre-change desktop binary is:

`/Users/harout/StudioOS_Security_Backups/App_Rollbacks/Studio OS Pre-R2-Key-Removal 2026-07-21 2337.app`

That rollback binary contains the old credential, but the credential is now
revoked. It therefore cannot restore direct R2 access and should be used only
for binary comparison or emergency application rollback while the secure
gateway remains available.

The immediate pre-rotation gateway deployment was
`dpl_EP62r3pQmdT1Ze2EYZFbs8ZXRLYD`. An older known-good website deployment is:

`https://studio-os-cloud-site-b2z22i4an-whitephotostudio-7289s-projects.vercel.app`

The full external backup is recorded in:

`/Users/harout/StudioOS_Security_Backups/LATEST_BACKUP_LOCATION.md`

The external SSD was safely ejected after the backup. Reconnect it before
attempting a restore. Current source changes remain uncommitted and should be
reviewed separately before any commit or release publication.
