# Product previews retain the student with an applied backdrop

Based on production commit `00122565ad68c6d68df26a701701d867e622da52`, verified against Vercel deployment `dpl_97tCscyLNL9rww1EFQgkWLAvr44h` before editing.

The gallery viewer rendered the cutout correctly, but Buy Photo category tiles, package cards and product details flattened a separate canvas into a data URL. That path requested anonymous CORS for every image, unlike the viewer's signed-R2 image handling, and treated image errors as successful loads. It could lose the foreground or retain a stale composite when loading/exporting failed.

Product previews now render the backdrop and transparent portrait directly as SVG image layers. They no longer read/export canvas pixels. Both layers must load before the composite replaces the original portrait. Failed cutouts or exhausted backdrop candidates keep the original portrait visible. New photo/backdrop source keys reset loading state immediately, preventing late events from a previous pose from displaying a partial preview. Portrait/landscape framing, backdrop thumbnail fallback, and backdrop-only blur are preserved. SVG Gaussian blur is used for Safari support. All product mockup types share this renderer. Local environment files are excluded from deployment uploads.

Changed runtime files:

- `components/parents/product-photo-surface.tsx`: shared layered renderer.
- `app/parents/[pin]/page.tsx`: category, package and detail previews use the current portrait and confirmed backdrop; obsolete canvas export effect removed.
- `.vercelignore`: exclude local environment files.

Validation:

- Six executable regression tests in `tests/product-photo-surface.test.mjs` cover layer readiness, failed cutout, backdrop fallback/failure, pose change/stale callbacks, backdrop removal, landscape/blur and all six product kinds across three variants. Integration checks cover all three mockup call sites.
- Full test suite: 231 passing tests before release.
- TypeScript check and focused ESLint checks pass.
- Native Safari and in-app browser fixture verification: all six actual product mockups show an illustrated portrait. Safari also verified pose changes, landscape, missing cutout fallback, full-backdrop retry, and blur. Raster assets were served from a different loopback origin without CORS headers, exercising the original export limitation without customer photos.
- The local real-gallery route could not load because existing local R2 credentials return 401; no credential or security changes were made. Live gallery verification follows the guarded production deployment.

## Production verification

Deployed runtime commit `fcf7e65` through `npm run deploy:production`: clean-worktree guard, all 231 tests, local production build, and Vercel production build passed. Deployment `dpl_7UXcxpEvHwnCbPepzUuhPSWBjnxj` is READY and aliased to `https://www.studiooscloud.com`.

Native Safari verified the actual gallery from the reported screenshots after reloading production. Selected and confirmed **Graduation 34**, then opened **Buy Photo**: package, digital, specialty, print and canvas category previews and the package list all showed the student with the new backdrop. Switched from **Photo 001** to **Photo 006**: the main portrait and store previews updated to the pose holding the diploma, retaining the student and the selected backdrop. No order was submitted. The gallery was left showing Photo 006 and the corrected product previews.

Complete changed-file list: `.vercelignore`, `app/parents/[pin]/page.tsx`, `components/parents/product-photo-surface.tsx`, `tests/product-photo-surface.test.mjs`, and this verification report.
