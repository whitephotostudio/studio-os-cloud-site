"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Download,
  KeyRound,
  Receipt,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/* ───────── Types ───────── */

type RecentInvoice = {
  id: string;
  status: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  created: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
};

type PhotographyKey = {
  id: string;
  label: string;
  keyCode: string;
  status: "active" | "suspended" | "revoked";
  slotIndex: number;
  isExtraKey: boolean;
  activationStatus: "active" | "inactive";
  deviceId: string | null;
  deviceName: string | null;
  platform: string | null;
  activatedAt: string | null;
  lastValidatedAt: string | null;
};

type MembershipData = {
  // From /api/stripe/status
  subscriptionPlanCode: string | null;
  subscriptionBillingInterval: string | null;
  subscriptionStatus: string;
  subscriptionIsActive: boolean;
  subscriptionCurrentPeriodStart: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  isPlatformAdmin: boolean;
  creditBalance: number;
  trialActive: boolean;
  trialExpired: boolean;
  trialDaysRemaining: number;
  trialStartsAt: string | null;
  trialEndsAt: string | null;
  recentInvoices: RecentInvoice[];
  extraDesktopKeys: number;
  businessName: string;
  billingEmail: string;
  defaultPaymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
  // From /api/studio-os-app/status
  keys: PhotographyKey[];
  entitlement: {
    includedKeys: number;
    extraKeys: number;
    totalAllowedKeys: number;
    subscriptionActive: boolean;
    isPlatformAdmin: boolean;
  };
};

/* ───────── Styles ───────── */

const textPrimary = "#0f172a";
const textMuted = "#64748b";
const borderSoft = "#e5e7eb";
const bgPage = "#eef3fa";

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 24,
  padding: "28px 26px",
  border: `1px solid ${borderSoft}`,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: textMuted,
};

const headingStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 900,
  color: textPrimary,
  marginTop: 2,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 0",
  borderBottom: `1px solid #f0f0f0`,
  fontSize: 14,
};

const rowLabelStyle: React.CSSProperties = {
  color: textMuted,
  fontSize: 13,
};

/* ───────── Helpers ───────── */

