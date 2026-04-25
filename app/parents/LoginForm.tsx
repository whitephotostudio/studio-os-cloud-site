"use client";
// app/parents/LoginForm.tsx
//
// ✅ PERF: Extracted from page.tsx so it can be used as a Client Component
// child of a Server Component parent. The parent fetches schools/events
// server-side (HTML arrives already populated) — no loading spinner,
// no extra API round-trip on the client.

import Image from "next/image";
import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Images, KeyRound, Mail, School, Search, X } from "lucide-react";

type SchoolRow = {
  id: string;
  school_name: string;
  status: string | null;
  expiration_date: string | null;
  email_required: boolean | null;
};

type EventProjectRow = {
  id: string;
  title: string | null;
  client_name: string | null;
  workflow_type: string | null;
  status: string | null;
  portal_status: string | null;
  event_date: string | null;
  email_required: boolean | null;
};

type AccessMode = "school" | "event";

type Step =
  | "login"
  | "school_prerelease"
  | "school_prerelease_done"
  | "school_closed"
  | "event_prerelease"
  | "event_prerelease_done";

type SchoolAccessPayload = {
  ok?: boolean;
  message?: string;
  step?: Step;
  schoolId?: string;
  pin?: string;
  // ✅ Prefetched gallery context returned alongside school validation
  // so the gallery page can skip its own API call entirely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  galleryContext?: Record<string, any>;
};

type EventAccessPayload = {
  ok?: boolean;
  message?: string;
  step?: Step;
  projectId?: string;
  email?: string;
  pin?: string;
};

function projectLabel(project: EventProjectRow) {
  return project.title?.trim() || project.client_name?.trim() || "Untitled Event";
}

// ── Reusable searchable combo-box ────────────────────────────────────────
// Type-ahead input that replaces a native <select>. Data is already in
// memory (SSR'd), so filtering is instant with no API calls. Keyboard
// (↑/↓/Enter/Esc) + mouse + touch. Same visual language as the rest of
// the parents portal.
type SearchableOptionProps<T> = {
  id: string;
  label: string;
  row: T;
  subtext?: string;
};

