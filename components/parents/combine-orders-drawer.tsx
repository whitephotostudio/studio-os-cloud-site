"use client";

// CombineOrdersDrawer
//
// The single drawer that powers all three "unlock another gallery" flows
// for parents already inside an authenticated gallery:
//
//   Tab 1 — Add a sibling (current year, any school within this studio)
//   Tab 2 — Older photos (past year, any school within this studio)
//   Tab 3 — I lost the PIN (4-question recovery form, server emails a link)
//
// Drop into any parents-portal screen via:
//   <CombineOrdersDrawer
//     open={...}
//     onClose={...}
//     activeStudio={...}
//     onAddedSibling={(payload) => merge into cart context}
//   />
//
// Tabs 1 + 2 just call the existing /api/portal/gallery-context (school mode)
// with the typed pin + email, and on success hand the resulting payload
// back to the host so it can splice the new student into the active session.
// Tab 3 calls /api/portal/recovery/request which returns a generic message
// regardless of outcome (intentional — anti-enumeration).
//
// Spec: docs/design/combine-orders-and-recovery.md sections 4.1–4.5.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  KeyRound,
  Mail,
  PhoneCall,
  Search,
  Sparkles,
  X,
} from "lucide-react";

// ── Types exposed to the host ─────────────────────────────────────────

export type CombineDrawerStudio = {
  /** The currently-authenticated studio's photographer id. */
  photographerId: string;
  /** Display name (used in the Tier 3 fallback contact card). */
  businessName: string | null;
  /** Email shown in the contact card when door 3 fails. */
  contactEmail: string | null;
  /** Phone shown in the contact card when door 3 fails. */
  contactPhone: string | null;
  /** All schools the studio has shot — populates the dropdowns.  Sorted newest first by shootYear. */
  schools: CombineDrawerSchoolOption[];
};

export type CombineDrawerSchoolOption = {
  id: string;
  schoolName: string;
  /** Optional — used to group "Older photos" by year. */
  shootYear: number | null;
  /** Optional — used to mark the school the parent is currently authenticated for. */
  isCurrent?: boolean;
  /** Optional — surfaces "Archived May 31" copy in the Older photos tab. */
  archiveDate?: string | null;
};

/** Payload handed back to the host when a sibling/past-year is successfully added. */
export type CombineDrawerAddPayload = {
  schoolId: string;
  pin: string;
  email: string;
  /** Free-form label for the toast: "Lily Rivera · 6th Grade · Maple Grove 2026". */
  label: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  studio: CombineDrawerStudio;
  /** Initial tab — defaults to 'sibling'. */
  initialTab?: TabKey;
  /** Called when the parent successfully verifies a sibling/past-year PIN. */
  onAddedSibling?: (payload: CombineDrawerAddPayload) => void;
  /** Called when a recovery email is sent (success path). Useful for toast UI. */
  onRecoveryRequested?: () => void;
};

type TabKey = "sibling" | "older" | "recover";

const TAB_CONFIG: Array<{ key: TabKey; label: string; hint: string }> = [
  { key: "sibling", label: "Add a sibling", hint: "Same school year" },
  { key: "older", label: "Older photos", hint: "Past years" },
  { key: "recover", label: "I lost the PIN", hint: "Get the PIN" },
];

// ── Component ─────────────────────────────────────────────────────────

