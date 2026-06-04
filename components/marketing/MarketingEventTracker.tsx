"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type MarketingEventPayload = {
  event: string;
  href?: string;
  label?: string;
  path: string;
  placement?: string;
  referrer?: string;
  anonymousId?: string;
};

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
    gtag?: (...args: unknown[]) => void;
    va?: (...args: unknown[]) => void;
  }
}

const conversionEndpoint = "/api/marketing/conversions";
const activityEndpoint = "/api/marketing/activity";
const anonymousVisitorKey = "studio-os-anonymous-visitor-id";
const excludedPathPrefixes = [
  "/api",
  "/_next",
  "/dashboard",
  "/parents",
  "/g/",
  "/m",
  "/schools/",
];

function currentAnonymousVisitorId() {
  try {
    const existing = window.localStorage.getItem(anonymousVisitorKey);
    if (existing) return existing;
    const next =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(anonymousVisitorKey, next);
    return next;
  } catch {
    return undefined;
  }
}

function shouldTrackPath(path: string) {
  return !excludedPathPrefixes.some((prefix) => path.startsWith(prefix));
}

function sendJson(endpoint: string, payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(endpoint, blob);
    return;
  }

  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

function sendMarketingEvent(payload: MarketingEventPayload) {
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({
    event: "studio_os_conversion",
    studio_os_event: payload.event,
    studio_os_label: payload.label,
    studio_os_href: payload.href,
    studio_os_path: payload.path,
    studio_os_placement: payload.placement,
  });

  window.gtag?.("event", payload.event, {
    event_category: "marketing_conversion",
    event_label: payload.label,
    link_url: payload.href,
    page_path: payload.path,
    placement: payload.placement,
  });

  window.va?.("event", {
    name: payload.event,
    data: payload,
  });

  sendJson(conversionEndpoint, payload);
}

export function MarketingEventTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || !shouldTrackPath(pathname)) return;
    sendJson(activityEndpoint, {
      type: "page_view",
      path: pathname,
      referrer: document.referrer || undefined,
      anonymousId: currentAnonymousVisitorId(),
    });
  }, [pathname]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;

      const element = event.target.closest<HTMLElement>(
        "[data-marketing-event]",
      );
      if (!element) return;

      const marketingEvent = element.dataset.marketingEvent;
      if (!marketingEvent) return;

      sendMarketingEvent({
        event: marketingEvent,
        href:
          element instanceof HTMLAnchorElement
            ? element.href
            : element.getAttribute("href") ?? undefined,
        label: element.dataset.marketingLabel,
        path: window.location.pathname,
        placement: element.dataset.marketingPlacement,
        referrer: document.referrer || undefined,
        anonymousId: currentAnonymousVisitorId(),
      });
    };

    document.addEventListener("click", handleClick, { capture: true });

    return () => {
      document.removeEventListener("click", handleClick, { capture: true });
    };
  }, []);

  return null;
}
