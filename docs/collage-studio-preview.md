# Studio OS Collages: connected preview

The original design preview from `ea20697` is preserved and extended. This branch
now contains the Cloud template library, parent photo selection, validated order
snapshots and original-photo production rendering. The active Flutter V2 source
contains the native editor, private Cloud draft controls and verified collage
print preparation. Nothing has been deployed, migrated in production or merged.

## Photographer setup

Use `/dashboard/collages` to start from the raised-centre three-photo landscape
or overlapping-inset graduation design, or import a portable template. Adjust
trim dimensions, optional bleed, safe inset, openings, borders, colours and the
three caption lines. Clean PNG/JPEG artwork can supply logos and decorative
borders. A photographed finished collage is a reference; uploading it does not
remove existing portraits or infer editable cutouts.

Save an owned immutable private version, or make a new version available to
selected school/project galleries. Package Contents in `/dashboard/packages`
can connect one print item to that version while retaining the package's price
and ordinary print items. Each included collage copy gets its own photo choices.
Withdrawing a version removes current gallery access without changing paid
orders; republishing requires a new version. Shared price sheets only show
collage products whose templates are actually allowed in the current gallery.
Artwork is fetched only for the selected design, rather than downloading every
large overlay when opening a gallery.

The native Collages section sits beside school Composites and is also available
for projects. It saves owner-scoped immutable local versions, imports/exports
Cloud's v1 design JSON, previews original local test photos with independent
crops, exports print-sized PNG previews and explicitly saves/opens private
Cloud drafts. Gallery availability and sellable package pricing are managed in
Cloud. Class composites retain their independent model and production behavior.

## Parent shopping and restoration

The existing `buildSlots` still expands quantities into physical prints. A
collage is **one** of those slots with nested opening selections. Ordinary prints
remain ordinary slots. Multiple collage copies can use different photos/crops,
and a photo can be reused across openings.

Parents select only from their authorized gallery media, crop closer, edit
permitted captions and review a bounded preview from the original-photo
production renderer. It reports actual cropped source resolution, with a clear
warning below 200 ppi and an advisory below 300 ppi. Crop/caption changes require
review again. Saved baskets include full-sized collage reviews and an edit
control for the current gallery.

Single-gallery and sibling carts retain nested IDs/crops. Event collage baskets
are isolated by studio and cookie-bound gallery lane. Reorders keep an older
version only while still granted and compatible with the current product's
template and trim size; every photo and current price is revalidated. Missing,
withdrawn or changed configuration fails visibly rather than becoming an
ordinary portrait print.

## Server and production guarantees

- Private, photographer-owned templates and content-addressed artwork; versions
  are append-only. Gallery grants support one-way withdrawal.
- Server validation of version/gallery ownership, required openings, crop bounds,
  independent copy counts, product roles/output size and current package price.
  Browser image URLs, uploaded snapshots and prices do not establish authority.
- One immutable `order_items.collage_snapshot` per finished print/copy, with
  authorized original media keys, crops, captions, design/artwork hashes and
  version identity. A collage has no ordinary source-photo SKU.
- Parent final previews and production use the same renderer and geometry,
  including upright EXIF orientation, cover crops, layering, text fitting,
  trim/bleed, artwork and borders. Screen previews rasterize at bounded size;
  design-editor canvases use local platform fonts and remain previews.
- The existing order ZIP renders one finished 300 ppi PNG per collage copy,
  plus its hash/geometry/resolution report. Owned order review exposes the saved
  photos/crops and finished output. Missing original, mismatched recipe or changed
  payment state stops the download; it never substitutes a source portrait.
- Native print preparation downloads the exact paid order/item's server output,
  verifies recipe/template/PNG hashes, quantity and dimensions, retains the
  original with bleed and a trim derivative with a receipt, and emits one
  finished JPEG per copy through the staged Noritsu workflow. Source-photo
  matching, portrait edits, backdrop changes and gang crops cannot alter these
  purchased collage pixels. Receipts and bytes are rechecked before publication.

See [the shared v1 contract](collage-template-contract.md) for exact geometry,
selection and receipt formats. The reviewed Flutter patch and its original-file
hash manifest are included under `integrations/flutter/` for the separate active
V2 directory, which did not have Git metadata. The V1 fallback is untouched.

## Preview and rollout boundary

`STUDIO_OS_COLLAGE_CHECKOUT_ENABLED` stays off by default. Both new purchases and
resuming saved collage payment drafts stop while it is off. Ordinary print,
digital, class-composite and payment-provider configuration remain unchanged.

The migration `20261014180000_private_collage_templates.sql` is included for
review and local SQL tests only. Before any production enablement, apply the
reviewed migration in an isolated environment and verify authenticated desktop
save → Cloud publication/product setup → parent/sibling selection and restoration
→ test payment → receipt/order review → final native and Cloud output, including
lab dimensions and bleed. A signed native release and installed-app verification
are also still required. No live payment, lab send, printer action, customer-order
mutation, migration, app replacement or deployment was performed for this work.

## Verification

Focused tests cover ownership/RLS and withdrawal in a real local SQL engine,
media scope, server pricing, mixed packages and copies, cart restoration/reorder,
version immutability, request bounds, EXIF/crop/layer/text rendering, paid output
and integrity receipts. Both complete suites, static checks and the Cloud
production build are run for the final source; exact results are recorded in
`integrations/flutter/verification.md`.

An isolated browser run of the real components used synthetic photos and the
production renderer. It verified photo reuse, crop controls, review invalidation,
resolution warnings, template import/export privacy, border/bleed output at
3075×2475 for a 10×8-inch trim with 0.125-inch bleed, and 390-pixel phone layouts
without horizontal overflow. It reported no browser errors. Browser and native
fixture screenshots are local evidence, not authenticated live deployment proof.
