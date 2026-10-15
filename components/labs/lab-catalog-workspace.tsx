"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Download, FileCheck2, FileSpreadsheet, FileUp, Info, Loader2, Plus, RefreshCw, ShieldCheck, Store, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Lab } from "@/lib/labs/types";
import { formatCurrency, isLabCurrency } from "@/lib/labs/money";
import { labCountryOptions } from "@/lib/lab-directory";
import { CATALOG_FIELDS, CATALOG_IMPORT_MAX_BYTES, CATALOG_IMPORT_MAX_ROWS, CATALOG_TEMPLATE, type CatalogField, type CatalogMapping, type CatalogPreview } from "@/lib/lab-catalog-import";
import { LabDialog } from "./lab-dialog";
import styles from "./lab-catalog.module.css";

type ManagedLab = Lab & { catalogVersion: number };
type Receipt = { id: string; catalogVersion: number; productCount: number; replayed: boolean };
type CatalogResponse = { ok: boolean; message?: string; mayCreateLab?: boolean; labs?: ManagedLab[]; labId?: string; preview?: CatalogPreview; receipt?: Receipt };
type NewLab = { name: string; countryCode: string; city: string; region: string; currency: string };
type ImportAttempt = { labId: string; csv: string; mapping: CatalogMapping; expectedVersion: number; requestId: string; sourceName: string };
class CatalogApiError extends Error { constructor(message: string, public status: number) { super(message); } }
const fieldLabels: Record<CatalogField, string> = { sku: "Product code / SKU", name: "Product name", category: "Category", size: "Size (inches)", width: "Width (inches)", height: "Height (inches)", finish: "Finish / paper", cost: "Wholesale price", currency: "Currency", popular: "Popular product" };
const required = new Set<CatalogField>(["sku", "name", "category", "cost"]);
const countryName = (code: string) => labCountryOptions.find(country => country.code === code)?.name ?? code;

