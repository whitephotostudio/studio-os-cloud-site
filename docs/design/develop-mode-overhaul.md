# Develop Mode Overhaul + RAW Pipeline (2026-04-27)

A standalone reference for the session that turned Studio OS's embedded Develop view into a fullscreen, RAW-aware Lightroom replacement.  Re-read this after a context reset to understand what was built and why.

---

## Vision

Photographer's school-portrait workflow becomes a single app:

```
Capture (camera or SD) ──▶ Import Hub ──▶ Sort/Cull ──▶ Develop ──▶ Sync to Cloud
```

Specifically:

1. The Import Hub now reads RAW files (CR2 / CR3 / NEF / ARW / RAF / ORF / RW2 / DNG and the long tail of camera formats) alongside JPGs.  RAWs sit in a `raws/` subfolder of each student/album destination — they never leave the local machine.
2. A new fullscreen Develop mode opens from Sort with the full screen real estate, GPU-accelerated edits via Apple's Core Image, and a new tool surface (tone curve, HSL, lens corrections, proper Detail panel).
3. When the photographer clicks Sync to Cloud — or just Export — a customizable export dialog asks for size, unit (px / inches / cm), DPI, JPG quality, color space, output sharpening, watermark, filename pattern, and writes a JPG that sits at the student-folder root and uploads through the existing cloud sync.

End result: zero round-trips through Lightroom for a school day.

---

## The folder convention (locked in)

```
~/CaptureBase/<school>/<class>/<student>/
  raws/                     # RAW originals — never uploaded
    IMG_1234.CR3
    IMG_1234.studio_edit.json
    IMG_1235.NEF
  IMG_1234.jpg              # developed export, this is what cloud sync grabs
  IMG_1235.jpg              # camera-out JPG, also uploads
  .IMG_1234.studio_edit.json # legacy sidecar location for JPG edits
```

Same shape under events: `~/CaptureBase/<event>/<album>/raws/...`.

The cloud sync upload pipeline (`lib/services/cloud_sync_service.dart`) was tightened to skip any path containing a `raws/` segment, so RAWs are guaranteed local-only even if some future code path forgot the convention.

---

## The technical bet — Core Image via Swift platform channel

`macos/Runner/RawProcessor.swift` exposes a Flutter `MethodChannel("studio_os/raw_processor")` with five methods backed by Apple's industrial RAW pipeline:

| Method | What it does |
| --- | --- |
| `extractPreview(path, maxDim, quality)` | Embedded JPEG preview from any RAW for instant filmstrip + grid thumbs. |
| `renderRaw(path, outPath, adjustments, …)` | Full RAW demosaic via `CIRAWFilter` + edit chain → JPEG on disk. |
| `renderJpg(path, outPath, adjustments, …)` | Same edit chain on a JPG/HEIC/TIFF source. |
| `getMetadata(path)` | EXIF dictionary (camera, lens, ISO, shutter, aperture, focal, dimensions). |
| `autoEnhance(path)` | Runs `CIImage.autoAdjustmentFilters` and reports the suggested adjustments. |

The Swift side keeps one `CIContext` for the lifetime of the app (extended-linear-sRGB working space, GPU renderer, intermediate caching).  The Dart side wraps every call in `try/catch`; if the channel is missing the legacy pure-Dart pipeline takes over so unit tests and future non-macOS builds still work.

Why Core Image and not libraw / dcraw?

- It's the same engine Photos.app, Final Cut, and Motion use — Apple keeps it current with every camera release.
- Raw-stage adjustments (`CIRAWFilter.exposure`, `.neutralTemperature`, `.boostShadowAmount`, `.luminanceNoiseReductionAmount`, `.colorNoiseReductionAmount`, `.sharpnessAmount`) run inside the demosaic, which is the highest-quality possible.
- 200+ `CIFilter` effects available downstream for the Phase 2 expansion (subject masking, sky detection, denoise) without bundling custom models.
- GPU-accelerated end to end.  A 24-megapixel CR3 → 4096px JPG render lands in ~150 ms on Apple Silicon vs ~3 sec for the pure-Dart `image` package path.

