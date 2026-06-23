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
npx capacitor-assets generate --ios \
  --iconBackgroundColor '#ffffff' \
  --iconBackgroundColorDark '#ffffff' \
  --splashBackgroundColor '#ffffff' \
  --splashBackgroundColorDark '#111111'

# 4. Sync web config + assets into the iOS project
npm run sync

# 5. Open the project in Xcode
npm run open
```

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

## Troubleshooting

- **`pod install` fails** → `sudo gem install cocoapods` then `cd ios/App && pod install`.
- **"Untrusted Developer" on iPhone** → Settings → General → VPN & Device
  Management → trust your certificate.
- **White screen on launch** → the device has no internet, or the live site is
  down. The app loads `https://www.studiooscloud.com/m`; confirm it opens in
  mobile Safari.
- **Signing errors** → make sure your Apple Developer team is selected and
  "Automatically manage signing" is checked.
