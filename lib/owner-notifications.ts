type OwnerNotificationInput = {
  title: string;
  message: string;
  priority?: -2 | -1 | 0 | 1 | 2;
  sound?: string;
  url?: string | null;
  urlTitle?: string | null;
};

export type OwnerNotificationResult =
  | { sent: true; requestId: string | null }
  | {
      sent: false;
      reason: "not_configured" | "send_failed";
      message: string;
    };

function clean(value: string | null | undefined) {
  let next = (value ?? "").trim();
  while (
    next.length >= 2 &&
    ((next.startsWith('"') && next.endsWith('"')) ||
      (next.startsWith("'") && next.endsWith("'")))
  ) {
    next = next.slice(1, -1).trim();
  }
  return next;
}

function envDisabled() {
  const value = clean(process.env.OWNER_NOTIFICATIONS_ENABLED).toLowerCase();
  return value === "0" || value === "false" || value === "off";
}

export function ownerNotificationsDisabledByEnv() {
  return envDisabled();
}

function pushoverCredentials() {
  return {
    token: clean(process.env.PUSHOVER_APP_TOKEN),
    user: clean(process.env.PUSHOVER_USER_KEY),
    device: clean(process.env.PUSHOVER_DEVICE),
  };
}

export function ownerNotificationsConfigured() {
  const { token, user } = pushoverCredentials();
  return !envDisabled() && Boolean(token && user);
}

export function ownerNotificationConfigStatus() {
  const { token, user, device } = pushoverCredentials();
  return {
    configured: ownerNotificationsConfigured(),
    disabledByEnv: envDisabled(),
    hasAppToken: Boolean(token),
    hasUserKey: Boolean(user),
    hasDevice: Boolean(device),
  };
}

export function ownerUrl(path = "/dashboard/admin/users") {
  const base =
    clean(process.env.NEXT_PUBLIC_SITE_URL) ||
    clean(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    clean(process.env.VERCEL_URL) ||
    "https://www.studiooscloud.com";
  const origin = base.startsWith("http") ? base : `https://${base}`;
  return `${origin.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function sendOwnerNotification(input: OwnerNotificationInput) {
  if (!ownerNotificationsConfigured()) {
    return {
      sent: false as const,
      reason: "not_configured" as const,
      message:
        "Owner notifications are not configured. Check PUSHOVER_APP_TOKEN and PUSHOVER_USER_KEY in Vercel Production.",
    };
  }

  const { token, user, device } = pushoverCredentials();
  const body = new URLSearchParams();
  body.set("token", token);
  body.set("user", user);
  body.set("title", clean(input.title).slice(0, 250) || "Studio OS Cloud");
  body.set("message", clean(input.message).slice(0, 1024));
  body.set("priority", String(input.priority ?? 0));

  if (device) body.set("device", device);
  if (clean(input.sound)) body.set("sound", clean(input.sound));
  if (clean(input.url)) body.set("url", clean(input.url));
  if (clean(input.urlTitle)) body.set("url_title", clean(input.urlTitle));

  const response = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as {
    status?: number;
    request?: string;
    errors?: string[];
    error?: string;
  };

  if (!response.ok || payload.status === 0) {
    const message =
      payload.errors?.join("; ") ||
      payload.error ||
      `Pushover request failed with ${response.status}`;
    throw new Error(message);
  }

  return { sent: true as const, requestId: payload.request ?? null };
}

export async function notifyOwnerSafely(
  input: OwnerNotificationInput,
): Promise<OwnerNotificationResult> {
  try {
    return await sendOwnerNotification(input);
  } catch (error) {
    console.error("[owner-notifications]", error);
    return {
      sent: false,
      reason: "send_failed" as const,
      message:
        error instanceof Error
          ? error.message
          : "Pushover request failed for an unknown reason.",
    };
  }
}
