# Mobile app distribution history

Verified September 19, 2026 from local source, documentation, and Xcode archive upload records.

## Existing Studio OS iPhone app

- Project: `mobile/` in this repository; Capacitor native iOS shell.
- Display name: **Studio OS**.
- Bundle identifier: `com.studiooscloud.mobile`.
- App Store Connect record: `6784866779`.
- `mobile/README.md` documents the TestFlight archive/upload/invitation workflow.
- Xcode records successful uploads to Apple for version 1.0, builds 1–4, on June 26 and June 29, 2026 (Toronto dates).
- Latest matching local upload: **version 1.0, build 4**, June 29, 2026 at 3:45 p.m. Toronto time (`2026-06-29T19:45:39Z`). Its upload event says `state: success`, `title: Uploaded to Apple`, with no errors or warnings.

The latest archive is:

`/Users/harout/Library/Developer/Xcode/Archives/2026-06-29/App 2026-06-29, 3.44 PM.xcarchive`

Its `Info.plist` contains the distribution record. Its `Products/Applications/App.app/capacitor.config.json` confirms that the uploaded binary loads **https://www.studiooscloud.com/m**. This matches the current `mobile/capacitor.config.ts`.

Consequently, the September 19 website layout publication is also available inside this existing iPhone app when its web content reloads. These website changes do not require a new native TestFlight build. Changes to the native wrapper, plugins, permissions, or SDK still require a native release and appropriate testing.

Successful Apple upload does not prove that a build was enabled for TestFlight testing, remains available, or is the version currently installed on a particular phone. The App Store Connect TestFlight page required sign-in during this check, so current distribution and the user's installed version remain unverified.

## Other projects with similar names

- `/Users/harout/Downloads/Projects/studio-os-mobile-ios` is a separate Swift web wrapper named **Studio OS Mobile**, bundle identifier `com.whitephotostudio.studioosmobile`. It also loads the live `/m` website. Its `TESTFLIGHT.md` records a version 1.0/build 1 archive and an upload handoff blocked on creating the App Store Connect app record; that document is not proof of a completed upload.
- `/Users/harout/Downloads/Whitephoto_Studio_App_MVP_Source/ios` is the separate Flutter iOS target, currently `com.example.whitephotoStudioApp`. The September 19 Flutter navigation changes and unsigned build relate to this project, not to the existing Capacitor app uploaded in June.
- A Safari Home Screen installation can also have a similar name. Icon names alone cannot identify which binary or web installation is on the user's phone.

## Correction to the September 19 compatibility notes

Statements that native signing/distribution were still pending apply to the separate Flutter iOS target. They do not mean the existing Studio OS Capacitor app was never uploaded, or that it needs another TestFlight build to receive the published website layout changes. Actual foldable-device behavior remains subject to device/runtime testing.
