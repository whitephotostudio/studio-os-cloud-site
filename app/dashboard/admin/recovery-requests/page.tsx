"use client";

// PIN recovery dashboard — pending Tier 3 queue + recent attempts log.
//
// Shows photographers two things:
//   1. PENDING — parents who tried to self-recover but failed door #3
//      (their email wasn't pre-registered).  One-click [Send recovery link]
//      verifies the student match and emails a 24-hour magic link.
//   2. RECENT — 200 most-recent attempts, success + failure, with IP + UA.
//      Useful for spotting brute-force attempts.
//
// Spec: docs/design/combine-orders-and-recovery.md (sections 4.5 + 9 + 8.4 + 8.5).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, RefreshCw, ShieldAlert, ShieldCheck, X } from "lucide-react";

type RequestRow = {
  id: string;
  parent_email: string;
  typed_first_name: string | null;
  typed_last_name: string | null;
  typed_school_label: string | null;
  school_id: string | null;
  project_id: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  requested_at: string;
  photographer_note: string | null;
  resolved_at: string | null;
};

type AttemptRow = {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  student_id: string | null;
  email_tried: string | null;
  first_name_tried: string | null;
  last_name_tried: string | null;
  school_id_tried: string | null;
  project_id_tried: string | null;
  succeeded: boolean;
  failure_reason: string | null;
  created_at: string;
};

type StudentMatch = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  class_name: string | null;
  school_name: string | null;
};

