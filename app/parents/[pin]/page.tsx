import { Suspense } from "react";
import ParentGalleryPage from "@/components/parents/parent-gallery-client";

export const dynamic = "force-dynamic";

export default function LegacyParentGalleryPage() {
  return <Suspense fallback={<p>Opening your gallery…</p>}><ParentGalleryPage /></Suspense>;
}
