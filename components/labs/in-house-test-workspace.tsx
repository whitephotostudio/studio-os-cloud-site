"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ArrowRight, CheckCircle2, Download, Eye, House, ImageIcon, Inbox, Loader2, LockKeyhole, PackageCheck, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/labs/money";
import type { InHouseTestGallery, InHouseTestOrder, InHouseTestOwnerAction, InHouseTestResponse, InHouseTestStatus, InHouseTestWorkspace as Workspace } from "@/lib/labs/in-house-orders-types";
import styles from "./in-house-test-workspace.module.css";

export const inHouseTestStatusLabels: Record<InHouseTestStatus, string> = { submitted: "Submitted", accepted: "Accepted", in_production: "In production", ready: "Ready", completed: "Completed" };
export const inHouseTestSteps: InHouseTestStatus[] = ["submitted", "accepted", "in_production", "ready", "completed"];
const actionLabels = { accepted: "Accept order", in_production: "Start production", ready: "Mark ready", completed: "Complete order" };
const date = (value: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
type Pending = { action: InHouseTestOwnerAction; token?: string };
type Tab = "galleries" | "receiving" | "tracking";

export function privateInHouseToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function privateInHouseGalleryPath(galleryId: string, token: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(galleryId) || !/^[a-f0-9]{64}$/.test(token)) throw new Error("This private link is unavailable. Generate a new test link.");
  return `/labs-pilot/in-house/${encodeURIComponent(galleryId)}#access=${token}`;
}
function storageRead<T>(key: string, fallback: T): T {
  try { return JSON.parse(sessionStorage.getItem(key) || "null") as T ?? fallback; } catch { return fallback; }
}
function storageWrite(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); }
  catch { throw new Error("This browser cannot retain private test links. Enable session storage before starting a test."); }
}
async function ownerRequest(action?: InHouseTestOwnerAction, signal?: AbortSignal, expectedOwnerId?: string): Promise<InHouseTestResponse> {
  const { data: { session } } = await createClient().auth.getSession();
  if (!session?.access_token) throw new Error("Sign in with your photographer test account to open private in-house orders.");
  if (expectedOwnerId && session.user.id !== expectedOwnerId) throw new Error("The signed-in account changed. Reopen the workspace to load its private test orders.");
  const response = await fetch("/api/dashboard/in-house-test-orders", { method: action ? "POST" : "GET", cache: "no-store", signal, headers: { Authorization: `Bearer ${session.access_token}`, ...(action ? { "Content-Type": "application/json" } : {}) }, body: action ? JSON.stringify(action) : undefined });
  const result = await response.json() as InHouseTestResponse;
  if (expectedOwnerId) {
    const current = await createClient().auth.getSession();
    if (current.data.session?.user.id !== expectedOwnerId) throw new Error("The signed-in account changed. Reopen the workspace to load its private test orders.");
  }
  if (!response.ok || !result.ok) throw new Error(response.status === 409 ? result.message || "This saved version changed. Refresh and review the latest test before trying again." : result.message || "The test request could not be confirmed. Your pending request is retained for a safe retry.");
  return result;
}

