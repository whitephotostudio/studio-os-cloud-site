"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, GraduationCap, Lock, PartyPopper, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Mode = "event" | "school";
type Status = "active" | "inactive" | "pre_release" | "closed";

const statuses: { value: Status; label: string; note: string }[] = [
  { value: "active", label: "Active", note: "Live and viewable" },
  { value: "inactive", label: "Inactive", note: "Hidden for now" },
  { value: "pre_release", label: "Pre-Released", note: "Collect emails first" },
  { value: "closed", label: "Closed", note: "Visible, ordering closed" },
];

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

export default function MobileNewPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [mode, setMode] = useState<Mode>("event");
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<Status>("pre_release");
  const [accessMode, setAccessMode] = useState<"public" | "pin">("public");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isEvent = mode === "event";

  async function authHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    const title = clean(name);
    if (!title) {
      setError(isEvent ? "Event name is required." : "School name is required.");
      return;
    }
    if (accessMode === "pin" && !clean(pin)) {
      setError("Enter a PIN first.");
      return;
    }

    setSaving(true);
    try {
      const headers = await authHeaders();
      if (isEvent) {
        const res = await fetch("/api/dashboard/events", {
          method: "POST",
          headers,
          body: JSON.stringify({
            title,
            clientName: clean(clientName) || null,
            eventDate,
            galleryStatus: status,
            accessMode,
            accessPin: accessMode === "pin" ? clean(pin) : null,
          }),
        });
        const payload = await res.json();
        if (res.status === 401) {
          router.push("/sign-in?redirect=/m/new");
          return;
        }
        if (!res.ok || payload.ok === false) {
          setError(payload.message || "Failed to create event.");
          setSaving(false);
          return;
        }
        router.push(payload.project?.id ? `/m/events/${payload.project.id}` : "/m/events");
        return;
      }

      const res = await fetch("/api/dashboard/schools", {
        method: "POST",
        headers,
        body: JSON.stringify({ school_name: title }),
      });
      const payload = await res.json();
      if (res.status === 401) {
        router.push("/sign-in?redirect=/m/new");
        return;
      }
      if (!res.ok || payload.ok === false) {
        setError(payload.message || "Failed to create school.");
        setSaving(false);
        return;
      }
      router.push(payload.school?.id ? `/m/schools/${payload.school.id}` : "/m/schools");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
      <header style={{ display: "grid", gap: 5 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", fontWeight: 900, color: "#6b7280" }}>
          CREATE
        </div>
        <h1 style={{ margin: 0, fontSize: 25, fontWeight: 950, color: "#111827" }}>
          New gallery
        </h1>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 4, borderRadius: 16, background: "#f3f4f6", border: "1px solid #e5e7eb" }}>
        {[
          { value: "event" as const, label: "Event", icon: PartyPopper },
          { value: "school" as const, label: "School", icon: GraduationCap },
        ].map((item) => {
          const Icon = item.icon;
          const active = mode === item.value;
          return (
            <button key={item.value} type="button" onClick={() => setMode(item.value)} style={{ minHeight: 48, borderRadius: 12, border: "none", background: active ? "#111827" : "transparent", color: active ? "#fff" : "#4b5563", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 900, fontSize: 14 }}>
              <Icon size={17} /> {item.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "11px 12px", borderRadius: 12, fontSize: 13, fontWeight: 800 }}>
          {error}
        </div>
      ) : null}

      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 14, display: "grid", gap: 14, boxShadow: "0 4px 12px rgba(15,23,42,0.05)" }}>
        <label style={{ display: "grid", gap: 7, fontSize: 12, fontWeight: 900, color: "#111827" }}>
          {isEvent ? "Event name" : "School name"}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={isEvent ? "Smith Wedding" : "Northview School"} autoComplete="off" style={{ width: "100%", minHeight: 50, borderRadius: 13, border: "1px solid #d1d5db", padding: "0 13px", fontSize: 16, fontWeight: 750, color: "#111827", outline: "none", boxSizing: "border-box" }} />
        </label>

        {isEvent ? (
          <>
            <label style={{ display: "grid", gap: 7, fontSize: 12, fontWeight: 900, color: "#111827" }}>
              Client name
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client name" autoComplete="name" style={{ width: "100%", minHeight: 50, borderRadius: 13, border: "1px solid #d1d5db", padding: "0 13px", fontSize: 16, fontWeight: 750, color: "#111827", outline: "none", boxSizing: "border-box" }} />
            </label>
            <label style={{ display: "grid", gap: 7, fontSize: 12, fontWeight: 900, color: "#111827" }}>
              Event date
              <span style={{ position: "relative" }}>
                <CalendarDays size={17} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#6b7280", pointerEvents: "none" }} />
                <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} style={{ width: "100%", minHeight: 50, borderRadius: 13, border: "1px solid #d1d5db", padding: "0 13px 0 42px", fontSize: 16, fontWeight: 750, color: "#111827", outline: "none", boxSizing: "border-box" }} />
              </span>
            </label>
          </>
        ) : null}
      </section>

      <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 14, display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: "#111827" }}>Status</div>
        <div style={{ display: "grid", gap: 8 }}>
          {statuses.map((item) => {
            const active = status === item.value;
            return (
              <button key={item.value} type="button" onClick={() => setStatus(item.value)} style={{ borderRadius: 13, border: active ? "2px solid #111827" : "1px solid #e5e7eb", background: active ? "#f3f4f6" : "#fff", padding: "12px 13px", textAlign: "left" }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 900, color: "#111827" }}>{item.label}</span>
                <span style={{ display: "block", marginTop: 2, fontSize: 12, fontWeight: 700, color: "#6b7280" }}>{item.note}</span>
              </button>
            );
          })}
        </div>
      </section>

      {isEvent ? (
        <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 14, display: "grid", gap: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#111827" }}>Gallery access</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { value: "public" as const, label: "Public", icon: ShieldCheck },
              { value: "pin" as const, label: "PIN", icon: Lock },
            ].map((item) => {
              const Icon = item.icon;
              const active = accessMode === item.value;
              return (
                <button key={item.value} type="button" onClick={() => setAccessMode(item.value)} style={{ minHeight: 58, borderRadius: 13, border: active ? "2px solid #111827" : "1px solid #e5e7eb", background: active ? "#f3f4f6" : "#fff", color: "#111827", fontWeight: 900, fontSize: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Icon size={17} /> {item.label}
                </button>
              );
            })}
          </div>
          {accessMode === "pin" ? (
            <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Gallery PIN" inputMode="numeric" autoComplete="off" style={{ width: "100%", minHeight: 50, borderRadius: 13, border: "1px solid #d1d5db", padding: "0 13px", fontSize: 18, fontWeight: 900, letterSpacing: "0.08em", color: "#111827", outline: "none", boxSizing: "border-box" }} />
          ) : null}
        </section>
      ) : null}

      <button type="submit" disabled={saving} style={{ minHeight: 54, borderRadius: 16, border: "none", background: saving ? "#9ca3af" : "#cc0000", color: "#fff", fontSize: 16, fontWeight: 950, boxShadow: saving ? "none" : "0 12px 24px rgba(204,0,0,0.20)" }}>
        {saving ? "Creating..." : isEvent ? "Create Event" : "Create School"}
      </button>
    </form>
  );
}
