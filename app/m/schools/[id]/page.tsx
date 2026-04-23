"use client";

// Mobile school detail — /m/schools/[id]
//
// Inspired by the HH Studio OS Cloud reference mockups Harout shared:
//   - Hero cover photo band at the top
//   - "Gallery Released / Pending Delivery" status pill
//   - Prominent share-gallery card (copy / native share)
//   - Searchable student list — each row has photo, name, class, PIN reveal,
//     and a per-student share button
//   - Recent orders strip drilling into /m/orders/[id] or the per-school
//     orders page

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  GraduationCap,
  Search,
  Share2,
  ShoppingBag,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type School = {
  id: string;
  school_name: string | null;
  local_school_id: string | null;
  gallery_slug: string | null;
};

type Student = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  class_name: string | null;
  photo_url: string | null;
  pin: string | null;
};

type OrderPreview = {
  id: string;
  created_at: string | null;
  status: string | null;
  total_cents: number | null;
  total_amount: number | null;
  currency: string | null;
  parent_name: string | null;
  customer_name: string | null;
  student:
    | { first_name: string | null; last_name: string | null }
    | { first_name: string | null; last_name: string | null }[]
    | null;
};

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

function single<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function money(order: OrderPreview): string {
  const cents =
    order.total_cents != null
      ? order.total_cents
      : order.total_amount != null
        ? Math.round(order.total_amount * 100)
        : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: order.currency || "USD",
  }).format(cents / 100);
}

