import { Suspense } from "react";
import { headers } from "next/headers";
import Link from "next/link";
import ParentGalleryPage from "@/components/parents/parent-gallery-client";
import { resolveParentGallerySession } from "@/lib/parent-gallery-session";
import { resolveParentCheckoutReturn } from "@/lib/parent-checkout-return";
import { createParentGalleryEntryPath } from "@/lib/parent-gallery-entry";
import type { ParentSessionAccess } from "@/lib/parent-gallery-session-client";

export const dynamic = "force-dynamic";

export default async function PrivateParentGalleryPage({ params, searchParams }: {
  params: Promise<{ laneId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { laneId } = await params;
  const query = await searchParams;
  if (query.checkout !== undefined && (typeof query.checkout !== "string" || !["success", "cancel"].includes(query.checkout))) {
    return <p>Invalid checkout return. Reopen your original gallery to check your order.</p>;
  }
  const requestHeaders = new Headers(await headers());
  const origin = process.env.NODE_ENV === "production" ? "https://www.studiooscloud.com"
    : `${requestHeaders.get("x-forwarded-proto") === "https" ? "https" : "http"}://${requestHeaders.get("host") || "localhost:3000"}`;
  const target = new URL(`/parents/view/${encodeURIComponent(laneId)}`, origin);
  if (typeof query.checkout === "string") target.searchParams.set("checkout", query.checkout);
  const request = new Request(target, {
    headers: requestHeaders,
  });
  let access: ParentSessionAccess;
  try {
    const scope = await resolveParentGallerySession(request, laneId);
    access = { laneId: scope.laneId, kind: scope.kind, galleryId: scope.galleryId,
      viewerEmail: scope.email, photographerId: scope.photographerId,
      shareUrl: createParentGalleryEntryPath(scope) };
    if (query.return !== undefined) {
      if (typeof query.return !== "string") throw new Error("Invalid checkout return.");
      const returned = await resolveParentCheckoutReturn(request, query.return, scope.laneId);
      if (!returned) throw new Error("Checkout return unavailable.");
      access.checkoutReturnId = returned.returnId;
      access.checkoutSessionId = returned.sessionId;
      access.checkoutStatus = returned.status;
    }
  } catch {
    return <main style={{ maxWidth: 520, margin: "12vh auto", padding: 24, color: "#111827", background: "#fff", borderRadius: 16 }}>
      <h1>Open your gallery again</h1>
      <p>Your private gallery session has expired or is unavailable in this browser. Your saved basket has been kept.</p>
      <p>Use your original QR label or enter your PIN again. If you just paid, check your order before starting another purchase.</p>
      <Link href="/parents">Open the parent portal</Link>
    </main>;
  }
  return <Suspense fallback={<p>Opening your gallery…</p>}><ParentGalleryPage sessionAccess={access} /></Suspense>;
}
