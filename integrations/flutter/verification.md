# Collage implementation verification · 14–15 October 2026

These results apply to the local continuation of draft Cloud PR #33 and the
reviewed 26-file V2 desktop patch. They do not establish a live deployment or
installed-app behavior.

| Check | Result |
| --- | --- |
| Cloud complete `npm test` | 2,171 passed; 0 failed/skipped |
| Final focused checkout + HTTP checks | 17 passed; all collage tests also included in complete suite |
| Cloud `npx tsc --noEmit` | Passed |
| Cloud production `npm run build` | Passed with fixture Supabase URL/key and `VERCEL_ENV=preview`; photo-backup job disabled |
| New collage modules/API/fixture helper focused ESLint | Passed |
| Existing parent gallery/history lint | Existing 20/2 hook-rule errors retained; original parent baseline also has 20 errors. Full ESLint is not clean. |
| Flutter isolated frozen live-v2 suite, concurrency 2 | 1,911 passed; 4 optional skips; no collage skip |
| Flutter ten collage unit/widget test files | 55 passed |
| Flutter whole-library + ten test files + native driver analysis | Passed on reviewed snapshot |
| Native commerce HTTP UI acceptance | Passed: standalone CAD32.50/2 copies and mixed CAD54.25/ordinary print + 2 copies |
| Browser purchase and mobile restoration/reorder | Passed on actual parent component with synthetic identities/media |
| Exact browser paid order → native production | 2 distinct 3000×2400 Noritsu JPEGs; original PNG receipt hashes match |
| Native patch integrity | Applies to captured baseline; all 26 hashes and modes verified; active unrelated Orders edits preserved |

Cloud logs: `/tmp/studio-os-collage-stage2-full-tests.log`,
`/tmp/studio-os-collage-stage2-tsc.log`, `/tmp/studio-os-collage-stage2-build.log`.
Native commands include `--no-pub --dart-define=STUDIO_OS_EDITION=live-v2
--concurrency=2`. The isolated copy excludes unrelated concurrent watcher files
and customer/build/archive data. Its extra optional vision-fixture skip compared
with the earlier 1,887-pass/3-skip stage-one run comes from that source-only copy.
The exact scope and native logs are recorded in the manifest. A fresh read-only
whole-library analysis of active V2 also passed after the concurrent work settled;
its unrelated changes remain outside this bundle.

## Connected acceptance evidence

The native editor's actual commerce controls published two new immutable versions
through authenticated HTTP and the real publication/pricing SQL transaction.
The mixed product retained its ordinary 5×7 item, added two independently
selectable collage copies, and cost CAD54.25 per set. Both intended school
galleries received access; currency and studio identity came from the server.

The actual parent component selected authorized photos, reused one photo,
changed the two copies' zoom to 1.2 and 1.4, reviewed the production previews,
saved the basket and restored it after reload. Its checkout created order
`9290f057-dd4e-4081-99df-3d393c31e240`. A signed synthetic provider event passed
the real webhook validation and made that order paid at 5,425 cents. Order history
showed the three physical print items. A 390px mobile reorder retained both
independent crops and had document width 390px, with no horizontal overflow.

The real production ZIP contains one ordinary JPEG, two distinct 3000×2400
collage PNGs, two matching recipe reports and the order summary. The exact paid
item IDs passed the native production service, hash checks and existing Noritsu
JPEG encoder, producing one staged JPEG per collage copy. Array order is not
used to identify copies. Sanitized receipts and synthetic finished images are in
`docs/collage-evidence/`; screenshots are there and under `integrations/flutter/evidence/`.
The photographed student references were not uploaded or used as test media.

## Coverage and limits

Real local SQL tests cover ownership/RLS, immutable versions/order snapshots,
gallery grants/withdrawal, atomic commerce updates, stale catalogue revisions,
request replay, empty/legacy price-sheet fallback and gallery-specific product
visibility. HTTP tests cover school, event/album and sibling authorization,
wrong media, mixed prints, independent copies, restored selections, current
pricing, compatible old-version reorders, signed webhook replay, paid output,
complete archives and unchanged old paid price/raster after new publication.
The ZIP checks bind every caption/media/crop/hash to its stored item ID. Raster
tests cover EXIF orientation, crops, layering, text, bleed and preview/print agreement.

Native checks cover exact-cents price validation, gallery/profile/product choices,
create/append/replace behavior, package preservation, atomic pending receipt
storage, lost-response/auth/rate-limit retries, crossed/tampered receipt rejection,
local price cache reconciliation, repeated catalogue pushes, owner/session
isolation, design-only import/export, private drafts, native UI reload/withdrawal
and paid item output integrity.

GoTrue auth, private object storage and Stripe HTTP transport are simulated in
this loopback fixture. Real auth consumers, session checks, SQL, route handlers,
webhook signature/paid transition and production renderers execute unchanged.
The parent context read model is a fixture adapter. Payment is explicitly **not
Stripe test mode**; no real charge or email delivery occurred. The browser run
used an older fixture provider page and manually returned to the local gallery
after its successful webhook. Automated HTTP tests exercise the actual return
confirmation; the updated fixture UI has a tested return callback.

Keep the production flag off. Before enabling outside this draft, run a complete
isolated Supabase deployment rehearsal, real Stripe test-mode checkout/webhooks,
lab trim/bleed checks and a signed installed-app verification. No production
migration, deployment, app replacement/install, customer order mutation, physical
print, lab submission, payment-provider configuration change or merge occurred.
V1 and the unrelated original Cloud checkout were preserved.