export function InHouseTestWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const [tab, setTab] = useState<Tab>("galleries");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [entryId, setEntryId] = useState("");
  const [name, setName] = useState("White Photo test gallery");
  const [links, setLinks] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState("");
  const [downloadBusy, setDownloadBusy] = useState("");
  const [now, setNow] = useState(Date.now);
  const ownerRef = useRef("");
  const key = ownerId ? `studio-os-inhouse-owner:${ownerId}` : "";
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);

  const adopt = useCallback((next: Workspace) => {
    setWorkspace(next);
    setSelectedId(current => next.orders.some(order => order.id === current) ? current : next.orders[0]?.id ?? "");
    setSheetId(current => next.sheets.some(sheet => sheet.id === current) ? current : next.sheets[0]?.id ?? "");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const client = createClient();
    client.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.access_token || !session.user.id) throw new Error("Sign in with your photographer test account to open private in-house orders.");
      ownerRef.current = session.user.id;
      const result = await ownerRequest(undefined, controller.signal, session.user.id);
      if (controller.signal.aborted) return;
      if (!result.workspace) throw new Error("The private test workspace was not returned.");
      const ownerKey = `studio-os-inhouse-owner:${session.user.id}`;
      setOwnerId(session.user.id);
      setLinks(storageRead<Record<string, string>>(`${ownerKey}:links`, {}));
      setPending(storageRead<Pending | null>(`${ownerKey}:pending`, null));
      adopt(result.workspace);
      const requestedSheet = new URLSearchParams(window.location.search).get("sheet");
      if (result.workspace.sheets.some(sheet => sheet.id === requestedSheet)) setSheetId(requestedSheet!);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The private test workspace could not be opened."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN" && ownerRef.current && session?.user.id !== ownerRef.current) { controller.abort(); ownerRef.current = ""; setWorkspace(null); setOwnerId(""); setLinks({}); setPending(null); setLoading(false); setError("The signed-in account changed. Reopen this workspace to load its private test orders."); }
    });
    return () => { controller.abort(); subscription.unsubscribe(); };
  }, [adopt]);
  const sheet = workspace?.sheets.find(value => value.id === sheetId);
  const offer = sheet?.offers.find(value => value.id === entryId) ?? sheet?.offers[0];

  async function refresh() {
    if (busy) return;
    setBusy(true); setError("");
    try { const result = await ownerRequest(undefined, undefined, ownerId); if (!result.workspace) throw new Error("The latest workspace was not returned."); adopt(result.workspace); setNotice("Latest private galleries and order history loaded."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to refresh the private test workspace."); }
    finally { setBusy(false); }
  }
  async function mutate(attempt: Pending) {
    if (busy || !key) return;
    setError(""); setNotice("");
    try { storageWrite(`${key}:pending`, attempt); setPending(attempt); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to retain the test request."); return; }
    setBusy(true);
    try {
      const result = await ownerRequest(attempt.action, undefined, ownerId);
      if (!result.workspace) throw new Error("The response was incomplete. Retry the same request to confirm what was saved.");
      adopt(result.workspace);
      if (result.gallery && attempt.token) {
        const nextLinks = { ...links, [result.gallery.id]: attempt.token };
        storageWrite(`${key}:links`, nextLinks); setLinks(nextLinks);
      }
      if (attempt.action.action === "revoke_gallery") {
        const nextLinks = { ...links }; delete nextLinks[attempt.action.galleryId];
        storageWrite(`${key}:links`, nextLinks); setLinks(nextLinks); setConfirmRevoke("");
      }
      if (result.order) setSelectedId(result.order.id);
      sessionStorage.removeItem(`${key}:pending`); setPending(null);
      setNotice(attempt.action.action === "create_gallery" ? "Private test gallery saved. Open its parent test view below to place a sample order." : attempt.action.action === "rotate_gallery" ? "A new private test link is ready. The old link no longer opens this gallery." : attempt.action.action === "revoke_gallery" ? "The test gallery is closed. Its existing order history remains available." : "Order status saved. Photographer and parent tracking now show the same update.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The test update could not be confirmed. Retry the same request."); }
    finally { setBusy(false); }
  }
  function createGallery() {
    if (!sheet || !offer || !name.trim()) return;
    const token = privateInHouseToken();
    void mutate({ token, action: { action: "create_gallery", requestId: crypto.randomUUID(), sheetId: sheet.id, expectedSheetVersion: sheet.version, entryId: offer.id, name: name.trim(), accessToken: token } });
  }
  function openGallery(gallery: InHouseTestGallery) {
    try { window.open(privateInHouseGalleryPath(gallery.id, links[gallery.id]), "_blank", "noopener,noreferrer"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Generate a new private test link first."); }
  }
  async function download(orderId: string, file: "sample-8x10" | "sample-5x7" | "manifest") {
    setDownloadBusy(file); setError("");
    try {
      const { data: { session } } = await createClient().auth.getSession();
      if (!session?.access_token) throw new Error("Sign in to download this test order.");
      if (session.user.id !== ownerId) throw new Error("The signed-in account changed. Reopen your private test workspace.");
      const response = await fetch(`/api/dashboard/in-house-test-files?orderId=${encodeURIComponent(orderId)}&file=${file}`, { cache: "no-store", headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.message || "This sample file could not be downloaded."); }
      const blob = await response.blob();
      const current = await createClient().auth.getSession();
      if (current.data.session?.user.id !== ownerId || ownerRef.current !== ownerId) throw new Error("The signed-in account changed. Reopen your private test workspace.");
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = file === "manifest" ? `test-order-${orderId.slice(0, 8)}.json` : `${file}.jpg`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The test file could not be downloaded."); }
    finally { setDownloadBusy(""); }
  }
  const selected = workspace?.orders.find(order => order.id === selectedId);
  return <main className={styles.page}>
    <nav className={styles.nav} aria-label="Private in-house navigation"><Link href="/dashboard/labs"><ArrowLeft size={14} />Labs & price sheets</Link><Link href="/dashboard/labs/orders">Partner lab orders<ArrowRight size={14} /></Link></nav>
    <header className={styles.header}><div><div className={styles.eyebrow}>YOUR STUDIO · YOUR PRODUCTION</div><h1>Private in-house order test</h1><p>Try the whole journey with your copied prices: a parent chooses a package, your studio receives the order, and everyone follows its progress.</p></div><span className={styles.badge}><LockKeyhole size={13} />Private pilot</span></header>
    <div className={styles.boundary}><ShieldCheck size={17} /><span>Sample photo · In-house pickup · No payment, tax collection or production printing. Current schools and original prices stay unchanged. GTA orders remain disabled.</span></div>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {notice && <div className={styles.notice} role="status"><CheckCircle2 size={17} />{notice}</div>}
    {pending && <div className={styles.panel} style={{ marginBottom: 20 }}><h3>A test update needs confirmation</h3><p className={styles.muted}>Its original details and request ID are retained. Retry to confirm the same action, or refresh to review the saved state.</p><div className={styles.actions} style={{ marginTop: 12 }}><button className={styles.primary} disabled={busy} onClick={() => void mutate(pending)}>{busy ? <Loader2 size={14} className={styles.spin} /> : <RefreshCw size={14} />}Retry same update</button><button className={styles.secondary} disabled={busy} onClick={() => void refresh()}>Refresh & review</button><button className={styles.quiet} disabled={busy} onClick={() => { sessionStorage.removeItem(`${key}:pending`); setPending(null); setNotice("Pending retry dismissed. Review the saved workspace before starting another action."); }}>Dismiss pending retry</button></div></div>}
    <div className={styles.tabs} role="tablist" aria-label="In-house test views">{([{ id: "galleries", label: "Test galleries", icon: ImageIcon }, { id: "receiving", label: "Receiving queue", icon: Inbox }, { id: "tracking", label: "Photographer tracking", icon: Eye }] as const).map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} aria-controls={`inhouse-${item.id}`} id={`inhouse-tab-${item.id}`} onClick={() => setTab(item.id)}><item.icon size={14} />{item.label}</button>)}</div>
    {loading ? <section className={styles.empty}><Loader2 size={25} className={styles.spin} /><h2>Opening your private workspace</h2><p>Getting your copied price sheets and saved test orders.</p></section> : !workspace ? <section className={styles.empty}><House size={28} /><h2>Open your studio test account</h2><p>Sign in to review only your private test copies and orders.</p><Link className={styles.primary} href="/sign-in?redirect=%2Fdashboard%2Flabs%2Fin-house">Sign in</Link></section> : tab === "galleries" ? <section id="inhouse-galleries" role="tabpanel" aria-labelledby="inhouse-tab-galleries" className={styles.grid}>
      <div className={styles.panel}><div className={styles.sectionHead}><div><h2>Make a private test gallery</h2><p>Use one clear print package from your copied sheet.</p></div><span className={styles.badge}>Expires in 7 days</span></div>
        {workspace.sheets.length ? <form className={styles.form} onSubmit={event => { event.preventDefault(); createGallery(); }}><fieldset disabled={busy || !!pending}>
          <label>Copied price sheet<select value={sheet?.id ?? ""} onChange={event => { setSheetId(event.target.value); setEntryId(""); }}>{workspace.sheets.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
          <label>Test gallery name<input value={name} maxLength={100} required onChange={event => setName(event.target.value)} /></label>
          {sheet && <label>Print package<select value={offer?.id ?? ""} onChange={event => setEntryId(event.target.value)}>{sheet.offers.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>}
          {offer && sheet && <div className={styles.offer}><h3>{offer.name}</h3><ul className={styles.contents}>{offer.contents.map(content => <li key={content.name}>{content.qty} × {content.name}</li>)}</ul><div className={styles.price}>{formatCurrency(offer.retailCents, sheet.currency)}<small>Per package · 3 prints · Your copied retail price</small></div></div>}
          <div className={styles.offer}><Image unoptimized width={1200} height={1500} className={styles.sample} src="/labs-pilot/in-house/sample-photo" alt="Studio OS sample artwork used for this private print test" /><p className={styles.muted}>One supplied sample photo. Two prepared sample files match 8×10 and 5×7; this rehearsal does not crop your customer photos.</p></div>
          <div className={styles.formFooter}><p>Original sheets and school assignments stay in place.</p><button className={styles.primary} disabled={!offer || !name.trim()}><Plus size={15} />Create test gallery</button></div>
        </fieldset></form> : <div className={styles.empty}><PackageCheck size={29} /><h3>No eligible print package yet</h3><p>This first test needs an active package containing exactly 1 × 8×10 Lustre and 2 × 5×7 Lustre in one private copied sheet.</p><Link className={styles.secondary} href="/dashboard/labs">Review your copied prices</Link></div>}
      </div>
      <div className={styles.panel}><div className={styles.sectionHead}><div><h2>Your test galleries</h2><p>Open a private parent view, then return to receive its order.</p></div><button className={styles.secondary} disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} />Refresh</button></div>
        {workspace.galleries.length ? <div className={styles.galleryList}>{workspace.galleries.map(gallery => {
          const closed = !!gallery.revokedAt || new Date(gallery.expiresAt).getTime() <= now;
          return <article className={styles.galleryCard} key={gallery.id}><header><h3>{gallery.name}</h3><span className={styles.badge}>{gallery.revokedAt ? "Closed" : closed ? "Expired" : "Private test"}</span></header><p>{gallery.studioName} · {gallery.offer.name}</p><p>{formatCurrency(gallery.offer.retailCents, gallery.currency)} per package · 1 × 8×10 + 2 × 5×7</p><div className={styles.galleryMeta}><span>Created {date(gallery.createdAt)}</span><span>Expires {date(gallery.expiresAt)}</span></div>
            {!closed && <><div className={styles.actions}>{links[gallery.id] && <button className={styles.primary} disabled={busy || !!pending} onClick={() => openGallery(gallery)}><Eye size={14} />Open parent test view</button>}<button className={links[gallery.id] ? styles.secondary : styles.primary} disabled={busy || !!pending} onClick={() => { const token = privateInHouseToken(); void mutate({ token, action: { action: "rotate_gallery", galleryId: gallery.id, expectedVersion: gallery.version, accessToken: token } }); }}><RefreshCw size={14} />{links[gallery.id] ? "Generate new link" : "Generate private test link"}</button><button className={styles.secondary} disabled={busy || !!pending} onClick={() => setConfirmRevoke(gallery.id)}>Close gallery</button></div><p className={styles.muted}>Private links stay in this browser session. A new link replaces the previous link.</p></>}
            {confirmRevoke === gallery.id && <div className={styles.revoke}>Close this gallery to new orders? Its existing test orders and tracking remain available.<div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={() => setConfirmRevoke("")}>Keep open</button><button className={styles.secondary} disabled={busy || !!pending} onClick={() => void mutate({ action: { action: "revoke_gallery", galleryId: gallery.id, expectedVersion: gallery.version } })}>Close test gallery</button></div></div>}
          </article>;
        })}</div> : <div className={styles.empty}><ImageIcon size={27} /><h3>Your first test starts here</h3><p>Create a gallery on the left. Its sample orders will appear in your receiving queue.</p></div>}
      </div>
    </section> : <section id={`inhouse-${tab}`} role="tabpanel" aria-labelledby={`inhouse-tab-${tab}`}>
      <div className={styles.sectionHead}><div><h2>{tab === "receiving" ? "Your studio receiving queue" : "Follow every test order"}</h2><p>{tab === "receiving" ? "Review the frozen package and sample files before moving an order into production." : "The photographer sees the same saved order and status history as the receiving team."}</p></div><button className={styles.secondary} disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} />Refresh orders</button></div>
      <div className={styles.summary}><div><strong>{workspace.orders.filter(order => order.status === "submitted").length}</strong><span>Awaiting acceptance</span></div><div><strong>{workspace.orders.filter(order => ["accepted", "in_production"].includes(order.status)).length}</strong><span>In progress</span></div><div><strong>{workspace.orders.filter(order => ["ready", "completed"].includes(order.status)).length}</strong><span>Ready or completed</span></div></div>
      {workspace.orders.length ? <div className={styles.ordersGrid}><div className={styles.orderList} aria-label="Private test orders">{workspace.orders.map(order => <button key={order.id} className={styles.orderButton} aria-pressed={selectedId === order.id} onClick={() => setSelectedId(order.id)}><span className={styles.status} data-status={order.status}>{inHouseTestStatusLabels[order.status]}</span><strong>{order.reference}</strong><small>{order.snapshot.galleryName}</small><footer><span>{order.snapshot.quantity} {order.snapshot.quantity === 1 ? "package" : "packages"}</span><span>{formatCurrency(order.snapshot.subtotalMinor, order.snapshot.currency)}</span></footer></button>)}</div>{selected && <InHouseTestOrderDetail order={selected} tracking={tab === "tracking"} busy={busy || !!pending} downloadBusy={downloadBusy} onTransition={status => void mutate({ action: { action: "transition", orderId: selected.id, expectedVersion: selected.version, requestId: crypto.randomUUID(), status } })} onDownload={file => void download(selected.id, file)} />}</div> : <div className={`${styles.panel} ${styles.empty}`}><Inbox size={30} /><h2>No in-house test orders yet</h2><p>Open one of your private parent test galleries and place a sample order. It appears here when the server saves it.</p><button className={styles.primary} onClick={() => setTab("galleries")}>Open test galleries</button></div>}
    </section>}
  </main>;
}

export function InHouseTestOrderDetail({ order, tracking, busy, downloadBusy, onTransition, onDownload }: { order: InHouseTestOrder; tracking: boolean; busy: boolean; downloadBusy: string; onTransition: (status: Exclude<InHouseTestStatus, "submitted">) => void; onDownload: (file: "sample-8x10" | "sample-5x7" | "manifest") => void }) {
  const next = inHouseTestSteps[inHouseTestSteps.indexOf(order.status) + 1] as Exclude<InHouseTestStatus, "submitted"> | undefined;
  const snapshot = order.snapshot;
  return <article className={styles.panel} aria-label={`Test order ${order.reference}`}><header className={styles.detailHeader}><div><div className={styles.eyebrow}>PRIVATE TEST ORDER</div><h2>{order.reference}</h2><p>{snapshot.studioName} · In-house pickup</p><p>{date(order.createdAt)} · Version {order.version}</p></div><span className={styles.status} data-status={order.status}>{inHouseTestStatusLabels[order.status]}</span></header>
    {tracking && <div className={styles.tracking} aria-label="Order progress">{inHouseTestSteps.map((status, index) => <div key={status} data-done={index <= inHouseTestSteps.indexOf(order.status)}>{inHouseTestStatusLabels[status]}</div>)}</div>}
    <div className={styles.offer}><h3>{snapshot.offer.name}</h3><p>{snapshot.quantity} package {snapshot.quantity === 1 ? "set" : "sets"} · {snapshot.quantity * 3} prints in total</p>{snapshot.offer.contents.map(content => <div className={styles.line} key={content.name}><span>{content.name}</span><strong>{content.qty * snapshot.quantity} prints</strong></div>)}<div className={styles.total}><span>Test order subtotal</span><strong>{formatCurrency(snapshot.subtotalMinor, snapshot.currency)}</strong></div><p className={styles.muted}>No payment collected. Tax and shipping are not calculated in this rehearsal.</p></div>
    <p className={styles.muted}>Package contents, retail price and sample-file checksums were fixed when the order was submitted. Later price-sheet changes do not rewrite this order.</p>
    {!tracking && <><section className={styles.detailSection}><h3>Sample production files</h3><p>Prepared 8×10 and 5×7 artwork. Downloading does not send a print job.</p>{snapshot.assets.map(asset => <div className={styles.line} key={asset.id}><div><strong>{asset.filename}</strong><p>{asset.widthPixels} × {asset.heightPixels} px · {asset.quantity} {asset.quantity === 1 ? "print" : "prints"}</p><p className={styles.muted}>SHA-256 {asset.sha256.slice(0, 16)}…</p></div></div>)}<div className={styles.fileLinks}><button className={styles.secondary} disabled={!!downloadBusy} onClick={() => onDownload("sample-8x10")}><Download size={14} />{downloadBusy === "sample-8x10" ? "Downloading…" : "8×10 sample"}</button><button className={styles.secondary} disabled={!!downloadBusy} onClick={() => onDownload("sample-5x7")}><Download size={14} />{downloadBusy === "sample-5x7" ? "Downloading…" : "5×7 sample"}</button><button className={styles.secondary} disabled={!!downloadBusy} onClick={() => onDownload("manifest")}><Download size={14} />{downloadBusy === "manifest" ? "Downloading…" : "Order manifest"}</button></div></section><section className={styles.detailSection}><h3>{next ? "Move this order forward" : "Test order complete"}</h3><p>{next ? "Save the next step when your studio has reviewed this sample order." : "The complete in-house test journey is saved in its history."}</p>{next && <button className={styles.primary} disabled={busy} style={{ marginTop: 13 }} onClick={() => onTransition(next)}>{busy ? <Loader2 className={styles.spin} size={15} /> : <CheckCircle2 size={15} />}{actionLabels[next]}</button>}</section></>}
    <section className={styles.detailSection}><h3>Order history</h3><ol className={styles.timeline}>{order.events.map(event => <li key={event.id}><strong>{inHouseTestStatusLabels[event.status]}</strong><time dateTime={event.createdAt}>{date(event.createdAt)}</time></li>)}</ol></section>
  </article>;
}
