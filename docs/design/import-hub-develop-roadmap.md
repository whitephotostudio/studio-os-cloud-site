# Import Hub + Develop Module Roadmap

Live working document — what's shipped, what's next, what's deferred.  Updated as the work moves.

Last updated: 2026-04-27.

---

## ✅ Shipped (this multi-session sprint)

### Import Hub
- Three-tab Import Hub (Cloud / SD Card / Folder)
- RAW preview thumbnails via Core Image embedded-JPEG extraction
- `raws/` folder convention (RAWs land in subfolder, never upload)
- Cloud sync skips `raws/` defensively
- Compact destination picker (single horizontal row, mode dropdown)
- Auto-collapsing destination breadcrumb when both selectors are set
- Compact header (44→30px icon, dropped subtitle)
- Tab strip slimmed (44→32px)
- Source breadcrumb (was a fat card, now thin row)
- Thumbnail size slider (70–260px)
- Filmstrip / Loupe view with big preview + horizontal strip
- Shift+click range selection
- Drag-to-lasso select (toggle mode in bottom bar)
- Select all / Deselect all / Hide duplicates
- Pick / Reject flags + filter dropdown (P / X / U keys in filmstrip)
- Shoot day filter dropdown (auto-grouped by EXIF capture date)
- EXIF tooltips on hover (ISO / shutter / aperture / focal / camera / lens)
- Burst auto-stack (group photos within 2 seconds, "× N" badge)
- Auto-detect SD/CFast/CD inserts via NSWorkspace volume monitor
- "Develop now" button in import-success dialog
- Delete to Trash menu (rejects / selected / already-imported)
- One-button bottom bar with all controls

