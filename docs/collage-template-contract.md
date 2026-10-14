# Studio OS collage interchange, version 1

This is the shared design contract implemented by `lib/collage-template.ts` in
Cloud and `lib/models/collage_template.dart` in the active Flutter V2 source.
A design contains no customer photos, media IDs, crops, student captions, prices,
local file paths or credentials. Imports/exports whitelist design fields.

## Portable design

- `version`: exactly `1`. Unknown versions are rejected.
- `name`: 1–100 characters.
- `widthInches`, `heightInches`: **trim dimensions**, each 4–30 inches, at most
  600 square inches in total.
- `bleedInches`: optional, 0–0.5; omitted means zero. The page background fills
  bleed. Artwork covers trim. The lab must receive both full-image and trim
  dimensions; shrinking the full image to trim would change the purchased crop.
- `safeInsetInches`: optional, 0–0.5; omitted means 0.125. This is a guide for
  important text/logos, rather than an extra crop or automatic layout change.
- `background`, `ink`: six-digit `#rrggbb` colours in sRGB.
- `overlay`: null or embedded base64 PNG/JPEG design artwork in portable JSON.
  Transparent openings reveal photos. Existing portraits in photographed samples
  are not removed or converted into editable openings.
- `slots`: ordered array of 1–8 openings. Each has a unique ASCII `id`, `label`,
  and normalized trim coordinates `x`, `y`, `width`, `height`. Width/height are
  at least 0.02; the complete rectangle must fit inside trim. The optional
  `border` has `color` and `widthInches` (0–0.25), drawn **inside** its opening.
- `caption`: normalized trim centre `x`, top `y`, and font `size` as a fraction
  of trim width. The three lines are name, school/occasion and year/class.
  Rendering order is page background → openings in array order, with their
  borders → artwork → captions. Text is horizontally fitted within the page.

Artwork is embedded only for interchange/editing. Cloud storage decodes it to
an owner-bound private, content-addressed PNG; immutable version/order records
contain its private key and content hash, never a browser URL or embedded bytes.

## Photo selection: one completed print

```json
{
  "version": 1,
  "templateVersionId": "22222222-2222-4222-8222-222222222222",
  "placements": [
    {"slotId": "main", "mediaId": "authorized-gallery-media-id", "zoom": 1.5, "x": 0.5, "y": 0.4}
  ],
  "caption": {"studentName": "", "schoolName": "", "year": ""}
}
```

Every required opening must be selected exactly once. A media ID can be reused
in different openings or copies. `zoom` is 1–3; `x` and `y` are 0–1. First fit
an upright image with **cover**, multiply scale by zoom, then select the
remaining source rectangle at fractions x/y of the available travel. Orientation
is normalized before calculating the crop. Client URLs and submitted prices are
never selection authority. School media identities are canonical original keys;
event media identities are scoped media-row UUIDs. Both resolve through the same
existing access/tombstone/collection checks as other gallery photos.

A package item's `collage: {templateVersionId}` identifies the design. The
existing `buildSlots` print slot expands package item quantity × set quantity.
Each resulting collage print slot holds **one** selection object, containing all
its openings. Two collage copies remain two independent selections, rather than
turning openings into additional billable prints. Ordinary and class-composite
slots retain their established behavior.

## Frozen order and production

The server re-prices the product and expands its configured copies. It resolves
an owned, gallery-granted immutable version and every selected original. Its
order snapshot adds the validated design, template identity/version number,
photographer identity, artwork key/content hash and each placement's authorized
`mediaKey`. These fields are reconstructed on checkout; submitted versions of
server-only fields are discarded. A compatible older version may be reordered
only while still authorized, for the same template and exact trim size, using
current package prices and fresh photo authorization.

`order_items.collage_snapshot` is append-only after purchase. A collage item has
no ordinary source-photo SKU. Production reads this immutable recipe and owned
originals; it never falls back to a selected portrait if rendering fails. Paid,
non-refunded status is verified before and after downloading output.

Output size is `round((trim inches + 2 × bleed inches) × 300)` per dimension.
Resolution warnings use the original upright pixels remaining in each crop:
below 300 ppi is warned, and below 200 ppi is labelled low resolution. Production
PNG embeds 300 ppi density and includes bleed. Parent final review uses the same
renderer, layout/crops, artwork, font fitting and source sampling at bounded
screen dimensions; small raster antialiasing differences are expected.
Native/local design canvases are previews. Print orders use verified Cloud
production pixels rather than rerendering purchased text using platform fonts.
No lab colour-profile conversion or automatic printer submission is implied.

Production responses bind order/item IDs, canonical recipe SHA-256, template
hash, pixel dimensions and returned PNG SHA-256. Native preparation validates
these before admitting a finished image to the existing print workflow.

## Availability and rollout

Template and gallery grants are owner-scoped and versioned. Gallery access can
be withdrawn in one direction; a new version is required to grant it again.
Withdrawal blocks new selections/reorders and leaves paid production recipes
intact. Catalogues return only authorized design metadata; artwork is loaded
only for one selected, authorized version. Old versions and
purchased recipes are never edited when a designer saves a new layout. The
migration is supplied for review and local SQL tests only; it has not been
applied to production. Collage purchasing requires explicit server enablement
(`STUDIO_OS_COLLAGE_CHECKOUT_ENABLED=1`), including when resuming a saved unpaid
checkout. Keep it off until authenticated purchase, restoration, fulfillment,
lab-size/bleed and native-release checks pass. Existing ordinary orders do not
need the collage migration or enablement flag to continue working.
