# Security Patch 3: public student-media audit

Audit date: 2026-07-21

Status: read-only production audit and Stage A rollout completed on 2026-07-22.
No existing database rows were rewritten, and public R2 access remains enabled
while the remaining compatibility stages are completed.

Stage A production deployment:

`dpl_6Rh2Z1JnspiFZytW26YezGvenryq`

Deployment URL:

`https://studio-os-cloud-site-ngi7mw6wx-whitephotostudio-7289s-projects.vercel.app`

## Executive finding

Supabase row-level access is protecting the tested student and order tables,
and the parent portal already checks email/PIN access before returning
short-lived R2 URLs. The remaining privacy gap is the Cloudflare R2 public
development URL itself: anyone who already obtains an exact object URL can
retrieve that object without authenticating through Studio OS.

An anonymous one-byte request to a stored student-media R2 URL returned HTTP
206 with an image content type. This confirms that the exposure is real and is
not only an obsolete URL stored in the database.

## Production inventory (counts only)

No student names, emails, PINs, object paths, or image contents were printed or
recorded by the audit.

- `students`: 210 rows total; 166 `photo_url` values use the public R2 host and
  44 are empty.
- `media`: 6,454 rows total; every row has a bare `storage_path`, and all 6,454
  preview and thumbnail fields use the public R2 host.
- `order_items`: 602 rows total; 309 SKU values use the public R2 host, 238 are
  expiring signed R2 URLs, 45 are bare keys, 2 are intentionally public
  Supabase assets, and 8 are empty.
- Schools: 12 active. Regardless of the stored `access_mode`, the current
  school portal route requires both a student PIN and a valid email before it
  returns gallery data.
- Projects: 26 total (19 active, 5 inactive, 2 archived). The current event
  portal route requires email plus a matching project, collection, or subject
  PIN before it returns gallery data.

## Controls that already passed

- Anonymous Supabase REST reads returned zero rows for all tested sensitive
  tables: students, media, orders, order items, schools, projects, collections,
  photographers, visitor logs, download logs, favorites, pre-release emails,
  and portal email captures.
- School gallery access is server-side and requires email plus a student PIN.
- Event gallery access is server-side and requires email plus a matching PIN.
- Parent gallery APIs replace stored public media URLs with six-hour signed R2
  URLs before returning them to the browser.
- Photographer dashboard image proxy requests require an authenticated account
  and verify project/school ownership before issuing a five-minute R2 URL.
- Paid website digital delivery uses an HMAC-protected, order-bound,
  recipient-bound, expiring link; the download route rechecks the order and
  paid status before building the ZIP.
- The installed Flutter app uses the authenticated R2 gateway for upload,
  existence, listing, and full-resolution download operations.

## Compatibility gaps to close before disabling R2 public access

1. The Flutter cloud-sync code still writes public R2 URL shapes into new
   `students.photo_url`, `media.preview_url`, and `media.thumbnail_url` values.
2. The Flutter orders screen still uses a public R2 URL for some on-screen
   thumbnails. Full-resolution print downloads already use the secure gateway.
3. The Flutter Digital Orders screen uploads selected delivery files to R2 but
   invokes the older Supabase `send-digital-delivery` function. The function has
   no R2 signing configuration in production and falls back to a Supabase
   Storage signed-link path. This workflow needs an explicit non-client test
   and a secure R2 delivery implementation before relying on it.
4. Existing order SKU fields contain both permanent public URLs and expired
   signed URLs. All consumers must normalize these values to R2 object keys and
   request fresh, authorized URLs instead of fetching the stored URL directly.
5. A small number of dashboard and compatibility helpers still return a public
   URL. Each must be replaced or proven to be used only for intentionally
   public assets such as studio logos and backdrops.
6. The generic portal download proxy still accepts the configured public R2
   origin. Remove that allowance after all parent download paths use signed or
   token-bound downloads.

## Remaining R2 token audit

The older bucket-restricted token named `studio-os-cloud-site-2026-04` was not
referenced by name anywhere in the Flutter source, website source, project
files, or security backup documentation (other than the Patch 2 audit note).
The current Vercel Production and Preview gateway credentials were replaced by
the new bucket-restricted token during Patch 2.

