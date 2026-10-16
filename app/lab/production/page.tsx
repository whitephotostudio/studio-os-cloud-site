import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductionWorkspace } from "@/components/labs/production-workspace";
import { isLabPilot } from "@/lib/labs/pilot";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lab photo production", robots: { index: false, follow: false } };
export default function LabProductionPage() { if (!isLabPilot()) notFound(); return <ProductionWorkspace audience="lab" />; }
