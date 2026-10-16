# Private photo production pilot

This isolated Cloud pilot connects private photographer galleries to reviewed print-file preparation. It adds independent tables, private storage and routes; existing school galleries, original prices, legacy direct lab orders and the previous sample-only in-house rehearsal keep their existing workflows.

## Photographer and parent flow

- Photographer workspace: `/dashboard/labs/production`.
- Lab workspace: `/lab/production`.
- Private parent gallery: `/labs-pilot/production/[galleryId]` with an opaque access capability in the URL fragment.
- Private originals are JPEG or PNG files up to 4 MB. This first package requires gallery photos of at least 1600×2000 upright pixels; smaller diagnostic uploads stay private and cannot be selected for a production gallery. The server decodes the entire image, bounds image dimensions and records its original bytes and checksum. EXIF orientation is applied consistently to previews and crop coordinates.
- The first package contains one 8×10 Lustre and two 5×7 Lustre prints. Retail pricing comes from an eligible private copied price sheet. Fulfillment can be in-house or a lab whose approved catalog and enabled connection support both print sizes.
- Parent ordering selects one visible private photo and 1–10 package sets. Capability-based previews and receipts expose no source profile, private storage paths or another order’s files.
- Browser session storage retains private links and exact pending request IDs for safe retries. Parent receipts open only their submitted order. Galleries can be closed or their private links replaced.

## Separate production checks

Production preferences default to manual photographer approval, photographer crop responsibility and no lab colour correction. Preferences are shown before uploads; changes are saved for future galleries. Each gallery and resulting job freezes its policy, package and retail price.

Automatic photographer approval releases only that order-review step. It does not accept the job for the lab, approve any crop, perform colour changes or complete final review.

The receiving team accepts the job for review. Production preparation remains held until the required independent checks are complete:

1. Photographer approval, either explicit or from the job’s saved automatic-approval preference.
2. A manually positioned, fixed-aspect crop for each print size. The first editor uses upright-original coordinates and rotation zero, with bounded zoom and horizontal/vertical positioning. It displays retained resolution and blocks crops below 200 source pixels per printed inch.
3. The server generates and checksums each crop file. A person views and explicitly approves the saved crop for that size.
4. When requested, the receiving team downloads the cropped file and uploads an externally colour-corrected result with the same output pixel geometry. Alternatively, it explicitly acknowledges that colour was reviewed and no change was needed. This records a review without inventing a corrected upload.
5. The receiving team views and explicitly approves the current final file for each size.

A changed crop clears downstream colour and final reviews. A corrected file remains tied to its current crop identity. Original bytes are preserved. Viewer accounts cannot mutate jobs; photographer and lab actions follow server-computed permissions.

Partner-lab receiving displays the frozen wholesale product cost rather than the photographer’s retail selling price. The photographer’s view and parent receipt retain the retail amount. The UI labels the amount basis supplied by the server.

There is no paid AI service or automatic subject-framing approval. Technical sRGB conversion is separate from requested human colour correction. Pixel geometry checks do not replace a person’s framing and colour review.

## Paper files

After all required reviews, the private download endpoint prepares:

- One 2400×3000 JPEG for the 8×10 print.
- One 3000×2100 JPEG for a 10×7 paper sheet containing two copies of the approved 1500×2100 5×7 render side by side. Packing adds no new crop or resize to either approved cell.
- A JSON manifest recording job version, source/final checksums, review timestamps, quantities, paper-sheet counts, sRGB output profile and 300 ppi density.

Downloads recheck job version and file integrity. The pilot marks every job and manifest `testOnly: true`, `payment: test_no_payment` and `printAllowed: false`. Downloading files does not dispatch a printer job.

## Activation gaps

This pilot does not collect or verify real payments, calculate checkout tax or shipping, route jobs to a physical printer, activate GTA Imaging intake, or replace current school production. Real catalog contracts, lab billing and fulfillment acceptance, payment verification, agreed colour-management requirements and controlled printer integration still need explicit implementation and operational validation before live commercial production.

Automated tests and hosted browser acceptance are separate evidence. A passing local test or optimized build alone does not prove an uploaded customer file, a live payment, a physical print or an external lab’s acceptance.
