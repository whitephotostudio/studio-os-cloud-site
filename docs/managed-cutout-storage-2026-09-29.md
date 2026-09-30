# Managed cutout access and mask refinement

This candidate gates `nobg-photos/` objects on an active server receipt, the
photographer's namespace ownership, an original SHA-256 and the exact PNG
body SHA-256. Generic signed PUT, upload, copy and raw read operations cannot
grant access to that namespace. Uploading to a new folder requires the same
paid proof and a fresh server binding. Unknown legacy objects remain in R2 for
review; galleries, listings and backdrop composites omit them without deleting
or automatically billing them.

The direct upload route authenticates the photographer, verifies target
ownership, decodes a usable transparent PNG, computes its actual SHA-256,
checks the active proof before its canonical PUT, then links the object. The
original reference is mandatory for new uploads. Standalone reads of an exact
paid output can omit an unavailable original, but cannot silently substitute
a reencoded cloud JPEG for the full original source hash.

Managed image reads and composite inputs verify actual object bytes against
the server binding. New signed GET URLs last at most 300 seconds; managed
image redirects and generated thumbnails use private `no-store` responses.
Generic no-background thumbnail uploads cannot manufacture proof for a resized
image; the image proxy derives thumbnails from the verified canonical PNG.

An order with a selected backdrop cannot silently substitute its original
photo when no verified cutout is available. Delivery checks selected
composites before sending a ready email or success note and before opening
the parent's ZIP response. A missing paid/legacy proof returns review status;
the archive generator also aborts instead of generating a partial successful
delivery. Admin downloads return 409 and preserve the order for review/retry.
Print-ready labels require an actual successfully rendered composite.