export function CombineOrdersDrawer(props: Props) {
  const [tab, setTab] = useState<TabKey>(props.initialTab ?? "sibling");
  const [toast, setToast] = useState<string>("");

  useEffect(() => {
    if (!props.open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [props.open]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3000);
  }, []);

  if (!props.open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9000,
        background: "rgba(15,23,42,0.55)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "flex-end",
      }}
      onMouseDown={(e) => {
        // Click the backdrop → close. Click inside the panel doesn't propagate.
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          height: "100%",
          background: "#ffffff",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-20px 0 40px rgba(15,23,42,0.20)",
          color: "#111827",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 18px",
            borderBottom: "1px solid #f3f4f6",
            background: "#fff5f5",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                fontWeight: 800,
                color: "#cc0000",
              }}
            >
              <Sparkles size={12} style={{ marginRight: 4, marginBottom: -1 }} />
              Save with combine
            </div>
            <h2 style={{ margin: "4px 0 0 0", fontSize: 18, fontWeight: 900, color: "#111827" }}>
              Add another gallery
            </h2>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "#fff",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#374151",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #f3f4f6",
            background: "#fff",
          }}
        >
          {TAB_CONFIG.map((t) => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                style={{
                  flex: 1,
                  padding: "12px 6px",
                  border: "none",
                  background: "transparent",
                  borderBottom: active ? "3px solid #cc0000" : "3px solid transparent",
                  color: active ? "#cc0000" : "#6b7280",
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                  transition: "color 120ms",
                }}
              >
                <div>{t.label}</div>
                <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.7, marginTop: 2 }}>
                  {t.hint}
                </div>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px" }}>
          {tab === "sibling" ? (
            <SiblingTab
              studio={props.studio}
              onAdded={props.onAddedSibling}
              showToast={showToast}
              filter="current"
            />
          ) : tab === "older" ? (
            <SiblingTab
              studio={props.studio}
              onAdded={props.onAddedSibling}
              showToast={showToast}
              filter="older"
            />
          ) : (
            <RecoverTab
              studio={props.studio}
              showToast={showToast}
              onRequested={props.onRecoveryRequested}
            />
          )}
        </div>

        {/* Toast */}
        {toast ? (
          <div
            role="status"
            style={{
              position: "absolute",
              bottom: 18,
              left: 18,
              right: 18,
              padding: "10px 14px",
              borderRadius: 12,
              background: "#0f172a",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              boxShadow: "0 12px 30px rgba(15,23,42,0.30)",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <CheckCircle2 size={14} color="#86efac" /> {toast}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Tab 1 + 2: Add sibling / Older photos ────────────────────────────

function SiblingTab({
  studio,
  onAdded,
  showToast,
  filter,
}: {
  studio: CombineDrawerStudio;
  onAdded?: (payload: CombineDrawerAddPayload) => void;
  showToast: (msg: string) => void;
  filter: "current" | "older";
}) {
  const [schoolId, setSchoolId] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [pin, setPin] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Bucket schools by current vs older.
  const schoolOptions = useMemo(() => {
    const currentYear =
      studio.schools.find((s) => s.isCurrent)?.shootYear ?? null;
    const list =
      filter === "current"
        ? studio.schools.filter(
            (s) =>
              currentYear == null || s.shootYear == null || s.shootYear === currentYear,
          )
        : studio.schools.filter(
            (s) => currentYear != null && s.shootYear != null && s.shootYear < currentYear,
          );
    // Stable sort: most-recent year first, then by name.
    return [...list].sort((a, b) => {
      const ay = a.shootYear ?? 0;
      const by = b.shootYear ?? 0;
      if (ay !== by) return by - ay;
      return a.schoolName.localeCompare(b.schoolName);
    });
  }, [studio.schools, filter]);

  const selectedSchool = useMemo(
    () => schoolOptions.find((s) => s.id === schoolId) ?? null,
    [schoolOptions, schoolId],
  );

  const archiveCopy = useMemo(() => {
    const date = selectedSchool?.archiveDate;
    if (!date) return null;
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, [selectedSchool]);

  const submit = useCallback(async () => {
    if (!schoolId) {
      setError("Pick a gallery first.");
      return;
    }
    if (!email.trim() || !pin.trim()) {
      setError("Email and PIN are both required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/portal/gallery-context", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId,
          pin: pin.trim(),
          email: email.trim().toLowerCase(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        primaryStudent?: { id: string; first_name?: string | null; last_name?: string | null; class_name?: string | null } | null;
      };
      if (!res.ok || body.ok === false) {
        setError(body.message || "Couldn't unlock that gallery.");
        return;
      }
      const studentName = [
        body.primaryStudent?.first_name,
        body.primaryStudent?.last_name,
      ]
        .filter(Boolean)
        .join(" ");
      const schoolName = selectedSchool?.schoolName ?? "Gallery";
      const yearSuffix = selectedSchool?.shootYear ? ` ${selectedSchool.shootYear}` : "";
      const label = `${studentName || "Student"} · ${schoolName}${yearSuffix}`;
      onAdded?.({
        schoolId,
        pin: pin.trim(),
        email: email.trim().toLowerCase(),
        label,
      });
      showToast(`✓ ${label} added to your cart`);
      // Clear inputs so the parent can immediately add another sibling.
      setPin("");
      setEmail("");
      setSchoolId("");
    } catch {
      setError("Network problem. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [schoolId, email, pin, selectedSchool, onAdded, showToast]);

  const heading =
    filter === "current"
      ? "Combine sibling orders"
      : "Looking for past year photos?";
  const subhead =
    filter === "current"
      ? "Add another kid to this cart and unlock the sibling discount."
      : "If you missed ordering last year, you can still bring those photos in.";

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: filter === "current" ? "#fff5f5" : "#fff7ed",
            color: filter === "current" ? "#cc0000" : "#c2410c",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Sparkles size={16} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, color: "#111827" }}>{heading}</div>
          <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{subhead}</div>
        </div>
      </div>

      <FieldLabel>Gallery</FieldLabel>
      <SchoolPicker
        options={schoolOptions}
        value={schoolId}
        onChange={setSchoolId}
        placeholder={
          filter === "current"
            ? "Pick a sibling's school…"
            : "Pick a past-year school…"
        }
      />

      {archiveCopy ? (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            color: "#9a3412",
            borderRadius: 10,
            fontSize: 12,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <AlertTriangle size={13} /> Archived on {archiveCopy} — last chance
        </div>
      ) : null}

      <FieldLabel style={{ marginTop: 14 }}>Your email</FieldLabel>
      <TextInput
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="parent@example.com"
        leftIcon={<Mail size={14} color="#9ca3af" />}
      />

      <FieldLabel style={{ marginTop: 14 }}>PIN</FieldLabel>
      <TextInput
        value={pin}
        onChange={setPin}
        placeholder="0000"
        leftIcon={<KeyRound size={14} color="#9ca3af" />}
        autoComplete="off"
      />

      {error ? (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: "10px 12px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 10,
            color: "#991b1b",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        style={{
          marginTop: 16,
          width: "100%",
          padding: "13px 14px",
          borderRadius: 12,
          border: "none",
          background: submitting ? "#94a3b8" : "#cc0000",
          color: "#fff",
          fontWeight: 900,
          fontSize: 14,
          cursor: submitting ? "wait" : "pointer",
        }}
      >
        {submitting ? "Adding…" : "Add to my cart"}
      </button>

      {/* Cross-link to the "I lost the PIN" tab when sibling fails */}
      <div
        style={{
          marginTop: 10,
          fontSize: 12,
          color: "#6b7280",
          fontWeight: 600,
          textAlign: "center",
        }}
      >
        Don&rsquo;t have the PIN? Try the <strong style={{ color: "#cc0000" }}>I lost the PIN</strong> tab.
      </div>
    </div>
  );
}

// ── Tab 3: I lost the PIN ────────────────────────────────────────────

function RecoverTab({
  studio,
  showToast,
  onRequested,
}: {
  studio: CombineDrawerStudio;
  showToast: (msg: string) => void;
  onRequested?: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [responseMessage, setResponseMessage] = useState("");
  const [photographerContact, setPhotographerContact] = useState<{
    businessName: string | null;
    email: string | null;
    phone: string | null;
  } | null>(null);

  const submit = useCallback(async () => {
    if (!firstName.trim() || !lastName.trim() || !schoolId || !email.trim()) {
      setResponseMessage("Please fill out all four fields.");
      return;
    }
    setSubmitting(true);
    setResponseMessage("");
    setPhotographerContact(null);
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
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        photographerContact?: {
          businessName: string | null;
          email: string | null;
          phone: string | null;
        } | null;
      };
      // The API ALWAYS returns a generic message — anti-enumeration.
      // We just relay it.
      setResponseMessage(
        body.message ||
          "If we found a match, we've emailed a recovery link. Check your inbox.",
      );
      if (body.photographerContact) {
        setPhotographerContact(body.photographerContact);
      }
      onRequested?.();
      showToast("Check your email for the recovery link");
    } catch {
      setResponseMessage("Network problem. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [firstName, lastName, schoolId, email, onRequested, showToast]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "#eff6ff",
            color: "#1d4ed8",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <KeyRound size={16} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 900, color: "#111827" }}>I lost the PIN</div>
          <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>
            Answer 4 quick questions and we&rsquo;ll email a one-time access link.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <FieldLabel>First name</FieldLabel>
          <TextInput value={firstName} onChange={setFirstName} placeholder="Ethan" />
        </div>
        <div>
          <FieldLabel>Last name</FieldLabel>
          <TextInput value={lastName} onChange={setLastName} placeholder="Rivera" />
        </div>
      </div>

      <FieldLabel style={{ marginTop: 12 }}>School / year</FieldLabel>
      <SchoolPicker
        options={studio.schools}
        value={schoolId}
        onChange={setSchoolId}
        placeholder="Pick a gallery…"
      />

      <FieldLabel style={{ marginTop: 12 }}>Your email</FieldLabel>
      <TextInput
        type="email"
        value={email}
        onChange={setEmail}
        placeholder="parent@example.com"
        leftIcon={<Mail size={14} color="#9ca3af" />}
      />

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        style={{
          marginTop: 16,
          width: "100%",
          padding: "13px 14px",
          borderRadius: 12,
          border: "none",
          background: submitting ? "#94a3b8" : "#0f172a",
          color: "#fff",
          fontWeight: 900,
          fontSize: 14,
          cursor: submitting ? "wait" : "pointer",
        }}
      >
        {submitting ? "Checking…" : "Email me the link"}
      </button>

      {responseMessage ? (
        <div
          role="status"
          style={{
            marginTop: 14,
            padding: "12px 14px",
            background: "#f0f9ff",
            border: "1px solid #bae6fd",
            borderRadius: 10,
            color: "#075985",
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          {responseMessage}
        </div>
      ) : null}

      {/* Photographer contact card — shown when the API tells us door 3 failed */}
      {photographerContact ||
      // Fall back to the studio-level contact info regardless, so the parent
      // always has SOMEONE to reach if self-service didn't work.
      (!responseMessage && (studio.contactEmail || studio.contactPhone)) ? (
        <PhotographerContactCard
          businessName={photographerContact?.businessName ?? studio.businessName}
          email={photographerContact?.email ?? studio.contactEmail}
          phone={photographerContact?.phone ?? studio.contactPhone}
        />
      ) : null}
    </div>
  );
}

// ── Photographer contact card (Tier 3 fallback) ──────────────────────

function PhotographerContactCard({
  businessName,
  email,
  phone,
}: {
  businessName: string | null;
  email: string | null;
  phone: string | null;
}) {
  if (!email && !phone) return null;
  return (
    <div
      style={{
        marginTop: 16,
        padding: "12px 14px",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontWeight: 800,
          color: "#6b7280",
          marginBottom: 6,
        }}
      >
        Or contact your photographer
      </div>
      <div style={{ fontSize: 14, fontWeight: 900, color: "#111827" }}>
        {businessName || "Studio"}
      </div>
      <div style={{ fontSize: 13, color: "#475569", marginTop: 6, display: "grid", gap: 4 }}>
        {email ? (
          <a
            href={`mailto:${email}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#cc0000", textDecoration: "none", fontWeight: 700 }}
          >
            <Mail size={13} /> {email}
          </a>
        ) : null}
        {phone ? (
          <a
            href={`tel:${phone}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#0f172a", textDecoration: "none", fontWeight: 700 }}
          >
            <PhoneCall size={13} /> {phone}
          </a>
        ) : null}
      </div>
    </div>
  );
}

// ── Smaller building blocks ──────────────────────────────────────────

function FieldLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 800,
        color: "#475569",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        marginBottom: 6,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type,
  leftIcon,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  leftIcon?: React.ReactNode;
  autoComplete?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: "10px 12px",
      }}
    >
      {leftIcon ? <span style={{ display: "inline-flex" }}>{leftIcon}</span> : null}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type ?? "text"}
        autoComplete={autoComplete ?? "on"}
        spellCheck={false}
        style={{
          flex: 1,
          border: "none",
          outline: "none",
          background: "transparent",
          fontSize: 14,
          fontWeight: 600,
          color: "#111827",
        }}
      />
    </div>
  );
}

/** Searchable school dropdown, grouped by shoot year for the older-photos tab. */
function SchoolPicker({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: CombineDrawerSchoolOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const selected = options.find((o) => o.id === value) ?? null;

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return options;
    return options.filter((o) => o.schoolName.toLowerCase().includes(f));
  }, [options, filter]);

  // Group by shoot year for the dropdown UI.
  const grouped = useMemo(() => {
    const groups = new Map<string, CombineDrawerSchoolOption[]>();
    for (const opt of filtered) {
      const key = opt.shootYear ? String(opt.shootYear) : "Other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(opt);
    }
    // Sort keys: numeric desc, then "Other" last.
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return Number(b) - Number(a);
    });
    return sortedKeys.map((k) => ({ key: k, items: groups.get(k)! }));
  }, [filtered]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: "10px 12px",
          fontSize: 14,
          fontWeight: 700,
          color: selected ? "#111827" : "#9ca3af",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected
            ? `${selected.schoolName}${selected.shootYear ? ` · ${selected.shootYear}` : ""}`
            : placeholder || "Pick a gallery…"}
        </span>
        <ChevronDown size={14} color="#9ca3af" />
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 60,
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            boxShadow: "0 16px 40px rgba(15,23,42,0.18)",
            maxHeight: 320,
            overflowY: "auto",
            colorScheme: "light",
          }}
        >
          <div style={{ position: "sticky", top: 0, background: "#fff", padding: 8, borderBottom: "1px solid #f3f4f6" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "#f9fafb",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                padding: "8px 10px",
              }}
            >
              <Search size={13} color="#9ca3af" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search…"
                style={{
                  flex: 1,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#111827",
                }}
                autoFocus
              />
            </div>
          </div>
          {grouped.length === 0 ? (
            <div style={{ padding: 14, color: "#6b7280", fontSize: 13, fontWeight: 600 }}>
              No matches.
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.key}>
                <div
                  style={{
                    padding: "6px 12px",
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "#6b7280",
                    background: "#f9fafb",
                    borderTop: "1px solid #f3f4f6",
                  }}
                >
                  {group.key === "Other" ? "Year unknown" : group.key}
                </div>
                {group.items.map((item) => {
                  const active = item.id === value;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onChange(item.id);
                        setOpen(false);
                        setFilter("");
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        border: "none",
                        background: active ? "#fff5f5" : "#fff",
                        color: active ? "#cc0000" : "#111827",
                        fontWeight: active ? 800 : 600,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      {item.schoolName}
                      {item.isCurrent ? (
                        <span style={{ marginLeft: 6, fontSize: 10, color: "#15803d", fontWeight: 800 }}>
                          · current
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export default CombineOrdersDrawer;
