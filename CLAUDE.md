# Studio OS Cloud Site — Working Memory

Checkpoint for Claude so a context reset doesn't lose the thread. Update as work progresses.

Last updated: 2026-04-26 late evening (retouching upsell modal + Flutter "Reveal hidden buttons" kid-proof toggle + per-school group label "Class / Faculty / Grade" + Flutter Import Hub for selective fresh-computer pull — still one big uncommitted/partially-pushed batch on the web side, plus a Flutter rebuild required).

## 🔧 FLUTTER REBUILD REQUIRED

A separate change landed in the desktop app source at `~/Downloads/Whitephoto_Studio_App_MVP_Source/lib/screens/admin_screen.dart` — kid-proof "Reveal hidden buttons" toggle (see "Flutter: kid-proof admin screen" below).  This file is NOT in the git repo, so the web push script doesn't pick it up.  To activate:

```
cd ~/Downloads/Whitephoto_Studio_App_MVP_Source
flutter build macos
```

Then relaunch Studio OS.app from `~/Downloads/Whitephoto_Studio_App_MVP_Source/build/macos/Build/Products/Release/Studio OS.app`.

### Flutter: Import Hub — selective fresh-computer pull (NEW, 2026-04-26 evening)

Real-world driver: photographer buys a new computer, signs in, and wants to continue working on schools/projects that were uploaded from another machine.  The old "Pull from Cloud" only pulled school metadata (no roster, no photos).  Now there's a full **Import Hub** screen with three tabs (Cloud / SD Card / Folder).  Cloud tab is fully wired this session; SD + Folder are scaffolded with "coming soon" states for next session.

