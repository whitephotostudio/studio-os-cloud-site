import type { Metadata } from "next";
import { LabOrdersWorkspaceView } from "@/components/labs/lab-orders-workspace";

export const metadata: Metadata = { title: "Lab receiving", robots: { index: false, follow: false } };

export default function LabPortalPage() {
  return <LabOrdersWorkspaceView audience="lab" />;
}
