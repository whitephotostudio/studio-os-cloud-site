import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Studio OS — native iOS shell.
 *
 * Strategy: the app is a thin, signed native wrapper around the already-built
 * mobile web app at https://www.studiooscloud.com/m. Because it loads the live
 * site, every Vercel deploy updates the app instantly — no resubmission needed
 * for normal UI/content changes. Native capabilities (push, Face ID, save) are
 * added as real Capacitor plugins on top of this shell.
 *
 * NOTE: `appId` becomes the permanent iOS bundle identifier once the app is
 * registered in App Store Connect. Change it BEFORE the first upload if you want
 * a different one. After registration it cannot be changed.
 */
const config: CapacitorConfig = {
  appId: "com.studiooscloud.mobile",
  appName: "Studio OS",
  // Local fallback assets. With `server.url` set, the live site is what loads;
  // this folder just satisfies the Capacitor CLI and provides an offline splash.
  webDir: "www",
  server: {
    // Initial URL the WebView loads. Same-origin navigation (sign-in, orders,
    // schools, events) stays inside the app; the photographer stays logged in
    // across launches via the WebView's persistent storage.
    url: "https://www.studiooscloud.com/m",
    // Keep these origins inside the app. Anything else (Stripe, external links)
    // opens in the system browser, which is the safer default.
    allowNavigation: [
      "www.studiooscloud.com",
      "studiooscloud.com",
      "*.studiooscloud.com",
    ],
    iosScheme: "https",
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#ffffff",
    // We control our own domains, so don't restrict to app-bound domains.
    limitsNavigationsToAppBoundDomains: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#ffffff",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
