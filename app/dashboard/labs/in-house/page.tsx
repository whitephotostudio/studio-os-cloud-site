import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InHouseTestWorkspace } from "@/components/labs/in-house-test-workspace";
import { isLabPilot } from "@/lib/labs/pilot";

export const metadata: Metadata = { title: "Private in-house order test", robots: { index: false, follow: false } };

export default function InHouseTestPage() {
  if (!isLabPilot()) notFound();
  return <InHouseTestWorkspace />;
}
