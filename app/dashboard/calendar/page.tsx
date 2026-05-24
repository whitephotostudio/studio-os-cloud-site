"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  MapPin,
  NotebookText,
  Plus,
  Save,
  School,
  Sparkles,
} from "lucide-react";
import type { ScheduleItem } from "@/lib/schedule-calendar";

type CalendarFeed = {
  httpUrl: string;
  webcalUrl: string;
};

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

function formatLongDate(value: string): string {
  return parseDateOnly(value).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusLabel(value: string | null): string {
  const raw = clean(value).replaceAll("_", " ");
  if (!raw) return "No status";
  return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stripMeridiem(value: string): string {
  return value.replace(/\s*(AM|PM)\s*$/i, "").trim();
}

function normalizeTimeBase(value: string): string {
  const raw = stripMeridiem(value).trim();
  if (!raw) return "";
  const hourOnly = raw.match(/^(\d{1,2})$/);
  if (hourOnly) return `${hourOnly[1]}:00`;
  const hourMinute = raw.match(/^(\d{1,2}):(\d{0,2})$/);
  if (hourMinute) return `${hourMinute[1]}:${(hourMinute[2] || "00").padEnd(2, "0").slice(0, 2)}`;
  return raw;
}

function meridiemFor(value: string): "AM" | "PM" {
  return /\bPM\s*$/i.test(value) ? "PM" : "AM";
}

function withMeridiem(value: string, meridiem: "AM" | "PM"): string {
  const base = normalizeTimeBase(value);
  return base ? `${base} ${meridiem}` : "";
}

function withRawMeridiem(value: string, meridiem: "AM" | "PM"): string {
  const base = stripMeridiem(value);
  return base ? `${base} ${meridiem}` : "";
}

export default function DashboardCalendarPage() {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [cursor, setCursor] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => toDateOnly(new Date()));
  const [selectedBookingKey, setSelectedBookingKey] = useState("");
  const [detailStartTime, setDetailStartTime] = useState("");
  const [detailEndTime, setDetailEndTime] = useState("");
  const [detailDate, setDetailDate] = useState(selectedDate);
  const [detailLocation, setDetailLocation] = useState("");
  const [detailAddress, setDetailAddress] = useState("");
  const [detailNotes, setDetailNotes] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [creatingBooking, setCreatingBooking] = useState(false);
  const [quickKind, setQuickKind] = useState<"school" | "event">("event");
  const [quickTitle, setQuickTitle] = useState("");
  const [quickClient, setQuickClient] = useState("");
  const [monthSummaryOpen, setMonthSummaryOpen] = useState(false);

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
          window.location.href = "/sign-in?redirect=/dashboard/calendar";
          return;
        }
        if (!res.ok || payload.ok === false) {
          throw new Error(payload.message || "Failed to load schedule.");
        }
        setItems((payload.items ?? []) as ScheduleItem[]);
        setFeed((payload.feed ?? null) as CalendarFeed | null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load schedule.");
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
      map.set(item.date, existing);
    }
    return map;
  }, [items]);

  const upcoming = useMemo(() => {
    const today = toDateOnly(new Date());
    return items.filter((item) => item.date >= today).slice(0, 8);
  }, [items]);

  const monthBookings = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    return items.filter((item) => {
      const date = parseDateOnly(item.date);
      return date.getFullYear() === year && date.getMonth() === month;
    });
  }, [cursor, items]);

  const selectedItems = useMemo(
    () => itemsByDate.get(selectedDate) ?? [],
    [itemsByDate, selectedDate],
  );

  useEffect(() => {
    if (!selectedItems.length) {
      setSelectedBookingKey("");
      return;
    }
    const stillExists = selectedItems.some(
      (item) => `${item.kind}-${item.id}` === selectedBookingKey,
    );
    if (!stillExists) {
      const first = selectedItems[0];
      setSelectedBookingKey(`${first.kind}-${first.id}`);
    }
  }, [selectedBookingKey, selectedItems]);

  const selectedBooking = useMemo(
    () =>
      selectedItems.find((item) => `${item.kind}-${item.id}` === selectedBookingKey) ??
      selectedItems[0] ??
      null,
    [selectedBookingKey, selectedItems],
  );

  useEffect(() => {
    setDetailDate(selectedBooking?.date ?? selectedDate);
    setDetailStartTime(selectedBooking?.startTime ?? selectedBooking?.time ?? "");
    setDetailEndTime(selectedBooking?.endTime ?? "");
    setDetailLocation(selectedBooking?.location ?? "");
    setDetailAddress(selectedBooking?.address ?? "");
    setDetailNotes(selectedBooking?.notes ?? "");
  }, [selectedBooking, selectedDate]);

  const monthLabel = cursor.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  async function copyFeedUrl() {
    if (!feed?.webcalUrl) return;
    try {
      await navigator.clipboard.writeText(feed.webcalUrl);
      setToast("Apple Calendar link copied");
      window.setTimeout(() => setToast(""), 2200);
    } catch {
      setToast("Could not copy calendar link");
      window.setTimeout(() => setToast(""), 2200);
    }
  }

  function jumpToBooking(item: ScheduleItem) {
    const date = parseDateOnly(item.date);
    setCursor(new Date(date.getFullYear(), date.getMonth(), 1));
    setSelectedDate(item.date);
    setSelectedBookingKey(`${item.kind}-${item.id}`);
  }

  async function saveDetails() {
    if (!selectedBooking) return;
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
          date: detailDate,
          startTime: detailStartTime,
          endTime: detailEndTime,
          time: detailStartTime,
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
                startTime: detailStartTime.trim() || null,
                endTime: detailEndTime.trim() || null,
                time: detailStartTime.trim() || null,
                location: detailLocation.trim() || null,
                address: detailAddress.trim() || null,
                notes: detailNotes.trim() || null,
              }
            : item,
        ),
      );
      setSelectedDate(detailDate);
      setCursor(parseDateOnly(detailDate));
      setToast("Calendar details saved");
      window.setTimeout(() => setToast(""), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save calendar details.");
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
            : { title, clientName: clean(quickClient), eventDate: selectedDate },
        ),
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) {
        throw new Error(payload.message || "Failed to create booking.");
      }
      const createdId = quickKind === "school" ? payload.school?.id : payload.project?.id;
      const createdKey = createdId ? `${quickKind}-${createdId}` : "";
      const refreshed = await reloadCalendar();
      setQuickTitle("");
      setQuickClient("");
      setToast(`${quickKind === "school" ? "School" : "Event"} added to calendar`);
      window.setTimeout(() => setToast(""), 2200);
      if (createdKey) setSelectedBookingKey(createdKey);
      const created = refreshed.find((item) => `${item.kind}-${item.id}` === createdKey);
      if (created) jumpToBooking(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create booking.");
    } finally {
      setCreatingBooking(false);
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
          startTime: detailStartTime,
          endTime: detailEndTime,
          time: detailStartTime,
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
      setToast("Booking removed from calendar");
      window.setTimeout(() => setToast(""), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove date.");
    } finally {
      setSavingDetails(false);
    }
  }

  return (
    <main style={{ padding: "32px clamp(20px, 4vw, 52px)", background: "#f7f5f2", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 18 }}>
        <header
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 12, letterSpacing: "0.14em", fontWeight: 900, color: "#6b7280" }}>
              SCHEDULE
            </div>
            <h1 style={{ margin: "6px 0 0", fontSize: 38, lineHeight: 1.05, color: "#111827", fontWeight: 950 }}>
              Calendar
            </h1>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link
              href="/dashboard/projects/new"
              style={{
                minHeight: 42,
                padding: "0 14px",
                borderRadius: 12,
                background: "#cc0000",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontWeight: 900,
                textDecoration: "none",
              }}
            >
              <Plus size={17} /> New Event
            </Link>
            <Link
              href="/dashboard/schools"
              style={{
                minHeight: 42,
                padding: "0 14px",
                borderRadius: 12,
                border: "1px solid #d1d5db",
                background: "#fff",
                color: "#111827",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontWeight: 900,
                textDecoration: "none",
              }}
            >
              <School size={17} /> New School
            </Link>
            <button
              type="button"
              onClick={copyFeedUrl}
              disabled={!feed}
              style={{
                minHeight: 42,
                padding: "0 14px",
                borderRadius: 12,
                border: "1px solid #d1d5db",
                background: "#fff",
                color: "#111827",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontWeight: 900,
                cursor: feed ? "pointer" : "default",
              }}
            >
              <Copy size={17} /> Copy Apple Calendar Link
            </button>
            {feed ? (
              <a
                href={feed.webcalUrl}
                style={{
                  minHeight: 42,
                  padding: "0 14px",
                  borderRadius: 12,
                  background: "#111827",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 900,
                  textDecoration: "none",
                }}
              >
                <ExternalLink size={17} /> Open in Apple Calendar
              </a>
            ) : null}
          </div>
        </header>

        {toast ? (
          <div style={{ color: "#166534", fontSize: 13, fontWeight: 800 }}>{toast}</div>
        ) : null}

        {error ? (
          <div style={{ padding: 14, borderRadius: 12, border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontWeight: 800 }}>
            {error}
          </div>
        ) : null}

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 340px",
            gap: 18,
            alignItems: "start",
          }}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 18,
              overflow: "hidden",
              boxShadow: "0 16px 42px rgba(15,23,42,0.06)",
            }}
          >
            <div
              style={{
                padding: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                borderBottom: "1px solid #eef2f7",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <CalendarDays size={22} color="#cc0000" />
                <h2 style={{ margin: 0, fontSize: 22, color: "#111827" }}>{monthLabel}</h2>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                  style={iconButtonStyle}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const today = new Date();
                    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
                  }}
                  style={{ ...iconButtonStyle, width: "auto", padding: "0 12px", fontWeight: 900 }}
                >
                  Today
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                  style={iconButtonStyle}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", borderBottom: "1px solid #eef2f7" }}>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} style={{ padding: "10px 12px", fontSize: 12, fontWeight: 900, color: "#6b7280" }}>
                  {day}
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
              {monthCells.map((date) => {
                const dateOnly = toDateOnly(date);
                const dayItems = itemsByDate.get(dateOnly) ?? [];
                const inMonth = date.getMonth() === cursor.getMonth();
                const isToday = dateOnly === toDateOnly(new Date());
                const isSelected = dateOnly === selectedDate;
                return (
                  <button
                    type="button"
                    key={dateOnly}
                    onClick={() => setSelectedDate(dateOnly)}
                    style={{
                      minHeight: 118,
                      padding: 10,
                      textAlign: "left",
                      borderRight: "1px solid #eef2f7",
                      borderBottom: "1px solid #eef2f7",
                      borderTop: isSelected ? "2px solid #cc0000" : "0",
                      background: isSelected ? "#fff7f7" : inMonth ? "#fff" : "#f9fafb",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: isToday ? "#cc0000" : "transparent",
                        color: isToday ? "#fff" : inMonth ? "#111827" : "#9ca3af",
                        fontSize: 13,
                        fontWeight: 900,
                      }}
                    >
                      {date.getDate()}
                    </div>
                    <div style={{ marginTop: 8, display: "grid", gap: 5 }}>
                      {dayItems.slice(0, 3).map((item) => (
                        <div
                          key={`${item.kind}-${item.id}`}
                          style={{
                            borderRadius: 8,
                            padding: "6px 7px",
                            background: item.kind === "school" ? "#fff7ed" : "#fef2f2",
                            color: "#111827",
                            border: item.kind === "school" ? "1px solid #fed7aa" : "1px solid #fecaca",
                            fontSize: 12,
                            fontWeight: 850,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.kind === "school" ? "School" : "Event"} · {item.title}
                        </div>
                      ))}
                      {dayItems.length > 3 ? (
                        <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
                          +{dayItems.length - 3} more
                        </div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <aside style={{ display: "grid", gap: 14 }}>
            <div style={monthSummaryStyle}>
              <button
                type="button"
                onClick={() => monthBookings.length ? setMonthSummaryOpen((value) => !value) : undefined}
                style={monthSummaryButtonStyle}
              >
                <CalendarDays size={26} color="#fff" />
                <span style={{ display: "grid", textAlign: "left" }}>
                  <span style={{ color: "#fff", fontSize: 28, fontWeight: 950, lineHeight: 1 }}>
                    {monthBookings.length}
                  </span>
                  <span style={{ color: "#d1d5db", fontSize: 13, fontWeight: 900 }}>This month</span>
                </span>
                <span style={{ marginLeft: "auto", color: monthBookings.length ? "#e5e7eb" : "rgba(255,255,255,0.35)", fontSize: 18 }}>
                  {monthSummaryOpen ? "⌃" : "⌄"}
                </span>
              </button>
              {monthSummaryOpen && monthBookings.length ? (
                <div style={{ display: "grid", gap: 6, padding: "0 12px 12px" }}>
                  {monthBookings.map((item) => (
                    <button
                      key={`${item.kind}-${item.id}-month`}
                      type="button"
                      onClick={() => jumpToBooking(item)}
                      style={compactDarkBookingStyle}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span style={compactDarkTitleStyle}>{item.title}</span>
                        <span style={compactDarkMetaStyle}>{formatLongDate(item.date)}</span>
                      </span>
                      <span style={{ color: "#d1d5db" }}>›</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={panelStyle}>
              <h2 style={panelTitleStyle}>{formatLongDate(selectedDate)}</h2>
              {selectedItems.length ? (
                <div style={{ display: "grid", gap: 12 }}>
                  {selectedItems.length > 1 ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      {selectedItems.map((item) => {
                        const active = `${item.kind}-${item.id}` === `${selectedBooking?.kind}-${selectedBooking?.id}`;
                        return (
                          <button
                            key={`${item.kind}-${item.id}`}
                            type="button"
                            onClick={() => setSelectedBookingKey(`${item.kind}-${item.id}`)}
                            style={{
                              border: active ? "1px solid #cc0000" : "1px solid #e5e7eb",
                              background: active ? "#fff7f7" : "#fff",
                              borderRadius: 12,
                              padding: 10,
                              textAlign: "left",
                              cursor: "pointer",
                              color: "#111827",
                              fontWeight: 900,
                            }}
                          >
                            {item.kind === "school" ? "School" : "Event"} · {item.title}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {selectedBooking ? (
                    <div style={{ display: "grid", gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 12, color: "#cc0000", fontWeight: 900, marginBottom: 4 }}>
                          {selectedBooking.kind === "school" ? "School" : "Event"} · {statusLabel(selectedBooking.status)}
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 950, color: "#111827", lineHeight: 1.15 }}>
                          {selectedBooking.title}
                        </div>
                        {selectedBooking.clientName ? (
                          <div style={{ marginTop: 4, fontSize: 13, color: "#6b7280", fontWeight: 750 }}>
                            Client: {selectedBooking.clientName}
                          </div>
                        ) : null}
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <label style={fieldLabelStyle}>
                          <span style={fieldTextStyle}><CalendarDays size={15} /> Shoot Date</span>
                          <input
                            type="date"
                            value={detailDate}
                            onChange={(event) => setDetailDate(event.target.value)}
                            style={fieldInputStyle}
                          />
                        </label>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <label style={fieldLabelStyle}>
                          <span style={fieldTextStyle}><Clock size={15} /> From</span>
                          <span style={timeInputWrapStyle}>
                            <input
                              value={stripMeridiem(detailStartTime)}
                              onChange={(event) =>
                                setDetailStartTime(withRawMeridiem(event.target.value, meridiemFor(detailStartTime)))
                              }
                              onBlur={() => setDetailStartTime(withMeridiem(detailStartTime, meridiemFor(detailStartTime)))}
                              placeholder="9:00"
                              style={timeTextInputStyle}
                            />
                            <select
                              value={meridiemFor(detailStartTime)}
                              onChange={(event) =>
                                setDetailStartTime(withMeridiem(detailStartTime, event.target.value as "AM" | "PM"))
                              }
                              style={meridiemSelectStyle}
                            >
                              <option value="AM">AM</option>
                              <option value="PM">PM</option>
                            </select>
                          </span>
                        </label>
                        <label style={fieldLabelStyle}>
                          <span style={fieldTextStyle}><Clock size={15} /> To</span>
                          <span style={timeInputWrapStyle}>
                            <input
                              value={stripMeridiem(detailEndTime)}
                              onChange={(event) =>
                                setDetailEndTime(withRawMeridiem(event.target.value, meridiemFor(detailEndTime)))
                              }
                              onBlur={() => setDetailEndTime(withMeridiem(detailEndTime, meridiemFor(detailEndTime)))}
                              placeholder="11:00"
                              style={timeTextInputStyle}
                            />
                            <select
                              value={meridiemFor(detailEndTime)}
                              onChange={(event) =>
                                setDetailEndTime(withMeridiem(detailEndTime, event.target.value as "AM" | "PM"))
                              }
                              style={meridiemSelectStyle}
                            >
                              <option value="AM">AM</option>
                              <option value="PM">PM</option>
                            </select>
                          </span>
                        </label>
                      </div>

                      <label style={fieldLabelStyle}>
                        <span style={fieldTextStyle}><MapPin size={15} /> Location</span>
                        <input
                          value={detailLocation}
                          onChange={(event) => setDetailLocation(event.target.value)}
                          placeholder="Venue, gym, school, park..."
                          style={fieldInputStyle}
                        />
                      </label>

                      <label style={fieldLabelStyle}>
                        <span style={fieldTextStyle}>Address</span>
                        <textarea
                          value={detailAddress}
                          onChange={(event) => setDetailAddress(event.target.value)}
                          placeholder="Street address, city, parking notes..."
                          rows={3}
                          style={{ ...fieldInputStyle, height: "auto", paddingTop: 10, resize: "vertical" }}
                        />
                      </label>

                      <label style={fieldLabelStyle}>
                        <span style={fieldTextStyle}><NotebookText size={15} /> Notes</span>
                        <textarea
                          value={detailNotes}
                          onChange={(event) => setDetailNotes(event.target.value)}
                          placeholder="Special instructions, contact person, reminders..."
                          rows={3}
                          style={{ ...fieldInputStyle, height: "auto", paddingTop: 10, resize: "vertical" }}
                        />
                      </label>

                      <div style={{ display: "grid", gap: 8 }}>
                        <button
                          type="button"
                          onClick={saveDetails}
                          disabled={savingDetails}
                          style={{
                            minHeight: 42,
                            borderRadius: 12,
                            border: "1px solid #cc0000",
                            background: "#cc0000",
                            color: "#fff",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 8,
                            fontWeight: 900,
                            cursor: savingDetails ? "default" : "pointer",
                          }}
                        >
                          <Save size={16} /> {savingDetails ? "Saving..." : "Save Details"}
                        </button>
                        <Link href={selectedBooking.href} style={darkButtonStyle}>
                          <ExternalLink size={16} /> Open {selectedBooking.kind === "school" ? "School" : "Event"}
                        </Link>
                        {selectedBooking.gallerySlug ? (
                          <Link href={`/g/${selectedBooking.gallerySlug}`} style={lightButtonStyle}>
                            Open Gallery
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          onClick={removeFromCalendar}
                          disabled={savingDetails}
                          style={dangerButtonStyle}
                        >
                          Remove from Calendar
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div style={mutedStyle}>No booking on this date yet.</div>
              )}
            </div>

            <div style={compactPanelStyle}>
              <h2 style={compactPanelTitleStyle}>Add to {formatLongDate(selectedDate)}</h2>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setQuickKind("event")}
                    style={quickKind === "event" ? selectedSegmentStyle : segmentStyle}
                  >
                    Event
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuickKind("school")}
                    style={quickKind === "school" ? selectedSegmentStyle : segmentStyle}
                  >
                    School
                  </button>
                </div>
                <input
                  value={quickTitle}
                  onChange={(event) => setQuickTitle(event.target.value)}
                  placeholder={quickKind === "school" ? "School name" : "Event name"}
                  style={fieldInputStyle}
                />
                {quickKind === "event" ? (
                  <input
                    value={quickClient}
                    onChange={(event) => setQuickClient(event.target.value)}
                    placeholder="Client name"
                    style={fieldInputStyle}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={createBooking}
                  disabled={creatingBooking}
                  style={{
                    minHeight: 42,
                    borderRadius: 12,
                    border: "1px solid #111827",
                    background: "#111827",
                    color: "#fff",
                    fontWeight: 900,
                    cursor: creatingBooking ? "default" : "pointer",
                  }}
                >
                  {creatingBooking ? "Adding..." : `Add ${quickKind === "school" ? "School" : "Event"}`}
                </button>
              </div>
            </div>

            <div style={compactPanelStyle}>
              <h2 style={compactPanelTitleStyle}>Upcoming</h2>
              {loading ? (
                <div style={mutedStyle}>Loading schedule...</div>
              ) : upcoming.length ? (
                <div style={{ display: "grid", gap: 6 }}>
                  {upcoming.slice(0, 3).map((item) => {
                    const Icon = item.kind === "school" ? School : Sparkles;
                    return (
                      <button
                        key={`${item.kind}-${item.id}`}
                        type="button"
                        onClick={() => jumpToBooking(item)}
                        style={compactBookingStyle}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 900, color: "#cc0000" }}>
                          <Icon size={16} /> {formatLongDate(item.date)}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                        <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 750 }}>
                          {item.kind === "school" ? "School" : "Event"} · {statusLabel(item.status)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div style={mutedStyle}>No upcoming bookings with dates yet.</div>
              )}
            </div>

            <div style={panelStyle}>
              <h2 style={panelTitleStyle}>Apple Devices</h2>
              <p style={{ ...mutedStyle, margin: 0 }}>
                Subscribe once with Apple Calendar and these booked dates can show on iPhone, Mac, and iPad through iCloud.
              </p>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

const iconButtonStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const panelStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: 16,
  boxShadow: "0 16px 42px rgba(15,23,42,0.06)",
};

const monthSummaryStyle: React.CSSProperties = {
  background: "#111827",
  borderRadius: 18,
  overflow: "hidden",
  boxShadow: "0 16px 42px rgba(15,23,42,0.06)",
};

const monthSummaryButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 88,
  border: 0,
  background: "transparent",
  padding: 16,
  color: "#fff",
  display: "flex",
  alignItems: "center",
  gap: 12,
  cursor: "pointer",
};

const compactDarkBookingStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  borderRadius: 12,
  padding: "9px 10px",
  display: "flex",
  alignItems: "center",
  gap: 8,
  cursor: "pointer",
  textAlign: "left",
};

const compactDarkTitleStyle: React.CSSProperties = {
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 900,
};

const compactDarkMetaStyle: React.CSSProperties = {
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#d1d5db",
  fontSize: 11,
  fontWeight: 750,
};

const compactPanelStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: 14,
  boxShadow: "0 16px 42px rgba(15,23,42,0.06)",
};

const compactPanelTitleStyle: React.CSSProperties = {
  margin: "0 0 8px",
  fontSize: 16,
  color: "#111827",
};

const compactBookingStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  color: "#111827",
  borderRadius: 12,
  padding: "9px 10px",
  display: "grid",
  gap: 3,
  cursor: "pointer",
  textAlign: "left",
};

const panelTitleStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 18,
  color: "#111827",
};

const mutedStyle: React.CSSProperties = {
  color: "#6b7280",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.5,
};

const fieldLabelStyle: React.CSSProperties = {
  display: "grid",
  gap: 7,
  fontSize: 13,
  color: "#374151",
  fontWeight: 850,
};

const fieldTextStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const fieldInputStyle: React.CSSProperties = {
  width: "100%",
  height: 42,
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  padding: "0 12px",
  fontSize: 14,
  fontWeight: 700,
  boxSizing: "border-box",
  outline: "none",
};

const timeInputWrapStyle: React.CSSProperties = {
  height: 42,
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#fff",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 72px",
  overflow: "hidden",
};

const timeTextInputStyle: React.CSSProperties = {
  minWidth: 0,
  border: 0,
  outline: "none",
  padding: "0 12px",
  color: "#111827",
  fontSize: 14,
  fontWeight: 800,
};

const meridiemSelectStyle: React.CSSProperties = {
  border: 0,
  borderLeft: "1px solid #e5e7eb",
  background: "#f9fafb",
  color: "#111827",
  fontSize: 13,
  fontWeight: 900,
  padding: "0 8px",
  outline: "none",
};

const darkButtonStyle: React.CSSProperties = {
  minHeight: 42,
  borderRadius: 12,
  background: "#111827",
  color: "#fff",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  fontWeight: 900,
  textDecoration: "none",
};

const lightButtonStyle: React.CSSProperties = {
  minHeight: 42,
  borderRadius: 12,
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

const dangerButtonStyle: React.CSSProperties = {
  minHeight: 42,
  borderRadius: 12,
  border: "1px solid #fecaca",
  background: "#fff",
  color: "#991b1b",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  fontWeight: 900,
  cursor: "pointer",
};

const segmentStyle: React.CSSProperties = {
  minHeight: 38,
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#374151",
  fontWeight: 900,
  cursor: "pointer",
};

const selectedSegmentStyle: React.CSSProperties = {
  ...segmentStyle,
  border: "1px solid #cc0000",
  background: "#fff7f7",
  color: "#991b1b",
};
