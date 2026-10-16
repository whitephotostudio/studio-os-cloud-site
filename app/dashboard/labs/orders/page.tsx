import type { Metadata } from "next";
import { LabOrdersWorkspaceView } from "@/components/labs/lab-orders-workspace";
import { isLabPilot } from "@/lib/labs/pilot";

export const metadata: Metadata = { title: "Partner lab orders", robots: { index: false, follow: false } };

export default function StudioLabOrdersPage() {
  return <LabOrdersWorkspaceView audience="studio" productionEnabled={isLabPilot()} />;
}
