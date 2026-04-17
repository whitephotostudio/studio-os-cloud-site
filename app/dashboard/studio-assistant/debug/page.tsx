"use client";

// Studio Assistant — activity log / debug page.
//
// Tails the last N ai_action_logs rows for the signed-in photographer, with a
// manual refresh button and an optional auto-refresh (every 5s).  Read-only:
// nothing on this page mutates studio data.  Matches the existing dashboard
// premium look (inherits DashboardSidebar via the dashboard layout).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type LogRow = {
  id: string;
  intent: string | null;
  status: string | null;
  command_text: string | null;
  params: unknown;
  confidence: number | null;
  requires_confirmation: boolean | null;
  confirmed: boolean | null;
  result: unknown;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string | null;
};

const BORDER = "#e5e7eb";
const TEXT_PRIMARY = "#111827";
const TEXT_MUTED = "#667085";
const ACCENT = "#cc0000";

const AUTO_REFRESH_MS = 5_000;

export default function StudioAssistantDebugPage() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const firstLoadRef = useRef(true);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (opts.silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setHint(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }
      const res = await fetch("/api/studio-assistant/logs?limit=30", {
        method: "GET",
        credentials: "include",
        headers,
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        rows?: LogRow[];
        message?: string;
        hint?: string;
      };
      if (res.status === 401) {
        window.location.href = "/sign-in?redirect=/dashboard/studio-assistant/debug";
        return;
      }
      if (!res.ok || !json.ok) {
        setError(json.message ?? "Failed to load activity log.");
        if (json.hint) setHint(json.hint);
        return;
      }
      setRows(json.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      firstLoadRef.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => {
      void load({ silent: true });
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, load]);

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div style={{ minHeight: "100vh", background: "#ffffff" }}>
      <main style={{ flex: 1, padding: 32 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, marginBottom: 24 }}>
            <div>
              <Link
                href="/dashboard"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: TEXT_MUTED,
                  fontSize: 13,
                  fontWeight: 700,
                  textDecoration: "none",
                  marginBottom: 10,
                }}
              >
                <ArrowLeft size={13} /> Back to dashboard
              </Link>
              <div
                style={{
                  fontSize: 13,
                  letterSpacing: "0.12em",
                  fontWeight: 800,
                  color: TEXT_MUTED,
                }}
              >
                STUDIO ASSISTANT
              </div>
              <h1
                style={{
                  margin: "6px 0 0",
                  fontSize: 36,
                  lineHeight: 1.1,
                  color: TEXT_PRIMARY,
                  fontWeight: 900,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    background: "#fff5f5",
                    color: ACCENT,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Sparkles size={18} />
                </span>
                Activity log
              </h1>
              <p
                style={{
                  margin: "10px 0 0",
                  color: TEXT_MUTED,
                  fontSize: 14,
                  lineHeight: 1.7,
                  maxWidth: 680,
                }}
              >
                A live tail of every Studio Assistant command. Read-only view
                of the <code>ai_action_logs</code> table, scoped to your
                photographer account. Useful for smoke-testing and for
                auditing what the assistant has done.
              </p>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: TEXT_MUTED,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                Auto-refresh
              </label>
              <button
                type="button"
                onClick={() => load({ silent: false })}
                disabled={refreshing || loading}
                title="Refresh"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 14px",
                  borderRadius: 12,
                  border: `1px solid ${BORDER}`,
                  background: "#fff",
                  color: TEXT_PRIMARY,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: refreshing || loading ? "default" : "pointer",
                }}
              >
                <RefreshCw
                  size={14}
                  style={{
                    animation:
                      refreshing || loading
                        ? "sa-debug-spin 0.9s linear infinite"
                        : "none",
                  }}
                />
                Refresh
              </button>
            </div>
          </div>

          {error ? (
            <div
              style={{
                marginBottom: 18,
                padding: "14px 16px",
                borderRadius: 14,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <AlertTriangle size={16} style={{ marginTop: 2 }} />
                <div>
                  <div style={{ fontWeight: 800 }}>{error}</div>
                  {hint ? (
                    <div style={{ marginTop: 6, fontSize: 13, color: "#7f1d1d" }}>
                      {hint}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {loading && !refreshing ? (
            <div style={{ display: "grid", gap: 10 }}>
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  style={{
                    height: 72,
                    borderRadius: 14,
                    background: "#f3f4f6",
                  }}
                />
              ))}
            </div>
          ) : rows.length === 0 && !error ? (
            <div
              style={{
                padding: "32px 24px",
                borderRadius: 18,
                border: `1px dashed ${BORDER}`,
                textAlign: "center",
                color: TEXT_MUTED,
                fontSize: 14,
              }}
            >
              No assistant activity yet. Run a command from the dashboard to
              see rows here.
            </div>
          ) : (
            <div
              style={{
                border: `1px solid ${BORDER}`,
                borderRadius: 18,
                background: "#fff",
                overflow: "hidden",
              }}
            >
              {rows.map((row, idx) => {
                const isOpen = expanded.has(row.id);
                const status = (row.status ?? "").toLowerCase();
                const tone = statusTone(status);
                return (
                  <div
                    key={row.id}
                    style={{
                      borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                      background: idx % 2 === 0 ? "#fff" : "#fafbfc",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleRow(row.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "14px 18px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        display: "grid",
                        gridTemplateColumns: "20px 1fr auto auto auto",
                        gap: 14,
                        alignItems: "center",
                      }}
                    >
                      <span style={{ color: TEXT_MUTED }}>
                        {isOpen ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 13,
                            fontWeight: 800,
                            color: TEXT_PRIMARY,
                          }}
                        >
                          <span>{row.intent ?? "unknown"}</span>
                          {row.requires_confirmation ? (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 900,
                                letterSpacing: "0.1em",
                                padding: "2px 6px",
                                borderRadius: 999,
                                color: "#991b1b",
                                background: "#fef2f2",
                              }}
                            >
                              WRITE
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 900,
                                letterSpacing: "0.1em",
                                padding: "2px 6px",
                                borderRadius: 999,
                                color: "#1d4ed8",
                                background: "#eff6ff",
                              }}
                            >
                              READ
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            marginTop: 3,
                            fontSize: 12,
                            color: TEXT_MUTED,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: "100%",
                          }}
                          title={row.command_text ?? ""}
                        >
                          {row.command_text || "(no command text)"}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 900,
                          letterSpacing: "0.12em",
                          padding: "4px 10px",
                          borderRadius: 999,
                          color: tone.fg,
                          background: tone.bg,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        {tone.icon} {status.toUpperCase() || "PENDING"}
                      </span>
                      <span style={{ fontSize: 11, color: TEXT_MUTED, fontVariantNumeric: "tabular-nums" }}>
                        {typeof row.duration_ms === "number"
                          ? `${row.duration_ms}ms`
                          : "—"}
                      </span>
                      <span style={{ fontSize: 11, color: TEXT_MUTED, whiteSpace: "nowrap" }}>
                        {formatTime(row.created_at)}
                      </span>
                    </button>
                    {isOpen ? <ExpandedRow row={row} /> : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <style>{`
          @keyframes sa-debug-spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </main>
    </div>
  );
}

function ExpandedRow({ row }: { row: LogRow }) {
  return (
    <div
      style={{
        padding: "10px 18px 18px 52px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 14,
      }}
    >
      <Field label="PARAMS" value={row.params} />
      {row.error_message ? (
        <Field label="ERROR" value={row.error_message} tone="error" />
      ) : (
        <Field label="RESULT" value={row.result} />
      )}
      <Field
        label="CONFIDENCE"
        value={
          typeof row.confidence === "number"
            ? `${Math.round(row.confidence * 100)}%`
            : "—"
        }
      />
      <Field
        label="CONFIRMED"
        value={row.confirmed ? "yes" : row.requires_confirmation ? "no (rejected)" : "n/a"}
      />
    </div>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: unknown;
  tone?: "error";
}) {
  const display =
    value === null || value === undefined
      ? "—"
      : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : safeJson(value);
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          fontWeight: 800,
          color: TEXT_MUTED,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          fontSize: 12,
          lineHeight: 1.5,
          color: tone === "error" ? "#991b1b" : TEXT_PRIMARY,
          background: tone === "error" ? "#fef2f2" : "#fafbfc",
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          padding: "8px 10px",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 220,
          overflow: "auto",
        }}
      >
        {display}
      </pre>
    </div>
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusTone(status: string): {
  fg: string;
  bg: string;
  icon: React.ReactNode;
} {
  switch (status) {
    case "succeeded":
      return { fg: "#166534", bg: "#f0fdf4", icon: <CheckCircle2 size={11} /> };
    case "failed":
      return { fg: "#991b1b", bg: "#fef2f2", icon: <AlertTriangle size={11} /> };
    case "rejected":
      return { fg: "#9a3412", bg: "#fff7ed", icon: <AlertTriangle size={11} /> };
    default:
      return { fg: "#1d4ed8", bg: "#eff6ff", icon: <Clock3 size={11} /> };
  }
}
