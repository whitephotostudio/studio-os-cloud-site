"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, CheckCircle2, House, Loader2, LockKeyhole, Package, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { InHousePriceSheet, InHousePriceSheetEntry } from "@/lib/labs/in-house-types";
import { currencyMinorUnits, formatCurrency, formatCurrencyAmount, parseCurrencyAmount } from "@/lib/labs/money";
import { LabDialog } from "./lab-dialog";
import common from "./labs.module.css";
import styles from "./in-house-price-sheets.module.css";

type Props = { sheets: InHousePriceSheet[]; beforeOpen?: (open: () => void) => void; onSheetsChange: (sheets: InHousePriceSheet[]) => void; orderTestsEnabled?: boolean };
type SavedChanges = { action: "save"; id: string; expectedVersion: number; name: string; entries: { id: string; retailCents: number; active: boolean }[] };
type Response = { ok: boolean; message?: string; sheets?: InHousePriceSheet[]; sheet?: InHousePriceSheet };
const sections = [{ id: "individual", label: "Individual sizes" }, { id: "package", label: "Packages" }, { id: "specialty", label: "Specialty products" }] as const;
const fieldName = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");

/** Describe saved contents verbatim, without guessing whether a unit is a print, sheet or download. */
export function inHouseContentText(value: unknown): string {
  if (value === null) return "Not set";
  if (Array.isArray(value)) return value.map(inHouseContentText).join("; ");
  if (typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, entry]) => `${fieldName(key)}: ${inHouseContentText(entry)}`).join(" · ");
  return String(value);
}

export function inHouseSaveChanges(sheet: InHousePriceSheet, name: string, prices: Record<string, string>, active: Record<string, boolean>): SavedChanges {
  if (!name.trim() || name.trim().length > 100) throw new Error("Give this test copy a name of up to 100 characters.");
  return { action: "save", id: sheet.id, expectedVersion: sheet.version, name: name.trim(), entries: sheet.entries.map(entry => {
    const retailCents = parseCurrencyAmount(prices[entry.id] ?? "", sheet.currency);
    if (retailCents === null || retailCents > 100_000_000) throw new Error(`Check the ${sheet.currency} price for ${entry.name}. Enter a nonnegative amount with up to ${currencyMinorUnits(sheet.currency)} decimal places.`);
    return { id: entry.id, retailCents, active: active[entry.id] ?? entry.active };
  }) };
}

async function request(changes?: SavedChanges): Promise<Response> {
  const { data: { session } } = await createClient().auth.getSession();
  if (!session?.access_token) throw new Error("Sign in to open your private studio prices.");
  const response = await fetch("/api/dashboard/in-house-price-sheets", { method: changes ? "POST" : "GET", cache: "no-store", headers: { Authorization: `Bearer ${session.access_token}`, ...(changes ? { "Content-Type": "application/json" } : {}) }, body: changes ? JSON.stringify(changes) : undefined });
  const result = await response.json() as Response;
  if (!response.ok || !result.ok) throw new Error(response.status === 409 ? "This copy changed in another window. Your edits are still here. Reload the saved copy to review its latest prices before editing again." : result.message || "Your test copy could not be saved. Your edits are still here; please try again.");
  return result;
}

