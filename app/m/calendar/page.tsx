"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  GraduationCap,
  List,
  MapPin,
  NotebookText,
  PartyPopper,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import type { ScheduleItem } from "@/lib/schedule-calendar";

type CalendarFeed = {
  httpUrl: string;
  webcalUrl: string;
};

type ViewMode = "month" | "week" | "day";
type QuickKind = "event" | "school";
type GalleryStatus = "active" | "inactive" | "pre_release" | "closed";

const statusOptions: { value: GalleryStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "pre_release", label: "Pre-Released" },
  { value: "closed", label: "Closed" },
];

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateOnly: string, days: number): string {
  const date = parseDateOnly(dateOnly);
  date.setDate(date.getDate() + days);
  return toDateOnly(date);
}

function startOfWeek(dateOnly: string): string {
  const date = parseDateOnly(dateOnly);
  date.setDate(date.getDate() - date.getDay());
  return toDateOnly(date);
}

function formatDate(value: string): string {
  return parseDateOnly(value).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatLongDate(value: string): string {
  return parseDateOnly(value).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function statusLabel(value: string | null): string {
  const raw = clean(value).replaceAll("_", " ");
  if (!raw) return "No status";
  return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toTimeInput(value: string | null | undefined): string {
  const raw = clean(value);
  if (!raw) return "";
  const match = raw.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)?$/i);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function fromTimeInput(value: string): string {
  const raw = clean(value);
  if (!raw) return "";
  const [hourRaw, minuteRaw] = raw.split(":");
  const hour24 = Number(hourRaw);
  const minute = Number(minuteRaw ?? "0");
  if (Number.isNaN(hour24) || Number.isNaN(minute)) return "";
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function bookingKey(item: ScheduleItem): string {
  return `${item.kind}-${item.id}`;
}

export default function MobileCalendarPage() {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => toDateOnly(new Date()));
  const [cursor, setCursor] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [selectedBookingKey, setSelectedBookingKey] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [detailStartTime, setDetailStartTime] = useState("");
  const [detailEndTime, setDetailEndTime] = useState("");
  const [detailDate, setDetailDate] = useState(selectedDate);
  const [detailLocation, setDetailLocation] = useState("");
  const [detailAddress, setDetailAddress] = useState("");
  const [detailNotes, setDetailNotes] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [quickKind, setQuickKind] = useState<QuickKind>("event");
  const [quickTitle, setQuickTitle] = useState("");
  const [quickClient, setQuickClient] = useState("");
  const [quickStatus, setQuickStatus] = useState<GalleryStatus>("pre_release");
  const [creatingBooking, setCreatingBooking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/dashboard/calendar", { credentials: "include" });
        const payload = await res.json();
        if (cancelled) return;
        if (res.status === 401) {
          window.location.href = "/sign-in?redirect=/m/calendar";
          return;
        }
        if (!res.ok || payload.ok === false) {
          throw new Error(payload.message || "Failed to load calendar.");
        }
        setItems((payload.items ?? []) as ScheduleItem[]);
        setFeed((payload.feed ?? null) as CalendarFeed | null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load calendar.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const monthCells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [cursor]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    for (const item of items) {
      const existing = map.get(item.date) ?? [];
      existing.push(item);
      existing.sort((a, b) => clean(a.startTime ?? a.time).localeCompare(clean(b.startTime ?? b.time)));
      map.set(item.date, existing);
    }
    return map;
  }, [items]);

  const monthItems = useMemo(() => {
    const month = cursor.getMonth();
    const year = cursor.getFullYear();
    return items.filter((item) => {
      const date = parseDateOnly(item.date);
      return date.getMonth() === month && date.getFullYear() === year;
    });
  }, [cursor, items]);

  const weekDates = useMemo(() => {
    const start = startOfWeek(selectedDate);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [selectedDate]);

  const selectedItems = useMemo(
    () => itemsByDate.get(selectedDate) ?? [],
    [itemsByDate, selectedDate],
  );

  const selectedBooking = useMemo(
    () =>
      selectedItems.find((item) => bookingKey(item) === selectedBookingKey) ??
      selectedItems[0] ??
      null,
    [selectedBookingKey, selectedItems],
  );

  const upcoming = useMemo(() => {
    const today = toDateOnly(new Date());
    return items.filter((item) => item.date >= today).slice(0, 8);
  }, [items]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (!selectedItems.length) {
        setSelectedBookingKey("");
        return;
      }
      if (!selectedItems.some((item) => bookingKey(item) === selectedBookingKey)) {
        setSelectedBookingKey(bookingKey(selectedItems[0]));
      }
    }, 0);
    return () => window.clearTimeout(handle);
  }, [selectedBookingKey, selectedItems]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDetailDate(selectedBooking?.date ?? selectedDate);
      setDetailStartTime(toTimeInput(selectedBooking?.startTime ?? selectedBooking?.time));
      setDetailEndTime(toTimeInput(selectedBooking?.endTime));
      setDetailLocation(selectedBooking?.location ?? "");
      setDetailAddress(selectedBooking?.address ?? "");
      setDetailNotes(selectedBooking?.notes ?? "");
    }, 0);
    return () => window.clearTimeout(handle);
  }, [selectedBooking, selectedDate]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function jumpToBooking(item: ScheduleItem) {
    const date = parseDateOnly(item.date);
    setCursor(new Date(date.getFullYear(), date.getMonth(), 1));
    setSelectedDate(item.date);
    setSelectedBookingKey(bookingKey(item));
    setSummaryOpen(false);
  }

  async function copyFeedUrl() {
    if (!feed?.webcalUrl) return;
    try {
      await navigator.clipboard.writeText(feed.webcalUrl);
      showToast("Apple Calendar link copied");
    } catch {
      showToast("Could not copy link");
    }
  }

  async function reloadCalendar(): Promise<ScheduleItem[]> {
    const res = await fetch("/api/dashboard/calendar", { credentials: "include" });
    const payload = await res.json();
    if (!res.ok || payload.ok === false) {
      throw new Error(payload.message || "Failed to reload calendar.");
    }
    const nextItems = (payload.items ?? []) as ScheduleItem[];
    setItems(nextItems);
    setFeed((payload.feed ?? null) as CalendarFeed | null);
    return nextItems;
  }

  async function saveDetails() {
    if (!selectedBooking) return;
    setSavingDetails(true);
    setError("");
    const startTime = fromTimeInput(detailStartTime);
    const endTime = fromTimeInput(detailEndTime);
    try {
      const res = await fetch("/api/dashboard/calendar/details", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: selectedBooking.kind,
          id: selectedBooking.id,
          date: detailDate,
          startTime,
          endTime,
          time: startTime,
          location: detailLocation,
          address: detailAddress,
          notes: detailNotes,
        }),
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.message || "Failed to save calendar details.");
      }
      setItems((current) =>
        current.map((item) =>
          item.kind === selectedBooking.kind && item.id === selectedBooking.id
            ? {
                ...item,
                date: detailDate,
                startTime: startTime || null,
                endTime: endTime || null,
                time: startTime || null,
                location: clean(detailLocation) || null,
                address: clean(detailAddress) || null,
                notes: clean(detailNotes) || null,
              }
            : item,
        ),
      );
      const nextDate = parseDateOnly(detailDate);
      setSelectedDate(detailDate);
      setCursor(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
      showToast("Calendar details saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save calendar details.");
    } finally {
      setSavingDetails(false);
    }
  }

  async function removeFromCalendar() {
    if (!selectedBooking) return;
    const ok = window.confirm(
      `Remove "${selectedBooking.title}" from the calendar? This clears the shoot date but does not delete the ${selectedBooking.kind === "school" ? "school" : "event"}.`,
    );
    if (!ok) return;
    setSavingDetails(true);
    setError("");
    try {
      const res = await fetch("/api/dashboard/calendar/details", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: selectedBooking.kind,
          id: selectedBooking.id,
          date: null,
          startTime: fromTimeInput(detailStartTime),
          endTime: fromTimeInput(detailEndTime),
          time: fromTimeInput(detailStartTime),
          location: detailLocation,
          address: detailAddress,
          notes: detailNotes,
        }),
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.message || "Failed to remove date.");
      }
      await reloadCalendar();
      setSelectedBookingKey("");
      showToast("Booking removed from calendar");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove date.");
    } finally {
      setSavingDetails(false);
    }
  }

  async function createBooking() {
    const title = clean(quickTitle);
    if (!title) {
      setError(quickKind === "school" ? "School name is required." : "Event name is required.");
      return;
    }
    setCreatingBooking(true);
    setError("");
    try {
      const res = await fetch(quickKind === "school" ? "/api/dashboard/schools" : "/api/dashboard/events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          quickKind === "school"
            ? { school_name: title, shoot_date: selectedDate }
            : { title, clientName: clean(quickClient), eventDate: selectedDate, galleryStatus: quickStatus },
        ),
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.message || "Failed to create booking.");
      }

      const createdId = quickKind === "school" ? payload.school?.id : payload.project?.id;
      if (quickKind === "school" && createdId) {
        await fetch(`/api/dashboard/schools/${createdId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: quickStatus, shoot_date: selectedDate, email_required: true }),
        });
      }

      const createdKey = createdId ? `${quickKind}-${createdId}` : "";
      const refreshed = await reloadCalendar();
      setQuickTitle("");
      setQuickClient("");
      showToast(`${quickKind === "school" ? "School" : "Event"} added`);
      const created = refreshed.find((item) => bookingKey(item) === createdKey);
      if (created) jumpToBooking(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create booking.");
    } finally {
      setCreatingBooking(false);
    }
  }

  const monthLabel = formatMonth(cursor);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <header style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", fontWeight: 900, color: "#6b7280" }}>
          SCHEDULE
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 950, color: "#111827" }}>
            Calendar
          </h1>
          <button type="button" onClick={copyFeedUrl} disabled={!feed} style={smallIconButtonStyle} aria-label="Copy Apple Calendar link">
            <Copy size={17} />
          </button>
        </div>
      </header>

      {error ? <div style={errorStyle}>{error}</div> : null}
      {toast ? <div style={toastStyle}>{toast}</div> : null}

      <section style={summaryStyle}>
        <button
          type="button"
          onClick={() => setSummaryOpen((value) => !value)}
          style={summaryButtonStyle}
        >
          <CalendarDays size={24} />
          <span style={{ display: "grid", textAlign: "left" }}>
            <span style={{ fontSize: 28, fontWeight: 950, lineHeight: 1 }}>{monthItems.length}</span>
            <span style={{ color: "#d1d5db", fontSize: 13, fontWeight: 900 }}>This month</span>
          </span>
          <span style={{ marginLeft: "auto", fontSize: 18 }}>{summaryOpen ? "⌃" : "⌄"}</span>
        </button>
        {summaryOpen ? (
          <div style={{ display: "grid", gap: 7, padding: "0 12px 12px" }}>
            {monthItems.length ? (
              monthItems.map((item) => (
                <button key={`${bookingKey(item)}-summary`} type="button" onClick={() => jumpToBooking(item)} style={darkBookingStyle}>
                  <span style={{ minWidth: 0 }}>
                    <span style={darkBookingTitleStyle}>{item.title}</span>
                    <span style={darkBookingMetaStyle}>{formatDate(item.date)}</span>
                  </span>
                  <span>›</span>
                </button>
              ))
            ) : (
              <div style={{ color: "#d1d5db", fontSize: 13, fontWeight: 800 }}>No booked dates this month.</div>
            )}
          </div>
        ) : null}
      </section>

      <section style={panelStyle}>
        <div style={calendarHeaderStyle}>
          <div>
            <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 900 }}>{viewMode.toUpperCase()}</div>
            <h2 style={{ margin: "2px 0 0", fontSize: 20, fontWeight: 950, color: "#111827" }}>{monthLabel}</h2>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} style={iconButtonStyle}>
              <ChevronLeft size={18} />
            </button>
            <button type="button" aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} style={iconButtonStyle}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <div style={segmentGroupStyle}>
          {(["month", "week", "day"] as const).map((mode) => (
            <button key={mode} type="button" onClick={() => setViewMode(mode)} style={viewMode === mode ? selectedSegmentStyle : segmentStyle}>
              {mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {viewMode === "month" ? (
          <div style={monthGridStyle}>
            {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
              <div key={`${day}-${index}`} style={weekdayStyle}>{day}</div>
            ))}
            {monthCells.map((date) => {
              const dateOnly = toDateOnly(date);
              const dayItems = itemsByDate.get(dateOnly) ?? [];
              const inMonth = date.getMonth() === cursor.getMonth();
              const isSelected = dateOnly === selectedDate;
              const isToday = dateOnly === toDateOnly(new Date());
              return (
                <button
                  key={dateOnly}
                  type="button"
                  onClick={() => {
                    setSelectedDate(dateOnly);
                    setViewMode(dayItems.length ? "day" : viewMode);
                  }}
                  style={{
                    ...dayCellStyle,
                    borderColor: isSelected ? "#cc0000" : "#eef2f7",
                    background: isSelected ? "#fff7f7" : inMonth ? "#fff" : "#f9fafb",
                    color: inMonth ? "#111827" : "#9ca3af",
                  }}
                >
                  <span style={{ ...dayNumberStyle, background: isToday ? "#cc0000" : "transparent", color: isToday ? "#fff" : "inherit" }}>
                    {date.getDate()}
                  </span>
                  {dayItems.length ? <span style={dotStyle}>{dayItems.length}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}

        {viewMode === "week" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 7 }}>
            {weekDates.map((dateOnly) => {
              const dayItems = itemsByDate.get(dateOnly) ?? [];
              const date = parseDateOnly(dateOnly);
              const active = dateOnly === selectedDate;
              return (
                <button key={dateOnly} type="button" onClick={() => setSelectedDate(dateOnly)} style={active ? selectedWeekDayStyle : weekDayStyle}>
                  <span style={{ fontSize: 11, fontWeight: 900 }}>{date.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2)}</span>
                  <span style={{ fontSize: 18, fontWeight: 950 }}>{date.getDate()}</span>
                  <span style={{ fontSize: 11, fontWeight: 900, color: active ? "#fff" : "#cc0000" }}>{dayItems.length || ""}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 950, color: "#111827" }}>{formatLongDate(selectedDate)}</h3>
            <button type="button" onClick={() => setSelectedDate(toDateOnly(new Date()))} style={todayButtonStyle}>Today</button>
          </div>
          {loading ? (
            <div style={emptyStyle}>Loading calendar...</div>
          ) : selectedItems.length ? (
            selectedItems.map((item) => {
              const Icon = item.kind === "school" ? GraduationCap : PartyPopper;
              const active = bookingKey(item) === bookingKey(selectedBooking ?? item);
              return (
                <button key={bookingKey(item)} type="button" onClick={() => setSelectedBookingKey(bookingKey(item))} style={active ? selectedBookingButtonStyle : bookingButtonStyle}>
                  <span style={bookingIconStyle}><Icon size={17} /></span>
                  <span style={{ minWidth: 0, textAlign: "left" }}>
                    <span style={bookingTitleStyle}>{item.title}</span>
                    <span style={bookingMetaStyle}>
                      {item.kind === "school" ? "School" : "Event"} · {statusLabel(item.status)}
                      {item.startTime || item.time ? ` · ${item.startTime ?? item.time}` : ""}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <div style={emptyStyle}>No booking on this date yet.</div>
          )}
        </div>
      </section>

      <section style={panelStyle}>
        <h2 style={panelTitleStyle}>Add to {formatDate(selectedDate)}</h2>
        <div style={twoSegmentGroupStyle}>
          <button type="button" onClick={() => setQuickKind("event")} style={quickKind === "event" ? selectedSegmentStyle : segmentStyle}>Event</button>
          <button type="button" onClick={() => setQuickKind("school")} style={quickKind === "school" ? selectedSegmentStyle : segmentStyle}>School</button>
        </div>
        <input value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} placeholder={quickKind === "school" ? "School name" : "Event name"} style={fieldInputStyle} />
        {quickKind === "event" ? (
          <input value={quickClient} onChange={(event) => setQuickClient(event.target.value)} placeholder="Client name" style={fieldInputStyle} />
        ) : null}
        <label style={fieldLabelStyle}>
          <span style={fieldTextStyle}>Gallery status</span>
          <select value={quickStatus} onChange={(event) => setQuickStatus(event.target.value as GalleryStatus)} style={fieldInputStyle}>
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={createBooking} disabled={creatingBooking} style={primaryButtonStyle}>
          <Plus size={16} /> {creatingBooking ? "Adding..." : `Add ${quickKind === "school" ? "School" : "Event"}`}
        </button>
      </section>

      {selectedBooking ? (
        <section style={panelStyle}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontSize: 12, color: "#cc0000", fontWeight: 950 }}>
              {selectedBooking.kind === "school" ? "School" : "Event"} · {statusLabel(selectedBooking.status)}
            </div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 950, color: "#111827" }}>{selectedBooking.title}</h2>
            {selectedBooking.clientName ? <div style={mutedStyle}>Client: {selectedBooking.clientName}</div> : null}
          </div>

          <label style={fieldLabelStyle}>
            <span style={fieldTextStyle}><CalendarDays size={15} /> Shoot Date</span>
            <input type="date" value={detailDate} onChange={(event) => setDetailDate(event.target.value)} style={fieldInputStyle} />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={fieldLabelStyle}>
              <span style={fieldTextStyle}><Clock size={15} /> From</span>
              <input type="time" value={detailStartTime} onChange={(event) => setDetailStartTime(event.target.value)} style={fieldInputStyle} />
            </label>
            <label style={fieldLabelStyle}>
              <span style={fieldTextStyle}><Clock size={15} /> To</span>
              <input type="time" value={detailEndTime} onChange={(event) => setDetailEndTime(event.target.value)} style={fieldInputStyle} />
            </label>
          </div>

          <label style={fieldLabelStyle}>
            <span style={fieldTextStyle}><MapPin size={15} /> Location</span>
            <input value={detailLocation} onChange={(event) => setDetailLocation(event.target.value)} placeholder="Venue, gym, school, park..." style={fieldInputStyle} />
          </label>

          <label style={fieldLabelStyle}>
            <span style={fieldTextStyle}>Address</span>
            <textarea value={detailAddress} onChange={(event) => setDetailAddress(event.target.value)} placeholder="Street address, city, parking notes..." rows={3} style={{ ...fieldInputStyle, height: "auto", paddingTop: 10, resize: "vertical" }} />
          </label>

          <label style={fieldLabelStyle}>
            <span style={fieldTextStyle}><NotebookText size={15} /> Notes</span>
            <textarea value={detailNotes} onChange={(event) => setDetailNotes(event.target.value)} placeholder="Special instructions, contact person, reminders..." rows={3} style={{ ...fieldInputStyle, height: "auto", paddingTop: 10, resize: "vertical" }} />
          </label>

          <button type="button" onClick={saveDetails} disabled={savingDetails} style={primaryButtonStyle}>
            <Save size={16} /> {savingDetails ? "Saving..." : "Save Details"}
          </button>
          <Link href={selectedBooking.href} style={darkButtonStyle}>
            <ExternalLink size={16} /> Open {selectedBooking.kind === "school" ? "School" : "Event"}
          </Link>
          {selectedBooking.gallerySlug ? (
            <Link href={`/g/${selectedBooking.gallerySlug}`} style={lightButtonStyle}>Open Gallery</Link>
          ) : null}
          <button type="button" onClick={removeFromCalendar} disabled={savingDetails} style={dangerButtonStyle}>
            <Trash2 size={16} /> Remove from Calendar
          </button>
        </section>
      ) : null}

      <section style={panelStyle}>
        <h2 style={panelTitleStyle}><List size={17} /> Upcoming</h2>
        {upcoming.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {upcoming.map((item) => (
              <button key={`${bookingKey(item)}-upcoming`} type="button" onClick={() => jumpToBooking(item)} style={upcomingButtonStyle}>
                <span style={{ minWidth: 0, textAlign: "left" }}>
                  <span style={bookingTitleStyle}>{item.title}</span>
                  <span style={bookingMetaStyle}>{formatDate(item.date)} · {item.kind === "school" ? "School" : "Event"}</span>
                </span>
                <span>›</span>
              </button>
            ))}
          </div>
        ) : (
          <div style={mutedStyle}>No booked dates yet.</div>
        )}
      </section>

      <section style={panelStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={panelTitleStyle}><CalendarDays size={17} color="#cc0000" /> Apple Calendar</div>
          {feed ? <a href={feed.webcalUrl} style={smallDarkButtonStyle} aria-label="Open in Apple Calendar"><ExternalLink size={17} /></a> : null}
        </div>
        <button type="button" onClick={copyFeedUrl} disabled={!feed} style={lightButtonStyle}>
          <Copy size={17} /> Copy subscription link
        </button>
      </section>
    </div>
  );
}

const panelStyle: CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: 14,
  display: "grid",
  gap: 12,
};

const panelTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 950,
  color: "#111827",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const summaryStyle: CSSProperties = {
  background: "#111827",
  color: "#fff",
  borderRadius: 18,
  display: "grid",
  gap: 12,
  boxShadow: "0 12px 24px rgba(17,24,39,0.18)",
};

const summaryButtonStyle: CSSProperties = {
  width: "100%",
  minHeight: 82,
  padding: 16,
  border: "none",
  background: "transparent",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const calendarHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const iconButtonStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const smallIconButtonStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const segmentGroupStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 7,
  padding: 4,
  borderRadius: 14,
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
};

const twoSegmentGroupStyle: CSSProperties = {
  ...segmentGroupStyle,
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
};

const segmentStyle: CSSProperties = {
  minHeight: 40,
  borderRadius: 11,
  border: "none",
  background: "transparent",
  color: "#4b5563",
  fontWeight: 900,
};

const selectedSegmentStyle: CSSProperties = {
  ...segmentStyle,
  background: "#fff",
  color: "#cc0000",
  boxShadow: "0 1px 4px rgba(15,23,42,0.10)",
};

const monthGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
  gap: 5,
};

const weekdayStyle: CSSProperties = {
  textAlign: "center",
  fontSize: 11,
  color: "#6b7280",
  fontWeight: 950,
};

const dayCellStyle: CSSProperties = {
  minHeight: 54,
  borderRadius: 12,
  border: "1px solid #eef2f7",
  padding: 5,
  display: "grid",
  placeItems: "center",
  gap: 2,
};

const dayNumberStyle: CSSProperties = {
  width: 25,
  height: 25,
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 13,
  fontWeight: 950,
};

const dotStyle: CSSProperties = {
  minWidth: 18,
  height: 18,
  borderRadius: 999,
  background: "#fee2e2",
  color: "#cc0000",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  fontWeight: 950,
};

const weekDayStyle: CSSProperties = {
  minHeight: 72,
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  background: "#fff",
  color: "#111827",
  display: "grid",
  placeItems: "center",
  padding: 6,
};

const selectedWeekDayStyle: CSSProperties = {
  ...weekDayStyle,
  borderColor: "#cc0000",
  background: "#cc0000",
  color: "#fff",
};

const todayButtonStyle: CSSProperties = {
  minHeight: 34,
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  padding: "0 11px",
  fontSize: 12,
  fontWeight: 900,
};

const bookingButtonStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 14,
  padding: 11,
  display: "grid",
  gridTemplateColumns: "38px 1fr",
  alignItems: "center",
  gap: 10,
  color: "#111827",
};

const selectedBookingButtonStyle: CSSProperties = {
  ...bookingButtonStyle,
  borderColor: "#cc0000",
  background: "#fff7f7",
};

const bookingIconStyle: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 13,
  background: "#fef2f2",
  color: "#cc0000",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const bookingTitleStyle: CSSProperties = {
  display: "block",
  fontSize: 14,
  fontWeight: 950,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const bookingMetaStyle: CSSProperties = {
  display: "block",
  marginTop: 2,
  fontSize: 12,
  color: "#6b7280",
  fontWeight: 750,
};

const fieldLabelStyle: CSSProperties = {
  display: "grid",
  gap: 6,
};

const fieldTextStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 950,
  color: "#111827",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const fieldInputStyle: CSSProperties = {
  width: "100%",
  minHeight: 48,
  borderRadius: 13,
  border: "1px solid #d1d5db",
  padding: "0 12px",
  fontSize: 16,
  fontWeight: 750,
  color: "#111827",
  outline: "none",
  boxSizing: "border-box",
  background: "#fff",
};

const primaryButtonStyle: CSSProperties = {
  minHeight: 48,
  borderRadius: 14,
  border: "1px solid #cc0000",
  background: "#cc0000",
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  fontWeight: 950,
  textDecoration: "none",
};

const darkButtonStyle: CSSProperties = {
  ...primaryButtonStyle,
  borderColor: "#111827",
  background: "#111827",
};

const lightButtonStyle: CSSProperties = {
  minHeight: 46,
  borderRadius: 13,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  fontWeight: 900,
  textDecoration: "none",
};

const smallDarkButtonStyle: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 12,
  background: "#111827",
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const dangerButtonStyle: CSSProperties = {
  minHeight: 46,
  borderRadius: 13,
  border: "1px solid #fecaca",
  background: "#fff",
  color: "#991b1b",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  fontWeight: 950,
};

const darkBookingStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  borderRadius: 13,
  padding: 10,
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: 8,
};

const darkBookingTitleStyle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 950,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const darkBookingMetaStyle: CSSProperties = {
  display: "block",
  marginTop: 2,
  fontSize: 11,
  color: "#d1d5db",
  fontWeight: 800,
};

const upcomingButtonStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "#fff",
  borderRadius: 13,
  padding: 11,
  color: "#111827",
  display: "grid",
  gridTemplateColumns: "1fr auto",
  alignItems: "center",
  gap: 8,
};

const emptyStyle: CSSProperties = {
  padding: 14,
  borderRadius: 14,
  background: "#f9fafb",
  border: "1px solid #eef2f7",
  color: "#6b7280",
  fontSize: 13,
  fontWeight: 800,
  textAlign: "center",
};

const mutedStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: 13,
  fontWeight: 750,
};

const errorStyle: CSSProperties = {
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#991b1b",
  padding: 12,
  borderRadius: 13,
  fontSize: 13,
  fontWeight: 800,
};

const toastStyle: CSSProperties = {
  background: "#ecfdf5",
  border: "1px solid #bbf7d0",
  color: "#166534",
  padding: 10,
  borderRadius: 13,
  fontSize: 13,
  fontWeight: 800,
};
