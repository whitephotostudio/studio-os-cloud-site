# New-order push notifications — setup & deploy

When a parent places an order, the photographer's iPhone gets a banner. By
default it's privacy-first — just **"New order received."** Each photographer
can opt in (Dashboard → Settings → **New order alerts**) to show the client name
and amount.

Everything in code is **built and typechecked**. The steps below are the
one-time Apple/Vercel setup plus the rebuild. Do them in order.

---

## 1. Apple — create an APNs Auth Key (one time, ~2 min)

1. https://developer.apple.com/account → **Certificates, IDs & Profiles** → **Keys**.
2. **＋** → name it `Studio OS APNs` → tick **Apple Push Notifications service (APNs)** → Continue → Register.
3. **Download** the `.p8` file (you can only download it once) and note the **Key ID** (10 chars).
4. Your **Team ID** is top-right of the developer portal (10 chars).

## 2. Vercel — add 5 environment variables

Project → **Settings → Environment Variables** (Production + Preview):

| Name | Value |
|------|-------|
| `APNS_KEY_ID` | the Key ID from step 1 |
| `APNS_TEAM_ID` | your Apple Team ID |
| `APNS_BUNDLE_ID` | `com.studiooscloud.mobile` |
| `APNS_PRIVATE_KEY` | the **entire** contents of the `.p8` file (paste as-is, incl. the `BEGIN/END PRIVATE KEY` lines) |
| `APNS_PRODUCTION` | `true` |

Notes:
- `APNS_PRODUCTION=true` is correct for **TestFlight and App Store** builds. Only set it to `false` if you're testing a build run directly from Xcode onto your phone (those register a *sandbox* token).
- If APNs vars are missing, the app simply doesn't push — orders, receipts, everything else keep working.

## 3. Mac — install the new web dependency + push the site

```bash
cd ~/Downloads/Projects/studio-os-cloud-site
npm install            # picks up @capacitor/core + @capacitor/push-notifications, updates package-lock.json
rm -f .git/HEAD.lock .git/index.lock
git add -A
git commit -m "feat: iOS push notifications for new orders (APNs token-based, opt-in details)"
git push origin feature/mobile-ordering-ux:main
```

Vercel redeploys in ~2 min. The live `/m` site now registers devices and the
order webhook sends pushes.

## 4. Mac — add the Push capability to the native app + rebuild

The native iOS shell needs the push plugin wired in and the capability enabled.

```bash
cd ~/Downloads/Projects/studio-os-cloud-site/mobile
npm install
npx cap sync ios
npx cap open ios
```

In Xcode:
1. Select the **App** target → **Signing & Capabilities**.
2. **＋ Capability** → add **Push Notifications**. (With automatic signing this also enables Push on the App ID — no portal trip needed.)
3. *(Optional, for badge updates in the background)* **＋ Capability** → **Background Modes** → tick **Remote notifications**.
4. **Product → Archive** → **Distribute App → App Store Connect** → upload. Bump the build number first if Xcode asks.

Then submit/release the new build via TestFlight or the App Store as usual.

---

## 5. Test it

1. Install the new build (TestFlight). On first launch, tap **Allow** when iOS asks about notifications.
2. From another device/browser, place a test order in one of your galleries and pay.
3. Your iPhone should get a **"New order received."** banner within a few seconds. Tapping it opens the orders list.
4. Turn on Dashboard → Settings → **New order alerts → Show order details**, place another test order, and confirm the banner now shows the client name + amount.

If nothing arrives: confirm you tapped **Allow**, that all 5 Vercel env vars are set (and `APNS_PRODUCTION=true` for a TestFlight build), and that the build includes the Push Notifications capability from step 4.

---

## What was built (for reference)

- `lib/apns.ts` — token-based (.p8) APNs sender. No third-party SDK: ES256 JWT via Node `crypto`, delivery via Node `http2`.
- `lib/order-push.ts` — `sendNewOrderPush(...)`: loads the photographer's device tokens + detail preference, builds the banner, prunes dead tokens (Apple 410 / BadDeviceToken / Unregistered).
- `lib/payments.ts` — fires the push right after the receipt email in `finalizePaidOrder` (best-effort; never blocks the order).
- `app/api/dashboard/push/register/route.ts` — the app registers/refreshes its APNs token here (upsert by token, re-points to the current photographer on account switch).
- `app/api/dashboard/push/preferences/route.ts` — GET/POST the `order_push_show_details` flag.
- `components/push-register.tsx` — runs only inside the native app (guarded by `Capacitor.isNativePlatform()`); requests permission, registers, sends the token, deep-links to `/m/orders` on tap. Mounted in `app/m/layout.tsx` after sign-in.
- `app/dashboard/settings/page.tsx` — **New order alerts** toggle.
- `supabase/migrations/20260629000000_add_device_push_tokens_and_order_push_pref.sql` — `device_push_tokens` table (RLS on, service-role only) + `photographers.order_push_show_details`. Already applied live.
