"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  LockKeyhole,
  Mail,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  WalletCards,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StudioBookingPdfExport } from "@/components/studio-booking-pdf-export";
import { StudioBookingEmailComposer } from "@/components/studio-booking-email-composer";
import type {
  StudioBookingDetail,
  StudioBookingRecord,
  StudioBookingSlot,
} from "@/lib/studio-bookings";
import styles from "../studio-bookings.module.css";

type RecordFilter = "all" | "confirmed" | "cancelled";
type ErrorPayload = { ok?: false; message?: string };

function money(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function formatDate(value: string | null, timezone: string, includeYear = true) {
  if (!value) return "Not scheduled";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(parsed);
}

function formatTime(value: string | null, timezone: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatDateTime(value: string | null, timezone: string) {
  if (!value) return "Not recorded";
  return `${formatDate(value, timezone)} at ${formatTime(value, timezone)}`;
}

function localDateKey(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function localMinutes(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function isCancelled(booking: StudioBookingRecord) {
  return booking.status.toLowerCase() === "cancelled";
}

export default function StudioBookingDetailPage() {
  const params = useParams<{ eventId: string }>();
  const eventId = params.eventId;
  const supabase = useMemo(() => createClient(), []);
  const [detail, setDetail] = useState<StudioBookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RecordFilter>("all");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      const response = await fetch(`/api/dashboard/admin/bookings/${encodeURIComponent(eventId)}`, {
        cache: "no-store",
        credentials: "include",
        headers,
      });
      const payload = (await response.json().catch(() => ({}))) as StudioBookingDetail | ErrorPayload;
      if (response.status === 401) {
        window.location.href = `/sign-in?redirect=${encodeURIComponent(`/dashboard/admin/bookings/${eventId}`)}`;
        return;
      }
      if (response.status === 403) {
        window.location.href = "/dashboard";
        return;
      }
      if (!response.ok || payload.ok !== true) {
        throw new Error((payload as ErrorPayload).message || "Booking details could not load.");
      }
      setDetail(payload as StudioBookingDetail);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Booking details could not load.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [eventId, supabase]);

  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(refresh);
  }, [load]);

  const slotById = useMemo(
    () => new Map((detail?.slots ?? []).map((slot) => [slot.id, slot])),
    [detail],
  );
  const activeBySlot = useMemo(() => {
    const result = new Map<string, StudioBookingRecord[]>();
    for (const booking of detail?.bookings ?? []) {
      if (!booking.slotId || isCancelled(booking)) continue;
      result.set(booking.slotId, [...(result.get(booking.slotId) ?? []), booking]);
    }
    return result;
  }, [detail]);
  const slotsByDay = useMemo(() => {
    const result = new Map<string, StudioBookingSlot[]>();
    if (!detail) return result;
    for (const slot of detail.slots) {
      const day = localDateKey(slot.startAt, detail.event.timezone);
      result.set(day, [...(result.get(day) ?? []), slot]);
    }
    return result;
  }, [detail]);
  const filteredBookings = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (detail?.bookings ?? []).filter((booking) => {
      if (filter === "confirmed" && isCancelled(booking)) return false;
      if (filter === "cancelled" && !isCancelled(booking)) return false;
      if (!normalized) return true;
      return [booking.studentName, booking.className, booking.parentName, booking.parentEmail, booking.parentPhone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
  }, [detail, filter, query]);

  async function copyLink() {
    if (!detail) return;
    await navigator.clipboard.writeText(`${window.location.origin}${detail.event.publicUrl}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (loading && !detail) {
    return <main className={styles.page}><div className={styles.detailLoading}><RefreshCw className={styles.spin} /> Loading full booking details…</div></main>;
  }

  const event = detail?.event;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.topRow}>
          <Link href="/dashboard/admin/bookings" className={styles.backLink}><ArrowLeft size={16} /> Studio Bookings</Link>
          <div className={styles.privateBadge}><LockKeyhole size={14} /> Owner only · private customer details</div>
        </div>

        {error ? (
          <div className={styles.errorBox} role="alert"><XCircle size={20} /><span>{error} No booking data was changed.</span><button type="button" onClick={() => void load(true)}>Try again</button></div>
        ) : null}

        {event && detail ? (
          <>
            <section className={styles.detailHero}>
              <div>
                <div className={styles.eventLabels}><span className={event.enabled ? styles.activePill : styles.inactivePill}>{event.enabled ? "Active booking link" : "Inactive booking link"}</span><span className={styles.kindPill}>{event.kind}</span></div>
                <h1>{event.name}</h1>
                <p><CalendarDays size={17} /> {formatDate(event.firstSlotAt, event.timezone)} · {formatTime(event.firstSlotAt, event.timezone)}–{formatTime(event.lastSlotAt, event.timezone)}</p>
              </div>
              <div className={styles.detailActions}>
                <StudioBookingPdfExport eventId={event.id} eventName={event.name} />
                <StudioBookingEmailComposer detail={detail} />
                <button type="button" onClick={() => void copyLink()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy booking link"}</button>
                <a href={event.publicUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open public page</a>
                <button type="button" onClick={() => void load(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? styles.spin : undefined} />{refreshing ? "Refreshing…" : "Refresh"}</button>
              </div>
            </section>

            <section className={styles.detailStats}>
              <div><strong>{event.booked}</strong><span>Confirmed</span><small>of {event.capacity} spaces</small></div>
              <div><strong>{event.remaining}</strong><span>Remaining</span><small>{event.percentFilled}% filled</small></div>
              <div><strong>{event.cancelled}</strong><span>Cancelled</span><small>{event.totalRecords} booking records</small></div>
              <div><strong>{event.paidBookings}</strong><span>Paid bookings</span><small>{money(event.revenueCents, event.currency)} collected</small></div>
              <div><strong>{event.slotMinutes} min</strong><span>Session length</span><small>{event.days.length} shoot day{event.days.length === 1 ? "" : "s"}</small></div>
            </section>

            <section className={styles.dayOverview}>
              <div className={styles.sectionHeading}><div><h2>Capacity by shoot day</h2><p>A quick view of what is booked and what is still open.</p></div></div>
              <div className={styles.dayOverviewGrid}>
                {event.days.map((day) => (
                  <article key={day.date}>
                    <div><CalendarDays size={19} /><span><strong>{formatDate(day.startAt, event.timezone)}</strong>{formatTime(day.startAt, event.timezone)}–{formatTime(day.endAt, event.timezone)}</span></div>
                    <div className={styles.dayNumbers}><span><b>{day.booked}</b> booked</span><span><b>{day.remaining}</b> left</span><span><b>{day.capacity}</b> total</span></div>
                    <div className={styles.progressTrack}><span style={{ width: `${day.capacity ? Math.round((day.booked / day.capacity) * 100) : 0}%` }} /></div>
                  </article>
                ))}
              </div>
            </section>

            <section className={styles.timetableSection}>
              <div className={styles.sectionHeading}><div><h2>Live timetable</h2><p>Every scheduled time, including booked students, open spaces, and the protected lunch break.</p></div><span>{event.booked} booked · {event.remaining} open</span></div>
              {Array.from(slotsByDay.entries()).map(([day, slots]) => (
                <div className={styles.timetableDay} key={day}>
                  <h3>{formatDate(slots[0]?.startAt ?? null, event.timezone)}</h3>
                  <div className={styles.timetableRows}>
                    {slots.map((slot, index) => {
                      const appointments = activeBySlot.get(slot.id) ?? [];
                      return (
                        <Fragment key={slot.id}>
                          {index > 0 && localMinutes(slots[index - 1].startAt, event.timezone) < 750 && localMinutes(slot.startAt, event.timezone) >= 780 ? (
                            <div className={styles.lunchRow} role="note"><strong>🍴 LUNCH</strong><span>12:30 PM–1:00 PM · Locked and unavailable</span></div>
                          ) : null}
                          <div className={`${styles.timeRow} ${appointments.length ? styles.timeBooked : styles.timeOpen}`}>
                            <div className={styles.timeCell}><Clock3 size={15} /><strong>{formatTime(slot.startAt, event.timezone)}</strong><span>{formatTime(slot.endAt, event.timezone)}</span></div>
                            {appointments.length ? (
                              <div className={styles.appointmentCell}>
                                {appointments.map((booking) => (
                                  <div key={booking.id}>
                                    <span><strong>{booking.studentName}</strong>{booking.className || "Class not recorded"}</span>
                                    <span className={styles.paymentMini}>{booking.paymentStatus === "succeeded" ? <Check size={13} /> : <WalletCards size={13} />}{booking.paymentStatus === "succeeded" ? `Paid ${money(booking.paymentAmountCents, booking.paymentCurrency)}` : booking.paymentStatus}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className={styles.openCell}><Check size={15} /> Available</div>
                            )}
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>

            <section className={styles.recordsSection}>
              <div className={styles.sectionHeading}><div><h2>Booking records & customer details</h2><p>Confirmed appointments and cancellation history. This information is visible only to the owner.</p></div><span>{filteredBookings.length} shown</span></div>
              <div className={styles.recordControls}>
                <div className={styles.searchBox}><Search size={18} /><input value={query} onChange={(input) => setQuery(input.target.value)} placeholder="Search student, class, parent, email or phone" aria-label="Search booking records" /></div>
                <div className={styles.filterGroup}>{(["all", "confirmed", "cancelled"] as RecordFilter[]).map((value) => <button type="button" key={value} onClick={() => setFilter(value)} className={filter === value ? styles.filterActive : undefined}>{value.charAt(0).toUpperCase() + value.slice(1)}</button>)}</div>
              </div>
              <div className={styles.recordList}>
                {filteredBookings.map((booking) => {
                  const slot = booking.slotId ? slotById.get(booking.slotId) : null;
                  const cancelled = isCancelled(booking);
                  return (
                    <article key={booking.id} className={cancelled ? styles.cancelledRecord : undefined}>
                      <div className={styles.recordTime}><strong>{slot ? formatTime(slot.startAt, event.timezone) : "No time"}</strong><span>{slot ? formatDate(slot.startAt, event.timezone, false) : "Slot unavailable"}</span><em className={cancelled ? styles.cancelledPill : styles.confirmedPill}>{cancelled ? "Cancelled" : booking.status}</em></div>
                      <div className={styles.recordPerson}><UserRound size={18} /><span><strong>{booking.studentName}</strong>{booking.className || "Class not recorded"}</span></div>
                      <div className={styles.recordContact}>
                        <strong>{booking.parentName || "Parent name not recorded"}</strong>
                        {booking.parentEmail ? <a href={`mailto:${booking.parentEmail}`}><Mail size={14} /> {booking.parentEmail}</a> : <span>Email not recorded</span>}
                        {booking.parentPhone ? <a href={`tel:${booking.parentPhone}`}><Phone size={14} /> {booking.parentPhone}</a> : null}
                      </div>
                      <div className={styles.recordPayment}><span><WalletCards size={15} /> {booking.paymentStatus}</span><strong>{booking.paymentAmountCents > 0 ? money(booking.paymentAmountCents, booking.paymentCurrency) : event.requirePayment ? "No successful payment" : "Not required"}</strong></div>
                      <div className={styles.recordMeta}><span>Booked {formatDateTime(booking.createdAt, event.timezone)}</span>{booking.consentRecordedAt ? <span><ShieldCheck size={13} /> Consent recorded</span> : null}{booking.notes ? <p>{booking.notes}</p> : null}</div>
                    </article>
                  );
                })}
                {!filteredBookings.length ? <div className={styles.emptyState}><Search size={24} /><strong>No booking records match.</strong><span>Try a different search or filter.</span></div> : null}
              </div>
            </section>

            <footer className={styles.footerNote}><LockKeyhole size={15} /> Read-only view · Access PINs, private tokens, and payment identifiers are never displayed</footer>
          </>
        ) : null}
      </div>
    </main>
  );
}
