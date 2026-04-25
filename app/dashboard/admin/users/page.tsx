"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-is-mobile";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  AlertCircle,
  Crown,
  RefreshCw,
  Users,
  Mail,
  Phone,
  MapPin,
  ChevronDown,
  ChevronUp,
  Search,
  Volume2,
  VolumeX,
  Sparkles,
} from "lucide-react";

type UserRow = {
  id: string;
  userId: string;
  fullName: string | null;
  businessName: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  subscriptionPlanCode: string | null;
  subscriptionBillingInterval: string | null;
  subscriptionStatus: string;
  subscriptionCurrentPeriodEnd: string | null;
  hasStripeSubscription: boolean;
  trialStartsAt: string | null;
  trialEndsAt: string | null;
  trialStatus: "active" | "expired" | "none" | "converted" | "owner";
  trialDaysRemaining: number;
  isPlatformAdmin: boolean;
  lastSignIn: string | null;
  createdAt: string | null;
  extraDesktopKeysPurchased?: number;
  photographyKeysActive?: number;
  photographyKeysTotal?: number;
  creditBalance?: number | null;
  creditTotalPurchased?: number;
  creditTotalUsed?: number;
  totalSpentCents?: number;
  voicePremiumEnabled?: boolean;
  voiceMonthlyCharLimit?: number;
  voiceCharsUsedThisMonth?: number;
  agreement?: {
    accepted: boolean;
    acceptedAt: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    agreementVersion: string | null;
  };
};

const NEW_SIGNUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isNewSignup(createdAt: string | null, since: Date | null): boolean {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  if (since && created > since) return true;
  return Date.now() - created.getTime() < NEW_SIGNUP_WINDOW_MS;
}

function formatMoney(cents: number | undefined | null) {
  const c = Number(cents ?? 0);
  return `$${(c / 100).toFixed(2)}`;
}

function formatNumber(value: number | undefined | null) {
  return Number(value ?? 0).toLocaleString("en-US");
}

const textPrimary = "#111827";
const textMuted = "#667085";
const borderSoft = "#e5e7eb";

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function relativeTime(value: string | null): string {
  if (!value) return "Never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Never";
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return formatDate(value);
}

function TrialBadge({ status, days }: { status: UserRow["trialStatus"]; days: number }) {
  const styles: Record<string, { color: string; bg: string; label: string }> = {
    active: { color: "#065f46", bg: "#d1fae5", label: `${days}d left` },
    expired: { color: "#991b1b", bg: "#fee2e2", label: "Expired" },
    converted: { color: "#1e40af", bg: "#dbeafe", label: "Subscribed" },
    owner: { color: "#92400e", bg: "#fef3c7", label: "Owner" },
    none: { color: textMuted, bg: "#f3f4f6", label: "No trial" },
  };
  const s = styles[status] || styles.none;
  const icons: Record<string, React.ReactNode> = {
    active: <Clock3 size={11} />,
    expired: <AlertCircle size={11} />,
    converted: <CheckCircle2 size={11} />,
    owner: <CheckCircle2 size={11} />,
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        color: s.color,
        background: s.bg,
        borderRadius: 999,
        padding: "2px 9px",
      }}
    >
      {icons[status] || null}
      {s.label}
    </span>
  );
}

function PlanBadge({ plan, interval }: { plan: string | null; interval: string | null }) {
  if (!plan) return <span style={{ fontSize: 12, color: textMuted }}>—</span>;
  const label = plan.charAt(0).toUpperCase() + plan.slice(1);
  const intLabel = interval === "year" ? " / yr" : interval === "month" ? " / mo" : "";
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "#4338ca",
        background: "#eef2ff",
        borderRadius: 999,
        padding: "2px 9px",
      }}
    >
      {label}{intLabel}
    </span>
  );
}

