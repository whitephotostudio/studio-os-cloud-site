"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CheckCircle2, ImageIcon, Loader2, LockKeyhole, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/labs/money";
import type { InHouseTestGallery as Gallery, InHouseTestParentAction, InHouseTestReceipt, InHouseTestResponse, InHouseTestStatus } from "@/lib/labs/in-house-orders-types";
import styles from "./in-house-test-gallery.module.css";

type Submit = Extract<InHouseTestParentAction, { action: "submit" }>;
const statusLabels: Record<InHouseTestStatus, string> = { submitted: "Submitted", accepted: "Accepted", in_production: "In production", ready: "Ready", completed: "Completed" };
const date = (value: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
class ParentTestError extends Error { constructor(message: string, public status: number) { super(message); } }

export function inHouseTestQuantity(value: string): number | null {
  if (!/^(?:[1-9]|10)$/.test(value)) return null;
  return Number(value);
}
export function inHouseTestAccessFromHash(hash: string): string | null {
  const access = new URLSearchParams(hash.replace(/^#/, "")).get("access");
  return access && /^[a-f0-9]{64}$/.test(access) ? access : null;
}
function token() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join(""); }
function read<T>(key: string): T | null {
  try { return JSON.parse(sessionStorage.getItem(key) || "null") as T | null; } catch { return null; }
}
function write(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); }
  catch { throw new Error("This browser cannot retain a private order receipt. Enable session storage before placing a test order."); }
}
async function request(action: InHouseTestParentAction, signal?: AbortSignal): Promise<InHouseTestResponse> {
  const response = await fetch("/api/labs-pilot/in-house", { method: "POST", cache: "no-store", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
  const result = await response.json() as InHouseTestResponse;
  if (!response.ok || !result.ok) throw new ParentTestError(result.message || "The test request could not be confirmed. Your original request is retained so you can retry safely.", response.status);
  return result;
}

export function InHouseTestGallery({ galleryId }: { galleryId: string }) {
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [receipt, setReceipt] = useState<InHouseTestReceipt | null>(null);
  const [access, setAccess] = useState("");
  const [receiptToken, setReceiptToken] = useState("");
  const [pending, setPending] = useState<Submit | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [photoSelected, setPhotoSelected] = useState(false);
  const [packageSelected, setPackageSelected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now);
  const storageKey = `studio-os-inhouse-parent:${galleryId}`;
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function open() {
      const saved = read<{ token: string }>(`${storageKey}:receipt`);
      const waiting = read<Submit>(`${storageKey}:pending`);
      const validWaiting = waiting?.action === "submit" && waiting.galleryId === galleryId && /^[a-f0-9]{64}$/.test(waiting.receiptToken) ? waiting : null;
      if (validWaiting) { setPending(validWaiting); setQuantity(String(validWaiting.quantity)); setPhotoSelected(true); setPackageSelected(true); }
      const savedToken = saved && /^[a-f0-9]{64}$/.test(saved.token) ? saved.token : "";
      if (savedToken || validWaiting) {
        const receiptAccess = savedToken || validWaiting!.receiptToken;
        try {
          const result = await request({ action: "receipt", receiptToken: receiptAccess }, controller.signal);
          if (controller.signal.aborted) return;
          if (!result.order) throw new Error("The saved receipt could not be loaded.");
          write(`${storageKey}:receipt`, { token: receiptAccess });
          sessionStorage.removeItem(`${storageKey}:pending`);
          setPending(null); setReceiptToken(receiptAccess); setReceipt(result.order); return;
        } catch (cause) {
          if (controller.signal.aborted) return;
          if (savedToken || !(cause instanceof ParentTestError) || cause.status !== 404) throw cause;
        }
      }
      const accessToken = inHouseTestAccessFromHash(window.location.hash);
      if (!accessToken) throw new Error("This private test link is incomplete. Open the full parent test link from your studio workspace.");
      const result = await request({ action: "gallery", galleryId, accessToken }, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.gallery) throw new Error("The private test gallery was not returned.");
      setAccess(accessToken); setGallery(result.gallery);
    }
    open().catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The private test gallery could not be opened."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [galleryId, storageKey]);

  async function submit(attempt?: Submit) {
    if (busy || !gallery && !attempt) return;
    setError(""); setNotice("");
    const count = inHouseTestQuantity(quantity);
    if (!attempt && (!count || !photoSelected || !packageSelected || !gallery)) { setError("Select the sample photo and package, then enter 1 to 10 package sets."); return; }
    const body: Submit = attempt ?? { action: "submit", galleryId, accessToken: access, requestId: crypto.randomUUID(), receiptToken: token(), offerId: gallery!.offer.id, photoId: gallery!.photoId, quantity: count! };
    try { write(`${storageKey}:pending`, body); setPending(body); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The original request could not be retained."); return; }
    setBusy(true);
    try {
      const result = await request(body);
      if (!result.order) throw new Error("The order response was incomplete. Retry the same order to confirm its saved reference.");
      write(`${storageKey}:receipt`, { token: body.receiptToken }); sessionStorage.removeItem(`${storageKey}:pending`);
      setReceiptToken(body.receiptToken); setReceipt(result.order); setPending(null);
      setNotice("Your test order is saved. Your studio can now accept it in the receiving queue.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The order could not be confirmed. Retry the same order; its request ID is retained."); }
    finally { setBusy(false); }
  }
  async function refreshReceipt() {
    if (busy || !receiptToken) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request({ action: "receipt", receiptToken });
      if (!result.order) throw new Error("The latest receipt was not returned.");
      setReceipt(result.order); setNotice("The latest saved order status is shown below.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The latest order status could not be loaded."); }
    finally { setBusy(false); }
  }
  const count = inHouseTestQuantity(quantity);
  const closed = gallery && (!!gallery.revokedAt || new Date(gallery.expiresAt).getTime() <= now);
  return <div className={styles.shell}><main className={styles.page}>
    <header className={styles.bar}><span className={styles.brand}>{receipt?.snapshot.studioName || gallery?.studioName || "Studio OS"}</span><span className={styles.badge}><LockKeyhole size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />Private test gallery</span></header>
    {loading ? <section className={styles.empty}><Loader2 className={styles.spin} size={27} /><h2>Opening your private gallery</h2><p>Loading its saved package and sample photo.</p></section> : <>
      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice} role="status"><CheckCircle2 size={17} />{notice}</div>}
      {receipt ? <InHouseTestReceiptView receipt={receipt} busy={busy} onRefresh={() => void refreshReceipt()} /> : gallery ? <>
        <div className={styles.intro}><div className={styles.eyebrow}>A PHOTO. A PACKAGE. A SIMPLE TEST.</div><h1>{gallery.name}</h1><p>Choose the supplied sample artwork and print package, then place an in-house test order with {gallery.studioName}.</p></div>
        <div className={styles.boundary}>This rehearsal uses a sample photo and your studio’s copied retail price. No payment is collected. Tax and shipping are not calculated. Pickup only.</div>
        {pending && !busy && <div className={styles.notice}><RefreshCw size={17} /><div><strong>Your original test order is waiting for confirmation.</strong><p>Its photo, quantity, price choice and request ID are retained. Retry confirms the same order.</p><button type="button" className={styles.secondary} disabled={busy} style={{ marginTop: 12 }} onClick={() => void submit(pending)}>{busy ? "Confirming…" : "Retry same test order"}</button></div></div>}
        <form className={styles.grid} onSubmit={event => { event.preventDefault(); void submit(pending ?? undefined); }}>
          <section className={styles.panel}><h2>1. Choose your sample photo</h2><label className={styles.photoLabel} style={{ marginTop: 18 }}><Image unoptimized width={1200} height={1500} src="/labs-pilot/in-house/sample-photo" alt="Sample Studio OS artwork for the print test" /><span className={styles.photoCaption}><input type="checkbox" checked={photoSelected} disabled={busy || !!pending || !!closed} onChange={event => setPhotoSelected(event.target.checked)} />Use this sample photo</span></label><p className={styles.photoNote}>Prepared sample artwork only. No customer photograph is uploaded or sent to a lab.</p></section>
          <section className={styles.panel}><h2>2. Choose your print package</h2><div className={styles.package}><label><input type="checkbox" checked={packageSelected} disabled={busy || !!pending || !!closed} onChange={event => setPackageSelected(event.target.checked)} /><span>{gallery.offer.name}</span></label><ul className={styles.contents}>{gallery.offer.contents.map(content => <li key={content.name}>{content.qty} × {content.name}</li>)}</ul><strong>{formatCurrency(gallery.offer.retailCents, gallery.currency)}</strong><p className={styles.muted}>Per package · 3 prints</p></div><label className={styles.quantity}>Package sets<input type="number" inputMode="numeric" min="1" max="10" step="1" value={quantity} disabled={busy || !!pending || !!closed} onChange={event => setQuantity(event.target.value)} aria-label="Package sets" /></label><div className={styles.review}><div><span>{count ? `${count} package ${count === 1 ? "set" : "sets"} · ${count * 3} prints` : "Enter 1 to 10 package sets"}</span><span>In-house pickup</span></div><div><span>Test order subtotal</span><strong>{formatCurrency(gallery.offer.retailCents * (count || 0), gallery.currency)}</strong></div><p className={styles.muted}>No payment collected. Your saved order keeps the package and retail price shown here.</p></div><button className={`${styles.primary} ${styles.submit}`} disabled={busy || !!closed || !photoSelected || !packageSelected || !count}>{busy ? <><Loader2 className={styles.spin} size={15} />Saving test order…</> : pending ? "Retry same test order" : "Place test order"}</button><p className={styles.footnote}>{closed ? "This test gallery is closed to new orders." : `Private test link expires ${date(gallery.expiresAt)}.`} Your receipt stays in this browser session so you can refresh its progress.</p></section>
        </form>
      </> : <section className={styles.empty}><ImageIcon size={29} /><h2>This private test needs its full link</h2><p>Return to your studio workspace and open its parent test view. Only a valid private link opens the sample gallery.</p><a className={styles.secondary} href="/dashboard/labs/in-house">Open studio test workspace</a></section>}
    </>}
  </main></div>;
}

