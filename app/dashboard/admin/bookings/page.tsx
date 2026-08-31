"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Copy,
  ExternalLink,
  GraduationCap,
  LockKeyhole,
  RefreshCw,
  Search,
  TicketCheck,
  Users,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StudioBookingPdfExport } from "@/components/studio-booking-pdf-export";
import type {
  StudioBookingEventSummary,
  StudioBookingsOverview,
} from "@/lib/studio-bookings";
import styles from "./studio-bookings.module.css";

type ViewFilter = "all" | "active" | "inactive" | "full";
type ErrorPayload = { ok?: false; message?: string };

function money(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function dateLabel(value: string | null, timezone = "America/Toronto") {
  if (!value) return "No date scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function timeLabel(value: string | null, timezone = "America/Toronto") {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function relativeTime(value: string | null) {
  if (!value) return "No bookings yet";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Time unavailable";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function EventCard({
  event,
  copied,
  onCopy,
}: {
  event: StudioBookingEventSummary;
  copied: boolean;
  onCopy: (event: StudioBookingEventSummary) => void;
}) {
  return (
    <article className={styles.eventCard}>
      <div className={styles.eventCardTop}>
        <div className={styles.eventIdentity}>
          <span className={styles.eventIcon}>
            {event.kind === "school" ? <GraduationCap size={21} /> : <CalendarDays size={21} />}
          </span>
          <div>
            <div className={styles.eventLabels}>
              <span className={event.enabled ? styles.activePill : styles.inactivePill}>
                {event.enabled ? "Active link" : "Inactive link"}
              </span>
              <span className={styles.kindPill}>{event.kind}</span>
            </div>
            <h2>{event.name}</h2>
            <p>
              {dateLabel(event.firstSlotAt, event.timezone)} · {timeLabel(event.firstSlotAt, event.timezone)}–{timeLabel(event.lastSlotAt, event.timezone)}
            </p>
          </div>
        </div>
        <div className={styles.eventActions}>
          <StudioBookingPdfExport eventId={event.id} eventName={event.name} />
          <button type="button" onClick={() => onCopy(event)} className={styles.iconButton}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "Copied" : "Copy link"}
          </button>
          <a
            href={event.publicUrl}
            target="_blank"
            rel="noreferrer"
            className={styles.iconButton}
          >
            <ExternalLink size={16} /> Open booking page
          </a>
        </div>
      </div>

      <div className={styles.capacityLine}>
        <div>
          <strong>{event.booked}</strong>
          <span>booked</span>
        </div>
        <div>
          <strong>{event.remaining}</strong>
          <span>spaces left</span>
        </div>
        <div>
          <strong>{event.cancelled}</strong>
          <span>cancelled</span>
        </div>
        <div>
          <strong>{money(event.revenueCents, event.currency)}</strong>
          <span>collected</span>
        </div>
      </div>

      <div className={styles.progressTrack} aria-label={`${event.percentFilled}% booked`}>
        <span style={{ width: `${event.percentFilled}%` }} />
      </div>
      <div className={styles.progressCaption}>
        <span>{event.percentFilled}% filled · {event.booked} of {event.capacity}</span>
        <span>Latest booking {relativeTime(event.lastBookingAt)}</span>
      </div>

      <div className={styles.dayStrip}>
        {event.days.map((day) => (
          <div key={day.date}>
            <CalendarClock size={16} />
            <span>
              <strong>{dateLabel(day.startAt, event.timezone)}</strong>
              {timeLabel(day.startAt, event.timezone)}–{timeLabel(day.endAt, event.timezone)}
            </span>
            <b>{day.booked} booked · {day.remaining} left</b>
          </div>
        ))}
      </div>

      <div className={styles.eventFooter}>
        <span>
          {event.slotMinutes}-minute sessions · {event.requirePayment ? `${money(event.sittingFeeCents, event.currency)} required` : "No payment required"}
          {event.includesDigitalImages ? " · Digital images included" : ""}
        </span>
        <Link href={`/dashboard/admin/bookings/${event.id}`}>
          View full details <ChevronRight size={17} />
        </Link>
      </div>
    </article>
  );
}