### Develop Mode
- Fullscreen wrapper (Navigator route, Cmd+W / ESC closes)
- "Fullscreen" entry buttons in sorter + project-sorter screens
- Auto-include RAW siblings from `raws/` folder
- New tool tabs in right panel: Curve / HSL / Grade / Detail v2 / Lens / Portrait
- Tone Curve (5-point parametric)
- HSL panel (per-color hue/sat/lum × 8 colors)
- Color Grading wheels (Shadows / Highlights, Midtones reserved)
- Detail v2 panel (sharpening + noise reduction)
- Lens Corrections panel (distortion / vignetting / CA)
- AI Portrait panel (face-aware skin smoothing + subject-mask background blur)
- Expanded crop preset list (4×6, 5×7, 8×10, 11×14, 16×20, Wallet, etc.)
- Auto button now uses Apple's Core Image auto-enhance
- Sync Settings (one-shot push edits to N selected photos)
- RAW/JPG filter pills in filmstrip header
- Customizable Export dialog (px/in/cm, DPI, color space, output sharpening, watermark, filename pattern)
- Built-in export presets + saved custom presets
- **Masking edge visualization (Lightroom Option-drag).**  Hold Option/Alt while dragging the Detail panel's *Masking* slider — the canvas swaps to a black-and-white edge map (white = pixels that survive the mask and get sharpened, black = protected) so you can dial the slider until smooth skin / sky areas turn black.  Uses `CIFilter.edges` → grayscale → contrast scaled by masking value, returned as PNG bytes via the `studio_os/raw_processor` channel.  Cached client-side, quantized to nearest 5 for instant feedback.
- **Pro skin smoothing pipeline.**  Replaces the single-Gaussian-blur with five-stage Lightroom-style retouching: refined skin-only mask (face contour minus eyes/eyebrows/lips/nose/pupils with feathered edges) → edge-preserving surface blur via `CIFilter.noiseReduction` → light tonal Gaussian → soft-light texture overlay (preserves pores) → strength mix + masked blend.  Eliminates the plastic look that the old pipeline produced.
- **AI Eye Enhance.**  Vision face landmarks → iris-only mask → brightness + saturation + unsharp-mask lift inside the iris.  At slider > 40 a subtle white catchlight dot is added at the top of each pupil for the "alive" portrait look.  Preserves eyelid skin around the iris.
- **AI Teeth Whiten.**  Vision innerLips landmark → feathered mouth-opening mask → blanket brightness lift + saturation drop + subtle warm-to-neutral cooling.  Doesn't touch lips, gums, or surrounding skin.  Stays away from blue-tint overshoot.
- **Live AI Portrait preview.**  Skin smoothing, background blur, eye enhance, and teeth whiten — all spatial Vision filters that can't ride the ColorFilter matrix — now render at 1600 px preview resolution and the canvas swaps to the result while you drag the sliders.  250 ms debounced, 24-entry LRU cache keyed by path + quantized adjustments, generation token for race resolution.  Replaces the old "applied at export" caveat.
- **Clickable history sidebar.**  Right-panel timeline of every undo snapshot.  Each chip auto-labels what changed (Exposure / Curve / HSL / Crop / Eyes / Teeth / Skin / Lens / etc.).  Click any prior step to jump back; a "Now" pill marks current state.  Capped at 8 most-recent entries to keep the strip thin.
- **Pro presets pack — 8 looks.**  Portra 400, Velvia, B&W Classic, Cinematic (teal/orange), Modern Wedding, Cool Editorial, Warm Vintage, Skin Tone Boost (uses the new AI Portrait fields).
- **Auto Crop via Vision saliency.**  `VNGenerateAttentionBasedSaliencyImageRequest` finds the most-attended region; one click in the Crop tool snaps the crop frame to it.  Honors a locked aspect ratio (e.g. 8×10) by centering the constrained rect on the saliency bounding box.
- **Auto Straighten via Vision horizon detection.**  `VNDetectHorizonRequest` returns the angle needed to level the photo; capped at ±15° to reject wild detections on featureless skies.  Replaces the previous "reset angle to 0" no-op.
- **Auto Lens Correction.**  Auto button in the Lens panel reads EXIF focal length (and lens model where available) and applies a sensible distortion + vignetting starting point based on focal-length category — ultra-wide / wide / normal-wide / normal / short tele / tele / super-tele.  Photographer fine-tunes from there.
- **Local Masks — radial mask MVP.**  New "Masks" tool in the Develop toolbar.  Drag on canvas to create a radial mask, drag center to move, drag edge to resize.  Each mask carries its own slider stack: Exposure / Contrast / Highlights / Shadows / Temperature / Tint / Saturation / Clarity / Sharpness / Feather, plus an Invert toggle.  "Show Mask" paints the masked region in semi-transparent red on the canvas so you can see exactly where the effect applies.  Multi-mask support — masks layer in array order like Lightroom.  Renders at export via Core Image: each mask gets its own adjusted CIImage rendered through a feathered alpha mask, then composited onto the global pipeline output.  Linear / brush / AI subject masks are the next sub-feature; same data model, same render path.
- **Bulk Import service.**  Replaces the synchronous file-copy loop on the Project Sorter that froze the UI on 300+ photo imports.  Yields to the event loop every 8 photos, reports per-file progress to a modal dialog with a real Cancel button, and dedupes against `ImportHistoryService` + same-name-same-size files at destination so re-running an import after a cancel skips what's already there.  Drives every Import button in the Project Sorter.
- **Project Sorter Select All + Bulk Delete.**  Toolbar gains "Select All" / "Deselect" / "Delete N" buttons in a flat header row (was a ListTile trailing that got clipped on narrow viewports).  Cmd/Ctrl-click toggles individual photos into the bulk set, Shift-click extends a range from the last single-selected photo.  Bulk delete moves photos to the macOS Trash via `FileManager.trashItem` (recoverable from Finder), with a confirmation dialog showing the count.  Falls back to `File.delete` if the platform channel isn't available.  Keyboard shortcuts: **Cmd/Ctrl+A** = Select All, **Cmd+Shift+A** = Deselect, **Cmd+Backspace** = Delete selected.  Tooltips on the buttons document each shortcut.
- **Cloud sync transparency overhaul.**  Was reporting "All up to date · 100%" even when 0 photos moved.  Three fixes shipped together:
  1. **Per-photo progress counter** — every photo upload reports its 1-based index + filename to the per-school state.  The Cloud screen card now shows live "Photo 247 of 489 · DX3_9974.jpg" while the loop runs, replacing the opaque summary.
  2. **Force re-upload escape hatch** — bypasses the existing-keys dedup cache so every local photo is treated as new.  Surfaced via a red `cloud_sync` icon button next to Upload Selected (with tooltip), or by long-pressing the Upload button.  Uses when the desktop says "synced" but the web album shows fewer photos than expected.
  3. **Loud diagnostics** — the "no album collections" early-bail (which used to return success) now logs `⚠️ project X has no album collections` and surfaces "No album collections — nothing to upload" to the per-school message.  Every API mismatch (`inserted + skipped < attempted`) prints `⚠️ desktop-media API mismatch` with the raw payload to the macOS Console.  Final summary banner reports actual totals: `Cloud sync complete — N uploaded · M already synced` instead of a blanket "complete".

### RAW pipeline (Swift + Core Image)
- `macos/Runner/RawProcessor.swift` platform channel
- Native CIRAWFilter demosaic for every Apple-supported camera
- Three-tier preview extraction (embedded JPEG → CIRAWFilter → CIImage)
- Vision framework face detection
- Vision skin smoothing (face-aware Gaussian blur on skin)
- Vision foreground subject mask + background blur (macOS 14+)
- Trash helper via FileManager.trashItem
- AppDelegate registration moved to MainFlutterWindow.awakeFromNib

### Volume monitor
- `macos/Runner/VolumeMonitor.swift` — NSWorkspace mount/unmount events
- Camera card detection via DCIM folder probe
- Optical disc detection via removable+ejectable+readonly heuristic
- Snackbar banner with "Open Import Hub" CTA on insert

---

## 🚧 In design / next up (recommended order)

### Tier 1 — sharpest wins (this session)

