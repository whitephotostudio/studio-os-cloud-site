import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductionV2Workspace } from "@/components/labs/production-v2-workspace";
import { isLabPilot } from "@/lib/labs/pilot";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Three-print production pilot", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function ProductionV2Page() { if (!isLabPilot()) notFound(); return <ProductionV2Workspace audience="studio" />; }