export function LabCatalogWorkspace() {
  const [labs, setLabs] = useState<ManagedLab[]>([]);
  const [mayCreateLab, setMayCreateLab] = useState(false);
  const [selectedLabId, setSelectedLabId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "preview" | "import" | "file" | "create">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [csv, setCsv] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<CatalogMapping>({});
  const [preview, setPreview] = useState<CatalogPreview | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [attempt, setAttempt] = useState<ImportAttempt | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [rowPage, setRowPage] = useState(0);
  const [issuePage, setIssuePage] = useState(0);
  const [pendingLabId, setPendingLabId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lab = labs.find(entry => entry.id === selectedLabId);
  const locked = !!attempt && !receipt;
  const catalogHeld = !!lab && (lab.intakeEnabled || lab.status === "active" || lab.catalogVerified);

  const request = useCallback(async (body?: object, signal?: AbortSignal) => {
    const { data: { session } } = await createClient().auth.getSession();
    if (!session?.access_token) throw new CatalogApiError("Sign in to manage your lab catalog.", 401);
    const response = await fetch("/api/dashboard/lab-catalog", { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal });
    const result = await response.json() as CatalogResponse;
    if (!response.ok || !result.ok) throw new CatalogApiError(result.message || "The lab catalog is temporarily unavailable.", response.status);
    return result;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    request(undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setLabs(result.labs ?? []); setMayCreateLab(result.mayCreateLab === true); setSelectedLabId(result.labs?.[0]?.id ?? "");
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load your lab permissions."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request]);
  useEffect(() => {
    if (!csv || receipt) return;
    const preventUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [csv, receipt]);

  function resetFile() {
    setCsv(""); setSourceName(""); setHeaders([]); setMapping({}); setPreview(null); setPreviewStale(false); setRequestId(""); setAttempt(null); setReceipt(null); setConflict(false); setRowPage(0); setIssuePage(0);
  }
  async function runPreview(text = csv, selectedMapping: CatalogMapping | null = mapping, selectedId = selectedLabId) {
    setBusy("preview"); setError(""); setNotice("");
    try {
      const result = await request({ action: "preview", labId: selectedId, csv: text, ...(selectedMapping ? { mapping: selectedMapping } : {}) });
      if (!result.preview) throw new Error("The preview was not returned. Your file is still selected.");
      setPreview(result.preview); setHeaders(result.preview.headers); setMapping(result.preview.mapping); setPreviewStale(false); setRowPage(0); setIssuePage(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The file could not be previewed. Your file and mapping are preserved."); }
    finally { setBusy(""); }
  }
  async function chooseFile(file: File) {
    setError(""); setNotice("");
    if (file.size > CATALOG_IMPORT_MAX_BYTES) { setError("Choose a CSV or TSV file smaller than 2 MB."); return; }
    if (!/\.(csv|tsv)$/i.test(file.name)) { setError("Choose a .csv or .tsv catalog file."); return; }
    setBusy("file");
    try {
      const text = await file.text();
      resetFile(); setCsv(text); setSourceName(file.name.slice(0, 200)); setRequestId(crypto.randomUUID());
      await runPreview(text, null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This file could not be read. Please try again."); }
    finally { setBusy(""); }
  }
  async function importCatalog() {
    if (!lab || !preview || previewStale || preview.issues.length || !preview.rows.length || receipt || catalogHeld) return;
    const exactAttempt = attempt ?? { labId: lab.id, csv, mapping: { ...mapping }, expectedVersion: lab.catalogVersion, requestId, sourceName };
    setAttempt(exactAttempt); setBusy("import"); setError(""); setNotice(""); setConflict(false);
    try {
      const result = await request({ action: "import", ...exactAttempt });
      if (!result.receipt) throw new Error("The import result could not be confirmed. Retry the same import to check its outcome.");
      setReceipt(result.receipt); if (result.labs) setLabs(result.labs);
      setNotice(result.message || "Your catalog was imported for review. Production stays disabled.");
    } catch (cause) {
      setConflict(cause instanceof CatalogApiError && cause.status === 409);
      setError(cause instanceof Error ? cause.message : "The import outcome could not be confirmed. Retry the same import; your file and request are preserved.");
    } finally { setBusy(""); }
  }
  async function reloadAndReview() {
    setBusy("preview"); setError("");
    try {
      const result = await request(); if (result.labs) setLabs(result.labs);
      setAttempt(null); setConflict(false); setRequestId(crypto.randomUUID()); setPreviewStale(true);
      setNotice("Catalog versions refreshed. Your original file and mapping are preserved. Review the preview again before importing.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The catalog version could not be refreshed."); }
    finally { setBusy(""); }
  }
  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([CATALOG_TEMPLATE], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "studio-os-lab-catalog-template.csv"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function createLab(details: NewLab) {
    setBusy("create"); setError("");
    try {
      const result = await request({ action: "createLab", ...details });
      if (result.labs) setLabs(result.labs); if (result.labId) { setSelectedLabId(result.labId); resetFile(); }
      setShowCreate(false); setNotice(result.message || "Lab created in setup. Its catalog can be uploaded next.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The lab could not be created."); }
    finally { setBusy(""); }
  }
  function switchLab(id: string) { setSelectedLabId(id); resetFile(); setError(""); setNotice(""); }

  if (loading) return <main className={styles.page}><div className={styles.loading}><Loader2 size={25} className={styles.spin} /><h1>Opening lab catalogs</h1><p>Checking the labs you manage.</p></div></main>;

  return <main className={styles.page}>
    <Link className={styles.back} href="/dashboard/labs" onClick={event => { if (csv && !receipt) { event.preventDefault(); setShowLeave(true); } }}><ArrowLeft size={15} />Labs & price sheets</Link>
    <header className={styles.header}><div><div className={styles.eyebrow}>MADE FOR YOUR LAB</div><h1>Your products. Your catalog.</h1><p>Bring your product list into Studio OS, ready for photographers to build their price sheets.</p></div><button className={styles.secondary} onClick={downloadTemplate}><Download size={16} />CSV template</button></header>
    {error && !showCreate && <div className={styles.error} role="alert"><Info size={18} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={17} /></button></div>}
    {notice && <div className={styles.success} role="status"><CheckCircle2 size={18} /><span>{notice}</span></div>}
    {!labs.length && !mayCreateLab ? <section className={styles.permissionCard}><div className={styles.largeIcon}><Store size={30} /></div><h2>Each lab takes care of its catalog.</h2><p>Catalog uploads are available to lab owners and Studio OS administrators. Your photographer account can build price sheets from the products a lab supplies.</p><Link className={styles.primary} href="/dashboard/labs">Explore labs <ArrowRight size={15} /></Link><span>If you manage a lab, ask your Studio OS administrator to connect your account.</span></section> : <>
      <section className={styles.labPanel}><div className={styles.labHeading}><div className={styles.step}>1</div><div><h2>Choose the lab you manage</h2><p>Each catalog belongs to one lab and uses that lab’s currency.</p></div>{mayCreateLab && <button className={styles.secondary} disabled={!!busy || locked || !!csv && !receipt} title={csv && !receipt ? "Finish reviewing this file before adding another lab" : undefined} onClick={() => { setError(""); setShowCreate(true); }}><Plus size={15} />Add a lab</button>}</div><div className={styles.labChoice}><label>Lab<select value={selectedLabId} disabled={!!busy || locked} onChange={event => { if (csv && !receipt) setPendingLabId(event.target.value); else switchLab(event.target.value); }}>{!labs.length && <option value="">Add a lab to get started</option>}{labs.map(entry => <option key={entry.id} value={entry.id}>{entry.name} — {entry.city}, {countryName(entry.countryCode)}</option>)}</select></label>{lab && <div className={styles.labDetails}><span>{[lab.city, lab.region, countryName(lab.countryCode)].filter(Boolean).join(", ")}</span><strong>{lab.currency}</strong><span className={styles.status}>{lab.status === "active" ? "Active" : lab.status === "paused" ? "Paused" : "Setup"}{lab.catalogVerified ? " · Catalog verified" : " · Catalog unverified"}</span><span className={styles.version}>Catalog v{lab.catalogVersion}</span></div>}</div></section>
      {lab && <>
        {catalogHeld && <div className={styles.heldNotice}><ShieldCheck size={19} /><p><strong>This catalog needs a reviewed rollout.</strong> This lab is active, has ordering connected, or has a verified catalog. You can review a file here; changes to its catalog must be reviewed before production. Setup imports are disabled.</p></div>}
        <section className={styles.uploadPanel}><div className={styles.sectionHeading}><div className={styles.step}>2</div><div><h2>Bring your product list</h2><p>A CSV or TSV, up to 2 MB and {CATALOG_IMPORT_MAX_ROWS.toLocaleString()} products.</p></div></div><input ref={fileInput} className={styles.srOnly} tabIndex={-1} type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={!!busy || locked} aria-label="Choose lab catalog file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void chooseFile(file); }} /><div className={styles.uploadBox}><span className={styles.fileIcon}>{csv ? <FileSpreadsheet size={25} /> : <FileUp size={25} />}</span><div><strong>{sourceName || "A simple file. Your full product range."}</strong><p>{sourceName ? `${new TextEncoder().encode(csv).length.toLocaleString()} bytes · Original file kept for review` : "Export from your spreadsheet, then map your columns in the next step."}</p></div><button className={styles.secondary} disabled={!!busy || locked} onClick={() => fileInput.current?.click()}>{busy === "file" ? "Reading file…" : csv ? "Choose another file" : "Choose file"}</button></div><div className={styles.fileGuidance}><Info size={16} /><p><strong>Start with the template if you like.</strong> Its row is an example, not a lab quote. Replace it with your own products and wholesale prices in {lab.currency}. Use inch dimensions; convert metric sizes before uploading.</p></div><div className={styles.categoryNote}>Supported categories: Photo Prints, Fine Art, Canvas and Metal. Digital delivery is managed separately.</div></section>
        {headers.length > 0 && <section className={styles.mappingPanel}><div className={styles.sectionHeading}><div className={styles.step}>3</div><div><h2>A place for every column</h2><p>Match your file headings to the product details below.</p></div><span className={styles.requiredNote}>* Required</span></div><fieldset className={styles.mappingGrid} disabled={!!busy || locked || !!receipt}>{CATALOG_FIELDS.map(field => <label key={field}>{fieldLabels[field]}{required.has(field) ? " *" : ""}<select value={mapping[field] ?? ""} onChange={event => { const next = { ...mapping }; if (event.target.value === "") delete next[field]; else next[field] = Number(event.target.value); setMapping(next); setPreviewStale(true); setReceipt(null); }}><option value="">{required.has(field) ? "Choose a column" : "Not supplied"}</option>{headers.map((header, index) => <option value={index} key={index}>{header}</option>)}</select></label>)}</fieldset><div className={styles.mappingFooter}><p>Map a size such as 8x10, or both width and height columns in inches. Currency defaults to {lab.currency} when the column is not supplied.</p><button className={styles.primary} disabled={!!busy || locked || !!receipt} onClick={() => void runPreview()}>{busy === "preview" ? <Loader2 className={styles.spin} size={16} /> : <RefreshCw size={15} />}{busy === "preview" ? "Checking…" : previewStale ? "Update preview" : "Check preview"}</button></div></section>}
        {preview && <section className={styles.previewPanel} aria-labelledby="catalog-preview-title"><div className={styles.sectionHeading}><div className={styles.step}>4</div><div><h2 id="catalog-preview-title">One last look</h2><p>{preview.sourceRowCount.toLocaleString()} source rows · {preview.rows.length.toLocaleString()} valid products · {preview.issues.length.toLocaleString()} issues</p></div><span className={`${styles.previewBadge} ${preview.issues.length || previewStale ? styles.needsReview : ""}`}>{receipt ? "Imported" : previewStale ? "Preview needs updating" : preview.issues.length ? "Needs attention" : "Ready for import"}</span></div>
          {previewStale && <div className={styles.staleNote} role="status">Your column mapping changed. Update the preview to validate this version.</div>}
          {preview.issues.length > 0 && <div className={styles.issues}><h3>Give these details another look</h3><p>Correct the source file or column mapping. Every issue must be resolved before import.</p><div className={styles.tableWrap}><table><thead><tr><th>CSV row</th><th>Field</th><th>What to fix</th></tr></thead><tbody>{preview.issues.slice(issuePage * 50, (issuePage + 1) * 50).map((issue, index) => <tr key={`${issue.row}:${issue.field}:${index}`}><td>{issue.row}</td><td>{fieldLabels[issue.field as CatalogField] || issue.field}</td><td>{issue.message}</td></tr>)}</tbody></table></div><Pagination page={issuePage} total={preview.issues.length} onChange={setIssuePage} label="issues" /></div>}
          {preview.rows.length > 0 && <><div className={styles.tableWrap}><table className={styles.previewTable}><thead><tr><th>SKU</th><th>Product</th><th>Category</th><th>Size</th><th>Finish</th><th>Lab upload cost</th><th>Popular</th></tr></thead><tbody>{preview.rows.slice(rowPage * 50, (rowPage + 1) * 50).map(row => <tr key={row.sku}><td>{row.sku}</td><td>{row.name}</td><td>{row.category.replace("_", " ")}</td><td>{row.widthInches} × {row.heightInches} in</td><td>{row.finish || "—"}</td><td>{formatCurrency(row.costCents, row.currency)}<span className={styles.currency}>{row.currency}</span></td><td>{row.popular ? <Check size={15} aria-label="Yes" /> : "—"}</td></tr>)}</tbody></table></div><Pagination page={rowPage} total={preview.rows.length} onChange={setRowPage} label="products" /></>}
          <div className={styles.importFooter}><div><ShieldCheck size={21} /><p><strong>Import for review.</strong> This adds or updates products in the lab’s setup catalog. Uploaded costs remain unverified. It does not activate production, payments, fees or photographer gallery prices.</p></div>{receipt ? <Link className={styles.primary} href="/dashboard/labs"><FileCheck2 size={16} />View price sheets</Link> : conflict ? <button className={styles.secondary} disabled={!!busy} onClick={() => void reloadAndReview()}><RefreshCw size={15} />Reload versions & review</button> : <button className={styles.primary} disabled={!!busy || catalogHeld || previewStale || preview.issues.length > 0 || !preview.rows.length} onClick={() => void importCatalog()}>{busy === "import" ? <Loader2 className={styles.spin} size={16} /> : <FileCheck2 size={16} />}{busy === "import" ? "Importing…" : catalogHeld ? "Reviewed rollout required" : locked ? "Retry same import" : `Import ${preview.rows.length.toLocaleString()} products`}</button>}</div>
          {locked && !busy && !conflict && <p className={styles.retryNote}>Your import request is retained. Retry uses the same file, mapping and request ID to confirm the result without creating a second import.</p>}
          {receipt && <div className={styles.receipt}><CheckCircle2 size={17} /><span>{receipt.productCount} products saved · Catalog version {receipt.catalogVersion}{receipt.replayed ? " · Previous import confirmed" : ""}</span></div>}
        </section>}
      </>}
    </>}
    {pendingLabId !== null && <LabDialog title="Switch to another lab?" description="Your selected file and column mapping belong to the current lab. Switching labs clears this local review." onClose={() => setPendingLabId(null)}><div className={styles.leaveActions}><button className={styles.secondary} onClick={() => setPendingLabId(null)}>Keep reviewing</button><button className={styles.primary} onClick={() => { switchLab(pendingLabId); setPendingLabId(null); }}>Switch lab</button></div></LabDialog>}
    {showCreate && <NewLabDialog busy={busy === "create"} error={error} onClose={() => setShowCreate(false)} onCreate={details => void createLab(details)} />}
    {showLeave && <LabDialog title="Keep reviewing your catalog?" description="Your selected file has not been confirmed as imported. Leaving this page clears the local file and mapping." onClose={() => setShowLeave(false)}><div className={styles.leaveActions}><button className={styles.secondary} onClick={() => setShowLeave(false)}>Keep reviewing</button><Link href="/dashboard/labs" className={styles.primary}>Leave catalog</Link></div></LabDialog>}
  </main>;
}

function Pagination({ page, total, onChange, label }: { page: number; total: number; onChange: (page: number) => void; label: string }) {
  if (total <= 50) return null;
  return <div className={styles.pagination}><span>{page * 50 + 1}–{Math.min((page + 1) * 50, total)} of {total} {label}</span><button className={styles.iconButton} disabled={page === 0} onClick={() => onChange(page - 1)} aria-label={`Previous ${label}`}><ChevronLeft size={17} /></button><button className={styles.iconButton} disabled={(page + 1) * 50 >= total} onClick={() => onChange(page + 1)} aria-label={`Next ${label}`}><ChevronRight size={17} /></button></div>;
}

function NewLabDialog({ busy, error, onClose, onCreate }: { busy: boolean; error: string; onClose: () => void; onCreate: (details: NewLab) => void }) {
  const [details, setDetails] = useState<NewLab>({ name: "", countryCode: "", city: "", region: "", currency: "" });
  const currencies = Intl.supportedValuesOf("currency");
  const valid = !!details.name.trim() && !!details.countryCode && !!details.city.trim() && isLabCurrency(details.currency);
  return <LabDialog title="Make room for another lab." description="Add its location and currency to the directory. A new lab starts in setup with production disabled." busy={busy} error={error} onClose={onClose}><form className={styles.newLabForm} onSubmit={event => { event.preventDefault(); if (valid) onCreate({ ...details, name: details.name.trim(), city: details.city.trim(), region: details.region.trim() }); }}><fieldset disabled={busy}><label>Lab name<input autoFocus required maxLength={100} value={details.name} onChange={event => setDetails(previous => ({ ...previous, name: event.target.value }))} placeholder="The lab’s business name" /></label><label>Country<select required value={details.countryCode} onChange={event => setDetails(previous => ({ ...previous, countryCode: event.target.value }))}><option value="">Choose a country</option>{labCountryOptions.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label><div className={styles.twoColumns}><label>City<input required maxLength={100} value={details.city} onChange={event => setDetails(previous => ({ ...previous, city: event.target.value }))} placeholder="City" /></label><label>Province / state / region<input maxLength={100} value={details.region} onChange={event => setDetails(previous => ({ ...previous, region: event.target.value }))} placeholder="Optional" /></label></div><label>Catalog currency<select required value={details.currency} onChange={event => setDetails(previous => ({ ...previous, currency: event.target.value }))}><option value="">Choose an ISO currency</option>{currencies.map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></label><p>Catalog amounts use this currency’s normal decimal places. Currency conversion is not applied to imports.</p><div className={styles.leaveActions}><button type="button" className={styles.secondary} onClick={onClose}>Cancel</button><button className={styles.primary} disabled={!valid}>{busy ? <Loader2 className={styles.spin} size={16} /> : <Plus size={16} />}{busy ? "Adding lab…" : "Add lab in setup"}</button></div></fieldset></form></LabDialog>;
}
