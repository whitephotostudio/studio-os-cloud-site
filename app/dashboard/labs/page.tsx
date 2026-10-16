import { LabWorkspaceView } from "@/components/labs/lab-workspace";
import { isLabPilot } from "@/lib/labs/pilot";

export default function LabsPage() {
  return <LabWorkspaceView inHouseOrderTests={isLabPilot()} />;
}