function VoicePanel({
  user,
  draft,
  onChangeDraft,
  onSave,
  onResetUsage,
  busy,
}: {
  user: UserRow;
  draft: { enabled: boolean; limit: number } | undefined;
  onChangeDraft: (next: { enabled: boolean; limit: number }) => void;
  onSave: () => void;
  onResetUsage: () => void;
  busy: boolean;
}) {
  const enabled = draft?.enabled ?? Boolean(user.voicePremiumEnabled);
  const limit = draft?.limit ?? Number(user.voiceMonthlyCharLimit ?? 1000);
  const used = Number(user.voiceCharsUsedThisMonth ?? 0);
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const dirty =
    enabled !== Boolean(user.voicePremiumEnabled) ||
    limit !== Number(user.voiceMonthlyCharLimit ?? 1000);
  const overLimit = enabled && used >= limit && limit > 0;

  return (
    <div
      style={{
        marginTop: 16,
        background: "#f9fafb",
        borderRadius: 14,
        padding: "16px 18px",
        fontSize: 13,
        border: `1px solid ${borderSoft}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontWeight: 700,
          fontSize: 13,
          marginBottom: 12,
        }}
      >
        {enabled ? (
          <Volume2 size={14} color="#059669" />
        ) : (
          <VolumeX size={14} color="#9ca3af" />
        )}
        Premium Voice (ElevenLabs)
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        {/* Enable toggle */}
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              onChangeDraft({ enabled: e.target.checked, limit })
            }
            style={{ width: 16, height: 16, cursor: "pointer" }}
          />
          {enabled ? "Enabled" : "Disabled"}
        </label>

        {/* Monthly limit */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: textMuted }}>Monthly cap</span>
          <input
            type="number"
            min={0}
            max={1_000_000}
            step={100}
            value={limit}
            disabled={!enabled}
            onChange={(e) =>
              onChangeDraft({
                enabled,
                limit: Math.max(
                  0,
                  Math.min(1_000_000, Number(e.target.value) || 0),
                ),
              })
            }
            style={{
              width: 90,
              padding: "6px 8px",
              borderRadius: 10,
              border: `1px solid ${borderSoft}`,
              fontSize: 12,
              textAlign: "right",
              opacity: enabled ? 1 : 0.5,
            }}
          />
          <span style={{ fontSize: 12, color: textMuted }}>chars / month</span>
        </div>

        <button
          disabled={busy || !dirty}
          onClick={onSave}
          style={{
            padding: "6px 14px",
            borderRadius: 10,
            border: "none",
            background: dirty ? "#059669" : "#d1d5db",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            cursor: dirty ? "pointer" : "default",
            whiteSpace: "nowrap",
            opacity: busy ? 0.6 : 1,
          }}
        >
          Save voice settings
        </button>
      </div>

      {/* Usage bar */}
      {enabled ? (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              color: textMuted,
              marginBottom: 4,
            }}
          >
            <span>
              {used.toLocaleString()} / {limit.toLocaleString()} chars used this
              month
            </span>
            <button
              onClick={onResetUsage}
              disabled={busy}
              style={{
                background: "none",
                border: "none",
                color: "#2563eb",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                padding: 0,
              }}
            >
              Reset usage
            </button>
          </div>
          <div
            style={{
              height: 6,
              background: "#e5e7eb",
              borderRadius: 999,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: overLimit ? "#dc2626" : pct > 80 ? "#f59e0b" : "#059669",
                transition: "width 0.2s",
              }}
            />
          </div>
          {overLimit ? (
            <div style={{ fontSize: 11, color: "#dc2626", marginTop: 6 }}>
              Limit reached — premium voice is paused for this user until next
              month or until you raise the cap or reset usage.
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: textMuted, lineHeight: 1.5 }}>
          When disabled, this photographer hears the browser&apos;s built-in voice
          for spoken assistant replies. Toggle on and click Save to grant
          premium voice access.
        </div>
      )}
    </div>
  );
}

export default function AdminUsersPage() {
  const supabase = createClient();
  const isMobile = useIsMobile();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [extendDays, setExtendDays] = useState<Record<string, number>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [newSinceLastVisit, setNewSinceLastVisit] = useState(0);
  const [previousSeenAt, setPreviousSeenAt] = useState<Date | null>(null);
  const [voiceDraft, setVoiceDraft] = useState<
    Record<string, { enabled: boolean; limit: number }>
  >({});

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      const res = await fetch("/api/dashboard/admin/users", { headers });
      const json = await res.json();
      if (!json.ok) {
        setError(json.message || "Unable to load users.");
        setIsAdmin(false);
        return;
      }
      setUsers(json.users || []);
      setIsAdmin(true);
      setNewSinceLastVisit(Number(json.newSinceLastVisit ?? 0));
      setPreviousSeenAt(
        json.previousSeenAt ? new Date(json.previousSeenAt) : null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function saveVoiceForUser(u: UserRow) {
    const draft = voiceDraft[u.id] ?? {
      enabled: Boolean(u.voicePremiumEnabled),
      limit: Number(u.voiceMonthlyCharLimit ?? 1000),
    };
    setActionBusy(u.id);
    setActionMessage(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
      };
      const res = await fetch("/api/dashboard/admin/users", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "update_voice",
          photographerId: u.id,
          voicePremiumEnabled: draft.enabled,
          voiceMonthlyCharLimit: draft.limit,
        }),
      });
      const json = await res.json();
      setActionMessage(json.message || (json.ok ? "Voice updated." : "Update failed."));
      if (json.ok) {
        await fetchUsers();
        setVoiceDraft((prev) => {
          const next = { ...prev };
          delete next[u.id];
          return next;
        });
      }
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Voice update failed.");
    } finally {
      setActionBusy(null);
    }
  }

  async function resetVoiceUsage(photographerId: string) {
    setActionBusy(photographerId);
    setActionMessage(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
      };
      const target = users.find((u) => u.id === photographerId);
      if (!target) return;
      const res = await fetch("/api/dashboard/admin/users", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "update_voice",
          photographerId,
          voicePremiumEnabled: Boolean(target.voicePremiumEnabled),
          voiceMonthlyCharLimit: Number(target.voiceMonthlyCharLimit ?? 1000),
          resetUsage: true,
        }),
      });
      const json = await res.json();
      setActionMessage(json.ok ? "Usage counter reset." : json.message ?? "Reset failed.");
      if (json.ok) await fetchUsers();
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleAction(
    action: "extend_trial" | "revoke_trial" | "delete_user",
    photographerId: string,
    confirmLabel?: string,
  ) {
    if (action === "delete_user") {
      const ok = window.confirm(
        `Permanently delete ${confirmLabel ?? "this account"}?\n\n` +
          "This removes the photographer record, all of their schools, projects, " +
          "orders, packages, and the auth user. This CANNOT be undone.",
      );
      if (!ok) return;
    }

    setActionBusy(photographerId);
    setActionMessage(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };

      const body: Record<string, unknown> = { action, photographerId };
      if (action === "extend_trial") {
        body.extraDays = extendDays[photographerId] || 30;
      }

      const res = await fetch("/api/dashboard/admin/users", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setActionMessage(json.message || (json.ok ? "Done." : "Action failed."));
      if (json.ok) {
        await fetchUsers();
      }
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setActionBusy(null);
    }
  }

  // Filter users by search query.
  const query = searchQuery.toLowerCase().trim();
  const filtered = query
    ? users.filter(
        (u) =>
          (u.fullName || "").toLowerCase().includes(query) ||
          (u.businessName || "").toLowerCase().includes(query) ||
          (u.email || "").toLowerCase().includes(query) ||
          (u.phone || "").toLowerCase().includes(query),
      )
    : users;

  const trialActiveCount = users.filter((u) => u.trialStatus === "active").length;
  const trialExpiredCount = users.filter((u) => u.trialStatus === "expired").length;
  const subscribedCount = users.filter((u) => u.trialStatus === "converted").length;

  if (!isAdmin && !loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#eef3fa",
          color: textPrimary,
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 18, fontWeight: 600 }}>Access denied</p>
          <p style={{ marginTop: 8, color: textMuted }}>{error || "Only platform admins can access this page."}</p>
          <Link
            href="/dashboard"
            style={{
              marginTop: 20,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 14,
              color: "#2563eb",
              textDecoration: "none",
            }}
          >
            <ArrowLeft size={14} /> Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#eef3fa",
        minHeight: "100vh",
        padding: isMobile ? "18px 14px 48px" : "32px 28px 60px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: textPrimary,
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 28,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Link href="/dashboard" style={{ color: textMuted, display: "flex" }}>
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Client Directory</h1>
              <p style={{ fontSize: 13, color: textMuted, margin: "4px 0 0" }}>
                All registered users — contact info, trial status &amp; subscriptions
              </p>
            </div>
          </div>
          <button
            onClick={() => fetchUsers()}
            disabled={loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 12,
              border: `1px solid ${borderSoft}`,
              background: "#fff",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              color: textPrimary,
            }}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: 14,
            marginBottom: 20,
          }}
        >
          {[
            { label: "Total users", value: users.length, icon: <Users size={18} color="#6366f1" />, bg: "#eef2ff" },
            { label: "Active trials", value: trialActiveCount, icon: <Clock3 size={18} color="#059669" />, bg: "#ecfdf5" },
            { label: "Expired trials", value: trialExpiredCount, icon: <AlertCircle size={18} color="#dc2626" />, bg: "#fef2f2" },
            { label: "Paid subscribers", value: subscribedCount, icon: <CheckCircle2 size={18} color="#2563eb" />, bg: "#eff6ff" },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                background: "#fff",
                borderRadius: 16,
                padding: "16px 18px",
                border: `1px solid ${borderSoft}`,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: stat.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 8,
                }}
              >
                {stat.icon}
              </div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{stat.value}</div>
              <div style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div style={{ marginBottom: 16, position: "relative" }}>
          <Search
            size={16}
            color={textMuted}
            style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }}
          />
          <input
            type="text"
            placeholder="Search by name, business, email, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 14px 10px 38px",
              borderRadius: 14,
              border: `1px solid ${borderSoft}`,
              background: "#fff",
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* New-signup callout */}
        {newSinceLastVisit > 0 ? (
          <div
            style={{
              marginBottom: 14,
              padding: "10px 16px",
              borderRadius: 12,
              background: "#fff7ed",
              border: "1px solid #fed7aa",
              fontSize: 13,
              color: "#9a3412",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Sparkles size={14} color="#c2410c" />
            {newSinceLastVisit === 1
              ? "1 new photographer registered"
              : `${newSinceLastVisit} new photographers registered`}{" "}
            {previousSeenAt
              ? `since ${previousSeenAt.toLocaleString()}.`
              : "(first visit — all users are new to you)."}
          </div>
        ) : null}

        {/* Action message */}
        {actionMessage ? (
          <div
            style={{
              marginBottom: 14,
              padding: "10px 16px",
              borderRadius: 12,
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              fontSize: 13,
              color: "#166534",
              fontWeight: 500,
            }}
          >
            {actionMessage}
          </div>
        ) : null}

        {/* User cards */}
        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            border: `1px solid ${borderSoft}`,
            overflow: isMobile ? "auto" : "hidden",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: textMuted }}>
              Loading clients...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: textMuted }}>
              {query ? "No matching users found." : "No registered users yet."}
            </div>
          ) : (
            <div style={{ minWidth: isMobile ? 820 : undefined }}>
              {/* Table header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 2fr 1fr 1fr 1fr 40px",
                  gap: 8,
                  padding: "10px 18px",
                  background: "#f9fafb",
                  borderBottom: `1px solid ${borderSoft}`,
                  fontSize: 11,
                  fontWeight: 600,
                  color: textMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                <div>Client</div>
                <div>Contact</div>
                <div>Trial</div>
                <div>Plan</div>
                <div>Last active</div>
                <div />
              </div>

              {/* Rows */}
              {filtered.map((u) => {
                const isExpanded = expandedId === u.id;
                return (
                  <div key={u.id} style={{ borderBottom: `1px solid ${borderSoft}` }}>
                    {/* Main row */}
                    <div
                      onClick={() => setExpandedId(isExpanded ? null : u.id)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "2fr 2fr 1fr 1fr 1fr 40px",
                        gap: 8,
                        padding: "14px 18px",
                        alignItems: "center",
                        cursor: "pointer",
                        fontSize: 13,
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {/* Client */}
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, flexWrap: "wrap" }}>
                          {u.isPlatformAdmin ? <Crown size={13} color="#f59e0b" /> : null}
                          {u.fullName || u.businessName || "—"}
                          {isNewSignup(u.createdAt, previousSeenAt) ? (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: "#9a3412",
                                background: "#fff7ed",
                                border: "1px solid #fed7aa",
                                borderRadius: 999,
                                padding: "1px 7px",
                                letterSpacing: "0.04em",
                              }}
                            >
                              NEW
                            </span>
                          ) : null}
                          {u.voicePremiumEnabled || u.isPlatformAdmin ? (
                            <Volume2
                              size={13}
                              color="#059669"
                              aria-label="Premium voice enabled"
                            />
                          ) : (
                            <VolumeX
                              size={13}
                              color="#9ca3af"
                              aria-label="Premium voice disabled"
                            />
                          )}
                        </div>
                        {u.fullName && u.businessName ? (
                          <div style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>
                            {u.businessName}
                          </div>
                        ) : null}
                      </div>

                      {/* Contact */}
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                          <Mail size={12} color={textMuted} />
                          {u.email}
                        </div>
                        {u.phone ? (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
                              fontSize: 12,
                              color: textMuted,
                              marginTop: 2,
                            }}
                          >
                            <Phone size={12} />
                            {u.phone}
                          </div>
                        ) : null}
                      </div>

                      {/* Trial */}
                      <div>
                        <TrialBadge status={u.trialStatus} days={u.trialDaysRemaining} />
                      </div>

                      {/* Plan */}
                      <div>
                        <PlanBadge plan={u.subscriptionPlanCode} interval={u.subscriptionBillingInterval} />
                      </div>

                      {/* Last active */}
                      <div style={{ fontSize: 12, color: textMuted }}>
                        {relativeTime(u.lastSignIn)}
                      </div>

                      {/* Expand */}
                      <div style={{ textAlign: "center", color: textMuted }}>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded ? (
                      <div style={{ padding: "0 18px 18px" }}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 16,
                        }}
                      >
                        {/* Left: details */}
                        <div
                          style={{
                            background: "#f9fafb",
                            borderRadius: 14,
                            padding: "16px 18px",
                            fontSize: 13,
                          }}
                        >
                          <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 13 }}>Client Details</div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Full name</span>
                            <span>{u.fullName || "—"}</span>
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Business</span>
                            <span>{u.businessName || "—"}</span>
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Email</span>
                            <a href={`mailto:${u.email}`} style={{ color: "#2563eb", textDecoration: "none" }}>{u.email}</a>
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Phone</span>
                            {u.phone ? (
                              <a href={`tel:${u.phone}`} style={{ color: "#2563eb", textDecoration: "none" }}>{u.phone}</a>
                            ) : (
                              <span style={{ color: textMuted }}>Not provided</span>
                            )}
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Address</span>
                            <span style={u.address ? {} : { color: textMuted }}>{u.address || "Not provided"}</span>
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Signed up</span>
                            <span>{formatDate(u.createdAt)}</span>
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Last sign-in</span>
                            <span>{relativeTime(u.lastSignIn)}</span>
                          </div>
                        </div>

                        {/* Right: subscription + trial actions */}
                        <div
                          style={{
                            background: "#f9fafb",
                            borderRadius: 14,
                            padding: "16px 18px",
                            fontSize: 13,
                          }}
                        >
                          <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 13 }}>Subscription &amp; Trial</div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Status</span>
                            <span style={{ textTransform: "capitalize" }}>{u.subscriptionStatus}</span>
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Plan</span>
                            <PlanBadge plan={u.subscriptionPlanCode} interval={u.subscriptionBillingInterval} />
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Stripe sub</span>
                            <span style={u.hasStripeSubscription ? { color: "#059669", fontWeight: 600 } : { color: textMuted }}>
                              {u.hasStripeSubscription ? "Yes (paid)" : "None"}
                            </span>
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Period ends</span>
                            <span>{formatDate(u.subscriptionCurrentPeriodEnd)}</span>
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Trial started</span>
                            <span>{formatDate(u.trialStartsAt)}</span>
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Trial ends</span>
                            <span>{formatDate(u.trialEndsAt)}</span>
                          </div>

                          {/* Trial actions */}
                          {!u.isPlatformAdmin ? (
                            <div
                              style={{
                                marginTop: 14,
                                paddingTop: 14,
                                borderTop: `1px solid ${borderSoft}`,
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                flexWrap: "wrap",
                              }}
                            >
                              <input
                                type="number"
                                min={1}
                                max={365}
                                value={extendDays[u.id] ?? 30}
                                onChange={(e) =>
                                  setExtendDays((prev) => ({
                                    ...prev,
                                    [u.id]: Number(e.target.value) || 30,
                                  }))
                                }
                                style={{
                                  width: 56,
                                  padding: "6px 8px",
                                  borderRadius: 10,
                                  border: `1px solid ${borderSoft}`,
                                  fontSize: 12,
                                  textAlign: "center",
                                }}
                              />
                              <span style={{ fontSize: 12, color: textMuted }}>days</span>
                              <button
                                disabled={actionBusy === u.id}
                                onClick={() => handleAction("extend_trial", u.id)}
                                style={{
                                  padding: "6px 14px",
                                  borderRadius: 10,
                                  border: "none",
                                  background: "#2563eb",
                                  color: "#fff",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                  opacity: actionBusy === u.id ? 0.6 : 1,
                                }}
                              >
                                Extend Trial
                              </button>
                              {u.trialStatus === "active" ? (
                                <button
                                  disabled={actionBusy === u.id}
                                  onClick={() => handleAction("revoke_trial", u.id)}
                                  style={{
                                    padding: "6px 14px",
                                    borderRadius: 10,
                                    border: "1px solid #fecaca",
                                    background: "#fff",
                                    color: "#dc2626",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                    opacity: actionBusy === u.id ? 0.6 : 1,
                                  }}
                                >
                                  Revoke Trial
                                </button>
                              ) : null}
                              <button
                                disabled={actionBusy === u.id}
                                onClick={() =>
                                  handleAction(
                                    "delete_user",
                                    u.id,
                                    u.email || u.businessName || u.fullName || "this account",
                                  )
                                }
                                style={{
                                  padding: "6px 14px",
                                  borderRadius: 10,
                                  border: "1px solid #dc2626",
                                  background: "#dc2626",
                                  color: "#fff",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                  opacity: actionBusy === u.id ? 0.6 : 1,
                                }}
                              >
                                Delete Account
                              </button>
                            </div>
                          ) : (
                            <div style={{ marginTop: 12, fontSize: 12, color: textMuted }}>
                              Admin account — trial management not applicable.
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Keys, Credits & Spending — full-width strip below the 2-col grid */}
                      <div
                        style={{
                          marginTop: 16,
                          background: "#f9fafb",
                          borderRadius: 14,
                          padding: "16px 18px",
                          fontSize: 13,
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr",
                          gap: 18,
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13 }}>Photography Keys</div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Active keys</span>
                            <span>{formatNumber(u.photographyKeysActive)}</span>
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Total provisioned</span>
                            <span>{formatNumber(u.photographyKeysTotal)}</span>
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Extra keys purchased</span>
                            <span>{formatNumber(u.extraDesktopKeysPurchased)}</span>
                          </div>
                        </div>

                        <div>
                          <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13 }}>Background Credits</div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Current balance</span>
                            <span>
                              {u.isPlatformAdmin
                                ? "Unlimited"
                                : formatNumber(u.creditBalance ?? 0)}
                            </span>
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Total purchased</span>
                            <span>{formatNumber(u.creditTotalPurchased)}</span>
                          </div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Total used</span>
                            <span>{formatNumber(u.creditTotalUsed)}</span>
                          </div>
                        </div>

                        <div>
                          <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13 }}>Lifetime Spending</div>
                          <div style={detailRow}>
                            <span style={detailLabel}>Credit packs</span>
                            <span style={{ fontWeight: 700, color: "#059669" }}>
                              {formatMoney(u.totalSpentCents)}
                            </span>
                          </div>
                          <div style={{ marginTop: 8, fontSize: 11, color: textMuted, lineHeight: 1.4 }}>
                            Subscription charges (monthly/yearly plan fees) are billed by Stripe and not summarized here.
                          </div>
                        </div>
                      </div>

                      {/* Agreement acceptance — surfaces the current Studio OS Cloud
                          legal agreement status for this photographer.  Replaces the
                          old standalone /dashboard/admin/agreements page.  Shows a
                          green pill + accepted timestamp + IP when accepted, an
                          orange "Outstanding" pill otherwise. */}
                      <div
                        style={{
                          marginTop: 16,
                          background: u.agreement?.accepted ? "#f0fdf4" : "#fff7ed",
                          border: u.agreement?.accepted ? "1px solid #bbf7d0" : "1px solid #fed7aa",
                          borderRadius: 14,
                          padding: "14px 18px",
                          fontSize: 13,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 14,
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 13,
                              color: u.agreement?.accepted ? "#166534" : "#9a3412",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <span style={{ fontSize: 14 }}>
                              {u.agreement?.accepted ? "✓" : "⚠"}
                            </span>
                            Studio OS Cloud Agreement
                            {u.agreement?.agreementVersion ? (
                              <span
                                style={{
                                  marginLeft: 6,
                                  fontFamily: "ui-monospace, monospace",
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: u.agreement?.accepted ? "#166534" : "#9a3412",
                                  opacity: 0.8,
                                }}
                              >
                                {u.agreement.agreementVersion}
                              </span>
                            ) : null}
                          </div>
                          <div style={{ marginTop: 4, fontSize: 12, color: u.agreement?.accepted ? "#15803d" : "#9a3412" }}>
                            {u.agreement?.accepted
                              ? `Accepted ${u.agreement.acceptedAt ? new Date(u.agreement.acceptedAt).toLocaleString() : ""}`
                              : "Outstanding — this photographer has not accepted the current agreement yet."}
                          </div>
                          {u.agreement?.accepted && u.agreement.ipAddress ? (
                            <div
                              style={{
                                marginTop: 4,
                                fontSize: 11,
                                fontFamily: "ui-monospace, monospace",
                                color: "#6b7280",
                              }}
                              title={u.agreement.userAgent ?? undefined}
                            >
                              From {u.agreement.ipAddress}
                            </div>
                          ) : null}
                        </div>
                        <span
                          style={{
                            padding: "6px 12px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 800,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            background: u.agreement?.accepted ? "#bbf7d0" : "#fed7aa",
                            color: u.agreement?.accepted ? "#14532d" : "#7c2d12",
                          }}
                        >
                          {u.agreement?.accepted ? "Accepted" : "Outstanding"}
                        </span>
                      </div>

                      {/* Voice access control — admin-only, not shown for self */}
                      {u.isPlatformAdmin ? (
                        <div
                          style={{
                            marginTop: 16,
                            background: "#f0fdf4",
                            borderRadius: 14,
                            padding: "16px 18px",
                            fontSize: 13,
                            border: "1px solid #bbf7d0",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                            <Volume2 size={14} color="#059669" />
                            Premium Voice (ElevenLabs) — Admin
                          </div>
                          <div style={{ fontSize: 12, color: "#166534" }}>
                            Admin accounts have unlimited premium voice usage. No quota applies.
                          </div>
                        </div>
                      ) : (
                        <VoicePanel
                          user={u}
                          draft={voiceDraft[u.id]}
                          onChangeDraft={(next) =>
                            setVoiceDraft((prev) => ({ ...prev, [u.id]: next }))
                          }
                          onSave={() => saveVoiceForUser(u)}
                          onResetUsage={() => resetVoiceUsage(u.id)}
                          busy={actionBusy === u.id}
                        />
                      )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const detailRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "5px 0",
  borderBottom: "1px solid #f0f0f0",
};

const detailLabel: React.CSSProperties = {
  fontSize: 12,
  color: textMuted,
  fontWeight: 500,
};
