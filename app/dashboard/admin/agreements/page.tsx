"use client";

// Admin-only audit view for photographer agreement acceptances.
//
// Shows:
//   - Summary of accepted vs outstanding for the current version.
//   - A list of photographers who have NOT accepted the current version.
//   - A history log of the 200 most-recent acceptances across all versions.
//
// Only platform admins can load this page; the API route enforces
// is_platform_admin and returns 403 otherwise.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";

type AcceptanceRow = {
  id: string;
  photographer_id: string;
  user_id: string;
  agreement_version: string;
  terms_version: string;
  privacy_version: string;
  accepted_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
};

type OutstandingPhotographer = {
  id: string;
  business_name: string | null;
  billing_email: string | null;
  studio_email: string | null;
  created_at: string | null;
};

type AuditPayload = {
  ok: boolean;
  agreementVersion: string;
  totalPhotographers: number;
  totalAccepted: number;
  outstanding: OutstandingPhotographer[];
  history: AcceptanceRow[];
  message?: string;
};

function fmtTimestamp(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function shortId(id: string | null | undefined): string {
  if (!id) return "";
  return id.slice(0, 8).toUpperCase();
}

export default function AdminAgreementsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<AuditPayload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/dashboard/admin/agreements", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      const body = (await res.json()) as AuditPayload;
      if (!res.ok || !body.ok) {
        setError(body.message || "Could not load agreement audit.");
        setData(null);
      } else {
        setData(body);
      }
    } catch {
      setError("Network problem loading the audit.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ minHeight: "100vh", background: "#faf7f7", padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
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
          Legal Audit
        </div>
        <h1 style={{ margin: "4px 0 24px 0", fontSize: 28, fontWeight: 900, color: "#111" }}>
          Photographer agreement acceptances
        </h1>

        {error ? (
          <div style={{ padding: "12px 14px", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 12, marginBottom: 16, fontSize: 14, fontWeight: 700 }}>
            {error}
          </div>
        ) : null}

        {loading && !data ? (
          <div style={{ color: "#6b7280", fontSize: 14, fontWeight: 600 }}>Loading…</div>
        ) : data ? (
          <>
            {/* Summary stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
              <Stat label="Current version" value={data.agreementVersion} mono />
              <Stat label="Total photographers" value={String(data.totalPhotographers)} />
              <Stat label="Accepted current" value={String(data.totalAccepted)} tone="green" />
              <Stat label="Outstanding" value={String(data.outstanding.length)} tone={data.outstanding.length === 0 ? "green" : "red"} />
            </div>

            {/* Outstanding photographers */}
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
                Outstanding · {data.outstanding.length}
              </h2>
              {data.outstanding.length === 0 ? (
                <div style={{ color: "#15803d", fontWeight: 700, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <CheckCircle2 size={15} /> Every active photographer has accepted the current agreement.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "#6b7280", fontWeight: 800, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>Business</th>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>Contact</th>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>Signed up</th>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.outstanding.map((p) => (
                        <tr key={p.id}>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", fontWeight: 700, color: "#111" }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <ShieldAlert size={14} color="#cc0000" />
                              {p.business_name || "Unnamed Studio"}
                            </span>
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", color: "#374151" }}>
                            {p.billing_email || p.studio_email || "—"}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", color: "#6b7280" }}>
                            {fmtTimestamp(p.created_at)}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", color: "#6b7280", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                            {shortId(p.id)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* History log */}
            <section
              style={{
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 16,
                padding: 16,
              }}
            >
              <h2 style={{ margin: "0 0 12px 0", fontSize: 15, fontWeight: 900, color: "#111" }}>
                Recent acceptances · {data.history.length}
              </h2>
              {data.history.length === 0 ? (
                <div style={{ color: "#6b7280", fontWeight: 600, fontSize: 13 }}>
                  No acceptance rows yet.
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "#6b7280", fontWeight: 800, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>When</th>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>Version</th>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>Photographer</th>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>IP</th>
                        <th style={{ padding: "8px 10px", borderBottom: "1px solid #e5e7eb" }}>User Agent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.history.map((h) => (
                        <tr key={h.id}>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", color: "#6b7280", whiteSpace: "nowrap" }}>
                            {fmtTimestamp(h.accepted_at)}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#111" }}>
                            {h.agreement_version}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", color: "#374151", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                            {shortId(h.photographer_id)}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: "1px solid #f3f4f6", color: "#374151", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                            {h.ip_address || "—"}
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              borderBottom: "1px solid #f3f4f6",
                              color: "#6b7280",
                              fontSize: 11,
                              maxWidth: 360,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={h.user_agent || ""}
                          >
                            {h.user_agent || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: "green" | "red";
  mono?: boolean;
}) {
  const color =
    tone === "green" ? "#15803d" : tone === "red" ? "#cc0000" : "#111";
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#6b7280",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: 22,
          fontWeight: 900,
          color,
          fontFamily: mono ? "ui-monospace, monospace" : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}
