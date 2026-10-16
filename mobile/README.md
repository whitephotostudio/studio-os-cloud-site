# Studio OS — Native iOS App

This is the real, signed, App Store / TestFlight-distributable iOS app for Studio OS.

## How it works (architecture)

The app is a **native iOS shell (Capacitor 8)** that loads the mobile web app you
already built at **https://www.studiooscloud.com/m**. Because it loads the live
site:

- **Every Vercel deploy updates the app instantly** — no resubmission for normal
  UI / content / feature changes.
- The photographer signs in once and stays signed in across launches.
- Native capabilities a website can't do (push notifications, Face ID, native
  save, camera/auto-upload) are added on top as real Capacitor plugins.

You only resubmit to the App Store when you change something *native* (icons,
plugins, permissions, the Capacitor version).

---

## Prerequisites (one time, on your Mac)

1. **Xcode 26 or later** — required by Capacitor 8, and required by Apple for any
   App Store submission since April 28, 2026. Install from the Mac App Store, then
   run it once to finish component install.
2. **CocoaPods** — `sudo gem install cocoapods` (or `brew install cocoapods`).
3. **Node 20+** — you already have this for the web app.
4. **Apple Developer Program membership** — you have this. ✅

---

## First build → your iPhone (do this once)

```bash
cd ~/Downloads/Projects/studio-os-cloud-site/mobile

# 1. Install Capacitor + plugins
npm install

# 2. Generate the native iOS project (creates ./ios)
npm run add:ios

# 3. Generate app icons + splash from the Studio OS logo
#    (source art is already in ./assets — logo.png, splash.png, splash-dark.png)
npm run icons -- \
  --iconBackgroundColor '#ffffff' \
  --iconBackgroundColorDark '#ffffff' \
  --splashBackgroundColor '#ffffff' \
  --splashBackgroundColorDark '#111111'

# 4. Sync web config + assets into the iOS project
npm run sync

# 5. Open the project in Xcode
npm run open
```

The local iOS generator uses patched Sharp, preserving the 1024px icon,
2732px light/dark splash sizes, source-art precedence and Xcode catalog names.
It replaces the old `@capacitor/assets` development tool, whose dependency tree
has unpatched advisories. Native artwork is regenerated only when you run this command.

### In Xcode

1. Select the **App** target → **Signing & Capabilities** tab.
2. **Team:** pick your Apple Developer team. Xcode will auto-create a signing
   certificate + provisioning profile ("Automatically manage signing").
