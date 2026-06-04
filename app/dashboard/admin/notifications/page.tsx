"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  Eye,
  MousePointerClick,
  RefreshCw,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-is-mobile";
import type {
  OwnerActivity as ActivityRow,
  OwnerActivityReport,
  OwnerNotificationSettings,
} from "@/lib/owner-notification-types";

type ApiState = {
  settings: OwnerNotificationSettings;
  report: OwnerActivityReport;
  diagnostics: {
    configured: boolean;
    disabledByEnv: boolean;
    hasAppToken: boolean;
    hasUserKey: boolean;
    hasDevice: boolean;
    store: {
      mode: "redis" | "memory";
      hasUpstashEnv: boolean;
      redisAvailable: boolean;
      lastError: string | null;
    };
  };
};

const textPrimary = "#111827";
const textMuted = "#667085";
const borderSoft = "#e5e7eb";

const defaultState: ApiState = {
  settings: {
    activityTrackingEnabled: true,
    alertOnNewRegistration: true,
    alertOnNewSubscription: true,
    alertOnPaymentFailed: true,
    alertOnSubscriptionCanceled: true,
    alertOnHighIntentVisit: false,
    alertOnEverySiteVisit: false,
    alertOnMarketingClick: false,
    visitAlertCooldownMinutes: 30,
  },
  report: {
    activities: [],
    totals: {
      last24Hours: 0,
      pageViewsLast24Hours: 0,
      marketingClicksLast24Hours: 0,
      highIntentLast24Hours: 0,
    },
    topPages: [],
  },
  diagnostics: {
    configured: false,
    disabledByEnv: false,
    hasAppToken: false,
    hasUserKey: false,
    hasDevice: false,
    store: {
      mode: "memory",
      hasUpstashEnv: false,
      redisAvailable: false,
      lastError: null,
    },
  },
};

const toggleRows: Array<{
  key: keyof OwnerNotificationSettings;
  title: string;
  description: string;
  warning?: string;
}> = [
  {
    key: "activityTrackingEnabled",
    title: "Activity report",
    description: "Keep a quiet recent-history report of public website page views and CTA clicks.",
  },
  {
    key: "alertOnNewRegistration",
    title: "New photographer registered",
    description: "Send a phone alert when a new photographer account is created.",
  },
  {
    key: "alertOnNewSubscription",
    title: "New subscription",
    description: "Send a phone alert when a photographer starts a paid Studio OS subscription.",
  },
  {
    key: "alertOnPaymentFailed",
    title: "Payment failed",
    description: "Send a phone alert when Stripe reports a failed subscription payment.",
  },
  {
    key: "alertOnSubscriptionCanceled",
    title: "Subscription canceled",
    description: "Send a phone alert when a subscription is canceled.",
  },
  {
    key: "alertOnHighIntentVisit",
    title: "High-intent website visit",
    description: "Send a phone alert for pricing, sign-up, download, sample gallery, and comparison pages.",
  },
  {
    key: "alertOnMarketingClick",
    title: "CTA and sample-gallery clicks",
    description: "Send a phone alert when visitors click tracked marketing buttons.",
  },
  {
    key: "alertOnEverySiteVisit",
    title: "Every public site visit",
    description: "Send a phone alert for each public website page view.",
    warning: "This can get noisy. Use only when you are actively watching traffic.",
  },
];

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function activityLabel(activity: ActivityRow) {
  if (activity.type === "marketing_click") {
    return activity.label || activity.event || "Marketing click";
  }
  return "Page view";
}

function locationLabel(activity: ActivityRow) {
  return [activity.city, activity.region, activity.country].filter(Boolean).join(", ");
}

function ToggleRow({
  row,
  checked,
  onChange,
  saving,
}: {
  row: (typeof toggleRows)[number];
  checked: boolean;
  onChange: (next: boolean) => void;
  saving: boolean;
}) {
  return (
    <button
      type="button"
      disabled={saving}
      onClick={() => onChange(!checked)}
      style={{
        width: "100%",
        border: `1px solid ${checked ? "#bbf7d0" : borderSoft}`,
        background: checked ? "#f0fdf4" : "#fff",
        borderRadius: 16,
        padding: "15px 16px",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 16,
        cursor: saving ? "not-allowed" : "pointer",
        opacity: saving ? 0.72 : 1,
        textAlign: "left",
      }}
    >
      <span style={{ flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 750, color: textPrimary }}>
          {row.title}
        </span>
        <span style={{ display: "block", marginTop: 4, fontSize: 12, lineHeight: 1.5, color: textMuted }}>
          {row.description}
        </span>
        {row.warning ? (
          <span style={{ display: "block", marginTop: 5, fontSize: 12, color: "#9a3412", fontWeight: 650 }}>
            {row.warning}
          </span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          flex: "0 0 auto",
          marginTop: 1,
          width: 48,
          height: 28,
          borderRadius: 999,
          background: checked ? "#16a34a" : "#d1d5db",
          transition: "background 0.15s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 4,
            left: checked ? 24 : 4,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
            transition: "left 0.15s",
          }}
        />
      </span>
    </button>
  );
}

