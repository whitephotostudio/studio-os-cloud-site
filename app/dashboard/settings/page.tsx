"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  BookOpenText,
  Building2,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  Image as ImageIcon,
  KeyRound,
  Mail,
  MapPin,
  MonitorSmartphone,
  Phone,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  WalletCards,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { BillingInterval } from "@/lib/studio-pricing";
import { WhatsNewDot, useIsFeatureNew } from "@/components/whats-new-dot";

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
  connectStatusLabel: string;
  connectStatusMessage: string;
  connectReadyForPayments: boolean;
  connectDisabledReason?: string | null;
  photographerId: string | null;
  studioId: string | null;
  watermarkEnabled: boolean;
  watermarkLogoUrl: string;
  studioAddress: string;
  studioPhone: string;
  studioEmail: string;
  billingEmail: string;
  billingCurrency: string;
  isPlatformAdmin: boolean;
  stripePlatformCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionPlanCode: string | null;
  subscriptionBillingInterval: BillingInterval | null;
  subscriptionStatus: string;
  subscriptionIsActive: boolean;
  subscriptionCurrentPeriodStart: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  extraDesktopKeys: number;
  orderUsageRateCents: number;
  creditBalance: number;
  studioUsage: {
    countedOrders: number;
    billableOrders: number;
    unreportedOrders: number;
    estimatedChargeCents: number;
    billingPeriodKey: string | null;
  };
  recentInvoices: Array<{
    id: string;
    status: string | null;
    amountDue: number;
    amountPaid: number;
    currency: string;
    created: string;
    hostedInvoiceUrl: string | null;
    invoicePdf: string | null;
  }>;
  billingCatalog: {
    plans: Array<{
      code: string;
      label: string;
      priceCents: number;
      annualPriceCents: number;
      description: string;
      usageFeeApplies: boolean;
      usageRateCents: number;
      includedDesktopKeys: number;
      includedCredits: number;
      websiteLogoIncluded: boolean;
    }>;
    annualDiscountPercent: number;
    extraDesktopKeyMonthlyCents: number;
    extraDesktopKeyAnnualCents: number;
    orderUsageRateCents: number;
    creditPacks: Array<{
      id?: string;
      code: string;
      label?: string;
      name?: string;
      credits: number;
      priceCents: number;
    }>;
  };
  defaultPaymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
  trialStartsAt?: string | null;
  trialEndsAt?: string | null;
  trialActive?: boolean;
  trialExpired?: boolean;
  trialDaysRemaining?: number;
  freeTrialDays?: number;
  warnings?: string[];
  message?: string;
};

type BillingCatalog = StripeStatus["billingCatalog"];
type RecentInvoice = StripeStatus["recentInvoices"][number];
type StudioAppReleaseState = "hidden" | "beta" | "public";

type StudioAppStatus = {
  ok: boolean;
  signedIn: boolean;
  release: {
    slug: string;
    state: StudioAppReleaseState;
    stateLabel: string;
    version: string;
    releaseNotes: string;
    betaWarning: string;
    macDownloadUrl: string | null;
    windowsDownloadUrl: string | null;
    publishedAt: string | null;
    updatedAt: string;
  };
  entitlement: {
    planCode: string | null;
    releaseState: StudioAppReleaseState;
    releaseStateLabel: string;
    subscriptionActive: boolean;
    appEligibleByPlan: boolean;
    appAccessEnabled: boolean;
    canDownload: boolean;
    betaAccess: boolean;
    isPlatformAdmin: boolean;
    includedKeys: number;
    extraKeys: number;
    totalAllowedKeys: number;
    requiresStudioUpgradeForSecondKey: boolean;
    requiresStudioForExtraKeys: boolean;
    showBetaWarning: boolean;
    message: string;
  };
  keys: Array<{
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
  }>;
  admin: {
    isPlatformAdmin: boolean;
  };
  message?: string;
};

const emptyBillingCatalog: BillingCatalog = {
  plans: [],
  annualDiscountPercent: 10,
  extraDesktopKeyMonthlyCents: 0,
  extraDesktopKeyAnnualCents: 0,
  orderUsageRateCents: 25,
  creditPacks: [],
};

const emptyStudioAppStatus: StudioAppStatus = {
  ok: false,
  signedIn: false,
  release: {
    slug: "studio-os-flutter",
    state: "hidden",
    stateLabel: "Hidden rollout",
    version: "Beta 0.1.0",
    releaseNotes:
      "Upload the latest Mac and Windows installers when the Studio OS Flutter build is ready for photographers.",
    betaWarning:
      "Beta builds are intended for approved photographers only. Download links, activations, and workflows may change during rollout.",
    macDownloadUrl: null,
    windowsDownloadUrl: null,
    publishedAt: null,
    updatedAt: "",
  },
  entitlement: {
    planCode: null,
    releaseState: "hidden",
    releaseStateLabel: "Hidden rollout",
    subscriptionActive: false,
    appEligibleByPlan: false,
    appAccessEnabled: false,
    canDownload: false,
    betaAccess: false,
    isPlatformAdmin: false,
    includedKeys: 0,
    extraKeys: 0,
    totalAllowedKeys: 0,
    requiresStudioUpgradeForSecondKey: false,
    requiresStudioForExtraKeys: true,
    showBetaWarning: true,
    message:
      "Upgrade to App Plan or Studio to unlock Studio OS App beta access and Photography Keys.",
  },
  keys: [],
  admin: {
    isPlatformAdmin: false,
  },
};

const SUPPORTED_CURRENCIES = [
  { code: "usd", symbol: "$", name: "US Dollar" },
  { code: "cad", symbol: "C$", name: "Canadian Dollar" },
  { code: "eur", symbol: "€", name: "Euro" },
  { code: "gbp", symbol: "£", name: "British Pound" },
  { code: "aud", symbol: "A$", name: "Australian Dollar" },
  { code: "aed", symbol: "د.إ", name: "UAE Dirham" },
  { code: "sar", symbol: "﷼", name: "Saudi Riyal" },
  { code: "amd", symbol: "֏", name: "Armenian Dram" },
] as const;

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #dde5f2",
  borderRadius: 28,
  padding: 24,
  boxShadow: "0 8px 30px rgba(15, 23, 42, 0.05)",
};

function formatMoney(cents: number, currency = "cad") {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: (currency || "cad").toUpperCase(),
  }).format((cents || 0) / 100);
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return "Pending";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function humanizeStatus(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "Inactive";
  return normalized
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function intervalLabel(interval: BillingInterval) {
  return interval === "year" ? "Annual" : "Monthly";
}

function isTrialStatus(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "trial" || normalized === "trialing";
}

function planDisplayLabel(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "core") return "App Plan";
  if (normalized === "starter") return "Starter";
  if (normalized === "studio") return "Studio";
  return humanizeStatus(value);
}

// ── Combine-orders + shipping helpers ─────────────────────────────────
//
// The photographers row stores tiers as a jsonb object so we can grow
// beyond 2/3 kids in future. The settings UI keeps it simple — just two
// percentages — and these helpers convert between the two shapes.

