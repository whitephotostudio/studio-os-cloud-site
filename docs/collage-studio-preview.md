# Collage Studio: first implementation

The photographer needs to offer reusable collages whose photo spaces parents can fill individually. The initial examples are a landscape three-portrait layout and a graduation portrait with an overlapping inset, student name, school and year.

## Available in this branch

`/dashboard/collages` is a photographer design workspace linked from the dashboard sidebar. It provides:

- Two starting layouts and up to eight labelled, positioned photo spaces.
- Print dimensions, paper/text colours and adjustable caption positioning.
- PNG/JPEG artwork overlay import. Transparent PNG openings reveal photos underneath; borders and school logos can be included in this artwork. A photographed sample does not become a reusable template automatically.
- Template JSON import/export with embedded design artwork. Export whitelists design fields and excludes test photos and student captions. This version has no cloud template persistence; the UI instructs photographers to download before leaving.
- A photo-selection preview using local test uploads, independent photo assignments, repeated use of the same image, zoom/pan, and effective source-resolution warnings.
- PNG export at dimensions calculated for 300 pixels per inch. Preview and export share one renderer/crop calculation. The lab must be set to the selected inch dimensions; this does not claim to embed print-resolution metadata, add bleed, convert to a lab colour profile, or submit to a lab.

Test photos remain in page memory via object URLs and are released when the workspace unmounts. The editor makes no gallery, order or payment writes. It is explicitly labelled as a design preview and has no publish or buy button.

## Existing per-print package selection

`components/parents/parent-gallery-client.tsx` already expands package item quantities into independently assignable slots (`buildSlots`). Two 5×7 prints can already receive separate photo selections. Collage spaces represent multiple images within a **single** finished print and must not be passed as ordinary independent print slots.

## Remaining work before selling

1. Add photographer-owned, versioned cloud template records, private artwork storage and ownership policies; avoid embedding large design assets in package/cart JSON.
2. Attach a template/version and output size to a package item. Keep collage-space assignments nested under that item, distinct from the existing ordinary print slots. Support multiple collage copies and mixed packages.
3. Use only the authenticated gallery's permitted media in the parent picker; persist media IDs and crop coordinates, rather than trusting submitted image URLs. Restore edits/reorders using an immutable template-version reference.
4. Extend both single-gallery and combined-gallery cart persistence, authoritative order validation and stored order snapshots. Validate required spaces, media ownership and current server-side package pricing. Add clear collage previews to order review and receipts.
5. Render the paid order from original resolution files on the production side using the versioned template/crops; produce **one** finished print per collage item/copy. Test order downloads, lab/self-fulfilment paths, retries, and normal-print/digital/composite regressions.

Do not advertise this preview as a purchasable collage product before those paths are implemented and verified. The existing class-composite flow is separate and remains unchanged.

## Validation

- `node --test tests/collage-template.test.mjs`: template round trips, crop geometry, effective resolution, malformed imports and exclusion of student details.
- `npx tsc --noEmit`
- `npx eslint components/collages lib/collage-template.ts lib/collage-render.ts app/dashboard/collages/page.tsx tests/collage-template.test.mjs`
- Browser acceptance: assign three photos (including a repeated photo), adjust crop, export a 10×8 design and inspect 3000×2400 output, import/export a template, reject a malformed import, recover from invalid dimensions, and inspect desktop/mobile widths.

No production deployment or schema migration is included in this preview.

### Results for this implementation

- Five new template tests pass; TypeScript and focused ESLint pass.
- `npm run build` passes and includes `/dashboard/collages`.
- The full suite completes with 2,022 passes and 75 failures. All 75 failures report `spawn redis-server ENOENT`; the local Redis executable is unavailable. A separate run of the existing media-budget tests reproduces that prerequisite failure.
- An isolated Chromium harness of the real editor component passes photo assignment (including reuse), crop and low-resolution warning, 3000×2400 PNG download, template import/export without student details, invalid template rejection, invalid-size recovery, and a 390-pixel viewport width check, with no page errors. Desktop and mobile screenshots were visually inspected. This does not replace an authenticated deployment smoke test or the pending checkout/production tests.