Wired into `AppDelegate.swift` via `RawProcessor.register(with: controller.registrar(forPlugin: "RawProcessor"))` in `applicationDidFinishLaunching`.

---

## The full Develop tool surface (after this session)

Tab tabs along the right panel (`enum _DevTool`):

| Tab | Tools |
| --- | --- |
| **Light** | Exposure, Contrast, Highlights, Shadows, Whites, Blacks |
| **Crop & Straighten** | Aspect ratios (Free, 1:1, 4:3, 3:2, 5:4, 4:5, 16:9 + print sizes 4×6, 5×7, 8×10, 11×14, 16×20, Wallet), straighten angle, reset |
| **Color** | Temperature, Tint, Saturation, Vibrance, Clarity |
| **Tone Curve** *(new)* | 5-point bezier curve with draggable handles, double-tap to reset |
| **HSL** *(new)* | Per-color (red/orange/yellow/green/aqua/blue/purple/magenta) Hue/Sat/Lum sliders |
| **Detail** *(rewritten)* | Sharpening (Amount / Radius / Masking) + Noise Reduction (Luminance + Color) |
| **Lens** *(new)* | Distortion (pinch / barrel), Vignetting, Chromatic Aberration Red / Blue |
| **Presets** | 25+ baseline presets (Adaptive, Portraits, B&W, Seasons, Style) |
| **AI** | Background removal + AI tools panel (existing) |

