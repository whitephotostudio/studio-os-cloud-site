# Paid cutout enforcement and retired personal background provider

This change is prepared on PR8 and the isolated Mac source candidate. Production,
the installed app and production database are not updated by this implementation.
The matching signed Mac candidate is rebuilt and verified separately below;
public notarization and coordinated production rollout remain pending.

## Photographer behavior

Premium Cloud uses the owner-controlled server Photoroom key and four Studio OS
credits per photo. The app no longer asks for a personal Photoroom key or its
on/off toggle. Stored personal Photoroom credentials are retired while skin
retouch/assistant credentials and Photoshop action configuration are preserved.
Local Photoshop removal reserves one credit per photo; the server owner exception
is available only from a verified owner receipt. Ordinary custom actions return
opaque genuine JPGs and remain free. Sandbox Photoroom keys cannot sell watermarked
results for credits.

## Durable paid access

`20260930120000_paid_cutout_entitlements.sql` binds a full original-file SHA256 and
an initial cutout-file SHA256 to an immutable owned reservation. Each charged
local credit authorizes one distinct original and one initial output. Server
cloud completion binds its saved output and original before marking success.
Replays do not grant new outputs or consume additional credits. Successful claimed
local slots cannot be refunded as failed work. Valid files awaiting server proof
stay preserved and reserved rather than being refunded/recharged on Resume.

Private tables, server-only object linking and service-only cloud completion
prevent client-created manifests, filenames, owner flags or direct ledger writes
from granting access. Existing paid access survives expiry of unused credits;
refunded-spend debt blocks access until repaid. Unknown/pre-security local receipts
are not automatically grandfathered. Existing files are retained for review.

Desktop preview, refinement, Photoshop round trip, composite and Orders paths use
the same server check. Frozen verified image bytes prevent a replacement after the
check from being drawn. Cloud cutout upload verifies actual PNG bytes and owned
resource paths before server PUT and linking. Generic `nobg-photos` signed PUT,
copy and unverified GET/signing are denied. Web lists/composites/delivery verify
stored bytes against the paid binding before returning them. Generic staging URLs
cannot be used for previews, galleries or another account's cutouts.

## Free mask refinement

Authenticated clients cannot add arbitrary new hashes as paid revisions. The
server verifies actual previous PNG bytes against paid access and the new PNG's
usable alpha, dimensions and decoded RGB. With no source provided, all RGB pixels,
including hidden pixels, must match exactly. Native Restore may supply the actual
paid original: its full SHA must match and rotated decoded source dimensions must
match the result. Both the previous paid result and new result must match the
actual original's RGB within four levels per channel, accommodating JPEG decoder
rounding. A client-supplied original hash alone cannot prove that an earlier output
belongs to that photo. Different provider RGB, alignment or resizing retains a
pending edit for review rather than authorizing a different photograph.
The service-only revision grant rechecks active access before committing.

Large files use fresh private `credit-staging/<account>/<uuid>.png` uploads and
small JSON requests for server verification/promotion. Staging never grants paid
access. Canonical cutout keys receive only server-verified bytes. The 25MiB staged
image and 64MP decode bounds remain explicit. Temporary objects are removed after
successful promotion; expired uploads cannot overwrite a canonical paid image.
This avoids the [Vercel function 4.5MB request limit](https://vercel.com/docs/functions/limitations).

## Release and practical limits

Identical bytes keep proof after a rename or move. An original reencoded by cloud
sync has a different full hash; the candidate fails closed rather than silently
aliasing a different photo. A genuinely missing source can use the exact owned
paid output proof. Validate cross-device source preservation before release.

A photographer can control Photoshop outside Studio OS. A flattened JPG with a
changed background carries no transparency, so its editing history cannot be
reliably inferred. The app can reject unverified transparent managed output and
protect paid processing/delivery, but cannot prove that an unrestricted Photoshop
action did only skin smoothing.

The compatible notarized Mac build, all five migrations, exact platform Stripe
webhook events and strict release guards must be coordinated. Production signed-in
credit purchase/fulfillment, full Photoshop execution and owner fee invoicing are
separate verification steps; mocked/local integration passing is not evidence
that a real platform checkout or invoice has succeeded. No real customer charge,
refund, email or production schema change is part of these automated tests.

## Current validation

The matching universal Mac 0.1.14+18 archive passes strict deep Developer ID
verification. Its review ZIP SHA256 is
`d5ce122554a99f9d152cd0aaf323d6c913471a9edcfc8d02a23a324eff27dcb8`.
The source passes 912 Flutter tests (one platform skip), whole-lib direct Dart
analysis and 55 primary-checkout focused tests. The five-file live-schema dry run
passed and was rolled back; isolated actual-role SQL tests cover receipt capacity,
refund races, monthly expiry/debt, cross-account proof and private RPC grants.
The old source and ZIP are retained as superseded. Notarization, public download
publication, production promotion and signed-in/native processing remain pending.

The website passes 536 tests, TypeScript, a production build and changed-file
ESLint with zero errors/warnings. `verify-r2-staging-preview.mjs` is disabled by
default, requires an explicit Preview-only flag and the exact audited Git branch,
and uses three fresh private objects to test signed type/size rejection, bounded
full-byte readback and cleanup. It uses no database, customer account, provider
image or Stripe API. Actual Preview `dpl_EETTox2YEtvPEsAjCsdfNQPrddzA` (commit `b565c2e`) is READY:
the 100-byte real alpha PNG PUT returned 200 and full SHA256 readback matched;
wrong Content-Type and Content-Length returned 403 with no objects created.
All three test objects were deleted and confirmed absent. The opt-in flag was
removed after this check; future builds make no diagnostic storage requests.
Unauthenticated `/credits` returns 200, and background-removal, staging and
revision POSTs return 401. Production remains on restored `011bf81`; its credit
page/gateway are still 404 until the coordinated rollout.
