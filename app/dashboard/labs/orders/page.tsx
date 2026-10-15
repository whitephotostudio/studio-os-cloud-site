import type { Metadata } from "next";
import { LabOrdersWorkspaceView } from "@/components/labs/lab-orders-workspace";

export const metadata: Metadata = { title: "Partner lab orders", robots: { index: false, follow: false } };

export default function StudioLabOrdersPage() {
  return <LabOrdersWorkspaceView audience="studio" />;
}
