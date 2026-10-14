# Collage implementation verification · 14 October 2026

These results apply to the local draft continuation of Cloud PR #33 and the
20-file active V2 desktop change. They do not establish live deployment or
installed-app behavior.

| Check | Result |
| --- | --- |
| Cloud complete `npm test` | 2,155 passed; 0 failed/skipped |
| Cloud focused `node --test tests/collage-*.test.mjs` | 62 passed |
| Cloud `npx tsc --noEmit` | Passed |
| Cloud production `npm run build` | Passed using fixture Supabase URL/key and `VERCEL_ENV=preview`; photo-backup job explicitly disabled |
| New collage components/modules/API + production-download focused ESLint | Passed |
| Existing gallery/history files | Retain 20 and 2 hook-rule errors respectively in their existing effects; full ESLint is not clean. Original draft parent baseline also has 20 errors. Dashboard package/order files have warnings and zero errors. |
| Flutter complete live-v2 suite, concurrency 2 | 1,887 passed; 3 existing optional skips |
| Flutter 8 new collage test files | 30 passed |
| Flutter focused catalog/restore/scope regressions | 33 passed |
| Flutter whole-library + all 8 new test-file analysis | No issues found |
| Native patch verification | Applies to captured original bytes; all 20 resulting SHA-256 values match active V2; original file permissions preserved |

Cloud full-suite log: `/tmp/studio-os-collage-final-full-tests.log`.
Cloud build log: `/tmp/studio-os-collage-final-build.log`.
Native full-suite log: `/tmp/studio-os-collage-desktop-full-tests-final-frozen.txt`.
Desktop command includes `--no-pub --dart-define=STUDIO_OS_EDITION=live-v2 --concurrency=2`.

## Meaningful coverage

Real local SQL execution verifies ownership/RLS, immutable versions and purchased
snapshots, one-way gallery withdrawal and one collage print per row. Actual
route and raster tests cover unauthorized photos, current product pricing,
mixed packages, independent copies, stale configuration, older compatible
reorders, EXIF orientation, source crops, layering/text/bleed, paid-order checks,
receipt identity/hash validation, original-photo rendering, complete archives
and ordinary-order compatibility. Cart tests execute the real helpers/effects
for sibling/event scope, hydration cancellation, restoration, removed products,
misleading design names and malformed saved selections.

Native tests cover owner/session isolation, atomic immutable saves, design-only
JSON round trips, private Cloud requests, native UI save/reload, crop and EXIF
geometry, original/trim receipts, source tamper rollback, one whole finished JPEG
per copy, independent print rows and repeated catalog pushes without losing
Cloud collage configuration. Existing price conflicts and ordinary grouping are
retained.

## Visual verification

An isolated local browser used the real designer/parent components, synthetic
photos and the same production renderer used for final prints. It verified
photo reuse, independent crops, production-preview review invalidation,
resolution warnings, JSON privacy/round trips, borders and 0.125-inch bleed
(3075 × 2475 pixels for 10 × 8-inch trim), and 390-pixel mobile layouts without
horizontal overflow. No browser errors were reported. The temporary fixture
routes were removed before the final production build. Gallery withdrawal and
lazy artwork loading have route tests; they were not authenticated live-UI runs.

The synthetic parent screenshot is `docs/collage-evidence/parent-preview.jpg`.
The native synthetic widget capture is `integrations/flutter/evidence/collages-native-graduation.png`.
Neither uses the user's photographed student references.

## Required before enablement

Keep `STUDIO_OS_COLLAGE_CHECKOUT_ENABLED` off until an isolated authenticated
save → gallery publication/product setup → single/sibling cart restore → test
payment → order review → Cloud archive/native Noritsu preparation smoke test
passes, including the lab's trim/bleed convention. Review/apply the migration in
that isolated environment first. A signed native build and actual installed V2
UI verification are still outstanding. Native gallery publication and package
pricing are configured through Cloud.

No production migration, deployment, app installation/replacement, real payment,
customer-order mutation, printer/lab submission, merge or payment-provider change
was performed. V1 and the unrelated original Cloud checkout remain untouched.
