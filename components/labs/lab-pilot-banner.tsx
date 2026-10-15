import Link from "next/link";
import { isLabPilot } from "@/lib/labs/pilot";
import styles from "./lab-pilot.module.css";

export function LabPilotBanner() {
  if (!isLabPilot()) return null;

  return (
    <aside className={styles.banner} aria-label="Lab pilot environment">
      <span><strong>Isolated lab pilot</strong> · Sample data only · GTA and payments disabled</span>
      <Link href="/labs-pilot">Test instructions</Link>
    </aside>
  );
}

export default LabPilotBanner;
