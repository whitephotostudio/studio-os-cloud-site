# Custom Photoshop actions and credit enforcement

## Owner-selected behavior

Keep photographer-created actions available without credits for retouching,
skin smoothing and other ordinary edits. Their Studio OS return format is JPG.
Do not charge every custom action. Transparent cutouts and managed background
removal must remain behind the credit system.

These changes are prepared in the desktop source. They are not deployed,
installed or published, and the previously archived Mac candidate needs to be
rebuilt before publication.

## Confirmed bypasses

`PhotoshopActionService.runAction` accepted an arbitrary named Photoshop action
and returned PNGs with transparency without a credit check. Develop and Project
Sorter both call that shared service. The background-removal tool itself
reserves credits, but the generic custom-action runner did not.

Limiting a filename or an output dropdown is insufficient: old preferences or
a renamed PNG can bypass that restriction. An arbitrary action can also save a
PNG elsewhere, or remove/replace a background and flatten its result into JPG.
Therefore a JPG-only policy is a useful output restriction, not proof that an
arbitrary action performed only skin retouching.

Managed cutout discovery currently accepts matching local files without proving
payment in backdrop composition, AI preview/application/refinement, Orders
cutout indexing and cloud upload. These import/use routes remain a separate
release blocker for a strict no-cutout-bypass claim.

## Prepared protections

The desktop custom-action service returns genuine JPG results, including when
legacy saved settings request PNG. Photoshop first saves an alpha-preserving
preview in the private work directory; Studio OS decodes it and rejects even
one transparent pixel before promoting any JPG into the photo versions folder.
The preview and staged JPG are removed on rejection or completion. This catches
ordinary transparent background-removal results without silently flattening
them into white JPGs. Deliberate action-side flattening remains undetectable.
The assignment dialog advertises JPG only;
existing custom-action PNG/TIFF/WebP versions are no longer automatically
attached. Discovery checks file bytes as well as extensions. A retouch version
no longer automatically satisfies the background-removal filter.

Recovery now verifies that the manifest's complete photo scope and job identity
regenerate the exact immutable server reservation reference. It verifies the
reserved amount and caps trusted completed photos by the remaining paid amount.
Changing a manifest's photo fingerprints or job identity, or supplying an output
after a full processing refund, cannot turn another receipt into free processing.
Owner zero-cost reservations and legitimate interrupted/completed jobs remain
supported. Nine behavioral recovery regressions passed.

Combined focused verification passed 57 tests across the new output policy,
receipt-bound recovery, credit RPCs, background removal, manual Photoshop
refinement, stale cutout protection and order retouching. Targeted Dart analysis
was clean. A final preparation-cleanup regression also passed. The final full
Flutter suite passed 824 tests with one platform skip, and direct machine-format
analysis of all `lib` files returned zero diagnostics. Tests substitute Photoshop
execution with fixtures while running the
production result validation and file promotion/cleanup; actual Adobe execution
and signed-in UI have not been verified for this change. No real Photoshop
action, charge, refund, schema migration or production release was performed.

## Remaining design requirement

Use one account-scoped paid-photo entitlement check for every managed cutout
entry point, with corresponding authorization at cloud upload. A local filename,
mutable metadata or a local manifest alone must not authorize a new cutout.
Bind entitlement to durable photo content/origin and the original credit receipt,
so moving a photo or syncing it to another computer does not lose paid access.
Manual mask refinement should retain the original entitlement.

Existing local job fingerprints include path and modification time. Using those
alone as a global import gate would incorrectly block legitimate cross-device
photos and older cutouts. Existing assets need a reviewed migration policy;
do not silently delete them or charge them again.

Even with managed-cutout imports protected, an arbitrary action running in the
photographer's own Photoshop can produce a flattened background change. A strict
guarantee about the action's operations requires a controlled, validated editing
command set rather than unrestricted execution by action name. Photoshop use
outside Studio OS remains under the photographer's control.
