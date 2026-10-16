import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LabSetupWorkspace } from "@/components/labs/lab-setup-workspace";
import { isLabPilot } from "@/lib/labs/pilot";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Lab setup",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function LabSetupPage() {
  if (!isLabPilot()) notFound();
  return <LabSetupWorkspace />;
}