function buildSiblingTiersJson(
  tier2Percent: number,
  tier3Percent: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (Number.isFinite(tier2Percent) && tier2Percent > 0) {
    out["2"] = clampPercent(tier2Percent);
  }
  if (Number.isFinite(tier3Percent) && tier3Percent > 0) {
    out["3"] = clampPercent(tier3Percent);
  }
  return out;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

function clampShippingFeeCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

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

  // Combine-orders + shipping commerce knobs (added 2026-04-24).
  // Tiers are stored as a JSON object on the photographers row but the UI
  // exposes them as two simple percentages — most studios stop at "3+ kids".
  // Spec: docs/design/combine-orders-and-recovery.md.
  const [siblingTier2Percent, setSiblingTier2Percent] = useState<number>(5);
  const [siblingTier3Percent, setSiblingTier3Percent] = useState<number>(10);
  const [shippingFeeCents, setShippingFeeCents] = useState<number>(0);
  const [lateHandlingFeePercent, setLateHandlingFeePercent] = useState<number>(10);

  // Dismissal hook for the "what's new" blue dot on the commerce card.
  // The dot disappears the first time the photographer interacts with
  // anywhere inside the card.
  const commerceCardDot = useIsFeatureNew("combine-orders-commerce-settings-v1");
  const dismissCommerceCardDot = useCallback(() => {
    if (commerceCardDot.isNew) commerceCardDot.dismiss();
  }, [commerceCardDot]);

  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [detailsSubmitted, setDetailsSubmitted] = useState(false);
  const [chargesEnabled, setChargesEnabled] = useState(false);
  const [payoutsEnabled, setPayoutsEnabled] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [connectStatusLabel, setConnectStatusLabel] = useState("Not connected");
  const [connectStatusMessage, setConnectStatusMessage] = useState(
    "Connect Stripe before parents can complete checkout.",
  );
  const [connectReadyForPayments, setConnectReadyForPayments] = useState(false);
  const [connectDisabledReason, setConnectDisabledReason] = useState<string | null>(null);
  const [photographerId, setPhotographerId] = useState<string | null>(null);
  const [studioId, setStudioId] = useState<string | null>(null);
  const [billingEmail, setBillingEmail] = useState("");
  const [billingCurrency, setBillingCurrency] = useState("cad");
  const [defaultPaymentMethod, setDefaultPaymentMethod] = useState<StripeStatus["defaultPaymentMethod"]>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [stripeSubscriptionId, setStripeSubscriptionId] = useState<string | null>(null);
  const [subscriptionPlanCode, setSubscriptionPlanCode] = useState<string | null>(null);
  const [subscriptionBillingInterval, setSubscriptionBillingInterval] =
    useState<BillingInterval>("month");
  const [subscriptionStatus, setSubscriptionStatus] = useState("inactive");
  const [subscriptionIsActive, setSubscriptionIsActive] = useState(false);
  const [trialActive, setTrialActive] = useState(false);
  const [trialDaysRemaining, setTrialDaysRemaining] = useState(0);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [subscriptionCurrentPeriodStart, setSubscriptionCurrentPeriodStart] = useState<string | null>(null);
  const [subscriptionCurrentPeriodEnd, setSubscriptionCurrentPeriodEnd] = useState<string | null>(null);
  const [extraDesktopKeys, setExtraDesktopKeys] = useState(0);
  const [creditBalance, setCreditBalance] = useState(0);
  const [orderUsageRateCents, setOrderUsageRateCents] = useState(25);
  const [studioUsage, setStudioUsage] = useState<StripeStatus["studioUsage"]>({
    countedOrders: 0,
    billableOrders: 0,
    unreportedOrders: 0,
    estimatedChargeCents: 0,
    billingPeriodKey: null,
  });
  const [recentInvoices, setRecentInvoices] = useState<RecentInvoice[]>([]);
  const [billingCatalog, setBillingCatalog] = useState<BillingCatalog>(emptyBillingCatalog);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [desiredPlanCode, setDesiredPlanCode] = useState("starter");
  const [desiredBillingInterval, setDesiredBillingInterval] =
    useState<BillingInterval>("month");
  const [desiredExtraDesktopKeys, setDesiredExtraDesktopKeys] = useState(0);
  const [billingBusyAction, setBillingBusyAction] = useState<string | null>(null);
  const [studioApp, setStudioApp] = useState<StudioAppStatus>(emptyStudioAppStatus);
  const [studioAppError, setStudioAppError] = useState<string | null>(null);
  const [studioAppBusyAction, setStudioAppBusyAction] = useState<string | null>(null);
  const [releaseStateDraft, setReleaseStateDraft] = useState<StudioAppReleaseState>("hidden");
  const [releaseVersionDraft, setReleaseVersionDraft] = useState("Beta 0.1.0");
  const [releaseNotesDraft, setReleaseNotesDraft] = useState("");
  const [betaWarningDraft, setBetaWarningDraft] = useState("");
  const [macDownloadUrlDraft, setMacDownloadUrlDraft] = useState("");
  const [windowsDownloadUrlDraft, setWindowsDownloadUrlDraft] = useState("");
  const [betaTargetEmail, setBetaTargetEmail] = useState("");
  const [betaTargetEnabled, setBetaTargetEnabled] = useState(true);

  const applyStudioAppStatus = useCallback((status: StudioAppStatus) => {
    setStudioApp(status);
    setReleaseStateDraft(status.release.state);
    setReleaseVersionDraft(status.release.version || "Beta 0.1.0");
    setReleaseNotesDraft(status.release.releaseNotes || "");
    setBetaWarningDraft(status.release.betaWarning || "");
    setMacDownloadUrlDraft(status.release.macDownloadUrl || "");
    setWindowsDownloadUrlDraft(status.release.windowsDownloadUrl || "");
  }, []);

  const loadStudioAppStatus = useCallback(
    async (token: string | null) => {
      try {
        const res = await fetch("/api/studio-os-app/status", {
          method: "GET",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: "include",
          cache: "no-store",
        });

        const json = (await res.json().catch(() => ({}))) as StudioAppStatus;
        if (!res.ok || !json.ok) {
          throw new Error(json.message || "Unable to load Studio OS App beta access.");
        }

        applyStudioAppStatus(json);
        setStudioAppError(null);
      } catch (error) {
        setStudioApp(emptyStudioAppStatus);
        setStudioAppError(
          error instanceof Error
            ? error.message
            : "Unable to load Studio OS App beta access.",
        );
      }
    },
    [applyStudioAppStatus],
  );

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    setStudioAppError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const token = session?.access_token ?? null;
      setAccessToken(token);
      setSignedIn(Boolean(session?.user));
      setSessionReady(Boolean(token));

      // Fetch Stripe status and Studio App status in parallel
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const [res, studioAppRes] = await Promise.all([
        fetch("/api/stripe/status", {
          method: "GET",
          headers: authHeaders,
          credentials: "include",
          cache: "no-store",
        }),
        fetch("/api/studio-os-app/status", {
          method: "GET",
          headers: authHeaders,
          credentials: "include",
          cache: "no-store",
        }).catch(() => null),
      ]);

      const json: StripeStatus = await res.json();

      if (!res.ok || !json.ok) {
        setError(json.message ?? "Unable to load Stripe status.");
        setSignedIn(Boolean(json.signedIn || session?.user));
        setStudioApp(emptyStudioAppStatus);
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
      setConnectStatusLabel(json.connectStatusLabel || "Not connected");
      setConnectStatusMessage(
        json.connectStatusMessage || "Connect Stripe before parents can complete checkout.",
      );
      setConnectReadyForPayments(Boolean(json.connectReadyForPayments));
      setConnectDisabledReason(json.connectDisabledReason || null);

      // New profile fields
      setWatermarkEnabled(json.watermarkEnabled !== false);
      setWatermarkLogoUrl(json.watermarkLogoUrl || "");
      setStudioAddress(json.studioAddress || "");
      setStudioPhone(json.studioPhone || "");
      setStudioEmail(json.studioEmail || "");

      // Combine-orders + shipping commerce knobs.  Direct Supabase fetch so
      // we don't have to extend the StripeStatus API surface.  Defaults
      // applied below match the photographers DB defaults.
      try {
        if (session?.user?.id) {
          const { data: commerceRow } = await supabase
            .from("photographers")
            .select(
              "sibling_discount_tiers, shipping_fee_cents, late_handling_fee_percent",
            )
            .eq("user_id", session.user.id)
            .maybeSingle();
          if (commerceRow) {
            const tiers = (commerceRow.sibling_discount_tiers ?? {}) as Record<string, number>;
            setSiblingTier2Percent(typeof tiers["2"] === "number" ? tiers["2"] : 5);
            setSiblingTier3Percent(typeof tiers["3"] === "number" ? tiers["3"] : 10);
            const fee = Number(commerceRow.shipping_fee_cents);
            setShippingFeeCents(Number.isFinite(fee) && fee >= 0 ? fee : 0);
            const handling = Number(commerceRow.late_handling_fee_percent);
            setLateHandlingFeePercent(
              Number.isFinite(handling) && handling >= 0 ? handling : 10,
            );
          }
        }
      } catch {
        // Fall back to defaults — never block settings load on this.
      }
      setBillingEmail(json.billingEmail || "");
      setBillingCurrency((json.billingCurrency || "cad").toLowerCase());
      setDefaultPaymentMethod(json.defaultPaymentMethod || null);
      setIsPlatformAdmin(Boolean(json.isPlatformAdmin));
      setStripeSubscriptionId(json.stripeSubscriptionId || null);
      setSubscriptionPlanCode(json.subscriptionPlanCode || null);
      setSubscriptionBillingInterval(
        (json.subscriptionBillingInterval || "month") as BillingInterval,
      );
      setSubscriptionStatus(json.subscriptionStatus || "inactive");
      setSubscriptionIsActive(Boolean(json.subscriptionIsActive));
      setTrialActive(Boolean(json.trialActive));
      setTrialDaysRemaining(json.trialDaysRemaining ?? 0);
      setTrialEndsAt(json.trialEndsAt || null);
      setSubscriptionCurrentPeriodStart(json.subscriptionCurrentPeriodStart || null);
      setSubscriptionCurrentPeriodEnd(json.subscriptionCurrentPeriodEnd || null);
      setExtraDesktopKeys(json.extraDesktopKeys ?? 0);
      setCreditBalance(json.creditBalance ?? 0);
      setOrderUsageRateCents(json.orderUsageRateCents ?? 25);
      setStudioUsage(
        json.studioUsage || {
          countedOrders: 0,
          billableOrders: 0,
          unreportedOrders: 0,
          estimatedChargeCents: 0,
          billingPeriodKey: null,
        },
      );
      setRecentInvoices(json.recentInvoices || []);
      setBillingCatalog(json.billingCatalog || emptyBillingCatalog);
      setWarnings(json.warnings || []);
      setDesiredPlanCode(
        json.subscriptionPlanCode || json.billingCatalog?.plans?.[0]?.code || "starter",
      );
      setDesiredBillingInterval(
        (json.subscriptionBillingInterval || "month") as BillingInterval,
      );
      setDesiredExtraDesktopKeys(json.extraDesktopKeys ?? 0);

      // Apply Studio App status from parallel fetch
      if (studioAppRes && studioAppRes.ok) {
        try {
          const studioJson = (await studioAppRes.json().catch(() => ({}))) as StudioAppStatus;
          if (studioJson.ok) {
            applyStudioAppStatus(studioJson);
            setStudioAppError(null);
          } else {
            setStudioApp(emptyStudioAppStatus);
            setStudioAppError(studioJson.message || "Unable to load Studio OS App beta access.");
          }
        } catch {
          setStudioApp(emptyStudioAppStatus);
        }
      } else {
        setStudioApp(emptyStudioAppStatus);
        setStudioAppError("Unable to load Studio OS App beta access.");
      }

      const params = new URLSearchParams(window.location.search);
      if (params.get("stripe") === "returned") {
        setNotice("Stripe returned to Studio OS. Status refreshed.");
      } else {
        const billingState = params.get("billing");
        if (billingState === "subscription_success") {
          setNotice("Studio OS subscription checkout returned. Billing status refreshed.");
        } else if (billingState === "credits_success") {
          setNotice("Background credit purchase returned. Billing status refreshed.");
        } else if (billingState === "portal") {
          setNotice("Stripe billing portal returned. Billing status refreshed.");
        } else if (billingState === "subscription_cancel") {
          setNotice("Subscription checkout was cancelled.");
        } else if (billingState === "credits_cancel") {
          setNotice("Credit pack checkout was cancelled.");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load settings.");
      setStudioApp(emptyStudioAppStatus);
    } finally {
      setLoading(false);
    }
  }, [loadStudioAppStatus, supabase]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // ── Logo upload handler ──────────────────────────────────────────────
  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side file size validation (5 MB for logos)
    if (file.size > 5 * 1024 * 1024) {
      setError("Logo file is too large. Please choose an image under 5 MB.");
      return;
    }

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
            stripe_connected_account_id: stripeAccountId,
            watermark_enabled: watermarkEnabled,
            watermark_logo_url: watermarkLogoUrl,
            studio_address: studioAddress,
            studio_phone: studioPhone,
            studio_email: studioEmail,
            billing_email: billingEmail || studioEmail || user.email || null,
            billing_currency: billingCurrency || "cad",
            sibling_discount_tiers: buildSiblingTiersJson(
              siblingTier2Percent,
              siblingTier3Percent,
            ),
            shipping_fee_cents: clampShippingFeeCents(shippingFeeCents),
            late_handling_fee_percent: clampPercent(lateHandlingFeePercent),
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
            stripe_connected_account_id: stripeAccountId,
            watermark_enabled: watermarkEnabled,
            watermark_logo_url: watermarkLogoUrl,
            studio_address: studioAddress,
            studio_phone: studioPhone,
            studio_email: studioEmail,
            billing_email: billingEmail || studioEmail || user.email || null,
            billing_currency: billingCurrency || "cad",
            sibling_discount_tiers: buildSiblingTiersJson(
              siblingTier2Percent,
              siblingTier3Percent,
            ),
            shipping_fee_cents: clampShippingFeeCents(shippingFeeCents),
            late_handling_fee_percent: clampPercent(lateHandlingFeePercent),
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
          billingEmail: billingEmail || studioEmail,
          studioEmail,
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

  async function getAuthorizedHeaders() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const token = session?.access_token ?? accessToken;
    if (!token) {
      throw new Error("Please sign in again before updating billing.");
    }

    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }

  async function copyPhotographyKey(keyCode: string) {
    try {
      await navigator.clipboard.writeText(keyCode);
      setNotice("Photography Key copied.");
    } catch {
      setError("Could not copy that Photography Key.");
    }
  }

  async function deactivatePhotographyKey(keyId: string) {
    if (!confirm("Deactivate this device? The key will become available for another computer.")) return;
    try {
      const sb = createClient();
      const { data: result, error: rpcError } = await sb.rpc("deactivate_photography_key", {
        p_key_id: keyId,
      });
      if (rpcError) throw rpcError;
      const row = Array.isArray(result) ? result[0] : result;
      if (!row?.success) {
        setError(row?.message || "Failed to deactivate key.");
        return;
      }
      setNotice("Device deactivated. Key is now available.");
      const { data: { session } } = await sb.auth.getSession();
      await loadStudioAppStatus(session?.access_token ?? null);
    } catch (err: any) {
      setError(err.message || "Failed to deactivate key.");
    }
  }

  async function runStudioAppAdminAction(
    actionKey: string,
    payload: Record<string, unknown>,
    fallbackNotice: string,
  ) {
    setStudioAppBusyAction(actionKey);
    setStudioAppError(null);
    setError(null);
    setNotice(null);

    try {
      const headers = await getAuthorizedHeaders();
      const res = await fetch("/api/studio-os-app/admin", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        studioApp?: StudioAppStatus;
        updatedTarget?: {
          billingEmail?: string | null;
          studioEmail?: string | null;
          betaAccess?: boolean;
        };
      };

      if (!res.ok || !json.ok) {
        throw new Error(json.message || "Unable to update Studio OS App rollout.");
      }

      if (json.studioApp?.ok) {
        applyStudioAppStatus(json.studioApp);
      } else {
        await loadStudioAppStatus(accessToken);
      }

      if (json.updatedTarget) {
        const targetEmail =
          json.updatedTarget.billingEmail || json.updatedTarget.studioEmail || betaTargetEmail;
        setNotice(
          `${targetEmail} beta access ${json.updatedTarget.betaAccess ? "enabled" : "disabled"}.`,
        );
      } else {
        setNotice(fallbackNotice);
      }
    } catch (error) {
      setStudioAppError(
        error instanceof Error
          ? error.message
          : "Unable to update Studio OS App rollout.",
      );
    } finally {
      setStudioAppBusyAction(null);
    }
  }

  async function handleSaveStudioAppRelease() {
    await runStudioAppAdminAction(
      "release",
      {
        action: "update_release",
        releaseState: releaseStateDraft,
        version: releaseVersionDraft,
        releaseNotes: releaseNotesDraft,
        betaWarning: betaWarningDraft,
        macDownloadUrl: macDownloadUrlDraft,
        windowsDownloadUrl: windowsDownloadUrlDraft,
      },
      "Studio OS App release settings updated.",
    );
  }

  async function handleUpdateBetaAccess() {
    await runStudioAppAdminAction(
      "beta-access",
      {
        action: "set_beta_access",
        targetEmail: betaTargetEmail,
        betaAccess: betaTargetEnabled,
      },
      "Studio OS App beta access updated.",
    );
  }

  async function runBillingAction(
    actionKey: string,
    payload: Record<string, unknown>,
    fallbackNotice: string,
  ) {
    setBillingBusyAction(actionKey);
    setError(null);
    setNotice(null);

    try {
      const headers = await getAuthorizedHeaders();
      const res = await fetch("/api/stripe/billing", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.message || "Unable to update billing.");
      }

      if (json.url) {
        window.location.href = json.url;
        return;
      }

      await loadStatus();
      setNotice(fallbackNotice);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update billing.");
    } finally {
      setBillingBusyAction(null);
    }
  }

  async function handlePlanSave() {
    const hasSubscription = Boolean(stripeSubscriptionId);
    const nextExtraDesktopKeys =
      desiredPlanCode === "studio" ? desiredExtraDesktopKeys : 0;
    await runBillingAction(
      "plan",
      {
        action: hasSubscription ? "update_plan" : "subscribe",
        planCode: desiredPlanCode,
        billingInterval: desiredBillingInterval,
        extraDesktopKeys: nextExtraDesktopKeys,
      },
      "Billing configuration updated.",
    );
  }

  async function handleOpenPortal() {
    await runBillingAction(
      "portal",
      { action: "portal" },
      "Billing portal refreshed.",
    );
  }

  async function handleBuyCredits(packCode: string) {
    await runBillingAction(
      `credits:${packCode}`,
      { action: "buy_credits", packCode },
      "Background credit purchase started.",
    );
  }

  const activePlan =
    billingCatalog.plans.find((plan) => plan.code === (subscriptionPlanCode || desiredPlanCode)) ||
    billingCatalog.plans[0];
  const selectedExtraKeyPrice =
    desiredBillingInterval === "year"
      ? billingCatalog.extraDesktopKeyAnnualCents
      : billingCatalog.extraDesktopKeyMonthlyCents;
  const extraKeysAllowed = desiredPlanCode === "studio";
  const subscriptionInTrial = isTrialStatus(subscriptionStatus);
  const hasManagedSubscription = Boolean(stripeSubscriptionId || subscriptionPlanCode);
  const displayPlanLabel = isPlatformAdmin
    ? "Owner access"
    : subscriptionPlanCode
    ? planDisplayLabel(subscriptionPlanCode)
    : subscriptionInTrial
      ? "Trial access"
      : "Not subscribed";
  const displayBillingInterval = isPlatformAdmin
    ? "Included"
    : hasManagedSubscription
    ? intervalLabel(subscriptionBillingInterval)
    : subscriptionInTrial
      ? "Trial"
      : "Not started";
  const displayStatusLabel = isPlatformAdmin
    ? "Internal owner account"
    : subscriptionInTrial
    ? "Trial active"
    : humanizeStatus(subscriptionStatus);
  const displayNextBillingDate = isPlatformAdmin
    ? "No owner charge scheduled"
    : subscriptionCurrentPeriodEnd
    ? formatDateLabel(subscriptionCurrentPeriodEnd)
    : subscriptionInTrial
      ? "No charge scheduled yet"
      : "Pending";
  const displayIncludedCredits = isPlatformAdmin
    ? "Owner access included"
    : "Sold separately — purchase credit packs below. Unused credits do not carry over to the next month.";
  const showSubscriptionLockedWarning =
    !isPlatformAdmin && !subscriptionIsActive && !subscriptionInTrial;
  const showTrialInfo = !isPlatformAdmin && subscriptionInTrial;
  const connectButtonLabel = connectReadyForPayments ? "Manage Stripe" : "Connect Stripe";
  const planActionLabel =
    billingBusyAction === "plan"
      ? "Opening billing..."
      : isPlatformAdmin
        ? "Owner account included"
      : stripeSubscriptionId
        ? "Update plan + keys"
        : subscriptionInTrial
          ? "Activate paid subscription"
          : "Start subscription";
  const studioAppReleaseIsBeta = studioApp.release.state !== "public";
  const studioAppDownloadsReady =
    Boolean(studioApp.release.macDownloadUrl || studioApp.release.windowsDownloadUrl);
  const studioAppPlanLabel =
    studioApp.entitlement.planCode === "studio"
      ? "Studio"
      : studioApp.entitlement.planCode === "core"
        ? "App Plan"
        : studioApp.entitlement.planCode === "starter"
          ? "Web Gallery"
          : "No plan";

  return (
    <div style={{ background: "#eef3fa", minHeight: "100vh", padding: "32px 28px 60px" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: "#64748b" }}>
            Dashboard settings
          </div>
          <h1 style={{ marginTop: 10, fontSize: 48, lineHeight: 1.04, fontWeight: 900, color: "#0f172a" }}>
            Branding + Billing + Stripe Connect
          </h1>
          <p style={{ marginTop: 12, maxWidth: 840, fontSize: 18, lineHeight: 1.7, color: "#64748b" }}>
            Photographer sales route through the photographer’s own connected Stripe account, while Studio OS bills plans,
            extra desktop keys, background credits, and aggregated order usage separately through platform billing.
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
            <CreditCard size={18} /> {connecting ? "Opening Stripe..." : connectButtonLabel}
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

        {warnings.length ? (
          <div style={{ marginBottom: 20, borderRadius: 20, border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", padding: "16px 18px", fontWeight: 700 }}>
            {warnings.join(" ")}
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

            <div style={{ marginTop: 12, color: "#64748b", lineHeight: 1.6, fontSize: 13 }}>
              Custom website logo presentation is positioned as a Core and Studio perk. Starter stays on the WhitePhoto branding foundation for public website identity.
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
            <div style={{ marginBottom: 14, borderRadius: 16, border: "1px solid #dbeafe", background: "#ffffff", padding: "14px 16px" }}>
              <div style={{ fontWeight: 900, color: connectReadyForPayments ? "#15803d" : "#b45309" }}>
                {connectStatusLabel}
              </div>
              <div style={{ marginTop: 6, color: "#64748b", lineHeight: 1.6, fontSize: 14 }}>
                {connectDisabledReason || connectStatusMessage}
              </div>
            </div>
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
              {connecting ? "Opening Stripe..." : connectButtonLabel}
            </button>
          </div>
        </div>

        {/* ── Row 1.5: Combine orders & shipping commerce knobs ─────────
            Per-studio config for the sibling-combine discount tiers,
            flat shipping fee, and late-handling % (applied automatically
            when a parent orders after the school's order_due_date).
            Spec: docs/design/combine-orders-and-recovery.md. */}
        <div
          style={{ marginTop: 20, position: "relative" }}
          onClickCapture={() => dismissCommerceCardDot()}
        >
          <WhatsNewDot
            featureId="combine-orders-commerce-settings-v1"
            asBareDot
            top={12}
            right={16}
            size={12}
          />
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: "#fff5f5", display: "grid", placeItems: "center" }}>
                <span style={{ fontSize: 22 }}>🤝</span>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
                  Commerce
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>Combine orders &amp; shipping</div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: "#475569", margin: "0 0 18px 0", lineHeight: 1.55 }}>
              Discounts apply to the second sibling onward — the primary kid pays full price.
              Shipping is charged once per combined order (never multiplied by sibling count).
              When a parent orders after a school&rsquo;s due date, school pickup is disabled and
              the late handling fee is added automatically.
            </p>

            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <NumberField
                label="2-kid sibling discount"
                suffix="%"
                value={siblingTier2Percent}
                onChange={setSiblingTier2Percent}
                min={0}
                max={50}
                step={1}
                helper="Applied to the 2nd kid"
              />
              <NumberField
                label="3+ kid sibling discount"
                suffix="%"
                value={siblingTier3Percent}
                onChange={setSiblingTier3Percent}
                min={0}
                max={50}
                step={1}
                helper="Applied to each additional kid (3+)"
              />
              <NumberField
                label="Shipping fee"
                prefix="$"
                value={Math.round(shippingFeeCents) / 100}
                onChange={(v) => setShippingFeeCents(Math.round(v * 100))}
                min={0}
                max={200}
                step={0.5}
                helper="Per combined order; never free"
              />
              <NumberField
                label="Late handling fee"
                suffix="%"
                value={lateHandlingFeePercent}
                onChange={setLateHandlingFeePercent}
                min={0}
                max={50}
                step={1}
                helper="Added when ordering past due date"
              />
            </div>

            {/* Dedicated save button so the action is obvious without
                scrolling back up to the top-of-page Save settings pill.
                Calls the same saveBranding() — the commerce knobs are
                wired into the same photographers update. */}
            <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={saveBranding}
                disabled={saving}
                style={{
                  borderRadius: 12,
                  background: saving ? "#94a3b8" : "#0f172a",
                  color: "#fff",
                  border: "none",
                  padding: "12px 22px",
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: saving ? "wait" : "pointer",
                  letterSpacing: "0.02em",
                }}
              >
                {saving ? "Saving…" : "Save commerce settings"}
              </button>
            </div>
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
              <Field label="Billing email" value={billingEmail} onChange={setBillingEmail} placeholder="billing@yourstudio.com" icon={<Receipt size={14} color="#94a3b8" />} />

              {/* Currency selector */}
              <label style={{ display: "block" }}>
                <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 700, color: "#475569" }}>Currency</div>
                <div style={{ position: "relative" }}>
                  <select
                    value={billingCurrency}
                    onChange={(e) => setBillingCurrency(e.target.value)}
                    style={{
                      width: "100%",
                      borderRadius: 18,
                      border: "1px solid #d6dfef",
                      background: "#fff",
                      padding: "14px 16px",
                      fontSize: 16,
                      color: "#0f172a",
                      outline: "none",
                      appearance: "none",
                      WebkitAppearance: "none",
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "right 16px center",
                      cursor: "pointer",
                    }}
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.symbol}  {c.code.toUpperCase()} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            </div>

            <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7, marginTop: 14, padding: "12px 14px", background: "#f0fdf4", borderRadius: 14, border: "1px solid #d1fae5" }}>
              Contact info and currency will appear on invoices, order forms, and the parent-facing gallery. Currency also applies to the desktop app price lists.
            </div>
          </div>
        </div>

        {/* ── Payment method card ─────────────────────────────────────── */}
        <div style={{ marginTop: 20 }}>
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: "#fdf4ff", display: "grid", placeItems: "center" }}>
                <CreditCard size={24} color="#a855f7" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
                  Payments
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>Payment method</div>
              </div>
            </div>

            {defaultPaymentMethod ? (
              <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 20px", background: "#f8fafc", borderRadius: 18, border: "1px solid #d6dfef" }}>
                <div style={{ width: 48, height: 32, borderRadius: 8, background: "#0f172a", display: "grid", placeItems: "center" }}>
                  <span style={{ color: "#fff", fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {defaultPaymentMethod.brand}
                  </span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 15 }}>
                    •••• •••• •••• {defaultPaymentMethod.last4}
                  </div>
                  <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
                    Expires {String(defaultPaymentMethod.expMonth).padStart(2, "0")}/{defaultPaymentMethod.expYear}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleOpenPortal}
                  disabled={billingBusyAction === "portal" || !sessionReady}
                  style={{
                    border: "1px solid #d6dfef",
                    borderRadius: 14,
                    background: "#fff",
                    padding: "10px 18px",
                    fontWeight: 800,
                    color: "#0f172a",
                    cursor: billingBusyAction === "portal" || !sessionReady ? "not-allowed" : "pointer",
                    opacity: billingBusyAction === "portal" || !sessionReady ? 0.65 : 1,
                    fontSize: 13,
                  }}
                >
                  {billingBusyAction === "portal" ? "Opening..." : "Manage"}
                </button>
              </div>
            ) : (
              <div style={{ padding: "18px 20px", background: "#fffbeb", borderRadius: 18, border: "1px solid #fde68a", display: "flex", alignItems: "center", gap: 14 }}>
                <AlertCircle size={18} color="#d97706" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, color: "#92400e", fontSize: 14 }}>No payment method on file</div>
                  <div style={{ fontSize: 13, color: "#a16207", marginTop: 2 }}>Add a credit card through the billing portal to enable subscriptions and purchases.</div>
                </div>
                <button
                  type="button"
                  onClick={handleOpenPortal}
                  disabled={billingBusyAction === "portal" || !sessionReady}
                  style={{
                    border: "1px solid #f59e0b",
                    borderRadius: 14,
                    background: "#fef3c7",
                    padding: "10px 18px",
                    fontWeight: 800,
                    color: "#92400e",
                    cursor: billingBusyAction === "portal" || !sessionReady ? "not-allowed" : "pointer",
                    opacity: billingBusyAction === "portal" || !sessionReady ? 0.65 : 1,
                    fontSize: 13,
                  }}
                >
                  {billingBusyAction === "portal" ? "Opening..." : "Add card"}
                </button>
              </div>
            )}

            <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7, marginTop: 14, padding: "12px 14px", background: "#fdf4ff", borderRadius: 14, border: "1px solid #f3e8ff" }}>
              Your payment method is stored securely by Stripe. It will be used for subscriptions, credit pack purchases, and per-order usage fees.
            </div>
          </div>
        </div>

        {/* ── Row 3: Billing controls + status ────────────────────────── */}
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "1.25fr 0.95fr", marginTop: 20 }}>
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: "#eff6ff", display: "grid", placeItems: "center" }}>
                <WalletCards size={24} color="#2563eb" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
                  Platform billing
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>Studio OS subscription</div>
              </div>
            </div>

            <div style={{ display: "inline-flex", gap: 8, padding: 6, borderRadius: 18, background: "#f1f5f9", border: "1px solid #d6dfef", marginBottom: 18 }}>
              {(["month", "year"] as BillingInterval[]).map((interval) => {
                const active = desiredBillingInterval === interval;
                return (
                  <button
                    key={interval}
                    type="button"
                    onClick={() => setDesiredBillingInterval(interval)}
                    style={{
                      border: "none",
                      borderRadius: 14,
                      background: active ? "#0f172a" : "transparent",
                      color: active ? "#fff" : "#475569",
                      padding: "10px 16px",
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    {intervalLabel(interval)}
                    {interval === "year"
                      ? ` · Save ${billingCatalog.annualDiscountPercent}%`
                      : ""}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 14 }}>
              {billingCatalog.plans.map((plan) => {
                const selected = desiredPlanCode === plan.code;
                const current =
                  subscriptionPlanCode === plan.code &&
                  subscriptionBillingInterval === desiredBillingInterval;
                const activePrice =
                  desiredBillingInterval === "year" ? plan.annualPriceCents : plan.priceCents;
                return (
                  <button
                    key={plan.code}
                    type="button"
                    onClick={() => setDesiredPlanCode(plan.code)}
                    style={{
                      border: selected ? "2px solid #0f172a" : current ? "1px solid #93c5fd" : "1px solid #d6dfef",
                      borderRadius: 20,
                      background: selected ? "#f8fafc" : "#fff",
                      padding: 18,
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>
                        {planDisplayLabel(plan.code) || plan.label}
                      </div>
                      {current ? <CheckCircle2 size={18} color="#2563eb" /> : null}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 22, fontWeight: 900, color: "#0f172a" }}>
                      {formatMoney(activePrice, billingCurrency)}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b" }}>
                      {desiredBillingInterval === "year" ? "Annual prepaid" : "Monthly"}
                    </div>
                    <div style={{ marginTop: 10, color: "#64748b", lineHeight: 1.6, fontSize: 14 }}>
                      {plan.description}
                    </div>
                    <div style={{ marginTop: 10, color: "#334155", lineHeight: 1.7, fontSize: 13 }}>
                      {plan.code === "starter"
                        ? `${formatMoney(plan.usageRateCents, billingCurrency)} per paid order · web-only plan`
                        : `${formatMoney(plan.usageRateCents, billingCurrency)} per paid order · background credits sold separately`}
                    </div>
                    <div style={{ marginTop: 10, color: "#475569", lineHeight: 1.7, fontSize: 13 }}>
                      {plan.code === "starter"
                        ? "Online gallery only. Upgrade to Core or Studio to unlock the Studio OS App."
                        : plan.websiteLogoIncluded
                          ? "Full Studio OS App access + custom website logo included."
                          : "Custom website logo + studio branding included."}
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, marginTop: 18, alignItems: "end" }}>
              <label style={{ display: "block" }}>
                <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                  Extra desktop keys
                </div>
                <div style={{ position: "relative" }}>
                  <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                    <KeyRound size={14} color="#94a3b8" />
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={extraKeysAllowed ? desiredExtraDesktopKeys : 0}
                    onChange={(e) =>
                      setDesiredExtraDesktopKeys(Math.max(0, Number(e.target.value || 0)))
                    }
                    disabled={!extraKeysAllowed}
                    style={{
                      width: "100%",
                      borderRadius: 18,
                      border: "1px solid #d6dfef",
                      background: extraKeysAllowed ? "#fff" : "#f8fafc",
                      padding: "14px 16px 14px 36px",
                      fontSize: 16,
                      color: "#0f172a",
                      outline: "none",
                      opacity: extraKeysAllowed ? 1 : 0.65,
                    }}
                  />
                </div>
                <div style={{ marginTop: 8, color: "#64748b", fontSize: 13 }}>
                  {!extraKeysAllowed
                    ? desiredPlanCode === "core"
                      ? "App Plan includes 1 photography key. Upgrade to Studio for a second key or any extra keys."
                      : "Web Gallery stays web-only. Upgrade to App Plan or Studio to unlock the Studio OS App."
                    : `${formatMoney(selectedExtraKeyPrice, billingCurrency)} per extra key ${
                        desiredBillingInterval === "year"
                          ? "per year, billed in advance."
                          : "per month."
                      }`}
                </div>
              </label>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {isPlatformAdmin ? (
                  <div
                    style={{
                      maxWidth: 360,
                      borderRadius: 18,
                      border: "1px solid #bfdbfe",
                      background: "#eff6ff",
                      padding: "14px 16px",
                      color: "#1d4ed8",
                      fontWeight: 700,
                      lineHeight: 1.6,
                    }}
                  >
                    This owner account stays free for internal platform use. Create a non-owner photographer account to test paid subscriptions and checkout billing.
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handlePlanSave}
                      disabled={billingBusyAction === "plan" || !sessionReady}
                      style={{
                        border: "1px solid #0f172a",
                        borderRadius: 18,
                        background: "#0f172a",
                        padding: "14px 20px",
                        fontWeight: 800,
                        color: "#fff",
                        cursor: billingBusyAction === "plan" || !sessionReady ? "not-allowed" : "pointer",
                        opacity: billingBusyAction === "plan" || !sessionReady ? 0.65 : 1,
                      }}
                    >
                      {planActionLabel}
                    </button>

                    <button
                      type="button"
                      onClick={handleOpenPortal}
                      disabled={billingBusyAction === "portal" || !sessionReady}
                      style={{
                        border: "1px solid #d6dfef",
                        borderRadius: 18,
                        background: "#fff",
                        padding: "14px 20px",
                        fontWeight: 800,
                        color: "#0f172a",
                        cursor: billingBusyAction === "portal" || !sessionReady ? "not-allowed" : "pointer",
                        opacity: billingBusyAction === "portal" || !sessionReady ? 0.65 : 1,
                      }}
                    >
                      {billingBusyAction === "portal" ? "Opening portal..." : "Open billing portal"}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div style={{ marginTop: 16, fontSize: 13, color: "#64748b", lineHeight: 1.7, padding: "12px 14px", background: "#f8fafc", borderRadius: 14, border: "1px solid #e2e8f0" }}>
              Customer checkout payments go straight to the photographer’s connected Stripe account. Studio OS billing stays separate on the platform account for plans, extra keys, cloud credit packs, and aggregated order usage.
            </div>
          </div>

          <div style={{ ...cardStyle, background: "#f8fbff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: "#e0f2fe", display: "grid", placeItems: "center" }}>
                <Sparkles size={24} color="#0284c7" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
                  Billing health
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>Current status</div>
              </div>
            </div>

            <StatusRow label="Current plan" value={displayPlanLabel} ok={subscriptionIsActive || subscriptionInTrial} />
            <StatusRow label="Billing interval" value={displayBillingInterval} ok={subscriptionIsActive || subscriptionInTrial} />
            <StatusRow label="Subscription status" value={displayStatusLabel} ok={subscriptionIsActive || subscriptionInTrial} />
            <StatusRow label="Next billing date" value={displayNextBillingDate} ok={subscriptionIsActive || subscriptionInTrial} />
            <StatusRow label="Billing email" value={billingEmail || studioEmail || "Not set"} />
            <StatusRow label="Connected checkout" value={connectStatusLabel} ok={connectReadyForPayments} />
            <StatusRow label="Extra desktop keys" value={String(extraDesktopKeys)} ok />
            <StatusRow
              label="Credit balance"
              value={isPlatformAdmin ? "Unlimited (owner)" : `${creditBalance} credits`}
              ok
            />
            <StatusRow
              label="Background credits"
              value={isPlatformAdmin ? "Unlimited (owner)" : displayIncludedCredits}
              ok={isPlatformAdmin || creditBalance > 0}
            />

            {subscriptionPlanCode ? (
              <div style={{ marginTop: 14, borderRadius: 18, border: "1px solid #cbd5e1", background: "#fff", padding: "16px 18px" }}>
                <div style={{ fontWeight: 900, color: "#0f172a" }}>Order usage this cycle</div>
                <div style={{ marginTop: 10, display: "grid", gap: 8, color: "#334155" }}>
                  <div>Usage rate: <strong>{formatMoney(orderUsageRateCents, billingCurrency)} per paid order</strong></div>
                  <div>Billable paid orders: <strong>{studioUsage.billableOrders}</strong></div>
                  <div>Already reported to Stripe: <strong>{studioUsage.countedOrders}</strong></div>
                  <div>Pending report sync: <strong>{studioUsage.unreportedOrders}</strong></div>
                  <div>Estimated usage charge: <strong>{formatMoney(studioUsage.estimatedChargeCents, billingCurrency)}</strong></div>
                </div>
              </div>
            ) : null}

            {isPlatformAdmin ? (
              <div style={{ marginTop: 14, borderRadius: 14, border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", padding: "12px 14px", lineHeight: 1.6, fontWeight: 700 }}>
                This is the platform owner account, so billing stays free here. Use a separate non-owner photographer account when you want to test the paid Studio OS subscription flow.
              </div>
            ) : showTrialInfo || trialActive ? (
              <div style={{ marginTop: 14, borderRadius: 14, border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", padding: "12px 14px", lineHeight: 1.6, fontWeight: 700 }}>
                {trialActive ? (
                  <>
                    Free trial active — <strong>{trialDaysRemaining} day{trialDaysRemaining === 1 ? "" : "s"} remaining</strong>
                    {trialEndsAt ? ` (ends ${new Date(trialEndsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })})` : ""}.
                    {" "}Start a paid subscription before your trial ends to keep Studio OS features running without interruption.
                  </>
                ) : (
                  <>Trial access is active. Connected checkout already works, but you should start a paid subscription before the trial ends to keep Studio OS features running without interruption.</>
                )}
              </div>
            ) : null}

            {showSubscriptionLockedWarning ? (
              <div style={{ marginTop: 14, borderRadius: 14, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", padding: "12px 14px", lineHeight: 1.6, fontWeight: 700 }}>
                Paid Studio OS features stay locked until the subscription is active again.
              </div>
            ) : null}

            {!connectReadyForPayments ? (
              <div style={{ marginTop: 14, borderRadius: 14, border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", padding: "12px 14px", lineHeight: 1.6, fontWeight: 700 }}>
                Parent checkout is blocked until the connected Stripe account is ready for charges and payouts.
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Row 4: Credits + invoices ──────────────────────────────── */}
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "1fr 1fr", marginTop: 20 }}>
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: "#ecfeff", display: "grid", placeItems: "center" }}>
                <CreditCard size={24} color="#0891b2" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
                  Monthly Background Credits
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>Buy credit packs</div>
              </div>
            </div>

            <div style={{ marginBottom: 16, fontSize: 13, color: "#64748b", lineHeight: 1.7, padding: "12px 14px", background: "#f8fafc", borderRadius: 14, border: "1px solid #e2e8f0" }}>
              Credits reset every billing cycle. Unused credits do not carry over to the next month.
            </div>

            <div style={{ marginBottom: 16, fontSize: 13, color: "#475569", lineHeight: 1.7, padding: "12px 14px", background: "#f1f5f9", borderRadius: 14, border: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>Background Removal Credit Usage</div>
              <div>Background Removal (Local) — 1 credit</div>
              <div>Background Removal (Premium Cloud) — 4 credits</div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>Premium Cloud uses Studio OS premium cloud processing for cleaner, faster results.</div>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              {billingCatalog.creditPacks.map((pack) => {
                const actionKey = `credits:${pack.code}`;
                return (
                  <div
                    key={pack.code}
                    style={{
                      border: "1px solid #d6dfef",
                      borderRadius: 18,
                      padding: "16px 18px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>
                        {pack.label || pack.name}
                      </div>
                      <div style={{ marginTop: 4, color: "#64748b" }}>
                        {pack.credits} monthly credits for {formatMoney(pack.priceCents, billingCurrency)}
                      </div>
                      <div style={{ marginTop: 2, color: "#94a3b8", fontSize: 12 }}>
                        Approx. {Math.floor(pack.credits / 4)} Premium Cloud removals
                      </div>
                      <div style={{ marginTop: 4, color: "#94a3b8", fontSize: 12 }}>
                        Unused credits do not carry over to the next month.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleBuyCredits(pack.code)}
                      disabled={billingBusyAction === actionKey || !sessionReady}
                      style={{
                        border: "1px solid #0f172a",
                        borderRadius: 16,
                        background: "#0f172a",
                        padding: "12px 16px",
                        fontWeight: 800,
                        color: "#fff",
                        cursor: billingBusyAction === actionKey || !sessionReady ? "not-allowed" : "pointer",
                        opacity: billingBusyAction === actionKey || !sessionReady ? 0.65 : 1,
                      }}
                    >
                      {billingBusyAction === actionKey ? "Opening..." : "Buy credits"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: "#eef2ff", display: "grid", placeItems: "center" }}>
                <Receipt size={24} color="#4f46e5" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
                  Invoices
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>Recent Stripe invoices</div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {recentInvoices.length ? recentInvoices.map((invoice) => (
                <div key={invoice.id} style={{ border: "1px solid #d6dfef", borderRadius: 18, padding: "14px 16px", background: "#fff" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>{invoice.id}</div>
                      <div style={{ marginTop: 4, color: "#64748b", fontSize: 14 }}>
                        {formatDateLabel(invoice.created)} • {humanizeStatus(invoice.status)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>
                        {formatMoney(invoice.amountPaid || invoice.amountDue, invoice.currency)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                    {invoice.hostedInvoiceUrl ? (
                      <a
                        href={invoice.hostedInvoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#2563eb", fontWeight: 800, textDecoration: "none" }}
                      >
                        View invoice
                      </a>
                    ) : null}
                    {invoice.invoicePdf ? (
                      <a
                        href={invoice.invoicePdf}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#2563eb", fontWeight: 800, textDecoration: "none" }}
                      >
                        Download PDF
                      </a>
                    ) : null}
                  </div>
                </div>
              )) : (
                <div style={{ borderRadius: 18, border: "1px dashed #cbd5e1", background: "#f8fafc", padding: "18px 20px", color: "#64748b", lineHeight: 1.7 }}>
                  Recent Studio OS invoices will appear here after the first successful billing cycle.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Row 5: Studio OS App beta rollout ─────────────────────── */}
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "1.2fr 0.8fr", marginTop: 20 }}>
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: "#eef2ff", display: "grid", placeItems: "center" }}>
                <MonitorSmartphone size={24} color="#4338ca" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
                  Studio OS App
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>
                  Studio OS App Beta Access
                </div>
              </div>
            </div>

            {studioAppError ? (
              <div style={{ marginBottom: 16, borderRadius: 16, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", padding: "12px 14px", fontWeight: 700 }}>
                {studioAppError}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
              <div style={{ borderRadius: 999, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", padding: "8px 12px", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {studioApp.release.stateLabel}
              </div>
              <div style={{ borderRadius: 999, border: "1px solid #d6dfef", background: "#fff", color: "#0f172a", padding: "8px 12px", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {studioApp.release.version}
              </div>
              <div style={{ borderRadius: 999, border: "1px solid #d6dfef", background: "#fff", color: "#0f172a", padding: "8px 12px", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {studioAppPlanLabel}
              </div>
            </div>

            <div style={{ borderRadius: 18, border: "1px solid #d6dfef", background: "#f8fafc", padding: "16px 18px", color: "#334155", lineHeight: 1.8, marginBottom: 18 }}>
              {studioApp.entitlement.message}
            </div>

            {studioApp.entitlement.showBetaWarning ? (
              <div style={{ marginBottom: 18, borderRadius: 18, border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", padding: "14px 16px", lineHeight: 1.7, fontWeight: 700 }}>
                {studioApp.release.betaWarning}
              </div>
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
              {studioApp.release.macDownloadUrl && studioApp.entitlement.canDownload ? (
                <a
                  href="/api/studio-os-app/download?platform=mac"
                  style={{
                    border: "1px solid #0f172a",
                    borderRadius: 18,
                    background: "#0f172a",
                    padding: "14px 18px",
                    fontWeight: 800,
                    color: "#fff",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                  }}
                >
                  <Download size={16} /> Download Mac App
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  style={{
                    border: "1px solid #d6dfef",
                    borderRadius: 18,
                    background: "#f8fafc",
                    padding: "14px 18px",
                    fontWeight: 800,
                    color: "#94a3b8",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                  }}
                >
                  <Download size={16} /> Mac Download
                </button>
              )}

              {studioApp.release.windowsDownloadUrl && studioApp.entitlement.canDownload ? (
                <a
                  href="/api/studio-os-app/download?platform=windows"
                  style={{
                    border: "1px solid #2563eb",
                    borderRadius: 18,
                    background: "#eff6ff",
                    padding: "14px 18px",
                    fontWeight: 800,
                    color: "#1d4ed8",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                  }}
                >
                  <Download size={16} /> Download Windows App
                </a>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button
                    type="button"
                    disabled
                    style={{
                      border: "1px solid #d6dfef",
                      borderRadius: 18,
                      background: "#f8fafc",
                      padding: "14px 18px",
                      fontWeight: 800,
                      color: "#94a3b8",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 10,
                      width: "100%",
                    }}
                  >
                    <Download size={16} /> Windows Download
                  </button>
                  <div
                    style={{
                      textAlign: "center",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#94a3b8",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                    }}
                  >
                    Coming soon
                  </div>
                </div>
              )}
            </div>

            <div style={{ borderRadius: 18, border: "1px solid #d6dfef", background: "#fff", padding: "16px 18px", marginBottom: 18 }}>
              <div style={{ fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>Release notes</div>
              <div style={{ color: "#64748b", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
                {studioApp.release.releaseNotes}
              </div>
              <div style={{ marginTop: 10, color: "#94a3b8", fontSize: 13 }}>
                Updated {formatDateLabel(studioApp.release.updatedAt)}
              </div>
            </div>

            <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a", marginBottom: 12 }}>
              Photography Keys
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              {studioApp.keys.length ? (
                studioApp.keys.map((key) => (
                  <div
                    key={key.id}
                    style={{
                      border: "1px solid #d6dfef",
                      borderRadius: 18,
                      background: "#fff",
                      padding: "16px 18px",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                      <div>
                        <div style={{ fontWeight: 900, color: "#0f172a" }}>
                          {key.label}
                          {key.isExtraKey ? " · Extra Key" : ""}
                        </div>
                        <div style={{ marginTop: 4, color: "#64748b", fontSize: 14 }}>
                          {key.activationStatus === "active"
                            ? `Activated on ${key.deviceName || key.platform || "a device"}`
                            : "Not activated on a device yet"}
                        </div>
                      </div>
                      <div style={{ fontWeight: 800, color: key.activationStatus === "active" ? "#15803d" : "#94a3b8" }}>
                        {key.activationStatus === "active" ? "In Use" : "Available"}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 14, fontWeight: 700, color: "#0f172a", background: "#f8fafc", border: "1px solid #d6dfef", borderRadius: 12, padding: "10px 12px" }}>
                        {key.keyCode}
                      </div>
                      <button
                        type="button"
                        onClick={() => copyPhotographyKey(key.keyCode)}
                        style={{
                          border: "1px solid #d6dfef",
                          borderRadius: 14,
                          background: "#fff",
                          padding: "10px 14px",
                          fontWeight: 800,
                          color: "#0f172a",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          cursor: "pointer",
                        }}
                      >
                        <Copy size={14} /> Copy
                      </button>
                      {key.activationStatus === "active" && key.deviceId ? (
                        <button
                          type="button"
                          onClick={() => deactivatePhotographyKey(key.id)}
                          style={{
                            border: "1px solid #fecaca",
                            borderRadius: 14,
                            background: "#fef2f2",
                            padding: "10px 14px",
                            fontWeight: 800,
                            color: "#dc2626",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            cursor: "pointer",
                          }}
                        >
                          Deactivate
                        </button>
                      ) : null}
                    </div>

                    <div style={{ color: "#64748b", fontSize: 13, lineHeight: 1.7 }}>
                      Last validation: {formatDateLabel(key.lastValidatedAt)} · Slot {key.slotIndex}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ borderRadius: 18, border: "1px dashed #cbd5e1", background: "#f8fafc", padding: "18px 20px", color: "#64748b", lineHeight: 1.7 }}>
                  No Photography Keys are active on this account yet. Web Gallery does not include app access. App Plan includes 1 key. Studio includes 2 keys, and only Studio can add extra keys for $55 each.
                </div>
              )}
            </div>
          </div>

          <div style={{ ...cardStyle, background: "#f8fbff" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: "#ecfeff", display: "grid", placeItems: "center" }}>
                <ShieldCheck size={24} color="#0891b2" />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
                  App entitlement
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>
                  Plan and rollout summary
                </div>
              </div>
            </div>

            <StatusRow label="Release state" value={studioApp.release.stateLabel} ok={studioApp.release.state === "public"} />
            <StatusRow label="App eligible by plan" value={studioApp.entitlement.appEligibleByPlan ? "Yes" : "No"} ok={studioApp.entitlement.appEligibleByPlan} />
            <StatusRow label="Beta access flag" value={studioApp.entitlement.betaAccess ? "Approved" : "Off"} ok={studioApp.entitlement.betaAccess || studioApp.release.state === "public"} />
            <StatusRow label="Studio OS App enabled" value={studioApp.entitlement.appAccessEnabled ? "Enabled" : "Locked"} ok={studioApp.entitlement.appAccessEnabled} />
            <StatusRow label="Included keys" value={String(studioApp.entitlement.includedKeys)} ok={studioApp.entitlement.includedKeys > 0} />
            <StatusRow label="Extra keys" value={String(studioApp.entitlement.extraKeys)} ok={studioApp.entitlement.extraKeys > 0} />
            <StatusRow label="Total allowed keys" value={String(studioApp.entitlement.totalAllowedKeys)} ok={studioApp.entitlement.totalAllowedKeys > 0} />
            <StatusRow label="Downloads ready" value={studioAppDownloadsReady ? "Yes" : "Pending"} ok={studioAppDownloadsReady} />

            {/* ── Plan comparison grid ────────────────────────────────────
                Replaces a dense bullet list of pricing rules with a clean
                3-column grid. Each column shows monthly + yearly (with
                10% annual savings already calculated), what the plan
                includes for the desktop app, and how many photography
                keys are bundled. The bottom note carries the upgrade
                rule that doesn't fit cleanly inside a column. */}
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "#64748b",
                  marginBottom: 10,
                }}
              >
                Plan comparison
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 10,
                }}
              >
                <PlanCompareCard
                  name="Web Gallery"
                  monthly={49}
                  yearly={Math.round(49 * 12 * 0.9)}
                  yearlySavings="Save ~10%"
                  appAccess={false}
                  keysIncluded={0}
                  extras={null}
                  highlight={false}
                />
                <PlanCompareCard
                  name="App Plan"
                  monthly={99}
                  yearly={Math.round(99 * 12 * 0.9)}
                  yearlySavings="Save ~10%"
                  appAccess
                  keysIncluded={1}
                  extras="Upgrade to Studio for a 2nd key"
                  highlight={false}
                />
                <PlanCompareCard
                  name="Studio"
                  monthly={199}
                  yearly={Math.round(199 * 12 * 0.9)}
                  yearlySavings="Save ~10%"
                  appAccess
                  keysIncluded={2}
                  extras="$55 each extra key"
                  highlight
                />
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: "#64748b",
                  fontWeight: 600,
                  lineHeight: 1.55,
                }}
              >
                Yearly billing applies the 10% discount automatically at
                checkout. Photography Keys are bundled with App Plan and
                Studio subscriptions; extra keys are Studio-only.
              </div>
            </div>

            {studioAppReleaseIsBeta ? (
              <div style={{ marginTop: 14, borderRadius: 16, border: "1px solid #fde68a", background: "#fffbeb", color: "#92400e", padding: "12px 14px", lineHeight: 1.7, fontWeight: 700 }}>
                Beta rollout is active. Approved photographers can download the app and use Photography Keys while release links, notes, and builds are still evolving.
              </div>
            ) : null}

            <Link
              href="/dashboard/settings/studio-os-app-rollout"
              style={{
                marginTop: 16,
                border: "1px solid #d6dfef",
                borderRadius: 18,
                background: "#fff",
                padding: "14px 18px",
                fontWeight: 800,
                color: "#0f172a",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <BookOpenText size={18} /> Read beta rollout guide
            </Link>
          </div>
        </div>

        {studioApp.admin.isPlatformAdmin ? (
          <div style={{ display: "grid", gap: 20, gridTemplateColumns: "1.15fr 0.85fr", marginTop: 20 }}>
            <div style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                <div style={{ width: 54, height: 54, borderRadius: 16, background: "#eef2ff", display: "grid", placeItems: "center" }}>
                  <Sparkles size={24} color="#4f46e5" />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
                    Admin rollout config
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>
                    Studio OS App release settings
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <label style={{ display: "block" }}>
                  <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                    Release state
                  </div>
                  <select
                    value={releaseStateDraft}
                    onChange={(e) => setReleaseStateDraft(e.target.value as StudioAppReleaseState)}
                    style={{
                      width: "100%",
                      borderRadius: 18,
                      border: "1px solid #d6dfef",
                      background: "#fff",
                      padding: "14px 16px",
                      fontSize: 16,
                      color: "#0f172a",
                      outline: "none",
                    }}
                  >
                    <option value="hidden">Hidden</option>
                    <option value="beta">Beta</option>
                    <option value="public">Public</option>
                  </select>
                </label>

                <Field
                  label="Version"
                  value={releaseVersionDraft}
                  onChange={setReleaseVersionDraft}
                  placeholder="Beta 0.1.0"
                />
                <Field
                  label="Mac download URL"
                  value={macDownloadUrlDraft}
                  onChange={setMacDownloadUrlDraft}
                  placeholder="https://..."
                />
                <Field
                  label="Windows download URL"
                  value={windowsDownloadUrlDraft}
                  onChange={setWindowsDownloadUrlDraft}
                  placeholder="https://..."
                />
              </div>

              <div style={{ marginTop: 12, borderRadius: 16, border: "1px solid #d6dfef", background: "#f8fafc", padding: "12px 14px", color: "#475569", lineHeight: 1.7, fontSize: 14 }}>
                For private Supabase Storage files, paste the bucket path in this format:
                <br />
                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 700, color: "#0f172a" }}>
                  storage://studio-os-downloads/Studio OS.zip
                </span>
                <br />
                The dashboard download button will route through a protected server check before creating a short-lived download link.
              </div>

              <label style={{ display: "block", marginTop: 14 }}>
                <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                  Release notes
                </div>
                <textarea
                  value={releaseNotesDraft}
                  onChange={(e) => setReleaseNotesDraft(e.target.value)}
                  rows={6}
                  style={{
                    width: "100%",
                    borderRadius: 18,
                    border: "1px solid #d6dfef",
                    background: "#fff",
                    padding: "14px 16px",
                    fontSize: 15,
                    color: "#0f172a",
                    outline: "none",
                    resize: "vertical",
                    lineHeight: 1.7,
                  }}
                />
              </label>

              <label style={{ display: "block", marginTop: 14 }}>
                <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 700, color: "#475569" }}>
                  Beta warning
                </div>
                <textarea
                  value={betaWarningDraft}
                  onChange={(e) => setBetaWarningDraft(e.target.value)}
                  rows={4}
                  style={{
                    width: "100%",
                    borderRadius: 18,
                    border: "1px solid #d6dfef",
                    background: "#fff",
                    padding: "14px 16px",
                    fontSize: 15,
                    color: "#0f172a",
                    outline: "none",
                    resize: "vertical",
                    lineHeight: 1.7,
                  }}
                />
              </label>

              <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleSaveStudioAppRelease}
                  disabled={studioAppBusyAction === "release" || !sessionReady}
                  style={{
                    border: "1px solid #0f172a",
                    borderRadius: 18,
                    background: "#0f172a",
                    padding: "14px 20px",
                    fontWeight: 800,
                    color: "#fff",
                    cursor: studioAppBusyAction === "release" || !sessionReady ? "not-allowed" : "pointer",
                    opacity: studioAppBusyAction === "release" || !sessionReady ? 0.65 : 1,
                  }}
                >
                  {studioAppBusyAction === "release" ? "Saving..." : "Save release settings"}
                </button>
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                <div style={{ width: 54, height: 54, borderRadius: 16, background: "#ecfdf5", display: "grid", placeItems: "center" }}>
                  <KeyRound size={24} color="#059669" />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
                    Beta allow list
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>
                    Grant beta access
                  </div>
                </div>
              </div>

              <Field
                label="Billing or studio email"
                value={betaTargetEmail}
                onChange={setBetaTargetEmail}
                placeholder="photographer@example.com"
                icon={<Mail size={14} color="#94a3b8" />}
              />

              <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, color: "#0f172a", fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={betaTargetEnabled}
                  onChange={(e) => setBetaTargetEnabled(e.target.checked)}
                />
                Enable Studio OS App beta access for this account
              </label>

              <div style={{ marginTop: 12, color: "#64748b", lineHeight: 1.7 }}>
                Beta access only matters when the release state is <strong>hidden</strong> or <strong>beta</strong>. Plan rules still apply: $49 never gets app access, $99 gets 1 key, and $199 gets 2 keys plus optional $55 extras.
              </div>

              <button
                type="button"
                onClick={handleUpdateBetaAccess}
                disabled={studioAppBusyAction === "beta-access" || !sessionReady}
                style={{
                  marginTop: 16,
                  border: "1px solid #0f172a",
                  borderRadius: 18,
                  background: "#0f172a",
                  padding: "14px 20px",
                  fontWeight: 800,
                  color: "#fff",
                  cursor: studioAppBusyAction === "beta-access" || !sessionReady ? "not-allowed" : "pointer",
                  opacity: studioAppBusyAction === "beta-access" || !sessionReady ? 0.65 : 1,
                }}
              >
                {studioAppBusyAction === "beta-access" ? "Saving..." : "Update beta access"}
              </button>
            </div>
          </div>
        ) : null}

        {/* ── Two-Factor Authentication ────────────────────────────── */}
        <MfaSection accessToken={accessToken} sessionReady={sessionReady} />

      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  Two-Factor Authentication Section                                 */
/* ═══════════════════════════════════════════════════════════════════ */

function MfaSection({
  accessToken,
  sessionReady,
}: {
  accessToken: string | null;
  sessionReady: boolean;
}) {
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [factors, setFactors] = useState<
    Array<{ id: string; friendlyName: string; status: string; createdAt: string }>
  >([]);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [mfaMessage, setMfaMessage] = useState("");
  const [mfaError, setMfaError] = useState("");

  // Enrollment state
  const [enrolling, setEnrolling] = useState(false);
  const [enrollFactorId, setEnrollFactorId] = useState("");
  const [enrollQrUri, setEnrollQrUri] = useState("");
  const [enrollSecret, setEnrollSecret] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [unenrolling, setUnenrolling] = useState(false);

  const cardStyle: React.CSSProperties = {
    borderRadius: 28,
    border: "1px solid #d6dfef",
    background: "#fff",
    padding: "28px 28px",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  };

  const loadMfaStatus = useCallback(async () => {
    try {
      setMfaLoading(true);
      const res = await fetch("/api/dashboard/mfa", {
        method: "GET",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        credentials: "include",
        cache: "no-store",
      });

      const json = await res.json();
      if (res.ok && json.ok) {
        setFactors(json.factors ?? []);
        setMfaEnabled(json.mfaEnabled ?? false);
      }
    } catch {
      // Silently fail — MFA is optional
    } finally {
      setMfaLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (sessionReady) void loadMfaStatus();
  }, [sessionReady, loadMfaStatus]);

  async function handleEnroll() {
    setEnrolling(true);
    setMfaError("");
    setMfaMessage("");

    try {
      const res = await fetch("/api/dashboard/mfa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ action: "enroll" }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        setMfaError(json.message || "Failed to start enrollment.");
        setEnrolling(false);
        return;
      }

      setEnrollFactorId(json.factorId);
      setEnrollQrUri(json.qrUri);
      setEnrollSecret(json.secret);
    } catch {
      setMfaError("Failed to start enrollment.");
      setEnrolling(false);
    }
  }

  async function handleVerifyEnrollment() {
    setVerifying(true);
    setMfaError("");

    try {
      const res = await fetch("/api/dashboard/mfa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({
          action: "verify",
          factorId: enrollFactorId,
          code: verifyCode.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        setMfaError(json.message || "Verification failed.");
        setVerifyCode("");
        setVerifying(false);
        return;
      }

      setMfaMessage("Two-factor authentication enabled successfully.");
      setEnrolling(false);
      setEnrollFactorId("");
      setEnrollQrUri("");
      setEnrollSecret("");
      setVerifyCode("");
      setVerifying(false);
      void loadMfaStatus();
    } catch {
      setMfaError("Verification failed.");
      setVerifying(false);
    }
  }

  async function handleUnenroll(factorId: string) {
    if (!confirm("Are you sure you want to disable two-factor authentication?")) return;

    setUnenrolling(true);
    setMfaError("");
    setMfaMessage("");

    try {
      const res = await fetch("/api/dashboard/mfa", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ action: "unenroll", factorId }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        setMfaError(json.message || "Failed to disable 2FA.");
        setUnenrolling(false);
        return;
      }

      setMfaMessage("Two-factor authentication has been disabled.");
      setUnenrolling(false);
      void loadMfaStatus();
    } catch {
      setMfaError("Failed to disable 2FA.");
      setUnenrolling(false);
    }
  }

  if (mfaLoading) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ ...cardStyle, background: "#fefff8" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
          <div style={{ width: 54, height: 54, borderRadius: 16, background: "#ecfdf5", display: "grid", placeItems: "center" }}>
            <ShieldCheck size={24} color="#059669" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
              Account security
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginTop: 2 }}>
              Two-factor authentication
            </div>
          </div>
        </div>

        {mfaMessage ? (
          <div style={{ borderRadius: 16, border: "1px solid #86efac", background: "#f0fdf4", color: "#166534", padding: "12px 16px", marginBottom: 14, fontWeight: 700 }}>
            {mfaMessage}
          </div>
        ) : null}

        {mfaError ? (
          <div style={{ borderRadius: 16, border: "1px solid #fca5a5", background: "#fef2f2", color: "#991b1b", padding: "12px 16px", marginBottom: 14, fontWeight: 700 }}>
            {mfaError}
          </div>
        ) : null}

        {mfaEnabled && !enrolling ? (
          <>
            <div style={{ borderRadius: 16, border: "1px solid #d6dfef", background: "#fff", padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, color: "#0f172a" }}>Authenticator app</div>
                  <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
                    Two-factor authentication is <strong style={{ color: "#059669" }}>enabled</strong>
                  </div>
                </div>
                <button
                  onClick={() => {
                    const factor = factors.find((f) => f.status === "verified");
                    if (factor) handleUnenroll(factor.id);
                  }}
                  disabled={unenrolling}
                  style={{
                    border: "1px solid #fca5a5",
                    borderRadius: 14,
                    background: "#fff",
                    color: "#dc2626",
                    padding: "10px 16px",
                    fontWeight: 800,
                    cursor: unenrolling ? "not-allowed" : "pointer",
                    opacity: unenrolling ? 0.6 : 1,
                    fontSize: 13,
                  }}
                >
                  {unenrolling ? "Disabling..." : "Disable 2FA"}
                </button>
              </div>
            </div>
            <div style={{ color: "#64748b", lineHeight: 1.7, fontSize: 14 }}>
              Your account is protected with two-factor authentication. You will be asked for a verification code each time you sign in.
            </div>
          </>
        ) : enrolling && enrollQrUri ? (
          <>
            <div style={{ borderRadius: 16, border: "1px solid #d6dfef", background: "#fff", padding: "20px", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>
                Step 1: Scan QR code
              </div>
              <div style={{ fontSize: 14, color: "#64748b", marginBottom: 14 }}>
                Open your authenticator app (Google Authenticator, 1Password, Authy, etc.) and scan the QR code below.
              </div>
              <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
                {/* Render QR code as an img using a QR code API */}
                <img
                  loading="lazy"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(enrollQrUri)}`}
                  alt="Scan this QR code with your authenticator app"
                  width={200}
                  height={200}
                  style={{ borderRadius: 12 }}
                />
              </div>
              <div style={{ marginTop: 8, textAlign: "center" }}>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
                  Or enter this secret manually:
                </div>
                <code style={{
                  fontSize: 13,
                  fontWeight: 700,
                  background: "#f1f5f9",
                  padding: "6px 12px",
                  borderRadius: 8,
                  letterSpacing: "0.08em",
                  userSelect: "all",
                  wordBreak: "break-all",
                }}>
                  {enrollSecret}
                </code>
              </div>
            </div>

            <div style={{ borderRadius: 16, border: "1px solid #d6dfef", background: "#fff", padding: "20px", marginBottom: 14 }}>
              <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>
                Step 2: Enter verification code
              </div>
              <div style={{ fontSize: 14, color: "#64748b", marginBottom: 14 }}>
                Enter the 6-digit code shown in your authenticator app.
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={verifyCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setVerifyCode(val);
                  }}
                  placeholder="000000"
                  style={{
                    flex: 1,
                    borderRadius: 14,
                    border: "1px solid #d6dfef",
                    padding: "12px 16px",
                    fontSize: 18,
                    fontWeight: 700,
                    textAlign: "center",
                    letterSpacing: "0.3em",
                    outline: "none",
                  }}
                />
                <button
                  onClick={handleVerifyEnrollment}
                  disabled={verifying || verifyCode.length !== 6}
                  style={{
                    border: "1px solid #0f172a",
                    borderRadius: 14,
                    background: "#0f172a",
                    color: "#fff",
                    padding: "12px 20px",
                    fontWeight: 800,
                    cursor: verifying || verifyCode.length !== 6 ? "not-allowed" : "pointer",
                    opacity: verifying || verifyCode.length !== 6 ? 0.6 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {verifying ? "Verifying..." : "Verify & Enable"}
                </button>
              </div>
            </div>

            <button
              onClick={() => {
                setEnrolling(false);
                setEnrollFactorId("");
                setEnrollQrUri("");
                setEnrollSecret("");
                setVerifyCode("");
              }}
              style={{
                border: "none",
                background: "none",
                color: "#64748b",
                fontWeight: 700,
                cursor: "pointer",
                fontSize: 14,
                padding: "8px 0",
              }}
            >
              Cancel enrollment
            </button>
          </>
        ) : (
          <>
            <div style={{ borderRadius: 16, border: "1px solid #d6dfef", background: "#fff", padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, color: "#0f172a" }}>Authenticator app</div>
                  <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
                    Two-factor authentication is <strong style={{ color: "#b91c1c" }}>not enabled</strong>
                  </div>
                </div>
                <button
                  onClick={handleEnroll}
                  disabled={!sessionReady}
                  style={{
                    border: "1px solid #0f172a",
                    borderRadius: 14,
                    background: "#0f172a",
                    color: "#fff",
                    padding: "10px 16px",
                    fontWeight: 800,
                    cursor: sessionReady ? "pointer" : "not-allowed",
                    opacity: sessionReady ? 1 : 0.6,
                    fontSize: 13,
                  }}
                >
                  Enable 2FA
                </button>
              </div>
            </div>
            <div style={{ color: "#64748b", lineHeight: 1.7, fontSize: 14 }}>
              Add an extra layer of security to your account. When enabled, you will be required to enter a verification code from your authenticator app each time you sign in.
            </div>
          </>
        )}
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

/**
 * Numeric input with optional prefix (e.g. "$") or suffix (e.g. "%") and a
 * helper line below.  Used by the Combine orders & shipping settings card.
 */
function NumberField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  min,
  max,
  step,
  helper,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  helper?: string;
}) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ marginBottom: 6, fontSize: 13, fontWeight: 700, color: "#475569" }}>{label}</div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "#fff",
          border: "1px solid #d6dfef",
          borderRadius: 14,
          padding: "10px 12px",
          gap: 6,
        }}
      >
        {prefix ? (
          <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 14 }}>{prefix}</span>
        ) : null}
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const next = Number(e.target.value);
            onChange(Number.isFinite(next) ? next : 0);
          }}
          min={min}
          max={max}
          step={step ?? 1}
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 15,
            fontWeight: 700,
            color: "#0f172a",
            minWidth: 60,
          }}
        />
        {suffix ? (
          <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 14 }}>{suffix}</span>
        ) : null}
      </div>
      {helper ? (
        <div style={{ marginTop: 6, fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{helper}</div>
      ) : null}
    </label>
  );
}

/**
 * Plan-comparison card used in the Studio OS App rollout sidebar.  Shows
 * monthly + yearly pricing with the 10% annual savings, app access flag,
 * and key allowance.  When `highlight` is true the card carries the
 * "most popular" pill — set on the Studio plan by convention.
 */
function PlanCompareCard({
  name,
  monthly,
  yearly,
  yearlySavings,
  appAccess,
  keysIncluded,
  extras,
  highlight,
}: {
  name: string;
  monthly: number;
  yearly: number;
  yearlySavings: string;
  appAccess: boolean;
  keysIncluded: number;
  extras: string | null;
  highlight: boolean;
}) {
  return (
    <div
      style={{
        position: "relative",
        borderRadius: 14,
        border: highlight ? "2px solid #cc0000" : "1px solid #d6dfef",
        background: highlight ? "linear-gradient(180deg,#fff5f5 0%,#fff 60%)" : "#fff",
        padding: "16px 14px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: highlight ? "0 8px 18px rgba(204,0,0,0.08)" : "none",
      }}
    >
      {highlight ? (
        <span
          style={{
            position: "absolute",
            top: -10,
            right: 12,
            background: "#cc0000",
            color: "#fff",
            padding: "3px 10px",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Most popular
        </span>
      ) : null}
      <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{name}</div>
      <div>
        <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a", lineHeight: 1.1 }}>
          ${monthly}
          <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginLeft: 4 }}>/mo</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: "#15803d" }}>
          ${yearly}/yr · {yearlySavings}
        </div>
      </div>
      <div style={{ height: 1, background: "#e5e7eb", margin: "4px 0" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#334155" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: appAccess ? "#15803d" : "#94a3b8",
              minWidth: 14,
              display: "inline-block",
            }}
          >
            {appAccess ? "✓" : "✕"}
          </span>
          <span style={{ fontWeight: 700, color: appAccess ? "#0f172a" : "#94a3b8" }}>
            {appAccess ? "Studio OS App access" : "No app access"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 800,
              color: keysIncluded > 0 ? "#15803d" : "#94a3b8",
              minWidth: 14,
              display: "inline-block",
            }}
          >
            {keysIncluded > 0 ? "✓" : "—"}
          </span>
          <span style={{ fontWeight: 700, color: keysIncluded > 0 ? "#0f172a" : "#94a3b8" }}>
            {keysIncluded === 0
              ? "0 photography keys"
              : `${keysIncluded} photography key${keysIncluded === 1 ? "" : "s"}`}
          </span>
        </div>
        {extras ? (
          <div style={{ marginTop: 2, fontSize: 11, color: "#64748b", lineHeight: 1.4 }}>
            {extras}
          </div>
        ) : null}
      </div>
    </div>
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