export default function AdminNotificationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const isMobile = useIsMobile();
  const [state, setState] = useState<ApiState>(defaultState);
  const [draft, setDraft] = useState<OwnerNotificationSettings>(defaultState.settings);
  const [loading, setLoading] = useState(true);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testingVisit, setTestingVisit] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const authHeaders = useCallback(async (contentType = false) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return {
      ...(contentType ? { "Content-Type": "application/json" } : {}),
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    };
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/dashboard/admin/notifications", {
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message || "Could not load notifications.");
      setState({
        settings: json.settings,
        report: json.report,
        diagnostics: json.diagnostics ?? defaultState.diagnostics,
      });
      setDraft(json.settings);
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "Could not load notifications.",
      });
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  async function savePatch(patch: Partial<OwnerNotificationSettings>, field: string) {
    const previous = draft;
    const optimistic = { ...draft, ...patch };
    setDraft(optimistic);
    setSavingField(field);
    setMessage(null);
    try {
      const res = await fetch("/api/dashboard/admin/notifications", {
        method: "PATCH",
        headers: await authHeaders(true),
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message || "Could not save notifications.");
      setState({
        settings: json.settings,
        report: json.report,
        diagnostics: json.diagnostics ?? state.diagnostics,
      });
      setDraft(json.settings);
      setMessage({ tone: "success", text: "Saved. New visits will use this setting." });
    } catch (err) {
      setDraft(previous);
      setMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "Could not save notifications.",
      });
    } finally {
      setSavingField(null);
    }
  }

  async function sendTestPush() {
    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/dashboard/admin/owner-notifications/test", {
        method: "POST",
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message || "Could not send test push.");
      const requestId =
        typeof json.result?.requestId === "string" ? ` Request: ${json.result.requestId}` : "";
      setMessage({ tone: "success", text: `Pushover accepted the test push.${requestId}` });
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "Could not send test push.",
      });
    } finally {
      setTesting(false);
    }
  }

  async function sendTestVisitAlert() {
    setTestingVisit(true);
    setMessage(null);
    try {
      const res = await fetch("/api/dashboard/admin/notifications/test-visit", {
        method: "POST",
        headers: await authHeaders(),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.message || "Could not send test site visit alert.");
      await load();
      const requestId =
        typeof json.result?.requestId === "string" ? ` Request: ${json.result.requestId}` : "";
      setMessage({
        tone: "success",
        text: `${json.message || "Test site visit alert sent."}${requestId}`,
      });
    } catch (err) {
      setMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "Could not send test site visit alert.",
      });
    } finally {
      setTestingVisit(false);
    }
  }

  const report = state.report;
  const diagnostics = state.diagnostics;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#eef3fa",
        padding: "32px 28px 60px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: textPrimary,
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Link href="/dashboard/admin/users" style={{ color: textMuted, display: "flex" }}>
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Notification Center</h1>
              <p style={{ fontSize: 13, color: textMuted, margin: "4px 0 0" }}>
                Control phone alerts and review recent public website activity.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={sendTestPush} disabled={testing} style={darkButton(testing)}>
              <BellRing size={14} />
              {testing ? "Sending..." : "Send Test Push"}
            </button>
            <button
              type="button"
              onClick={sendTestVisitAlert}
              disabled={testingVisit}
              style={lightButton(testingVisit)}
            >
              <Eye size={14} />
              {testingVisit ? "Testing..." : "Test Site Visit"}
            </button>
            <button type="button" onClick={load} disabled={loading} style={lightButton(loading)}>
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        </div>

        {message ? (
          <div
            style={{
              marginBottom: 16,
              borderRadius: 14,
              padding: "11px 14px",
              border: message.tone === "success" ? "1px solid #bbf7d0" : "1px solid #fecaca",
              background: message.tone === "success" ? "#f0fdf4" : "#fef2f2",
              color: message.tone === "success" ? "#166534" : "#991b1b",
              fontSize: 13,
              fontWeight: 650,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {message.tone === "success" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            {message.text}
          </div>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile
              ? "1fr"
              : "minmax(320px, 0.9fr) minmax(420px, 1.1fr)",
            gap: 18,
          }}
        >
          <section style={panelStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
              <div>
                <h2 style={sectionTitle}>Phone Alerts</h2>
                <p style={sectionSubtext}>Choose exactly what should interrupt you. Changes save immediately.</p>
              </div>
              <span style={autosaveBadge}>{savingField ? "Saving..." : "Auto-saves"}</span>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {toggleRows.map((row) => (
                <ToggleRow
                  key={row.key}
                  row={row}
                  checked={Boolean(draft[row.key])}
                  saving={savingField === row.key}
                  onChange={(next) => savePatch({ [row.key]: next }, row.key)}
                />
              ))}
            </div>

            <div style={diagnosticsCard}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <strong style={{ fontSize: 13 }}>Pushover status</strong>
                <span style={diagnostics.configured ? okBadge : warnBadge}>
                  {diagnostics.configured ? "Configured" : "Needs setup"}
                </span>
              </div>
              <div style={diagnosticsGrid}>
                <span>App token: {diagnostics.hasAppToken ? "found" : "missing"}</span>
                <span>User key: {diagnostics.hasUserKey ? "found" : "missing"}</span>
                <span>Disabled flag: {diagnostics.disabledByEnv ? "on" : "off"}</span>
                <span>Device lock: {diagnostics.hasDevice ? "set" : "all devices"}</span>
                <span>Activity store: {diagnostics.store.mode === "redis" ? "shared Redis" : "memory only"}</span>
                <span>Redis env: {diagnostics.store.hasUpstashEnv ? "found" : "missing"}</span>
              </div>
              {diagnostics.store.lastError ? (
                <div style={diagnosticsError}>
                  Redis issue: {diagnostics.store.lastError}
                </div>
              ) : null}
            </div>

            <div style={{ marginTop: 14, borderTop: `1px solid ${borderSoft}`, paddingTop: 14 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 750, marginBottom: 6 }}>
                Visit alert cooldown
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={draft.visitAlertCooldownMinutes}
                  disabled={savingField === "visitAlertCooldownMinutes"}
                  onChange={(event) => {
                    const minutes = Math.max(
                      1,
                      Math.min(1440, Number(event.target.value) || 30),
                    );
                    setDraft((prev) => ({
                      ...prev,
                      visitAlertCooldownMinutes: minutes,
                    }));
                  }}
                  onBlur={() => {
                    if (
                      draft.visitAlertCooldownMinutes !==
                      state.settings.visitAlertCooldownMinutes
                    ) {
                      savePatch(
                        { visitAlertCooldownMinutes: draft.visitAlertCooldownMinutes },
                        "visitAlertCooldownMinutes",
                      );
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  style={{
                    width: 90,
                    border: `1px solid ${borderSoft}`,
                    borderRadius: 12,
                    padding: "9px 10px",
                    fontSize: 13,
                    color: textPrimary,
                    background: "#fff",
                    opacity: savingField === "visitAlertCooldownMinutes" ? 0.72 : 1,
                  }}
                />
                <span style={{ fontSize: 12, color: textMuted }}>
                  minutes between repeat visit alerts for the same visitor and page.
                </span>
              </div>
            </div>
          </section>

          <section style={panelStyle}>
            <h2 style={sectionTitle}>Activity Report</h2>
            <p style={sectionSubtext}>Recent public website activity. Dashboard, parent galleries, and client galleries are excluded.</p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 10,
                margin: "16px 0",
              }}
            >
              <MetricCard icon={<Activity size={17} color="#6366f1" />} label="Last 24 hours" value={report.totals.last24Hours} />
              <MetricCard icon={<Eye size={17} color="#059669" />} label="Page views" value={report.totals.pageViewsLast24Hours} />
              <MetricCard icon={<MousePointerClick size={17} color="#2563eb" />} label="CTA clicks" value={report.totals.marketingClicksLast24Hours} />
              <MetricCard icon={<BellRing size={17} color="#dc2626" />} label="High intent" value={report.totals.highIntentLast24Hours} />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1.2fr",
                gap: 14,
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Top pages</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {report.topPages.length ? (
                    report.topPages.map((page) => (
                      <div key={page.path} style={compactRow}>
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {page.path}
                        </span>
                        <strong>{page.count}</strong>
                      </div>
                    ))
                  ) : (
                    <div style={emptyBox}>No page activity yet.</div>
                  )}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Recent activity</div>
                <div style={{ display: "grid", gap: 8, maxHeight: 520, overflowY: "auto", paddingRight: 2 }}>
                  {loading ? (
                    <div style={emptyBox}>Loading activity...</div>
                  ) : report.activities.length ? (
                    report.activities.map((activity) => (
                      <div key={activity.id} style={activityCard}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <strong style={{ fontSize: 13 }}>{activityLabel(activity)}</strong>
                          {activity.isHighIntent ? <span style={intentBadge}>High intent</span> : null}
                        </div>
                        <div style={{ marginTop: 5, fontSize: 12, color: textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {activity.path}
                        </div>
                        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11, color: textMuted }}>
                          <span>{formatDate(activity.receivedAt)}</span>
                          {activity.userAgentSummary ? <span>{activity.userAgentSummary}</span> : null}
                          {locationLabel(activity) ? <span>{locationLabel(activity)}</span> : null}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={emptyBox}>No activity recorded yet.</div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div style={{ border: `1px solid ${borderSoft}`, borderRadius: 16, background: "#fff", padding: "14px 15px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {icon}
        <span style={{ fontSize: 12, color: textMuted, fontWeight: 700 }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 850 }}>{value.toLocaleString("en-US")}</div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: "#fff",
  border: `1px solid ${borderSoft}`,
  borderRadius: 22,
  padding: 20,
  boxShadow: "0 18px 45px rgba(15,23,42,0.05)",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 850,
  margin: 0,
};

const sectionSubtext: React.CSSProperties = {
  fontSize: 13,
  color: textMuted,
  lineHeight: 1.5,
  margin: "4px 0 0",
};

function darkButton(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    border: "1px solid #111827",
    background: "#111827",
    color: "#fff",
    borderRadius: 12,
    padding: "9px 15px",
    fontSize: 13,
    fontWeight: 750,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
  };
}

function lightButton(disabled: boolean): React.CSSProperties {
  return {
    ...darkButton(disabled),
    border: `1px solid ${borderSoft}`,
    background: "#fff",
    color: textPrimary,
    fontWeight: 650,
  };
}

const compactRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  border: `1px solid ${borderSoft}`,
  borderRadius: 12,
  padding: "9px 11px",
  fontSize: 12,
  color: textPrimary,
};

const activityCard: React.CSSProperties = {
  border: `1px solid ${borderSoft}`,
  background: "#fff",
  borderRadius: 14,
  padding: "11px 12px",
};

const emptyBox: React.CSSProperties = {
  border: `1px dashed ${borderSoft}`,
  borderRadius: 14,
  padding: 16,
  color: textMuted,
  fontSize: 13,
  textAlign: "center",
};

const intentBadge: React.CSSProperties = {
  borderRadius: 999,
  background: "#fee2e2",
  color: "#991b1b",
  padding: "2px 8px",
  fontSize: 10,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const autosaveBadge: React.CSSProperties = {
  flex: "0 0 auto",
  borderRadius: 999,
  border: "1px solid #bbf7d0",
  background: "#f0fdf4",
  color: "#166534",
  padding: "6px 10px",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const diagnosticsCard: React.CSSProperties = {
  marginTop: 14,
  border: `1px solid ${borderSoft}`,
  background: "#f8fafc",
  borderRadius: 14,
  padding: "12px 13px",
};

const diagnosticsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
  gap: 8,
  marginTop: 10,
  fontSize: 12,
  color: textMuted,
};

const diagnosticsError: React.CSSProperties = {
  marginTop: 10,
  borderRadius: 10,
  background: "#fef2f2",
  color: "#991b1b",
  padding: "8px 10px",
  fontSize: 11,
  lineHeight: 1.45,
  overflowWrap: "anywhere",
};

const okBadge: React.CSSProperties = {
  borderRadius: 999,
  background: "#dcfce7",
  color: "#166534",
  padding: "3px 8px",
  fontSize: 10,
  fontWeight: 850,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const warnBadge: React.CSSProperties = {
  ...okBadge,
  background: "#fee2e2",
  color: "#991b1b",
};