function SearchableSelect<T>({
  value,
  onChange,
  options,
  placeholder,
  emptyHint,
  inputStyle,
  ariaLabel,
}: {
  value: string;
  onChange: (id: string, row: T | null) => void;
  options: SearchableOptionProps<T>[];
  placeholder: string;
  emptyHint?: string;
  inputStyle: React.CSSProperties;
  ariaLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value],
  );

  // Keep the visible text in sync with the external value (e.g. prefilled
  // state from URL params, or clearing on tab switch). Only sync when the
  // dropdown is closed, so we don't clobber what the user is actively
  // typing.
  useEffect(() => {
    if (isOpen) return;
    setQuery(selectedOption ? selectedOption.label : "");
  }, [selectedOption, isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // When the input shows the currently-selected label (nothing typed),
    // show the full list. That way the user can open the menu and scroll
    // even after picking something.
    if (!q || (selectedOption && query === selectedOption.label)) {
      return options;
    }
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, selectedOption]);

  // Close on outside click.
  useEffect(() => {
    if (!isOpen) return;
    function onDocDown(e: MouseEvent | TouchEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("touchstart", onDocDown);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("touchstart", onDocDown);
    };
  }, [isOpen]);

  // Reset highlight when the filter narrows.
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filtered.length]);

  function select(option: SearchableOptionProps<T>) {
    onChange(option.id, option.row);
    setQuery(option.label);
    setIsOpen(false);
    // Blur so the mobile keyboard tucks away.
    inputRef.current?.blur();
  }

  function clearSelection() {
    onChange("", null);
    setQuery("");
    setIsOpen(true);
    inputRef.current?.focus();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setHighlightedIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (isOpen && filtered[highlightedIndex]) {
        e.preventDefault();
        select(filtered[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  }

  const showClear = Boolean(selectedOption && query === selectedOption.label);

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <Search
        size={16}
        color="#98a2b3"
        style={{ position: "absolute", left: 14, top: 17, pointerEvents: "none" }}
      />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          // If the user starts editing after a selection, unset the
          // external value so the form knows nothing is picked yet.
          if (value) onChange("", null);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={isOpen}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        style={{ ...inputStyle, paddingLeft: 42, paddingRight: 42, color: "#111" }}
      />
      {showClear ? (
        <button
          type="button"
          onClick={clearSelection}
          aria-label="Clear selection"
          style={{
            position: "absolute",
            right: 10,
            top: 10,
            width: 28,
            height: 28,
            borderRadius: 999,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#98a2b3",
            padding: 0,
          }}
        >
          <X size={16} />
        </button>
      ) : (
        <ChevronDown
          size={18}
          color="#98a2b3"
          style={{ position: "absolute", right: 14, top: 15, pointerEvents: "none" }}
        />
      )}

      {isOpen ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "#fff",
            border: "1px solid #e1e3e8",
            borderRadius: 12,
            boxShadow: "0 18px 40px rgba(17,24,39,0.14)",
            maxHeight: 280,
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
          }}
          role="listbox"
        >
          {filtered.length === 0 ? (
            <div style={{ padding: "14px 16px", fontSize: 13, color: "#98a2b3" }}>
              {emptyHint || "No matches. Try a different search."}
            </div>
          ) : (
            filtered.map((option, i) => {
              const isSelected = option.id === value;
              const isHighlighted = i === highlightedIndex;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  // onMouseDown fires before the input's blur, so preventDefault
                  // here keeps focus on the input long enough for select()
                  // to run. Works for mouse and synthesized touch.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(option);
                  }}
                  onMouseEnter={() => setHighlightedIndex(i)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "11px 16px",
                    border: "none",
                    borderBottom: i === filtered.length - 1 ? "none" : "1px solid #f1f2f4",
                    background: isHighlighted ? "#f3f5f8" : "#fff",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    color: "#111",
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: isSelected ? 700 : 500,
                      lineHeight: 1.35,
                    }}
                  >
                    {option.label}
                  </div>
                  {option.subtext ? (
                    <div
                      style={{
                        fontSize: 12,
                        color: "#98a2b3",
                        marginTop: 2,
                      }}
                    >
                      {option.subtext}
                    </div>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function LoginForm({
  initialSchools,
  initialEventProjects,
  prefilledEventId,
  prefilledEventEmail,
  prefilledMode,
}: {
  initialSchools: SchoolRow[];
  initialEventProjects: EventProjectRow[];
  prefilledEventId?: string;
  prefilledEventEmail?: string;
  prefilledMode?: AccessMode;
}) {
  const router = useRouter();

  const [step, setStep] = useState<Step>("login");
  const [mode, setMode] = useState<AccessMode>("school");

  // ✅ Initialised from server-fetched props — no spinner, instant render
  const [schools] = useState<SchoolRow[]>(initialSchools);
  const [eventProjects] = useState<EventProjectRow[]>(initialEventProjects);

  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<SchoolRow | null>(null);
  const [schoolEmail, setSchoolEmail] = useState("");
  const [schoolPin, setSchoolPin] = useState("");

  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<EventProjectRow | null>(null);
  const [eventEmail, setEventEmail] = useState("");
  const [eventPin, setEventPin] = useState("");

  const [loginError, setLoginError] = useState("");
  const [searching, setSearching] = useState(false);

  const [regEmail, setRegEmail] = useState("");
  const [regSubmitting, setRegSubmitting] = useState(false);
  const [regError, setRegError] = useState("");
  const [schoolPrereleaseRegistered, setSchoolPrereleaseRegistered] = useState(false);
  const [eventPrereleaseRegistered, setEventPrereleaseRegistered] = useState(false);

  useEffect(() => {
    if (prefilledMode === "event" || prefilledEventId) {
      setMode("event");
      if (prefilledEventId) {
        setSelectedEventId(prefilledEventId);
        setSelectedEvent(
          initialEventProjects.find((row) => row.id === prefilledEventId) ?? null,
        );
      }
      if (prefilledEventEmail) {
        setEventEmail(prefilledEventEmail);
      }
    }
  }, [initialEventProjects, prefilledEventEmail, prefilledEventId, prefilledMode]);

  // ── PIN-recovery magic-link landing ────────────────────────────────
  //
  // The /api/portal/recovery/claim endpoint redirects here with
  // ?recovery=ok&pin=...&school=... after consuming the token.  We use
  // those params to:
  //   · auto-select the school in the dropdown
  //   · auto-fill the PIN field
  //   · surface a friendly green banner explaining what just happened
  // The parent still has to type their email (security: even after the
  // magic link, we never reveal the PIN without one more parent action).
  const [recoveryBanner, setRecoveryBanner] = useState<
    "ok" | "expired" | "used" | "invalid" | null
  >(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("recovery");
    if (!status) return;
    if (status === "expired" || status === "used" || status === "invalid") {
      setRecoveryBanner(status);
      return;
    }
    if (status !== "ok") return;
    const pin = (params.get("pin") || "").trim();
    const schoolId = (params.get("school") || "").trim();
    if (pin) setSchoolPin(pin);
    if (schoolId) {
      const match = initialSchools.find((row) => row.id === schoolId);
      if (match) {
        setMode("school");
        setSelectedSchoolId(match.id);
        setSelectedSchool(match);
      }
    }
    setRecoveryBanner("ok");
  }, [initialSchools]);

  function isSchoolPreRelease(school: SchoolRow | null) {
    return school?.status?.toLowerCase().replaceAll("-", "_") === "pre_release";
  }

  function resetErrors() {
    setLoginError("");
    setRegError("");
  }

  function switchMode(nextMode: AccessMode) {
    setMode(nextMode);
    setStep("login");
    setSelectedSchoolId("");
    setSelectedSchool(null);
    setSchoolEmail("");
    setSchoolPin("");
    setSelectedEventId("");
    setSelectedEvent(null);
    setEventEmail("");
    setEventPin("");
    resetErrors();
    setSchoolPrereleaseRegistered(false);
    setEventPrereleaseRegistered(false);
  }

  async function handleSchoolLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    resetErrors();

    if (!selectedSchoolId || !selectedSchool) {
      setLoginError("Please choose your school.");
      return;
    }
    if (!schoolEmail.trim()) {
      setLoginError("Please enter your email to register for updates.");
      return;
    }

    // Pre-release school: register email directly — no PIN needed
    if (isSchoolPreRelease(selectedSchool)) {
      setSearching(true);
      try {
        await fetch("/api/portal/pre-release-register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ schoolId: selectedSchoolId, email: schoolEmail.trim().toLowerCase() }),
        });
      } catch { /* non-fatal */ }
      setSchoolPrereleaseRegistered(true);
      setSearching(false);
      return;
    }

    if (!schoolPin.trim()) {
      setLoginError("Please enter the PIN from your photo envelope.");
      return;
    }

    setSearching(true);
    try {
      const response = await fetch("/api/portal/school-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          pin: schoolPin.trim(),
          email: schoolEmail.trim().toLowerCase(),
          // ✅ PERF: Ask server to also return gallery data in the same
          // response — gallery page then reads from sessionStorage instead
          // of making its own separate API call.
          prefetch: true,
        }),
      });

      // Parse defensively: if the server returned an HTML error page (e.g.
      // a 500 with a Vercel/Next runtime error), response.json() throws a
      // cryptic DOMException ("The string did not match the expected
      // pattern." in Safari). Show a friendly message instead.
      let payload: SchoolAccessPayload;
      try {
        payload = (await response.json()) as SchoolAccessPayload;
      } catch {
        setSearching(false);
        setLoginError(
          response.status >= 500
            ? "Server error — please try again in a moment."
            : "Could not reach the gallery service. Please try again.",
        );
        return;
      }
      setSearching(false);

      if (payload.step === "school_closed") { setStep("school_closed"); return; }
      if (payload.step === "school_prerelease") {
        // Auto-register with the email already entered — no second screen
        try {
          await fetch("/api/portal/pre-release-register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ schoolId: selectedSchoolId, email: schoolEmail.trim().toLowerCase() }),
          });
        } catch { /* non-fatal */ }
        setSchoolPrereleaseRegistered(true);
        setSearching(false);
        return;
      }

      if (!response.ok || payload.ok === false || !payload.schoolId || !payload.pin) {
        setLoginError(payload.message || "No gallery was found for that school and PIN.");
        return;
      }

      // ✅ PERF: Cache prefetched gallery context so the gallery page can
      // skip its own /api/portal/gallery-context call entirely.
      if (payload.galleryContext) {
        try {
          const cacheKey = `gallery_ctx:${payload.pin}:${payload.schoolId}`;
          sessionStorage.setItem(
            cacheKey,
            JSON.stringify({ ...payload.galleryContext, ts: Date.now() }),
          );
        } catch { /* sessionStorage unavailable in some contexts */ }
      }

      // ✅ PERF: Use router.push (SPA navigation) instead of
      // window.location.href (full page reload) — avoids re-downloading
      // the JS bundle and re-running layout code.
      router.push(
        `/parents/${encodeURIComponent(payload.pin)}?mode=school&school=${encodeURIComponent(payload.schoolId)}&email=${encodeURIComponent(schoolEmail.trim().toLowerCase())}`,
      );
    } catch (error) {
      setSearching(false);
      setLoginError(error instanceof Error ? error.message : "No gallery was found for that school and PIN.");
    }
  }

  async function handleEventLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    resetErrors();

    if (!selectedEventId || !selectedEvent) {
      setLoginError("Please choose your event.");
      return;
    }
    if (!eventEmail.trim()) {
      setLoginError("Please enter your email to register for updates.");
      return;
    }

    // Pre-release event: register email directly — no PIN needed
    if (selectedEvent.portal_status?.toLowerCase().replaceAll("-", "_") === "pre_release") {
      setSearching(true);
      try {
        await fetch("/api/portal/pre-release-register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: selectedEventId, email: eventEmail.trim().toLowerCase() }),
        });
      } catch { /* non-fatal */ }
      setEventPrereleaseRegistered(true);
      setSearching(false);
      return;
    }

    if (!eventPin.trim()) {
      setLoginError("Please enter your event access PIN.");
      return;
    }

    setSearching(true);
    try {
      const response = await fetch("/api/portal/event-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventId: selectedEventId,
          email: eventEmail.trim(),
          pin: eventPin.trim(),
        }),
      });

      // Defensive parse (see school-access notes above).
      let payload: EventAccessPayload;
      try {
        payload = (await response.json()) as EventAccessPayload;
      } catch {
        setSearching(false);
        setLoginError(
          response.status >= 500
            ? "Server error — please try again in a moment."
            : "Could not reach the gallery service. Please try again.",
        );
        return;
      }
      setSearching(false);

      if (payload.step === "event_prerelease") {
        // Auto-register inline — no second screen
        try {
          await fetch("/api/portal/pre-release-register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: selectedEventId, email: eventEmail.trim().toLowerCase() }),
          });
        } catch { /* non-fatal */ }
        setEventPrereleaseRegistered(true);
        setSearching(false);
        return;
      }

      if (!response.ok || payload.ok === false || !payload.projectId || !payload.email || !payload.pin) {
        setLoginError(payload.message || "No event gallery was found for that email and PIN.");
        return;
      }

      // ✅ PERF: SPA navigation (no full page reload)
      router.push(
        `/parents/${encodeURIComponent(payload.pin)}?mode=event&project=${encodeURIComponent(payload.projectId)}&email=${encodeURIComponent(payload.email)}`,
      );
    } catch (error) {
      setSearching(false);
      setLoginError(error instanceof Error ? error.message : "No event gallery was found for that email and PIN.");
    }
  }

  async function handleEventPreReleaseRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRegSubmitting(true);
    setRegError("");
    try {
      const response = await fetch("/api/portal/pre-release-register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: selectedEventId,
          email: regEmail.trim().toLowerCase(),
        }),
      });

      const payload = (await response.json()) as { ok?: boolean; message?: string };
      setRegSubmitting(false);

      if (!response.ok || payload.ok === false) {
        setRegError(payload.message || "Something went wrong. Please try again.");
        return;
      }
    } catch (error) {
      setRegSubmitting(false);
      setRegError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      return;
    }
    setStep("event_prerelease_done");
  }

  async function handleSchoolPreReleaseRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRegSubmitting(true);
    setRegError("");
    try {
      const response = await fetch("/api/portal/pre-release-register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          email: regEmail.trim().toLowerCase(),
        }),
      });

      const payload = (await response.json()) as { ok?: boolean; message?: string };
      setRegSubmitting(false);

      if (!response.ok || payload.ok === false) {
        setRegError(payload.message || "Something went wrong. Please try again.");
        return;
      }
    } catch (error) {
      setRegSubmitting(false);
      setRegError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      return;
    }
    setStep("school_prerelease_done");
  }

  const inputStyle = {
    width: "100%",
    border: "1.5px solid #e1e3e8",
    borderRadius: 12,
    padding: "14px 16px",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box" as const,
    color: "#111",
    background: "#fff",
    fontFamily: "inherit",
  };

  const card = {
    background: "#fff",
    borderRadius: 24,
    padding: "42px 38px",
    boxShadow: "0 20px 60px rgba(17,24,39,0.08)",
    width: "100%",
    maxWidth: 520,
    border: "1px solid rgba(17,24,39,0.04)",
  };

  const labelStyle = {
    display: "block",
    fontSize: 11,
    fontWeight: 800,
    color: "#7b8190",
    marginBottom: 7,
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f7f8fa 0%, #eff2f6 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
        fontFamily: "Inter, Helvetica Neue, Helvetica, Arial, sans-serif",
      }}
    >
      {step === "login" && (
        <div style={card}>
          <div
            style={{
              width: 62,
              height: 62,
              background: "#111827",
              borderRadius: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 24px",
              boxShadow: "0 16px 40px rgba(17,24,39,0.22)",
            }}
          >
            {mode === "school" ? (
              <School size={26} color="#fff" strokeWidth={2} />
            ) : (
              <Images size={26} color="#fff" strokeWidth={2} />
            )}
          </div>

          <div
            style={{
              display: "flex",
              background: "#f3f5f8",
              borderRadius: 14,
              padding: 6,
              gap: 6,
              marginBottom: 24,
            }}
          >
            <button
              type="button"
              onClick={() => switchMode("school")}
              style={{
                flex: 1, border: "none", borderRadius: 10, padding: "12px 14px",
                fontSize: 14, fontWeight: 700, cursor: "pointer",
                background: mode === "school" ? "#fff" : "transparent",
                color: mode === "school" ? "#111" : "#6b7280",
                boxShadow: mode === "school" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              }}
            >
              School Access
            </button>
            <button
              type="button"
              onClick={() => switchMode("event")}
              style={{
                flex: 1, border: "none", borderRadius: 10, padding: "12px 14px",
                fontSize: 14, fontWeight: 700, cursor: "pointer",
                background: mode === "event" ? "#fff" : "transparent",
                color: mode === "event" ? "#111" : "#6b7280",
                boxShadow: mode === "event" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              }}
            >
              Event Access
            </button>
          </div>

          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#111", margin: "0 0 8px", textAlign: "center" }}>
            Client Panel
          </h1>

          {recoveryBanner === "ok" ? (
            <div
              role="status"
              style={{
                margin: "0 0 16px",
                padding: "12px 14px",
                background: "#dcfce7",
                border: "1px solid #86efac",
                borderRadius: 12,
                color: "#166534",
                fontSize: 13,
                fontWeight: 700,
                lineHeight: 1.5,
                textAlign: "center",
              }}
            >
              We found your gallery and pre-filled the PIN. Enter your email below to continue.
            </div>
          ) : null}
          {recoveryBanner === "expired" ? (
            <div
              role="alert"
              style={{
                margin: "0 0 16px",
                padding: "12px 14px",
                background: "#fff7ed",
                border: "1px solid #fed7aa",
                borderRadius: 12,
                color: "#9a3412",
                fontSize: 13,
                fontWeight: 700,
                lineHeight: 1.5,
                textAlign: "center",
              }}
            >
              That recovery link expired. Try the I-lost-the-PIN form again — you&rsquo;ll get a fresh link.
            </div>
          ) : null}
          {recoveryBanner === "used" ? (
            <div
              role="alert"
              style={{
                margin: "0 0 16px",
                padding: "12px 14px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 12,
                color: "#991b1b",
                fontSize: 13,
                fontWeight: 700,
                lineHeight: 1.5,
                textAlign: "center",
              }}
            >
              That recovery link has already been used. If you need another, request a new one.
            </div>
          ) : null}
          {recoveryBanner === "invalid" ? (
            <div
              role="alert"
              style={{
                margin: "0 0 16px",
                padding: "12px 14px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 12,
                color: "#991b1b",
                fontSize: 13,
                fontWeight: 700,
                lineHeight: 1.5,
                textAlign: "center",
              }}
            >
              That recovery link isn&rsquo;t valid. Please request a new one.
            </div>
          ) : null}

          <p style={{ fontSize: 14, color: "#667085", margin: "0 0 28px", lineHeight: 1.7, textAlign: "center" }}>
            {mode === "school"
              ? "Choose your school, then enter your email and the PIN from your child's photo envelope."
              : selectedEvent?.portal_status === "pre_release"
                ? "Choose your event and enter your email to join the gallery release list."
                : "Choose your event, then enter the email and PIN the photographer provided."}
          </p>

          {mode === "school" ? (
            <form onSubmit={handleSchoolLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={labelStyle}>School</label>
                <SearchableSelect<SchoolRow>
                  value={selectedSchoolId}
                  onChange={(id, row) => {
                    setSelectedSchoolId(id);
                    setSelectedSchool(row);
                    resetErrors();
                  }}
                  options={schools.map((row) => ({
                    id: row.id,
                    label: row.school_name,
                    row,
                  }))}
                  placeholder="Search your school…"
                  emptyHint="No schools match that search."
                  inputStyle={inputStyle}
                  ariaLabel="School"
                />
              </div>

              <div>
                <label style={labelStyle}>Email</label>
                <div style={{ position: "relative" }}>
                  <Mail size={16} color="#98a2b3" style={{ position: "absolute", left: 14, top: 17 }} />
                  <input
                    type="email"
                    value={schoolEmail}
                    onChange={(e) => setSchoolEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    style={{ ...inputStyle, paddingLeft: 42 }}
                  />
                </div>
              </div>

              {isSchoolPreRelease(selectedSchool) ? (
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", borderRadius: 12, padding: "13px 16px", fontSize: 13, lineHeight: 1.7 }}>
                  <strong>This gallery isn't available yet.</strong> Enter your email and we'll send you a notification as soon as the photos are ready — no PIN needed right now.
                </div>
              ) : (
                <div>
                  <label style={labelStyle}>PIN</label>
                  <input
                    value={schoolPin}
                    onChange={(e) => setSchoolPin(e.target.value)}
                    placeholder="Enter school PIN"
                    required={!isSchoolPreRelease(selectedSchool)}
                    style={inputStyle}
                  />
                </div>
              )}

              {loginError ? (
                <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", color: "#be123c", borderRadius: 12, padding: "12px 14px", fontSize: 13 }}>
                  {loginError}
                </div>
              ) : null}

              {schoolPrereleaseRegistered ? (
                <div style={{ background: "#ecfdf3", border: "1px solid #6ee7b7", color: "#065f46", borderRadius: 14, padding: "16px 18px", fontSize: 14, lineHeight: 1.6, textAlign: "center" }}>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>You're on the list!</div>
                  We'll notify you at <strong>{schoolEmail.trim().toLowerCase()}</strong> when this gallery goes live.
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={searching}
                  style={{ height: 52, borderRadius: 14, border: "none", background: "#111827", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
                >
                  {searching
                    ? (isSchoolPreRelease(selectedSchool) ? "Registering…" : "Checking access…")
                    : (isSchoolPreRelease(selectedSchool) ? "Notify me when it's ready" : "Open school gallery")}
                </button>
              )}

              {/* Login-side PIN recovery — small text link that expands the
                  4-question recovery form right inside the login card.  Same
                  endpoint as the in-gallery drawer.  Anonymous; works without
                  an existing session. */}
              <LostPinSection
                schools={schools}
                defaultEmail={schoolEmail}
              />
            </form>
          ) : (
            <form onSubmit={handleEventLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={labelStyle}>Event</label>
                <SearchableSelect<EventProjectRow>
                  value={selectedEventId}
                  onChange={(id, row) => {
                    setSelectedEventId(id);
                    setSelectedEvent(row);
                    resetErrors();
                  }}
                  options={eventProjects.map((row) => {
                    const dateStr = row.event_date
                      ? new Date(row.event_date).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                      : null;
                    const subParts: string[] = [];
                    if (dateStr) subParts.push(dateStr);
                    if (row.client_name && row.title && row.title.trim() !== row.client_name.trim()) {
                      subParts.push(row.client_name.trim());
                    }
                    return {
                      id: row.id,
                      label: projectLabel(row),
                      row,
                      subtext: subParts.length ? subParts.join(" · ") : undefined,
                    };
                  })}
                  placeholder="Search your event…"
                  emptyHint="No events match that search."
                  inputStyle={inputStyle}
                  ariaLabel="Event"
                />
              </div>

              <div>
                <label style={labelStyle}>Email</label>
                <div style={{ position: "relative" }}>
                  <Mail size={16} color="#98a2b3" style={{ position: "absolute", left: 14, top: 17 }} />
                  <input type="email" value={eventEmail} onChange={(e) => setEventEmail(e.target.value)} placeholder="Enter your email" required style={{ ...inputStyle, paddingLeft: 42 }} />
                </div>
              </div>

              {selectedEvent?.portal_status?.toLowerCase().replaceAll("-", "_") === "pre_release" ? (
                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", borderRadius: 12, padding: "13px 16px", fontSize: 13, lineHeight: 1.7 }}>
                  <strong>This event gallery isn't available yet.</strong> Enter your email and we'll send you a notification as soon as the photos are ready — no PIN needed right now.
                </div>
              ) : (
                <div>
                  <label style={labelStyle}>Event PIN</label>
                  <input value={eventPin} onChange={(e) => setEventPin(e.target.value)} placeholder="Enter event access PIN" required style={inputStyle} />
                </div>
              )}

              {loginError ? (
                <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", color: "#be123c", borderRadius: 12, padding: "12px 14px", fontSize: 13 }}>
                  {loginError}
                </div>
              ) : null}

              {eventPrereleaseRegistered ? (
                <div style={{ background: "#ecfdf3", border: "1px solid #6ee7b7", color: "#065f46", borderRadius: 14, padding: "16px 18px", fontSize: 14, lineHeight: 1.6, textAlign: "center" }}>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>You're on the list!</div>
                  We'll notify you at <strong>{eventEmail.trim().toLowerCase()}</strong> when this gallery goes live.
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={searching}
                  style={{ height: 52, borderRadius: 14, border: "none", background: "#111827", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}
                >
                  {searching
                    ? (selectedEvent?.portal_status?.toLowerCase().replaceAll("-", "_") === "pre_release" ? "Registering…" : "Checking access…")
                    : (selectedEvent?.portal_status?.toLowerCase().replaceAll("-", "_") === "pre_release" ? "Notify me when it's ready" : "Open event gallery")}
                </button>
              )}
            </form>
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              marginTop: 14,
              gap: 6,
            }}
          >
            <Image
              src="/studio_os_logo.png"
              alt="Studio OS Cloud"
              width={58}
              height={40}
              style={{
                width: 58,
                height: "auto",
                opacity: 0.96,
              }}
            />
            <div
              style={{
                fontSize: 9,
                lineHeight: 1.2,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#6b7280",
                fontWeight: 700,
              }}
            >
              Powered by Studio OS Cloud
            </div>
          </div>

        </div>
      )}

      {step === "school_prerelease" && (
        <div style={card}>
          <div style={{ width: 60, height: 60, borderRadius: 18, background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px" }}>
            <Mail size={26} color="#4338ca" />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, textAlign: "center", margin: "0 0 10px", color: "#111" }}>Gallery coming soon</h1>
          <p style={{ textAlign: "center", color: "#667085", lineHeight: 1.7, margin: "0 0 26px" }}>
            Leave your email and we'll notify you when your school gallery opens.
          </p>
          <form onSubmit={handleSchoolPreReleaseRegister} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={labelStyle}>Email</label>
              <input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} required style={inputStyle} placeholder="name@example.com" />
            </div>
            {regError ? (
              <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", color: "#be123c", borderRadius: 12, padding: "12px 14px", fontSize: 13 }}>
                {regError}
              </div>
            ) : null}
            <button type="submit" disabled={regSubmitting} style={{ height: 52, borderRadius: 14, border: "none", background: "#111827", color: "#fff", fontWeight: 800, cursor: "pointer" }}>
              {regSubmitting ? "Saving…" : "Notify me"}
            </button>
            <button type="button" onClick={() => setStep("login")} style={{ height: 48, borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#344054", fontWeight: 700, cursor: "pointer" }}>
              Back
            </button>
          </form>
        </div>
      )}

      {step === "school_prerelease_done" && (
        <div style={card}>
          <div style={{ width: 60, height: 60, borderRadius: 999, background: "#ecfdf3", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px" }}>
            <Check size={28} color="#16a34a" />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, textAlign: "center", margin: "0 0 10px", color: "#111" }}>You're on the list</h1>
          <p style={{ textAlign: "center", color: "#667085", lineHeight: 1.7, margin: 0 }}>
            We saved your email and will send an update when the school gallery is live.
          </p>
        </div>
      )}

      {step === "event_prerelease" && (
        <div style={card}>
          <div style={{ width: 60, height: 60, borderRadius: 18, background: "#eef2ff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px" }}>
            <Mail size={26} color="#4338ca" />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, textAlign: "center", margin: "0 0 10px", color: "#111" }}>
            {selectedEvent ? `${projectLabel(selectedEvent)} is coming soon` : "Gallery coming soon"}
          </h1>
          <p style={{ textAlign: "center", color: "#667085", lineHeight: 1.7, margin: "0 0 26px" }}>
            Leave your email and the photographer can send you the gallery link and any access PIN as soon as this event is released.
          </p>
          <form onSubmit={handleEventPreReleaseRegister} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={labelStyle}>Email</label>
              <input type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} required style={inputStyle} placeholder="name@example.com" />
            </div>
            {regError ? (
              <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", color: "#be123c", borderRadius: 12, padding: "12px 14px", fontSize: 13 }}>
                {regError}
              </div>
            ) : null}
            <button type="submit" disabled={regSubmitting} style={{ height: 52, borderRadius: 14, border: "none", background: "#111827", color: "#fff", fontWeight: 800, cursor: "pointer" }}>
              {regSubmitting ? "Saving…" : "Notify me when it opens"}
            </button>
            <button type="button" onClick={() => setStep("login")} style={{ height: 48, borderRadius: 14, border: "1px solid #d0d5dd", background: "#fff", color: "#344054", fontWeight: 700, cursor: "pointer" }}>
              Back
            </button>
          </form>
        </div>
      )}

      {step === "event_prerelease_done" && (
        <div style={card}>
          <div style={{ width: 60, height: 60, borderRadius: 999, background: "#ecfdf3", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px" }}>
            <Check size={28} color="#16a34a" />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, textAlign: "center", margin: "0 0 10px", color: "#111" }}>You're on the release list</h1>
          <p style={{ textAlign: "center", color: "#667085", lineHeight: 1.7, margin: 0 }}>
            We saved your email. Once the photographer activates the gallery, they can share the live link and any access PIN with everyone registered here.
          </p>
        </div>
      )}

      {step === "school_closed" && (
        <div style={card}>
          <div style={{ width: 60, height: 60, borderRadius: 18, background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 22px" }}>
            <KeyRound size={26} color="#c2410c" />
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, textAlign: "center", margin: "0 0 10px", color: "#111" }}>This school gallery is closed</h1>
          <p style={{ textAlign: "center", color: "#667085", lineHeight: 1.7, margin: 0 }}>
            The ordering window has ended for this school. Please contact your photographer if you still need help.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Login-side PIN recovery panel.  Collapsible by default — parents see a
 * small text link (Lost the PIN?) under the school sign-in form, click to
 * expand.  Calls /api/portal/recovery/request with name + school + email.
 * Server returns the same generic response either way (anti-enumeration).
 */
function LostPinSection({
  schools,
  defaultEmail,
}: {
  schools: SchoolRow[];
  defaultEmail: string;
}) {
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState("");

  useEffect(() => {
    if (open && !email && defaultEmail) {
      setEmail(defaultEmail);
    }
  }, [open, defaultEmail, email]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !schoolId || !email.trim()) {
      setResponse("Please fill out all four fields.");
      return;
    }
    setSubmitting(true);
    setResponse("");
    try {
      const res = await fetch("/api/portal/recovery/request", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          schoolId,
          email: email.trim().toLowerCase(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      setResponse(
        body.message ||
          "If we found a match, we've emailed a recovery link. Check your inbox.",
      );
    } catch {
      setResponse("Network problem. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginTop: 4 }}>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            background: "transparent",
            border: "none",
            color: "#cc0000",
            fontWeight: 800,
            fontSize: 13,
            cursor: "pointer",
            padding: "6px 0",
            textAlign: "center",
            width: "100%",
          }}
        >
          Lost the PIN? Recover it →
        </button>
      ) : (
        <div
          style={{
            marginTop: 6,
            padding: "14px 14px 12px",
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>
              Recover your gallery PIN
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                background: "transparent",
                border: "none",
                color: "#9ca3af",
                cursor: "pointer",
                fontSize: 16,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
          <p style={{ margin: "0 0 10px 0", fontSize: 12, color: "#475569", lineHeight: 1.5 }}>
            Answer 4 quick questions and we&rsquo;ll email a one-time access link
            to the address on file. The link expires in 24 hours.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              style={miniInputStyle}
            />
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              style={miniInputStyle}
            />
          </div>
          <select
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
            style={{ ...miniInputStyle, marginTop: 8, width: "100%" }}
          >
            <option value="">Pick a school…</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.school_name}
              </option>
            ))}
          </select>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="parent@example.com"
            style={{ ...miniInputStyle, marginTop: 8, width: "100%" }}
          />
          <button
            type="button"
            onClick={(e) => void submit(e)}
            disabled={submitting}
            style={{
              marginTop: 10,
              width: "100%",
              padding: "11px 14px",
              borderRadius: 12,
              border: "none",
              background: submitting ? "#94a3b8" : "#0f172a",
              color: "#fff",
              fontWeight: 800,
              fontSize: 13,
              cursor: submitting ? "wait" : "pointer",
            }}
          >
            {submitting ? "Checking…" : "Email me the link"}
          </button>
          {response ? (
            <div
              role="status"
              style={{
                marginTop: 10,
                padding: "10px 12px",
                background: "#f0f9ff",
                border: "1px solid #bae6fd",
                borderRadius: 10,
                color: "#075985",
                fontSize: 12,
                fontWeight: 600,
                lineHeight: 1.4,
              }}
            >
              {response}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

const miniInputStyle: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#ffffff",
  padding: "9px 12px",
  fontSize: 13,
  fontWeight: 600,
  color: "#111827",
  outline: "none",
  boxSizing: "border-box",
};
