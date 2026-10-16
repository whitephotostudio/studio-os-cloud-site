import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownToLine, ArrowRight, Camera, ClipboardCheck, FlaskConical, ShieldCheck } from "lucide-react";
import { isLabPilot } from "@/lib/labs/pilot";
import styles from "@/components/labs/lab-pilot.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "GTA meeting rehearsal guide",
  description: "A private Studio OS guide for rehearsing three-print ordering, review and Windows file staging.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function GtaDemoPage() {
  if (!isLabPilot()) notFound();
  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/labs-pilot" className={styles.brand}>Studio OS <span>Lab rehearsal</span></Link>
      <Link href="/labs-pilot#mfa" className={styles.quietLink}><ShieldCheck size={16} aria-hidden="true" />Lab account security</Link>
    </header>
    <section className={styles.hero}>
      <div className={styles.eyebrow}><FlaskConical size={16} aria-hidden="true" />GTA meeting guide</div>
      <h1>Ready for a rehearsal.</h1>
      <p>Walk through a photographer’s order, review each print, then stage the approved files on a Windows test helper. This guide is for evaluating a possible GTA Imaging workflow; it does not establish a lab partnership.</p>
      <div className={styles.pills}><span>Real GTA intake disabled</span><span>No payment collection</span><span>Physical printing disabled</span></div>
    </section>
    <section className={styles.card} aria-labelledby="rehearsal-steps">
      <p className={styles.eyebrow}>One complete test package</p>
      <h2 id="rehearsal-steps">Three steps to show the workflow</h2>
      <p>Use <strong>quantity 1</strong>: <strong>1 × 8×10 + 2 × 5×7</strong>. The 5×7 prints are labeled A and B so each can use its own photo and crop.</p>
      <ol className={styles.steps}>
        <li><strong>Select.</strong> In the photographer workspace, create a private test gallery using an eligible copied package and test photos. Open its private parent view, choose a photo for 8×10, 5×7 A and 5×7 B, and place one test package. Photos may be different or intentionally repeated.</li>
        <li><strong>Crop and review.</strong> Follow the saved photographer approval and crop responsibilities. The receiver accepts the job, the assigned person reviews each crop, and the lab completes any requested colour review. Review and approve all three final files before starting production preparation.</li>
        <li><strong>Stage.</strong> Download and pair the Windows test helper for the authorized destination. On a fully reviewed, in-production job, explicitly choose <strong>Stage on Windows test helper</strong>. Inspect the 8×10 file, the 10×7 sheet containing 5×7 A + B, and the manifest in its review folder. Staging does not print.</li>
      </ol>
      <p>Quantity changes repeat the complete three-print set. Original school orders and original price profiles stay unchanged.</p>
    </section>
    <div className={styles.roleGrid} style={{ marginTop: 20 }}>
      <section className={styles.card}>
        <div className={styles.icon}><Camera size={23} aria-hidden="true" /></div>
        <p className={styles.eyebrow}>Photographer</p><h2>Choose and prepare the order</h2>
        <p>Use your authorized photographer test account to create a gallery, follow the order and review the assigned photographer checks.</p>
        <Link className={styles.primary} href="/dashboard/labs/production-v2">Open photographer test workspace <ArrowRight size={17} aria-hidden="true" /></Link>
      </section>
      <section className={styles.card}>
        <div className={styles.icon}><ClipboardCheck size={23} aria-hidden="true" /></div>
        <p className={styles.eyebrow}>Lab</p><h2>Review and stage the files</h2>
        <p>Use a separate assigned lab test account and its authenticator. For an in-house rehearsal, receive the job in the photographer’s own production workspace.</p>
        <Link className={styles.primary} href="/lab/production-v2">Open lab test receiving <ArrowRight size={17} aria-hidden="true" /></Link>
        <Link className={styles.secondary} href="/labs-pilot#mfa">Set up the lab authenticator</Link>
      </section>
    </div>
    <section className={`${styles.card} ${styles.sample}`} aria-labelledby="windows-helper">
      <div><h2 id="windows-helper">Windows file-staging helper</h2><p>Download the ZIP on the test Windows computer, extract it and open <strong>Start-Studio-OS-Lab.cmd</strong>. Create a private pairing code in the production workspace’s Windows helper panel and enter it on that computer. Keep the pairing code private. This rehearsal uses a separate review folder with no printer hot-folder setup.</p></div>
      <a className={styles.outline} href="/labs-pilot/connector-download" download><ArrowDownToLine size={17} aria-hidden="true" />Download Windows helper ZIP</a>
    </section>
    <section className={`${styles.card} ${styles.security}`} aria-labelledby="gta-checklist">
      <p className={styles.eyebrow}>Bring to the GTA discussion</p><h2 id="gta-checklist">Details needed for a live lab setup</h2>
      <ul className={styles.steps}>
        <li>GTA’s current catalog CSV, product codes, supported sizes and wholesale prices.</li>
        <li>Catalog currency, paper finishes, mounting options and any product minimums.</li>
        <li>The Windows printer software, supported paper sizes, file requirements and the operator’s production process.</li>
        <li>Who crops and checks colour, when the photographer approves changes, and any agreed crop or colour service fees.</li>
        <li>Shipping and pickup options, service areas, turnaround expectations and order-status responsibilities.</li>
        <li>A supervised physical test run by a lab operator after the production connection and printer settings are confirmed.</li>
      </ul>
      <p>No partnership, commission or service fee is assumed. Real catalog mapping, payment arrangements and printer setup still need agreement and verification before activation.</p>
    </section>
    <footer className={styles.footer}>Rehearsal only. No real GTA intake, payment collection or physical printing is enabled. Use authorized test accounts and test photos; keep customer information and private gallery links out of the meeting guide.</footer>
  </main>;
}