function formatMoney(cents: number, currency?: string) {
  const c = (currency ?? "usd").toUpperCase();
  const dollars = (cents / 100).toFixed(2);
  if (c === "USD") return `$${dollars}`;
  if (c === "CAD") return `C$${dollars}`;
  return `${dollars} ${c}`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function humanPlan(code: string | null, interval: string | null) {
  if (!code) return "No plan";
  const label = code === "studio" ? "Studio" : code === "core" ? "App Plan" : code === "starter" ? "Web Gallery" : code;
  return `${label} / ${interval === "year" ? "yr" : "mo"}`;
}

function humanStatus(status: string | null | undefined) {
  if (!status) return "Inactive";
  const s = status.toLowerCase();
  if (s === "active") return "Active";
  if (s === "trialing" || s === "trial") return "Trial";
  if (s === "past_due") return "Past due";
  if (s === "canceled" || s === "cancelled") return "Cancelled";
  if (s === "inactive") return "Inactive";
  return status;
}

function invoiceStatusColor(status: string | null | undefined) {
  const s = (status ?? "").toLowerCase();
  if (s === "paid") return { color: "#059669", bg: "#ecfdf5" };
  if (s === "open") return { color: "#d97706", bg: "#fffbeb" };
  if (s === "void" || s === "uncollectible") return { color: "#dc2626", bg: "#fef2f2" };
  return { color: textMuted, bg: "#f8fafc" };
}

/* ───────── Component ───────── */

/* ───────── Cancel Confirmation Dialog ───────── */

function CancelConfirmationDialog({
  open,
  onClose,
  onConfirm,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim().toUpperCase() === "DELETE MY PHOTOS";

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 24,
          maxWidth: 520,
          width: "90vw",
          padding: "36px 32px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "#fef2f2",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <AlertTriangle size={28} color="#dc2626" />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#dc2626" }}>
              Cancel Membership
            </div>
            <div style={{ fontSize: 13, color: textMuted, marginTop: 2 }}>
              This action is permanent and cannot be undone
            </div>
          </div>
        </div>

        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 16,
            padding: "20px 18px",
            marginBottom: 20,
            lineHeight: 1.7,
          }}
        >
          <div style={{ fontWeight: 800, color: "#991b1b", fontSize: 14, marginBottom: 8 }}>
            WARNING — Read carefully:
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "#7f1d1d", fontSize: 13.5 }}>
            <li style={{ marginBottom: 6 }}>
              <strong>ALL your photos will be permanently deleted</strong> from our servers
              immediately.
            </li>
            <li style={{ marginBottom: 6 }}>
              This includes every gallery, album, school project, and backdrop you have uploaded.
            </li>
            <li style={{ marginBottom: 6 }}>
              Your clients will <strong>lose access</strong> to all their galleries and will no
              longer be able to view or download any photos.
            </li>
            <li style={{ marginBottom: 6 }}>
              <strong>There is no undo.</strong> Once deleted, photos cannot be recovered — ever.
            </li>
            <li>
              If you want to keep your photos, download them from your galleries <strong>before</strong>{" "}
              cancelling.
            </li>
          </ul>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 700,
              color: textPrimary,
              marginBottom: 8,
            }}
          >
            Type <span style={{ color: "#dc2626", fontFamily: "monospace", background: "#fef2f2", padding: "2px 6px", borderRadius: 6 }}>DELETE MY PHOTOS</span> to confirm:
          </label>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="DELETE MY PHOTOS"
            style={{
              width: "100%",
              border: `2px solid ${confirmed ? "#dc2626" : borderSoft}`,
              borderRadius: 12,
              padding: "12px 14px",
              fontSize: 15,
              fontFamily: "monospace",
              fontWeight: 700,
              outline: "none",
              color: textPrimary,
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              border: `1px solid ${borderSoft}`,
              borderRadius: 12,
              padding: "12px 24px",
              fontWeight: 700,
              fontSize: 14,
              background: "#fff",
              color: textPrimary,
              cursor: "pointer",
            }}
          >
            Keep My Membership
          </button>
          <button
            onClick={onConfirm}
            disabled={!confirmed || loading}
            style={{
              border: "none",
              borderRadius: 12,
              padding: "12px 24px",
              fontWeight: 700,
              fontSize: 14,
              background: confirmed && !loading ? "#dc2626" : "#e5e7eb",
              color: confirmed && !loading ? "#fff" : "#9ca3af",
              cursor: confirmed && !loading ? "pointer" : "not-allowed",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Trash2 size={15} />
            {loading ? "Cancelling..." : "Cancel & Delete Everything"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MembershipPage() {
  const [data, setData] = useState<MembershipData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invoiceFilter, setInvoiceFilter] = useState("");
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const fetchedRef = useRef(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      const [stripeRes, appRes] = await Promise.all([
        fetch("/api/stripe/status", { headers, cache: "no-store" }),
        fetch("/api/studio-os-app/status", { headers, cache: "no-store" }),
      ]);

      const stripe = await stripeRes.json();
      const app = await appRes.json();

      if (!stripe.ok && stripe.message) {
        setError(stripe.message);
        setLoading(false);
        return;
      }

      setData({
        subscriptionPlanCode: stripe.subscriptionPlanCode ?? null,
        subscriptionBillingInterval: stripe.subscriptionBillingInterval ?? null,
        subscriptionStatus: stripe.subscriptionStatus ?? "inactive",
        subscriptionIsActive: Boolean(stripe.subscriptionIsActive),
        subscriptionCurrentPeriodStart: stripe.subscriptionCurrentPeriodStart ?? null,
        subscriptionCurrentPeriodEnd: stripe.subscriptionCurrentPeriodEnd ?? null,
        isPlatformAdmin: Boolean(stripe.isPlatformAdmin),
        creditBalance: Number(stripe.creditBalance ?? 0),
        trialActive: Boolean(stripe.trialActive),
        trialExpired: Boolean(stripe.trialExpired),
        trialDaysRemaining: Number(stripe.trialDaysRemaining ?? 0),
        trialStartsAt: stripe.trialStartsAt ?? null,
        trialEndsAt: stripe.trialEndsAt ?? null,
        recentInvoices: Array.isArray(stripe.recentInvoices) ? stripe.recentInvoices : [],
        extraDesktopKeys: Number(stripe.extraDesktopKeys ?? 0),
        businessName: stripe.businessName ?? "",
        billingEmail: stripe.billingEmail ?? "",
        defaultPaymentMethod: stripe.defaultPaymentMethod ?? null,
        keys: Array.isArray(app.keys) ? app.keys : [],
        entitlement: app.entitlement ?? {
          includedKeys: 0,
          extraKeys: 0,
          totalAllowedKeys: 0,
          subscriptionActive: false,
          isPlatformAdmin: false,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load membership data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      loadData();
    }
  }, [loadData]);

  const handleCancelMembership = useCallback(async () => {
    setCancelLoading(true);
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("Not signed in");

      // Open the Stripe billing portal where user can confirm cancellation
      const res = await fetch("/api/stripe/billing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "portal" }),
      });

      const json = await res.json();
      if (json.url) {
        window.location.href = json.url;
      } else {
        throw new Error(json.message || "Failed to open billing portal");
      }
    } catch (err: any) {
      alert(err.message || "Something went wrong. Please try again.");
      setCancelLoading(false);
    }
  }, []);

  const filteredInvoices = useMemo(() => {
    if (!data) return [];
    const query = invoiceFilter.toLowerCase().trim();
    if (!query) return data.recentInvoices;
    return data.recentInvoices.filter((inv) => {
      const date = formatDate(inv.created).toLowerCase();
      const amount = formatMoney(inv.amountPaid || inv.amountDue, inv.currency).toLowerCase();
      const id = inv.id.toLowerCase();
      const status = (inv.status ?? "").toLowerCase();
      return date.includes(query) || amount.includes(query) || id.includes(query) || status.includes(query);
    });
  }, [data, invoiceFilter]);

  const activeKeys = data?.keys.filter((k) => k.status === "active") ?? [];
  const suspendedKeys = data?.keys.filter((k) => k.status === "suspended" || k.status === "revoked") ?? [];

  return (
    <div style={{ background: bgPage, minHeight: "100vh", padding: "32px 28px 60px" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <Link
            href="/dashboard/settings"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#2563eb", textDecoration: "none", fontSize: 13, fontWeight: 700, marginBottom: 12 }}
          >
            <ArrowLeft size={14} /> Back to Settings
          </Link>
          <h1 style={{ fontSize: 40, fontWeight: 900, color: textPrimary, lineHeight: 1.1 }}>
            Membership
          </h1>
          <p style={{ marginTop: 10, fontSize: 16, color: textMuted, lineHeight: 1.6, maxWidth: 700 }}>
            Your plan, photography keys, background credits, and billing history — all in one place.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
          <button
            onClick={loadData}
            disabled={loading}
            style={{
              border: `1px solid ${borderSoft}`,
              borderRadius: 16,
              background: "#fff",
              padding: "10px 16px",
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              color: textPrimary,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
              fontSize: 13,
            }}
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {error ? (
          <div style={{ marginBottom: 20, borderRadius: 18, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", padding: "16px 18px", fontWeight: 700, fontSize: 14 }}>
            {error}
          </div>
        ) : null}

        <CancelConfirmationDialog
          open={showCancelDialog}
          onClose={() => { setShowCancelDialog(false); setCancelLoading(false); }}
          onConfirm={handleCancelMembership}
          loading={cancelLoading}
        />

        {data ? (
          <>
            {/* ── Row 1: Plan overview + Payment method ── */}
            <div style={{ display: "grid", gap: 20, gridTemplateColumns: "1.4fr 1fr", marginBottom: 20 }}>
              {/* Plan overview card */}
              <div style={cardStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
                  <div style={{ width: 50, height: 50, borderRadius: 14, background: "#eef2ff", display: "grid", placeItems: "center" }}>
                    <Shield size={22} color="#4f46e5" />
                  </div>
                  <div>
                    <div style={labelStyle}>Your Plan</div>
                    <div style={headingStyle}>{humanPlan(data.subscriptionPlanCode, data.subscriptionBillingInterval)}</div>
                  </div>
                </div>

                <div style={rowStyle}>
                  <span style={rowLabelStyle}>Status</span>
                  <span style={{
                    fontWeight: 700,
                    color: data.isPlatformAdmin
                      ? "#92400e"
                      : data.subscriptionIsActive ? "#059669" : data.trialActive ? "#2563eb" : "#dc2626",
                  }}>
                    {data.isPlatformAdmin ? "Owner (never expires)" : humanStatus(data.subscriptionStatus)}
                  </span>
                </div>

                {data.trialActive && !data.isPlatformAdmin ? (
                  <div style={rowStyle}>
                    <span style={rowLabelStyle}>Trial remaining</span>
                    <span style={{ fontWeight: 700, color: "#2563eb" }}>
                      {data.trialDaysRemaining} day{data.trialDaysRemaining !== 1 ? "s" : ""}
                    </span>
                  </div>
                ) : null}

                {data.trialExpired && !data.isPlatformAdmin ? (
                  <div style={rowStyle}>
                    <span style={rowLabelStyle}>Trial</span>
                    <span style={{ fontWeight: 700, color: "#dc2626" }}>Expired</span>
                  </div>
                ) : null}

                <div style={rowStyle}>
                  <span style={rowLabelStyle}>Billing email</span>
                  <span style={{ fontWeight: 600 }}>{data.billingEmail || "—"}</span>
                </div>

                {data.subscriptionCurrentPeriodEnd && !data.isPlatformAdmin ? (
                  <div style={rowStyle}>
                    <span style={rowLabelStyle}>Current period ends</span>
                    <span>{formatDate(data.subscriptionCurrentPeriodEnd)}</span>
                  </div>
                ) : null}

                {data.trialStartsAt ? (
                  <div style={rowStyle}>
                    <span style={rowLabelStyle}>Trial started</span>
                    <span>{formatDate(data.trialStartsAt)}</span>
                  </div>
                ) : null}
                {data.trialEndsAt && !data.isPlatformAdmin ? (
                  <div style={{ ...rowStyle, borderBottom: "none" }}>
                    <span style={rowLabelStyle}>Trial ends</span>
                    <span>{formatDate(data.trialEndsAt)}</span>
                  </div>
                ) : null}
              </div>

              {/* Payment method card */}
              <div style={cardStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
                  <div style={{ width: 50, height: 50, borderRadius: 14, background: "#ecfdf5", display: "grid", placeItems: "center" }}>
                    <CreditCard size={22} color="#059669" />
                  </div>
                  <div>
                    <div style={labelStyle}>Payment Method</div>
                    <div style={headingStyle}>
                      {data.defaultPaymentMethod
                        ? `${data.defaultPaymentMethod.brand.toUpperCase()} ···· ${data.defaultPaymentMethod.last4}`
                        : "No card on file"}
                    </div>
                  </div>
                </div>

                {data.defaultPaymentMethod ? (
                  <>
                    <div style={rowStyle}>
                      <span style={rowLabelStyle}>Card brand</span>
                      <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{data.defaultPaymentMethod.brand}</span>
                    </div>
                    <div style={rowStyle}>
                      <span style={rowLabelStyle}>Last 4 digits</span>
                      <span style={{ fontWeight: 600 }}>{data.defaultPaymentMethod.last4}</span>
                    </div>
                    <div style={{ ...rowStyle, borderBottom: "none" }}>
                      <span style={rowLabelStyle}>Expires</span>
                      <span style={{ fontWeight: 600 }}>{data.defaultPaymentMethod.expMonth}/{data.defaultPaymentMethod.expYear}</span>
                    </div>
                  </>
                ) : (
                  <div style={{ borderRadius: 16, border: `1px dashed #cbd5e1`, background: "#f8fafc", padding: "18px 20px", color: textMuted, lineHeight: 1.7, fontSize: 14 }}>
                    {data.isPlatformAdmin
                      ? "Owner account — payment method not required."
                      : "A payment method will be saved after your first subscription payment."}
                  </div>
                )}
              </div>
            </div>

            {/* ── Row 2: Photography Keys + Background Credits ── */}
            <div style={{ display: "grid", gap: 20, gridTemplateColumns: "1fr 1fr", marginBottom: 20 }}>
              {/* Photography Keys */}
              <div style={cardStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
                  <div style={{ width: 50, height: 50, borderRadius: 14, background: "#fef3c7", display: "grid", placeItems: "center" }}>
                    <KeyRound size={22} color="#d97706" />
                  </div>
                  <div>
                    <div style={labelStyle}>Photography Keys</div>
                    <div style={headingStyle}>
                      {activeKeys.length} / {data.entitlement.totalAllowedKeys} active
                    </div>
                  </div>
                </div>

                <div style={rowStyle}>
                  <span style={rowLabelStyle}>Included with plan</span>
                  <span style={{ fontWeight: 600 }}>{data.entitlement.includedKeys}</span>
                </div>
                <div style={rowStyle}>
                  <span style={rowLabelStyle}>Extra keys purchased</span>
                  <span style={{ fontWeight: 600 }}>{data.entitlement.extraKeys}</span>
                </div>
                <div style={rowStyle}>
                  <span style={rowLabelStyle}>Total allowed</span>
                  <span style={{ fontWeight: 700, color: "#d97706" }}>{data.entitlement.totalAllowedKeys}</span>
                </div>

                {activeKeys.length > 0 ? (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: textMuted, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Active keys
                    </div>
                    {activeKeys.map((key) => (
                      <div
                        key={key.id}
                        style={{
                          borderRadius: 14,
                          border: `1px solid ${borderSoft}`,
                          padding: "12px 14px",
                          marginBottom: 8,
                          background: "#fafbfc",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <span style={{ fontWeight: 700, fontSize: 13, color: textPrimary }}>{key.label}</span>
                            {key.isExtraKey ? (
                              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "#d97706", background: "#fef3c7", padding: "2px 8px", borderRadius: 99 }}>
                                Extra
                              </span>
                            ) : null}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            {key.activationStatus === "active" ? (
                              <CheckCircle2 size={14} color="#059669" />
                            ) : (
                              <XCircle size={14} color="#9ca3af" />
                            )}
                            <span style={{ fontSize: 12, color: key.activationStatus === "active" ? "#059669" : "#9ca3af", fontWeight: 600 }}>
                              {key.activationStatus === "active" ? "Activated" : "Inactive"}
                            </span>
                          </div>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 12, color: textMuted }}>
                          {key.deviceName ? `Device: ${key.deviceName}` : "No device linked"}
                          {key.platform ? ` (${key.platform})` : ""}
                        </div>
                        <div style={{ marginTop: 2, fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>
                          {key.keyCode}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ marginTop: 16, borderRadius: 16, border: `1px dashed #cbd5e1`, background: "#f8fafc", padding: "16px 18px", color: textMuted, fontSize: 13, lineHeight: 1.7 }}>
                    No active photography keys. Keys are provisioned when you activate Studio OS on a computer.
                  </div>
                )}

                {suspendedKeys.length > 0 ? (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#dc2626", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Suspended / Revoked
                    </div>
                    {suspendedKeys.map((key) => (
                      <div key={key.id} style={{ borderRadius: 14, border: "1px solid #fecaca", padding: "10px 14px", marginBottom: 6, background: "#fef2f2", fontSize: 13 }}>
                        <span style={{ fontWeight: 600, color: "#b91c1c" }}>{key.label}</span>
                        <span style={{ marginLeft: 8, color: "#dc2626", fontSize: 11 }}>{key.status}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Background Credits */}
              <div style={cardStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
                  <div style={{ width: 50, height: 50, borderRadius: 14, background: "#ecfeff", display: "grid", placeItems: "center" }}>
                    <Sparkles size={22} color="#0891b2" />
                  </div>
                  <div>
                    <div style={labelStyle}>Background Credits</div>
                    <div style={headingStyle}>
                      {data.isPlatformAdmin ? "Unlimited" : data.creditBalance.toLocaleString("en-US")}
                    </div>
                  </div>
                </div>

                <div style={rowStyle}>
                  <span style={rowLabelStyle}>Current balance</span>
                  <span style={{ fontWeight: 700, color: "#0891b2" }}>
                    {data.isPlatformAdmin ? "Unlimited (owner)" : data.creditBalance.toLocaleString("en-US")}
                  </span>
                </div>

                <div style={{ marginTop: 16, borderRadius: 14, background: "#f1f5f9", border: `1px solid ${borderSoft}`, padding: "14px 16px", fontSize: 13, lineHeight: 1.7, color: "#475569" }}>
                  <div style={{ fontWeight: 700, marginBottom: 6, color: textPrimary }}>Credit Usage Rates</div>
                  <div>Background Removal (Local) — 1 credit</div>
                  <div>Background Removal (Premium Cloud) — 4 credits</div>
                </div>

                {!data.isPlatformAdmin ? (
                  <div style={{ marginTop: 16, textAlign: "center" }}>
                    <Link
                      href="/dashboard/settings"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 20px",
                        background: textPrimary,
                        color: "#fff",
                        borderRadius: 14,
                        fontWeight: 700,
                        fontSize: 13,
                        textDecoration: "none",
                      }}
                    >
                      <CreditCard size={15} /> Buy more credits
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>

            {/* ── Row 3: Invoices ── */}
            <div style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 50, height: 50, borderRadius: 14, background: "#eef2ff", display: "grid", placeItems: "center" }}>
                    <Receipt size={22} color="#4f46e5" />
                  </div>
                  <div>
                    <div style={labelStyle}>Billing History</div>
                    <div style={headingStyle}>Invoices</div>
                  </div>
                </div>

                {/* Search / filter */}
                <div style={{ position: "relative" }}>
                  <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} />
                  <input
                    type="text"
                    placeholder="Filter by date, amount, status..."
                    value={invoiceFilter}
                    onChange={(e) => setInvoiceFilter(e.target.value)}
                    style={{
                      paddingLeft: 36,
                      padding: "10px 14px 10px 36px",
                      borderRadius: 14,
                      border: `1px solid ${borderSoft}`,
                      fontSize: 13,
                      width: 280,
                      outline: "none",
                    }}
                  />
                </div>
              </div>

              {filteredInvoices.length > 0 ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {/* Table header */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 1fr 1fr 1fr 140px",
                      padding: "10px 16px",
                      fontSize: 11,
                      fontWeight: 700,
                      color: textMuted,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      borderBottom: `1px solid ${borderSoft}`,
                    }}
                  >
                    <span>Invoice</span>
                    <span>Date</span>
                    <span>Amount</span>
                    <span>Status</span>
                    <span style={{ textAlign: "right" }}>Actions</span>
                  </div>

                  {filteredInvoices.map((inv) => {
                    const statusStyle = invoiceStatusColor(inv.status);
                    return (
                      <div
                        key={inv.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "2fr 1fr 1fr 1fr 140px",
                          padding: "14px 16px",
                          alignItems: "center",
                          borderRadius: 14,
                          border: `1px solid #f0f0f0`,
                          background: "#fafbfc",
                          fontSize: 13,
                        }}
                      >
                        <span style={{ fontWeight: 600, color: textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {inv.id}
                        </span>
                        <span style={{ color: textMuted }}>{formatDate(inv.created)}</span>
                        <span style={{ fontWeight: 700, color: textPrimary }}>
                          {formatMoney(inv.amountPaid || inv.amountDue, inv.currency)}
                        </span>
                        <span>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "3px 10px",
                              borderRadius: 99,
                              fontSize: 11,
                              fontWeight: 700,
                              color: statusStyle.color,
                              background: statusStyle.bg,
                              textTransform: "capitalize",
                            }}
                          >
                            {inv.status ?? "—"}
                          </span>
                        </span>
                        <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          {inv.hostedInvoiceUrl ? (
                            <a
                              href={inv.hostedInvoiceUrl}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 12,
                                fontWeight: 700,
                                color: "#2563eb",
                                textDecoration: "none",
                              }}
                            >
                              View
                            </a>
                          ) : null}
                          {inv.invoicePdf ? (
                            <a
                              href={inv.invoicePdf}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 12,
                                fontWeight: 700,
                                color: "#2563eb",
                                textDecoration: "none",
                              }}
                            >
                              <Download size={12} /> PDF
                            </a>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ borderRadius: 18, border: `1px dashed #cbd5e1`, background: "#f8fafc", padding: "24px 20px", color: textMuted, lineHeight: 1.7, textAlign: "center", fontSize: 14 }}>
                  {invoiceFilter
                    ? `No invoices match "${invoiceFilter}".`
                    : "No invoices yet. Invoices will appear here after your first billing cycle."}
                </div>
              )}
            </div>

            {/* ── Cancel Membership ── */}
            {data.subscriptionIsActive && !data.isPlatformAdmin ? (
              <div
                style={{
                  ...cardStyle,
                  marginTop: 20,
                  border: "1px solid #fecaca",
                  background: "#fffbfb",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                  <div
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 14,
                      background: "#fef2f2",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <AlertTriangle size={22} color="#dc2626" />
                  </div>
                  <div>
                    <div style={labelStyle}>Danger Zone</div>
                    <div style={{ ...headingStyle, color: "#dc2626" }}>Cancel Membership</div>
                  </div>
                </div>
                <p
                  style={{
                    color: "#7f1d1d",
                    fontSize: 13.5,
                    lineHeight: 1.7,
                    margin: "0 0 16px",
                  }}
                >
                  If you cancel your membership, <strong>all your photos, galleries, and client
                  data will be permanently deleted</strong> from our servers. Your clients will
                  lose access to their galleries immediately. This action cannot be undone.
                  Please make sure to download any photos you want to keep before cancelling.
                </p>
                <button
                  onClick={() => setShowCancelDialog(true)}
                  style={{
                    border: "1px solid #dc2626",
                    borderRadius: 12,
                    padding: "12px 24px",
                    fontWeight: 700,
                    fontSize: 14,
                    background: "#fff",
                    color: "#dc2626",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Trash2 size={15} />
                  Cancel Membership
                </button>
              </div>
            ) : null}
          </>
        ) : loading ? (
          <div style={{ ...cardStyle, textAlign: "center", padding: "60px 20px", color: textMuted, fontSize: 15 }}>
            Loading your membership details...
          </div>
        ) : null}
      </div>
    </div>
  );
}