function fmt(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function shortId(id: string | null | undefined): string {
  if (!id) return "";
  return id.slice(0, 8).toUpperCase();
}

export default function RecoveryRequestsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/dashboard/admin/recovery", {
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json()) as {
        ok: boolean;
        message?: string;
        requests?: RequestRow[];
        attempts?: AttemptRow[];
      };
      if (!res.ok || !body.ok) {
        setError(body.message || "Could not load recovery data.");
        setRequests([]);
        setAttempts([]);
      } else {
        setRequests(body.requests ?? []);
        setAttempts(body.attempts ?? []);
      }
    } catch {
      setError("Network problem.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingRequests = useMemo(
    () => requests.filter((r) => r.status === "pending"),
    [requests],
  );
  const resolvedRequests = useMemo(
    () => requests.filter((r) => r.status !== "pending"),
    [requests],
  );

  return (
    <div style={{ minHeight: "100vh", background: "#faf7f7", padding: 24 }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <Link
            href="/dashboard"
            style={{ color: "#111", textDecoration: "none", fontSize: 14, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <ArrowLeft size={16} /> Dashboard
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid #111",
              background: "#fff",
              color: "#111",
              fontWeight: 700,
              fontSize: 13,
              cursor: loading ? "wait" : "pointer",
            }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        <div style={{ color: "#b91c1c", fontWeight: 800, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Parent Self-Service
        </div>
        <h1 style={{ margin: "4px 0 8px 0", fontSize: 28, fontWeight: 900, color: "#111" }}>
          PIN recovery requests
        </h1>
        <p style={{ margin: "0 0 24px 0", color: "#475569", fontSize: 14, maxWidth: 720 }}>
          Parents who can&rsquo;t pre-register or whose 5-door check fails land here. Find
          their student, click <strong>Send recovery link</strong>, and they&rsquo;ll get a
          24-hour magic link to their gallery without you having to copy-paste a PIN.
        </p>

        {error ? (
          <div style={{ padding: "12px 14px", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 12, marginBottom: 16, fontSize: 14, fontWeight: 700 }}>
            {error}
          </div>
        ) : null}

        {loading && requests.length === 0 && attempts.length === 0 ? (
          <div style={{ color: "#6b7280", fontSize: 14, fontWeight: 600 }}>Loading…</div>
        ) : (
          <>
            <PendingTable
              rows={pendingRequests}
              onResolved={() => void load()}
            />
            <ResolvedTable rows={resolvedRequests} />
            <AttemptsTable rows={attempts} />
          </>
        )}
      </div>
    </div>
  );
}

// ── Pending queue ────────────────────────────────────────────────────

function PendingTable({
  rows,
  onResolved,
}: {
  rows: RequestRow[];
  onResolved: () => void;
}) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 16,
        marginBottom: 20,
      }}
    >
      <h2 style={{ margin: "0 0 12px 0", fontSize: 15, fontWeight: 900, color: "#111" }}>
        Pending · {rows.length}
      </h2>
      {rows.length === 0 ? (
        <div style={{ color: "#15803d", fontWeight: 700, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <CheckCircle2 size={15} /> No pending recovery requests — every parent who needed help has been taken care of.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((row) => (
            <PendingRow key={row.id} row={row} onResolved={onResolved} />
          ))}
        </div>
      )}
    </section>
  );
}

function PendingRow({ row, onResolved }: { row: RequestRow; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<StudentMatch[] | null>(null);
  const [error, setError] = useState("");

  const lookup = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      // We use the existing spotlight/student search via Supabase client.
      const { createClient } = await import("@/lib/supabase/client");
      const sb = createClient();
      let q = sb
        .from("students")
        .select("id, first_name, last_name, class_name, schools!inner(school_name, photographer_id)")
        .ilike("first_name", row.typed_first_name ?? "%")
        .ilike("last_name", row.typed_last_name ?? "%")
        .limit(8);
      if (row.school_id) q = q.eq("school_id", row.school_id);
      const { data, error: err } = await q;
      if (err) throw err;
      const list: StudentMatch[] = (data ?? []).map((s) => {
        const schoolRow = Array.isArray(s.schools) ? s.schools[0] : s.schools;
        return {
          id: s.id as string,
          first_name: (s.first_name as string) ?? null,
          last_name: (s.last_name as string) ?? null,
          class_name: (s.class_name as string) ?? null,
          school_name: (schoolRow?.school_name as string) ?? null,
        };
      });
      setMatches(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed.");
    } finally {
      setBusy(false);
    }
  }, [row]);

  const sendLink = useCallback(
    async (studentId: string) => {
      setBusy(true);
      setError("");
      try {
        const res = await fetch("/api/dashboard/admin/recovery", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "approve",
            requestId: row.id,
            studentId,
          }),
        });
        const body = (await res.json()) as { ok: boolean; message?: string };
        if (!res.ok || !body.ok) throw new Error(body.message || "Could not send link.");
        onResolved();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Send failed.");
        setBusy(false);
      }
    },
    [row, onResolved],
  );

  const reject = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/dashboard/admin/recovery", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", requestId: row.id }),
      });
      const body = (await res.json()) as { ok: boolean; message?: string };
      if (!res.ok || !body.ok) throw new Error(body.message || "Could not reject.");
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reject failed.");
      setBusy(false);
    }
  }, [row, onResolved]);

  return (
    <div
      style={{
        border: "1px solid #fed7aa",
        background: "#fff7ed",
        borderRadius: 14,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#111", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <ShieldAlert size={15} color="#c2410c" />
            {row.typed_first_name || "?"} {row.typed_last_name || "?"}
          </div>
          <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
            <strong>Email:</strong> {row.parent_email}
            {row.typed_school_label ? <> · <strong>School:</strong> {row.typed_school_label}</> : null}
            {" · "}
            <span style={{ color: "#94a3b8" }}>{fmt(row.requested_at)}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {!matches ? (
            <button
              type="button"
              onClick={() => void lookup()}
              disabled={busy}
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                border: "1px solid #111",
                background: "#111",
                color: "#fff",
                fontWeight: 800,
                fontSize: 13,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              Find student
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void reject()}
            disabled={busy}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "#fff",
              color: "#475569",
              fontWeight: 700,
              fontSize: 13,
              cursor: busy ? "wait" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <X size={13} /> Dismiss
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ marginTop: 8, padding: "8px 10px", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
          {error}
        </div>
      ) : null}

      {matches && matches.length === 0 ? (
        <div style={{ marginTop: 10, fontSize: 13, color: "#475569", fontWeight: 600 }}>
          No matching students at your studio. Reach out to the parent — the name may be misspelled.
        </div>
      ) : null}

      {matches && matches.length > 0 ? (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {matches.map((m) => (
            <div
              key={m.id}
              style={{
                padding: "10px 12px",
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 800, color: "#111", fontSize: 13 }}>
                  {[m.first_name, m.last_name].filter(Boolean).join(" ") || "Student"}
                </div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
                  {m.school_name || "—"}
                  {m.class_name ? ` · ${m.class_name}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void sendLink(m.id)}
                disabled={busy}
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: "none",
                  background: "#cc0000",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: busy ? "wait" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <ShieldCheck size={13} /> Send recovery link
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── Resolved (read-only history) ─────────────────────────────────────

function ResolvedTable({ rows }: { rows: RequestRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 16,
        marginBottom: 20,
      }}
    >
      <h2 style={{ margin: "0 0 12px 0", fontSize: 15, fontWeight: 900, color: "#111" }}>
        Resolved · {rows.length}
      </h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#6b7280", fontWeight: 800, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>When</th>
              <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>Status</th>
              <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>Parent</th>
              <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>Student typed</th>
              <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", color: "#6b7280", whiteSpace: "nowrap" }}>{fmt(r.resolved_at || r.requested_at)}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", fontWeight: 800, color: r.status === "approved" ? "#15803d" : "#b91c1c" }}>
                  {r.status}
                </td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6" }}>{r.parent_email}</td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6" }}>
                  {[r.typed_first_name, r.typed_last_name].filter(Boolean).join(" ") || "—"}
                </td>
                <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", color: "#6b7280" }}>{r.photographer_note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Attempts log (audit) ─────────────────────────────────────────────

function AttemptsTable({ rows }: { rows: AttemptRow[] }) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        padding: 16,
      }}
    >
      <h2 style={{ margin: "0 0 12px 0", fontSize: 15, fontWeight: 900, color: "#111" }}>
        Recent attempts · {rows.length}
      </h2>
      {rows.length === 0 ? (
        <div style={{ color: "#6b7280", fontWeight: 600, fontSize: 13 }}>No attempts yet.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#6b7280", fontWeight: 800, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>When</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>Outcome</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>Email</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>Name</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>Reason</th>
                <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", color: "#6b7280", whiteSpace: "nowrap" }}>{fmt(a.created_at)}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", fontWeight: 800, color: a.succeeded ? "#15803d" : "#b91c1c" }}>
                    {a.succeeded ? "ok" : "fail"}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6" }}>{a.email_tried || "—"}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6" }}>
                    {[a.first_name_tried, a.last_name_tried].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", fontFamily: "ui-monospace, monospace", fontSize: 11, color: a.succeeded ? "#15803d" : "#b91c1c" }}>
                    {a.failure_reason || (a.succeeded ? "ok" : "—")}
                  </td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#6b7280" }}>
                    {a.ip_address || "—"} <span style={{ marginLeft: 4, color: "#cbd5e1" }}>{shortId(a.id)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
