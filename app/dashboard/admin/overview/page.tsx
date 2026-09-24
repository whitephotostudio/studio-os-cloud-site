"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Circle, RefreshCw, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { accountAccess, accountAttention, emailState, historyTitle, ownerMoney, type OwnerAccount, type OwnerHistory, type OwnerSnapshot } from "@/lib/owner-overview";
import styles from "./overview.module.css";

async function ownerFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data: { session } } = await createClient().auth.getSession();
  const response = await fetch(path, { ...options, cache: "no-store", headers: {
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...options.headers,
  } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "Unable to check this information.");
  return body as T;
}
function date(value: string | null) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Unknown date";
}
function Progress({ account }: { account: OwnerAccount }) {
  const steps: [string, string | null][] = [
    ["Email confirmed", account.email_confirmed_at],
    [account.is_owner || account.has_subscription ? "Account access" : "Trial set up", account.is_owner || account.has_subscription ? account.created_at : account.trial_ends_at ? account.trial_starts_at : null],
    ["App activated", account.first_activation_at], ["Gallery created", account.first_gallery_at], ["Photo saved", account.first_photo_at],
  ];
  return <ol className={styles.progress}>{steps.map(([label, at]) => <li key={label} className={at ? styles.completed : ""} title={`${label}: ${date(at)}`}>
    {at ? <Check size={14} aria-hidden /> : <Circle size={13} aria-hidden />}<span>{label}<span className={styles.srOnly}>: {at ? "recorded" : "not recorded"}</span></span>
  </li>)}</ol>;
}
function AccountHistory({ account }: { account: OwnerAccount }) {
  const [result, setResult] = useState<{ key: string; data: OwnerHistory | null; error: string } | null>(null);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [noteMessage, setNoteMessage] = useState("");
  const pendingNote = useRef<{ id: string; body: string } | null>(null);
  const requestKey = `${account.id}:${page}:${refresh}`;
  const loading = result?.key !== requestKey;
  const history = !loading ? result?.data : null;
  const error = !loading ? result?.error : "";
  useEffect(() => {
    const controller = new AbortController();
    ownerFetch<OwnerHistory>(`/api/dashboard/admin/overview/accounts/${account.id}?page=${page}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setResult({ key: requestKey, data, error: "" }); })
      .catch(e => { if (!controller.signal.aborted) setResult({ key: requestKey, data: null, error: e.message }); });
    return () => controller.abort();
  }, [account.id, page, requestKey]);
  async function saveNote(event: React.FormEvent) {
    event.preventDefault(); if (saving || !note.trim()) return;
    setSaving(true); setNoteMessage("");
    if (!pendingNote.current || pendingNote.current.body !== note.trim()) pendingNote.current = { id: crypto.randomUUID(), body: note.trim() };
    try {
      await ownerFetch(`/api/dashboard/admin/overview/accounts/${account.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pendingNote.current) });
      pendingNote.current = null; setNote(""); setNoteMessage("Private note saved."); setPage(0); setRefresh(v => v + 1);
    } catch (e) { setNoteMessage(e instanceof Error ? e.message : "Could not save note."); }
    finally { setSaving(false); }
  }
  return <section className={styles.detail} aria-label={`Account history for ${account.name}`}>
    <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>ACCOUNT HISTORY</p><h2>{account.name}</h2><p>{account.email}</p></div>
      <Link className={styles.button} href="/dashboard/admin/users">Manage accounts <ArrowRight size={15} /></Link></div>
    {accountAttention(account).map(item => <div className={styles.attention} key={item.title}><TriangleAlert size={18} /><div><strong>{item.title}</strong><p>{item.action}</p></div></div>)}
    <div className={styles.facts}>
      <div><span>Access</span><strong>{accountAccess(account)}</strong></div>
      <div><span>Trial ends</span><strong>{date(account.trial_ends_at)}</strong></div>
      <div><span>Last sign-in</span><strong>{date(account.last_sign_in_at)}</strong></div>
      <div><span>Last photo saved</span><strong>{date(account.last_photo_at)}</strong></div>
      <div><span>Last roster sync</span><strong>{date(account.last_roster_sync_at)}</strong></div>
      <div><span>Last device check-in</span><strong>{date(account.last_device_seen)}</strong></div>
    </div>
    <p className={styles.help}>Photo and roster timestamps confirm saved records. Device check-ins and sign-ins do not prove a successful upload. Failed upload coverage is incomplete.</p>
    <form onSubmit={saveNote} className={styles.noteForm}>
      <label htmlFor="support-note"><ShieldCheck size={16} /> Private owner note</label>
      <textarea id="support-note" value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={3} placeholder="What happened, what you checked, and the next step…" disabled={saving} required />
      <div className={styles.noteActions}><span className={styles.help}>Visible to platform owners only · {note.length}/2,000</span><button className={styles.primary} disabled={saving || !note.trim()}>{saving ? "Saving…" : "Save note"}</button></div>
      {noteMessage && <p role="status">{noteMessage}</p>}
    </form>
    {loading && <p role="status">Loading account history…</p>}
    {error && <div className={styles.error} role="alert">{error}<button className={styles.button} onClick={() => setRefresh(v => v + 1)}>Retry</button></div>}
    {history && <>
      <div className={styles.detailColumns}>
        <section><h3>Activated devices</h3><p className={styles.help}>Up to 20 current registrations. A registration may belong to a device that is offline.</p>
          {!history.devices.length ? <p>No active device registrations recorded.</p> : history.devices.map((device, index) => <div className={styles.device} key={index}>
            <strong>{device.device_name || "Unnamed device"}</strong><span>{device.platform || "Platform unknown"} · App {device.app_version || "version unknown"}</span><small>Last check-in: {date(device.last_seen_at)}</small>
          </div>)}
        </section>
        <section><h3>Photographer’s customer sales</h3><p className={styles.help}>Lifetime gallery order records, excluding test orders. Kept separate from your subscription revenue. Booking payments and Stripe fees are not included.</p>
          {!history.sales.length ? <p>No gallery orders recorded.</p> : history.sales.map(sale => <div className={styles.sale} key={sale.currency}>
            <strong>{ownerMoney(sale.paid_cents, sale.currency)} paid</strong><span>{ownerMoney(sale.refunded_cents, sale.currency)} refunded · {sale.paid_orders} paid order records</span><span>{sale.pending_adjustments} pending adjustments</span>
          </div>)}
        </section>
      </div>
      <div className={styles.sectionHeading}><div><h3>Support & notification timeline</h3><p className={styles.help}>Sent means accepted by the email provider. Delivery is shown only when a provider event was recorded. Earlier actions may not have been logged.</p></div></div>
      {!history.entries.length ? <div className={styles.empty}>No support or notification history recorded yet.</div> : <ol className={styles.timeline}>{history.entries.map(entry => <li key={entry.id}>
        <div><span className={styles.kind}>{entry.kind}</span><time dateTime={entry.at}>{date(entry.at)}</time></div>
        <strong>{entry.kind === "audit" ? historyTitle(entry.title) : entry.title.replaceAll("_", " ")}</strong><span className={styles.eventState}>{entry.kind === "email" ? emailState(entry.state) : entry.state === "ok" ? "Completed" : entry.state}</span>
        {entry.recipient && <p>To: {entry.recipient}</p>}{entry.author && <p>By: {entry.author}</p>}{entry.detail && <p className={styles.noteText}>{entry.detail}</p>}
      </li>)}</ol>}
      <div className={styles.pagination}><button className={styles.button} disabled={page === 0} onClick={() => setPage(v => v - 1)}><ArrowLeft size={15} /> Newer</button><span>History page {page + 1}</span><button className={styles.button} disabled={!history.has_more} onClick={() => setPage(v => v + 1)}>Older <ArrowRight size={15} /></button></div>
    </>}
  </section>;
}

