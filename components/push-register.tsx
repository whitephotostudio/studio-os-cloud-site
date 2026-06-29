"use client";

// Registers this device for APNs push (new-order alerts) when the app is
// running inside the native iOS shell. It's a no-op in a normal browser.
//
// The Capacitor plugins are imported dynamically (and the specifier is cast to
// `string` so TypeScript doesn't require the package at build time — it's only
// truly present inside the native app's bundle). Everything is guarded by
// `Capacitor.isNativePlatform()`.

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

type Listener = { remove: () => void };

type CapacitorCore = {
  Capacitor: { isNativePlatform: () => boolean };
};

type PushModule = {
  PushNotifications: {
    requestPermissions: () => Promise<{ receive: string }>;
    register: () => Promise<void>;
    addListener: (
      event: string,
      cb: (data: unknown) => void,
    ) => Promise<Listener>;
  };
};

export default function PushRegister() {
  useEffect(() => {
    const listeners: Listener[] = [];
    let cancelled = false;

    (async () => {
      try {
        const core = (await import("@capacitor/core" as string)) as CapacitorCore;
        if (!core.Capacitor.isNativePlatform() || cancelled) return;

        const mod = (await import(
          "@capacitor/push-notifications" as string
        )) as PushModule;
        const Push = mod.PushNotifications;

        const perm = await Push.requestPermissions();
        if (perm.receive !== "granted" || cancelled) return;

        // Got a token → send it to the server so we can push to this device.
        // The mobile webview authenticates API calls with a Supabase Bearer
        // token (cookies aren't reliable here), mirroring every other /m page.
        // Without it the POST 401s and the token is never saved.
        listeners.push(
          await Push.addListener("registration", (token) => {
            const value = (token as { value?: string })?.value;
            if (!value) return;
            void (async () => {
              try {
                const supabase = createClient();
                const {
                  data: { session },
                } = await supabase.auth.getSession();
                await fetch("/api/dashboard/push/register", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token ?? ""}`,
                  },
                  credentials: "include",
                  body: JSON.stringify({ token: value, platform: "ios" }),
                });
              } catch {
                /* ignore */
              }
            })();
          }),
        );

        // Surface APNs registration failures (useful when debugging via the
        // Safari web inspector attached to the device).
        listeners.push(
          await Push.addListener("registrationError", (err) => {
            console.error("[push] APNs registration error", err);
          }),
        );

        // Tapping the notification deep-links to the orders list.
        listeners.push(
          await Push.addListener("pushNotificationActionPerformed", (action) => {
            const data = (
              action as { notification?: { data?: { url?: string } } }
            )?.notification?.data;
            const url = data?.url || "/m/orders";
            if (typeof window !== "undefined") window.location.href = url;
          }),
        );

        await Push.register();
      } catch {
        /* not the native app, or the plugin isn't available — ignore */
      }
    })();

    return () => {
      cancelled = true;
      listeners.forEach((l) => {
        try {
          l.remove();
        } catch {
          /* ignore */
        }
      });
    };
  }, []);

  return null;
}
