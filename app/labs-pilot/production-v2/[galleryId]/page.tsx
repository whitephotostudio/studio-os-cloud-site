import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductionV2Gallery } from "@/components/labs/production-v2-gallery";
import { isLabPilot } from "@/lib/labs/pilot";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Private three-print gallery", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function ProductionV2GalleryPage({ params }: { params: Promise<{ galleryId: string }> }) { if (!isLabPilot()) notFound(); const { galleryId } = await params; if (!/^[a-f0-9-]{36}$/i.test(galleryId)) notFound(); return <ProductionV2Gallery galleryId={galleryId} />; }
