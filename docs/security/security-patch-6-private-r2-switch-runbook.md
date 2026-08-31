# Security Patch 6 — Private R2 Switch Runbook

Date: July 22, 2026 (EDT)

## Final outcome

Private R2 mode was completed successfully on July 22, 2026 at approximately 4:17 PM EDT.

- Cloudflare R2 bucket `whitephoto-media` now has its Public Development URL **Disabled**.
- A known direct public object request returns HTTP 401 instead of image bytes.
- Owned project, school, and no-background objects return signed bytes through the authenticated gateway: sign HTTP 200 and byte HTTP 206.
- Parent gallery response: HTTP 200, 17 signed R2 references, zero public R2 references, zero bare media keys, signed byte HTTP 206.
- Historical order response: HTTP 200, order returned, 6 signed R2 references, zero public R2 references, zero bare media keys, signed byte HTTP 206.
- A real read-only composite render returns HTTP 200 `image/jpeg`.
- Anonymous image-proxy access returns HTTP 401.
- A generic attempt to proxy a Public Development URL returns HTTP 403.
- `/`, `/book`, `/parents`, and `/api/portal/choices` return HTTP 200.
- All 3 booking events remain enabled. The public booking-availability function returns HTTP 200 and reports open/taken slots normally.
- The installed Studio OS Desktop process remains running, and its authenticated project, school, and no-background storage paths all pass the production gateway checks.
- No appointment, order, payment, email, booking, database row, or R2 object was created, changed, or deleted by the post-switch tests.

## Pre-switch safety status

This document records the final private-bucket switch and its rollback procedure.

At the time this pre-switch runbook was created:

- Cloudflare R2 bucket `whitephoto-media` is 94.2 GB.
- Public Access is **Enabled**.
- The Public Development URL is enabled.
- No Cloudflare setting has been changed during the readiness inspection.
- No booking, student, order, media, photo, or payment record was changed during the readiness tests.
- No real customer email was sent.

## Current deployments

Current tested production:

- Deployment: `dpl_2puo3FCtBHdPTSM6ckoREq4fa5M7`
- URL: `https://studio-os-cloud-site-bbs9ayfbp-whitephotostudio-7289s-projects.vercel.app`
- Primary alias: `https://www.studiooscloud.com`

Final tested preview that was promoted:

- Deployment: `dpl_F52keubhbiogRWp9RgJvFfciZmNb`
- URL: `https://studio-os-cloud-site-rnz3xum84-whitephotostudio-7289s-projects.vercel.app`

Immediate website rollback:

- Deployment: `dpl_797d1h9QmWMgU1mHFoKMSr4hwcW4`
- URL: `https://studio-os-cloud-site-ez2t8uh3t-whitephotostudio-7289s-projects.vercel.app`

## Readiness changes

- New R2 uploads store durable object keys rather than permanent public URLs.
- Dashboard reads use the authenticated, ownership-checked image gateway.
- Parent gallery responses and historical order responses replace eligible private-media references with short-lived signed URLs.
- New order snapshots canonicalize selected images, slots, digital selections, backdrops, and item image references to durable keys.
- Gallery-context and school-access responses sign eligible student photo references.
- Email gallery cover images use time-limited signed URLs.
- Composite generation reads R2 directly with server credentials and no longer falls back to a public R2 URL.
- Missing R2 signing configuration now fails closed instead of returning a public URL.
- Desktop R2 reads and recovery paths use the secure gateway and no longer fall back to the Public Development URL.

## Pre-switch verification already passed

- Website security tests: 27/27 passed.
- Full Next.js production build: passed; all 76 pages generated.
- Flutter security tests: 9/9 passed.
- Flutter macOS release build: passed.
- Deep code-signature verification of the new build: passed.
- Preview and production public pages: HTTP 200.
- Preview and production anonymous image-proxy request: HTTP 401.
- Real read-only school gallery response: HTTP 200, 17 signed R2 references, zero public R2 references.
- Exact read-only historical order response: returned correctly, 3 signed R2 references, zero public or bare media references.
- A second historical order exposed one legacy public photo URL embedded in `specialNotes`. The first private-mode attempt was immediately rolled back, and the narrow fix now signs embedded historical note links without rewriting the database.
- The exact second historical order now returns 6 signed R2 references, zero public R2 references, and zero bare keys in both preview and production; a signed byte request returns HTTP 206.
- Real authenticated project and school R2 object byte checks passed through the secure gateway.
- Existing database rows were not rewritten.