export function InHousePriceSheets({ sheets, beforeOpen, onSheetsChange, orderTestsEnabled = false }: Props) {
  const [selected, setSelected] = useState<InHousePriceSheet | null>(null);
  const open = (sheet: InHousePriceSheet) => beforeOpen ? beforeOpen(() => setSelected(sheet)) : setSelected(sheet);
  return <section className={styles.section} aria-labelledby="in-house-prices-title">
    <div className={styles.heading}><div><div className={common.eyebrow}>PERSONAL · IN-HOUSE FULFILLMENT</div><h2 id="in-house-prices-title">Your studio prices</h2><p>Your own products and packages, together with your connected lab price sheets.</p></div><span className={styles.badge}><LockKeyhole size={14} />Private</span></div>
    {sheets.length ? <div className={styles.grid}>{sheets.map(sheet => <article className={styles.card} key={sheet.id}>
      <div className={styles.cardTop}><span className={styles.icon}><House size={21} /></span><span className={styles.testBadge}>Test copy</span></div>
      <p className={styles.studio}>{sheet.studioName}</p><h3>{sheet.name}</h3>
      <div className={styles.counts}>{sections.map(section => <span key={section.id}><strong>{sheet.entries.filter(entry => entry.section === section.id).length}</strong> {section.label.toLowerCase()}</span>)}</div>
      <p className={styles.cardNote}>{sheet.currency} retail prices · Internal cost not set</p>
      <button type="button" className={styles.open} onClick={() => open(sheet)}>View & test prices <ArrowRight size={15} /></button>
      {orderTestsEnabled && <Link className={styles.open} href={`/dashboard/labs/in-house?sheet=${encodeURIComponent(sheet.id)}`}>Start private order test <ArrowRight size={15} /></Link>}
    </article>)}</div> : <div className={styles.empty}><House size={23} /><div><h3>Bring your in-house prices here</h3><p>A private copy of your Studio OS price profile can appear here with its original prices and package contents. Connected lab catalogs remain separate.</p></div></div>}
    {sheets.length > 0 && <p className={styles.footnote}>These are private test copies. Saving here updates this copy only. Current schools, original price profiles and existing orders keep their pricing.</p>}
    {selected && <InHousePriceSheetEditor initialSheet={selected} onClose={() => setSelected(null)} onSaved={onSheetsChange} />}
  </section>;
}

