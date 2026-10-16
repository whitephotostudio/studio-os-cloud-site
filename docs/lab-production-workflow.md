# Pilot production workflow

This is an additive private rehearsal ledger. It does not change the existing
school packages, copied price sheets, direct lab orders, or fixed-photo in-house
test orders. The feature is available only when `isLabPilot()` confirms the
dedicated pilot Supabase project. Every job permanently records
`testOnly: true`, `payment: "test_no_payment"`, and `printAllowed: false`.

## Current scope

One package contains one 8×10 Lustre print and two 5×7 Lustre prints, using one
selected original per package set. Quantity is 1–10 sets. Gallery publication
requires each original to be at least 1600×2000 EXIF-upright pixels so both
print crops are achievable at the required retained detail. A photographer creates
a private gallery from an active, exact matching package in their copied price
sheet and 1–20 registered original JPEG/PNG files. The source price sheet and
its retail price are frozen; editing defaults or prices later does not rewrite
an existing gallery or job. The package's currency and integer minor units are
preserved; no tax, shipping, payment, currency conversion or commission is
collected here.

In-house work is received by the owning photographer. Partner-lab work requires
an active, intake-enabled lab with a verified catalog, matching currency, and
two confirmed single-print catalog products with the exact sizes and finish.
GTA Imaging remains in setup with intake disabled until its catalog and
fulfillment arrangements are confirmed.

## Independent decisions

The saved defaults are manual photographer approval, photographer cropping,
and no lab colour correction. Each new gallery freezes these settings:

* `autoApprove` releases only the photographer's commercial review. It does
  not accept an order for the lab or approve a suggested crop.
* `cropResponsibility` assigns saving and approving each exact-size crop to
  the photographer or receiving lab.
* `labColourCorrection` adds a separate review after the exact crop is
  approved. The lab either uploads a corrected file with unchanged geometry
  or explicitly records that it reviewed the crop and no colour change is
  needed. The latter has its own `reviewed_no_colour_change` audit event.

The receiver may accept a submitted job while holds remain. Starting
production requires photographer approval, both crop approvals, any requested
colour work, and final review of each current final file. Stages are
`submitted → accepted → in_production → ready → completed`. Completing this
rehearsal never authorizes a physical printer.

## Files and crop evidence

Original bytes remain immutable in a private bucket. Registry rows contain
their SHA-256 hash, byte length, decoded EXIF-upright dimensions and a fixed
owner/asset storage key. Original and corrected uploads are bounded to 4 MB,
16–16,000 pixels per side, one JPEG/PNG image and at most 100 megapixels.

Crop rectangles use integer pixels in the EXIF-upright original. The server
extracts that rectangle, applies its explicit quarter-turn rotation, checks
the print aspect within 0.2%, and requires at least 200 retained pixels per
printed inch. It renders an sRGB 300 ppi JPEG at 2400×3000 for 8×10 or
1500×2100 for 5×7. A saved suggestion is unapproved until the assigned actor
approves the exact immutable render ID.

Saving a replacement crop clears that size's crop approval, colour completion
and final review. Commercial photographer approval is independent and remains
recorded. Corrected uploads must name the crop that was actually reviewed;
the server and database reject a stale revision. Colour completion clears
final review, which must then name the current crop or corrected asset.
Audit events retain the actor, action, version and exact asset reference;
asset hashes and metadata cannot be rewritten.

Paper downloads require every hold to be resolved. The output is one 8×10
file plus a 10×7 sheet containing the two approved 5×7 prints side by side,
with no additional cropping or resizing at packing time. The manifest records
the source/crop/final hashes, approval times, file hashes, 300 ppi dimensions,
copy count and `printAllowed: false`. It checks job version again before
returning the bundle.

## Private links and mutation safety

Gallery and receipt capabilities are 32 random bytes encoded as 64 lowercase
hex characters. Browser links retain gallery capabilities in the URL fragment;
API requests carry them in JSON bodies. Only SHA-256 hashes are stored.
Gallery links expire after 7 days and can be rotated or revoked. Receipt
capabilities last 30 days and can track an existing order independently of
later gallery revocation. Partner lab APIs show the frozen wholesale package amount and a generic
production package name; owner and parent views keep retail pricing. Direct
authenticated job-table reads are owner-only because that immutable agreement
contains private retail/source data. Authorized MFA-protected lab users read
their files and projected receiving API instead.

Public responses exclude the original registry ID,
storage key, owner identity, source price-sheet IDs and private source data.
Public photo IDs and offer IDs are generated independently.

Mutations use row locks, expected versions and immutable request payloads.
An exact retry returns the existing result; reusing a request ID with changed
details or using a stale version fails with 409. Crop object IDs and bytes are
deterministic for a retained request, so a lost response can be retried safely.
There are bounded limits of 30 galleries per owner, 20 jobs per gallery and
2000 immutable registry files per owner.

Authenticated APIs reuse studio account checks, required MFA and fail-closed
rate limiting; lab membership alone is insufficient without MFA. Anonymous
parent APIs require the private capability, trusted-origin checks and
fail-closed rate limiting. Responses and previews use private no-store,
no-referrer and no-index headers. Direct authenticated table writes and
anonymous RPC execution are denied. Service-only RPCs enforce independent
ownership, membership, catalog, crop and review constraints.

## API and database surfaces

* `/api/dashboard/lab-production`: owner workspace and policy/gallery/job actions.
* `/api/lab/production`: MFA-protected receiving workspace and assigned actions.
* `/api/labs-pilot/production`: capability-only gallery, photo, submit and receipt.
* `/api/dashboard/lab-production-assets`: checked original/corrected uploads and
  authenticated private file/preview reads.
* `/api/dashboard/lab-production-files`: checked manifest and rehearsal paper files.

The new tables are `lab_production_policies`, `lab_production_assets`,
`lab_production_galleries`, `lab_production_jobs` and `lab_production_events`.
Their migration adds no rows to historical price, school, partner-order or
earlier in-house-test tables and alters none of their functions.

No AI, printer driver, production hot folder, third-party lab submission,
payment processor or paid image service is called by this workflow. Lab colour
editing is an explicit human task performed with the lab's own editing tools.
