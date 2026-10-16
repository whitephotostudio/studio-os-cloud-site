import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownToLine, ArrowRight, Camera, FlaskConical, ShieldCheck } from "lucide-react";
import { isLabPilot } from "@/lib/labs/pilot";
import { LabPilotMfa } from "@/components/labs/lab-pilot-mfa";
import styles from "@/components/labs/lab-pilot.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lab pilot",
  description: "Isolated Studio OS testing for sample lab orders and private retail-price drafts.",
  robots: { index: false, follow: false },
};

export default function LabsPilotPage() {
  if (!isLabPilot()) notFound();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/labs-pilot" className={styles.brand}>Studio OS <span>Lab pilot</span></Link>
        <a href="#mfa" className={styles.quietLink}><ShieldCheck size={16} aria-hidden="true" /> Lab account security</a>
      </header>

      <section className={styles.hero}>
        <div className={styles.eyebrow}><FlaskConical size={16} aria-hidden="true" /> Isolated test environment</div>
        <h1>Try both sides of a lab order.</h1>
        <p>Use the separate photographer and lab test credentials supplied to you. Test orders use sample photos and products. You can also review private copies of your studio’s retail prices; editing these drafts leaves your original price profiles and current school prices unchanged. GTA production is disabled, and this environment does not collect payments or send real production orders.</p>
        <div className={styles.pills}><span>Sample files only</span><span>Separate test accounts</span><span>No card charges</span></div>
        <Link className={styles.quietLink} style={{ marginTop: 18 }} href="/labs-pilot/gta-demo">GTA meeting rehearsal guide <ArrowRight size={16} aria-hidden="true" /></Link>
      </section>

      <div className={styles.roleGrid}>
        <section className={styles.card}>
          <div className={styles.icon}><Camera size={23} aria-hidden="true" /></div>
          <p className={styles.eyebrow}>Photographer</p>
          <h2>Build and send a test order</h2>
          <ol className={styles.steps}>
            <li>Sign in with the supplied photographer test account.</li>
            <li>Review the sample lab price sheets or your private in-house test copies. Open <strong>Lab orders</strong> to test sample lab products.</li>
            <li>Choose a sample product, upload the sample JPEG, and submit a test order.</li>
            <li>Return after the lab updates it to check the order timeline.</li>
          </ol>
          <Link className={styles.primary} href="/dashboard/labs">Open photographer workspace <ArrowRight size={17} aria-hidden="true" /></Link>
          <Link className={styles.secondary} href="/dashboard/labs/orders">Go directly to lab orders</Link>
          <Link className={styles.secondary} href="/dashboard/labs/in-house">Test your own in-house prices and receiving queue</Link>
          <Link className={styles.secondary} href="/dashboard/labs/production">Use private photos with production approval and crops</Link>
          <Link className={styles.secondary} href="/dashboard/labs/production-v2">Choose different photos for each print and test Windows handoff</Link>
        </section>

        <section className={styles.card}>
          <div className={styles.icon}><FlaskConical size={23} aria-hidden="true" /></div>
          <p className={styles.eyebrow}>Lab</p>
          <h2>Receive and track a test order</h2>
          <ol className={styles.steps}>
            <li>Sign out of the photographer account and sign in with the supplied lab test account.</li>
            <li>Set up your own authenticator in <a href="#mfa">Lab account security below</a>, then sign in again with its code.</li>
            <li>Open the lab portal to review the order and download its sample file.</li>
            <li>Accept or decline it, then test the available production and delivery updates.</li>
          </ol>
          <Link className={styles.secondary} href="/lab/production-v2">Receive and review three-print test jobs</Link>
          <Link className={styles.primary} href="/lab">Open lab portal <ArrowRight size={17} aria-hidden="true" /></Link>
          <Link className={styles.secondary} href="/lab/setup">Set up your lab catalog, paper & services</Link>
          <a className={styles.secondary} href="#mfa">Set up lab authenticator first</a>
        </section>
      </div>

      <section className={`${styles.card} ${styles.sample}`} aria-labelledby="sample-heading">
        <div>
          <h2 id="sample-heading">A file you can safely use</h2>
          <p>Download the supplied sample JPEG and use it for a matching 4 × 6 test print. Export your own test images as upright JPEG or PNG files with rotation applied to the pixels, up to 4 MB each. Files must match the chosen product’s aspect ratio; the pilot does not crop them.</p>
        </div>
        <a className={styles.outline} href="/labs-pilot/sample-file" download><ArrowDownToLine size={17} aria-hidden="true" /> Download sample JPEG</a>
      </section>

      <section id="mfa" className={`${styles.card} ${styles.security}`} aria-labelledby="security-heading">
        <p className={styles.eyebrow}><ShieldCheck size={15} aria-hidden="true" /> Lab account security</p>
        <h2 id="security-heading">Set up your own authenticator</h2>
        <p>Use this page at <code>/labs-pilot#mfa</code> while signed in as the lab test account. You do not need to create a photographer profile. Each tester should use their supplied account and their own authenticator; keep its QR code and setup key private.</p>
        <LabPilotMfa />
      </section>

      <footer className={styles.footer}>Use the supplied test accounts and sample photos for test orders. Private retail-price copies are drafts; your original price profiles and current school prices remain unchanged. GTA production and paid checkout are disabled.</footer>
    </main>
  );
}
