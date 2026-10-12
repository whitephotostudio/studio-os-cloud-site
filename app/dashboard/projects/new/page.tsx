"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { withAuthRequestTimeout } from "@/lib/auth-request";
import { useAuthFormReady } from "@/lib/use-auth-form-ready";
import { localCalendarDate } from "@/lib/calendar-dates";
import { ArrowLeft, CalendarDays, Lock, Globe } from "lucide-react";

const statusOptions = [
  {
    value: "active",
    label: "Active",
    description: "Gallery is live and viewable.",
  },
  {
    value: "inactive",
    label: "Inactive",
    description: "Gallery is hidden until you turn it on.",
  },
  {
    value: "pre_release",
    label: "Pre-Released",
    description: "Collect visitor emails before launch.",
  },
  {
    value: "closed",
    label: "Closed",
    description: "Gallery remains visible but ordering is closed.",
  },
] as const;

type GalleryStatus = (typeof statusOptions)[number]["value"];

export default function NewEventPage() {
  const formReady = useAuthFormReady();
  const router = useRouter();
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [galleryStatus, setGalleryStatus] =
    useState<GalleryStatus>("active");
  const [accessMode, setAccessMode] = useState<"public" | "pin">("public");
  const [accessPin, setAccessPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createRequestId = useRef<string | null>(null);

  // Server and browser begin with the same blank input. After hydration use
  // the photographer's local day, keeping any date they already selected.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setEventDate((current) => current || localCalendarDate());
    });
    return () => { active = false; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formReady) return;
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
      } = await withAuthRequestTimeout(supabase.auth.getSession(), "Checking your sign-in took too long. Your form is saved here; please try again.");

      createRequestId.current ??= crypto.randomUUID();

      const res = await fetch("/api/dashboard/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          clientRequestId: createRequestId.current,
          title: title.trim(),
          clientName: clientName.trim() || null,
          eventDate,
          galleryStatus,
          accessMode,
          accessPin: accessMode === "pin" ? accessPin.trim() : null,
        }),
        signal: AbortSignal.timeout(30000),
      });

      const payload = await res.json().catch(() => null) as { ok?: boolean; message?: string; project?: { id?: string } } | null;

      if (res.status === 401) {
        router.push("/sign-in?redirect=%2Fdashboard%2Fprojects%2Fnew");
        return;
      }

      if (!res.ok || payload?.ok !== true) {
        setError(payload?.message || "We could not confirm whether your gallery was created. Check your galleries, or retry here safely.");
        setSaving(false);
        return;
      }

      // Success — redirect to the new event
      if (payload.project?.id) {
        createRequestId.current = null;
        router.push(`/dashboard/projects/${payload.project.id}`);
      } else {
        throw new Error("We could not confirm your new gallery. Check your galleries, or retry here safely.");
      }
    } catch (err) {
      setError(err instanceof Error && err.name !== "AbortError" && err.name !== "TimeoutError" && err.name !== "TypeError"
        ? err.message : "We could not confirm whether your gallery was created. Check your galleries, or retry here safely without creating a second copy.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="px-6 py-6 text-[#13234a] lg:px-10">
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
              <Link href="/dashboard/projects/events" className="mt-2 block font-semibold underline">Check my galleries</Link>
            </div>
          )}

          {/* Form */}
          <form method="post" onSubmit={handleSubmit} className="mt-8 space-y-6">
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

            {/* Gallery Status */}
            <div>
              <label className="mb-3 block text-sm font-medium text-[#13234a]">
                Status
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                {statusOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setGalleryStatus(option.value)}
                    className={`rounded-[18px] border-2 px-5 py-4 text-left transition ${
                      galleryStatus === option.value
                        ? "border-[#0c1633] bg-[#f0f2f8]"
                        : "border-[#d9dfeb] hover:border-[#b0b8cc]"
                    }`}
                  >
                    <div className="text-sm font-semibold text-[#13234a]">
                      {option.label}
                    </div>
                    <div className="mt-1 text-xs text-[#667085]">
                      {option.description}
                    </div>
                  </button>
                ))}
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
                disabled={!formReady || saving}
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