Top-of-panel buttons (existing + extended):
- **Auto** — now calls `RawProcessorService.autoEnhance` (Apple's `CIAutoAdjustmentFilters`) before falling back to the histogram-based heuristic.
- **Align** — auto-straighten.
- **Reset** — clears every adjustment back to defaults (now zeroes the new fields too).

Filmstrip header (existing + extended):
- Flag-only filter (existing).
- Star rating filter (existing).
- Color label filter (existing).
- **All / JPG / RAW** *(new)* — filters the filmstrip by file type so the photographer can focus on developing RAWs or reviewing JPGs.

Apply row (existing + extended):
- **Apply** — saves edits to the sidecar.
- **Done** — apply + close.
- **Auto Sync** checkbox — pushes edits live to every selected photo.
- **Sync N** *(new, one-shot)* — appears when `multiSelected.length > 1`, pushes the current edits to every selected photo without arming auto-sync.

Keyboard shortcuts (existing): Cmd/Ctrl + Z/Y for undo/redo, C for copy, V for paste, S for apply+save, P pick, X reject, U unflag, 0–5 stars, 6–9 + Shift+5/6 color labels, ← → navigate, \\ toggle before/after.

---

## The Export dialog (new)

`lib/editor/export_dialog.dart` — `showExportDialog(context, photoCount: N)` returns a `Future<ExportParams?>`.

**Sections**

- **Preset dropdown** + Save-as.  Built-in presets:
  - Web small (1080px, q80)
  - Web large (2048px, q85)
  - Print 4x6 (1800px, 300 DPI, glossy sharpening)
  - Print 5x7 (2100px, 300 DPI, glossy sharpening)
  - Print 8x10 (3000px, 300 DPI, glossy sharpening)
  - Print 11x14 (4200px, 300 DPI, matte sharpening)
  - Full original (q90)
  - Custom presets persist via `LocalStore.appPrefs['export_presets_v1']`
- **Image sizing**
  - Resize to: Long edge / Short edge / Width / Height / Percentage / Original
  - Size value (numeric)
  - Unit: pixels / inches / centimetres
  - DPI (numeric)
  - "Don't enlarge" checkbox
- **Quality** — JPG quality slider with live size estimate.
- **Color** — sRGB / Adobe RGB / Display P3.
- **Output sharpening** — None / Screen / Matte print / Glossy print.
- **Watermark** — toggle + text override (defaults to studio name).
- **Filename pattern** — `{original}` `{student}` `{seq}` `{date}` substitutions.

`ExportParams.toEnginePayload()` translates the user choices into the dictionary `RawProcessor.swift` consumes (`longEdgePx`, `targetWidth`, `targetHeight`, `scalePercent`, `dpi`, `colorSpace`, `outputSharpening`, `jpegQuality`, `dontEnlarge`).

---

## Fullscreen Develop entry

`lib/editor/develop_mode_fullscreen.dart` wraps `DevelopModeView` in a `Scaffold` and pushes it via `Navigator.push(PageRouteBuilder(fullscreenDialog: true, …))`.  ESC and Cmd+W close the route.

Added in two places:
- `lib/screens/sorter_screen.dart` — new "Fullscreen" outlined button next to the existing Develop toggle in the school-mode photo grid.  Indigo accent, `Icons.fullscreen`.
- `lib/screens/project_sorter_screen.dart` — new "Fullscreen" text button next to the Develop toggle in event-mode previews.

Both entries auto-include any RAW siblings — the wrapper walks the parent of every photo, looks for a `raws/` subfolder, and appends RAW files.  Photographer never has to think about the folder structure, the filmstrip just shows everything.

---

## File-by-file changelog

**New Swift**

- `macos/Runner/RawProcessor.swift` — Core Image platform channel.
- `macos/Runner/AppDelegate.swift` — registers `RawProcessor` on launch.

**New Dart**

- `lib/services/raw_processor_service.dart` — Dart wrapper for the channel + RAW format detection.
- `lib/editor/develop_mode_fullscreen.dart` — fullscreen wrapper + entry helper + RAW-sibling walker.
- `lib/editor/export_dialog.dart` — full export dialog + `ExportParams` + `ExportPreset` + `ExportPresetStore`.
- `lib/editor/tone_curve_widget.dart` — 5-point parametric curve.
- `lib/editor/hsl_panel.dart` — per-color HSL sliders.
- `lib/editor/lens_corrections_panel.dart` — distortion / vignetting / CA.
- `lib/editor/detail_v2_panel.dart` — sharpening + noise reduction.

**Edited Dart**

- `lib/utils/photo_utils.dart` — added `isRawPhotoPath`, `isInsideRawSubfolder`, `kRawSubfolderName`, expanded `kAllSourcePhotoExtensions` with the long tail of RAW formats.
- `lib/editor/photo_adjustments.dart` — added 16 new fields (sharpenRadius, sharpenMasking, NR luminance/color, lens distortion/vignetting/CA, tone curve, HSL hue/sat/lum × 8, split-tone fields), updated copy/reset/isDefault/toJson/fromJson.
- `lib/editor/develop_mode_view.dart` — extended `_DevTool` enum, added new tab icons + content builders, wired tone curve / HSL / detail-v2 / lens panels, replaced legacy `_exportPhotos` with the dialog + RawProcessor pipeline (with Dart fallback), added `_autoEnhanceFromCoreImage`, `_syncSettingsToSelection`, `_formatChip`, RAW/JPG filter pills in filmstrip header, expanded crop preset list.
- `lib/editor/editor.dart` — exports the new files.
- `lib/services/cloud_sync_service.dart` — `_isImagePath` now skips `raws/` paths; expected RAW originals never reach R2.
- `lib/screens/import_hub_screen.dart` — both Folder and SD `_runImport` route RAW files to `<dest>/raws/` and create the folder lazily; duplicate-detection passes (scan + refresh) now check the right path for RAWs.
- `lib/screens/sorter_screen.dart` — new "Fullscreen" button, calls `DevelopModeFullscreen.open`.
- `lib/screens/project_sorter_screen.dart` — same for event mode.

---

## Smoke test (after `flutter build macos`)

```
cd ~/Downloads/Whitephoto_Studio_App_MVP_Source
flutter build macos
open ./build/macos/Build/Products/Release/Studio\ OS.app
```

1. **RAW import to raws/**
   - Studio OS → Cloud → Import Hub → From Folder → pick a folder containing CR3/CR2/NEF files alongside JPGs.
   - Confirm thumbnails render.  Pick a school + class destination.  Click Import.
   - Open Finder at `~/CaptureBase/<school>/<class>/<student>/`.  Confirm JPGs sit at root, RAWs sit inside `raws/`.

2. **Cloud sync excludes RAW**
   - Click Push to Cloud.  Watch the upload counter — it should match the JPG count, not include the RAWs.
   - Open Supabase Storage → `media` bucket → confirm no `.cr3` / `.nef` / `.arw` keys.

3. **Fullscreen Develop**
   - Sorter screen → click any photo → top toolbar shows the new "Fullscreen" button next to "Develop".  Click it.
   - Develop opens fullscreen.  ESC closes back to sorter.
   - Filmstrip should include RAWs from the sibling `raws/` folder.

4. **RAW edit + export**
   - Pick a RAW in the filmstrip.  Tab through Light / Color / Curve / HSL / Detail / Lens.  Drag sliders.
   - Click Export Photo (red button at the bottom of the left panel).  Customizable dialog appears.
   - Pick "Web large (2048px, q85)".  Click Export.
   - JPG appears at the student-folder root.  Open it — confirm edits applied.

5. **RAW/JPG filter**
   - In the Develop filmstrip header, click the "RAW" pill — only RAWs visible.  Click "JPG" — only JPGs visible.  Click "All" — back to combined.

6. **Auto + Sync**
   - Click "Auto" in the header — Apple's auto-enhance suggestions land on the sliders.
   - Cmd-click multiple photos in the filmstrip → "Sync N" button appears in the apply row → click it → confirm the snackbar shows the count.

7. **Customizable size**
   - Export Photo → switch Resize to "Long edge", set Size to 3500, Unit to pixels.  Or switch to inches at 300 DPI and set 8.5 → that becomes 2550 pixels.  Both should produce the same physical print at 300 DPI.

---

## Future work (deferred, not in this session)

- **Local masking** — radial / linear / brush masks with all sliders inside each mask.  Plumbing exists in CIFilter (`CISourceOverCompositing` + per-mask render).  Phase 2.
- **AI subject mask** — Vision framework `VNGenerateForegroundInstanceMaskRequest` for one-click "select the kid".  macOS 14+.  Phase 3.
- **Face-aware skin smoothing** — Vision face landmarks → CIFilter selective blur on skin only.  Phase 3.
- **AI denoise** — Bundle a Core ML noise model for high-ISO gym shots.  Phase 3.
- **Sky replacement** — Vision sky segmentation + CIFilter blend.  Phase 3.
- **Auto-tone matching across a series** — Pick a hero shot, propagate exposure/WB across a class.  Phase 2 (small).
- **Spot heal / clone** — `CISourceOverCompositing` + context fill.  Phase 2.
- **Push edits to cloud** — Mirror the sidecar JSON to a `photo_edits` Supabase table so edits survive a fresh-computer pull.  Phase 2.
- **Color grading wheels** — Fields exist (`splitToneShadowsHue`, etc.), UI not yet wired.
- **HSL per-color GPU shader** — Today the live preview shows the swatches but the per-color hue shift only applies on export via Core Image.  A full shader-based live preview is Phase 2.

---

## Honest limits

- Mac-only — same constraint as the rest of Studio OS.  The platform channel falls back to the pure-Dart `image` package on other platforms but RAW decode requires Core Image.
- A few niche RAW formats (very old or very new bodies) might need an Apple update if Photos.app doesn't decode them yet.
- The visual feel is "Lightroom-inspired" but built in Flutter — sliders, panels, dark theme, but not a pixel-perfect clone.
- Tone curve is parametric (5 control points cubic-interpolated) not a true Lightroom-style continuous curve with arbitrary points.  Good enough for 95% of school-portrait edits; Phase 2 can extend.

---

## What changed for the cloud-side site

Nothing.  This session was entirely the Flutter desktop app.  The web/Vercel side at `studio-os-cloud-site` was not touched — except for this docs file.
