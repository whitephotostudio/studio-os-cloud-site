import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { resolveParentCheckoutReturn } from "@/lib/parent-checkout-return";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function ParentCheckoutReturnPage({ params, searchParams }: {
  params: Promise<{ returnId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { returnId } = await params;
  const query = await searchParams;
  const requestHeaders = new Headers(await headers());
  const origin = process.env.NODE_ENV === "production" ? "https://www.studiooscloud.com"
    : `${requestHeaders.get("x-forwarded-proto") === "https" ? "https" : "http"}://${requestHeaders.get("host") || "localhost:3000"}`;
  const url = new URL(`/parents/checkout-return/${encodeURIComponent(returnId)}`, origin);
  let target: string | null = null;
  try {
    for (const key of Object.keys(query)) {
      if (!["result", "session_id"].includes(key) || typeof query[key] !== "string") throw new Error("Invalid checkout return.");
      url.searchParams.set(key, query[key]);
    }
    if (!url.searchParams.has("result")) throw new Error("Missing checkout status.");
    const request = new Request(url, { headers: requestHeaders });
    const returned = await resolveParentCheckoutReturn(request, returnId);
    target = `/parents/view/${returned.laneId}?checkout=${returned.status}&return=${returned.returnId}`;
  } catch {
    // A Stripe Link/payment handoff may open a different browser. Never
    // replace its cookie, replay credentials in the URL, or clear its basket.
  }
  if (target) redirect(target);
  return <main style={{ maxWidth: 520, margin: "12vh auto", padding: 24, color: "#111827", background: "#fff", borderRadius: 16 }}>
    <h1>Reopen your gallery</h1>
    <p>This payment return is unavailable in this browser. Your saved basket has been kept.</p>
    <p>Use your original QR label or enter your PIN again to check your orders. If you just paid, check your confirmation before starting another purchase.</p>
    <Link href="/parents">Open the parent portal</Link>
  </main>;
}
