"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, Clock3, Download, FileImage, Inbox, Loader2, PackageCheck, Plus, RefreshCw, Search, ShieldCheck, Store, Truck, X } from "lucide-react";
import type { LabOrder, LabOrderStatus, LabOrderTransitionAction, LabOrdersWorkspace, ManagedOrderLab } from "@/lib/labs/orders-types";
import { allowedLabOrderTransitions, LAB_ORDER_STATUSES } from "@/lib/labs/orders-validation";
import { formatCurrency } from "@/lib/labs/money";
import { createClient } from "@/lib/supabase/client";
import { LabDialog } from "./lab-dialog";
import { LabOrderCompose } from "./lab-orders-compose";
import { LabOrderApiError, labOrderFetch, labOrderRequest } from "./lab-orders-api";
import styles from "./lab-orders.module.css";

export const labOrderStatusLabels: Record<LabOrderStatus, string> = { submitted: "Submitted", accepted: "Accepted", declined: "Declined", cancelled: "Cancelled", in_production: "In production", ready: "Ready", shipped: "Shipped", completed: "Completed" };
const date = (value: string) => new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const shortId = (id: string) => id.slice(0, 8).toUpperCase();

export function LabOrdersWorkspaceView({ audience }: { audience: "lab" | "studio" }) {
  const endpoint = audience === "lab" ? "/api/lab/orders" : "/api/dashboard/lab-orders";
  const [workspace, setWorkspace] = useState<LabOrdersWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [labFilter, setLabFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);

  const applyResponse = useCallback((next: LabOrdersWorkspace, append = false) => {
    setWorkspace(previous => ({ ...next, orders: append && previous ? [...previous.orders, ...next.orders.filter(order => !previous.orders.some(existing => existing.id === order.id))] : next.orders }));
    setSelectedId(current => current && (append || next.orders.some(order => order.id === current)) ? current : next.orders[0]?.id ?? "");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    labOrderRequest(endpoint, undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (!result.workspace) throw new Error("The order workspace was not returned.");
      applyResponse(result.workspace); setNextCursor(result.nextCursor ?? null); if (audience === "lab") setLabFilter(result.workspace.managedLabs[0]?.id ?? "");
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load your lab orders."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, applyResponse, audience]);
  async function refresh(older = false, nextLabId = labFilter) {
    setRefreshing(true); setError("");
    try {
      const params = new URLSearchParams(); if (nextLabId) params.set("labId", nextLabId); if (older && nextCursor) params.set("cursor", nextCursor);
      const result = await labOrderRequest(endpoint + (params.size ? `?${params.toString()}` : ""));
      if (!result.workspace) throw new Error("The latest orders could not be loaded.");
      applyResponse(result.workspace, older); setNextCursor(result.nextCursor ?? null); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to refresh your orders."); return false; }
    finally { setRefreshing(false); }
  }
  function updateOrder(order: LabOrder) {
    setWorkspace(current => current ? { ...current, orders: current.orders.some(existing => existing.id === order.id) ? current.orders.map(existing => existing.id === order.id ? order : existing) : [order, ...current.orders] } : current);
    setSelectedId(order.id); setStatusFilter(""); setQuery("");
  }
  function openOrder(id: string) {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 850px)").matches) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  async function signOut() {
    setSigningOut(true); setError("");
    try {
      const result = await createClient().auth.signOut({ scope: "local" });
      if (result.error) throw result.error;
      window.location.replace(new URL("/sign-in?redirect=%2Flab", window.location.origin).href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-out could not be completed. Please try again.");
      setSigningOut(false);
    }
  }
  const labs = audience === "lab" ? workspace?.managedLabs ?? [] : workspace?.labs ?? [];
  const readyLabs = workspace?.labs.filter(lab => lab.status === "active" && lab.intakeEnabled && lab.catalogVerified) ?? [];
  const orders = workspace?.orders.filter(order => (!labFilter || order.labId === labFilter) && (!statusFilter || order.status === statusFilter) && `${order.reference} ${order.id} ${order.snapshot.lab.name} ${order.snapshot.studio.name}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const selected = orders.find(order => order.id === selectedId);
  const role = audience === "studio" ? "studio" : workspace?.managedLabs.find(lab => lab.id === selected?.labId)?.role ?? "viewer";
  const pending = workspace?.orders.filter(order => order.status === "submitted").length ?? 0;
  const producing = workspace?.orders.filter(order => ["accepted", "in_production"].includes(order.status)).length ?? 0;
  const outbound = workspace?.orders.filter(order => ["ready", "shipped"].includes(order.status)).length ?? 0;

  return <div className={audience === "lab" ? styles.portal : ""}>
    {audience === "lab" && <div className={styles.portalBar}><Link href="/lab" className={styles.wordmark}>STUDIO OS<span>LAB PORTAL</span></Link><div><ShieldCheck size={16} /><span>Private lab workspace</span></div><div className={styles.portalAccount}><Link href="/dashboard/labs/orders">Studio workspace <ArrowRight size={14} /></Link><button type="button" onClick={() => void signOut()} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button></div></div>}
    <main className={styles.page}>
      {audience === "studio" && <nav className={styles.localNav} aria-label="Production workspaces"><Link href="/dashboard/labs"><ArrowLeft size={14} /> Labs & price sheets</Link><Link href="/dashboard/packages">In-house / Self-fulfillment <ArrowRight size={14} /></Link></nav>}
      <header className={styles.header}><div><div className={styles.eyebrow}>{audience === "lab" ? "ORDERS, READY FOR YOUR TEAM" : "YOUR STUDIO. YOUR PRODUCTION PARTNERS."}</div><h1>{audience === "lab" ? "Lab receiving" : "Partner lab orders"}</h1><p>{audience === "lab" ? "Receive final files, review each order, and keep studios informed as work moves forward." : "Send final print files to a ready lab and follow the order from submission to delivery."}</p></div><div className={styles.actions}><button className={styles.secondary} onClick={() => void refresh()} disabled={loading || refreshing}><RefreshCw size={15} className={refreshing ? styles.spin : ""} />Refresh</button>{audience === "studio" && <button className={styles.primary} onClick={() => setShowCompose(true)} disabled={loading || !readyLabs.length}><Plus size={16} />New lab order</button>}</div></header>
      {error && <div role="alert" className={styles.error}><span>{error}</span><button className={styles.iconButton} aria-label="Dismiss error" onClick={() => setError("")}><X size={17} /></button></div>}
      {notice && <div role="status" className={styles.success}><CheckCircle2 size={18} />{notice}</div>}
      {loading ? <div className={styles.empty}><Loader2 className={styles.spin} size={27} /><h2>Opening your orders</h2><p>Getting the latest saved order status.</p></div> : !workspace ? <div className={styles.empty}><ShieldCheck size={30} /><h2>A private workspace for your orders.</h2><p>Sign in with the account connected to your studio or lab to continue.</p><Link className={styles.primary} href={`/sign-in?redirect=${encodeURIComponent(audience === "lab" ? "/lab" : "/dashboard/labs/orders")}`}>Sign in</Link></div> : audience === "lab" && !labs.length ? <div className={styles.empty}><Store size={31} /><h2>Your lab connection starts here.</h2><p>This account does not have an active lab membership. Ask your Studio OS administrator to connect you as an owner, operator or viewer.</p></div> : <>
        {audience === "studio" && <div className={styles.info}><ShieldCheck size={18} /><p><strong>Final files. Clear handoff.</strong> These direct orders are billed separately by the lab. Studio OS does not charge a card here. Your existing in-house printing and self-fulfillment remain available.</p></div>}
        {audience === "studio" && !readyLabs.length && <div className={styles.info}><Store size={18} /><p><strong>No lab is ready to receive an order yet.</strong> A lab must have an approved catalog and an enabled order connection before you can submit files. Existing orders remain available below.</p></div>}
        <div className={styles.stats} aria-label="Loaded order counts"><div><Inbox size={19} /><strong>{pending}</strong><span>{audience === "lab" ? "Awaiting review" : "Submitted"}</span></div><div><PackageCheck size={19} /><strong>{producing}</strong><span>Accepted / in production</span></div><div><Truck size={19} /><strong>{outbound}</strong><span>Ready / shipped</span></div></div>
        <div className={styles.filters}><label>Lab<select value={labFilter} disabled={refreshing} onChange={event => { setLabFilter(event.target.value); setNextCursor(null); void refresh(false, event.target.value); }}>{audience === "studio" && <option value="">All partner labs</option>}{labs.map(lab => <option value={lab.id} key={lab.id}>{lab.name}{"role" in lab ? ` · ${(lab as ManagedOrderLab).role}` : ""}</option>)}</select></label><label>Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="">All statuses</option>{LAB_ORDER_STATUSES.map(status => <option key={status} value={status}>{labOrderStatusLabels[status]}</option>)}</select></label><label className={styles.searchLabel}>Search loaded orders<div className={styles.search}><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Reference, studio or order number…" /></div></label></div>
        <div className={styles.ordersGrid}><section className={styles.orderList} aria-label="Orders"><div className={styles.listHeading}><h2>{orders.length} {orders.length === 1 ? "order" : "orders"}</h2><span>Loaded orders</span></div>{orders.length ? orders.map(order => <button key={order.id} className={`${styles.orderCard} ${selectedId === order.id ? styles.selectedOrder : ""}`} onClick={() => openOrder(order.id)} aria-pressed={selectedId === order.id}><div><span className={`${styles.status} ${styles[order.status]}`}>{labOrderStatusLabels[order.status]}</span><span className={styles.orderId}>#{shortId(order.id)}</span></div><h3>{order.reference}</h3><p>{audience === "lab" ? order.snapshot.studio.name : order.snapshot.lab.name}</p><footer><span>{new Intl.DateTimeFormat("en-CA", { dateStyle: "medium" }).format(new Date(order.createdAt))}</span><strong>{formatCurrency(order.totalMinor, order.currency)}</strong><ChevronRight size={15} /></footer></button>) : <div className={styles.smallEmpty}><Inbox size={26} /><h3>No orders in this view.</h3><p>{workspace.orders.length ? "Try another status, lab or search." : audience === "lab" ? "Submitted studio orders will appear here for your team to review." : "Create an order when your lab is ready to receive final files."}</p></div>}{nextCursor && <div className={styles.loadOlder}><button className={styles.secondary} disabled={refreshing} onClick={() => void refresh(true)}>{refreshing ? "Loading…" : "Load older orders"}</button></div>}</section>
          <div ref={detailRef} className={styles.detailColumn}>{selected ? <OrderDetail order={selected} role={role} audience={audience} endpoint={endpoint} onOrder={updateOrder} onReload={() => refresh()} onNotice={setNotice} /> : <div className={styles.detailPlaceholder}><FileImage size={32} /><h2>Every detail, in one place.</h2><p>Select an order to see its final files, frozen product details, delivery information and history.</p></div>}</div>
        </div>
      </>}
      {showCompose && workspace && <LabOrderCompose labs={workspace.labs} catalog={workspace.catalog} onClose={() => setShowCompose(false)} onSubmitted={order => { updateOrder(order); setLabFilter(order.labId); setNextCursor(null); setShowCompose(false); setNotice("Order submitted to the lab. Its saved files and product details are now fixed for production."); }} />}
    </main>
  </div>;
}

function OrderDetail({ order, role, audience, endpoint, onOrder, onReload, onNotice }: { order: LabOrder; role: "studio" | "owner" | "operator" | "viewer"; audience: "lab" | "studio"; endpoint: string; onOrder: (order: LabOrder) => void; onReload: () => Promise<boolean>; onNotice: (message: string) => void }) {
  const [fileBusy, setFileBusy] = useState(""); const [fileError, setFileError] = useState("");
  async function download(assetId: string, filename: string) {
    setFileBusy(assetId); setFileError("");
    try { const response = await labOrderFetch(`/api/lab/orders/${encodeURIComponent(order.id)}/files/${encodeURIComponent(assetId)}${audience === "studio" ? "?audience=studio" : ""}`); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (cause) { setFileError(cause instanceof Error ? cause.message : "The final file could not be downloaded."); }
    finally { setFileBusy(""); }
  }
  return <section className={styles.detail} aria-label={`Order ${order.reference}`}><div className={styles.detailHeader}><div><div className={styles.eyebrow}>ORDER #{shortId(order.id)}</div><h2>{order.reference}</h2><p>{order.snapshot.studio.name} <span>→</span> {order.snapshot.lab.name}</p></div><span className={`${styles.status} ${styles[order.status]}`}>{labOrderStatusLabels[order.status]}</span></div><div className={styles.detailMeta}><span><Clock3 size={13} /> {date(order.createdAt)}</span><span>Version {order.version}</span><span>{role === "studio" ? "Your studio order" : `${role[0].toUpperCase()}${role.slice(1)} access`}</span></div><div className={styles.snapshotNote}><ShieldCheck size={16} /><span>Files, products, quantities and costs are fixed to the submitted order. Later catalog changes do not rewrite it.</span></div>
    <div className={styles.lines}>{order.snapshot.items.map(line => <article key={line.line} className={styles.line}><span className={styles.fileTile}><FileImage size={23} /></span><div><h3>{line.name}</h3><p>{line.size} · {line.finish || line.category} · SKU {line.sku}</p><span className={styles.filename}>{line.asset.filename}</span><span className={styles.fileMetadata}>{line.asset.widthPixels} × {line.asset.heightPixels} px · {(line.asset.byteSize / 1_000_000).toFixed(2)} MB</span><span className={styles.checksum} title={line.asset.sha256}>SHA-256 {line.asset.sha256.slice(0, 16)}…</span><button className={styles.fileDownload} disabled={!!fileBusy} onClick={() => void download(line.asset.id, line.asset.filename)}>{fileBusy === line.asset.id ? <Loader2 className={styles.spin} size={13} /> : <Download size={13} />}Download final file</button></div><div className={styles.linePrice}><strong>{line.quantity} × {formatCurrency(line.unitCostMinor, order.currency)}</strong><span>{formatCurrency(line.lineCostMinor, order.currency)}</span></div></article>)}</div>
    {fileError && <div className={styles.inlineError} role="alert">{fileError}</div>}
    <div className={styles.orderTotal}><span>Submitted product total <small>Shipping, taxes and lab billing are handled separately.</small></span><strong>{formatCurrency(order.totalMinor, order.currency)}</strong></div><div className={styles.deliveryGrid}><article><h3><Truck size={16} />{order.snapshot.delivery.mode === "pickup" ? "Lab pickup" : "Ship to studio"}</h3><strong>{order.snapshot.delivery.name}</strong>{order.snapshot.delivery.address && <p className={styles.prewrap}>{order.snapshot.delivery.address}</p>}</article><article><h3>Studio notes</h3><p className={styles.prewrap}>{order.snapshot.notes || "No additional notes."}</p></article></div>
    <OrderActions key={order.id} order={order} role={role} endpoint={endpoint} onOrder={onOrder} onReload={onReload} onNotice={onNotice} />
    <div className={styles.timeline}><h3>Order history</h3>{order.events.length ? <ol>{order.events.map(event => <li key={event.id}><span className={styles.timelineDot} /><div><strong>{labOrderStatusLabels[event.toStatus]}</strong><time dateTime={event.createdAt}>{date(event.createdAt)}</time>{event.reason && <p className={styles.prewrap}>{event.reason}</p>}{(event.carrier || event.trackingNumber) && <p><Truck size={13} /> {event.carrier} · {event.trackingNumber}</p>}</div></li>)}</ol> : <p className={styles.muted}>No status events were returned.</p>}</div>
    {audience === "studio" && <div className={styles.detailFootnote}>Production is carried out by your selected lab. Contact the lab about billing, changes after acceptance or a production issue.</div>}
  </section>;
}

function OrderActions({ order, role, endpoint, onOrder, onReload, onNotice }: { order: LabOrder; role: "studio" | "owner" | "operator" | "viewer"; endpoint: string; onOrder: (order: LabOrder) => void; onReload: () => Promise<boolean>; onNotice: (message: string) => void }) {
  const [target, setTarget] = useState<LabOrderStatus>("accepted"); const [reason, setReason] = useState(""); const [carrier, setCarrier] = useState(""); const [trackingNumber, setTrackingNumber] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [attempt, setAttempt] = useState<LabOrderTransitionAction | null>(null); const [confirmCancel, setConfirmCancel] = useState(false);
  const allowed = allowedLabOrderTransitions(order.status, order.snapshot.delivery.mode, role);
  const effective = allowed.includes(target) ? target : allowed[0];
  async function transition() {
    if (busy || !effective) return;
    const payload: LabOrderTransitionAction = attempt ?? { action: "transition", orderId: order.id, expectedVersion: order.version, requestId: crypto.randomUUID(), status: effective, reason: reason.trim(), carrier: effective === "shipped" ? carrier.trim() : "", trackingNumber: effective === "shipped" ? trackingNumber.trim() : "" };
    setBusy(true); setError(""); setAttempt(payload);
    try { const result = await labOrderRequest(endpoint, payload); if (!result.order) throw new Error("The updated order could not be confirmed. Retry the same update."); onOrder(result.order); setAttempt(null); setConfirmCancel(false); setReason(""); setCarrier(""); setTrackingNumber(""); onNotice(`Order ${labOrderStatusLabels[result.order.status].toLowerCase()}. The change is saved in its history.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The status update could not be confirmed."); if (cause instanceof LabOrderApiError && cause.status >= 400 && cause.status < 500) setAttempt(null); }
    finally { setBusy(false); }
  }
  if (role === "viewer") return <div className={styles.actionNote}><ShieldCheck size={16} />Viewer access: you can inspect orders and download files. An owner or operator updates production status.</div>;
  if (!allowed.length) return <div className={styles.actionNote}><CheckCircle2 size={16} />{role === "studio" ? order.status === "declined" ? "The lab declined this order. Review its reason in the history before submitting a new order." : order.status === "cancelled" ? "This order was cancelled before acceptance." : order.status === "completed" ? "This order is complete." : "Contact the lab to request a change after acceptance." : "No further status changes are available for this order."}</div>;
  const buttonText = effective === "accepted" ? "Accept order" : effective === "declined" ? "Decline order" : effective === "in_production" ? "Start production" : effective === "ready" ? "Mark ready" : effective === "shipped" ? "Save shipment" : effective === "completed" ? "Complete order" : "Cancel order";
  return <div className={styles.orderActions}><h3>{role === "studio" ? "Before the lab accepts" : "Move this order forward"}</h3>{error && <div className={styles.inlineError} role="alert">{error}</div>}{role === "studio" ? <><p>You can cancel a submitted order before the lab accepts it.</p><button className={styles.secondary} disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel submitted order</button></> : <form onSubmit={event => { event.preventDefault(); void transition(); }}><fieldset disabled={busy || !!attempt}><label>Next status<select value={effective} onChange={event => setTarget(event.target.value as LabOrderStatus)}>{allowed.map(status => <option key={status} value={status}>{labOrderStatusLabels[status]}</option>)}</select></label><label>{effective === "declined" ? "Reason for declining *" : "Note for the studio (optional)"}<textarea maxLength={2000} required={effective === "declined"} rows={2} value={reason} onChange={event => setReason(event.target.value)} placeholder={effective === "declined" ? "Explain what needs attention before a new order can be accepted." : "A useful update for the studio…"} /></label>{effective === "shipped" && <div className={styles.twoColumns}><label>Carrier *<input required maxLength={100} value={carrier} onChange={event => setCarrier(event.target.value)} /></label><label>Tracking number *<input required maxLength={200} value={trackingNumber} onChange={event => setTrackingNumber(event.target.value)} /></label></div>}</fieldset><div className={styles.actionButtons}>{(attempt || error) && <button type="button" className={styles.secondary} disabled={busy} onClick={async () => { if (await onReload()) { setAttempt(null); setError(""); } }}>Refresh & review</button>}<button className={styles.primary} disabled={busy || effective === "declined" && !reason.trim() || effective === "shipped" && (!carrier.trim() || !trackingNumber.trim())}>{busy ? <Loader2 className={styles.spin} size={15} /> : <CheckCircle2 size={15} />}{busy ? "Saving…" : attempt ? "Retry same update" : buttonText}</button></div></form>}{role === "studio" && error && <button className={styles.secondary} disabled={busy} onClick={() => void onReload()}>Refresh order</button>}{attempt && <p className={styles.retryNote}>This update keeps its original request ID and version. Retry confirms the same action.</p>}{confirmCancel && <LabDialog title="Cancel this submitted order?" description="The request is checked against the latest saved version. An accepted order cannot be cancelled here." busy={busy} error={error} onClose={() => setConfirmCancel(false)}><label className={styles.cancelReason}>Reason (optional)<textarea rows={3} maxLength={2000} disabled={busy || !!attempt} value={reason} onChange={event => setReason(event.target.value)} /></label><div className={styles.actionButtons}><button className={styles.secondary} disabled={busy} onClick={() => setConfirmCancel(false)}>Keep order</button><button className={styles.primary} disabled={busy} onClick={() => void transition()}>{busy ? "Cancelling…" : attempt ? "Retry same cancellation" : "Cancel order"}</button></div></LabDialog>}</div>;
}
