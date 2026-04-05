"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import { ArrowLeft, CalendarDays, Lock, Globe, LogOut } from "lucide-react";

const sidebar: React.CSSProperties = {
  width: 220,
  minHeight: "100vh",
  background: "#000",
  display: "flex",
  flexDirection: "column",
};

const navItem: React.CSSProperties = {
  padding: "12px 24px",
  fontSize: 14,
  color: "#ccc",
  textDecoration: "none",
  display: "block",
};

const navActive: React.CSSProperties = {
  ...navItem,
  color: "#fff",
  background: "#1a1a1a",
};

export default function NewEventPage() {
  const router = useRouter();
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [eventDate, setEventDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [accessMode, setAccessMode] = useState<"public" | "pin">("public");
  const [accessPin, setAccessPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");

  // Load user email for sidebar
  useState(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data?.user?.email ?? "");
    });
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Event name is required.");
      return;
    }

    if (accessMode === "pin" && !accessPin.trim()) {
      setError("Please enter a PIN for password-protected access.");
      return;
    }

    setSaving(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/dashboard/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          clientName: clientName.trim() || null,
          eventDate,
          accessMode,
          accessPin: accessMode === "pin" ? accessPin.trim() : null,
        }),
      });

      const payload = await res.json();

      if (res.status === 401) {
        router.push("/sign-in");
        return;
      }

      if (!res.ok || payload.ok === false) {
        setError(payload.message || "Failed to create event.");
        setSaving(false);
        return;
      }

      // Success — redirect to the new event
      if (payload.project?.id) {
        router.push(`/dashboard/projects/${payload.project.id}`);
      } else {
        router.push("/dashboard/projects/events");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/sign-in");
  }

  return (
    <div className="flex min-h-screen bg-white">
      {/* Sidebar */}
      <aside style={sidebar}>
        <div className="p-6">
          <Logo />
        </div>
        <nav className="flex-1">
          <Link href="/dashboard" style={navItem}>Dashboard</Link>
          <Link href="/dashboard/schools" style={navItem}>Schools</Link>
          <Link href="/dashboard/projects/events" style={navActive}>Events</Link>
          <Link href="/dashboard/orders" style={navItem}>Orders</Link>
          <Link href="/dashboard/packages" style={navItem}>Packages</Link>
          <Link href="/dashboard/settings" style={navItem}>Settings</Link>
        </nav>
        <div className="p-4">
          {userEmail && (
            <p className="mb-2 truncate text-xs text-gray-400">{userEmail}</p>
          )}
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-xl bg-[#1a1a1a] px-3 py-2 text-sm text-gray-300 transition hover:bg-[#2a2a2a]"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 px-6 py-6 text-[#13234a] lg:px-10">
        <div className="mx-auto max-w-[720px]">
          <Link
            href="/dashboard/projects/events"
            className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-[#667085] transition hover:text-[#13234a]"
          >
            <ArrowLeft size={16} />
            Back to events
          </Link>

          <h1 className="text-5xl font-bold tracking-[-0.04em] text-[#13234a]">
            New Event
          </h1>
          <p className="mt-4 text-xl text-[#667085]">
            Create a new wedding, baptism, engagement, or client gallery.
          </p>

          {/* Error */}
          {error && (
            <div className="mt-6 rounded-[14px] border border-[#f0c6c6] bg-[#fff5f5] px-5 py-4 text-sm text-[#b42318]">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-8 space-y-6">
            {/* Event Name */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[#13234a]">
                Event name <span className="text-[#b91c1c]">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Smith Wedding, Baby Shower, Engagement Session"
                className="w-full rounded-[18px] border border-[#d9dfeb] px-5 py-4 text-base text-[#13234a] outline-none transition focus:border-[#13234a] focus:ring-2 focus:ring-[#13234a]/10"
                autoFocus
              />
            </div>

            {/* Client Name */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[#13234a]">
                Client name
              </label>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. John & Sarah Smith"
                className="w-full rounded-[18px] border border-[#d9dfeb] px-5 py-4 text-base text-[#13234a] outline-none transition focus:border-[#13234a] focus:ring-2 focus:ring-[#13234a]/10"
              />
            </div>

            {/* Event Date */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[#13234a]">
                Event date
              </label>
              <div className="relative">
                <CalendarDays
                  size={18}
                  className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[#667085]"
                />
                <input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="w-full rounded-[18px] border border-[#d9dfeb] py-4 pl-12 pr-5 text-base text-[#13234a] outline-none transition focus:border-[#13234a] focus:ring-2 focus:ring-[#13234a]/10"
                />
              </div>
            </div>

            {/* Access Mode */}
            <div>
              <label className="mb-3 block text-sm font-medium text-[#13234a]">
                Gallery access
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setAccessMode("public")}
                  className={`flex flex-1 items-center gap-3 rounded-[18px] border-2 px-5 py-4 text-left transition ${
                    accessMode === "public"
                      ? "border-[#0c1633] bg-[#f0f2f8]"
                      : "border-[#d9dfeb] hover:border-[#b0b8cc]"
                  }`}
                >
                  <Globe
                    size={20}
                    className={
                      accessMode === "public"
                        ? "text-[#0c1633]"
                        : "text-[#667085]"
                    }
                  />
                  <div>
                    <div className="text-sm font-semibold text-[#13234a]">
                      Public
                    </div>
                    <div className="text-xs text-[#667085]">
                      Anyone with the link can view
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setAccessMode("pin")}
                  className={`flex flex-1 items-center gap-3 rounded-[18px] border-2 px-5 py-4 text-left transition ${
                    accessMode === "pin"
                      ? "border-[#0c1633] bg-[#f0f2f8]"
                      : "border-[#d9dfeb] hover:border-[#b0b8cc]"
                  }`}
                >
                  <Lock
                    size={20}
                    className={
                      accessMode === "pin"
                        ? "text-[#0c1633]"
                        : "text-[#667085]"
                    }
                  />
                  <div>
                    <div className="text-sm font-semibold text-[#13234a]">
                      PIN protected
                    </div>
                    <div className="text-xs text-[#667085]">
                      Requires a PIN to view
                    </div>
                  </div>
                </button>
              </div>

              {accessMode === "pin" && (
                <div className="mt-4">
                  <label className="mb-2 block text-sm font-medium text-[#13234a]">
                    Gallery PIN <span className="text-[#b91c1c]">*</span>
                  </label>
                  <input
                    type="text"
                    value={accessPin}
                    onChange={(e) => setAccessPin(e.target.value)}
                    placeholder="e.g. 1234"
                    maxLength={20}
                    className="w-full max-w-[240px] rounded-[18px] border border-[#d9dfeb] px-5 py-4 text-base text-[#13234a] outline-none transition focus:border-[#13234a] focus:ring-2 focus:ring-[#13234a]/10"
                  />
                </div>
              )}
            </div>

            {/* Submit */}
            <div className="flex items-center gap-4 pt-4">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-3 rounded-[22px] bg-[#0c1633] px-7 py-5 text-xl font-semibold text-white shadow-sm transition hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
              >
                {saving ? "Creating…" : "Create Event"}
              </button>

              <Link
                href="/dashboard/projects/events"
                className="rounded-[22px] border border-[#d9dfeb] px-7 py-5 text-xl font-semibold text-[#667085] transition hover:border-[#b0b8cc] hover:text-[#13234a]"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
