"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isNativeCompanion, isPlatformPurchaseRoute } from "@/lib/native-companion";

export function NativeCompanionGuard() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!isNativeCompanion()) return;
    document.documentElement.classList.add("studio-os-native");
    if (isPlatformPurchaseRoute(window.location.href)) router.replace("/m");
    const hidePurchaseLinks = () => {
      for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        if (isPlatformPurchaseRoute(anchor.href)) anchor.dataset.nativePurchase = "platform";
      }
    };
    hidePurchaseLinks();
    const observer = new MutationObserver(hidePurchaseLinks);
    observer.observe(document.body, { childList: true, subtree: true });
    const clicked = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || !isPlatformPurchaseRoute(anchor.href)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("click", clicked, true);
    return () => { observer.disconnect(); document.removeEventListener("click", clicked, true); };
  }, [pathname, router]);
  return null;
}