Cloudflare's token list does not provide enough evidence to prove that no
older external or local integration uses the remaining token. It therefore
stays active during this migration. It is restricted to `whitephoto-media`, so
it is materially safer than the former all-buckets token that was revoked.

## Staged migration plan

### Stage A — stop creating new permanent public references

- Store R2 object keys, not public or expiring URLs, in new student, media, and
  order records.
- Make every Flutter display/download consumer exchange the key through the
  authenticated gateway.
- Keep the existing database values readable through the current URL-to-key
  normalization helpers.

Local implementation completed on 2026-07-21:

- Flutter cloud sync writes object keys for new student portraits, project
  media, and school composite preview/thumbnail metadata.
- Flutter project restore exchanges stored keys for an authorized gateway URL.
- Flutter order thumbnails, preview viewer, packing-slip thumbnails, and print
  downloads resolve historical public/signed references through the secure
  gateway while retaining non-R2 URL compatibility.
- Website event album uploads, school/person uploads, school covers, mobile
  capture moves, and desktop media recovery now persist object keys.
- Website display helpers convert bare keys into the authenticated image proxy,
  so new records continue to render without requiring public R2 access.
- Existing URL-shaped rows remain readable; no database backfill was attempted.
- Flutter security tests: 5/5 pass.
- Website security tests: 17/17 pass.
- Full Flutter macOS release build: pass.
- Full Next.js production build: pass.
- Targeted website lint: zero errors (pre-existing warnings remain).

Stage A rollout verification:

- Preview deployment `dpl_4phLVcXE6KGZyt9iZ5DRcGFa2hmZ`: Ready.
- Preview homepage, parents page, and portal choices: HTTP 200.
- Preview R2 route without authentication: HTTP 401.
- Preview authenticated owned-media image proxy: HTTP 302 to a short-lived R2
  URL.
- The exact preview source was promoted to production.
- Production homepage, parents page, and portal choices: HTTP 200.
- Production R2 route without authentication: HTTP 401.
- Production authenticated owned-media image proxy: HTTP 302.
- Updated macOS app installed at `/Users/harout/Desktop/Studio OS.app`.
- Installed app restored its signed-in session, started cloud synchronization,
  recognized its schools, synchronized 126 cloud package rows, and showed no
  new errors.
- Pre-Stage-A installed app preserved at
  `/Users/harout/StudioOS_Security_Backups/App_Rollbacks/Studio OS Pre-Private-References 2026-07-22 0035.app`.

The immediate pre-Stage-A production deployment is
`dpl_4JncZwFBZ8zFqeqwQu4io7jSwpWT`. It remains available for website rollback.

### Stage B — secure Desktop digital delivery

- Preserve the current upload step through the authenticated gateway.
- Replace permanent/public delivery with an order-bound, recipient-bound,
  expiring server link.
- Test with a synthetic non-student order/file and a controlled recipient
  before using the new path for a client.

### Stage C — compatibility verification

- Test school gallery login, event gallery login, paid download, favorites ZIP,
  Desktop roster restore, order thumbnail display, full-resolution print-file
  preparation, and digital delivery using non-student test media.
- Verify all tests with public-URL fallbacks disabled in code while the bucket
  public URL remains available for immediate rollback.

### Stage D — disable public R2 access

- Take a fresh backup and record the Cloudflare setting before changing it.
- Disable only the `r2.dev` public access for `whitephoto-media`.
- Repeat the complete compatibility checklist immediately.
- Re-enable the public URL if any required workflow fails, then fix that single
  workflow before trying again.

### Stage E — retire legacy references and credentials

- Convert old database public/signed URL fields to bare object keys in small,
  counted batches with before/after exports.
- Monitor the new restricted gateway token.
- Revoke `studio-os-cloud-site-2026-04` only after no remaining consumer can be
  identified and all workflows pass without it.

## Decision

Do not disable R2 public access yet. The privacy risk is confirmed, but an
immediate switch would likely break Desktop thumbnails and may break the older
Digital Orders email path. The correct next action is Stage A, implemented and
tested locally without changing production data.
