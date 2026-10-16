# Independent print slots: pilot workflow v2

V2 is a separate ledger and route family. The applied `20261016050000`
migration and all v1 job snapshots, reviews, files and parent receipts remain
unchanged. It reuses frozen private galleries and immutable originals, and
adds only `lab_production_v2_jobs`, `lab_production_v2_assets` and
`lab_production_v2_events`. Derived files use the separate private
`lab-production-v2-files` bucket.

## Package and photo selection

The supported package has three independently editable slots:

| Slot ID | Print | Copies per package set |
| --- | --- | --- |
| `8x10` | 8×10 | 1 |
| `5x7-a` | First 5×7 | 1 |
| `5x7-b` | Second 5×7 | 1 |

A parent chooses a public gallery photo ID for each slot. Choices may be the
same or different. Quantity 1–10 repeats that configured three-slot set; it
does not create ten independently designed layouts. The server freezes the
gallery's price, currency, target lab and approval policy. No tax, shipping,
payment or commission is charged in this rehearsal.

Every slot has its own current original, crop rectangle, immutable crop render,
crop approval, optional colour file/review and final approval. Cropping one
5×7 does not change the other. Packing places the two independently approved
5×7 files side by side on a 3000×2100, 300 ppi 10×7 sheet. Each 5×7 remains
1500×2100 pixels; packing does not crop or resize those cells.

## Editing, reopening and reprinting

While a job is submitted or accepted with idle dispatch, the assigned cropper
may save and approve each slot's crop. Only the photographer can replace a
slot's source photo with another photo from the same frozen gallery; lab crop
responsibility does not grant permission to change the parent's photo choice.
Replacing a source or crop clears that slot's crop approval, colour completion
and final review. Other slots and commercial approval remain unchanged.

Colour work is performed with the lab's own editing software, then uploaded
against the exact current approved crop ID. A corrected file must preserve its
geometry. Explicitly reviewing a crop and deciding that no colour change is
needed is a distinct recorded action. Either outcome requires final review.
There are no paid AI calls in this workflow.

The receiver can reopen an in-production or ready job only while its recorded
dispatch state is `idle`. Reopening requires a reason and expected version,
returns the job to accepted, and clears all final approvals. Subsequent edits
clear the affected slot's additional reviews. All final files must be reviewed
again before production preparation. The guard reflects recorded system
dispatch; it cannot establish whether someone printed a manually downloaded
file outside Studio OS.

A claimed or handed-off dispatch cannot be silently reopened. A ready, completed or sealed job
can instead produce a new linked **full-package reprint** with a reason and
new receipt capability. The original job and any existing sealed dispatch remain unchanged; creating
a reprint does not cancel an original dispatch. The new job keeps
the configured photos, quantity, frozen price and policy but starts submitted
without crop, colour or final approvals. Manual commercial approval must be
given again; an automatic approval policy releases only that commercial step.
Partial-package reprints and a shared image-adjustment editor are outside this
bounded version.

## Capabilities and privacy

Gallery capabilities use the existing seven-day private link rules. V2 receipt
capabilities last thirty days independently of later gallery revocation. Only
SHA-256 capability hashes are stored. Parent receipts expose current public
slot/photo references and filenames, never original registry IDs, storage keys,
owner IDs or private price source data.

Photographer views retain retail pricing. Partner-lab views receive a generic
package label and frozen wholesale amounts. Direct job-table reads remain
owner-only; lab access uses the MFA-protected projected API. Derived-file and
event RLS checks current membership and MFA. Every mutation independently
checks ownership, responsibilities, immutable file identity and expected
version. Exact retained requests replay safely; changed payloads with reused
request IDs fail with 409.

Every new job remains `testOnly: true`, `payment: "test_no_payment"` and
`printAllowed: false`. The dispatcher may seal reviewed files and record a
test handoff, but cannot authorize physical printing. GTA Imaging remains
unavailable for real intake until its catalog and fulfillment setup are
confirmed.

## API contracts

* `/api/dashboard/lab-production-v2`: photographer workspace, gallery/default
  management, slot work, controlled reopen and linked full-package reprint.
* `/api/lab/production-v2`: MFA-protected receiving workspace and assigned work.
* `/api/labs-pilot/production-v2`: private gallery/photo/submit/receipt actions.
* `/api/dashboard/lab-production-v2-assets`: authenticated previews, immutable
  file reads and corrected-file uploads. Original uploads continue through the
  existing checked original uploader.
* `/api/dashboard/lab-production-v2-files`: final individual files, composed
  sheets and their integrity manifest.

Parent submit uses `selections: {"8x10": photoId, "5x7-a": photoId,
"5x7-b": photoId}`, a package quantity, retained request ID and independently
generated receipt token. Work actions name `slotId`, not just product size.
Corrected uploads name the exact `sourceAssetId` crop revision. The internal
registry documents are produced only by the server after decoding and hashing
actual bytes; browsers cannot submit trusted file metadata or prices.

Dispatch claims must atomically lock the same v2 job row, verify its version,
in-production state and empty holds, then move dispatch from idle to claimed.
This serializes claims against reopen, source replacement and crop edits.
