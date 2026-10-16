import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductionGallery } from "@/components/labs/production-gallery";
import { isLabPilot } from "@/lib/labs/pilot";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Private photo gallery", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function ProductionGalleryPage({ params }: { params: Promise<{ galleryId: string }> }) { if (!isLabPilot()) notFound(); const { galleryId } = await params; if (!/^[a-f0-9-]{36}$/i.test(galleryId)) notFound(); return <ProductionGallery galleryId={galleryId} />; }