- **Auto-tone matching across a class.** Pick a hero shot in Develop, press "Match selected", every other selected photo gets the same exposure / WB / tone curve.  Implementation: read source `PhotoAdjustments`, copy the relevant fields, save sidecars for each target.  ~30 min.
- **Before / After split viewer in Develop.** Vertical drag-to-split line in the canvas — left = original (no adjustments), right = current edits.  Toggle button in the right panel.  ~45 min.
- **Push edits to cloud.** Supabase `photo_edits` table mirrors the sidecar JSON, keyed on photographer_id + canonical photo path (school/class/student/filename).  AdjustmentStore.save() debounces a cloud upsert.  Cloud-pull writes sidecars back when files arrive on a fresh Mac.  Tier 1 because it unblocks the "new computer" flow Harout originally cared about.  ~2h.

### Tier 2 — quality of life (next session)

- **Watermark rendering in Export dialog.** The toggle exists; needs Core Image text overlay at the bottom-right of the rendered JPG.
- **Bulk rename on import.** Pattern field in the import-confirm dialog: `{school}_{class}_{student}_{seq}.jpg`.  Photographer can pick at import time so the Lab gets clean filenames.
- **Histogram in Develop's main tool panel.** Already exists in left navigator; a duplicate at the top of the right tool stack helps exposure judgment.
- **"Import + delete from card" combo button.** One click: copy everything ticked, then trash from SD card.
- **Keyboard shortcut overlay (`?` key).** Modal listing every shortcut.
- **Smart Albums.** Saved filter combos: "Picks last 7 days", "Edited but not exported", etc.
- **Dark mode for Import Hub.** Currently always light; mac users on dark mode see a jarring switch.

### Tier 3 — bigger features (each is its own session)

- **Local masking (radial / linear / brush).** Drop a mask on the canvas, each mask carries its own slider stack.  Apply at export via Core Image alpha composite.  This is the single biggest Lightroom feature we don't have.
- **Spot heal / clone brush.** Paint over blemishes; Core Image fills from surrounding pixels.
- **AI denoise.** Bundle a Core ML noise model for high-ISO gym shots.
- **Sky replacement.** Vision sky segmentation + composite a stock sky.
- **Background ingest + crash-safe resume.** Big imports (1000+) run in the background with a global progress toast.  Journal file lets the next launch pick up exactly where it died.
- **Auto-stack tighter heuristics.** Use lens focal length + camera settings for smarter stacks (continuous-shoot bursts vs deliberate retakes).
- **Print contact sheet.** Generate a multi-photo PDF for client review.

### Tier 4 — web-side (separate from Flutter)

- Photo gallery upload progress with retry
- Per-school storefront templates
- Storefront analytics dashboard
- Bulk operations across multiple schools in admin

---

## 🧠 Architectural notes

### Where things live
- Flutter source: `~/Downloads/Whitephoto_Studio_App_MVP_Source/`
- macOS Swift native: `macos/Runner/{RawProcessor,VolumeMonitor,AppDelegate,MainFlutterWindow}.swift`
- Plugin registration: `MainFlutterWindow.awakeFromNib` (NOT AppDelegate)
- Web/cloud: `~/Projects/studio-os-cloud-site` (Vercel + Supabase)

### Build commands
```
cd ~/Downloads/Whitephoto_Studio_App_MVP_Source
flutter clean    # required when Swift changes
flutter build macos
open ./build/macos/Build/Products/Release/Studio\ OS.app
```

### Adding a new Swift file to the Xcode project
Don't try to use `osascript` or sed.  Edit `macos/Runner.xcodeproj/project.pbxproj` directly: add 4 entries (PBXBuildFile, PBXFileReference, PBXGroup children, PBXSourcesBuildPhase).  Pattern: copy what `BackgroundRemovalPlugin.swift` looks like in there.

### The Vision framework
- `VNDetectFaceRectanglesRequest`, `VNDetectFaceLandmarksRequest` — macOS 11+
- `VNGenerateForegroundInstanceMaskRequest` — macOS 14+
- All gated with `if #available` so older systems silently no-op

### Core Image RAW pipeline
- `CIRAWFilter` typed class — macOS 12+
- Properties: `exposure`, `boostShadowAmount`, `neutralTemperature`, `neutralTint` (10.15+)
- Advanced: `luminanceNoiseReductionAmount`, `colorNoiseReductionAmount`, `sharpnessAmount` (12+)
- Working color space: extended-linear sRGB
- Output via `CGImageDestination` (cleaner Swift typing than `CIContext.writeJPEGRepresentation`)

---

## 🔮 Far future (parking lot)

- True multi-camera tethering (Canon EDSDK is wired; needs UI polish)
- Plugin system: third-party Develop-mode tools
- Proof of concept of a web-based Develop view (parents could lightly tweak their own photos before printing)
- Mobile companion app for last-minute culling on iPad
- AppleScript / Shortcuts integration for studio automation