export function InHouseTestReceiptView({ receipt, busy, onRefresh }: { receipt: InHouseTestReceipt; busy: boolean; onRefresh: () => void }) {
  const snapshot = receipt.snapshot;
  return <section className={styles.panel} aria-label={`Receipt ${receipt.reference}`}><header className={styles.receiptHead}><div><div className={styles.eyebrow}>YOUR SAVED TEST ORDER</div><h1>{receipt.reference}</h1><p>{snapshot.galleryName} · {date(receipt.createdAt)}</p></div><span className={styles.status}>{statusLabels[receipt.status]}</span></header><div className={styles.boundary}>Private in-house rehearsal · No payment collected · Pickup at {snapshot.studioName}. This is a test order receipt.</div><h2>{snapshot.offer.name}</h2><p className={styles.muted}>{snapshot.quantity} package {snapshot.quantity === 1 ? "set" : "sets"} · {snapshot.quantity * 3} prints</p><ul className={styles.contents}>{snapshot.offer.contents.map(content => <li key={content.name}>{content.qty * snapshot.quantity} × {content.name}</li>)}</ul><div className={styles.review}><div><span>Saved order subtotal</span><strong>{formatCurrency(snapshot.subtotalMinor, snapshot.currency)}</strong></div><p className={styles.muted}>Tax and shipping were not calculated. No card was charged.</p></div><div className={styles.receiptContents}><h3>Follow your order</h3><p>Refresh after your studio accepts or updates this test order.</p><ol className={styles.timeline}>{receipt.events.map(event => <li key={event.id}><strong>{statusLabels[event.status]}</strong><time dateTime={event.createdAt}>{date(event.createdAt)}</time></li>)}</ol></div><div className={styles.receiptActions}><button className={styles.secondary} disabled={busy} onClick={onRefresh}>{busy ? <Loader2 className={styles.spin} size={15} /> : <RefreshCw size={15} />}{busy ? "Refreshing…" : "Refresh order status"}</button></div><p className={styles.footnote}>This receipt opens only your submitted test order. Keep this browser session to return to its progress.</p></section>;
}
