"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Download,
  Edit3,
  Image as ImageIcon,
  Mail,
  Search,
  ShoppingCart,
  Star,
  Users,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { proxiedPhotoUrl } from "@/lib/photo-url";
import { compareSchoolVisitorClasses, DEFAULT_SCHOOL_VISITOR_FILTERS, matchesSchoolVisitorFilters, type SchoolVisitorFilters } from "@/lib/school-visitor-filters";
import { SchoolVisitorReportControls } from "@/components/school-visitor-report-controls";
import { runVisitorEmailCampaign, visitorEmailProgress, type VisitorEmailBatchResult, type VisitorEmailOutcome } from "@/lib/school-visitor-email-client";

/* ── colours ─────────────────────────────────────────────────── */
const bg = "#f5f5f5";
const cardBg = "#fff";
const textPrimary = "#111";
const textMuted = "#666";
const borderColor = "#e5e5e5";
const accentColor = "#111";
const reportGridColumns =
  "44px minmax(210px,1.25fr) minmax(220px,1.25fr) minmax(170px,1fr) 90px 115px 110px 110px minmax(210px,1.35fr)";

/* ── types ───────────────────────────────────────────────────── */
type VisitorOrder = {
  id: string;
  status: string;
  totalCents: number;
  subtotalCents?: number | null;
  taxCents?: number | null;
  currency?: string | null;
  packageName?: string | null;
  customerName?: string | null;
  parentName?: string | null;
  items?: VisitorOrderItem[];
  createdAt: string;
  studentName: string;
  className: string;
};

type VisitorOrderItem = {
  id: string | null;
  productName: string;
  quantity: number;
  price: number | null;
  unitPriceCents: number | null;
  lineTotalCents: number | null;
  sku: string | null;
};

type VisitorDownload = {
  id: string;
  downloadType: string;
  downloadCount: number;
  mediaIds: string[];
  media?: DownloadMediaPreview[];
  createdAt: string;
};

type DownloadMediaPreview = {
  id: string;
  thumbnailUrl: string | null;
  filename: string | null;
};

type Visitor = {
  id: string;
  email: string;
  firstVisit: string;
  lastVisit: string;
  orders: VisitorOrder[];
  downloads: VisitorDownload[];
  favorites: VisitorFavorite[];
  orderCount: number;
  downloadCount: number;
  favoriteCount: number;
  registrationClasses: string[];
  classNames: string[];
  studentNames: string[];
  hasPaidOrder: boolean;
  hasDigitalPurchase: boolean;
  /** True when this entry is only a pre-release registrant (hasn't opened
   *  the gallery yet). Purchases are still matched by email. */
  preRelease: boolean;
  /** True when the visitor also registered during pre-release (they later
   *  opened the gallery). Used to show a small secondary badge. */
  alsoPreRelease?: boolean;
};

type VisitorFavorite = {
  id: string;
  mediaId: string;
  media?: DownloadMediaPreview;
  createdAt: string;
};

type EmailTemplate = { subject: string; headline: string; message: string };
type ComposerAudience = {
  recipients: string[]; fingerprint: string; visitorIds: string[]; filters: SchoolVisitorFilters; requestId: string;
};
type SavedVisitorCampaign = {
  audience: ComposerAudience; form: EmailTemplate; offset: number; outcomes: VisitorEmailOutcome[];
  retryAllowed?: boolean; retryWaitUntil?: number;
};
type DeadlineReminderSettings = {
  enabled: boolean; timeZone: string; sendHour: 9; classMode: "all" | "range"; classFrom: string; classTo: string;
};
type DeadlineReminderData = {
  settings: DeadlineReminderSettings; dueDate: string | null; plannedReminderDate: string | null; version: string | null;
  templateReady: boolean;
  photoClasses: string[] | null;
  eligibilityMessage?: string;
  status: { deadline: string; accepted: number; failed: number; pending: number; excluded: number;
    lastAttemptAt: string | null; completedAt: string | null; message: string } | null;
  statusMessage?: string;
};

/* ── helpers ─────────────────────────────────────────────────── */
function fmtDate(iso: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(iso: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtMoney(cents: number) {
  return "$" + (cents / 100).toFixed(2);
}

function csvEscape(value: string | number | null | undefined) {
  const raw = value == null ? "" : String(value);
  if (!/[",\n\r]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function shortOrderId(id: string) {
  return id ? id.slice(0, 8) : "";
}

function uniqueValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => (value ?? "").trim()).filter(Boolean)));
}

function visitorStudentNames(visitor: Visitor) {
  return uniqueValues([...visitor.studentNames, ...visitor.orders.map((order) => order.studentName)]).join(", ");
}

function visitorClassNames(visitor: Visitor) {
  return uniqueValues([...visitor.classNames, ...visitor.orders.map((order) => order.className)]).join(", ");
}

function visitorItemCount(visitor: Visitor) {
  return visitor.orders.reduce((orderSum, order) => {
    const items = order.items ?? [];
    if (!items.length) return orderSum + 1;
    return orderSum + items.reduce((itemSum, item) => itemSum + Math.max(1, Number(item.quantity) || 1), 0);
  }, 0);
}

function visitorOrderTotal(visitor: Visitor) {
  return visitor.orders.reduce((sum, order) => sum + (Number(order.totalCents) || 0), 0);
}

function visitorOrderLabels(visitor: Visitor) {
  return visitor.orders.map((order) => {
    const status = order.status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    return `Order #${shortOrderId(order.id)} (${status})`;
  });
}

function statusBadge(status: string) {
  const colors: Record<string, { bg: string; fg: string }> = {
    completed: { bg: "#dcfce7", fg: "#166534" },
    new: { bg: "#dbeafe", fg: "#1e40af" },
    sent_to_print: { bg: "#fef9c3", fg: "#854d0e" },
    shipped: { bg: "#e0e7ff", fg: "#3730a3" },
    delivered: { bg: "#d1fae5", fg: "#065f46" },
    cancelled: { bg: "#fee2e2", fg: "#991b1b" },
  };
  const c = colors[status] ?? { bg: "#f3f4f6", fg: "#374151" };
  const label = status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        background: c.bg,
        color: c.fg,
      }}
    >
      {label}
    </span>
  );
}

function DownloadPreviewGrid({
  download,
  maxItems = 10,
}: {
  download: VisitorDownload;
  maxItems?: number;
}) {
  const media =
    download.media?.length
      ? download.media
      : download.mediaIds.map((id) => ({
          id,
          thumbnailUrl: null,
          filename: id,
        }));

  if (!media.length) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))",
        gap: 6,
        marginTop: 10,
      }}
    >
      {media.slice(0, maxItems).map((item, index) => (
        <div
          key={`${item.id}-${index}`}
          title={item.filename ?? item.id}
          style={{
            position: "relative",
            aspectRatio: "1 / 1",
            borderRadius: 6,
            overflow: "hidden",
            border: `1px solid ${borderColor}`,
            background: "#eef0f3",
          }}
        >
          <ImageIcon
            size={18}
            style={{
              position: "absolute",
              inset: 0,
              margin: "auto",
              color: "#9ca3af",
            }}
          />
          {item.thumbnailUrl && (
            <div
              aria-label={item.filename ?? "Downloaded photo preview"}
              role="img"
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `url(${JSON.stringify(item.thumbnailUrl)})`,
                backgroundPosition: "center",
                backgroundSize: "cover",
              }}
            />
          )}
        </div>
      ))}
      {media.length > maxItems && (
        <div
          style={{
            aspectRatio: "1 / 1",
            borderRadius: 6,
            border: `1px solid ${borderColor}`,
            background: "#f3f4f6",
            color: textMuted,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          +{media.length - maxItems}
        </div>
      )}
    </div>
  );
}