function OwnerOverviewContent() {
  const params = useSearchParams();
  const [result, setResult] = useState<{ key: string; data: OwnerSnapshot | null; error: string } | null>(null);
  const [searchInput, setSearchInput] = useState(params.get("account") || "");
  const [search, setSearch] = useState(params.get("account") || "");
  const [attention, setAttention] = useState(false);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState<{ key: string; account: OwnerAccount } | null>(null);
  const requestKey = `${page}:${search}:${attention}:${refresh}`;
  const loading = result?.key !== requestKey;
  const snapshot = !loading ? result?.data : null;
  const error = !loading ? result?.error : "";
  const selected = selection?.key === requestKey ? selection.account : null;
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    ownerFetch<OwnerSnapshot>(`/api/dashboard/admin/overview?page=${page}&search=${encodeURIComponent(search)}&attention=${attention}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) { setResult({ key: requestKey, data, error: "" }); if (data.accounts.length === 1 && search === data.accounts[0].id) setSelection({ key: requestKey, account: data.accounts[0] }); } })
      .catch(e => { if (!controller.signal.aborted) setResult({ key: requestKey, data: null, error: e.message }); });
    return () => controller.abort();
  }, [page, search, attention, requestKey]);
  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>PLATFORM OWNER</p><h1>Owner overview</h1><p>See who is getting started, what needs attention, and the support history behind it.</p></div><button className={styles.button} disabled={loading} onClick={() => setRefresh(v => v + 1)}><RefreshCw size={16} /> {loading ? "Checking…" : "Refresh"}</button></header>
    {error && <div className={styles.error} role="alert"><TriangleAlert size={20} /><div><strong>Current status unavailable</strong><p>{error}</p><p>No healthy status or zero counts are assumed when a check fails.</p></div></div>}
    {loading && <div className={styles.empty} role="status">Checking account access, saved activity, and notification records…</div>}
    {snapshot && <>
      <div className={styles.metrics}>
        <div><span>Registered photographers</span><strong>{snapshot.summary.accounts}</strong><small>Includes owner accounts</small></div>
        <button onClick={() => { setAttention(true); setPage(0); }} className={snapshot.summary.needs_attention ? styles.metricWarning : ""}><span>Needs attention</span><strong>{snapshot.summary.needs_attention}</strong><small>Accounts with recorded issues</small></button>
        <div><span>Active trials</span><strong>{snapshot.summary.active_trials}</strong><small>Free trial access</small></div>
        <div><span>Active subscriptions</span><strong>{snapshot.summary.active_subscriptions}</strong><small>Active or trialing Stripe subscriptions</small></div>
      </div>
      {snapshot.unlinked_confirmed_accounts > 0 && <div className={styles.attention}><TriangleAlert size={20} /><div><strong>{snapshot.unlinked_confirmed_accounts} confirmed login accounts have no photographer profile</strong><p>Review Auth users and profile creation in Supabase. Up to 25 affected accounts are listed here.</p><ul>{snapshot.unlinked_accounts.map(account => <li key={account.email}>{account.name} · {account.email} · Confirmed {date(account.email_confirmed_at)}</li>)}</ul></div></div>}
      <section className={styles.panel}>
        <div className={styles.sectionHeading}><div><h2>Photographer progress</h2><p>Inactivity alone is not a technical failure. Web-only photographers may never activate the desktop app.</p></div><Link href="/dashboard/admin/users" className={styles.textLink}>Admin Users <ArrowRight size={15} /></Link></div>
        <div className={styles.toolbar}><div className={styles.tabs} aria-label="Account filter"><button aria-pressed={!attention} onClick={() => { setAttention(false); setPage(0); }}>All accounts</button><button aria-pressed={attention} onClick={() => { setAttention(true); setPage(0); }}>Needs attention</button></div>
          <form onSubmit={e => { e.preventDefault(); setPage(0); setSearch(searchInput.trim()); }} className={styles.search}><Search size={17} /><input aria-label="Search photographers" placeholder="Name, studio, or email" maxLength={120} value={searchInput} onChange={e => setSearchInput(e.target.value)} /><button type="submit">Search</button></form></div>
        {!snapshot.accounts.length ? <div className={styles.empty}>{attention ? "No accounts match these attention checks." : "No photographers match this search."}</div> : <div className={styles.accounts}>{snapshot.accounts.map(account => <article key={account.id} className={styles.account}>
          <div className={styles.accountTop}><div><h3>{account.name}{account.is_owner && <span className={styles.ownerBadge}>Owner</span>}</h3><p>{account.business_name}</p><p>{account.email}</p></div><span className={account.needs_attention ? styles.warningBadge : styles.badge}>{account.needs_attention ? "Needs attention" : accountAccess(account)}</span></div>
          <Progress account={account} />
          <div className={styles.usage}><span><strong>{account.gallery_count}</strong> galleries</span><span><strong>{account.photo_records}</strong> photo records</span><span><strong>{account.order_count}</strong> order records</span><span><strong>{account.available_keys}</strong> available keys</span><span><strong>{account.active_devices}</strong> activated devices</span></div>
          <div className={styles.accountBottom}><span>Last photo saved: {date(account.last_photo_at)}</span><button className={styles.textLink} aria-expanded={selected?.id === account.id} onClick={() => { setSelection({ key: requestKey, account }); setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }}>View account history <ChevronRight size={17} /></button></div>
          {account.needs_attention && <p className={styles.issueSummary}>{accountAttention(account).map(item => item.title).join(" · ")}</p>}
        </article>)}</div>}
        <div className={styles.pagination}><button className={styles.button} disabled={page === 0} onClick={() => setPage(v => v - 1)}><ArrowLeft size={15} /> Previous</button><span>{snapshot.total ? `${page * 25 + 1}–${Math.min((page + 1) * 25, snapshot.total)} of ${snapshot.total}` : "0 matching accounts"}</span><button className={styles.button} disabled={(page + 1) * 25 >= snapshot.total} onClick={() => setPage(v => v + 1)}>Next <ArrowRight size={15} /></button></div>
      </section>
      <div ref={detailRef}>{selected && <AccountHistory key={selected.id} account={selected} />}</div>
      <div className={styles.bottomGrid}>
        <section className={styles.panel}><p className={styles.eyebrow}>YOUR PLATFORM REVENUE</p><h2>Subscription receipts</h2><p>Gross subscription invoices received through live Stripe events in the last 30 days. Grouped by currency; refunds and fees are not deducted.</p>
          {snapshot.subscription_receipts.length ? snapshot.subscription_receipts.map(row => <div className={styles.receipt} key={row.currency}><strong>{ownerMoney(row.amount_cents, row.currency)}</strong><span>{row.invoices} recorded invoices</span></div>) : <p className={styles.help}>No paid subscription invoices recorded in this window. This is not a complete Stripe reconciliation.</p>}
          <a href="https://dashboard.stripe.com/invoices" target="_blank" rel="noreferrer" className={styles.textLink}>Review Stripe invoices <ArrowRight size={15} /></a>
        </section>
        <section className={styles.panel}><p className={styles.eyebrow}>CHECK COVERAGE</p><h2>What was checked</h2><p>Last successful account snapshot: <strong>{date(snapshot.checked_at)}</strong>. Refresh manually for current information.</p>
          <ul className={styles.coverage}><li>Across all photographers: account setup, subscription state, recorded payment/refund issues, and notification queues.</li><li>Loaded accounts: saved gallery/photo records, roster sync timestamps, and device registrations.</li><li>Not continuously verified: failed uploads, end-to-end checkout, email delivery without provider events, and database capacity.</li></ul>
          <Link href="/dashboard/admin/cloud-flow" className={styles.textLink}>Cloud Flow checks for your studio <ArrowRight size={15} /></Link>
        </section>
      </div>
    </>}
  </main>;
}

export default function OwnerOverviewPage() {
  return <Suspense fallback={<p role="status">Loading owner overview…</p>}><OwnerOverviewContent /></Suspense>;
}
