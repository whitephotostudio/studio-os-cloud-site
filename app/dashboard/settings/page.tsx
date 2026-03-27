"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowUpRight, Building2, CreditCard, RefreshCw, Settings2, Upload, Image as ImageIcon, MapPin, Phone, Mail, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type StripeStatus = {
  ok: boolean;
  signedIn: boolean;
  businessName: string;
  studioName: string;
  brandColor: string;
  logoUrl: string;
  stripeAccountId: string | null;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  onboardingComplete: boolean;
  photographerId: string | null;
  studioId: string | null;
  watermarkEnabled: boolean;
  watermarkLogoUrl: string;
  studioAddress: string;
  studioPhone: string;
  studioEmail: string;
  message?: string;
};

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #dde5f2",
  borderRadius: 28,
  padding: 24,
  boxShadow: "0 8px 30px rgba(15, 23, 42, 0.05)",
};

export default function SettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("WhitePhoto");
  const [studioName, setStudioName] = useState("Studio OS Cloud");
  const [brandColor, setBrandColor] = useState("#0f172a");
  const [logoUrl, setLogoUrl] = useState("");

  // New profile fields
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [watermarkLogoUrl, setWatermarkLogoUrl] = useState("");
  const [studioAddress, setStudioAddress] = useState("");
  const [studioPhone, setStudioPhone] = useState("");
  const [studioEmail, setStudioEmail] = useState("");

  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [detailsSubmitted, setDetailsSubmitted] = useState(false);
  const [chargesEnabled, setChargesEnabled] = useState(false);
  const [payoutsEnabled, setPayoutsEnabled] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [photographerId, setPhotographerId] = useState<string | null>(null);
  const [studioId, setStudioId] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const token = session?.access_token ?? null;
      setAccessToken(token);
      setSignedIn(Boolean(session?.user));
      setSessionReady(Boolean(token));

      const res = await fetch("/api/stripe/status", {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
        cache: "no-store",
      });

      const json: StripeStatus = await res.json();

      if (!res.ok || !json.ok) {
        setError(json.message ?? "Unable to load Stripe status.");
        setSignedIn(Boolean(json.signedIn || session?.user));
        setLoading(false);
        return;
      }

      setSignedIn(Boolean(json.signedIn));
      setBusinessName(json.businessName || "WhitePhoto");
      setStudioName(json.studioName || "Studio OS Cloud");
      setBrandColor(json.brandColor || "#0f172a");
      setLogoUrl(json.logoUrl || "");
      setStripeAccountId(json.stripeAccountId);
      setDetailsSubmitted(Boolean(json.detailsSubmitted));
      setChargesEnabled(Boolean(json.chargesEnabled));
      setPayoutsEnabled(Boolean(json.payoutsEnabled));
      setOnboardingComplete(Boolean(json.onboardingComplete));
      setPhotographerId(json.photographerId);
      setStudioId(json.studioId);

      // New profile fields
      setWatermarkEnabled(json.watermarkEnabled !== false);
      setWatermarkLogoUrl(json.watermarkLogoUrl || "");
      setStudioAddress(json.studioAddress || "");
      setStudioPhone(json.studioPhone || "");
      setStudioEmail(json.studioEmail || "");

      const params = new URLSearchParams(window.location.search);
      if (params.get("stripe") === "returned") {
        setNotice("Stripe returned to Studio OS. Status refreshed.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load settings.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // ── Logo upload handler ──────────────────────────────────────────────
  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingLogo(true);
    setError(null);
    setNotice(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const user = session?.user;
      if (!user) {
        setError("Please sign in before uploading a logo.");
        setUploadingLogo(false);
        return;
      }

      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const filePath = `${user.id}/logo.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("studio-logos")
        .upload(filePath, file, { upsert: true, contentType: file.type });

      if (uploadErr) throw uploadErr;

      const { data: publicUrlData } = supabase.storage
        .from("studio-logos")
        .getPublicUrl(filePath);

      const url = publicUrlData?.publicUrl
        ? `${publicUrlData.publicUrl}?t=${Date.now()}`
        : "";

      setWatermarkLogoUrl(url);
      setNotice("Logo uploaded. Click Save settings to apply.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logo upload failed.");
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }

  async function saveBranding() {
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const user = session?.user;
      if (!user) {
        setError("Please sign in again before saving settings.");
        setSaving(false);
        return;
      }

      const { data: photographer } = await supabase
        .from("photographers")
        .select("id, studio_id")
        .eq("user_id", user.id)
        .maybeSingle();

      let nextPhotographerId = photographer?.id ?? null;
      let nextStudioId = photographer?.studio_id ?? null;

      if (!nextPhotographerId) {
        const { data: createdPhotographer, error: photographerError } = await supabase
          .from("photographers")
          .insert({
            user_id: user.id,
            business_name: businessName,
            brand_color: brandColor,
            stripe_account_id: stripeAccountId,
            watermark_enabled: watermarkEnabled,
            watermark_logo_url: watermarkLogoUrl,
            studio_address: studioAddress,
            studio_phone: studioPhone,
            studio_email: studioEmail,
          })
          .select("id, studio_id")
          .single();

        if (photographerError) throw photographerError;
        nextPhotographerId = createdPhotographer.id;
        nextStudioId = createdPhotographer.studio_id ?? null;
      } else {
        const { error: photographerUpdateError } = await supabase
          .from("photographers")
          .update({
            business_name: businessName,
            brand_color: brandColor,
            stripe_account_id: stripeAccountId,
            watermark_enabled: watermarkEnabled,
            watermark_logo_url: watermarkLogoUrl,
            studio_address: studioAddress,
            studio_phone: studioPhone,
            studio_email: studioEmail,
          })
          .eq("id", nextPhotographerId);

        if (photographerUpdateError) throw photographerUpdateError;
      }

      if (nextStudioId) {
        const { error: studioError } = await supabase
          .from("studios")
          .update({
            name: studioName,
          })
          .eq("id", nextStudioId);

        if (studioError) {
          console.warn("Studio update skipped:", studioError.message);
        }
      }

      setPhotographerId(nextPhotographerId);
      setStudioId(nextStudioId);
      setNotice("Settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function connectStripe() {
    setConnecting(true);
    setError(null);
    setNotice(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const token = session?.access_token ?? accessToken;
      if (!token) {
        setError("Please sign in again before connecting Stripe.");
        setConnecting(false);
        return;
      }

      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
        body: JSON.stringify({
          businessName,
          studioName,
          brandColor,
          logoUrl,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.message || "Unable to start Stripe onboarding.");
      }

      if (json.url) {
        window.location.href = json.url;
        return;
      }

      throw new Error("Stripe onboarding URL was not returned.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to connect Stripe.");
      setConnecting(false);
    }
  }

  return (
    <div style={{ background: "#eef3fa", minHeight: "100vh", padding: "32px 28px 60px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: "#64748b" }}>
            Dashboard settings
          </div>
          <h1 style={{ marginTop: 10, fontSize: 48, lineHeight: 1.04, fontWeight: 900, color: "#0f172a" }}>
            Branding + Stripe Connect
          </h1>
          <p style={{ marginTop: 12, maxWidth: 840, fontSize: 18, lineHeight: 1.7, color: "#64748b" }}>
            Connect each photographer to their own Stripe account with the professional onboarding flow:
            Connect Stripe → Stripe onboarding → return to Studio OS → account saved automatically.
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <button
            onClick={loadStatus}
            disabled={loading}
            style={{
              border: "1px solid #d6dfef",
              borderRadius: 18,
              background: "#fff",
              padding: "12px 18px",
              fontWeight: 800,
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              color: "#0f172a",
              cursor: "pointer",
            }}
          >
            <RefreshCw size={18} /> Refresh status
          </button>

          <button
            onClick={connectStripe}
            disabled={connecting || !sessionReady}
            style={{
              border: "1px solid #0f172a",
              borderRadius: 18,
              background: "#0f172a",
              padding: "12px 18px",
              fontWeight: 800,
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              color: "#fff",
              cursor: connecting || !sessionReady ? "not-allowed" : "pointer",
              opacity: connecting || !sessionReady ? 0.65 : 1,
            }}
          >
            <CreditCard size={18} /> {connecting ? "Opening Stripe..." : "Connect Stripe"}
          </button>

          {!signedIn ? (
            <Link
              href="/sign-in"
              style={{
                border: "1px solid #2563eb",
                borderRadius: 18,
                background: "#eff6ff",
                padding: "12px 18px",
                fontWeight: 800,
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                color: "#1d4ed8",
                textDecoration: "none",
              }}
            >
              <ArrowUpRight size={18} /> Sign in again
            </Link>
          ) : null}
        </div>

        {error ? (
          <div style={{ marginBottom: 20, borderRadius: 20, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", padding: "16px 18px", fontWeight: 700 }}>
            {error}
          </div>
        ) : null}

        {notice ? (
          <div style={{ marginBottom: 20, borderRadius: 20, border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", padding: "16px 18px", fontWeight: 700 }}>
            {notice}
          </div>
        ) : null}

        {!signedIn ? (
          <div style={{ ...cardStyle, marginBottom: 20, display: "flex", alignItems: "center", gap: 14 }}>
            <AlertCircle size={22} color="#dc2626" />
            <div>
              <div style={{ fontWeight: 900, color: "#0f172a", fontSize: 18 }}>Session needs refresh</div>
              <div style={{ marginTop: 4, color: "#64748b", lineHeight: 1.6 }}>
                Settings can render from saved data, but Stripe onboarding needs a fresh authenticated photographer session.
                Use <strong>Sign in again</strong>, return here, then click <strong>Connect Stripe</strong>.
              </div>
            </div>
          </div>
        ) : null}

        {/* ── Row 1: Branding + Stripe ────────────────────────────────── */}
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "1.4fr 1fr" }}>
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: "#eef4ff", display: "grid", placeItems: "center" }}>
                <Building2 size={24} color="#3b82f6" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
                  Studio profile
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>Branding foundation</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Business name" value={businessName} onChange={setBusinessName} />
              <Field label="Studio name" value={studioName} onChange={setStudioName} />
              <Field label="Brand color" value={brandColor} onChange={setBrandColor} />
              <Field label="Logo URL" value={logoUrl} onChange={setLogoUrl} placeholder="https://..." />
            </div>

            <button
              onClick={saveBranding}
              disabled={saving}
              style={{
                marginTop: 16,
                border: "1px solid #0f172a",
                borderRadius: 18,
                background: "#0f172a",
                padding: "14px 20px",
                fontWeight: 800,
                color: "#fff",
                cursor: "pointer",
              }}
            >
              {saving ? "Saving..." : "Save settings"}
            </button>
          </div>

          <div style={{ ...cardStyle, background: "#f4f8ff" }}>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b", marginBottom: 10 }}>
              Stripe status
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginBottom: 18 }}>Connected account</div>
            <StatusRow label="Stripe account ID" value={stripeAccountId || "Not connected yet"} />
            <StatusRow label="Details submitted" value={detailsSubmitted ? "Yes" : "No"} ok={detailsSubmitted} />
            <StatusRow label="Charges enabled" value={chargesEnabled ? "Yes" : "No"} ok={chargesEnabled} />
            <StatusRow label="Payouts enabled" value={payoutsEnabled ? "Yes" : "No"} ok={payoutsEnabled} />
            <StatusRow label="Onboarding complete" value={onboardingComplete ? "Yes" : "No"} ok={onboardingComplete} />
            <button
              onClick={connectStripe}
              disabled={connecting || !sessionReady}
              style={{
                marginTop: 12,
                border: "1px solid #3b82f6",
                borderRadius: 16,
                background: "#2563eb",
                padding: "12px 16px",
                fontWeight: 800,
                color: "#fff",
                cursor: connecting || !sessionReady ? "not-allowed" : "pointer",
                opacity: connecting || !sessionReady ? 0.65 : 1,
              }}
            >
              {connecting ? "Opening Stripe..." : "Connect Stripe"}
            </button>
          </div>
        </div>

        {/* ── Row 2: Watermark + Logo Upload  ─────────────────────────── */}
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "1fr 1fr", marginTop: 20 }}>
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: "#fef3c7", display: "grid", placeItems: "center" }}>
                <ShieldCheck size={24} color="#d97706" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
                  Photo protection
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>Watermark settings</div>
              </div>
            </div>

            {/* Toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
              <button
                type="button"
                onClick={() => setWatermarkEnabled(!watermarkEnabled)}
                style={{
                  width: 52,
                  height: 28,
                  borderRadius: 14,
                  border: "none",
                  background: watermarkEnabled ? "#22c55e" : "#d1d5db",
                  position: "relative",
                  cursor: "pointer",
                  transition: "background 0.2s",
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    background: "#fff",
                    position: "absolute",
                    top: 3,
                    left: watermarkEnabled ? 27 : 3,
                    transition: "left 0.2s",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  }}
                />
              </button>
              <div>
                <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 15 }}>
                  Watermark {watermarkEnabled ? "ON" : "OFF"}
                </div>
                <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
                  {watermarkEnabled ? "Proof watermarks visible on parent gallery photos" : "No watermark overlay — photos shown clean"}
                </div>
              </div>
            </div>

            {/* Logo upload */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 700, color: "#475569" }}>Watermark logo</div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {watermarkLogoUrl ? (
                  <div style={{ width: 80, height: 80, borderRadius: 16, border: "1px solid #e5e7eb", background: "#f9fafb", display: "grid", placeItems: "center", overflow: "hidden" }}>
                    <img src={watermarkLogoUrl} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                  </div>
                ) : (
                  <div style={{ width: 80, height: 80, borderRadius: 16, border: "2px dashed #d1d5db", background: "#f9fafb", display: "grid", placeItems: "center" }}>
                    <ImageIcon size={28} color="#9ca3af" />
                  </div>
                )}
                <div>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={handleLogoUpload}
                    style={{ display: "none" }}
                  />
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploadingLogo}
                    style={{
                      border: "1px solid #d6dfef",
                      borderRadius: 14,
                      background: "#fff",
                      padding: "10px 16px",
                      fontWeight: 700,
                      fontSize: 13,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      color: "#0f172a",
                      cursor: uploadingLogo ? "not-allowed" : "pointer",
                      opacity: uploadingLogo ? 0.6 : 1,
                    }}
                  >
                    <Upload size={14} /> {uploadingLogo ? "Uploading..." : "Upload logo"}
                  </button>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>PNG or SVG with transparent background works best</div>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7, marginTop: 8, padding: "12px 14px", background: "#fffbeb", borderRadius: 14, border: "1px solid #fef3c7" }}>
              When enabled, your logo renders as a repeating diagonal watermark over every proof photo in the parent gallery. If no logo is uploaded, the school name is used instead.
            </div>
          </div>

          {/* ── Studio contact info ──────────────────────────────────── */}
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: "#ecfdf5", display: "grid", placeItems: "center" }}>
                <MapPin size={24} color="#059669" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
                  Studio info
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>Contact details</div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <Field label="Studio address" value={studioAddress} onChange={setStudioAddress} placeholder="123 Main St, City, State ZIP" icon={<MapPin size={14} color="#94a3b8" />} />
              <Field label="Studio phone" value={studioPhone} onChange={setStudioPhone} placeholder="+1 (555) 000-0000" icon={<Phone size={14} color="#94a3b8" />} />
              <Field label="Studio email" value={studioEmail} onChange={setStudioEmail} placeholder="hello@yourstudio.com" icon={<Mail size={14} color="#94a3b8" />} />
            </div>

            <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7, marginTop: 14, padding: "12px 14px", background: "#f0fdf4", borderRadius: 14, border: "1px solid #d1fae5" }}>
              Contact info will appear on invoices, contracts, and the parent-facing gallery footer when those features are activated.
            </div>
          </div>
        </div>

        {/* ── Row 3: Stripe flow info + what gets saved ───────────────── */}
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "1.4fr 1fr", marginTop: 20 }}>
          <div style={{ ...cardStyle, background: "linear-gradient(135deg,#091532 0%,#0b1d49 100%)", color: "#fff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 18, fontWeight: 900 }}>
              <Settings2 size={22} /> Stripe Connect onboarding flow
            </div>
            <p style={{ marginTop: 16, color: "rgba(255,255,255,0.82)", lineHeight: 1.8, fontSize: 17 }}>
              Connect Stripe button → Stripe onboarding → Stripe returns to Studio OS → account status refreshes automatically.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 16, color: "rgba(255,255,255,0.9)", lineHeight: 1.8 }}>
              <div>
                • professional Stripe-hosted onboarding<br />
                • automatic account reuse on reconnect<br />
                • safe return_url / refresh_url handling
              </div>
              <div>
                • photographer-specific connected account<br />
                • live charges / payouts status<br />
                • saved into your real photographer record
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b", marginBottom: 10 }}>
              What gets saved
            </div>
            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 2, color: "#334155", fontSize: 17 }}>
              <li>photographer business name</li>
              <li>studio name</li>
              <li>logo URL</li>
              <li>brand color</li>
              <li>watermark on/off + logo</li>
              <li>studio address, phone, email</li>
              <li>connected Stripe account ID</li>
              <li>live onboarding / payout state</li>
              <li>photographer id: {photographerId || "pending"}</li>
              <li>studio id: {studioId || "pending"}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  icon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
}) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 700, color: "#475569" }}>{label}</div>
      <div style={{ position: "relative" }}>
        {icon && (
          <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            {icon}
          </div>
        )}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width: "100%",
            borderRadius: 18,
            border: "1px solid #d6dfef",
            background: "#fff",
            padding: icon ? "14px 16px 14px 36px" : "14px 16px",
            fontSize: 16,
            color: "#0f172a",
            outline: "none",
          }}
        />
      </div>
    </label>
  );
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        border: "1px solid #d6dfef",
        background: "#fff",
        borderRadius: 16,
        padding: "14px 16px",
        marginBottom: 12,
      }}
    >
      <div style={{ fontWeight: 800, color: "#0f172a" }}>{label}</div>
      <div style={{ fontWeight: 800, color: ok === undefined ? "#64748b" : ok ? "#15803d" : "#b91c1c" }}>{value}</div>
    </div>
  );
}
