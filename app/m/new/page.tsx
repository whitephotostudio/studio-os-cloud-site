"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  GraduationCap,
  Lock,
  PartyPopper,
  ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const statusOptions = [
  {
    value: "active",
    label: "Active",
    description: "Live and viewable.",
  },
  {
    value: "inactive",
    label: "Inactive",
    description: "Hidden for now.",
  },
  {
    value: "pre_release",
    label: "Pre-Released",
    description: "Collect emails before launch.",
  },
  {
    value: "closed",
    label: "Closed",
    description: "Visible, ordering closed.",
  },
] as const;

type GalleryStatus = (typeof statusOptions)[number]["value"];
type CreateMode = "event" | "school";

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "block",
        marginBottom: 7,
        fontSize: 12,
        fontWeight: 900,
        color: "#111827",
      }}
    >
      {children}
    </label>
  );
}

export default function MobileNewPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [mode, setMode] = useState<CreateMode>("event");
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [galleryStatus, setGalleryStatus] = useState<GalleryStatus>("pre_release");
  const [accessMode, setAccessMode] = useState<"public" | "pin">("public");
  const [accessPin, setAccessPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isEvent = mode === "event";

  async function sessionHeaders() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    const title = clean(name);
    if (!title) {
      setError(isEvent ? "Event name is required." : "School name is required.");
      return;
    }
    if (accessMode === "pin" && !clean(accessPin)) {
      setError("Enter a PIN before saving PIN protected access.");
      return;
    }

    setSaving(true);
    try {
      const headers = await sessionHeaders();

      if (isEvent) {
        const res = await fetch("/api/dashboard/events", {
          method: "POST",
          headers,
          body: JSON.stringify({
            title,
            clientName: clean(clientName) || null,
            eventDate,
            galleryStatus,
            accessMode,
            accessPin: accessMode === "pin" ? clean(accessPin) : null,
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
        body: JSON.stringify({ school_name: title, shoot_date: eventDate }),
      });
      const payload = await res.json();
      if (res.status === 401) {
        router.push("/sign-in?redirect=/m/new");
        return;
      }
      if (!res.ok || payload.ok === false || !payload.school?.id) {
        setError(payload.message || "Failed to create school.");
        setSaving(false);
        return;
      }

      const patch = await fetch(`/api/dashboard/schools/${payload.school.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: galleryStatus,
          access_mode: accessMode,
          access_pin: accessMode === "pin" ? clean(accessPin) : null,
          email_required: true,
          shoot_date: eventDate,
        }),
      });
      const patchPayload = await patch.json();
      if (!patch.ok || patchPayload.ok === false) {
        setError(patchPayload.message || "School created, but settings did not save.");
        setSaving(false);
        return;
      }

      router.push(`/m/schools/${payload.school.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
      <header style={{ display: "grid", gap: 5 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.12em", fontWeight: 900, color: "#6b7280" }}>
          CREATE
        </div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 950, color: "#111827" }}>
          New gallery
        </h1>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          padding: 4,
          borderRadius: 16,
          background: "#f3f4f6",
          border: "1px solid #e5e7eb",
        }}
      >
        {[
          { value: "event" as const, label: "Event", icon: PartyPopper },
          { value: "school" as const, label: "School", icon: GraduationCap },
        ].map((option) => {
          const Icon = option.icon;
          const active = mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setMode(option.value)}
              style={{
                minHeight: 48,
                borderRadius: 12,
                border: "none",
                background: active ? "#111827" : "transparent",
                color: active ? "#fff" : "#4b5563",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                fontWeight: 900,
                fontSize: 14,
              }}
            >
              <Icon size={17} /> {option.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            padding: "11px 12px",
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : null}

      <section
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 18,
          padding: 14,
          display: "grid",
          gap: 14,
          boxShadow: "0 4px 12px rgba(15,23,42,0.05)",
        }}
      >
        <div>
          <FieldLabel>{isEvent ? "Event name" : "School name"}</FieldLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isEvent ? "Smith Wedding" : "Northview School"}
            autoComplete="off"
            autoFocus
            style={{
              width: "100%",
              minHeight: 50,
              borderRadius: 13,
              border: "1px solid #d1d5db",
              padding: "0 13px",
              fontSize: 16,
              fontWeight: 750,
              color: "#111827",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {isEvent ? (
          <>
            <div>
              <FieldLabel>Client name</FieldLabel>
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Client name"
                autoComplete="name"
                style={{
                  width: "100%",
                  minHeight: 50,
                  borderRadius: 13,
                  border: "1px solid #d1d5db",
                  padding: "0 13px",
                  fontSize: 16,
                  fontWeight: 750,
                  color: "#111827",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

          </>
        ) : null}

        <div>
          <FieldLabel>{isEvent ? "Event date" : "Shoot date"}</FieldLabel>
          <div style={{ position: "relative" }}>
            <CalendarDays
              size={17}
              style={{
                position: "absolute",
                left: 13,
                top: "50%",
                transform: "translateY(-50%)",
                color: "#6b7280",
                pointerEvents: "none",
              }}
            />
            <input
              type="date"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              style={{
                width: "100%",
                minHeight: 50,
                borderRadius: 13,
                border: "1px solid #d1d5db",
                padding: "0 13px 0 42px",
                fontSize: 16,
                fontWeight: 750,
                color: "#111827",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
      </section>

      <section
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 18,
          padding: 14,
          display: "grid",
          gap: 13,
        }}
      >
        <FieldLabel>Status</FieldLabel>
        <div style={{ display: "grid", gap: 8 }}>
          {statusOptions.map((option) => {
            const active = galleryStatus === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setGalleryStatus(option.value)}
                style={{
                  borderRadius: 13,
                  border: active ? "2px solid #111827" : "1px solid #e5e7eb",
                  background: active ? "#f3f4f6" : "#fff",
                  padding: "12px 13px",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  alignItems: "center",
                  gap: 10,
                  textAlign: "left",
                }}
              >
                <span>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 900, color: "#111827" }}>
                    {option.label}
                  </span>
                  <span style={{ display: "block", marginTop: 2, fontSize: 12, fontWeight: 650, color: "#6b7280" }}>
                    {option.description}
                  </span>
                </span>
                {active ? <Check size={18} color="#cc0000" /> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 18,
          padding: 14,
          display: "grid",
          gap: 13,
        }}
      >
        <FieldLabel>Gallery access</FieldLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            { value: "public" as const, label: "Public", icon: ShieldCheck },
            { value: "pin" as const, label: "PIN", icon: Lock },
          ].map((option) => {
            const Icon = option.icon;
            const active = accessMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setAccessMode(option.value)}
                style={{
                  minHeight: 62,
                  borderRadius: 13,
                  border: active ? "2px solid #111827" : "1px solid #e5e7eb",
                  background: active ? "#f3f4f6" : "#fff",
                  color: "#111827",
                  fontWeight: 900,
                  fontSize: 14,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Icon size={17} /> {option.label}
              </button>
            );
          })}
        </div>

        {accessMode === "pin" ? (
          <div>
            <FieldLabel>Gallery PIN</FieldLabel>
            <input
              value={accessPin}
              onChange={(e) => setAccessPin(e.target.value)}
              placeholder="4 to 8 digits"
              inputMode="numeric"
              autoComplete="off"
              style={{
                width: "100%",
                minHeight: 50,
                borderRadius: 13,
                border: "1px solid #d1d5db",
                padding: "0 13px",
                fontSize: 18,
                fontWeight: 900,
                letterSpacing: "0.08em",
                color: "#111827",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        ) : null}
      </section>

      <button
        type="submit"
        disabled={saving}
        style={{
          minHeight: 54,
          borderRadius: 16,
          border: "none",
          background: saving ? "#9ca3af" : "#cc0000",
          color: "#fff",
          fontSize: 16,
          fontWeight: 950,
          boxShadow: saving ? "none" : "0 12px 24px rgba(204,0,0,0.20)",
        }}
      >
        {saving ? "Creating…" : isEvent ? "Create Event" : "Create School"}
      </button>
    </form>
  );
}