function imageUrlFromSku(value: string | null | undefined) {
  return proxiedPhotoUrl(value) || null;
}

function FavoritePreviewGrid({
  favorites,
  maxItems = 12,
}: {
  favorites: VisitorFavorite[];
  maxItems?: number;
}) {
  if (!favorites.length) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 8 }}>
      {favorites.slice(0, maxItems).map((favorite, index) => {
        const media = favorite.media;
        return (
          <div
            key={`${favorite.id}-${index}`}
            title={media?.filename ?? favorite.mediaId}
            style={{
              position: "relative",
              aspectRatio: "1 / 1",
              borderRadius: 8,
              overflow: "hidden",
              border: `1px solid ${borderColor}`,
              background: "#f3f4f6",
            }}
          >
            <ImageIcon size={18} style={{ position: "absolute", inset: 0, margin: "auto", color: "#9ca3af" }} />
            {media?.thumbnailUrl && (
              <div
                aria-label={media.filename ?? "Favorite photo preview"}
                role="img"
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundImage: `url(${JSON.stringify(media.thumbnailUrl)})`,
                  backgroundPosition: "center",
                  backgroundSize: "cover",
                }}
              />
            )}
          </div>
        );
      })}
      {favorites.length > maxItems && (
        <div style={{ aspectRatio: "1 / 1", borderRadius: 8, border: `1px solid ${borderColor}`, background: "#f9fafb", color: textMuted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800 }}>
          +{favorites.length - maxItems}
        </div>
      )}
    </div>
  );
}

