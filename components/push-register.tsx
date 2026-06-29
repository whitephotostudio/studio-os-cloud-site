"use client";

// Registers this device for APNs push (new-order alerts) when the app is
// running inside the native iOS shell. It's a no-op in a normal browser.
//
// The Capacitor plugins are imported dynamically (and the specifier is cast to
// `string` so TypeScript doesn't require the package at build time — it's only
// truly present inside the native app's bundle). Everything is guarded by
// `Capacitor.isNativePlatform()`.
//
// Includes temporary `beacon()` diagnostics that POST progress to
// /api/dashboard/push/debug so we can trace registration in the server logs.

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

function beacon(stage: string, extra?: Record<string, unknown>) {
  try {
    void fetch("/api/dashboard/push/debug", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ stage, ...extra }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

export default function PushRegister() {
  useEffect(() => {
    const listeners: Listener[] = [];
    let cancelled = false;

    (async () => {
      try {
        const core = (await import("@capacitor/core" as string)) as CapacitorCore;
        const native = core.Capacitor.isNativePlatform();
        beacon("start", { native });
        if (!native || cancelled) return;

        const mod = (await import(
          "@capacitor/push-notifications" as string
        )) as PushModule;
        const Push = mod.PushNotifications;
        beacon("plugin-loaded", { hasRegister: typeof Push?.register });

        const perm = await Push.requestPermissions();
        beacon("permission", { receive: perm?.receive });
        if (perm.receive !== "granted" || cancelled) return;

        // Got a token → send it to the server (Bearer-authed like every /m page).
        listeners.push(
          await Push.addListener("registration", (token) => {
            const value = (token as { value?: string })?.value;
            beacon("registration", { hasToken: !!value, len: value?.length ?? 0 });
            if (!value) return;
            void (async () => {
              try {
                const supabase = createClient();
                const {
                  data: { session },
                } = await supabase.auth.getSession();
                beacon("posting-token", {
                  hasSession: !!session?.access_token,
                });
                const res = await fetch("/api/dashboard/push/register", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${session?.access_token ?? ""}`,
                  },
                  credentials: "include",
                  body: JSON.stringify({ token: value, platform: "ios" }),
                });
                beacon("register-response", { status: res.status });
              } catch (e) {
                beacon("post-error", { message: String(e) });
              }
            })();
          }),
        );

        // APNs registration failure (e.g. missing entitlement).
        listeners.push(
          await Push.addListener("registrationError", (err) => {
            beacon("registration-error", { error: JSON.stringify(err) });
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

        beacon("before-register");
        await Push.register();
        beacon("after-register-call");
      } catch (e) {
        beacon("exception", { message: String(e) });
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
