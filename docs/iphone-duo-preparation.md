# iPhone Duo preparation

Prepared September 19, 2026. These are compatibility changes in source, not a claim of device certification or an App Store release.

Apple's current guidance recommends flexible window-based layouts, asymmetric safe-area handling, and testing opened, closed, rotated, and Split View configurations. Full-screen native optimization uses Xcode 27.1 / iOS 27.1.

Sources:
- https://developer.apple.com/iphone-duo/
- https://developer.apple.com/videos/play/tech-talks/111461/

## Website changes

- `app/m/layout.tsx`: preserves the existing route and session while the layout resizes; makes header actions fit narrow windows.
- `app/m/mobile-layout.module.css`: fluid width up to 1040px, dynamic viewport height, independent left/right safe-area insets, and larger header action targets.
- `app/manifest.ts`: allows any orientation.
- This report.

The prior mobile shell stopped expanding at 480px. It now uses the available window width without requiring a device-name check or remounting the current route.

## Verification

All 255 existing website tests and the production build passed.

A temporary local fixture server-rendered the actual mobile layout, with authentication and network side effects replaced by inert test dependencies. Header/navigation geometry was inspected in the browser at representative viewports:

| Width × height (CSS px) | Workspace width | Horizontal overflow |
| --- | ---: | --- |
| 320 × 626 | 320 | None |
| 390 × 844 | 390 | None |
| 626 × 890 | 626 | None |
| 890 × 626 | 890 | None |
| 890 × 360 | 890 | None |
| 1200 × 800 | 1040 | None |

These are layout stress-test sizes, not asserted iPhone Duo simulator dimensions. The fixture verifies the shell, not authenticated workflows, camera operation, or a real Safari fold transition.

## Native app work

The Flutter mobile shell now switches between a bottom navigation bar and a scrollable side rail based on usable window width. The keyed page subtree survives the switch. Invoice headers and filters scroll in short windows.

All 693 Flutter tests passed, including a resizing test that retains the Sales state and unfinished search while moving through compact, expanded, landscape, and split-width windows with unequal left/right safe-area insets. Flutter analysis found no issues.

Native changes are in the desktop source workspace, documented at:
`/Users/harout/Downloads/Whitephoto_Studio_App_MVP_Source/docs/iphone-duo-preparation.md`.

## Before an iPhone Duo release

This Mac currently has Xcode 27.0 and iOS 27.0 simulators; the Duo-specific Xcode 27.1 beta runtime is not installed. Validate fold transitions, both Split View sides, software keyboard, text scaling, camera/QR capture, photo uploads, and preserved in-progress input in Apple's Duo simulator and then on hardware.

The native iPhone workspace currently exposes Home, Clients, Sales, More, and a Jobs preparation page. Desktop production features are not automatically brought to iPhone by these layout changes. Native signing, the production iOS bundle identity, and TestFlight/App Store distribution remain separate release work.

The mobile website was subsequently published on September 19, 2026; see the publication record below. The native iPhone changes remain unreleased, and the installed notarized Mac app is unchanged.

The native build also surfaced older CocoaPods deployment targets incompatible with Xcode 27. The native Podfile now raises those targets to the app's existing iOS 15.5 minimum. Flutter separately warns about ML Kit arm64 simulator support, which must be resolved or verified before Duo simulator testing.

After the deployment-target correction, the unsigned iOS Release build succeeded on Xcode 27.0 (69.8 MB). This validates device-target compilation, not signing, App Store distribution, simulator support or physical camera behavior.

## Publication — September 19, 2026

Published with `npm run deploy:production` from clean commit `ff581a8`. The release guard, all 255 website tests, and both production builds passed.

- Deployment: `dpl_ADbVPKeRRmufsHV54RjMZvyZpJHF` (READY, production).
- Production URL: https://studio-os-cloud-site-jegwq5kai-whitephotostudio-7289s-projects.vercel.app
- Live mobile app: https://www.studiooscloud.com/m
- Previous deployment: `dpl_E6gHGqKrRgW8fm5MG4fkvBaDZiXu`.

Verified the authenticated live home at 320×626, 626×890 and 890×626 CSS pixels: the workspace fills the available width, header actions remain visible, and there is no horizontal page overflow. An unfinished search remained intact when resizing from wide to compact. The live manifest returns HTTP 200 with `orientation: any`. Temporary browser size overrides and test tabs were cleaned up.

This publishes the mobile website changes only. It does not publish an App Store/TestFlight build or establish physical iPhone Duo camera compatibility.
