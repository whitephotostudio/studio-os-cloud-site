"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, RefreshCw, Search } from "lucide-react";
import { customerInvoiceMoney, type CustomerInvoiceSummary } from "@/lib/customer-invoices";
import styles from "./invoices.module.css";

const FILTERS = ["all", "draft", "issued", "sent", "paid", "void"] as const;
type Filter = typeof FILTERS[number];

type ListResponse = {
  ok: boolean;
  invoices?: CustomerInvoiceSummary[];
  count?: number;
  message?: string;
};

function dateLabel(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

async function loadInvoices(search: string, status: Filter, offset: number): Promise<ListResponse> {
  const params = new URLSearchParams({ limit: "50", offset: String(offset) });
  if (search) params.set("search", search);
  if (status !== "all") params.set("status", status);
  const response = await fetch(`/api/dashboard/sales-documents?${params}`, {
    credentials: "include",
    cache: "no-store",
  });
  if (response.status === 401) {
    window.location.href = `/sign-in?redirect=${encodeURIComponent("/m/invoices")}`;
    throw new Error("Please sign in again.");
  }
  const body = await response.json().catch(() => ({})) as ListResponse;
  if (!response.ok || !body.ok) throw new Error(body.message || "Could not load invoices.");
  return body;
}

export default function MobileInvoicesPage() {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState<Filter>("all");
  const [invoices, setInvoices] = useState<CustomerInvoiceSummary[]>([]);
  const [count, setCount] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const activeKey = useRef("");

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const key = `${appliedSearch}|${status}|${refresh}`;
    activeKey.current = key;
    let cancelled = false;
    setLoading(true);
    setError("");
    setInvoices([]);
    setNextOffset(0);
    void loadInvoices(appliedSearch, status, 0)
      .then((body) => {
        if (cancelled || activeKey.current !== key) return;
        setInvoices(body.invoices ?? []);
        setCount(body.count ?? 0);
        setNextOffset((body.invoices ?? []).length);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load invoices.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [appliedSearch, status, refresh]);

  async function loadMore() {
    if (loadingMore || loading || nextOffset >= count) return;
    const key = activeKey.current;
    setLoadingMore(true);
    setError("");
    try {
      const body = await loadInvoices(appliedSearch, status, nextOffset);
      if (activeKey.current !== key) return;
      setInvoices((current) => {
        const ids = new Set(current.map((invoice) => invoice.id));
        return [...current, ...(body.invoices ?? []).filter((invoice) => !ids.has(invoice.id))];
      });
      setCount(body.count ?? 0);
      setNextOffset((body.invoices ?? []).length ? nextOffset + (body.invoices ?? []).length : (body.count ?? 0));
    } catch (caught) {
      if (activeKey.current === key) setError(caught instanceof Error ? caught.message : "Could not load more invoices.");
    } finally {
      if (activeKey.current === key) setLoadingMore(false);
    }
  }

  return (
    <div>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Sales</p>
          <h1 className={styles.title}>Customer invoices</h1>
          <p className={styles.subtitle}>Invoices saved from Studio OS on any of your computers.</p>
        </div>
        <button className={styles.refresh} type="button" aria-label="Refresh invoices" onClick={() => setRefresh((current) => current + 1)}><RefreshCw size={18} /></button>
      </div>
      <label className={styles.searchWrap}>
        <Search size={18} />
        <input className={styles.search} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, email, project or invoice #" aria-label="Search customer invoices" />
      </label>
      <div className={styles.filters} aria-label="Filter invoices by status">
        {FILTERS.map((option) => (
          <button key={option} type="button" className={`${styles.filter} ${status === option ? styles.filterActive : ""}`} onClick={() => setStatus(option)} aria-pressed={status === option}>{option === "all" ? "All" : option === "void" ? "Void" : option[0].toUpperCase() + option.slice(1)}</button>
        ))}
      </div>
      {!loading && !error ? <p className={styles.summary}>{count} {count === 1 ? "invoice" : "invoices"}</p> : null}
      {error ? <p className={styles.message} role="alert">{error}</p> : null}
      {loading ? <div className={styles.empty}>Loading customer invoices…</div> : invoices.length === 0 ? (
        <div className={styles.empty}><FileText size={25} /><strong>No invoices found</strong>{appliedSearch || status !== "all" ? "Try another search or filter." : "Invoices you save in Studio OS Sales will appear here after cloud sync."}</div>
      ) : (
        <div className={styles.list}>
          {invoices.map((invoice) => (
            <Link key={invoice.id} href={`/m/invoices/${encodeURIComponent(invoice.id)}`} className={styles.card}>
              <div className={styles.cardTop}><span className={styles.invoiceNumber}>{invoice.number || "Draft invoice"}</span><span className={`${styles.pill} ${styles[invoice.status as keyof typeof styles] || styles.draft}`}>{invoice.status || "draft"}</span></div>
              <p className={styles.client}>{invoice.clientName || "Unnamed client"}</p>
              {invoice.projectReference ? <p className={styles.meta}>{invoice.projectReference}</p> : null}
              <p className={styles.meta}>Issued {dateLabel(invoice.issueDate)}{invoice.dueDate ? ` · Due ${dateLabel(invoice.dueDate)}` : ""}</p>
              <div className={styles.cardBottom}><div><div className={styles.amount}>{customerInvoiceMoney(invoice.totalCents, invoice.currencyCode)}</div>{invoice.outstandingCents > 0 ? <p className={styles.meta}>{customerInvoiceMoney(invoice.outstandingCents, invoice.currencyCode)} outstanding</p> : null}</div><span aria-hidden>›</span></div>
            </Link>
          ))}
        </div>
      )}
      {!loading && nextOffset < count ? <button className={styles.loadMore} type="button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more invoices"}</button> : null}
    </div>
  );
}