3. **Bundle Identifier:** `com.studiooscloud.mobile` (change it here BEFORE your
   first upload if you want a different one — it's permanent after registration).
4. Plug in your iPhone, select it as the run target, press **▶ Run**.
   - First run on a device: on the iPhone, go to *Settings → General → VPN &
     Device Management* and trust your developer certificate.
5. The app launches, shows the Studio OS splash, then loads your `/m` dashboard.
   Sign in once — you'll stay signed in.

---

## Ship to TestFlight (so other photographers can install it)

1. In Xcode: top menu **Product → Archive** (set the device target to "Any iOS
   Device" first).
2. When the Organizer opens: **Distribute App → App Store Connect → Upload**.
3. First time only: in [App Store Connect](https://appstoreconnect.apple.com)
   create the app record (same bundle id), fill in name/icon/privacy.
4. Once the build finishes processing, add it to **TestFlight** and invite
   photographers by email. They install the **TestFlight** app, tap your invite,
   and get Studio OS on their phone — no App Store review needed for internal
   testers.

For a **public App Store** release later, you'll add the Phase 2 native features
below (a pure web wrapper risks rejection under Apple guideline 4.2; push
notifications + Face ID + native capture comfortably clear that bar).

---

## Updating the app

| You changed… | What to do |
| --- | --- |
| `/m` pages, dashboard UI, features, copy | Just `git push` the web app. The iOS app updates on next open. **No resubmission.** |
| App icon, splash, plugins, permissions, Capacitor version | `npm run sync` → archive → upload a new build to TestFlight/App Store. |

---

## Phase 2 — native features (planned)

These are scaffolded to add next, in priority order:

1. **Push notifications** — alert the photographer on new orders and new
   bookings. Needs: an Apple Push (APNs) key in your developer account, a
   `device_tokens` table in Supabase, and an edge function that sends a push when
   an order/booking row is created. The web `/m` app registers the device and
   stores its token. (Strongest justification for App Store approval.)
2. **Face ID / Touch ID** — biometric unlock on app open (plugin:
   `@aparajita/capacitor-biometric-auth`).
3. **Native Save-to-Photos** — tighter native save than the web share sheet.
4. **In-app capture + auto-upload** — choose a school/event, shoot, photos upload
   automatically. See notes below — this is the big one and reuses your existing
   cloud-sync/import pipeline.

---

## Native USB camera capture

`StudioOSCameraPlugin` is registered by `StudioOSBridgeViewController` in the
main storyboard. USB access needs a new native app build; deploying the web UI
alone cannot add the plugin to an older installed app.

The connector uses public iOS ImageCaptureCore discovery, permissions, sessions
and PTP passthrough. Apple's high-level `requestTakePicture` and tethering APIs
are unavailable on iOS. The EOS-1D X Mark III path therefore checks advertised
Canon operations, enables remote/event mode, and receives new card JPEG events.
Vendor commands are restricted to that exact Canon model and vendor. Other
cameras use standard advertised PTP capture or their reported physical-shutter
capability. Import-only or unsupported connections close with a clear message.
Every camera/firmware/adapter combination still requires a physical device test.

- Use a USB data cable, allow external camera access, and close Photos or other
  camera applications. Set JPEG or RAW + JPEG and single-shot drive mode.
- Existing card files establish the initial baseline and are never imported.
  Only new JPEG events after Ready are accepted. The app never deletes camera
  files or changes the capture destination; host-only Canon destinations stop
  the connection so originals remain on a camera card.
- New JPEGs are read sequentially in 256 KiB chunks (40 MiB per file, 32 queued,
  200 private pending photos, 1 GiB total). A full decoded JPEG is verified before
  it becomes available for review. Pending files persist in protected, excluded
  from backup, photographer-scoped Application Support storage.
- Photos have no native student assignment. The web UI requires review and an
  explicit import for the selected student. Acknowledgement removes only the
  private iPhone copy after the upload queue commits it.
- Stop, backgrounding, a disconnect, navigation away from the configured secure
  Studio OS origin, and errors release the session. Timeouts pause capture and
  give recovery steps; they never automatically fire another shutter request.

API: `start({ownerId})`, `stop()`, `getStatus()`, `capture({ownerId})`,
`listPhotos({ownerId})`, `readPhoto({ownerId,id,offset,length})`,
`acknowledgePhoto({ownerId,id})`; events `statusChanged`
and `photoReady`. Owner IDs must be valid account UUIDs. Calls are confined to
the main frame of the configured HTTPS Studio OS origin. Read length is capped
at 262144 bytes; photo IDs are private UUIDs, not arbitrary paths.

Run parser fixtures with `./mobile/scripts/test-canon-ptp.sh`. Build and simulator
checks do not prove hardware operation. Before releasing publicly, test actual
EOS-1D X Mark III connection, the physical shutter and app shutter, JPEG plus RAW
+ JPEG, card-only originals, reconnect, background/foreground, account switching,
interrupted transfer recovery, and review/import for the correct student. Confirm
that old card photos are not offered for import and that Busy clears after Stop.

## Troubleshooting

- **`pod install` fails** → `sudo gem install cocoapods` then `cd ios/App && pod install`.
- **"Untrusted Developer" on iPhone** → Settings → General → VPN & Device
  Management → trust your certificate.
- **White screen on launch** → the device has no internet, or the live site is
  down. The app loads `https://www.studiooscloud.com/m`; confirm it opens in
  mobile Safari.
- **Signing errors** → make sure your Apple Developer team is selected and
  "Automatically manage signing" is checked.
