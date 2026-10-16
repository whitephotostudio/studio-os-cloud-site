import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SheetLayoutBuilder } from "@/components/labs/sheet-layout-builder";
import { isLabPilot } from "@/lib/labs/pilot";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lab test sheet layout", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function LabSheetsPage({ searchParams }: { searchParams: Promise<{ jobId?: string | string[] }> }) {
  if (!isLabPilot()) notFound();
  const { jobId } = await searchParams;
  if (jobId !== undefined && (typeof jobId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(jobId))) notFound();
  return <SheetLayoutBuilder key={jobId || "library"} audience="lab" jobId={jobId} />;
}
