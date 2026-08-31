"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, FileDown, LoaderCircle, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { StudioBookingPdfFilter } from "@/lib/studio-bookings-pdf";
import styles from "@/app/dashboard/admin/bookings/studio-bookings.module.css";

const OPTIONS: Array<{ value: StudioBookingPdfFilter; label: string; description: string }> = [
  { value: "confirmed", label: "Confirmed bookings", description: "Only active appointments" },
  { value: "cancelled", label: "Cancelled bookings", description: "Only cancellation history" },
  { value: "all", label: "All booking records", description: "Confirmed and cancelled" },
];

type ErrorPayload = { message?: string };

function filenameFromHeader(header: string | null) {
  const match = header?.match(/filename="([^"]+)"/i);
  return match?.[1] || "studio-bookings-report.pdf";
}

export function StudioBookingPdfExport({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [exporting, setExporting] = useState<StudioBookingPdfFilter | null>(null);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  async function download(filter: StudioBookingPdfFilter, details: HTMLDetailsElement | null) {
    if (exporting) return;
    setExporting(filter);
    setError("");
    setCompleted(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      const response = await fetch(
        `/api/dashboard/admin/bookings/${encodeURIComponent(eventId)}/export?status=${filter}`,
        { cache: "no-store", credentials: "include", headers },
      );
      if (response.status === 401) {
        window.location.href = `/sign-in?redirect=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
        throw new Error(payload.message || "The PDF could not be created.");
      }
      const blob = await response.blob();
      if (blob.type !== "application/pdf") throw new Error("The downloaded report was not a PDF.");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFromHeader(response.headers.get("Content-Disposition"));
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
      setCompleted(true);
      details?.removeAttribute("open");
      window.setTimeout(() => setCompleted(false), 2_000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "The PDF could not be created.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className={styles.pdfExportWrap}>
      <details className={styles.pdfExportMenu}>
        <summary title={`Export ${eventName} booking report`}>
          {exporting ? <LoaderCircle size={16} className={styles.spin} /> : completed ? <CheckCircle2 size={16} /> : <FileDown size={16} />}
          {exporting ? "Creating PDF…" : completed ? "PDF downloaded" : "Export PDF"}
        </summary>
        <div className={styles.pdfExportOptions}>
          <strong>Choose a PDF report</strong>
          {OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              disabled={Boolean(exporting)}
              onClick={(event) => void download(option.value, event.currentTarget.closest("details"))}
            >
              <span>{option.label}<small>{option.description}</small></span>
              {exporting === option.value ? <LoaderCircle size={15} className={styles.spin} /> : <FileDown size={15} />}
            </button>
          ))}
          <small className={styles.pdfPrivacy}>Private owner report. No PINs or payment identifiers.</small>
        </div>
      </details>
      {error ? <span className={styles.pdfError} role="alert"><XCircle size={13} /> {error}</span> : null}
    </div>
  );
}
