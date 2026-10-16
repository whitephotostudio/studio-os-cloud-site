import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InHouseTestGallery } from "@/components/labs/in-house-test-gallery";
import { isLabPilot } from "@/lib/labs/pilot";

export const metadata: Metadata = { title: "Private test gallery", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PrivateTestGalleryPage({ params }: { params: Promise<{ galleryId: string }> }) {
  if (!isLabPilot()) notFound();
  const { galleryId } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(galleryId)) notFound();
  return <InHouseTestGallery galleryId={galleryId} />;
}
