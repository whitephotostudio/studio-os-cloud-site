# Studio OS Mobile — App Store Submission Guide

_Written 2026-06-26. The iOS app (`mobile/`) is a Capacitor app that loads the live
`studiooscloud.com/m` site with native camera, push, and share. This guide takes it
from "built" to "on the App Store." Steps marked **[you]** happen in Xcode / App
Store Connect under your Apple account; everything else is prepped in the repo._

---

## 0. Where things stand (already done in the repo)
- **Bundle ID:** `com.studiooscloud.mobile`
- **App name:** Studio OS · **Version** 1.0 · **Build** 1 · **iOS target** 15.0
- **App icon:** 1024×1024 present.
- **Permissions (Info.plist):** Camera + Photo Library usage strings set; `ITSAppUsesNonExemptEncryption = false` added (skips the export-compliance prompt on every upload — correct because the app only uses standard HTTPS).

## 1. The one real risk: Guideline 4.2 (minimum functionality)
Apple rejects apps that are "just a website in a wrapper." Yours has a real shot because it uses **native camera (QR scan + capture), push notifications, and the share sheet** — but make the case explicitly:
- In **App Review notes**, write: _"Native iOS features: camera for live QR/barcode scanning and photo capture, push notifications for new orders, native share sheet for gallery links, and Photos access for importing DSLR shots. This is a working tool for professional photographers, not a marketing site."_
- Make sure the **camera permission actually prompts** during review (the QR scanner). If a reviewer never sees a native feature, that's the usual 4.2 trigger.
- Don't describe it as "our website as an app" anywhere in the listing.

## 2. App Store Connect — create the app **[you]**
1. [developer.apple.com](https://developer.apple.com) → Certificates, Identifiers & Profiles → **Identifiers** → confirm an App ID for `com.studiooscloud.mobile` exists (Xcode usually registers it automatically with "Automatically manage signing").
2. [App Store Connect](https://appstoreconnect.apple.com) → **Apps → +** → New App:
   - Platform: iOS · Name: **Studio OS** (if taken, use **Studio OS Cloud** — store names are globally unique) · Primary language: English · Bundle ID: `com.studiooscloud.mobile` · SKU: `studioos-mobile-001`.

## 3. Listing copy (paste-ready)
- **Name:** `Studio OS` (fallback `Studio OS Cloud`)
- **Subtitle (≤30 chars):** `Run picture day from your phone`
- **Promotional text (≤170, editable anytime):** `Scan a student's QR code, shoot, and the photos go straight to their gallery — sort, delete, and share, all from your phone or iPad.`
- **Keywords (≤100 chars):** `picture day,school photography,photographer,QR,roster,gallery,proofing,orders,studio,capture`
- **Description:**
```
Studio OS Mobile is the picture-day companion for professional photographers.

Scan a student's QR code to lock them in, capture with your phone or import the
shots your DSLR sent over, and every photo uploads straight to that student's
gallery. Review and delete bad frames, re-assign a mis-scanned photo to the right
child, and the first shot is set as their best photo automatically.

• Scan student QR/PIN codes with the camera
• Capture on the phone or import DSLR photos
• Sort by student — see counts, review, delete, move
• Share a gallery QR + access PIN with clients in seconds
• Track orders, schools, and events on the go

Studio OS Mobile works with your Studio OS Cloud account. Sign in with the same
email and password you use at studiooscloud.com.
```
- **Support URL:** `https://www.studiooscloud.com`
- **Marketing URL:** `https://www.studiooscloud.com`
- **Privacy Policy URL:** `https://www.studiooscloud.com/privacy`
- **Category:** Primary **Photo & Video**, Secondary **Business**
- **Age rating:** 4+

## 4. Screenshots (current Apple specs) **[you]**
Required, exact pixel sizes (PNG/JPEG, RGB, **no alpha/transparency**):
- **iPhone 6.9":** `1320 × 2868` (primary — iPhone 17 Pro Max). 6.7" `1290 × 2796` also accepted.
- **iPad 13":** `2064 × 2752` — **only required if you ship iPad** (see §6).
- 1–10 per device class. Capture them from a device or the Xcode Simulator (Pro Max + 13" iPad) on real screens: the Sort grid, a student's photos, the Show-QR sheet, Picture Day capture, Orders.

## 5. App Privacy ("nutrition label") **[you]**
Disclose what the app handles (App Store Connect → App Privacy):
- **Contact Info → Email** (account sign-in) — linked to identity, app functionality.
- **User Content → Photos** (captured/uploaded) — app functionality.
- **Identifiers / Usage Data** only if your analytics collect them; otherwise "no."
Not used for tracking/ads → answer **No** to tracking.

## 6. iPhone-only vs Universal (iPad) — decide before screenshots
- **Universal (iPhone + iPad):** matches your DSLR-to-iPad workflow, but you must upload iPad screenshots too.
- **iPhone-only:** less to prepare; iPad users still run it (scaled) but it won't be marketed for iPad.
Set in Xcode target → General → Supported Destinations. Recommended: **Universal** (you want iPad capture), so plan for iPad screenshots.

## 7. Build → upload **[you]**
In Xcode, open `mobile/ios/App/App.xcworkspace` (the **.xcworkspace**, not .xcodeproj):
1. Target **App** → Signing: "Automatically manage signing," your Team, **iOS App Store** distribution.
2. Top bar destination → **Any iOS Device (arm64)**.
3. Bump build if re-uploading (General → Build). First upload: 1.0 (1) is fine.
4. **Product → Archive** → Organizer → **Distribute App → App Store Connect → Upload**.
5. Wait for "Processing" to finish in App Store Connect (~10–30 min), then the build appears under your app's version.

## 8. Reviewer demo account **[you]** — REQUIRED
The app needs login, so App Review must be able to sign in. In **App Review Information → Sign-In required**, provide a **test photographer account** (email + password) with a school + a few students so the reviewer can scan/capture. Create one if needed.

## 9. Submit
Attach the processed build to the version, fill remaining fields, → **Add for Review → Submit**. First review is typically ~24–48 h. If 4.2 comes back, reply in Resolution Center pointing to the native camera/push features (and consider adding offline caching to strengthen the case).

---

## Fast path if you want a shareable beta first
**TestFlight:** after the build processes (step 7), go to the **TestFlight** tab → add it to **External Testing** → create a **public link**. Beta review is lighter (~a day) and you can put that link on the website immediately while the full App Store review runs.

---

## What I prepared vs what's yours
- **Prepped in repo:** bundle id, name, version, icon, permission strings, `ITSAppUsesNonExemptEncryption`, and all the listing copy above.
- **Yours (Apple account):** create the app record, screenshots, privacy answers, demo account, archive+upload, submit. I can't do those in your Apple account, but I'll help with any rejection or asset.
</content>