export default function StudioBookingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [report, setReport] = useState<StudioBookingsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ViewFilter>("all");
  const [copiedId, setCopiedId] = useState("");

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      const response = await fetch("/api/dashboard/admin/bookings", {
        cache: "no-store",
        credentials: "include",
        headers,
      });
      const payload = (await response.json().catch(() => ({}))) as
        | StudioBookingsOverview
        | ErrorPayload;
      if (response.status === 401) {
        window.location.href = `/sign-in?redirect=${encodeURIComponent("/dashboard/admin/bookings")}`;
        return;
      }
      if (response.status === 403) {
        window.location.href = "/dashboard";
        return;
      }
      if (!response.ok || payload.ok !== true) {
        throw new Error((payload as ErrorPayload).message || "Studio Bookings could not load.");
      }
      setReport(payload as StudioBookingsOverview);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Studio Bookings could not load.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(refresh);
  }, [load]);

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (report?.events ?? []).filter((event) => {
      if (filter === "active" && !event.enabled) return false;
      if (filter === "inactive" && event.enabled) return false;
      if (filter === "full" && event.remaining > 0) return false;
      return !normalizedQuery || event.name.toLowerCase().includes(normalizedQuery);
    });
  }, [filter, query, report]);

  async function copyLink(event: StudioBookingEventSummary) {
    await navigator.clipboard.writeText(`${window.location.origin}${event.publicUrl}`);
    setCopiedId(event.id);
    window.setTimeout(() => setCopiedId(""), 1800);
  }

  const totals = report?.totals;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.topRow}>
          <Link href="/dashboard" className={styles.backLink}>
            <ArrowLeft size={16} /> Dashboard
          </Link>
          <div className={styles.privateBadge}>
            <LockKeyhole size={14} /> Owner only · read-only
          </div>
        </div>

        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}><CalendarDays size={17} /> Studio Bookings</span>
            <h1>Every booking.<br />Every time slot.</h1>
            <p>
              One private operations view for every school and event link, live capacity,
              booked times, payments, cancellations, and customer details.
            </p>
          </div>
          <div className={styles.heroPulse}>
            <span>Live booking pulse</span>
            <strong>{totals ? `${totals.booked} booked` : "Loading…"}</strong>
            <p>{totals ? `${totals.remaining} spaces still available across ${totals.activeLinks} active links.` : "Reading current booking activity."}</p>
            <small><span /> Auto-refreshes every minute</small>
          </div>
        </section>

        {totals ? (
          <section className={styles.statsGrid} aria-label="Booking overview">
            <div><span className={styles.statIcon}><TicketCheck size={20} /></span><strong>{totals.activeLinks}</strong><p>Active booking links</p><small>{totals.bookingLinks} created in total</small></div>
            <div><span className={styles.statIcon}><Users size={20} /></span><strong>{totals.booked}</strong><p>Confirmed bookings</p><small>{totals.cancelled} cancelled records</small></div>
            <div><span className={styles.statIcon}><Clock3 size={20} /></span><strong>{totals.remaining}</strong><p>Spaces remaining</p><small>{totals.capacity} total capacity</small></div>
            <div><span className={styles.statIcon}><CircleDollarSign size={20} /></span><strong>{money(totals.revenueCents, totals.currency)}</strong><p>Booking fees collected</p><small>{totals.paidBookings} successful payments</small></div>
          </section>
        ) : null}

        <section className={styles.controlBar}>
          <div className={styles.searchBox}>
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search school or event" aria-label="Search school or event" />
          </div>
          <div className={styles.filterGroup} aria-label="Filter booking links">
            {(["all", "active", "inactive", "full"] as ViewFilter[]).map((value) => (
              <button key={value} type="button" onClick={() => setFilter(value)} className={filter === value ? styles.filterActive : undefined}>
                {value === "all" ? "All" : value.charAt(0).toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void load(true)} disabled={refreshing} className={styles.refreshButton}>
            <RefreshCw size={16} className={refreshing ? styles.spin : undefined} />
            {refreshing ? "Refreshing…" : "Refresh now"}
          </button>
        </section>

        {error ? (
          <div className={styles.errorBox} role="alert">
            <XCircle size={20} /><span>{error} No booking data was changed.</span>
            <button type="button" onClick={() => void load(true)}>Try again</button>
          </div>
        ) : null}

        {loading && !report ? (
          <div className={styles.loadingGrid} aria-label="Loading booking overview">
            {Array.from({ length: 3 }).map((_, index) => <div key={index} />)}
          </div>
        ) : null}

        {report ? (
          <section className={styles.eventList}>
            <div className={styles.sectionHeading}>
              <div><h2>Schools & events</h2><p>Click any booking link to see its full timetable and customer records.</p></div>
              <span>{filteredEvents.length} shown</span>
            </div>
            {filteredEvents.length ? filteredEvents.map((event) => (
              <EventCard key={event.id} event={event} copied={copiedId === event.id} onCopy={(value) => void copyLink(value)} />
            )) : (
              <div className={styles.emptyState}><Search size={24} /><strong>No booking links match this view.</strong><span>Try a different search or filter.</span></div>
            )}
          </section>
        ) : null}

        <footer className={styles.footerNote}>
          <LockKeyhole size={15} /> Private owner operations view · No booking can be edited or cancelled here
        </footer>
      </div>
    </main>
  );
}
