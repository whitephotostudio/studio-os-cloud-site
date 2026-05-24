"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Copy, ExternalLink, Plus, Save } from "lucide-react";
import type { ScheduleItem } from "@/lib/schedule-calendar";

type Feed = { webcalUrl: string; httpUrl: string };
type Mode = "event" | "school";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string) {
  return parseDateOnly(value).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function statusLabel(value: string | null) {
  const raw = clean(value).replaceAll("_", " ");
  return raw ? raw.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "No status";
}

function keyFor(item: ScheduleItem) {
  return `${item.kind}-${item.id}`;
}

export default function DashboardCalendarPage() {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => toDateOnly(new Date()));
  const [selectedKey, setSelectedKey] = useState("");
  const [mode, setMode] = useState<Mode>("event");
  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [detailDate, setDetailDate] = useState(selectedDate);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadCalendar() {
    const res = await fetch("/api/dashboard/calendar", { credentials: "include" });
    const payload = await res.json();
    if (res.status === 401) {
      window.location.href = "/sign-in?redirect=/dashboard/calendar";
      return [];
    }
    if (!res.ok || payload.ok === false) throw new Error(payload.message || "Failed to load calendar.");
    const nextItems = (payload.items ?? []) as ScheduleItem[];
    setItems(nextItems);
    setFeed((payload.feed ?? null) as Feed | null);
    return nextItems;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadCalendar()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load calendar.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
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

  const byDate = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    for (const item of items) map.set(item.date, [...(map.get(item.date) ?? []), item]);
    return map;
  }, [items]);

  const selectedItems = byDate.get(selectedDate) ?? [];
  const selected = selectedItems.find((item) => keyFor(item) === selectedKey) ?? selectedItems[0] ?? null;
  const monthItems = items.filter((item) => {
    const date = parseDateOnly(item.date);
    return date.getFullYear() === cursor.getFullYear() && date.getMonth() === cursor.getMonth();
  });
  const upcoming = items.filter((item) => item.date >= toDateOnly(new Date())).slice(0, 6);

  useEffect(() => {
    if (!selected) return;
    setSelectedKey(keyFor(selected));
    setDetailDate(selected.date);
    setStartTime(selected.startTime ?? selected.time ?? "");
    setEndTime(selected.endTime ?? "");
    setLocation(selected.location ?? "");
    setAddress(selected.address ?? "");
    setNotes(selected.notes ?? "");
  }, [selected?.id, selected?.kind]);

  function jumpTo(item: ScheduleItem) {
    const date = parseDateOnly(item.date);
    setCursor(new Date(date.getFullYear(), date.getMonth(), 1));
    setSelectedDate(item.date);
    setSelectedKey(keyFor(item));
  }

  async function copyFeed() {
    if (!feed?.webcalUrl) return;
    await navigator.clipboard.writeText(feed.webcalUrl);
    setMessage("Apple Calendar link copied.");
  }

  async function createBooking() {
    const bookingTitle = clean(title);
    if (!bookingTitle) return setError(mode === "school" ? "School name is required." : "Event name is required.");
    setSaving(true);
    setError("");
    try {
      const res = await fetch(mode === "school" ? "/api/dashboard/schools" : "/api/dashboard/events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "school"
            ? { school_name: bookingTitle, shoot_date: selectedDate }
            : { title: bookingTitle, clientName: clean(client), eventDate: selectedDate },
        ),
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) throw new Error(payload.message || "Failed to create booking.");
      const createdId = mode === "school" ? payload.school?.id : payload.project?.id;
      const refreshed = await loadCalendar();
      const created = refreshed.find((item) => item.kind === mode && item.id === createdId);
      setTitle("");
      setClient("");
      setMessage(`${mode === "school" ? "School" : "Event"} added to calendar.`);
      if (created) jumpTo(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create booking.");
    } finally {
      setSaving(false);
    }
  }

  async function saveDetails() {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/dashboard/calendar/details", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: selected.kind,
          id: selected.id,
          date: detailDate,
          startTime,
          endTime,
          time: startTime,
          location,
          address,
          notes,
        }),
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) throw new Error(payload.message || "Failed to save details.");
      await loadCalendar();
      setSelectedDate(detailDate);
      setCursor(parseDateOnly(detailDate));
      setMessage("Calendar details saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save details.");
    } finally {
      setSaving(false);
    }
  }

  async function removeDate() {
    if (!selected) return;
    if (!window.confirm(`Remove ${selected.title} from the calendar?`)) return;
    setSaving(true);
    try {
      const res = await fetch("/api/dashboard/calendar/details", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: selected.kind, id: selected.id, date: null, startTime, endTime, time: startTime, location, address, notes }),
      });
      const payload = await res.json();
      if (!res.ok || payload.ok === false) throw new Error(payload.message || "Failed to remove date.");
      await loadCalendar();
      setSelectedKey("");
      setMessage("Booking removed from calendar.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove date.");
    } finally {
      setSaving(false);
    }
  }

  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <main className="min-h-screen bg-[#f7f5f2] px-6 py-8 text-[#111827]">
      <div className="mx-auto grid max-w-[1320px] gap-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.14em] text-gray-500">Schedule</div>
            <h1 className="mt-1 text-4xl font-black">Calendar</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#cc0000] px-4 font-black text-white" href="/dashboard/projects/new"><Plus size={17} /> New Event</Link>
            <Link className="inline-flex h-11 items-center gap-2 rounded-xl border bg-white px-4 font-black" href="/dashboard/schools">New School</Link>
            <button className="inline-flex h-11 items-center gap-2 rounded-xl border bg-white px-4 font-black disabled:opacity-50" disabled={!feed} onClick={copyFeed}><Copy size={17} /> Copy Apple Link</button>
            {feed ? <a className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#111827] px-4 font-black text-white" href={feed.webcalUrl}><ExternalLink size={17} /> Apple Calendar</a> : null}
          </div>
        </header>

        {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 font-bold text-red-800">{error}</div> : null}
        {message ? <div className="rounded-xl border border-green-200 bg-green-50 p-3 font-bold text-green-800">{message}</div> : null}

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b p-4">
              <h2 className="flex items-center gap-2 text-2xl font-black"><CalendarDays className="text-[#cc0000]" /> {monthLabel}</h2>
              <div className="flex gap-2">
                <button className="rounded-xl border p-3" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
                <button className="rounded-xl border p-3" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
              </div>
            </div>
            <div className="grid grid-cols-7 border-b text-sm font-black text-gray-500">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="p-3">{day}</div>)}
            </div>
            <div className="grid grid-cols-7">
              {monthCells.map((date) => {
                const dateOnly = toDateOnly(date);
                const dayItems = byDate.get(dateOnly) ?? [];
                const inMonth = date.getMonth() === cursor.getMonth();
                const selectedDay = dateOnly === selectedDate;
                return (
                  <button key={dateOnly} onClick={() => setSelectedDate(dateOnly)} className={`min-h-[118px] border-r border-b p-3 text-left ${selectedDay ? "bg-red-50 ring-2 ring-inset ring-[#cc0000]" : inMonth ? "bg-white" : "bg-gray-50 text-gray-400"}`}>
                    <div className="font-black">{date.getDate()}</div>
                    <div className="mt-2 grid gap-1">
                      {dayItems.slice(0, 3).map((item) => <span key={keyFor(item)} className="truncate rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-black text-[#991b1b]">{item.title}</span>)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="grid content-start gap-4">
            <section className="rounded-2xl bg-[#111827] p-5 text-white">
              <button className="w-full text-left" onClick={() => monthItems[0] && jumpTo(monthItems[0])}>
                <div className="text-4xl font-black">{monthItems.length}</div>
                <div className="font-black text-gray-300">This month</div>
              </button>
              <div className="mt-4 grid gap-2">
                {monthItems.slice(0, 4).map((item) => <button key={keyFor(item)} className="rounded-xl border border-white/10 bg-white/10 p-3 text-left" onClick={() => jumpTo(item)}><div className="font-black">{item.title}</div><div className="text-xs font-bold text-gray-300">{formatDate(item.date)}</div></button>)}
              </div>
            </section>

            <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="text-xl font-black">Add to {formatDate(selectedDate)}</h2>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button className={`rounded-xl border p-3 font-black ${mode === "event" ? "border-[#cc0000] bg-red-50 text-[#991b1b]" : ""}`} onClick={() => setMode("event")}>Event</button>
                <button className={`rounded-xl border p-3 font-black ${mode === "school" ? "border-[#cc0000] bg-red-50 text-[#991b1b]" : ""}`} onClick={() => setMode("school")}>School</button>
              </div>
              <input className="mt-3 h-12 w-full rounded-xl border px-3 font-bold" placeholder={mode === "school" ? "School name" : "Event name"} value={title} onChange={(event) => setTitle(event.target.value)} />
              {mode === "event" ? <input className="mt-3 h-12 w-full rounded-xl border px-3 font-bold" placeholder="Client name" value={client} onChange={(event) => setClient(event.target.value)} /> : null}
              <button className="mt-3 h-12 w-full rounded-xl bg-[#111827] font-black text-white disabled:opacity-50" disabled={saving} onClick={createBooking}>Add {mode === "school" ? "School" : "Event"}</button>
            </section>

            <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="text-xl font-black">{formatDate(selectedDate)}</h2>
              {loading ? <p className="mt-3 font-bold text-gray-500">Loading calendar...</p> : selectedItems.length ? <div className="mt-3 grid gap-2">{selectedItems.map((item) => <button key={keyFor(item)} className={`rounded-xl border p-3 text-left ${keyFor(item) === keyFor(selected ?? item) ? "border-[#cc0000] bg-red-50" : ""}`} onClick={() => setSelectedKey(keyFor(item))}><div className="font-black">{item.title}</div><div className="text-xs font-bold text-gray-500">{item.kind === "school" ? "School" : "Event"} · {statusLabel(item.status)}</div></button>)}</div> : <p className="mt-3 font-bold text-gray-500">No booking on this date yet.</p>}
            </section>

            {selected ? <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="text-xs font-black uppercase text-[#cc0000]">{selected.kind} · {statusLabel(selected.status)}</div>
              <h2 className="mt-1 text-2xl font-black">{selected.title}</h2>
              {selected.clientName ? <div className="font-bold text-gray-500">Client: {selected.clientName}</div> : null}
              <div className="mt-4 grid gap-3">
                <input type="date" className="h-12 rounded-xl border px-3 font-bold" value={detailDate} onChange={(event) => setDetailDate(event.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                  <input className="h-12 rounded-xl border px-3 font-bold" placeholder="From, 9:00 AM" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
                  <input className="h-12 rounded-xl border px-3 font-bold" placeholder="To, 11:00 AM" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
                </div>
                <input className="h-12 rounded-xl border px-3 font-bold" placeholder="Location" value={location} onChange={(event) => setLocation(event.target.value)} />
                <textarea className="min-h-24 rounded-xl border p-3 font-bold" placeholder="Address" value={address} onChange={(event) => setAddress(event.target.value)} />
                <textarea className="min-h-24 rounded-xl border p-3 font-bold" placeholder="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
                <button className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#cc0000] font-black text-white disabled:opacity-50" disabled={saving} onClick={saveDetails}><Save size={17} /> Save Details</button>
                <Link className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#111827] font-black text-white" href={selected.href}><ExternalLink size={17} /> Open {selected.kind === "school" ? "School" : "Event"}</Link>
                {selected.gallerySlug ? <Link className="inline-flex h-12 items-center justify-center rounded-xl border font-black" href={`/g/${selected.gallerySlug}`}>Open Gallery</Link> : null}
                <button className="h-12 rounded-xl border border-red-200 font-black text-red-800 disabled:opacity-50" disabled={saving} onClick={removeDate}>Remove from Calendar</button>
              </div>
            </section> : null}

            <section className="rounded-2xl border bg-white p-5 shadow-sm">
              <h2 className="text-xl font-black">Upcoming</h2>
              <div className="mt-3 grid gap-2">
                {upcoming.length ? upcoming.map((item) => <button key={keyFor(item)} className="rounded-xl border p-3 text-left" onClick={() => jumpTo(item)}><div className="font-black">{item.title}</div><div className="text-xs font-bold text-gray-500">{formatDate(item.date)}</div></button>) : <p className="font-bold text-gray-500">No booked dates yet.</p>}
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