Large images use private staging to avoid [Vercel's 4.5 MB function request
limit](https://vercel.com/docs/functions/limitations). `POST /api/credits/cutout-staging` authenticates MFA and a photographer
profile, rate limits requests, and issues a fresh random
`credit-staging/{auth.uid}/{uuid}.png` PUT lasting 120 seconds. The signature
binds the declared actual Content-Length and Content-Type; the client cannot
choose a canonical target or use the stage as a gallery image. Files are
limited to 25 MiB. Generic GET/signing/upload/copy/use of staging is denied.
Finalization accepts a same-account stage, downloads bounded actual bytes,
performs the normal proof and image checks, and deletes the private stage only
after canonical binding succeeds. A stale PUT can recreate only an unentitled
private stage. Abandoned stages may require a bucket lifecycle rule for cleanup.

`POST /api/credits/cutout-revision` accepts the paid previous PNG and the new
PNG. It hashes both actual files, verifies active previous proof, checks usable
alpha and dimensions, then compares decoded RGB exactly while discarding only
alpha. Hidden pixels are compared too; flattening is never used. The
service-only revision RPC rechecks proof under the wallet lock. This allows a
free mask refinement, while another portrait or Photoshop RGB edit needs its
own processing receipt. Multipart files are limited to 3 MiB each and 4 MiB
together; private JSON staging supports up to 25 MiB per file. Image decoding
is capped at 64 megapixels.

Native Restore can optionally include the actual original file. Its full
SHA-256 must equal the nonnull paid source reference. After EXIF rotation, its
dimensions must match the cutout, and every RGB channel of both the paid
previous image and the new image must match the actual original within four
levels for JPEG decoder rounding. An asserted original hash alone cannot
establish this relationship. Only its alpha mask is editable. A different
original, resized/normalized original, provider RGB cleanup beyond this
tolerance, unknown hash or unsupported RAW decode is refused with the working
files preserved for review.
Photoshop refinement uses the strict previous-RGB mode unless explicitly
verified against the actual paid original.

Release requires the paid-cutout security epoch migration and its service-only
RPC grants. Older client-writable local usage rows cannot become proof. Legacy
assets therefore need a review/migration policy; neither a PNG filename nor an
old local metadata flag is payment evidence. The new proof tables begin empty,
so existing active parent galleries and selected-backdrop orders must be
inventoried and resolved before strict production enforcement. Unknown cutouts
being omitted is a real compatibility change, not successful migration.

The legacy parent client listed/probed public Supabase `nobg-photos` URLs when
the server-approved map was empty. This candidate removes that fallback; only
server-authorized, actually loadable cutouts can enable background selection.
Saved cart selections must be checked again before order creation rather than
silently stripped or sold with a background that cannot render. The legacy
Supabase bucket was confirmed public in a read-only production check; removing
the application fallback does not revoke URLs already accessible outside the
application. No bucket privacy setting has been changed.

Parent checkout refreshes each selected gallery's server context and preserves
the basket when a chosen background is unavailable. Single and combined order
creation also perform a server preflight before the first order write or Stripe
request. Every retained background pose, including a normal digital or all-photo
package, must resolve to its authoritative gallery photo and usable bound PNG.
Original-background products and explicit retouch-only lines do not require an
unrelated cutout. The read-time preflight cannot guarantee that a file stays
available forever; delivery still rechecks proof and bytes before rendering.

Stored-order Stripe checkout repeats the check before Connect calls, session
reuse or checkout state writes. It refreshes full saved rows and complete group
membership under the existing payment lock; caller mode/gallery overrides do
not replace saved scope. Legacy background markers without exact saved choices
stay in review. All-gallery fulfillment claims require an owned authoritative
paid all-digital package, rather than a browser filename or slot label.

Mixed print/digital delivery keeps each item's selected background. A print or
individual digital backdrop cannot be applied to original-background all-digital
files. An all-digital backdrop is retained even when its snapshot has no chosen
single pose; individual digital background choices also survive a mixed cart.
Multiple purchased all-digital versions retain their separate backgrounds and
blur settings; only identical choices are deduplicated.

Event fulfillment has a separate scope blocker: the existing all-digital
delivery loader queries the whole project, while PIN access can authorize one
collection. Existing saved snapshots do not preserve an authoritative purchased
collection scope. A background preflight does not repair that delivery mismatch,
and a caller's current PIN cannot rewrite the scope of an older purchase. Event
all-gallery fulfillment needs its own reviewed scope preservation/recovery
before this candidate can be promoted. No new event background feature or
project-wide legacy authorization is inferred by this change.

A reviewed legacy preservation design must bind exact ownership, authoritative
gallery/student/source references, storage backend/key and verified full bytes.
Use private immutable exact-byte copies for approved existing uses and preserve
originals. Legacy approval must not mint credits, reuse pre-security receipts,
satisfy new-upload/revision entitlement checks or authorize new photo work.
Missing sources, ambiguous ownership and changed bytes stay in review. No
legacy import tool, grant or reprocessing has been applied.

Stop old canonical signed PUT issuance and drain its full 15-minute TTL before
enabling trusted bindings. Already-issued GET URLs and cached images cannot be
revoked retroactively; prior one-hour/six-hour grants must expire or be handled
by a separate owner-approved key rotation. Without the PUT drain, a previously
signed write could replace a canonical object after its hash was checked and
before a client downloads it. New staged PUTs cannot change canonical objects.

The proof establishes payment for a full original/output pair and exact output
bytes. Filename placement alone does not prove that remote reencoded original
bytes are the identical desktop original. No source-hash alias is invented.
Semantic background changes inside arbitrary opaque JPG retouching cannot be
reliably identified from a file extension; the transparent managed workflow is
enforced. This candidate has not been deployed or migrated to production.

Behavioral coverage: `tests/security/managed-cutout-storage.test.mjs`,
`tests/cutout-revision-route.test.mjs`, and
`tests/credit-lifecycle-integration.test.mjs`. These use actual image decoding
and production handlers with isolated transport/database fixtures; they do
not establish real R2 round trips, bucket configuration, native Photoshop UI
execution, production deployment or external payment settlement.