## Cloudflare switch procedure

1. Open Cloudflare Dashboard for Harout's account.
2. Open **R2 Object Storage**.
3. Open bucket **whitephoto-media**.
4. Open the **Settings** tab.
5. Find **Public Development URL**.
6. Confirm the page currently shows the public URL and a **Disable** button.
7. Select **Disable**.
8. In **Disable Public Development URL?**, type `disallow`.
9. Select **Disallow**.
10. Immediately run the post-switch checks below.

## Immediate re-enable procedure

If any active workflow check fails:

1. Stay on Cloudflare Dashboard → R2 Object Storage → `whitephoto-media` → Settings.
2. Find **Public Development URL**.
3. Select **Enable**.
4. Complete Cloudflare's confirmation if one is shown.
5. Confirm the bucket overview shows **Public Access: Enabled**.
6. Re-run one known direct Public Development URL byte request and confirm it returns content.
7. Keep production on the current deployment while the failed private path is diagnosed.

Do not rewrite database media references during this rollback.

## Post-switch verification matrix

Run these read-only checks immediately after disabling the Public Development URL:

1. A known direct public R2 object must no longer return image bytes.
2. `/`, `/parents`, and `/api/portal/choices` must return HTTP 200.
3. An anonymous image-proxy request must return HTTP 401.
4. A generic public-R2 portal download attempt must return HTTP 403.
5. A real authenticated owned project object must return proxy HTTP 302 and signed-object byte HTTP 206.
6. A real authenticated owned school object must return proxy HTTP 302 and signed-object byte HTTP 206.
7. A real authorized no-background object must return proxy HTTP 302 and signed-object byte HTTP 206 when an existing object is available.
8. A read-only school gallery response must contain zero public R2 references, and one returned signed image must serve bytes.
9. A read-only historical order response must contain zero public or bare R2 references, and one returned signed image must serve bytes.
10. The installed Desktop app must open normally and load existing cloud media through the secure gateway.

Do not create a test order, charge a payment, send a real email, upload or delete a photo, or change a booking during these checks.

## Abort conditions

Immediately re-enable the Public Development URL if any of these occur:

- the dashboard cannot load an owned school/project image;
- the parent gallery cannot load an authorized image;
- historical order images cannot be retrieved;
- the Desktop app cannot read owned R2 media through the gateway; or
- the gateway returns an unexpected authorization failure for a known owned object.

Public access should be restored first. Diagnosis comes after the student workflow is protected.

## Website rollback procedure

If the new website deployment itself causes a regression independent of the bucket switch:

1. Re-enable the Cloudflare Public Development URL first if it is disabled.
2. Promote Vercel deployment `dpl_797d1h9QmWMgU1mHFoKMSr4hwcW4`.
3. Verify `/`, `/parents`, and `/api/portal/choices` return HTTP 200.
4. Sign in and verify one owned school image and one owned project image.
5. Do not rewrite database media references.

## Desktop app decision

The newly built Desktop app removes the final harmless public-R2 fallback, but the currently installed app already tries the authenticated secure gateway first. To minimize operational risk, the installed app is not replaced before the bucket switch. If the gateway works after the switch, the public fallback is unreachable and simply fails closed because the bucket is private.

The new app may be installed later under a separate rollback checkpoint after the live private-mode checks pass.

## Manual scripts not approved for private mode

Do not run these older maintenance scripts after the private switch until they receive their own hardening review:

- `scripts/migrate-to-r2*`
- `scripts/reupload-gallery-originals*`
- `scripts/compress-old-photos*`

They are offline/manual maintenance tools and are not part of the active website or Desktop runtime.
