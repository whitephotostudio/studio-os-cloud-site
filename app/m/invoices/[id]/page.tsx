"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileDown } from "lucide-react";
import { customerInvoiceMoney, type CustomerInvoiceDetail } from "@/lib/customer-invoices";
import styles from "../invoices.module.css";

type DetailResponse = { ok: boolean; invoice?: CustomerInvoiceDetail; message?: string };

function dateLabel(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
}

function quantityLabel(milli: number): string {
  return Number.isInteger(milli / 1000) ? String(milli / 1000) : (milli / 1000).toFixed(3).replace(/0+$/, "");
}

export default function MobileInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [invoice, setInvoice] = useState<CustomerInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/dashboard/sales-documents?id=${encodeURIComponent(id)}`, { credentials: "include", cache: "no-store" });
        if (response.status === 401) {
          window.location.href = `/sign-in?redirect=${encodeURIComponent(`/m/invoices/${id}`)}`;
          return;
        }
        const body = await response.json().catch(() => ({})) as DetailResponse;
        if (!response.ok || !body.ok || !body.invoice) throw new Error(body.message || "Could not load invoice.");
        if (!cancelled) setInvoice(body.invoice);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load invoice.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (id) void load();
    return () => { cancelled = true; };
  }, [id]);

  return (
    <div>
      <Link href="/m/invoices" className={styles.back}><ArrowLeft size={16} /> All invoices</Link>
      {loading ? <div className={styles.empty}>Loading invoice…</div> : error ? <p className={styles.message} role="alert">{error}</p> : invoice ? (
        <>
          <div className={styles.heading}>
            <div><p className={styles.eyebrow}>Customer invoice</p><h1 className={styles.title}>{invoice.number || "Draft invoice"}</h1><p className={styles.subtitle}>Updated {dateLabel(invoice.updatedAt)}</p></div>
            <span className={`${styles.pill} ${styles[invoice.status as keyof typeof styles] || styles.draft}`}>{invoice.status || "draft"}</span>
          </div>
          <div className={styles.detailGrid}>
            <section className={styles.detailCard} aria-label="Invoice client">
              <div className={styles.detailLabel}>Bill to</div>
              <div className={styles.detailName}>{invoice.clientName || "Unnamed client"}</div>
              {invoice.clientEmail ? <p className={styles.detailText}>{invoice.clientEmail}</p> : null}
              {invoice.clientAddress ? <p className={styles.detailText}>{invoice.clientAddress}</p> : null}
              <div className={styles.facts}>
                <div><div className={styles.detailLabel}>Issue date</div><p className={styles.factValue}>{dateLabel(invoice.issueDate)}</p></div>
                <div><div className={styles.detailLabel}>Due date</div><p className={styles.factValue}>{dateLabel(invoice.dueDate)}</p></div>
                {invoice.projectReference ? <div><div className={styles.detailLabel}>Project</div><p className={styles.factValue}>{invoice.projectReference}</p></div> : null}
              </div>
            </section>
            <section className={styles.detailCard} aria-label="Invoice total">
              <div className={styles.detailLabel}>Total</div>
              <div className={styles.detailName}>{customerInvoiceMoney(invoice.totalCents, invoice.currencyCode)}</div>
              <div className={styles.totalRow}><span>Subtotal</span><strong>{customerInvoiceMoney(invoice.subtotalCents, invoice.currencyCode)}</strong></div>
              <div className={styles.totalRow}><span>{invoice.taxLabel}</span><strong>{customerInvoiceMoney(invoice.taxCents, invoice.currencyCode)}</strong></div>
              <div className={`${styles.totalRow} ${styles.grandTotal}`}><span>Outstanding</span><span>{customerInvoiceMoney(invoice.outstandingCents, invoice.currencyCode)}</span></div>
            </section>
          </div>
          {invoice.studioName || invoice.studioEmail || invoice.studioPhone || invoice.studioAddress ? <section className={styles.detailCard} aria-label="Studio details">
            <div className={styles.detailLabel}>From</div>
            {invoice.studioName ? <div className={styles.detailName}>{invoice.studioName}</div> : null}
            {invoice.studioEmail ? <p className={styles.detailText}>{invoice.studioEmail}</p> : null}
            {invoice.studioPhone ? <p className={styles.detailText}>{invoice.studioPhone}</p> : null}
            {invoice.studioAddress ? <p className={styles.detailText}>{invoice.studioAddress}</p> : null}
          </section> : null}
          <section className={styles.detailCard} aria-label="Invoice items">
            <div className={styles.detailLabel}>Items</div>
            {invoice.lineItems.length ? invoice.lineItems.map((item) => (
              <div key={item.id} className={styles.line}>
                <div><div className={styles.lineDesc}>{item.description || "Item"}</div><div className={styles.lineQty}>{quantityLabel(item.quantityMilli)} × {customerInvoiceMoney(item.unitPriceCents, invoice.currencyCode)}</div></div>
                <div className={styles.lineTotal}>{customerInvoiceMoney(item.totalCents, invoice.currencyCode)}</div>
              </div>
            )) : <p className={styles.detailText}>No line items saved.</p>}
          </section>
          {invoice.notes || invoice.terms ? <section className={styles.detailCard} aria-label="Invoice notes and terms">
            {invoice.notes ? <><div className={styles.detailLabel}>Notes</div><p className={styles.detailText}>{invoice.notes}</p></> : null}
            {invoice.terms ? <><div className={styles.detailLabel} style={{ marginTop: invoice.notes ? 18 : 0 }}>Terms</div><p className={styles.detailText}>{invoice.terms}</p></> : null}
          </section> : null}
          {invoice.pdfUrl ? <a className={styles.pdf} href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer"><FileDown size={18} /> Open invoice PDF</a> : <p className={styles.pdfPending}>The PDF will appear here after its private cloud copy finishes syncing from Studio OS.</p>}
        </>
      ) : null}
    </div>
  );
}