function OrderItemsList({ order }: { order: VisitorOrder }) {
  const items = order.items ?? [];
  if (!items.length) return null;

  return (
    <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
      {items.slice(0, 8).map((item, index) => {
        const imageUrl = imageUrlFromSku(item.sku);
        return (
          <div key={`${order.id}-${item.id ?? index}`} style={{ display: "grid", gridTemplateColumns: "42px 1fr auto", gap: 10, alignItems: "center", padding: 8, background: "#fff", border: `1px solid ${borderColor}`, borderRadius: 8 }}>
            <div style={{ position: "relative", width: 42, height: 42, borderRadius: 6, overflow: "hidden", background: "#eef0f3", border: `1px solid ${borderColor}` }}>
              <ImageIcon size={16} style={{ position: "absolute", inset: 0, margin: "auto", color: "#9ca3af" }} />
              {imageUrl && (
                <div
                  role="img"
                  aria-label={item.productName}
                  style={{
                    position: "absolute",
                    inset: 0,
                    backgroundImage: `url(${JSON.stringify(imageUrl)})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.productName}</div>
              {item.sku ? <div style={{ fontSize: 10, color: textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.sku.split("/").pop()}</div> : null}
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: textMuted }}>Qty {item.quantity || 1}</div>
          </div>
        );
      })}
      {items.length > 8 ? <div style={{ fontSize: 11, color: textMuted }}>+{items.length - 8} more item{items.length - 8 === 1 ? "" : "s"}</div> : null}
    </div>
  );
}

/* ── page ────────────────────────────────────────────────────── */
export default function SchoolVisitorsPage() {
  const supabase = useMemo(() => createClient(), []);
  const params = useParams();
  const schoolId = String(params.schoolId ?? "");

  const [loading, setLoading] = useState(true);
  const [schoolName, setSchoolName] = useState("");
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [filters, setFilters] = useState<SchoolVisitorFilters>(DEFAULT_SCHOOL_VISITOR_FILTERS);
  const search = filters.search;
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedVisitor, setSelectedVisitor] = useState<Visitor | null>(null);
  const [editingEmail, setEditingEmail] = useState<{ id: string; email: string } | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);
  const [deadlineReminder, setDeadlineReminder] = useState<DeadlineReminderData | null>(null);
  const [savingReminder, setSavingReminder] = useState(false);
  const [reminderError, setReminderError] = useState("");

  // Email composer
  const [showComposer, setShowComposer] = useState(false);
  const [emailForm, setEmailForm] = useState({
    subject: "",
    headline: "",
    message: "",
  });
  const [sendingEmail, setSendingEmail] = useState(false);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [composerAudience, setComposerAudience] = useState<ComposerAudience | null>(null);
  const [emailResult, setEmailResult] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [emailProgress, setEmailProgress] = useState<{ sent: number; failed: number; pending: number; total: number } | null>(null);
  const [campaignStarted, setCampaignStarted] = useState(false);
  const [emailAudienceStale, setEmailAudienceStale] = useState(false);
  const [retryAllowed, setRetryAllowed] = useState(true);
  const [retryWaitUntil, setRetryWaitUntil] = useState(0);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [pendingCampaign, setPendingCampaign] = useState<SavedVisitorCampaign | null>(null);
  const [templateStatus, setTemplateStatus] = useState("");
  const [templateError, setTemplateError] = useState("");
  const templateContext = useRef<{ schoolId: string; ready: boolean; version: string | null }>({ schoolId: "", ready: false, version: null });
  const emailFormRef = useRef<EmailTemplate>(emailForm);
  const templateDirty = useRef(false);
  const templateConflictVersion = useRef<string | null | undefined>(undefined);
  const templateSaving = useRef(false);
  const templateSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendOffset = useRef(0);
  const outcomes = useRef(new Map<string, VisitorEmailOutcome>());
  const campaignStorageKey = useRef("");
  const composerLoadId = useRef(0);
  const campaignRetry = useRef({ allowed: true, after: 0 });

  // Photographer branding for preview
  const [branding, setBranding] = useState<{
    businessName: string;
    logoUrl: string;
    studioPhone: string;
    studioEmail: string;
    studioAddress: string;
  }>({ businessName: "", logoUrl: "", studioPhone: "", studioEmail: "", studioAddress: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Please sign in again to load visitors.");
      }
      campaignStorageKey.current = `studio-os-visitor-email:${session.user.id}:${schoolId}`;
      try {
        const saved = JSON.parse(localStorage.getItem(campaignStorageKey.current) || "null") as SavedVisitorCampaign | null;
        if (saved && typeof saved.audience?.requestId === "string" && Array.isArray(saved.audience.recipients) &&
          Array.isArray(saved.audience.visitorIds) && saved.audience.filters &&
          typeof saved.form?.subject === "string" && typeof saved.form?.headline === "string" &&
          typeof saved.form?.message === "string" && Number.isInteger(saved.offset) && saved.offset >= 0 && Array.isArray(saved.outcomes)) {
          setPendingCampaign(saved);
        }
      } catch { /* A browser may disable local storage; the open composer still retains its progress. */ }

      // Fetch branding
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: pg } = await supabase
          .from("photographers")
          .select("business_name, studio_email, billing_email, logo_url, studio_phone, studio_address")
          .eq("user_id", user.id)
          .maybeSingle();
        if (pg) {
          const p = pg as Record<string, unknown>;
          setBranding({
            businessName: (p.business_name as string) || "",
            logoUrl: proxiedPhotoUrl(p.logo_url as string),
            studioPhone: (p.studio_phone as string) || "",
            studioEmail: (p.studio_email as string) || (p.billing_email as string) || "",
            studioAddress: (p.studio_address as string) || "",
          });
        }
      }

      const res = await fetch(`/api/dashboard/schools/${schoolId}/visitors`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error("Could not load the complete visitor report. Please retry.");
      const data = await res.json();
      setSchoolName(data.schoolName || "");
      setVisitors(data.visitors || []);
      setSelected(new Set());
      setLoading(false);
      try {
        const reminderResponse = await fetch(`/api/dashboard/schools/${schoolId}/visitors/reminder`, {
          headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
        });
        const reminder = await reminderResponse.json();
        if (reminderResponse.ok && reminder.ok) { setDeadlineReminder(reminder); setReminderError(""); }
        else setReminderError(reminder.message || "Could not load automatic reminder settings.");
      } catch { setReminderError("Could not load automatic reminder settings. Reload this page to retry."); }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load visitors.");
      setVisitors([]);
    } finally { setLoading(false); }
  }, [supabase, schoolId]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  useEffect(() => {
    const update = () => setRetrySeconds(Math.max(0, Math.ceil((retryWaitUntil - Date.now()) / 1000)));
    const timer = window.setInterval(update, 1000);
    const initial = window.setTimeout(update, 0);
    return () => { window.clearInterval(timer); window.clearTimeout(initial); };
  }, [retryWaitUntil]);

  /* ── search / filter ──────────────────── */
  const filtered = useMemo(() => visitors.filter(visitor => matchesSchoolVisitorFilters(visitor, filters)), [visitors, filters]);
  const classNames = useMemo(() => uniqueValues(visitors.flatMap(visitor => visitor.classNames))
    .sort(compareSchoolVisitorClasses), [visitors]);
  const counts = useMemo(() => {
    const base = visitors.filter(visitor => matchesSchoolVisitorFilters(visitor, { ...filters, orders: "all" }));
    return { all: base.length, ordered: base.filter(visitor => visitor.orderCount > 0).length,
      no_orders: base.filter(visitor => !visitor.orderCount).length, paid: base.filter(visitor => visitor.hasPaidOrder).length,
      digitals: base.filter(visitor => visitor.hasDigitalPurchase).length };
  }, [visitors, filters]);
  function updateFilters(next: SchoolVisitorFilters) {
    setFilters(next);
    setSelected(new Set());
  }

  async function saveDeadlineReminder(enabled: boolean, scope?: Pick<DeadlineReminderSettings, "classMode" | "classFrom" | "classTo">) {
    if (savingReminder) return;
    setSavingReminder(true);
    setReminderError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { Authorization: `Bearer ${session?.access_token ?? ""}` };
      const currentResponse = await fetch(`/api/dashboard/schools/${schoolId}/visitors/reminder`, { headers, cache: "no-store" });
      const current = await currentResponse.json();
      if (!currentResponse.ok || !current.ok) throw new Error(current.message || "Could not load current reminder settings.");
      const response = await fetch(`/api/dashboard/schools/${schoolId}/visitors/reminder`, {
        method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ...current.settings, ...scope, enabled, expectedVersion: current.version }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "Could not save the automatic reminder.");
      setDeadlineReminder(data);
      // The reminder changes only its own settings; allow the open template
      // draft to keep saving against the resulting version when it was current.
      if (templateContext.current.ready && templateContext.current.version === current.version) templateContext.current.version = data.version;
    } catch (error) { setReminderError(error instanceof Error ? error.message : "Could not save the automatic reminder."); }
    finally { setSavingReminder(false); }
  }

  /* ── batch selection ──────────────────── */
  const allSelected = filtered.length > 0 && filtered.every((v) => selected.has(v.id));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((v) => v.id)));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* ── email editing ────────────────────── */
  async function saveEmailEdit() {
    if (!editingEmail) return;
    setSavingEmail(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await fetch(`/api/dashboard/schools/${schoolId}/visitors`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ visitorId: editingEmail.id, newEmail: editingEmail.email }),
    });
    setEditingEmail(null);
    setSavingEmail(false);
    await load();
  }

  /* ── mass email ───────────────────────── */
  async function loadEmailTemplate(accessToken: string) {
    const response = await fetch(`/api/dashboard/schools/${schoolId}/visitors/template`, {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || "Could not load your saved template.");
    templateContext.current = { schoolId, ready: true, version: data.version };
    const form = data.template ?? { subject: `Update from ${branding.businessName || "Your Photographer"}`,
      headline: "A message from your photographer", message: "" };
    if (!templateDirty.current) {
      emailFormRef.current = form;
      setEmailForm(form);
    }
    setTemplateStatus(templateDirty.current ? "Unsaved changes" : data.template ? "Template saved for this school" : "Your message will save automatically for this school");
    setTemplateError("");
  }

  async function saveEmailTemplate(overwriteConflict = false) {
    if (templateSaving.current || !templateDirty.current) return;
    if (templateConflictVersion.current !== undefined) {
      if (!overwriteConflict) return;
      templateContext.current.version = templateConflictVersion.current;
      templateConflictVersion.current = undefined;
    }
    if (!templateContext.current.ready || templateContext.current.schoolId !== schoolId) {
      setTemplateError("Your saved template could not be loaded. Reopen the composer before saving.");
      return;
    }
    templateSaving.current = true;
    setTemplateStatus("Saving template…");
    setTemplateError("");
    const snapshot = { ...emailFormRef.current };
    let saved = false;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/dashboard/schools/${schoolId}/visitors/template`, {
        method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ template: snapshot, expectedVersion: templateContext.current.version }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (response.status === 409 && "version" in data) {
          templateConflictVersion.current = data.version;
          throw new Error("The saved template changed in another window. Your text is still here. Use Save template to keep this draft instead.");
        }
        throw new Error(data.message || "Template could not be saved. Your message is still here; use Save template to retry.");
      }
      templateContext.current.version = data.version;
      setDeadlineReminder(previous => previous ? { ...previous, templateReady: !!snapshot.subject.trim() && !!snapshot.headline.trim() && !!snapshot.message.trim(),
        statusMessage: previous.settings.enabled && (!snapshot.subject.trim() || !snapshot.headline.trim() || !snapshot.message.trim())
          ? "Automatic reminders are waiting for a saved email subject, headline and message."
          : previous.statusMessage?.startsWith("Automatic reminders are waiting") ? undefined : previous.statusMessage } : previous);
      templateDirty.current = JSON.stringify(snapshot) !== JSON.stringify(emailFormRef.current);
      setTemplateStatus(templateDirty.current ? "Unsaved changes" : "Template saved for this school");
      saved = true;
    } catch (error) {
      setTemplateStatus("Template not saved yet");
      setTemplateError(error instanceof Error ? error.message : "Template could not be saved.");
    } finally {
      templateSaving.current = false;
      if (saved && templateDirty.current) templateSaveTimer.current = setTimeout(() => void saveEmailTemplate(), 700);
    }
  }

  function updateEmailForm(field: keyof EmailTemplate, value: string) {
    const form = { ...emailFormRef.current, [field]: value };
    emailFormRef.current = form;
    setEmailForm(form);
    templateDirty.current = true;
    setTemplateStatus("Unsaved changes");
    setTemplateError("");
    if (templateSaveTimer.current) clearTimeout(templateSaveTimer.current);
    templateSaveTimer.current = setTimeout(() => void saveEmailTemplate(), 700);
  }

  async function startComposer(visitorIds: string[]) {
    if (!visitorIds.length) return;
    if (pendingCampaign) { resumeEmailCampaign(pendingCampaign); return; }
    const loadId = ++composerLoadId.current;
    setEmailResult(null);
    setEmailProgress(null);
    setCampaignStarted(false);
    setEmailAudienceStale(false);
    setRetryAllowed(true);
    setRetryWaitUntil(0);
    campaignRetry.current = { allowed: true, after: 0 };
    sendOffset.current = 0;
    outcomes.current.clear();
    setEmailError("");
    setComposerAudience(null);
    setAudienceLoading(true);
    setShowComposer(true);
    const reviewedFilters = { ...filters };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!templateContext.current.ready || templateContext.current.schoolId !== schoolId) {
        await loadEmailTemplate(session?.access_token ?? "").catch(error => {
          setTemplateError(error instanceof Error ? error.message : "Could not load your saved template.");
          if (!templateDirty.current) {
            const form = { subject: `Update from ${branding.businessName || "Your Photographer"}`,
              headline: "A message from your photographer", message: "" };
            emailFormRef.current = form;
            setEmailForm(form);
          }
        });
      }
      const response = await fetch("/api/dashboard/visitors/email", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: JSON.stringify({ action: "preview", subject: "Audience review", headline: "Audience review",
          schoolAudience: { schoolId, visitorIds, filters: reviewedFilters } }),
      });
      const data = await response.json();
      if (loadId !== composerLoadId.current) return;
      if (!response.ok || !data.ok) throw new Error(data.message || "Could not review recipients. Refresh the report.");
      setComposerAudience({ ...data.audience, visitorIds, filters: reviewedFilters, requestId: crypto.randomUUID() });
    } catch (error) { if (loadId === composerLoadId.current) setEmailError(error instanceof Error ? error.message : "Could not review recipients."); }
    finally { if (loadId === composerLoadId.current) setAudienceLoading(false); }
  }
  function openComposer() { void startComposer(filtered.filter(visitor => selected.has(visitor.id)).map(visitor => visitor.id)); }
  function openComposerForVisitor(visitor: Visitor) {
    setSelected(new Set([visitor.id]));
    void startComposer([visitor.id]);
  }

  function rememberEmailCampaign(audience: ComposerAudience, form: EmailTemplate) {
    const saved = { audience, form, offset: sendOffset.current, outcomes: [...outcomes.current.values()],
      retryAllowed: campaignRetry.current.allowed, retryWaitUntil: campaignRetry.current.after };
    setPendingCampaign(saved);
    try { localStorage.setItem(campaignStorageKey.current, JSON.stringify(saved)); }
    catch { setEmailError("Keep this tab open while sending: this browser could not save progress for a reload."); }
  }

  function resumeEmailCampaign(saved: SavedVisitorCampaign) {
    setComposerAudience(saved.audience);
    emailFormRef.current = saved.form;
    setEmailForm(saved.form);
    sendOffset.current = saved.offset;
    outcomes.current = new Map(saved.outcomes.map(outcome => [outcome.recipientEmail, outcome]));
    setEmailProgress(visitorEmailProgress(outcomes.current.values(), saved.audience.recipients.length));
    setCampaignStarted(true);
    setEmailAudienceStale(false);
    campaignRetry.current = { allowed: saved.retryAllowed !== false, after: saved.retryWaitUntil ?? 0 };
    setRetryAllowed(campaignRetry.current.allowed);
    setRetryWaitUntil(campaignRetry.current.after);
    setEmailResult(null);
    setEmailError("");
    setAudienceLoading(false);
    setShowComposer(true);
  }

  async function reviewRemainingContacts() {
    if (!composerAudience || sendingEmail || audienceLoading) return;
    setAudienceLoading(true);
    setEmailError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { Authorization: `Bearer ${session?.access_token ?? ""}` };
      const statusResponse = await fetch("/api/dashboard/visitors/email", {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", schoolAudience: { schoolId, ...composerAudience },
          subject: "Progress review", headline: "Progress review" }),
      });
      const status = await statusResponse.json();
      if (!statusResponse.ok || !status.ok) throw new Error(status.message || "Could not confirm earlier email results. Retry the review.");
      const originalEmails = new Set(composerAudience.recipients);
      if (!Array.isArray(status.outcomes) || typeof status.canReviewRemaining !== "boolean" ||
        !status.outcomes.every((outcome: VisitorEmailOutcome) => outcome && originalEmails.has(outcome.recipientEmail) &&
          ["sent", "failed"].includes(outcome.status) && (outcome.status !== "sent" || !!outcome.providerId))) {
        throw new Error("Earlier email results could not be verified. Check this batch before reviewing new recipients.");
      }
      outcomes.current = new Map((status.outcomes as VisitorEmailOutcome[]).map(outcome => [outcome.recipientEmail, outcome]));
      setEmailProgress(visitorEmailProgress(outcomes.current.values(), composerAudience.recipients.length));
      rememberEmailCampaign(composerAudience, emailFormRef.current);
      if (!status.canReviewRemaining) {
        setRetryAllowed(false);
        throw new Error("An earlier email request has an unconfirmed outcome. Check its provider records before reviewing a new batch.");
      }
      const reportResponse = await fetch(`/api/dashboard/schools/${schoolId}/visitors`, { headers, cache: "no-store" });
      const report = await reportResponse.json();
      if (!reportResponse.ok) throw new Error("Could not refresh current orders. Retry the review.");
      const freshVisitors = report.visitors as Visitor[];
      const acceptedEmails = new Set([...outcomes.current.values()].filter(outcome => outcome.status === "sent").map(outcome => outcome.recipientEmail));
      const remaining = freshVisitors.filter(visitor => originalEmails.has(visitor.email) && !acceptedEmails.has(visitor.email) &&
        matchesSchoolVisitorFilters(visitor, composerAudience.filters));
      if (!remaining.length) {
        setRetryAllowed(false);
        throw new Error("No remaining contacts match the original filters. Already accepted emails are excluded; you can end this batch.");
      }
      const visitorIds = remaining.map(visitor => visitor.id);
      const response = await fetch("/api/dashboard/visitors/email", {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", subject: "Audience review", headline: "Audience review",
          schoolAudience: { schoolId, visitorIds, filters: composerAudience.filters } }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "Could not review remaining contacts.");
      const audience = { ...data.audience, visitorIds, filters: composerAudience.filters, requestId: crypto.randomUUID() };
      setVisitors(freshVisitors);
      setFilters(composerAudience.filters);
      setSelected(new Set(visitorIds));
      outcomes.current.clear();
      sendOffset.current = 0;
      campaignRetry.current = { allowed: true, after: 0 };
      setRetryAllowed(true);
      setRetryWaitUntil(0);
      setComposerAudience(audience);
      setEmailAudienceStale(false);
      setEmailProgress(visitorEmailProgress([], audience.recipients.length));
      rememberEmailCampaign(audience, emailFormRef.current);
    } catch (error) { setEmailError(error instanceof Error ? error.message : "Could not review remaining contacts."); }
    finally { setAudienceLoading(false); }
  }

  function downloadCsv() {
    const header = [
      "Gallery Name",
      "Visitor",
      "Students",
      "Classes",
      "Registered Classes",
      "Last Activity",
      "Favorites",
      "Gallery Downloads",
      "Paid Order",
      "Purchased Digitals",
      "Order Items",
      "Orders",
      "Order Total",
    ];
    const rows = filtered.map((visitor) => [
      schoolName || "School Gallery",
      visitor.email,
      visitorStudentNames(visitor),
      visitorClassNames(visitor),
      visitor.registrationClasses.join(", "),
      visitor.preRelease ? `Registered ${fmtDate(visitor.firstVisit)}` : fmtDateTime(visitor.lastVisit),
      visitor.favoriteCount || 0,
      visitor.downloadCount || 0,
      visitor.hasPaidOrder ? "Yes" : "No",
      visitor.hasDigitalPurchase ? "Yes" : "No",
      visitorItemCount(visitor) || 0,
      visitorOrderLabels(visitor).join("; "),
      visitorOrderTotal(visitor) > 0 ? fmtMoney(visitorOrderTotal(visitor)) : "",
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const slug = (schoolName || "school-gallery").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    link.href = url;
    link.download = `${slug || "school-gallery"}-visitors.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function sendMassEmail() {
    if (!composerAudience || sendingEmail || !retryAllowed || Date.now() < retryWaitUntil) return;
    setSendingEmail(true);
    setCampaignStarted(true);
    setEmailError("");
    const campaignForm = { ...emailFormRef.current };
    rememberEmailCampaign(composerAudience, campaignForm);
    try {
      const final = await runVisitorEmailCampaign({
        offset: sendOffset.current,
        recipients: composerAudience.recipients,
        requestBatch: async offset => {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch("/api/dashboard/visitors/email", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
            body: JSON.stringify({ action: "send", offset, schoolAudience: { schoolId, ...composerAudience }, ...campaignForm }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            if (res.status === 409) setEmailAudienceStale(true);
            throw new Error(data.message || "Sending paused. Retry the remaining contacts with this same batch.");
          }
          return data as VisitorEmailBatchResult;
        },
        onBatch: data => {
          for (const outcome of data.outcomes) outcomes.current.set(outcome.recipientEmail, outcome);
          if (data.nextOffset !== null) sendOffset.current = data.nextOffset;
          campaignRetry.current = { allowed: data.retryAllowed !== false, after: data.paused ? Date.now() + Math.max(0, data.retryAfterMs ?? 0) : 0 };
          setEmailProgress(visitorEmailProgress(outcomes.current.values(), data.total));
          rememberEmailCampaign(composerAudience, campaignForm);
        },
      });
      if (final.paused) {
        setRetryAllowed(final.retryAllowed !== false);
        setRetryWaitUntil(Date.now() + Math.max(0, final.retryAfterMs ?? 0));
        setEmailError(final.message || "Sending paused by the email service. Retry the remaining contacts; accepted emails will not be resent.");
      } else {
        const progress = visitorEmailProgress(outcomes.current.values(), final.total);
        setEmailResult(progress);
        setPendingCampaign(null);
        try { localStorage.removeItem(campaignStorageKey.current); } catch { /* Completed campaign is still shown in this tab. */ }
      }
    } catch (error) { setEmailError(error instanceof Error ? error.message : "Failed to send emails."); }
    finally { setSendingEmail(false); }
  }

  /* ── render ───────────────────────────── */
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: bg }}>
        <div style={{ fontSize: 14, color: textMuted }}>Loading visitors…</div>
      </div>
    );
  }

  if (loadError) return <div style={{ padding: 40, color: textPrimary }} role="alert">
    <p>{loadError}</p><button type="button" onClick={() => void load()}>Retry loading visitors</button>
  </div>;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: bg }}>
      {/* ── Main content ──────────────────── */}
      <div style={{ flex: 1, padding: "0 0 32px", maxWidth: selectedVisitor ? "calc(100% - 440px)" : "100%", overflowX: "hidden" }}>
        {/* Header */}
        <div style={{ background: cardBg, borderBottom: `1px solid ${borderColor}`, padding: "24px 40px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <Link
                href={`/dashboard/projects/schools/${schoolId}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, color: textMuted, fontSize: 13, textDecoration: "none", marginBottom: 14 }}
              >
                <ArrowLeft size={16} /> Back to {schoolName || "School"}
              </Link>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: textPrimary, margin: 0 }}>
                <Users size={22} style={{ marginRight: 8, verticalAlign: "middle" }} />
                Gallery Visitors
              </h1>
              <div style={{ fontSize: 13, color: textMuted, marginTop: 4 }}>
                {schoolName} &middot; {(() => {
                  const real = visitors.filter((v) => !v.preRelease && !v.id.startsWith("order_")).length;
                  const pre = visitors.filter((v) => v.preRelease || v.alsoPreRelease).length;
                  const parts = [`${real} visitor${real !== 1 ? "s" : ""}`];
                  if (pre > 0) parts.push(`${pre} registered for updates`);
                  return parts.join(" · ");
                })()}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={downloadCsv}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 16px",
                  background: "#fff",
                  color: textPrimary,
                  border: `1px solid ${borderColor}`,
                  borderRadius: 8,
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                <Download size={16} /> Download CSV
              </button>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={openComposer}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 18px",
                    background: accentColor,
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <Mail size={16} /> {pendingCampaign ? "Resume unfinished email batch" : `Email ${selected.size} Visitor${selected.size !== 1 ? "s" : ""}`}
                </button>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: "24px 40px 0" }}>
          <div style={{ marginBottom: 18, padding: "16px 18px", background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 8, color: textPrimary }}>
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14, fontWeight: 800 }}>
              <input type="checkbox" role="switch" aria-label="Automatic deadline reminder" checked={deadlineReminder?.settings.enabled ?? false}
                disabled={savingReminder || !deadlineReminder} onChange={event => void saveDeadlineReminder(event.target.checked)} />
              Automatic deadline reminder {deadlineReminder ? deadlineReminder.settings.enabled ? "ON" : "OFF" : reminderError ? "Status unavailable" : "Loading…"}
            </label>
            <div style={{ marginTop: 8, color: textMuted, fontSize: 12, lineHeight: 1.6 }}>
              Uses your saved message for parents who have not placed an order, only in classes with photos available in the gallery. {deadlineReminder && (deadlineReminder.settings.classMode === "range"
                ? `Class range: ${deadlineReminder.settings.classFrom} through ${deadlineReminder.settings.classTo}.`
                : "All photographed classes in this school.")}
              {deadlineReminder && (deadlineReminder.plannedReminderDate ? ` ${deadlineReminder.settings.enabled && deadlineReminder.templateReady ? "Scheduled" : "Reminder date:"} ${deadlineReminder.plannedReminderDate} at 9:00 a.m. (${deadlineReminder.settings.timeZone}), the day before the deadline.`
                : " Set an ordering deadline and save your message before turning this on.")}
              {" "}The photographer receives an email report with accepted, failed and excluded counts.
            </div>
            {deadlineReminder?.photoClasses && <div style={{ marginTop: 8, fontSize: 12, color: textMuted, maxHeight: 90, overflowY: "auto" }}>
              {deadlineReminder.photoClasses.length ? `Classes with gallery photos: ${deadlineReminder.photoClasses.join(", ")}` : "No classes have gallery photos available yet. Photo availability is checked again before an automatic send."}
            </div>}
            {deadlineReminder?.eligibilityMessage && <div role="status" style={{ marginTop: 8, color: "#9f1239", fontSize: 12 }}>{deadlineReminder.eligibilityMessage}</div>}
            {deadlineReminder?.status && <div role="status" style={{ marginTop: 10, color: textPrimary, fontSize: 13 }}>
              {deadlineReminder.status.message} · {deadlineReminder.status.accepted} accepted · {deadlineReminder.status.failed} failed · {deadlineReminder.status.pending} pending · {deadlineReminder.status.excluded} excluded
              {deadlineReminder.status.lastAttemptAt && <span style={{ color: textMuted }}> · Last run {fmtDateTime(deadlineReminder.status.lastAttemptAt)}</span>}
            </div>}
            {deadlineReminder && !deadlineReminder.status && <div style={{ marginTop: 8, color: textMuted, fontSize: 12 }}>{deadlineReminder.statusMessage || "No reminder has been sent for this deadline yet."}</div>}
            {deadlineReminder && filters.classMode === "range" && filters.classFrom && filters.classTo && <button type="button"
              disabled={savingReminder} onClick={() => void saveDeadlineReminder(deadlineReminder.settings.enabled, { classMode: "range", classFrom: filters.classFrom ?? "", classTo: filters.classTo ?? "" })}
              style={{ marginTop: 10, padding: "7px 10px", fontSize: 12, cursor: "pointer" }}>Use this class range for automatic reminders</button>}
            {deadlineReminder?.settings.classMode === "range" && <button type="button" disabled={savingReminder}
              onClick={() => void saveDeadlineReminder(deadlineReminder.settings.enabled, { classMode: "all", classFrom: "", classTo: "" })}
              style={{ marginTop: 10, marginLeft: 8, padding: "7px 10px", fontSize: 12, cursor: "pointer" }}>Use all photographed classes for automatic reminders</button>}
            {reminderError && <div role="alert" style={{ marginTop: 10, color: "#9f1239", fontSize: 12 }}>{reminderError}</div>}
          </div>
          {pendingCampaign && <div style={{ marginBottom: 18, padding: 14, background: "#fff", border: `1px solid ${borderColor}`, borderRadius: 8, color: textPrimary, fontSize: 13 }}>
            You have an unfinished email batch. Its message and progress are saved in this browser. {" "}
            <button type="button" onClick={() => resumeEmailCampaign(pendingCampaign)} style={{ padding: "7px 12px", cursor: "pointer" }}>Resume email batch</button>
          </div>}
          <SchoolVisitorReportControls filters={filters} onChange={updateFilters} classNames={classNames} counts={counts} />
          {/* Search bar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
            <div style={{ position: "relative", width: "min(100%, 520px)" }}>
              <Search size={16} style={{ position: "absolute", left: 12, top: 12, color: textMuted }} />
              <input
                type="text"
                placeholder="Search & filter by email, student, class, or order ID..."
                maxLength={500}
                value={search}
                onChange={(e) => updateFilters({ ...filters, search: e.target.value })}
                style={{
                  width: "100%",
                  padding: "11px 12px 11px 36px",
                  border: `1px solid ${borderColor}`,
                  borderRadius: 6,
                  fontSize: 13,
                  color: textPrimary,
                  background: cardBg,
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: textMuted }}>
              <button type="button" onClick={toggleAll} disabled={!filtered.length} style={{ padding: "7px 10px", marginRight: 12, border: `1px solid ${borderColor}`, background: "#fff", color: textPrimary, borderRadius: 6, cursor: "pointer" }}>
                {allSelected ? "Clear selection" : "Select filtered contacts"}
              </button>
              Showing {filtered.length} of {visitors.length} visitor{visitors.length !== 1 ? "s" : ""}
            </div>
          </div>

          {/* Table */}
          <div style={{ background: cardBg, border: `1px solid ${borderColor}`, overflow: "auto" }}>
            <div style={{ minWidth: 1400 }}>
              {/* Table header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: reportGridColumns,
                  columnGap: 12,
                  padding: "12px 18px",
                  background: "#fafafa",
                  borderBottom: `1px solid ${borderColor}`,
                  fontSize: 11,
                  fontWeight: 800,
                  color: "#6b7280",
                }}
              >
                <div>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    style={{ width: 16, height: 16, cursor: "pointer" }}
                  />
                </div>
                <div>Gallery Name</div>
                <div>Visitor</div>
                <div>Last Activity</div>
                <div>Favorites</div>
                <div>Downloads</div>
                <div>Paid Digitals</div>
                <div>Order Items</div>
                <div>Orders</div>
              </div>

              {/* Rows */}
              {filtered.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: textMuted, fontSize: 14 }}>
                  {visitors.length ? "No contacts match these filters." : "No visitors yet."}
                </div>
              ) : (
                filtered.map((v, index) => {
                  const students = visitorStudentNames(v);
                  const classes = visitorClassNames(v);
                  const itemCount = visitorItemCount(v);
                  const orderLabels = visitorOrderLabels(v);
                  return (
                    <div
                      key={v.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: reportGridColumns,
                  columnGap: 12,
                        padding: "12px 18px",
                        borderBottom: `1px solid ${borderColor}`,
                        alignItems: "center",
                        background: selectedVisitor?.id === v.id ? "#f1f5f9" : index % 2 === 0 ? "#fff" : "#f8fafc",
                        cursor: "pointer",
                      }}
                      onClick={() => setSelectedVisitor(v)}
                    >
                      <div onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(v.id)}
                          onChange={() => toggleOne(v.id)}
                          style={{ width: 16, height: 16, cursor: "pointer" }}
                        />
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {schoolName || "School Gallery"}
                        </div>
                        <div style={{ fontSize: 11, color: textMuted, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {students || (v.registrationClasses.length ? "Class registration" : "No student linked yet")}
                        </div>
                      </div>

                      <div style={{ minWidth: 0 }}>
                        {editingEmail?.id === v.id ? (
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editingEmail.email}
                              onChange={(e) => setEditingEmail({ ...editingEmail, email: e.target.value })}
                              style={{ padding: "5px 8px", border: `1px solid ${borderColor}`, borderRadius: 4, fontSize: 12, color: textPrimary, width: 190 }}
                            />
                            <button
                              type="button"
                              onClick={saveEmailEdit}
                              disabled={savingEmail}
                              style={{ padding: "5px 7px", background: accentColor, color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
                            >
                              {savingEmail ? "..." : <Check size={13} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingEmail(null)}
                              style={{ padding: "5px 7px", background: "#eee", color: textPrimary, border: "none", borderRadius: 4, cursor: "pointer" }}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.email}</div>
                            <button
                              type="button"
                              title="Email this visitor"
                              onClick={(e) => {
                                e.stopPropagation();
                                openComposerForVisitor(v);
                              }}
                              style={{ flex: "0 0 auto", padding: 5, border: `1px solid ${borderColor}`, borderRadius: 5, background: "#fff", color: textMuted, cursor: "pointer" }}
                            >
                              <Mail size={13} />
                            </button>
                            {!v.id.startsWith("order_") && <button
                              type="button"
                              title="Edit email"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingEmail({ id: v.id, email: v.email });
                              }}
                              style={{ flex: "0 0 auto", padding: 5, border: `1px solid ${borderColor}`, borderRadius: 5, background: "#fff", color: textMuted, cursor: "pointer" }}
                            >
                              <Edit3 size={13} />
                            </button>}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                          {classes && <span style={{ fontSize: 11, color: textMuted }}>{classes}</span>}
                          {(v.preRelease || v.alsoPreRelease) && (
                            <span
                              title="Registered for gallery updates"
                              style={{
                                display: "inline-block",
                                padding: "1px 7px",
                                borderRadius: 999,
                                fontSize: 10,
                                fontWeight: 800,
                                background: "#eef2ff",
                                color: "#3730a3",
                              }}
                            >
                              REGISTERED
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ fontSize: 12, color: textMuted }}>
                        {v.preRelease ? `Registered ${fmtDate(v.firstVisit)}` : fmtDateTime(v.lastVisit)}
                      </div>

                      <div>
                        {(v.favoriteCount || 0) > 0 ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedVisitor(v);
                            }}
                            style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "transparent", padding: 0, color: "#be123c", fontSize: 12, fontWeight: 800, cursor: "pointer" }}
                          >
                            <Star size={13} /> {v.favoriteCount}
                          </button>
                        ) : (
                          <span style={{ fontSize: 12, color: "#bbb" }}>-</span>
                        )}
                      </div>

                      <div>
                        {v.downloadCount > 0 ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedVisitor(v);
                            }}
                            style={{ border: "none", background: "transparent", padding: 0, color: "#2563eb", fontSize: 12, fontWeight: 800, cursor: "pointer" }}
                          >
                            View ({v.downloadCount})
                          </button>
                        ) : (
                          <span style={{ fontSize: 12, color: "#bbb" }}>-</span>
                        )}
                      </div>

                      <div style={{ fontSize: 12, fontWeight: 700, color: v.hasDigitalPurchase ? "#166534" : textMuted }}>
                        {v.hasDigitalPurchase ? "Purchased" : "—"}
                      </div>
                      <div>
                        {itemCount > 0 ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#166534", fontSize: 12, fontWeight: 800 }}>
                            <ShoppingCart size={13} /> {itemCount}
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, color: "#bbb" }}>-</span>
                        )}
                      </div>

                      <div style={{ minWidth: 0 }}>
                        {v.orders.length > 0 ? (
                          <div style={{ display: "grid", gap: 3 }}>
                            {v.orders.slice(0, 2).map((order, orderIndex) => (
                              <Link
                                key={order.id}
                                href={`/dashboard/orders?focus=${order.id}`}
                                onClick={(e) => e.stopPropagation()}
                                style={{ color: "#2563eb", fontSize: 12, fontWeight: 800, textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                              >
                                {orderLabels[orderIndex]}
                              </Link>
                            ))}
                            {v.orders.length > 2 && <span style={{ fontSize: 11, color: textMuted }}>+{v.orders.length - 2} more order{v.orders.length - 2 === 1 ? "" : "s"}</span>}
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: "#bbb" }}>-</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Side panel ────────────────────── */}
      {selectedVisitor && (
        <div
          style={{
            width: 440,
            background: cardBg,
            borderLeft: `1px solid ${borderColor}`,
            overflowY: "auto",
            height: "100vh",
            position: "sticky",
            top: 0,
          }}
        >
          {/* Panel header */}
          <div style={{ padding: "20px 24px", borderBottom: `1px solid ${borderColor}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: textPrimary }}>{selectedVisitor.email}</div>
              <div style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>First visit: {fmtDate(selectedVisitor.firstVisit)}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => openComposerForVisitor(selectedVisitor)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 10px", background: accentColor, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 800 }}
              >
                <Mail size={14} /> Email
              </button>
              <button
                type="button"
                onClick={() => setSelectedVisitor(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: textMuted }}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div style={{ padding: "14px 24px", fontSize: 12, color: textMuted, display: "grid", gap: 6, borderBottom: `1px solid ${borderColor}` }}>
            <div><strong>Registered classes:</strong> {selectedVisitor.registrationClasses.join(", ") || "No class choice saved"}</div>
            <div><strong>Linked students:</strong> {visitorStudentNames(selectedVisitor) || "No student linked yet"}</div>
            <div><strong>Paid digitals:</strong> {selectedVisitor.hasDigitalPurchase ? "Purchased" : "No paid digital purchase"}</div>
          </div>

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1, background: borderColor }}>
            <div style={{ background: cardBg, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: textPrimary }}>{selectedVisitor.favoriteCount || 0}</div>
              <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>Favorites</div>
            </div>
            <div style={{ background: cardBg, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: textPrimary }}>{selectedVisitor.orderCount}</div>
              <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>Orders</div>
            </div>
            <div style={{ background: cardBg, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: textPrimary }}>{selectedVisitor.downloadCount}</div>
              <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>Downloads</div>
            </div>
            <div style={{ background: cardBg, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: textPrimary }}>
                {selectedVisitor.orders.reduce((s, o) => s + o.totalCents, 0) > 0
                  ? fmtMoney(selectedVisitor.orders.reduce((s, o) => s + o.totalCents, 0))
                  : "-"}
              </div>
              <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>Order total</div>
            </div>
          </div>

          {/* Favorites section */}
          <div style={{ padding: "20px 24px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary, marginBottom: 12 }}>
              <Star size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Favorites ({selectedVisitor.favorites?.length ?? 0})
            </div>
            {!selectedVisitor.favorites?.length ? (
              <div style={{ fontSize: 13, color: textMuted, padding: "12px 0" }}>No favorites.</div>
            ) : (
              <FavoritePreviewGrid favorites={selectedVisitor.favorites} />
            )}
          </div>

          {/* Orders section */}
          <div style={{ padding: "0 24px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary, marginBottom: 12 }}>
              <ShoppingCart size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Orders ({selectedVisitor.orders.length})
            </div>
            {selectedVisitor.orders.length === 0 ? (
              <div style={{ fontSize: 13, color: textMuted, padding: "12px 0" }}>No orders placed.</div>
            ) : (
              selectedVisitor.orders.map((o) => (
	                <Link
	                  key={o.id}
	                  href={`/dashboard/orders?focus=${o.id}`}
	                  style={{
                    display: "block",
                    padding: "12px 16px",
                    background: "#f9fafb",
                    borderRadius: 8,
                    marginBottom: 8,
                    textDecoration: "none",
                    border: `1px solid ${borderColor}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary }}>{o.studentName || "Unknown Student"}</div>
                      {o.className && <div style={{ fontSize: 11, color: textMuted }}>{o.className}</div>}
                    </div>
                    {statusBadge(o.status)}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: textMuted }}>
                    <span>{fmtDate(o.createdAt)}</span>
                    <span style={{ fontWeight: 700, color: textPrimary }}>{o.totalCents > 0 ? fmtMoney(o.totalCents) : "-"}</span>
                  </div>
                  <OrderItemsList order={o} />
                </Link>
              ))
            )}
          </div>

          {/* Downloads section */}
          <div style={{ padding: "0 24px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary, marginBottom: 12 }}>
              <Download size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Free Digital Downloads ({selectedVisitor.downloads.length})
            </div>
            {selectedVisitor.downloads.length === 0 ? (
              <div style={{ fontSize: 13, color: textMuted, padding: "12px 0" }}>No downloads.</div>
            ) : (
              selectedVisitor.downloads.map((d) => (
                <div
                  key={d.id}
                  style={{
                    padding: "12px 16px",
                    background: "#f9fafb",
                    borderRadius: 8,
                    marginBottom: 8,
                    border: `1px solid ${borderColor}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: textPrimary }}>
                      {d.mediaIds.length} photo{d.mediaIds.length !== 1 ? "s" : ""}
                    </div>
                    <div style={{ fontSize: 11, color: textMuted }}>{fmtDateTime(d.createdAt)}</div>
                  </div>
                  <DownloadPreviewGrid download={d} />
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Email Composer Modal ──────────── */}
      {showComposer && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div role="dialog" aria-modal="true" aria-labelledby="visitor-email-title" style={{ background: cardBg, borderRadius: 12, width: "100%", maxWidth: 900, maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.25)" }}>
            {/* Modal header */}
            <div style={{ padding: "20px 28px", borderBottom: `1px solid ${borderColor}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div id="visitor-email-title" style={{ fontSize: 20, fontWeight: 800, color: textPrimary }}>
                  <Mail size={20} style={{ marginRight: 8, verticalAlign: "middle" }} />
                  Review Email · {composerAudience?.recipients.length ?? selected.size} Contacts
                </div>
              </div>
              <button
                type="button"
                aria-label="Close email composer"
                disabled={sendingEmail || audienceLoading}
                onClick={() => { void saveEmailTemplate(); setShowComposer(false); setEmailResult(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: textMuted }}
              >
                <X size={20} />
              </button>
            </div>

            {emailError && <div role="alert" style={{ margin: "16px 28px", padding: 12, background: "#fff1f2", color: "#9f1239", borderRadius: 6 }}>
              {emailError} {!composerAudience && <button type="button" onClick={() => { setShowComposer(false); void load(); }}>Refresh report</button>}
            </div>}
            {emailResult ? (
              <div style={{ padding: "40px 28px", textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>&#9993;</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: textPrimary, marginBottom: 8 }}>Email results</div>
                <div style={{ fontSize: 14, color: textMuted }}>
                  {emailResult.sent} accepted for sending
                  {emailResult.failed > 0 ? `, ${emailResult.failed} failed` : ""}
                </div>
                <div style={{ fontSize: 12, color: textMuted, marginTop: 8 }}>Delivery can still fail if an address bounces.</div>
                {emailResult.failed > 0 && <div role="alert" style={{ marginTop: 16, color: "#9f1239", fontSize: 12 }}>
                  {[...outcomes.current.values()].filter(outcome => outcome.status === "failed").slice(0, 10).map(outcome => <div key={outcome.recipientEmail}>{outcome.recipientEmail}: {outcome.error || "The email service rejected this address."}</div>)}
                </div>}
                <button
                  type="button"
                  onClick={() => { setShowComposer(false); setEmailResult(null); setSelected(new Set()); }}
                  style={{ marginTop: 24, padding: "10px 24px", background: accentColor, color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}
                >
                  Done
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
                {/* Left: Form */}
                <div style={{ flex: "1 1 340px", padding: "24px 28px", borderRight: `1px solid ${borderColor}` }}>
                  {/* Recipients */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: textMuted, marginBottom: 4 }}>To</div>
                    <div style={{ fontSize: 13, color: textPrimary, padding: "8px 12px", background: "#f9fafb", border: `1px solid ${borderColor}`, borderRadius: 6, maxHeight: 80, overflowY: "auto" }}>
                      {audienceLoading ? "Checking current recipients and orders…" : composerAudience?.recipients.join(", ") || "Recipients need to be reviewed again."}
                    </div>
                  </div>
                  <div aria-live="polite" style={{ marginBottom: 16, fontSize: 12, color: textMuted }}>
                    {templateStatus}
                    {!campaignStarted && <button type="button" onClick={() => void saveEmailTemplate(true)} style={{ marginLeft: 10, padding: "5px 8px", cursor: "pointer" }}>Save template</button>}
                    {templateError && <div role="alert" style={{ marginTop: 6, color: "#9f1239" }}>{templateError}</div>}
                  </div>
                  {/* Subject */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: textMuted, marginBottom: 4 }}>Subject</div>
                    <input
                      type="text"
                      aria-label="Email subject"
                      maxLength={500}
                      disabled={campaignStarted || audienceLoading}
                      value={emailForm.subject}
                      onChange={(e) => updateEmailForm("subject", e.target.value)}
                      style={{ width: "100%", padding: "10px 12px", border: `1px solid ${borderColor}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", color: textPrimary, background: "#fff" }}
                    />
                  </div>
                  {/* Headline */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: textMuted, marginBottom: 4 }}>Headline</div>
                    <input
                      type="text"
                      aria-label="Email headline"
                      maxLength={500}
                      disabled={campaignStarted || audienceLoading}
                      value={emailForm.headline}
                      onChange={(e) => updateEmailForm("headline", e.target.value)}
                      style={{ width: "100%", padding: "10px 12px", border: `1px solid ${borderColor}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", color: textPrimary, background: "#fff" }}
                    />
                  </div>
                  {/* Message */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: textMuted, marginBottom: 4 }}>Message</div>
                    <textarea
                      aria-label="Email message"
                      maxLength={10000}
                      disabled={campaignStarted || audienceLoading}
                      value={emailForm.message}
                      onChange={(e) => updateEmailForm("message", e.target.value)}
                      rows={8}
                      style={{ width: "100%", padding: "10px 12px", border: `1px solid ${borderColor}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", color: textPrimary, background: "#fff" }}
                      placeholder="Write your message here…"
                    />
                  </div>
                  {(sendingEmail || emailProgress) && <div role="status" aria-live="polite" style={{ marginBottom: 16, fontSize: 13, color: textPrimary }}>
                    {emailProgress?.sent ?? 0} accepted · {emailProgress?.failed ?? 0} failed · {emailProgress?.pending ?? composerAudience?.recipients.length ?? 0} remaining
                    <div style={{ marginTop: 6, fontSize: 12, color: textMuted }}>Keep this tab open while sending. Large selections continue in batches automatically.</div>
                  </div>}
                  {/* Buttons */}
                  {emailAudienceStale && <div style={{ marginBottom: 16, color: textMuted, fontSize: 12 }}>
                    Current orders changed. Review the remaining contacts to exclude new buyers and emails already accepted in this batch.
                    <button type="button" disabled={audienceLoading} onClick={() => void reviewRemainingContacts()} style={{ marginLeft: 8, padding: "7px 10px", cursor: "pointer" }}>Review remaining contacts</button>
                  </div>}
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      type="button"
                      disabled={sendingEmail || audienceLoading}
                      onClick={() => { void saveEmailTemplate(); setShowComposer(false); }}
                      style={{ padding: "10px 20px", background: "#fff", color: textPrimary, border: `1px solid ${borderColor}`, borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
                    >
                      {campaignStarted ? "Finish later" : "Cancel"}
                    </button>
                    <button
                      type="button"
                      onClick={sendMassEmail}
                      disabled={sendingEmail || emailAudienceStale || !retryAllowed || retrySeconds > 0 || audienceLoading || !composerAudience || !emailForm.subject || !emailForm.headline || !emailForm.message}
                      style={{
                        padding: "10px 24px",
                        background: accentColor,
                        color: "#fff",
                        border: "none",
                        borderRadius: 6,
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: "pointer",
                        opacity: sendingEmail || emailAudienceStale || !retryAllowed || retrySeconds > 0 || audienceLoading || !composerAudience || !emailForm.subject || !emailForm.headline || !emailForm.message ? 0.5 : 1,
                      }}
                    >
                      {sendingEmail ? "Sending…" : !retryAllowed ? "Provider review required" : retrySeconds > 0 ? `Retry in ${retrySeconds}s` : campaignStarted ? "Retry remaining contacts" : `Send to ${composerAudience?.recipients.length ?? 0} Contacts`}
                    </button>
                  </div>
                  {campaignStarted && !sendingEmail && <button type="button" onClick={() => {
                    setPendingCampaign(null); setCampaignStarted(false); setShowComposer(false); setSelected(new Set());
                    try { localStorage.removeItem(campaignStorageKey.current); } catch { /* The open tab clears its state. */ }
                  }} disabled={audienceLoading} style={{ marginTop: 14, padding: 0, background: "none", border: "none", textDecoration: "underline", color: textMuted, cursor: "pointer", fontSize: 12 }}>
                    End this batch without sending the remaining contacts
                  </button>}
                </div>

                {/* Right: Preview */}
                <div style={{ flex: "1 1 340px", padding: "24px 28px", background: "#fafafa" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: textMuted, marginBottom: 12 }}>Email Preview</div>
                  <div style={{ background: "#e5e5e5", borderRadius: 6, padding: 20 }}>
                    <div style={{ background: "#fff", borderRadius: 6, overflow: "hidden", maxWidth: 400, margin: "0 auto" }}>
                      <div style={{ background: "#111", padding: "20px 24px", textAlign: "center" }}>
                        {branding.logoUrl ? (
                          <img src={branding.logoUrl} alt={branding.businessName} style={{ maxHeight: 44, maxWidth: 180 }} />
                        ) : (
                          <div style={{ fontSize: 18, fontWeight: 900, color: "#fff" }}>{branding.businessName || "Studio OS"}</div>
                        )}
                      </div>
                      <div style={{ textAlign: "center", padding: "24px 20px 12px", fontSize: 18, fontWeight: 800, color: "#111" }}>
                        {emailForm.headline || "Your headline…"}
                      </div>
                      <div style={{ margin: "0 20px 20px", padding: "14px 16px", background: "#f9fafb", borderLeft: "3px solid #111", borderRadius: 2 }}>
                        <div style={{ fontSize: 12, color: "#333", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                          {emailForm.message || "Your message…"}
                        </div>
                      </div>
                      <div style={{ padding: "12px 20px", background: "#f5f5f5", textAlign: "center" }}>
                        <div style={{ fontSize: 10, color: "#999" }}>&copy; {new Date().getFullYear()} {branding.businessName || "Studio OS"}</div>
                        {(branding.studioAddress || branding.studioPhone || branding.studioEmail) && (
                          <div style={{ fontSize: 10, color: "#aaa", marginTop: 4 }}>
                            {[branding.studioAddress, branding.studioPhone, branding.studioEmail].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