- **New file:** `lib/screens/import_hub_screen.dart` — modern, elegant tabbed UI.  Header pill, search bar, filter chips (All / Schools / Projects / Not local / Already local), clean inventory cards with checkbox + type badge + roster count + photo count, sticky bottom action bar showing N selected and a Pull button.  During pull the bottom bar flips to a dark progress strip with the current school name + phase + photo counter.
- **New methods on `CloudSyncService`** (in `lib/services/cloud_sync_service.dart` after `pullAllFromCloud`):
  - `fetchCloudInventory()` — single round-trip that returns the photographer's full schools + projects list with roster counts (students.school_id + teachers.school_id) and photo counts (students.photo_url for schools, media.project_id for projects).  Resolves "is this already local?" against `LocalStore.getCloudSchoolId` for cheap hydration of the "Already local" badge.
  - `pullSchoolCompletePackage({cloudSchoolId, existingLocalSchoolId, onProgress})` — orchestrates the per-school pull pipeline: school metadata → latest roster snapshot via `restoreCloudRosterSnapshot` → student photos via `_downloadSchoolStudentPhotos`.  Skips photos already on disk so partial pulls resume cleanly.  Calls `onProgress(phase, done, total)` so the UI shows a live photo counter.
  - `_downloadSchoolStudentPhotos(...)` — iterates `students` rows for the school, downloads each `photo_url` via HttpClient, writes to `~/CaptureBase/{schoolName}/{className}/{Last_First_ExtId}/{filename}`.  Defensive — empty URLs, missing class names, duplicates all skip cleanly.
  - `_downloadSchoolMediaToLocal(...)` — stub for now (the `media` table doesn't have a `school_id` column; school-level extras like class composites get regenerated locally by the composite builder).
- **Conflict prompt:** when a ticked item already exists locally (`row.localExists == true`), the pull pauses and shows a 3-button modal — Cancel pull / Skip this one / Overwrite local.  Default behavior chosen by Harout: "Ask me each time" so unpushed local edits are never silently destroyed.
- **Hookup:** `lib/screens/cloud_screen.dart` — added a prominent dark "Import Hub" `FilledButton.icon` in the top toolbar, next to Upload + Refresh.  Opens the new screen as a fullscreen dialog (with route).  On dismiss the cloud screen reloads so any newly-pulled schools surface in the grid.
- **What ships unblocked:** photographer signs into a fresh Mac, hits Studio OS → Cloud → Import Hub → ticks "York University" → pull runs (metadata, then roster, then photos) with live progress, ends with a summary dialog showing what succeeded.  Composites + order edits work right after.
- **Design doc:** `docs/design/flutter-cloud-browser.md` (renamed in spirit to "Import Hub" — covers the SD + Folder spec for next session).

Followups for next session (already scoped in design doc):
1. **SD Card tab:** auto-detect plugged-in volumes (`/Volumes/` on macOS, drive letter scan on Windows, `/media/<user>/` on Linux), show a card per detected card with photo count + size, "Import to school..." action that copies into the chosen school+class folder.
2. **Folder tab:** `file_picker` invocation for any folder, recursive photo scan, preview thumbnails, same target picker as SD.
3. **nobg PNG download:** today the school photo download brings originals only — composites built on a fresh computer still need a re-run of background removal.  Optional polish: when pulling a school, also fetch any `nobg-photos/...` keys associated with the student photo paths.
4. **Conflict merge mode:** today the 3-button prompt offers Overwrite / Skip / Cancel.  A 4th option ("Merge: cloud wins on new rows, keep local rows that exist") would preserve unpushed local edits while still pulling new students added on the other computer.

Build to activate (Flutter source isn't in the git repo, so the web push won't pick this up):

```
cd ~/Downloads/Whitephoto_Studio_App_MVP_Source
flutter build macos
```

Then relaunch Studio OS.app from `~/Downloads/Whitephoto_Studio_App_MVP_Source/build/macos/Build/Products/Release/Studio OS.app`.

Smoke test: open Studio OS → bottom tab "Cloud" → click the new dark "Import Hub" button in the top toolbar → confirm tabbed screen appears with "From Cloud / From SD Card / From Folder" tabs.  Cloud tab should load schools + projects.  SD Card + Folder tabs show the "coming soon" panel.

### Flutter: kid-proof admin screen ("Reveal hidden buttons")

Real-world driver: photographers shoot with kids around the workstation.  Small fingers had been accidentally pressing Delete / Print / Cloud-sync icons, causing real data loss (deleted students, accidental cloud overwrites).  Fix: hide the destructive buttons by default and gate them behind an explicit "Reveal hidden buttons" eye toggle.

- **State:** `_hiddenButtonsRevealed: bool = false` + `_revealAutoHideTimer: Timer?`.  Default state every launch is HIDDEN — no persistence, kids can't find it left revealed from yesterday.
- **Auto-relock:** 3-minute inactivity timer fires `_autoHideRevealedButtons()` which flips the flag back + shows a snackbar.  Timer cancelled in `dispose()`.
- **Hidden in the school header row** (sidebar): Delete school, Sync to Cloud, Pull from Cloud, Refresh local list.  Add school + Rename school stay visible.
- **Hidden per class** (sidebar class list): the small "Rename class" pencil next to each class row — kids were tapping it mid-shoot.  Long-press menu still works for intentional renames.
- **Hidden in the students DataTable:** Edit + Print + Delete columns (and their cells) — column count and cell count both gate on the same flag, so DataTable never throws.
- **Hidden in the roles DataTable:** Edit + Delete columns.
- **Prominent reveal button:** full-width labeled button below the school header row, in the sidebar.  When locked it's a red-outlined "Reveal hidden buttons" button (eye icon) — high-visibility, can't miss it.  When unlocked it flips to an amber-filled "Hide buttons" button (lock icon).
- **Amber banner:** when revealed, a slim yellow strip appears below the reveal button reading "Dangerous buttons revealed — auto-locks in 3 min" with a lock-open icon.
- **No SQL / API changes** — purely a Dart UI change.

Verified by code inspection (no `flutter analyze` available in the Cowork sandbox).  Harout to rebuild + smoke-test:
1. Launch Studio OS → Admin tab → confirm Edit / Print / Delete columns are NOT visible by default; sidebar destructive icons (trash / cloud / refresh) are also NOT visible.  A red "Reveal hidden buttons" button is sitting prominently below the "School" header.
2. Click "Reveal hidden buttons" → confirm Edit + Print + Delete columns appear in the students table, all destructive sidebar icons appear, button flips to amber "Hide buttons", amber banner shows below.
3. Wait 3 minutes (or click "Hide buttons") → confirm everything disappears again with the snackbar.

### Web side (unchanged below)

## 🚀 PUSH SCRIPT (run from Mac)

```
cd ~/Projects/studio-os-cloud-site
rm -f .git/HEAD.lock .git/index.lock
git add -A
git commit -m "feat: per-school group label (Class/Faculty/Grade) + retouching upsell modal + order receipts + history + reorder + landscape mockup fix + flash kill + year-aware search + prefetch payload fix"
git push origin main
```

After Vercel redeploys (~2 min):
- Hard-refresh (Cmd+Shift+R) once to bust the JS bundle cache
- Test retouch upsell: open any gallery → add anything to cart (digital, prints, package, canvas — all of them) → click "Continue to Secure Checkout" → modal pops with retouching add-on cards explicitly clarifying "retouching is an optional service, not a digital file delivery" → click "No thanks" → ends up on Stripe; OR click an add-on card → cart adds the line → click "Continue to Secure Checkout" again → goes straight to Stripe (modal does NOT re-pop)
- Confirm retouching packages have disappeared from the main grid (Specialty tab) — they only surface via the modal now
- Test order flow: place order in Landscape → confirm Wall/Desk previews are wide → receipt email arrives with thumbnails → click "View my orders" in email → lands on Orders tab → click Reorder → drawer pops at checkout with same items
- Test on a fresh PIN session (incognito or sign-out): toggle should be active immediately, screenshot protection should engage immediately, no refresh required

---

## What's in the bundle (2026-04-26 morning + afternoon + evening)

### Per-school group label — "Class / Faculty / Grade / Department" (evening addition)

Real-world driver: Harout shoots universities sometimes; "Class" is wrong terminology — universities call them "Faculties," elementary calls them "Grades," corporate calls them "Departments."  Now configurable per school, defaults to Class / Classes for K-12.

- **DB:** migration `supabase/migrations/20260425020000_add_schools_group_label.sql` (NEW) — adds `schools.group_label_singular text NOT NULL DEFAULT 'Class'` and `group_label_plural text NOT NULL DEFAULT 'Classes'`.  Already applied live to `bwqhzczxoevouiondjak`.  Defaults preserve every existing K-12 school's behavior.
- **API surface:** the dashboard schools route + the 2 portal context routes wire up the new fields.
  - `app/api/dashboard/schools/[schoolId]/route.ts` — added to `SchoolUpdateBodySchema`, the row type, both selects, the update handler (with default-fallback so blank input doesn't write empty), and the audit `diffFields` list.
  - `app/api/portal/gallery-context/route.ts` — added to the `SchoolRow` type + all 3 selects + new `groupLabel` top-level key in the response payload.
  - `app/api/portal/school-access/route.ts` — same pattern for the LoginForm prefetch (so the labels land on first paint, no refresh required).
- **Settings UI:** `app/dashboard/projects/schools/[schoolId]/settings/page.tsx` — new "Grouping Label" subsection in the Access & Privacy card, just above Screenshot Protection.  Two inputs (Singular + Plural) with placeholder text and example hints (Class / Faculty / Grade / Department).  Hydrates from `schoolData.group_label_*`, saves with default fallback so blanks don't break.
- **Dashboard school detail (`app/dashboard/projects/schools/[schoolId]/page.tsx`):** extracted `groupLabelSingular` / `groupLabelPlural` from the school row and threaded through 7 user-facing strings — "Add Class" button → "Add Faculty"; sidebar "Classes" header + "All Classes" → dynamic; per-card class label fallback; stats line "{N} classes"; "No classes yet" empty state; search placeholder; modal headline + name field label.
- **Parents portal (`app/parents/[pin]/page.tsx`):** added `groupLabel?: { singular, plural }` to `GalleryContextPayload` type; new state `groupLabel` defaulting to `Class / Classes`; hydrated from contextPayload in the school-context-load path.  Threaded through "Class Composite" fallback (uses `groupLabel.singular`), "Class photo (auto-included)" slot label, and "Class composites cannot be used inside package photo slots" error.
- **Schools list page** intentionally untouched — it shows mixed-type schools (K-12 + university together), so a generic "23 classes" subtitle is fine.  Per-school labels surface once you click into the specific school.

Typecheck clean (`npx tsc --noEmit` → exit 0) after all edits.

Followups:
1. **Flutter app — explicitly NOT changing.** Harout's call (2026-04-26 evening): the photographer-facing desktop tool can keep saying "Class" because the underlying `className` field is just free-text. For a university shoot, photographer types "York University" as the school, then creates per-faculty entries by typing "Engineering" / "Sciences" / "Business" into the Class field. The workflow is identical, only the column header label differs. Photographer mentally substitutes "Class = Faculty"; parents see "Faculty" via the web portal because that's where the per-school label is read. No Flutter rebuild required for this feature.
2. Spotlight search subtitle text could surface the per-school label on student hits ("Mary · Engineering Faculty · 2024" instead of "Mary · Engineering Faculty · Class"). Low priority.

### Retouching upsell modal at checkout (afternoon addition)

Real-world driver: a parent called the studio claiming she'd ordered "digital photo files" but only got a retouching invoice — she'd actually clicked the "Digital Retouching" specialty package thinking it was a digital download.  Same shape happened multiple times.  Fix: HIDE retouch packages from the main grid entirely, surface them ONLY via an upsell modal that pops up on every "Continue to Secure Checkout" click — with explicit copy clarifying retouching is a SERVICE, not digital files.

- **DB:** migration `supabase/migrations/20260425010000_add_packages_is_retouch_addon.sql` (NEW) — adds `packages.is_retouch_addon boolean NOT NULL DEFAULT false`.  An auto-flag UPDATE at the end marks existing `Retouching - 1 Image` ($10.67) and `Retouching - Multi Image` ($35.67) packages.  Future retouch packages get the flag set via the dashboard tickbox (still TODO — for now it's a SQL UPDATE).  Already applied live to `bwqhzczxoevouiondjak`.
- **API surface:** the 3 portal context routes now include `is_retouch_addon` in their package SELECTs:
  - `app/api/portal/gallery-context/route.ts`
  - `app/api/portal/school-access/route.ts` (the LoginForm prefetch — important; without this, parents on first session would see retouching in the grid until they refreshed)
  - `app/api/portal/event-gallery-context/route.ts`
- **Type extended:** `PackageRow.is_retouch_addon?: boolean` in `app/parents/[pin]/page.tsx`.
- **Grid filter:** `storefrontPackages` (the memo that backs the gallery's product grid) now filters out `pkg.is_retouch_addon === true`.  Retouching disappears from Specialty entirely on the main grid.
- **Add-on memo:** `retouchAddonPackages = packages.filter(pkg => pkg.is_retouch_addon === true)` — the modal renders exclusively from this list.
- **Intercept in `handlePlaceOrder`:** before the form goes to Stripe, if (a) at least one retouch addon exists, (b) the parent hasn't already shown/dismissed the modal this submit cycle, and (c) no retouch line is already in the cart, we `setRetouchUpsellOpen(true)` and `return` — preventing the Stripe redirect.  After parent picks Add or No-thanks, `retouchUpsellShown` is true, so a second click on Continue goes straight through.
- **Modal component:** `RetouchUpsellModal` (defined inline at the bottom of `app/parents/[pin]/page.tsx`).  Portaled to `document.body` at zIndex 100000 so it sits above the cart drawer + watermark overlay.  Backdrop click + Escape key + close-X all dismiss.  Body scroll locked while open.  Headline "Want Professional Retouching?" + Sparkles icon.  Yellow callout banner explicitly clarifies retouching is "an optional service" and "*not* a digital file delivery."  One card per retouch addon package showing name + description + price + green Add badge.  Bottom button: "No thanks, continue to payment."
- **Add-to-cart helper:** `addRetouchAddonToCart(pkg)` builds a `CartLineItem` with `slots: []`, no backdrop, qty 1, lane-tagged from `currentLane`, then closes the modal.  Server-side: empty-slots path in both `app/api/portal/orders/create/route.ts` (line ~858 "Physical package with no slots yet") and `app/api/portal/orders/create-combined/route.ts` (line ~768) handles this fallback by inserting a single charge line.
- **Reset:** `continueShoppingAfterCheckout` now also resets `retouchUpsellOpen` and `retouchUpsellShown` so a parent who comes back to place a brand-new order after paying gets the upsell again.

Typecheck clean (`npx tsc --noEmit` → exit 0) after all edits.

Followups:
1. Add a "Retouching add-on" tickbox to `/dashboard/packages` so photographers can flag/unflag without SQL.  Today they can manually `UPDATE packages SET is_retouch_addon = true WHERE name ILIKE 'retouch%'`.
2. Consider an A/B variant: pre-select one of the retouch options as a "recommended" add-on with subtle highlighting.  Skip for v1 — bare two-button modal is least pushy.
3. The modal currently doesn't re-pop after parent dismisses; that's intentional to avoid annoying them mid-checkout, but could be revisited if data shows attach rates are low.

### Order receipts + Orders tab + reorder

- **DB:** `orders.cart_snapshot jsonb` (migration `20260424220000_add_orders_cart_snapshot_for_reorder.sql`) — captures full cart entry payload at order create time so reorder rebuilds line items.  Both `app/api/portal/orders/create/route.ts` and `app/api/portal/orders/create-combined/route.ts` populate it.
- **Receipt email:** `lib/order-receipt-email.ts` (NEW) — studio-branded HTML+text template; order #, date, item table with 48×60 thumbnails (sku → photo URL), qty, totals; sibling discount as separate green row; "View my orders" CTA → deep-links to `/parents/<pin>?tab=orders&email=…`.  Sent from `finalizePaidOrderOrGroup` in `lib/payments.ts`, idempotency-keyed `order-receipt-<orderId>`.  Reply-to set to studio email.
- **Orders history API:** `app/api/portal/orders/history/route.ts` (NEW) — POST endpoint validates pin+email against school/project, returns last 50 orders with items + thumbnails + cart_snapshot + parent contact + special_notes + subtotal/tax.  Rate-limited 5/min per IP.
- **Orders panel component:** `components/parents/orders-history-panel.tsx` (NEW) — order cards with status pills, thumbnail+size+qty per item, click-to-expand details (subtotal/tax/total breakdown, contact, notes, full reference id), "Reorder these items" button.  Accepts `compact` for mobile and `onCountChange` to push the badge count up.
- **Tab integration:** `GalleryView` extended with `"orders"`.  Tab label renders as `Orders (N)` when count > 0.  New view in `app/parents/[pin]/page.tsx` mounts the panel.  URL `?tab=orders` deep-link consumed once on mount via `orderTabHintConsumedRef`.
- **Reorder hydration:** Effect runs once `photographerId + packages + backdrops` are loaded — reads `studio-os-reorder-pending` + `studio-os-reorder:<id>` from sessionStorage, reconstructs each entry as a `CartLineItem` (recomputes prices from live `packages`/`backdrops` so stale prices don't sneak through), pushes onto `cartItems`, opens drawer at the checkout step, clears sessionStorage.  Defended via `reorderHydratedRef` so it doesn't double-fire.
- **Thank-you polish:** Post-Stripe success screen now leads with **"View my orders"** as the primary CTA (lands on Orders tab); Continue Shopping is secondary.

### Wall/Desk/Close-up landscape print mockup fix

- **Bug:** When a parent picked Landscape orientation, the live big viewer rendered correctly, BUT the print mockups (Wall / Desk / Close-up) showed a butchered portrait composite.  Root cause: `compositeDataUrl` generator was hardcoded to a 600×800 portrait canvas with cover math.  The print frame was correctly landscape-shaped, but `objectFit: cover` cropped the portrait composite horizontally, chopping the kid.
- **Fix in `app/parents/[pin]/page.tsx`:** `compositeDataUrl` effect now picks 1067×800 (4:3 landscape) when `confirmedOrientation === "landscape" && supports_landscape === true`, else 600×800 portrait.  In landscape mode, foreground uses `getLandscapeForegroundScale()` + `getLandscapeForegroundVerticalOffset()` contain math (matches the live viewer).

### Blue-flash + canvas/blur sync fixes

- **Sticky-visible flag (`hasEverRenderedRef`)** in `CompositeCanvas` — once any frame has been rendered, the canvas + DOM-blur layer stay at opacity 1.  Browser image cache keeps OLD `<img>` content visible while new srcs load → atomic swap, no glimpse of the underlying fallback photo's blue chroma.
- **Removed wrapper `backgroundImage: url(backdrop) cover`** — was the actual flash trigger when canvas opacity dipped during state changes.  No longer needed since the wrapper aspect-ratio now matches the canvas exactly.
- **Canvas landscape head-clip fix:** when `dh > height` (landscape mode), skip the upward `clampNumber` that was forcing the foreground up and clipping the head.  Use natural offset, matching DOM blur behavior.
- **Skip `fgCrop` in canvas landscape:** was using auto-trimmed bounding box, which surfaced parts of the source (parent's hand etc.) the DOM path doesn't show.  Now uses natural dimensions to match DOM exactly.

### "Have to refresh for it to work" prefetch fix (real root cause)

- **Bug:** `app/api/portal/school-access/route.ts` (the prefetch endpoint LoginForm calls and caches in sessionStorage) was missing `supports_landscape` on backdrops AND the entire `screenshotProtection` object.  Parents page consumed the cached payload on first mount → toggle stayed gray, screenshot protection didn't activate.  Refreshing consumed the cache and forced a fresh fetch from `/api/portal/gallery-context` which DID have the fields.
- **Fix:** added `supports_landscape` to the backdrop_catalog `.select()`; added `screenshot_protection_desktop/mobile/watermark` to the schools `.select()`; added the `screenshotProtection` object to the returned `galleryContext` payload — mirroring exactly what `gallery-context/route.ts` returns.

### Defensive fixes (still good even after the prefetch root-cause fix)

- **Stale backdrop snapshot:** parents page re-resolves the active backdrop from the live `backdrops` array by id every render in both the panel preview and the main viewer — protects against future schema drift.
- **Screenshot protection remount key:** `<ScreenshotProtection key={…flags…}>` forces a full remount whenever flags change → all useEffect listeners re-attach fresh.

### Year-aware Spotlight search

- Type "**mary 2002**" → parses out the year, filters schools/students/events to that year only.  Year filter uses `shoot_date` first, falls back to `created_at`.  Year shown in subtitle of every hit ("Riverside Prep · Grade 8A · 2002").  Helper: `parseYearToken()` + `yearLabel()` in `components/spotlight-search.tsx`.  Placeholder updated to teach the feature.

### Combine drawer year filter chips

- `components/parents/combine-orders-drawer.tsx` school dropdown — when there are 2+ year groups, year chips appear above the search box (All years · 2026 · 2025 · ... · Year unknown).  Click a chip → school list filters to that year.  Search input placeholder updates to "Search schools in 2026…".

### Other polish

- **Backdrops nav link** added to dashboard sidebar (`components/dashboard-sidebar.tsx`).
- **Duplicate sidebar removed** from `/dashboard/backdrops`.
- **Bulk Portrait/Landscape toggle** in backdrop manager — select multiple → "↔ Landscape on / Portrait only" buttons in bulk action bar.
- **`set_orders_photographer_id` trigger patched** (migration `20260424210000_fix_orders_photographer_id_trigger_for_service_role.sql`) — was blocking parents-portal combined-orders endpoint with "No photographer profile for this user".  Now branches on `auth.uid()` — authenticated dashboard inserts force tenant binding, service-role inserts trust the explicit `photographer_id`.

---

## ⏭️ Tomorrow's pickup (post-push)

1. Smoke-test the bundle: place a landscape order, verify receipt email + Orders tab + reorder.
2. iPhone render verification of `/m/orders` and remaining mobile sub-pages (task #35).
3. The sub-pixel landscape jitter (deferred — may have resolved with the flash fix).
4. Phase 2 screenshot tiling proxy (task #46) — bigger, multi-day backend work.
5. Per-school search box could get year filter chips like the combine drawer (small lift).
6. Photographer dashboard: "View as parent receipt" preview button on order detail.

---

## Earlier (2026-04-25)

## Orders history + receipt email + reorder (2026-04-25 → 2026-04-26)

Parent gets a real receipt email on payment, can browse their order history inside the gallery, and can one-click reorder past items.

- **DB:** `orders.cart_snapshot jsonb` applied via `supabase/migrations/20260424220000_add_orders_cart_snapshot_for_reorder.sql`. Captures the full cart entry payload at order-create time so reorder can rebuild line items.  Both `app/api/portal/orders/create/route.ts` and `app/api/portal/orders/create-combined/route.ts` populate it.
- **Receipt email:** `lib/order-receipt-email.ts` (NEW). Studio-branded HTML+text template — order number, date, item table with 48×60 thumbnails (sku → photo URL), qty, totals; sibling discount as separate green row; "View my orders" CTA button → deep-links to `/parents/<pin>?tab=orders&email=…`. Sent from `finalizePaidOrderOrGroup` in `lib/payments.ts`, idempotency-keyed `order-receipt-<orderId>` so webhook retries don't duplicate. Reply-to set to studio email.
- **Orders history API:** `app/api/portal/orders/history/route.ts` (NEW). POST endpoint validates pin+email against the school/project, returns the parent's last 50 orders with items + thumbnails + cart_snapshot + parent contact + special_notes + subtotal/tax. Rate-limited 5/min per IP.
- **Orders panel component:** `components/parents/orders-history-panel.tsx` (NEW). Renders order cards with status pills, thumbnail + size + qty per item, click-to-expand details (subtotal/tax/total breakdown, contact, notes, full reference id), and a "Reorder these items" button. Accepts `compact` for mobile and `onCountChange` to push the badge count up.
- **Tab integration:** `GalleryView` extended with `"orders"`. Tab label renders as `Orders (N)` when there are past orders. New view in `app/parents/[pin]/page.tsx` mounts the panel. URL `?tab=orders` deep-link consumed once on mount via `orderTabHintConsumedRef`.
- **Reorder hydration:** New effect runs once `photographerId + packages + backdrops` are all loaded; reads sessionStorage `studio-os-reorder-pending` + `studio-os-reorder:<id>`, reconstructs each entry as a `CartLineItem` (recomputing prices from live `packages`/`backdrops` so stale prices don't sneak through), pushes onto `cartItems`, opens drawer at the checkout step, clears sessionStorage. Defended via `reorderHydratedRef` so it doesn't double-fire.
- **Status:** typecheck clean. All uncommitted as of 2026-04-26 morning.

---

## Backdrop orientation toggle — Portrait / Landscape (2026-04-25)

## Backdrop orientation toggle — Portrait / Landscape (2026-04-25)

Photographer can opt-in any backdrop to landscape mode in `/dashboard/backdrops` (Edit modal → "Supports landscape" tickbox).  Parents see a Portrait/Landscape pill inside the CHOOSE BACKDROP panel ONLY for backdrops where `supports_landscape === true`.  Switching to a portrait-only backdrop while landscape is active auto-snaps back to portrait and shows a yellow toast: "Landscape mode isn't available for this backdrop — switched back to Portrait."

- **DB:** `backdrop_catalog.supports_landscape boolean NOT NULL DEFAULT false` applied via `supabase/migrations/20260424200000_add_backdrop_supports_landscape.sql`.  Default false → every existing backdrop stays portrait-only.
- **Photographer UI:** `app/dashboard/backdrops/page.tsx` — added field to `BackdropRow`, `editSupportsLandscape` state, hydrate in `openEditor`, included in `saveEditor` payload, copies in `duplicateOne`, new tickbox in editor modal between pricing and action buttons.
- **Portal context:** `app/api/portal/gallery-context/route.ts` — added `supports_landscape` to the BackdropRow type + select list. The field flows through `backdrops: backdropRows` directly.
- **Parent UI:** `app/parents/[pin]/page.tsx`:
  - `BackdropRow.supports_landscape?: boolean` extends the type
  - `selectedOrientation` / `confirmedOrientation` / `orientationNotice` state mirror the existing selected/confirmed/blur state
  - `getLandscapeBackdropCompositeSize` (4:3 wrapper), `getLandscapeForegroundScale` (slightly larger to anchor subject), `getLandscapeForegroundVerticalOffset` (centered with small downward bias)
  - `handleBackdropClick` auto-snaps to portrait + sets notice when picking a portrait-only backdrop in landscape mode
  - `handleConfirmBackdrop` defensively forces portrait when active backdrop doesn't support landscape, then commits orientation
  - `handleClearBackdrop` resets to portrait
  - Composite-selection useEffect resets orientation
  - Big viewer call site: `previewOrientation` derived from picker-open vs closed; `previewSize` / `previewFgScale` / `previewFgOffset` swap to landscape variants when active; `preserveForegroundAlignment` set false in landscape (cover math would crop the head out — contain math is correct here)
  - Live preview thumbnail: width 110→184 in landscape, scale + offset swap, `preserveForegroundAlignment={false}` in landscape
  - `isPreview` chip lights up when `selectedOrientation !== confirmedOrientation` so parents see "Preview" while looking at landscape before they confirm
  - New segmented control inline in the picker preview action row, only visible when `panelPreviewBackdrop.supports_landscape === true`
- **Cart line item:** `CartLineItem.orientation?: "portrait" | "landscape"` added; `currentDraftCartItem` snapshots the committed orientation; persisted cart `PersistedCartItem.orientation` field added in `lib/combine-cart-storage.ts`; rehydration restores it; `groupCartByLane` items carry it through.
- **Combined-orders endpoint:** `app/api/portal/orders/create-combined/route.ts` — `EntrySchema.orientation` (default portrait), `ResolvedEntry.orientation`, product names suffixed `(Landscape)` when applicable.
- **Legacy single-order endpoint:** `app/api/portal/orders/create/route.ts` — same orientation parsing + product-name suffix.
- **Server contract:** server doesn't enforce that `backdrop.supports_landscape === true` at order-create time.  The desktop lab will see "Landscape" inline on order summary regardless — defensive logic on the client guarantees we never confirm landscape on a portrait-only backdrop, and even if a malformed request arrived the lab would just see the orientation tag and could ignore it.

Typecheck clean (`npx tsc --noEmit` → exit 0) after all edits.

---

## Earlier (2026-04-24)

Agreement gate + spotlight polish landed — **Blocking legal-agreement gate** (v 2026-04-v1). After photographers sign in, if they haven't accepted the current Studio OS Cloud Agreement a full-screen modal covers `/dashboard`, `/m`, and `/studio-os/download` until they check the box and click Agree. "I do not agree" signs them out and bounces to `/sign-in?declined=1` with a banner. Version string lives in `lib/agreement.ts` (`CURRENT_AGREEMENT_VERSION`); bump it to force every photographer to re-accept on next load.

- **DB:** `photographer_agreements` table applied live (`supabase/migrations/20260423120000_add_photographer_agreements.sql`). Append-only audit rows: photographer_id, user_id, agreement_version, terms_version, privacy_version, accepted_at, ip_address, user_agent. RLS: SELECT + INSERT scoped to `user_id = auth.uid()`, no UPDATE/DELETE policy.
- **UI:** `components/agreement-gate.tsx` wraps both dashboard layouts + studio-os/download. Checkbox unchecked by default, Agree disabled until ticked, ESC intercepted, body scroll locked.
- **API:** `GET /api/dashboard/agreement/status`, `POST /api/dashboard/agreement/accept` (captures ip/ua from headers).
- **Server-side defense in depth:** `lib/require-agreement.ts` → `guardAgreement({service, userId})` wired into ~25 write handlers across schools, schools/[id], visitors/emails/classes/students/photos, roster-snapshots, desktop-sync, desktop-composites, events, events/[id]+albums+visitors+emails+favorites, desktop-access, desktop-media, visitors/email, orders/notify, upload-to-r2, generate-thumbnails, storage-folder. Not gated: `agreement/*` (deadlock), `admin/*`, `voice-access`, GET-only reads.
- **Admin audit:** `/dashboard/admin/agreements` + `/api/dashboard/admin/agreements` — platform-admin-only. Shows acceptance rate, outstanding photographers, 200 most-recent rows with IP + UA.
- **Legal pages:** real content at `/terms`, `/privacy`, `/data-responsibility-agreement`. Contact harout@me.com.
- **Flutter desktop:** `~/Downloads/Whitephoto_Studio_App_MVP_Source/lib/services/cloud_sync_service.dart` + `cloud_screen.dart` detect `403 + code:"agreement_required"` and pop an AlertDialog with an "Open Studio OS Cloud" button. Harout must rebuild: `cd ~/Downloads/Whitephoto_Studio_App_MVP_Source && flutter build macos`.
- **Sign-in:** reads `?declined=1` and shows a red banner above the form.

Also landed in the same working-tree batch (smaller changes before the agreement gate):

- **Spotlight deep-links:** clicking a student in Spotlight now lands on the student card. Class page reads `?student=<id>`, scrolls, highlights blue glow for 2.8s. Orders deep-link via `?focus=<id>`. Applied on both desktop (components/spotlight-search.tsx) and mobile home (app/m/page.tsx).
- **Spotlight people search:** students table query now also matches `role`, so typing "coach" or "teacher" surfaces staff. Subtitle shows class for students, role for staff.
- **Per-school search box:** placeholder now "Search classes, students, teachers…". New Matching People grid renders above Classes when typing — photo + name + role/class, clicks drill into class/role pages with `?student=<id>`.
- **Parents portal login:** searchable combo boxes replaced native `<select>` for schools + events (parent can type 3 letters to filter long lists).

Typecheck clean. Everything is uncommitted — push block below.

---

## Mobile blur hold-to-reveal → tap-then-idle (2026-04-23, in the same uncommitted batch)

After the desktop FINAL PASS shipped and Harout tested the mobile overlay on his iPhone, the press-and-hold-to-reveal pattern made the gallery unusable: tap a photo → see it for the tap duration → blur snaps back the instant the finger lifts. Fixed in `components/screenshot-protection.tsx` (the mobile useEffect around line 253): any touch or scroll now lifts the blur and keeps it off while the user is actively browsing; a 4-second idle timer re-arms the blur. Watermark always on. Net: real parents get crisp photos once they touch the screen; iOS Power+VolUp screenshot attempts still catch the blurred state if the phone is idle when the shot is lined up, otherwise the watermark burns in the trace.

---

## Screenshot protection — DESKTOP final (2026-04-23, earlier pass)

**Desktop:** Gallery is fully crisp unless a real modifier key is pressed. Bare ⌘ / Ctrl / ⇧ keydown fires an instant 5s blur via GPU-composited overlay (no body filter, no re-raster). Catches ⌘⇧3 because the blur is painted the moment Cmd lands — before the OS capture synchronously fires at the digit. `e.isTrusted` guard rejects extension-synthesized keys. `e.repeat` guard prevents auto-repeat strobing.

**Real mobile only (strict 3-signal detection: `pointer:coarse` + `hover:none` + `innerWidth<900`):** Idle-model overlay (see mobile UX fix block above). Desktop never reaches this path, so no phantom touch-event loops from trackpad synthesis.

**Always on everywhere:** Watermark (55% opacity tiled pattern + 3 big letterbox bands with viewer email + date), right-click blocked, drag blocked on images. Watermark is doing the heavy lifting — the threats we can't technically block (phone camera pointed at screen, screen-recording software) are addressed by making every leak traceable back to the viewer.

**Removed as theater:** desktop idle-blur (attacker just wiggles mouse), proactive triggers on mouseleave/pointerleave/visibilitychange/window.blur (fired phantom blurs + bypassable), body filter (GPU-slow re-raster).

Final file: `components/screenshot-protection.tsx` (~700 lines). Typecheck clean. Harout confirmed live behavior on Mac: "THE LAST ONE YOU DID IS AMAZING ITS WORKING GREAT".

Trade-off accepted: Cmd+R / Cmd+T / Cmd+L / bare Shift also blur the gallery for 5s. Acceptable because parents portal has no text inputs, and a click dismisses the blur instantly.

---

## 🔴 ACTIVE HANDOFF — resume here

Open this block first. Everything below it is historical context.

### Unblock the sandbox first (Mac, every session)

The sandbox's `.git/index.lock` has been permanently stuck since 2026-04-22. Sandbox permissions don't allow `rm` on it. Run on Mac:

```bash
cd ~/Projects/studio-os-cloud-site
rm -f .git/HEAD.lock .git/index.lock
# Then review the working tree (nothing is committed yet — see below)
git status
# Commit everything together:
git add -A
git commit -m "feat: screenshot protection for parents portal (Phase 1)"
git push origin main
```

### Screenshot Protection Phase 1 HARDENING PASS — uncommitted

After `f0c5174` landed on prod, Harout shot screenshots on macOS and the gallery came through clean. His verbatim: "ITS HAPPENING BUT ITS TOO SLOW ITS ALLREADY TOOK THE PHOTO ITS ACTING VERY SLOW". AskUserQuestion → "Harden Phase 1 now" + "Strong mobile (always half-blurred, hold to reveal)". Phase 2 (tiling proxy) still deferred.

Changes, all in `components/screenshot-protection.tsx`:
- **PREDICTIVE modifier-combo blur.** `onKeyDown` now triggers blur on ANY keydown where `metaKey && shiftKey` are both held — not just on the 3/4/5/6 keys. This means pressing Shift while Command is already down fires the blur BEFORE the user can press 4. Catches ⌘⇧3 / ⌘⇧4 / ⌘⇧4+Space (window capture) / ⌘⇧5 / ⌘⇧6. Accepted false positives: ⌘⇧T, ⌘⇧R, ⌘⇧I etc. cause a 5s blur — trade-off we accept.
- **Synchronous DOM apply in the handler.** `triggerBlur` now sets `document.body.style.filter` directly before calling `setBlurred(true)`. No React round-trip — the blur paints in the same frame we detect the threat.
- **Listeners on BOTH window AND document** with capture phase, so we see the keydown on its first hop regardless of browser routing.
- **`keyup` listener** keeps the blur alive while modifiers are still held (covers the multi-second ⌘⇧4 → drag → release flow).
- **Screenshot blur window extended to 5000ms** (was 2200ms) so the ⌘⇧4 → Space → click-window flow stays blurred end-to-end.
- **Removed the 280ms CSS transition on the body filter.** Old code had `transition: filter 280ms ease` which meant the blur animated in over ~8 frames; OS screenshot lands in the first frame before anything is blurred. Now blur is applied synchronously in the same paint.
- **Bumped blur strength** 22px/0.6 → 26px/0.5 so the partial captures that do slip through are more thoroughly obscured.
- **Added 3 proactive blur triggers** (desktop only):
  - `document.documentElement.mouseleave` with null relatedTarget → cursor leaving viewport toward menu bar / other app fires blur with ~several hundred ms of headroom before the user can click Screenshot.app.
  - `document.documentElement.pointerleave` → covers trackpad flicks that `mouseleave` misses.
  - `document.visibilitychange` → tab backgrounded (switching to screenshot tool) blurs immediately.
- **Kept the keydown + window.blur listeners** as last-ditch defense for ⌘⇧4/5/PrtSc which fire while picker is still open.
- **Removed the 420ms long-press timer** from mobile. Replaced with always-on half-blur.
- **Always-on mobile half-blur.** Every `[data-gallery-image]` tile gets a `::after` pseudo element with `backdrop-filter: blur(16px) saturate(0.7)` + `clip-path: polygon(100% 0%, 100% 100%, 0% 100%)` so the lower-right triangle of each photo is permanently obscured. Tap-and-hold adds `.ss-reveal` (touchstart + mousedown) which sets `opacity:0` on the overlay; release removes it. Any OS screenshot captures the half-blurred state.
- **Watermark strengthened.** Opacity 0.22 → 0.38. Primary pattern 320x180 → 220x130 (denser). Added a second counter-rotated pattern at +18° so no bright region of the photo escapes the stamp. Font weight 600 → 700 + stroke 0.4 → 0.5.

Typecheck clean (`npx tsc --noEmit` → exit 0). No other files touched this pass — the DB flags + settings UI + context APIs + `<ScreenshotProtection>` mount on parents portal are all still in place from the prior pass.

**What this actually defeats:**
- ⌘⇧4 / ⌘⇧5 (region + app pickers): blur fires while picker is active, capture lands on blurred frame. Now with mouseleave + pointerleave as pre-triggers, the blur usually applies before the user even presses the shortcut.
- Tab-switch to Screenshot.app / third-party tool: visibilitychange triggers immediate blur.
- iOS / Android long-press "Save Image" sheet: half-blur is already applied, so the saved image is half-blurred.
- Any successful capture: now carries a 38% opacity tiled watermark with parent email + date, makes leaks traceable.

**What this still can't defeat (Phase 1 fundamental limit):**
- macOS ⌘⇧3 (full-screen, no picker): OS snapshot is synchronous, browser JS never runs in time. BUT the watermark burn-in guarantees the captured image is stamped, which is the real Phase 1 win.
- Screen-recording apps started before the gallery loads (Loom/OBS/QuickTime): the rendered frames are captured freely; watermark is the only defense.
- Technically savvy user (DOM inspector, disabled JS, headless browsers).

Phase 2 (tiling proxy) remains deferred in task queue as #46 — that's the real fix for ⌘⇧3 and covers the rest too.

---

### Screenshot Protection Phase 1 (initial pass) — already pushed as `f0c5174`

Driven by Harout's "can we do this??" + three ShootProof screenshots. Scope locked via AskUserQuestion: full defense (tiling + watermark + protection), per-school AND per-event toggle, parents-portal only (dashboard stays clean). **Phase 2 (image tiling proxy) deferred — multi-day backend work, not attempted in this session.**

**Already applied (no code to commit):**
- Supabase migration `add_screenshot_protection_flags` — added 3 `boolean NOT NULL DEFAULT false` columns on both `public.schools` and `public.projects`:
  - `screenshot_protection_desktop`
  - `screenshot_protection_mobile`
  - `screenshot_protection_watermark`
  - Each has a COMMENT documenting its purpose.

**Uncommitted files that need to go out together:**

- `components/screenshot-protection.tsx` — **NEW** (~265 lines). Default export `<ScreenshotProtection flags={...} watermarkText={...} />`. Non-wrapping — mounts global listeners + fixed overlays. Layers:
  - Desktop: keydown listener for ⌘⇧3/4/5/6 + PrtSc + ⌘⇧P (DevTools capture); window.blur handler (catches Snipping Tool stealing focus); contextmenu prevent; dragstart prevent on `<img>`.
  - Mobile: touchstart+timer (420ms threshold, only arms on img / `[data-gallery-image]`); touchend cancels; contextmenu prevent.
  - Watermark: tiled SVG pattern overlay, position:fixed, pointer-events:none, mix-blend-mode:overlay, 22% opacity. Text is `"<parentEmail> · <date>"`.
  - Blur: when a capture keystroke / long-press / focus-loss fires, applies `filter: blur(22px) saturate(0.6)` to `document.body` for 2–3s. A "Gallery hidden — screenshots are not permitted." notice is **portaled** to `document.documentElement` so it stays crisp while body is blurred (clever: portal escapes the blur).
  - Renders a `<style>` tag when desktop or mobile flags are on with `img { -webkit-user-drag: none; user-select: none; }` and (mobile only) `-webkit-touch-callout: none`.

- `app/api/dashboard/schools/[schoolId]/route.ts` — extended `SchoolUpdateBodySchema` with 3 optional bools; extended `SchoolRow` type; added the 3 columns to the select lists (initial fetch + post-update return); update handling coerces via `=== true`; all 3 columns added to `diffFields` for audit logging.

- `app/api/dashboard/events/[id]/route.ts` — same pattern: `ProjectUpdateBodySchema`, `ProjectRow`, selects, update handling, diffFields.

- `app/api/portal/gallery-context/route.ts` — added the 3 columns to **all three** `.select(...)` calls via `replace_all`; added `screenshotProtection: {desktop, mobile, watermark}` top-level key to the NextResponse.

- `app/api/portal/event-gallery-context/route.ts` — same pattern but there's only one project select.

- `app/dashboard/projects/schools/[schoolId]/settings/page.tsx` — 3 new `useState(false)` hooks; hydration reads `schoolData.screenshot_protection_*`; save payload includes the 3 booleans; new "Screenshot Protection" subsection inside the Access & Privacy card with sky-blue info callout + 3 `<ToggleRow>` components with descriptive copy.

- `app/dashboard/projects/[id]/settings/page.tsx` — same pattern for events. State hooks after `projectPin`, hydration after `setProjectPin`, payload after `access_updated_source`, UI subsection inside the Privacy card's final Card.

- `app/parents/[pin]/page.tsx` — added `screenshotProtection` field to both `GalleryContextPayload` and `EventGalleryContextPayload` types; added `const [screenshotProtection, setScreenshotProtection] = useState(...)` alongside `watermarkEnabled`; wired `setScreenshotProtection(...)` into **both** the event-context-load path (after `setWatermarkLogoUrl`/`setStudioInfo`) and the school-context-load path (same spot); imported `ScreenshotProtection from "@/components/screenshot-protection"`; **mounted the component inside the main gallery return** (line ~7200, immediately after the `<style>` block that defines gallery hover effects) with `watermarkText={\`${parentEmail || "Parents portal"} · ${new Date().toLocaleDateString()}\`}`.

**Typecheck:** `npx tsc --noEmit` → exit 0 after every edit.

**What this does not defend against (explicit, known limits):**
- Screen-recording apps that don't steal focus (Loom, OBS, QuickTime started before the gallery loads) — they'll capture freely.
- Headless browsers / scraping.
- A technically savvy user who disables JS or goes into DOM inspector.
- Any OS-level capture that doesn't route through the browser.

All of these are the territory of Phase 2 (server-side tiling + per-tile signed URLs + rate-limited stitching) which is deferred. Phase 1 covers the realistic ~95% case: a parent pressing ⌘⇧4 / long-pressing to save / right-clicking. It also brands every successful capture with the viewer's email and date so leaks are traceable.

### Committed in sandbox but NOT YET PUSHED (do this first on Mac)

Three commits sitting in `.git/` locally, newest first:
- `2fd7236` — docs: unified data model design (task #7)
- `5b8cdd5` — docs: note Textures dups already cleaned (54→36 rows)
- `4133b0d` — fix: mobile compat pass #2 (topbar, admin users, orders, school detail)

Sandbox can't push (no SSH key) and left stale `.git/index.lock` from a failed `git add`. Run on Mac:
```bash
cd ~/Projects/studio-os-cloud-site
rm -f .git/HEAD.lock .git/index.lock
git push origin main
```

What `4133b0d` does (mobile-compat pass #2 — driven by Harout's iPhone screenshots on 2026-04-22 late evening):

- **`app/dashboard/layout.tsx`** — mobile topbar background `#000` → `#fff`, hamburger `#fff on transparent` → `#111 on #fff with #e5e7eb border`. Logo now sits on a white backdrop matching the desktop sidebar's white logo area.
- **`app/dashboard/admin/users/page.tsx`** — added `useIsMobile`. The 6-col client grid (`2fr 2fr 1fr 1fr 1fr 40px`) was chopping the Trial / Plan columns to "Stud / mo" on iPhone. Wrapped the table container in `overflow:auto` + inner `minWidth: 820` so columns keep their natural proportions and the user swipes horizontally to reach the right side. Outer padding trimmed 32→18 on mobile.
- **`app/dashboard/orders/page.tsx`** — tapping "Open details" on mobile rendered the panel below the list off-screen, so it felt broken. Added `detailsPanelRef` + `useEffect` that calls `scrollIntoView({behavior:'smooth', block:'start'})` on `selected.id` change when `isMobile`. Also tightened the order card fonts (H3 name 20→15, order total 24→18, photo 110×138 → 72×92, Package/Originals/Export grid now 1-col stacked on mobile instead of three crushed columns, details-panel H1 28→18, `scrollMarginTop: 72` on the panel).
- **`app/dashboard/projects/schools/[schoolId]/page.tsx`** — the 320px fixed-width aside was eating the whole ~390px viewport, hiding the classes/roles/people album grid on the right. Added `useIsMobile` and flipped the outer grid to `"1fr"` on mobile (aside above, album grid below). Also `position: sticky` → `static`, aside padding 16→12, outer padding 24→14, H1 24→20, top button row stacks vertically.

Typecheck passed (`npx tsc --noEmit` → exit 0). Desktop path untouched across all four files.

### Spotlight search + mobile `/m` surface (uncommitted, latest addition)

Driven by three Harout asks late on 2026-04-22:
1. "make sure everything mobile compatible so it easy to a photographer to login and view and send information maybe we should create small app stand alone to see orders notification view schools or events where he can just view and see the passwords and share the gallery or share the pin with the client" → scope via AskUserQuestion = a dedicated `/m/*` route (not a full PWA). v1 = orders list + new-order badge + spotlight search + tap-to-call/email + schools/events with PIN+share. Push notifications deferred to v2.
2. "Spotlight-style global search — type 'Ethan' or '3e92' and instantly see matching students, orders, or schools across everything … needs to be on the main dashboard too on the desktop" → build the palette **once** as a shared component and drop it into both surfaces.

Files added:
- **`components/spotlight-search.tsx`** — NEW. Exports `<SpotlightModal>` (dialog) and `<SpotlightLauncher>` (visible search button + ⌘K/Ctrl+K global shortcut). `useSpotlight(term, enabled)` hook fetches photographer id, debounces 180 ms, runs 3–4 parallel Supabase queries in parallel: students (first/last ILIKE), schools (name ILIKE), projects (title/client_name ILIKE with workflow_type=event), orders (only when term matches `/^[0-9a-f-]{4,}$/i` — uses ILIKE prefix on `id`). Color-coded hit types (indigo student / blue school / orange event / red order). Keyboard: ↑↓ navigate, ↵ open, esc close. Routes hits into `/dashboard/projects/schools/[id]`, `/dashboard/projects/[id]`, `/dashboard/orders`. Button uses `width:100%` when non-compact so it fills whatever flex wrapper you drop it in.
  - TS gotcha: Supabase query builders are `PromiseLike`, not `Promise`. The queue array is typed `PromiseLike<unknown>[]` so `Promise.all(...)` accepts them directly.
- **`app/m/layout.tsx`** — mobile-only shell. Sticky top header (SO logo + bell with unread-orders badge). Sticky bottom tab bar: Home / Orders / Schools / Events. Session guard mirrors `app/dashboard/layout.tsx` (transient-session flag + `supabase.auth.getUser` → bounce to `/sign-in?redirect=…`). Unread count: `.from("orders").select("id", {count:"exact", head:true}).eq("photographer_id", pg.id).eq("seen_by_photographer", false)`. Max-width 480px centered on desktop so `/m` degrades sanely.
- **`app/m/page.tsx`** — mobile home. Greeting + first-name, 3-stat strip (New today / Unread / Schools), prominent Spotlight input with debounced cross-table search (inline results, type labels), 4-tile quick-nav (Orders / Schools / Events / Full desktop). Own inline spotlight implementation — will eventually share with `<SpotlightLauncher>` but works today.

Files edited:
- **`app/dashboard/page.tsx`** — imported `SpotlightLauncher` from `@/components/spotlight-search`. Inserted into the header action row, to the left of the refresh button and `ProfileBadge`. Wrapped in `<div style={{ flex: isMobile ? 1 : "0 1 320px" }}>` so on desktop it claims ~320 px beside the actions, on mobile it stretches full-width under the greeting. The ⌘K global shortcut fires from anywhere inside `/dashboard`.

Typecheck passed (`npx tsc --noEmit` → exit 0) after the PromiseLike fix.

Still owed on the mobile sweep (task #35 in the queue):
- `/m/orders` list + `/m/orders/[id]` detail — DONE (tap-to-call, tap-to-email, seen_by_photographer flip on view).
- `/m/schools` list + `/m/schools/[id]` detail — DONE (mockup-inspired hero cover, status pill, per-student PIN reveal + share).
- `/m/events` list + `/m/events/[id]` detail — DONE (same hero pattern, single project-level PIN card, photo-count stat, orders strip). Both files typecheck clean.
- **Remaining:** iPhone render verification pass on all three `/m/*` routes, then finalize this handoff and commit everything under one `git commit` once Harout clears the `.git/index.lock` on his Mac.

#### `/m/events` implementation notes (just landed)

- `app/m/events/page.tsx` — queries `projects` filtered by `photographer_id` + `workflow_type='event'`, ordered by `event_date DESC nullsFirst:false`. In parallel pulls order counts and media (`media.project_id`) counts per event so the card can show "X photos · Orders: N" and pick its status pill. Cover comes straight from `projects.cover_photo_url` (no student-photo join needed for events). Status pill logic mirrors schools: no media → Setup, has media + `gallery_slug` → Gallery Released, else Pending Delivery. Share shortcut builds `/g/{slug}` if slug present, else `/parents?mode=event&project={id}`.
- `app/m/events/[id]/page.tsx` — single PIN card (unlike schools, which have a PIN per student). Access is gated when `access_mode='pin'` AND `access_pin` is non-empty — displays dotted placeholder + Eye/EyeOff reveal toggle, Copy PIN, and "Share link + PIN" which composes a full access message for clients. `photoCount` comes from `media` with `{count:'exact', head:true}`. Recent orders strip (5 latest) drills into `/m/orders/[id]` and the "View all" link goes to the per-event orders page at `/dashboard/projects/{id}/orders`. "Open full project page" footer link goes to the desktop project detail.

Both pages reuse the exact `shareOrCopy` / `single<T>` / `money` / `relativeTime` / `shortId` helpers already in `/m/schools/[id]` so visuals and behaviour stay parallel across the two surfaces.

### Per-school & per-event orders pages (uncommitted, latest addition)

Driven by Harout's request: "add in each event and school its own order page so when you go to the school you can see the photos and you can see the orders of that school and you can search a student order or order number". Grounded in a real-world case — a parent called claiming she'd ordered digital images and hadn't received them; Harout searched ShootProof by student and found she'd actually ordered **digital retouching**, not digitals. Screenshotted that and emailed it as proof. This feature replicates that workflow natively.

Scope this slice (per AskUserQuestion): **per-school orders tab + search + line-item breakdown only**. Source-badge ("Printed in-studio") and one-click email-summary-to-parent deferred to the next round.

Files touched:
- `components/gallery-orders/gallery-orders-panel.tsx` — **NEW** (~660 lines). Shared client component that accepts `{schoolId}` OR `{projectId}`, fetches orders scoped to it (`.eq("school_id"|"project_id", …)`), renders:
  - 4-stat strip (Total / Revenue / Pending / Completed) — mobile collapses 4→2.
  - Search box over student name, short order # (first 8 chars of uuid), full uuid, parent email, package name.
  - Order cards with student photo + name + status chip + class + order # + timestamp + package + parent email/phone, right-aligned total on desktop (stacked on mobile).
  - Expandable line items: "Show 5 items" button reveals a mini-table with Qty / Unit / Line total columns, plus Client note row if `special_notes` is set.
  - "Open full details" escape hatch → `/dashboard/orders?focus=${order.id}` (query param unused today; left in place for future deep-link).
  - Status chip colors / `STATUS_COLORS` kept in lockstep with `/dashboard/orders` for visual consistency.
  - Empty states: zero orders ("No orders yet — they'll appear here the moment parents place one"), no-search-match, no-scope-set dev guard.
- `app/dashboard/projects/schools/[schoolId]/orders/page.tsx` — **NEW** thin wrapper (~130 lines). Fetches `{id, school_name}` from `schools` for the header, renders `<GalleryOrdersPanel schoolId={schoolId} />`. Back-link to the school detail page.
- `app/dashboard/projects/[id]/orders/page.tsx` — **NEW** same pattern for events (~140 lines). Fetches `{id, title, client_name}` from `projects`.
- `app/dashboard/projects/schools/[schoolId]/page.tsx` — added `ShoppingBag` to lucide-react imports; inserted a full-width red-on-pink "View Orders" Link button in the aside between the Settings/Visitors button row and the Contact section.
- `app/dashboard/projects/[id]/page.tsx` — the existing "Orders" row in the Visitor Activity panel used to `window.location.href = "/dashboard/orders"` (global orders list). Now routes to `/dashboard/projects/${projectId}/orders` (per-event scoped). Comment added explaining the change.

Query shape used by the panel is a subset of what `/dashboard/orders` uses, filtered by `school_id` / `project_id`. RLS on `orders` + an explicit `supabase.auth.getUser()` check provide tenant isolation.

Typecheck clean (`npx tsc --noEmit` → exit 0) after all edits.

What's **NOT** in this slice (deferred to next round, per user's phased choice):
- "Printed in-studio" source badge for orders pushed from the desktop Flutter app. User chose the label "Printed in-studio" (over "Studio App / Cloud" or "Already fulfilled / Pending").
- One-click "Email order summary to parent" button. User confirmed an existing email setup is available — need to grep for `resend|sendgrid|postmark|transactional` and reuse when we build this.

### Dashboard modernization (uncommitted, latest addition)

Driven by Harout's request to declutter `/dashboard` ("feels too busy"), have Studio Assistant offer a dropdown of pre-written commands, make every element clickable, add a profile picture + name in the header, and take inspiration from a ShootProof screenshot he shared — specifically the "Recent Gallery Activity" middle card that drills into a full detail table on "View all".

Files touched:
- `app/dashboard/page.tsx` — major rework:
  - Header slimmed: 48px H1 dropped to 32/26 (mobile), verbose subtitle removed, "STUDIO OS OVERVIEW" eyebrow replaced with `Good morning|afternoon|evening · Wednesday, April 22`. Four-button action row collapsed to a single refresh icon + the new `ProfileBadge`.
  - `ProfileBadge` component added (right side of header): avatar pill (photographer `logo_url` if present, else gradient initials), business name, email, with a click-to-open menu containing Studio settings / Plan & billing / Sign out. Closes on outside-click via a mousedown listener.
  - `photographers` query now selects `logo_url`.
  - Photo Coverage stat card (previously non-clickable) is now a `<Link>` to `/dashboard/schools` with hover-shift + "Open →" affordance, matching the other three stat cards.
  - "Recent activity" middle panel replaced with **"Recent gallery activity"** — a 5-row mini-table styled like ShootProof's Reports view: GALLERY | PHOTOS | ORDERS | REVENUE columns, with a coloured type chip (School/Event) and a pending-orders pill. "View all →" links to `/dashboard/gallery-activity`. Each row clickable into the underlying school or project.
  - Orders query expanded from 20 → 200 rows and now selects `school_id` / `project_id` so the activity card + detail page can aggregate correctly. Added `galleryActivityItems` useMemo that joins orders-by-school and orders-by-project, pulls photo counts from `students`, and sorts by recency.
  - Unused imports pruned (Logo, Plus, Users).
- `app/dashboard/gallery-activity/page.tsx` — **NEW** detail page (~620 lines). Full table: Gallery name | Type | Date | Students | Photos | Orders | Pending | Revenue. Has a search box, all/schools/events toggle, sort select (recent/orders/revenue/name). Mobile collapses to a stacked card list. Every row links to the underlying school or project. SSR-safe via `Suspense` wrapper.
- `components/studio-assistant/command-bar.tsx` — chip strip `CommandBarExamples` replaced with a grouped `<select>` dropdown. 14 prompts in 4 optgroups (Today's overview / Orders & revenue / Schools & releases / Gallery optimization). Picking one fills the command bar so the user can hit Ask (or speak). Defaults re-reset to empty after a pick so the same prompt can be re-selected. `StudioAssistant` host component untouched — existing `onPick → setCommandValue` wiring keeps working.

Typecheck clean (`npx tsc --noEmit` → exit 0) after all edits.

### Also uncommitted in the working tree (staged by `git add -A`, commit failed on index.lock)

Everything below is staged in the git index but NOT committed — the sandbox couldn't clear its own `.git/index.lock` from a failed commit attempt. After clearing the lock on Mac, a single `git commit -m "…"` will pick them all up. Suggested message at the bottom.

- `CLAUDE.md` — this file (the handoff block + pending queue updates).
- `docs/design/thumbs-path-normalization.md` — NEW. Inventory + recommendation: defer the rename indefinitely.
- `scripts/cleanup-thumbs-orphans.mjs` — NEW. One-shot Supabase Storage cleanup for 651 orphan objects. Dry-run by default; `--commit` to execute. **Run from Mac** (sandbox has no service-role key). See "Pending task queue" block for env-bootstrap command.
- `app/dashboard/projects/events/page.tsx` — mobile pass #3: added `useIsMobile`; header stack (H1 48→28, "+ New Project" padding 20/28→12/18 + font 20→15); outer padding 24→14; grid minmax 240→160 (fits 2 cards per row on iPhone); floating action bar clamped full-width between 14px margins with smaller padding/fonts; context menu clamped to viewport.
- `app/dashboard/schools/page.tsx` — mobile pass #3: same pattern as events. outer padding 40→14; header stack (H1 26→22, subtitle 15→13); search+select row stacks vertically on mobile; grid minmax 240→160; floating action bar + context menu same clamps.

Typecheck clean (`npx tsc --noEmit` → exit 0) for both edited page files.

Suggested commit (run on Mac after `rm -f .git/*.lock` and before `git push`):
```bash
git commit -m "mobile pass #3: events + schools list, plus thumbs-cleanup staging" \
  -m "- Events list: header stack, grid 160px minmax (2-up), floating bar + menu clamp" \
  -m "- Schools list: same pattern" \
  -m "- thumbs-path-normalization.md: defer decision + rationale" \
  -m "- cleanup-thumbs-orphans.mjs: one-shot script for 651 orphans (dry-run/--commit)" \
  -m "- CLAUDE.md: handoff + queue state"
```

### Still owed to #57 mobile sweep (not yet on iPhone)

Tuned defensively this session (staged in the uncommitted-files block above) but still needs on-device screenshot verification:
- `/dashboard/projects/events` — mobile pass #3 applied
- `/dashboard/schools` (list) — mobile pass #3 applied

Not yet touched, apply the same `useIsMobile` pattern (grid collapse, reduce padding, wrap tables in horizontal scroll) when iPhone screenshots show breakage:
- `/dashboard/projects/[id]` (project detail)
- `/dashboard/projects/[id]/albums/[albumId]`
- `/dashboard/packages`
- `/dashboard/settings`
- `/dashboard/membership`
- `/dashboard/feature-requests`
- `/dashboard/backdrops`

Ask Harout to pull each up in Safari on iPhone, screenshot anything off, and tune in a fourth pass.

### Already landed this session (2026-04-22 evening)

- **#58 — Roster subfolders hidden in Project mode** (commit `6345bd6`, already on `origin/main`):
  - Web: `app/dashboard/projects/[id]/page.tsx` — added `isRosterCollection()` (regex `^\s*rosters?\s*$` against title/slug, or `kind === 'roster'`). `orderedCollections` filters them out; galleries chip subtracts `rosterCount`.
  - Desktop Flutter: `~/Downloads/Whitephoto_Studio_App_MVP_Source/lib/screens/project_admin_screen.dart` — `_filteredAlbums` getter now skips any album matching the same roster regex. **Rebuild required**: `cd ~/Downloads/Whitephoto_Studio_App_MVP_Source && flutter build macos`.
  - Scope per user: UI filter only. Disk folders and DB `collections` rows untouched (user explicitly picked "Hide via UI filter only" via AskUserQuestion).

- **#57 — Mobile compatibility sweep (Tier 3 dashboard)**:
  - `app/dashboard/layout.tsx` — mobile path now renders a sticky black topbar with `<Logo small />` + hamburger (Menu/X from lucide-react). Drawer is a full-height black overlay that locks `document.body.style.overflow` while open and auto-closes if viewport grows past the mobile breakpoint. Desktop path unchanged.
  - `app/dashboard/page.tsx` — `useIsMobile`; stat grid 4-col → 2-col; bottom panel grid 3-col → 1-col; main padding 32 → 14 on mobile.
  - `app/dashboard/orders/page.tsx` — `useIsMobile`; header flex column + smaller H1 + email badge hidden on mobile; detail panel goes full-width static on mobile; stat grid 4 → 2; **orders table wrapped in horizontal-scroll container** (`overflow: auto` + inner `minWidth: 720`) so all 8 columns stay readable.
  - `useIsMobile` hook lives at `lib/use-is-mobile.ts` (640px `window.matchMedia` breakpoint, already existed before this session).

### Not yet verified on device (still owed to #57)

User hasn't sent screenshots for these dashboard sub-pages on iPhone. All likely need the same mobile-tuning pass (grid → stacked, reduce padding, table → horizontal scroll):
- `/dashboard/schools`
- `/dashboard/projects/events`
- `/dashboard/projects/[id]` (project detail)
- `/dashboard/projects/[id]/albums/[albumId]`
- `/dashboard/packages`
- `/dashboard/settings`
- `/dashboard/membership`
- `/dashboard/feature-requests`
- `/dashboard/backdrops`

**Next step when resuming:** ask user to pull up each in Safari on iPhone, screenshot anything broken, and we'll tune those pages in a second pass. If no screenshots, pick the highest-traffic page (`/dashboard/projects/events` or `/dashboard/schools`) and eyeball the JSX to apply the same `useIsMobile` pattern.

### Sandbox gotchas that WILL bite again

- Git inside the Cowork bash sandbox CAN commit but CANNOT clear its own `.git/*.lock` files (permission denied on unlink). Harout has to run `rm -f .git/HEAD.lock .git/index.lock` on his Mac terminal between sessions when things get stuck. The sandbox also can't `git push` (no SSH key, no PAT) — every push must happen from Mac.
- The Flutter source at `~/Downloads/Whitephoto_Studio_App_MVP_Source/` is NOT mounted in the bash sandbox, so `flutter analyze` / `dart` won't run there. Read/Write/Edit DO work on that path though, and changes are picked up on the next `flutter build macos` Harout runs.
- Dart edits to the Flutter app are verified by **code inspection only** (no compiler feedback until Harout rebuilds). Be extra careful with types.

### Quick context pointers for deep memory

- `memory/glossary.md` — shorthand + acronyms ("PIN login", "backdrop", "proof", etc.)
- `memory/people/harout.md` — user profile, communication style, studio context
- `memory/projects/studio-os-cloud.md` — repo / stack / deploy paths
- `memory/projects/flutter-backdrop-manager.md` — desktop app structure + build commands
- `memory/context/supabase.md` — project id, tables, known policies, SQL gotchas

---

## Who / what

- **User:** Harout (harout@me.com as photographer, whitephotostudio@hotmail.com on Cowork)
- **Studio:** WHITE PHOTO
- **photographer_id:** `ed6b8a99-1f38-48f3-a198-447c49b5ac34`
- **Supabase project:** `bwqhzczxoevouiondjak`
- **Repo:** `/Users/harouthagopian/Projects/studio-os-cloud-site` (Next.js 16.1.6 w/ Turbopack, deployed on Vercel, origin/main)
- **Storage:**
  - **Gallery media (photos):** Cloudflare R2 bucket `whitephoto-media` is still the active write path, fronted by a private bucket + signed URLs. The standalone R2 scripts (`scripts/reupload-gallery-originals.mjs`, `compress-old-photos.mjs`, `migrate-to-r2.mjs`) still use it.
  - **Backdrops:** **Supabase Storage `backdrops` bucket (public) is the only live origin.** The desktop Flutter app writes here directly. The old Cloudflare R2 public hostname `pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev` is **DEAD for backdrops** — every URL there now fails to load in the browser ("Load failed"). Verified 2026-04-22 via `tmp-backdrop-probe.html` in Safari. All 53 old R2-hosted rows in `backdrop_catalog` were rewritten to Supabase URLs (same storage paths exist in Supabase). Any future catalog row referencing `r2.dev/backdrops/...` is a regression.
- **Desktop app:** Flutter/Dart "Backdrop Manager". **The REAL, active Flutter source lives at `~/Downloads/Whitephoto_Studio_App_MVP_Source/`** — NOT at `.studio_os_flutter/` inside the Next.js repo. The in-repo `.studio_os_flutter/` is a stale snapshot (and is gitignored); editing it will not change Harout's app. When patching Dart code, edit `~/Downloads/Whitephoto_Studio_App_MVP_Source/lib/...` directly, then `flutter build macos` from that folder. The built binary opens from `~/Downloads/Whitephoto_Studio_App_MVP_Source/build/macos/Build/Products/Release/Studio OS.app`. The desktop app talks **directly** to Supabase Storage + PostgREST — it does **NOT** call the Next.js `/api/dashboard/*` routes for backdrop push (older docs said otherwise — they were wrong).

---

## Architectural gotchas (don't re-learn these)

- **Real backdrops table is `backdrop_catalog`**, NOT `backdrops`. There is no `backdrops` table in `public`. Earlier ownership checks queried a non-existent table and silently rejected every upload.
- **`proxy.ts` at repo root is the LIVE middleware file on Next.js 16.** Next.js renamed `middleware.ts` → `proxy.ts` in v16 and the function export is `proxy(request)` (not `middleware`). If BOTH files exist the build fails hard with `Error: Both middleware file "./middleware.ts" and proxy file "./proxy.ts" are detected. Please use "./proxy.ts" only`. Do NOT recreate `middleware.ts`. Rate limiting + security headers live in `proxy.ts` and run on every request matching its matcher. (Earlier notes in this doc called proxy.ts "dead code" — that was true on Next 15 and is now wrong. Corrected 2026-04-22.)
- **Upstash env vars** (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) drive `lib/rate-limit.ts`. If missing or malformed it falls back to an in-memory map. Init is now wrapped in try/catch so a bad env var doesn't crash the route.
- **Safari's "The string did not match the expected pattern"** is a DOMException from `response.json()` on non-JSON (HTML 500). Always defensively parse JSON in client fetch handlers.
- **Git lock files:** The Cowork bash sandbox can't clear `.git/HEAD.lock` / `.git/index.lock` (permissions). Harout has to clear them from his Mac terminal: `rm -f .git/HEAD.lock .git/index.lock`.
- **Supabase MFA:** `getAuthenticatorAssuranceLevel()` gates the sign-in page. Stale TOTP factors live in `auth.mfa_factors` and their open challenges in `auth.mfa_challenges`. Delete challenges first, then the factor.
- **Supabase MCP `get_logs` valid services:** `api | branch-action | postgres | edge-function | auth | storage | realtime`. NOT `postgrest`.

---

## Today's work — 2026-04-21

### What broke
1. **Backdrop upload** had been 403'ing for weeks. Desktop app showed stale "Pushed 36 backdrops to cloud" banner but 37 total → new backdrops couldn't be pushed.
2. **Parents portal PIN login** failed with Safari DOMException "The string did not match the expected pattern".
3. **Photographer sign-in** blocked by a TOTP 2FA screen; Harout didn't have the authenticator.

### What we found
- `assertKeyOwnedByPhotographer` in `app/api/dashboard/upload-to-r2/route.ts` (and mirror in `generate-thumbnails/route.ts`) was querying `service.from("backdrops")` with column `storage_path`. Neither existed. Query returned null → `{ ok: false }` → 403. Introduced in commit `bff6c0e` (Post-breach hardening sweep).
- PIN login DOMException was the client choking on an HTML 500 from the API route. Most likely cause: `Redis.fromEnv()` or `new Ratelimit()` throwing synchronously if Upstash env vars are malformed, crashing the route before its JSON catch block runs.

### Fixes shipped (now on origin/main)
- `5313fc8` — Round 8: persistent rate limiter via Upstash Redis
- `f3b375d` — fix: backdrop upload blocked by broken ownership check
  - `app/api/dashboard/upload-to-r2/route.ts`: replaced broken DB lookup with path-shape check (`second === photographerId`) for `backdrops/{photographerId}/...`.
  - `app/api/dashboard/generate-thumbnails/route.ts`: same mirror fix.
- `51270c7` — harden login response parse + rate-limit init
  - `lib/rate-limit.ts`: wrapped `Redis.fromEnv()` and `new Ratelimit()` in try/catch with `redisInitFailed` flag; falls back to in-memory limiter on init failure instead of 500'ing.
  - `app/parents/LoginForm.tsx`: defensive `response.json()` parse in both `handleSchoolLogin` and `handleEventLogin` — shows friendly "Server error…" instead of raw DOMException.

### Supabase ops
- Deleted stale MFA factor `5750ddee-c88a-4f90-bad6-e1540b5c830a` enrolled at 2026-04-21 22:32 UTC. Cleared related rows in `auth.mfa_challenges` first, then `auth.mfa_factors`.

### Status
- First three commits (`5313fc8`, `f3b375d`, `51270c7`) pushed to `origin/main`. Vercel redeployed — but backdrop push STILL not working.
- Deeper dig found the real blocker: **a third route had the same broken `backdrops` table query**.
  - `app/api/dashboard/storage-folder/route.ts` — the desktop app calls this before uploading, and when it 403'd the app bailed before ever reaching upload-to-r2. Explains why Supabase shows **zero INSERTs into `backdrop_catalog` since 2026-04-04** despite the upload endpoint itself being fixed.
- Fourth commit `4e8e2ea` applies the same path-shape check (`second === photographerId`) to storage-folder. Committed locally in the Cowork sandbox; **sandbox can't push — user must push from Mac terminal**:
  ```bash
  cd ~/Projects/studio-os-cloud-site && git push origin main
  ```
- After user pushes and Vercel redeploys (~2 min), retry "Push to Cloud" on the Book backdrop.

### Diagnostic evidence
- `SELECT count(*) FROM backdrop_catalog WHERE photographer_id='ed6b8a99…'` → 53 rows, newest `created_at` = `2026-04-04 05:01:34`. No inserts in 17+ days, matching the post-breach hardening sweep deploy window.
- Desktop UI says 37 Total but DB has 53 — UI is counting local-only state, not cloud truth. Expected drift; will self-heal once pushes start succeeding.
- Supabase API logs show the Dart/3.11 client issuing PATCH /rest/v1/backdrop_catalog (metadata sync) but **no POSTs** to that table, confirming the upload pipeline never completes.

---

## 2026-04-22 — Permanent fix for silent sync drift (task #55)

### The real root cause of "Book won't push"
After the three Next.js route fixes (`f3b375d`, `51270c7`, `4e8e2ea`) deployed, the Book backdrop **still wouldn't push**. Reading the Flutter source at `.studio_os_flutter/lib/services/backdrop_sync_service.dart` revealed:

1. The desktop app's "Push to Cloud" button bypasses all Next.js routes entirely. It calls `Supabase.instance.client.storage.from('backdrops').uploadBinary(...)` and `_sb.from('backdrop_catalog').insert(...)` directly.
2. The per-entry loop in `syncBackdrops` had `catch (e, st) { debugPrint(...); }` — every error was **silently swallowed**. UI only showed the `synced` counter, so "Pushed 36 / 37 Total" gave no hint which entry failed or why.
3. This is why the Next.js route patches didn't help: the upload path they fixed isn't the one the desktop uses.
4. Supabase RLS on the `backdrops` bucket and `backdrop_catalog` table is permissive and correct — not the blocker. Whatever was breaking for Book was invisible to us.

### Permanent fix — make errors visible
Edited `.studio_os_flutter/lib/services/backdrop_sync_service.dart` and `.studio_os_flutter/lib/screens/backdrop_manager_panel.dart`:

- Introduced `BackdropSyncResult { int synced, int total, List<BackdropSyncFailure> failures }` and `BackdropSyncFailure { entryName, localPath, stage, message }`. `stage` = `file-missing | upload | insert | update`.
- `syncBackdrops` now returns `Future<BackdropSyncResult>` instead of `Future<int>`. Errors are captured with their stage context instead of silently discarded. The previously-silent "file missing → continue" branch now records a `file-missing` failure too.
- `_pushToCloud` in the UI panel consumes the result, stores `_lastSyncFailures` in state, sets a "⚠️ Pushed X/Y. Failed: …" status banner for partial success, and auto-opens a failure-details dialog.
- The dialog has a **Copy details** button so Harout can paste the exact error message. A persistent "Details (N)" button stays in the status bar after dismissal.

### Why this is the permanent fix
The bug is no longer "Book doesn't push" — it's "we don't know why Book doesn't push". Once the rebuilt Flutter app runs, the next push attempt will either succeed or will show the exact error on screen (RLS rejection text, file-not-found path, Postgres check violation, network hiccup, whatever). From there the fix is whatever the surfaced error calls out — and future invisible drifts become self-diagnosing.

### Deploy path
- The Flutter source at `.studio_os_flutter/` is **gitignored** in this repo — no `git push origin main` needed for these edits; they live only on Harout's disk.
- To pick up the fix, rebuild the desktop app:
  ```bash
  cd ~/Projects/studio-os-cloud-site/.studio_os_flutter
  flutter build macos   # (or flutter run for a dev build)
  ```
  Then relaunch the Backdrop Manager and click "Push to Cloud" on Book.
- Expected outcome: either the push succeeds (if the silent failure was transient), or an orange banner + dialog shows the exact failure for Book. Copy-paste that into the next Cowork message and we finish the diagnosis.

### Key files touched 2026-04-22
- `.studio_os_flutter/lib/services/backdrop_sync_service.dart` — added `BackdropSyncResult`, `BackdropSyncFailure`, changed `syncBackdrops` return type, added stage tracking.
- `.studio_os_flutter/lib/screens/backdrop_manager_panel.dart` — `_pushToCloud` now consumes result; `_showSyncFailuresDialog` added; status-bar "Details" button; orange color for ⚠️ status; import `flutter/services.dart` for Clipboard.

---

## 2026-04-22 (late) — Parents-portal backdrop grid empty (task #56)

### Symptom
After Book pushed successfully, the parents-portal backdrop grid still showed mostly empty gray tiles. `backdrop_catalog` had 54 rows with files in Supabase Storage, but the grid wouldn't render them.

### Root cause
**Cloudflare R2 public bucket `pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev` is dead.** Confirmed by loading 4 sample thumbnails in Safari (`tmp-backdrop-probe.html`): both R2 URLs → "Load failed"; both Supabase URLs → HTTP 200. 53 of the 54 rows in `backdrop_catalog` pointed at the dead R2 host for `image_url`, and 39 pointed there for `thumbnail_url`.

### Fix
Rewrote the 53 rows in-place via Supabase MCP SQL. Same storage paths, only the host changes:

```sql
UPDATE backdrop_catalog
SET image_url     = REPLACE(image_url,     'https://pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev/backdrops/', 'https://bwqhzczxoevouiondjak.supabase.co/storage/v1/object/public/backdrops/'),
    thumbnail_url = REPLACE(thumbnail_url, 'https://pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev/backdrops/', 'https://bwqhzczxoevouiondjak.supabase.co/storage/v1/object/public/backdrops/')
WHERE photographer_id = 'ed6b8a99-1f38-48f3-a198-447c49b5ac34'
  AND (image_url LIKE '%pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev%'
    OR thumbnail_url LIKE '%pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev%');
```

Verification query confirmed: `remaining_r2_rows=0`, `image_files_missing=0`, `thumb_files_missing=0` across all 54 rows. Every referenced object exists in the `backdrops` bucket.

### Followups worth doing
- ~~`backdrop_catalog` has 18 **duplicated Textures names**~~ **RESOLVED 2026-04-22 (late).** Verified via Supabase MCP: table is now 36 rows, zero duplicate names, every referenced image and thumbnail file exists in the `backdrops` bucket. 54 → 36 = 18 rows deleted — likely by Harout via the Backdrop Manager UI between the two checks. No SQL action needed.
- The old R2 migration helpers (`scripts/migrate-to-r2.mjs` etc.) still exist but write to the `whitephoto-media` bucket, not `backdrops`. Leave alone for now.
- `tmp-backdrop-probe.html` at repo root is a throwaway diagnostic — delete if you don't want it around.

---

## Pending task queue (picked up from prior context)

- **#7** [design drafted 2026-04-22] Design data model + workflow for both modes — v1 written to `docs/design/data-model.md`. Awaiting Harout's review before migration-plan follow-up (`docs/design/data-model-migration.md`). Core proposal: one `projects` anchor with `mode` enum + `project_schools` / `project_events` sidecars; unified `portal_access_tokens` replaces the three PIN fields; collapse visitor/download/favorite tables to one set of `portal_*` tables.
- **#47** Round 6g — cross-studio storage policy tightening (DONE 2026-04-22: backdrops tightened + thumbs dedup'd; nobg-photos/thumbs tenant isolation deferred until a path → owner resolver exists)
- **#49** Round 7b — Zod coverage fan-out to remaining dashboard routes (DONE)
- **#51** Round 9 — Audit logging design + schema (DONE)
- **#52** Round 10 — Refund revalidation design + impl (DONE)
- **#57** Mobile-compat sweep — pass #2 committed as `4133b0d` (NOT pushed). See top handoff block. Still owed: screenshot test on remaining dashboard sub-pages.
- **Cleanup:** `proxy.ts` at repo root — confirmed LIVE on Next.js 16 (NOT dead). See gotchas section.
- **Thumbs path normalization** — **DECIDED 2026-04-22: defer indefinitely.** Full rationale in `docs/design/thumbs-path-normalization.md`. Round 6g.2 already achieves tenant isolation for `thumbs` by requiring service-role for writes. The rename of 2,152 storage objects + 1,152 `media.storage_path` rows is non-atomic and would flicker live galleries for the benefit of re-enabling client-side writes we don't need. Revisit only if a future feature forces authenticated-browser writes to `thumbs`.
- **Thumbs orphan delete (side-cleanup)** — script staged at `scripts/cleanup-thumbs-orphans.mjs`, **NOT yet run**. Targets 651 orphan objects under 5 prefixes (`udz1lw0s1dmc/`, `st3xmgmyummu/`, `eeiikg7fc9pd/`, `ae3204ed-d549-45f8-ba13-b6cdde3a7e73/`, `schools/`). Cross-check against all 13 url-ish columns in `public` schema returned zero references. Harout must run from Mac with service-role key — sandbox has no credentials and can't reach Supabase Storage API:
  ```bash
  cd ~/Projects/studio-os-cloud-site
  # Dry-run first to confirm counts match expected 651:
  env $(grep -v '^#' .env.local | xargs) node scripts/cleanup-thumbs-orphans.mjs
  # Then commit:
  env $(grep -v '^#' .env.local | xargs) node scripts/cleanup-thumbs-orphans.mjs --commit
  ```
  Expected: bucket drops from 2,152 → 1,501 objects. Live galleries unaffected (zero DB refs).
- **Thumbs `media.thumbnail_url` R2 backfill (side-cleanup)** — **NOT scheduled.** All 1,152 rows in `media` have `thumbnail_url` pointing at the dead `pub-481e5f05e38c4bde98f61e0bcc309728.r2.dev` host, but these values are **cosmetic** — `lib/storage-images.ts` derives URLs from `storage_path` via `buildStoredMediaUrls()`, which prefers an existing thumbnail URL only if it's non-empty AND different from the `originalUrl` AND not already an original-storage URL. Since the dead R2 URLs satisfy all three, `thumbnailUrl` resolves to the dead URL on read. **⚠ This means parents-portal thumbnails likely have the same rendering issue we fixed for backdrops on 2026-04-22.** Before backfilling, Harout should load a recent photo gallery and confirm whether thumbnails render (they might, if the client falls through to `originalUrl` via CSS onerror, but no such fallback exists in `storage-images.ts`). If broken, run the same `REPLACE(...)` SQL pattern we used for `backdrop_catalog` against `media.thumbnail_url` and `media.preview_url`. Deferred from this session because egress from the sandbox can't verify R2 liveness directly.

---

## 2026-04-22 (evening) — Round 6g landed, narrowed scope (task #47)

### What changed
- `backdrops` bucket now has proper tenant isolation on writes. Three permissive policies (`Auth upload/update/delete backdrops` — gated only on `auth.role()='authenticated'`) were dropped and replaced with `Photographers insert/update/delete own backdrops`, each gated on `(storage.foldername(name))[1] IN (select id::text from photographers where user_id = auth.uid())`. Service-role writes bypass RLS so webhooks/scripts still work. Public SELECT policy preserved.
- `thumbs` bucket had TWO duplicate permissive policy sets ("Authenticated users can …" + "authenticated can …"). Dropped the lowercase set; kept the "Authenticated users can …" set. No semantic tightening — just dedupe.

### Why scope was narrowed
Checked actual storage row path shapes before applying:
- `backdrops`: 100% of rows use `{photographerId-UUID}/…` as the first folder → safe to gate on photographer ownership.
- `nobg-photos`: MIXED path shapes (some UUID, some project slugs like `f0xb989xqhwj/…`). Gating on `foldername[1] = owned photographer_id` would lock out every project-slug path.
- `thumbs`: even messier — literal `projects/`, `schools/`, plus short slugs.

This explains why the previous Round 6g attempt (before today) was rolled back — it assumed uniform UUID paths.

### Deferred follow-ups
- ~~Build a `public.caller_owns_storage_path(bucket, name)` helper…~~ **Superseded by Round 6g.2 below.**
- Normalize stray `thumbs/projects/…` and `thumbs/schools/…` legacy paths into tenant-scoped folders if we ever want to allow client-side writes to `thumbs` again.

### Files / artifacts
- `supabase/migrations/20260422160000_round6g_tighten_backdrops_storage.sql` — the applied migration.
- `docs/rollback/round-6g-rollback.sql` — updated to reflect the narrowed scope. Runnable if we need to revert.

---

## 2026-04-22 (evening) — Round 6g.2 landed, nobg-photos + thumbs locked (task #47)

### What changed
- `nobg-photos` bucket now has zero authenticated write policies. Dropped `Auth upload nobg` and `Auth update nobg`. (No DELETE policy existed to begin with.) Public SELECT policy preserved.
- `thumbs` bucket now has zero authenticated write policies. Dropped the remaining `Authenticated users can upload/update/delete` set. Public SELECT policy preserved.
- Writes to both buckets now require the **service-role key** (bypasses RLS) — which is how the Next.js API routes and maintenance scripts already work.

### Why this is safe
Full code audit before applying:
- Desktop Flutter app writes to `nobg-photos` / `thumbs` are actually **R2 S3-compatible writes**, not Supabase Storage writes. The bucket name collision is incidental. Confirmed in `~/Downloads/Whitephoto_Studio_App_MVP_Source/lib/services/cloud_sync_service*.dart` — every write goes through `_r2.uploadBinary(...)`.
- Parents-portal web code (`app/parents/[pin]/page*.tsx`) only calls `.list()` and `.getPublicUrl()` on these buckets. Zero writes.
- Next.js API routes grep for `'nobg-photos'` / `'thumbs'` → zero hits. All writes live in `scripts/*.mjs` and `tmp_*.mjs` which use the service-role key.

### Net effect on attack surface
Before Round 6g: any authenticated photographer (any other tenant) could upload, update, or delete arbitrary files in `backdrops/`, `nobg-photos/`, and `thumbs/`. Major cross-tenant write risk.
After Rounds 6g + 6g.2: `backdrops/` writes require photographer-id-owned-by-auth.uid; `nobg-photos/` and `thumbs/` writes require service-role. All public SELECT reads preserved. `studio-logos/` untouched (already properly isolated).

### Files / artifacts
- `supabase/migrations/20260422170000_round6g2_lock_nobg_thumbs_writes.sql` — the applied migration.
- `docs/rollback/round-6g-rollback.sql` — updated again to cover 6g.1 + 6g.2 together.

---

## Next step after today's verify

Once Harout confirms the Book backdrop push succeeded and the PIN login works (or gives us a better error than the Safari DOMException), the obvious next pick from the queue is **Round 7b (Zod fan-out)** — it's mechanical, low-risk, and broadens the input validation the breach hardening started. Round 6g (storage policy tightening) is higher-value but previously got rolled back; revisit with a safer migration plan.

---

## Key files touched this session

- `app/api/dashboard/upload-to-r2/route.ts`
- `app/api/dashboard/generate-thumbnails/route.ts`
- `lib/rate-limit.ts`
- `app/parents/LoginForm.tsx`
- `proxy.ts` (flagged dead code, not modified)
- `app/sign-in/page.tsx` (read, not modified — standard Supabase MFA flow)
- `app/dashboard/backdrops/page.tsx` (read — confirmed writes go to `backdrop_catalog`, key shape is `backdrops/${pgId}/${Date.now()}_${i}_${random}.${ext}`)