export function InHousePriceSheetEditor({ initialSheet, onClose, onSaved }: { initialSheet: InHousePriceSheet; onClose: () => void; onSaved: (sheets: InHousePriceSheet[]) => void }) {
  const [sheet, setSheet] = useState(initialSheet);
  const [name, setName] = useState(initialSheet.name);
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(initialSheet.entries.map(entry => [entry.id, formatCurrencyAmount(entry.retailCents, initialSheet.currency)])));
  const [active, setActive] = useState<Record<string, boolean>>(() => Object.fromEntries(initialSheet.entries.map(entry => [entry.id, entry.active])));
  const [tab, setTab] = useState<InHousePriceSheetEntry["section"]>("individual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<"close" | "reload" | null>(null);
  const dirty = name !== sheet.name || sheet.entries.some(entry => prices[entry.id] !== formatCurrencyAmount(entry.retailCents, sheet.currency) || active[entry.id] !== entry.active);
  const entries = useMemo(() => sheet.entries.filter(entry => entry.section === tab), [sheet.entries, tab]);
  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty]);
  const adopt = (next: InHousePriceSheet) => {
    setSheet(next); setName(next.name); setPrices(Object.fromEntries(next.entries.map(entry => [entry.id, formatCurrencyAmount(entry.retailCents, next.currency)]))); setActive(Object.fromEntries(next.entries.map(entry => [entry.id, entry.active]))); setPending(null);
  };
  const reload = async () => {
    setBusy(true); setError(""); setNotice("");
    try { const result = await request(); const next = result.sheets?.find(value => value.id === sheet.id); if (!next) throw new Error("This saved copy is unavailable. Your edits are still here."); adopt(next); onSaved(result.sheets!); setNotice("The latest saved test copy is open."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to reload. Your edits are still here."); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (busy) return;
    setError(""); setNotice("");
    let changes: SavedChanges;
    try { changes = inHouseSaveChanges(sheet, name, prices, active); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Check your prices."); return; }
    setBusy(true);
    try { const result = await request(changes); if (!result.sheet || !result.sheets) throw new Error("The save response was incomplete. Your edits are still here; reload the saved copy to check its status."); adopt(result.sheet); onSaved(result.sheets); setNotice("Test copy saved. Your original price profile and current schools are unchanged."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Your changes could not be saved. Your edits are still here."); }
    finally { setBusy(false); }
  };
  return <LabDialog title={`${sheet.studioName} · In-house prices`} description="Review your copied products and packages. Edit retail prices and availability in this private test copy." wide busy={busy} onClose={() => { if (dirty) setPending("close"); else onClose(); }} error={error}>
    <div className={styles.editor}>
      <div className={styles.meta}><span><LockKeyhole size={13} /> Private</span><span><House size={13} /> In-house</span><span>Test copy</span><span>{sheet.currency}</span><span>{dirty ? "Unsaved changes" : "Saved"}</span></div>
      {notice && <div className={common.notice} role="status"><CheckCircle2 size={17} />{notice}</div>}
      {pending && <div className={styles.confirm} role="alert"><p>You have unsaved edits in this test copy.</p><div className={styles.confirmButtons}><button className={common.secondary} onClick={() => setPending(null)} disabled={busy}>Keep editing</button><button className={common.secondary} disabled={busy} onClick={() => { if (pending === "close") onClose(); else void reload(); }}>Discard edits & {pending === "close" ? "close" : "reload copy"}</button></div></div>}
      <fieldset className={common.formFieldset} disabled={busy}>
        <label className={common.formLabel}>Test price sheet name<input value={name} maxLength={100} onChange={event => { setName(event.target.value); setNotice(""); }} /></label>
        <div className={styles.source}><strong>Copied from {sheet.source.profileName}</strong><span>Profile ID: {sheet.source.profileId}</span><span>Tax setting copied for reference: {`${sheet.tax.label || "Tax"} · ${sheet.tax.percent}% · ${sheet.tax.enabled ? "enabled" : "disabled"}`}. This preview does not calculate or collect tax.</span><span>Internal cost not set. These are your retail prices; no wholesale cost or margin is assumed.</span></div>
        {sheet.warnings.length > 0 && <details className={styles.warnings}><summary>Review {sheet.warnings.length} source {sheet.warnings.length === 1 ? "note" : "notes"}</summary><ul>{sheet.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        <div className={styles.tabs} role="tablist" aria-label="In-house price sections">{sections.map(section => <button type="button" key={section.id} role="tab" id={`in-house-tab-${section.id}`} aria-controls={`in-house-panel-${section.id}`} aria-selected={tab === section.id} className={tab === section.id ? styles.selectedTab : ""} onClick={() => setTab(section.id)}>{section.label}<span>{sheet.entries.filter(entry => entry.section === section.id).length}</span></button>)}</div>
        <div role="tabpanel" id={`in-house-panel-${tab}`} aria-labelledby={`in-house-tab-${tab}`} className={styles.entries}>
          {entries.length ? entries.map(entry => <article key={entry.id} className={`${styles.entry} ${active[entry.id] ? "" : styles.inactive}`}>
            <div className={styles.entryTitle}><div><h3>{entry.name}</h3>{entry.category && <p>{entry.category}</p>}</div><label className={styles.toggle}><input type="checkbox" checked={active[entry.id]} onChange={event => { setActive(value => ({ ...value, [entry.id]: event.target.checked })); setNotice(""); }} /><span>{active[entry.id] ? "Active" : "Inactive"}</span></label></div>
            {entry.contents.length > 0 ? <ul className={styles.contents}>{entry.contents.map((content, index) => <li key={index}>{inHouseContentText(content)}</li>)}</ul> : <p className={styles.noContents}>No separate contents recorded in the source profile.</p>}
            <div className={styles.entryBottom}><span><Package size={13} /> Original contents preserved</span><label className={styles.price}>Retail price ({sheet.currency})<input type="text" inputMode={currencyMinorUnits(sheet.currency) ? "decimal" : "numeric"} aria-label={`${entry.name} retail price (${sheet.currency})`} maxLength={14} value={prices[entry.id]} onChange={event => { setPrices(value => ({ ...value, [entry.id]: event.target.value })); setNotice(""); }} /><small>Opened at: {formatCurrency((initialSheet.entries.find(value => value.id === entry.id) ?? entry).retailCents, sheet.currency)}</small></label></div>
          </article>) : <div className={styles.empty}><p>No {sections.find(section => section.id === tab)?.label.toLowerCase()} in this source profile.</p></div>}
        </div>
      </fieldset>
      <p className={styles.footnote}>Prices and availability are editable here. Product names, package contents, digital options and wallet quantities stay as copied. This test copy is not assigned to a gallery or a live order flow.</p>
      <div className={styles.footer}><button type="button" className={common.secondary} disabled={busy} onClick={() => { if (dirty) setPending("reload"); else void reload(); }}><RefreshCw size={14} />Reload saved copy</button><button type="button" className={common.primary} disabled={busy || !dirty} onClick={() => void save()}>{busy ? <Loader2 className={common.spin} size={15} /> : <Check size={15} />}{busy ? "Saving…" : "Save test copy"}</button></div>
    </div>
  </LabDialog>;
}