function relativeTime(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function shareOrCopy(
  url: string,
  title: string,
  onToast: (s: string) => void,
) {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  try {
    if (nav && "share" in nav && typeof nav.share === "function") {
      await nav.share({ title, text: title, url });
      return;
    }
  } catch {
    // User cancelled — fall through to copy.
  }
  try {
    await navigator.clipboard.writeText(url);
    onToast("Link copied");
  } catch {
    onToast("Could not copy");
  }
}

export default function MobileSchoolDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  // `?student=<uuid>` is passed by the /m home spotlight — we scroll to that
  // student's card, flash a highlight ring, and auto-reveal their PIN so
  // Harout can read it off in one tap.  Mirrors the desktop deep-link on
  // /dashboard/projects/schools/[id]/classes/[id]?student=<id>.
  const searchParams = useSearchParams();
  const focusStudentIdFromUrl = searchParams?.get("student") ?? null;
  const focusAppliedRef = useRef(false);

  const [supabase] = useState(() => createClient());
  const [school, setSchool] = useState<School | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [orders, setOrders] = useState<OrderPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [revealedPins, setRevealedPins] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string>("");
  const [toast, setToast] = useState("");
  const [focusStudentId, setFocusStudentId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError("");
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: schoolRow, error: schoolErr } = await supabase
        .from("schools")
        .select("id, school_name, local_school_id, gallery_slug")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      if (schoolErr) {
        setError(schoolErr.message);
        setLoading(false);
        return;
      }
      setSchool((schoolRow as School | null) ?? null);

      const [studentsRes, ordersRes] = await Promise.all([
        supabase
          .from("students")
          .select("id, first_name, last_name, class_name, photo_url, pin")
          .eq("school_id", id)
          .order("first_name", { ascending: true }),
        supabase
          .from("orders")
          .select(
            `id, created_at, status, total_cents, total_amount, currency,
             parent_name, customer_name,
             student:students(first_name,last_name)`,
          )
          .eq("school_id", id)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);

      if (cancelled) return;

      if (studentsRes.error) {
        setError(studentsRes.error.message);
      } else {
        setStudents((studentsRes.data ?? []) as Student[]);
      }
      if (!ordersRes.error) {
        setOrders((ordersRes.data ?? []) as OrderPreview[]);
      }

      setLoading(false);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [id, supabase]);

  // Apply the ?student= deep-link once students are loaded.
  useEffect(() => {
    if (!focusStudentIdFromUrl) return;
    if (focusAppliedRef.current) return;
    if (students.length === 0) return;
    const target = students.find((s) => s.id === focusStudentIdFromUrl);
    if (!target) return;
    focusAppliedRef.current = true;
    setSearch(""); // Clear any filter so the student is visible.
    setFocusStudentId(target.id);
    setRevealedPins((prev) => ({ ...prev, [target.id]: true }));
    // Wait a frame so the card renders with data-student-id before we scroll.
    window.setTimeout(() => {
      const el = document.querySelector(
        `[data-student-id="${target.id}"]`,
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 40);
    // Let the glow fade after a moment so the UI doesn't stay "stuck".
    const clearId = window.setTimeout(() => setFocusStudentId(null), 2800);
    return () => window.clearTimeout(clearId);
  }, [focusStudentIdFromUrl, students]);

  const cover = useMemo(() => {
    const first = students.find((s) => clean(s.photo_url));
    return clean(first?.photo_url);
  }, [students]);

  const filteredStudents = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return students;
    return students.filter((s) => {
      const name = [clean(s.first_name), clean(s.last_name)].join(" ").toLowerCase();
      const klass = clean(s.class_name).toLowerCase();
      const pin = clean(s.pin).toLowerCase();
      return name.includes(term) || klass.includes(term) || pin.includes(term);
    });
  }, [students, search]);

  const status = useMemo(() => {
    if (!students.length) return { label: "Setup", bg: "#fff7ed", fg: "#c2410c" };
    if (clean(school?.gallery_slug))
      return { label: "Gallery Released", bg: "#dcfce7", fg: "#15803d" };
    return { label: "Pending Delivery", bg: "#fef3c7", fg: "#92400e" };
  }, [students.length, school?.gallery_slug]);

  function showToast(s: string) {
    setToast(s);
    window.setTimeout(() => setToast(""), 2200);
  }

  function galleryUrl(): string {
    if (!school) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const slug = clean(school.gallery_slug);
    if (slug) return `${origin}/g/${slug}`;
    const params = new URLSearchParams({ mode: "school", school: school.id });
    return `${origin}/parents?${params.toString()}`;
  }

  async function shareGallery() {
    const url = galleryUrl();
    if (!url) return;
    const label = `${clean(school?.school_name) || "Gallery"} — parent gallery`;
    await shareOrCopy(url, label, showToast);
  }

  async function copyGallery() {
    const url = galleryUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied("gallery");
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      showToast("Could not copy");
    }
  }

  async function shareStudent(student: Student) {
    const pin = clean(student.pin);
    if (!pin || !school) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/parents?mode=school&school=${school.id}`;
    const name =
      [clean(student.first_name), clean(student.last_name)].filter(Boolean).join(" ") ||
      "your child";
    const schoolName = clean(school.school_name) || "School";
    const msg = `${schoolName} gallery is live. Visit ${url} and sign in with your email and PIN ${pin} to see ${name}'s photos.`;
    await shareOrCopy(url, msg, showToast);
  }

  async function copyPin(student: Student) {
    const pin = clean(student.pin);
    if (!pin) return;
    try {
      await navigator.clipboard.writeText(pin);
      setCopied(student.id);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      showToast("Could not copy PIN");
    }
  }

  if (loading) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <div
          style={{
            height: 160,
            borderRadius: 16,
            background: "#f3f4f6",
          }}
        />
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              height: 64,
              borderRadius: 12,
              background: "#f3f4f6",
            }}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          background: "#fef2f2",
          border: "1px solid #fecaca",
          color: "#991b1b",
          padding: "12px 14px",
          borderRadius: 12,
          fontSize: 14,
        }}
      >
        {error}
      </div>
    );
  }

  if (!school) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "#6b7280" }}>
        <GraduationCap size={28} color="#d1d5db" style={{ marginBottom: 10 }} />
        <div style={{ fontWeight: 800, color: "#111827", fontSize: 14 }}>
          School not found
        </div>
        <Link
          href="/m/schools"
          style={{
            display: "inline-flex",
            marginTop: 16,
            padding: "10px 16px",
            borderRadius: 999,
            background: "#111827",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 800,
            fontSize: 13,
          }}
        >
          Back to schools
        </Link>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Link
        href="/m/schools"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "#6b7280",
          textDecoration: "none",
          fontWeight: 700,
          fontSize: 13,
        }}
      >
        <ArrowLeft size={14} /> All schools
      </Link>

      {/* Hero — cover band + status pill + name */}
      <section
        style={{
          borderRadius: 18,
          background: "#fff",
          border: "1px solid #e5e7eb",
          overflow: "hidden",
          boxShadow: "0 4px 12px rgba(15,23,42,0.05)",
        }}
      >
        <div
          style={{
            position: "relative",
            height: 150,
            background: cover
              ? "#111"
              : "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)",
            overflow: "hidden",
          }}
        >
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "brightness(0.78)",
              }}
            />
          ) : (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(255,255,255,0.5)",
              }}
            >
              <GraduationCap size={40} />
            </div>
          )}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)",
            }}
          />
          <span
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 800,
              background: status.bg,
              color: status.fg,
              boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
            }}
          >
            {status.label}
          </span>
          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: 14,
              right: 14,
              color: "#fff",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", opacity: 0.9 }}>
              SCHOOL
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 900,
                marginTop: 2,
                lineHeight: 1.15,
                textShadow: "0 1px 3px rgba(0,0,0,0.5)",
              }}
            >
              {clean(school.school_name) || "Untitled school"}
            </div>
          </div>
        </div>

        {/* Gallery share block */}
        <div style={{ padding: 14, display: "grid", gap: 10 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              fontWeight: 800,
              color: "#6b7280",
            }}
          >
            PARENT GALLERY LINK
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#111827",
              background: "#f9fafb",
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: "10px 12px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {galleryUrl() || "—"}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={shareGallery}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "12px 14px",
                borderRadius: 12,
                background: "#111827",
                color: "#fff",
                border: "none",
                fontWeight: 800,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              <Share2 size={15} /> Share
            </button>
            <button
              type="button"
              onClick={copyGallery}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "12px 14px",
                borderRadius: 12,
                background: "#fff5f5",
                border: "1px solid #fecaca",
                color: "#cc0000",
                fontWeight: 800,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {copied === "gallery" ? <Check size={15} /> : <Copy size={15} />}
              {copied === "gallery" ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      </section>

      {/* Students list */}
      <section>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 8,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 900, color: "#111827" }}>
            Students ({students.length})
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#f3f4f6",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: "10px 12px",
            marginBottom: 10,
          }}
        >
          <Search size={16} color="#6b7280" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, class, PIN…"
            inputMode="search"
            autoComplete="off"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              fontSize: 14,
              fontWeight: 600,
              color: "#111827",
              minWidth: 0,
            }}
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#9ca3af",
                padding: 2,
                display: "inline-flex",
              }}
            >
              <X size={15} />
            </button>
          ) : null}
        </div>

        {filteredStudents.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "30px 20px",
              color: "#6b7280",
              border: "1px dashed #e5e7eb",
              borderRadius: 12,
            }}
          >
            {search ? "No matches" : "No students yet."}
          </div>
        ) : (
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: 8,
            }}
          >
            {filteredStudents.map((student) => {
              const revealed = !!revealedPins[student.id];
              const hasPin = !!clean(student.pin);
              const isFocused = focusStudentId === student.id;
              const name =
                [clean(student.first_name), clean(student.last_name)]
                  .filter(Boolean)
                  .join(" ") || "Student";
              return (
                <li
                  key={student.id}
                  data-student-id={student.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: 10,
                    background: "#fff",
                    border: isFocused
                      ? "2px solid #1d4ed8"
                      : "1px solid #e5e7eb",
                    borderRadius: 12,
                    alignItems: "center",
                    boxShadow: isFocused
                      ? "0 0 0 4px rgba(29,78,216,0.18)"
                      : undefined,
                    scrollMarginTop: 80,
                    transition:
                      "border-color 200ms ease, box-shadow 200ms ease",
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 48,
                      borderRadius: 8,
                      background: "#f3f4f6",
                      overflow: "hidden",
                      flexShrink: 0,
                    }}
                  >
                    {student.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={student.photo_url}
                        alt=""
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : null}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: "#111827",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "#6b7280",
                        marginTop: 2,
                      }}
                    >
                      {clean(student.class_name) || "—"}
                    </div>
                    {hasPin ? (
                      <button
                        type="button"
                        onClick={() => copyPin(student)}
                        style={{
                          marginTop: 4,
                          padding: "2px 8px",
                          borderRadius: 6,
                          background: revealed ? "#111827" : "#f3f4f6",
                          color: revealed ? "#fff" : "#374151",
                          border: "none",
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: "0.1em",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        PIN:{" "}
                        {revealed
                          ? clean(student.pin)
                          : "• • • •"}
                        {copied === student.id ? (
                          <Check size={11} />
                        ) : (
                          <Copy size={11} style={{ opacity: 0.6 }} />
                        )}
                      </button>
                    ) : (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          color: "#9ca3af",
                          fontStyle: "italic",
                        }}
                      >
                        No PIN set
                      </div>
                    )}
                  </div>
                  {hasPin ? (
                    <>
                      <button
                        type="button"
                        aria-label={revealed ? "Hide PIN" : "Show PIN"}
                        onClick={() =>
                          setRevealedPins((prev) => ({
                            ...prev,
                            [student.id]: !prev[student.id],
                          }))
                        }
                        style={{
                          flexShrink: 0,
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: "#fff",
                          border: "1px solid #e5e7eb",
                          color: "#374151",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button
                        type="button"
                        aria-label="Share login"
                        onClick={() => void shareStudent(student)}
                        style={{
                          flexShrink: 0,
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: "#fff5f5",
                          border: "1px solid #fecaca",
                          color: "#cc0000",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Share2 size={14} />
                      </button>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recent orders strip — inspired by the "Recent Activity" feed in the
          reference mockups.  Clicks drill into /m/orders/[id]. */}
      {orders.length > 0 ? (
        <section
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 16,
            padding: 4,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 12px 4px",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 900, color: "#111827" }}>
              Recent orders
            </div>
            <Link
              href={`/dashboard/projects/schools/${school.id}/orders`}
              style={{ fontSize: 12, fontWeight: 800, color: "#cc0000", textDecoration: "none" }}
            >
              View all
            </Link>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {orders.map((order, i) => {
              const s = single(order.student);
              const who =
                [clean(s?.first_name), clean(s?.last_name)]
                  .filter(Boolean)
                  .join(" ") ||
                clean(order.parent_name) ||
                clean(order.customer_name) ||
                "Customer";
              return (
                <li key={order.id}>
                  <Link
                    href={`/m/orders/${order.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      textDecoration: "none",
                      color: "inherit",
                      borderTop: i === 0 ? undefined : "1px solid #f3f4f6",
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 10,
                        background: "#fff5f5",
                        color: "#cc0000",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <ShoppingBag size={15} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          color: "#111827",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {who}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#6b7280",
                          marginTop: 2,
                        }}
                      >
                        #{shortId(order.id)} · {relativeTime(order.created_at)}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 900,
                        color: "#111827",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {money(order)}
                    </div>
                    <ChevronRight size={14} color="#9ca3af" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {toast ? (
        <div
          style={{
            position: "fixed",
            bottom: 90,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#111827",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 700,
            zIndex: 50,
            boxShadow: "0 10px 24px rgba(0,0,0,0.2)",
          }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
