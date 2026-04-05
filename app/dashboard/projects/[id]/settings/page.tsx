"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  FolderOpen,
  Image as ImageIcon,
  Pencil,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  defaultEventGalleryBranding,
  defaultEventGalleryExtras,
  defaultEventGalleryShareSettings,
  normalizeEventGallerySettings,
  type EventGalleryBrandingSettings,
  type EventGalleryExtraSettings,
  type EventGalleryLinkedContact,
  type EventGalleryShareSettings,
} from "@/lib/event-gallery-settings";

type ProjectRow = Record<string, unknown>;
type PackageProfileRow = {
  id: string;
  name?: string | null;
  profile_name?: string | null;
  photographer_id?: string | null;
  created_at?: string | null;
};
type PackageProfilePackageRow = {
  profile_id: string | null;
  profile_name: string | null;
};

const sections = [
  { key: "general", label: "General", icon: Settings2 },
  { key: "branding", label: "Branding", icon: ImageIcon },
  { key: "privacy", label: "Access & Privacy", icon: ShieldCheck },
  { key: "free-digital", label: "Free Digitals", icon: Download },
  { key: "store", label: "Shopping Cart/Store", icon: ShoppingCart },
  { key: "advanced", label: "Advanced", icon: Sparkles },
] as const;

type SectionKey = (typeof sections)[number]["key"];

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition",
        checked ? "border-neutral-950 bg-neutral-950" : "border-neutral-300 bg-neutral-200"
      )}
    >
      <span
        className={cx(
          "inline-block h-5 w-5 rounded-full bg-white shadow transition",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}

function Card({ title, children, description }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[24px] border border-neutral-200 bg-white p-6 shadow-[0_8px_28px_rgba(0,0,0,0.05)]">
      <h3 className="text-[15px] font-semibold text-neutral-900">{title}</h3>
      {description ? <p className="mt-1 text-sm text-neutral-600">{description}</p> : null}
      <div className="mt-5 space-y-5">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[13px] font-semibold text-neutral-800">{label}</div>
      <div className="mt-2">{children}</div>
      {hint ? <div className="mt-2 text-sm text-neutral-600">{hint}</div> : null}
    </label>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-4">
      <div>
        <div className="text-[15px] font-semibold text-neutral-900">{title}</div>
        {description ? <div className="mt-1 text-sm text-neutral-600">{description}</div> : null}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

type VisualChoiceOption<T extends string> = {
  value: T;
  label: string;
  description: string;
  preview: React.ReactNode;
};

function VisualChoiceGrid<T extends string>({
  title,
  hint,
  value,
  options,
  onChange,
  columns = "md:grid-cols-3",
}: {
  title: string;
  hint?: string;
  value: T;
  options: VisualChoiceOption<T>[];
  onChange: (next: T) => void;
  columns?: string;
}) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-neutral-800">{title}</div>
      {hint ? <div className="mt-1 text-sm text-neutral-600">{hint}</div> : null}
      <div className={cx("mt-3 grid gap-3", columns)}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={cx(
                "rounded-[20px] border p-3 text-left transition",
                active
                  ? "border-neutral-950 bg-neutral-950 text-white shadow-[0_10px_28px_rgba(0,0,0,0.18)]"
                  : "border-neutral-200 bg-white text-neutral-900 hover:border-neutral-300",
              )}
            >
              <div
                className={cx(
                  "overflow-hidden rounded-2xl border",
                  active ? "border-white/15 bg-neutral-950" : "border-neutral-200 bg-neutral-50",
                )}
              >
                {option.preview}
              </div>
              <div className="mt-3 flex items-start justify-between gap-3">
                <div>
                  <div className={cx("text-[14px] font-semibold", active ? "text-white" : "text-neutral-900")}>
                    {option.label}
                  </div>
                  <div className={cx("mt-1 text-sm leading-6", active ? "text-neutral-300" : "text-neutral-600")}>
                    {option.description}
                  </div>
                </div>
                <div
                  className={cx(
                    "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                    active ? "border-white/20 bg-white/10 text-white" : "border-neutral-200 bg-white text-transparent",
                  )}
                >
                  <Check size={14} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function galleryFontFamily(fontPreset: EventGalleryBrandingSettings["fontPreset"]) {
  switch (fontPreset) {
    case "brandon":
      return '"Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif';
    case "freeland":
      return '"Brush Script MT", "Segoe Script", cursive';
    case "baskerville":
      return 'Baskerville, "Baskerville Old Face", Garamond, serif';
    case "playfair":
      return '"Palatino Linotype", Palatino, Georgia, serif';
    case "spectral":
      return 'Cambria, Georgia, serif';
    case "montserrat":
      return '"Helvetica Neue", Arial, sans-serif';
    case "raleway":
      return '"Trebuchet MS", Arial, sans-serif';
    case "inter":
      return 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    case "quicksand":
      return '"Trebuchet MS", "Century Gothic", Arial, sans-serif';
    case "oswald":
      return 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif';
    case "pt-sans":
      return '"Gill Sans", "Segoe UI", Arial, sans-serif';
    case "lato":
      return 'Verdana, "Trebuchet MS", Arial, sans-serif';
    case "editorial-serif":
      return 'Georgia, "Times New Roman", serif';
    case "classic-contrast":
      return '"Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif';
    default:
      return '"Helvetica Neue", Helvetica, Arial, sans-serif';
  }
}

function galleryFontLabel(fontPreset: EventGalleryBrandingSettings["fontPreset"]) {
  switch (fontPreset) {
    case "brandon":
      return "Brandon";
    case "freeland":
      return "Freeland";
    case "baskerville":
      return "Baskerville";
    case "playfair":
      return "Playfair";
    case "spectral":
      return "Spectral";
    case "montserrat":
      return "Montserrat";
    case "raleway":
      return "Raleway";
    case "inter":
      return "Inter";
    case "quicksand":
      return "Quicksand";
    case "oswald":
      return "Oswald";
    case "pt-sans":
      return "PT Sans";
    case "lato":
      return "Lato";
    case "editorial-serif":
      return "Editorial Serif";
    case "classic-contrast":
      return "Classic Contrast";
    default:
      return "Studio Sans";
  }
}

function BackgroundModePicker({
  value,
  onChange,
}: {
  value: EventGalleryBrandingSettings["backgroundMode"];
  onChange: (next: EventGalleryBrandingSettings["backgroundMode"]) => void;
}) {
  return (
    <div>
      <div className="text-[13px] font-semibold text-neutral-800">Background</div>
      <div className="mt-3 inline-flex rounded-2xl border border-neutral-200 bg-white p-1">
        {[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ].map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                onChange(option.value as EventGalleryBrandingSettings["backgroundMode"])
              }
              className={cx(
                "rounded-[14px] px-4 py-2.5 text-sm font-semibold transition",
                active
                  ? "bg-neutral-950 text-white shadow-[0_10px_20px_rgba(0,0,0,0.16)]"
                  : "text-neutral-700 hover:bg-neutral-100",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FontDropdown({
  value,
  onChange,
}: {
  value: EventGalleryBrandingSettings["fontPreset"];
  onChange: (next: EventGalleryBrandingSettings["fontPreset"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const allFonts: { value: EventGalleryBrandingSettings["fontPreset"]; category: string }[] = [
    { value: "studio-sans", category: "Modern" },
    { value: "brandon", category: "Modern" },
    { value: "montserrat", category: "Modern" },
    { value: "inter", category: "Modern" },
    { value: "raleway", category: "Modern" },
    { value: "lato", category: "Modern" },
    { value: "pt-sans", category: "Modern" },
    { value: "quicksand", category: "Friendly" },
    { value: "playfair", category: "Elegant" },
    { value: "baskerville", category: "Elegant" },
    { value: "spectral", category: "Elegant" },
    { value: "editorial-serif", category: "Elegant" },
    { value: "classic-contrast", category: "Bold" },
    { value: "oswald", category: "Bold" },
    { value: "freeland", category: "Script" },
  ];

  return (
    <div ref={ref} className="relative">
      <div className="mb-2 text-[13px] font-semibold text-neutral-800">Typography</div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 bg-white px-5 py-4 text-left transition hover:border-neutral-300"
      >
        <div className="flex items-center gap-4">
          <span
            className="text-[26px] leading-none text-neutral-800"
            style={{ fontFamily: galleryFontFamily(value) }}
          >
            {galleryFontLabel(value)}
          </span>
          <span className="text-xs font-medium text-neutral-400 tracking-wide uppercase">
            {allFonts.find((f) => f.value === value)?.category || ""}
          </span>
        </div>
        <ChevronDown
          size={16}
          className={cx("text-neutral-400 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-50 mt-2 max-h-[400px] overflow-y-auto rounded-2xl border border-neutral-200 bg-white shadow-[0_16px_48px_rgba(0,0,0,0.10)]">
          {allFonts.map((font) => {
            const active = font.value === value;
            return (
              <button
                key={font.value}
                type="button"
                onClick={() => { onChange(font.value); setOpen(false); }}
                className={cx(
                  "flex w-full items-center justify-between px-5 py-3.5 text-left transition border-b border-neutral-100 last:border-0",
                  active
                    ? "bg-neutral-950 text-white"
                    : "hover:bg-neutral-50",
                )}
              >
                <span
                  className={cx("text-[22px] leading-none", active ? "text-white" : "text-neutral-800")}
                  style={{ fontFamily: galleryFontFamily(font.value) }}
                >
                  {galleryFontLabel(font.value)}
                </span>
                <span className={cx(
                  "text-[10px] font-semibold uppercase tracking-[0.12em]",
                  active ? "text-neutral-400" : "text-neutral-300",
                )}>
                  {font.category}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BrandPreview({ branding, projectName }: { branding: EventGalleryBrandingSettings; projectName: string }) {
  const palette =
    branding.backgroundMode === "light"
      ? branding.tone === "graphite"
        ? { bg: "#f3f5f7", panel: "#ffffff", text: "#27313b", muted: "#6b7280" }
        : branding.tone === "smoke"
          ? { bg: "#f6f6f6", panel: "#ffffff", text: "#2f2f2f", muted: "#757575" }
          : { bg: "#f8f8f8", panel: "#ffffff", text: "#262626", muted: "#7b7b7b" }
      : branding.tone === "graphite"
      ? { bg: "#0f1115", panel: "#171a20", text: "#c8ccd2", muted: "#8e96a3" }
      : branding.tone === "smoke"
        ? { bg: "#181818", panel: "#232323", text: "#cdcdcd", muted: "#979797" }
        : { bg: "#0a0a0a", panel: "#141414", text: "#cfcfcf", muted: "#8a8a8a" };

  const titleStyle = galleryFontFamily(branding.fontPreset);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <div
        className="relative min-h-[210px] overflow-hidden rounded-[22px] border border-neutral-800"
        style={{
              background:
                branding.introLayout === "minimal"
                  ? `linear-gradient(135deg, ${palette.bg}, #202020)`
              : `linear-gradient(120deg, ${palette.bg} 0%, ${branding.backgroundMode === "light" ? "#dde2e8" : "#2a2a2a"} 100%)`,
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at top right, rgba(255,255,255,0.14), transparent 28%), radial-gradient(circle at bottom left, rgba(255,255,255,0.08), transparent 24%)",
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: palette.muted }}>
            Studio OS
          </div>
          <div className={cx("max-w-[70%]", branding.introLayout === "centered" ? "mx-auto text-center" : "")}>
            <div
              className="text-[30px] font-semibold leading-[1.02] tracking-[-0.04em]"
              style={{
                color: palette.text,
                fontFamily: titleStyle,
                textTransform: branding.themePreset === "cinema" ? "uppercase" : "none",
                letterSpacing: branding.themePreset === "cinema" ? "0.05em" : undefined,
              }}
            >
              {branding.introHeadline || projectName || "Event Gallery"}
            </div>
            <div className="mt-3 max-w-[42ch] text-sm leading-6" style={{ color: palette.muted }}>
              {branding.introMessage || "A private Studio OS gallery designed for your event."}
            </div>
            <div
              className="mt-5 inline-flex rounded-full border px-4 py-2 text-[12px] font-semibold"
              style={{ color: palette.text, borderColor: palette.text }}
            >
              {branding.introCtaLabel || "Enter Gallery"}
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-[22px] border border-neutral-200 bg-neutral-50 p-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Brand Preview</div>
        <div className="mt-3 grid gap-3">
          <div className="rounded-2xl border border-neutral-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Typography</div>
            <div
              className="mt-2 text-2xl leading-none tracking-[-0.03em] text-neutral-600"
              style={{ fontFamily: titleStyle }}
            >
              {galleryFontLabel(branding.fontPreset)}
            </div>
          </div>
          <div className="rounded-2xl border border-neutral-200 bg-white p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">Layout</div>
            <div className="mt-3 text-sm font-semibold text-neutral-700">
              {branding.photoLayout === "cascade"
                ? "Cascade photo wall"
                : branding.photoLayout === "editorial"
                  ? "Editorial mix"
                  : "Subway grid"}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {branding.photoLayout === "cascade" ? (
                <>
                  <div className="h-20 rounded-xl bg-neutral-900" />
                  <div className="h-14 rounded-xl bg-neutral-500" />
                  <div className="h-24 rounded-xl bg-neutral-700" />
                  <div className="h-16 rounded-xl bg-neutral-300" />
                </>
              ) : branding.photoLayout === "editorial" ? (
                <>
                  <div className="col-span-2 h-24 rounded-xl bg-neutral-900" />
                  <div className="h-11 rounded-xl bg-neutral-500" />
                  <div className="h-11 rounded-xl bg-neutral-300" />
                  <div className="h-14 rounded-xl bg-neutral-700" />
                  <div className="h-14 rounded-xl bg-neutral-300" />
                </>
              ) : (
                <>
                  <div className="h-16 rounded-xl bg-neutral-900" />
                  <div className="h-16 rounded-xl bg-neutral-700" />
                  <div className="h-16 rounded-xl bg-neutral-500" />
                  <div className="h-16 rounded-xl bg-neutral-300" />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ProjectSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const params = useParams();
  const router = useRouter();
  const projectId = String(params.id ?? "");

  const [activeSection, setActiveSection] = useState<SectionKey>("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [packageProfiles, setPackageProfiles] = useState<PackageProfileRow[]>([]);

  const [projectName, setProjectName] = useState("");
  const [portalStatus, setPortalStatus] = useState("inactive");
  const [shootDate, setShootDate] = useState("");
  const [orderDueDate, setOrderDueDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [galleryLanguage, setGalleryLanguage] = useState("English (US)");
  const [packageProfileId, setPackageProfileId] = useState("");
  const [emailRequired, setEmailRequired] = useState(false);
  const [checkoutContactRequired, setCheckoutContactRequired] = useState(false);
  const [internalNotes, setInternalNotes] = useState("");
  const [projectAccessMode, setProjectAccessMode] = useState<'public' | 'pin'>('public');
  const [projectPin, setProjectPin] = useState('');
  const [extras, setExtras] = useState<EventGalleryExtraSettings>(defaultEventGalleryExtras);
  const [branding, setBranding] = useState<EventGalleryBrandingSettings>(defaultEventGalleryBranding);
  const [linkedContacts, setLinkedContacts] = useState<EventGalleryLinkedContact[]>([]);
  const [share, setShare] = useState<EventGalleryShareSettings>(defaultEventGalleryShareSettings);

  const storageKey = `studioos_project_settings_${projectId}`;

  useEffect(() => {
    void loadAll();
  }, [projectId]);

  async function loadAll() {
    setLoading(true);

    const [{ data: projectData }] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
    ]);

    let nextPackageProfiles: PackageProfileRow[] = [];

    if (projectData?.photographer_id) {
      const [profileResult, packagesResult] = await Promise.all([
        supabase
          .from("package_profiles")
          .select("id,name,profile_name,photographer_id,created_at")
          .eq("photographer_id", projectData.photographer_id)
          .order("created_at", { ascending: false }),
        supabase
          .from("packages")
          .select("profile_id,profile_name")
          .eq("photographer_id", projectData.photographer_id)
          .order("profile_name"),
      ]);

      const rawProfiles = (profileResult.data ?? []) as PackageProfileRow[];
      const rawPackages = (packagesResult.data ?? []) as PackageProfilePackageRow[];
      const seenProfileIds = new Set(
        rawProfiles.map((profile) => profile.id).filter(Boolean),
      );

      nextPackageProfiles = [...rawProfiles];

      for (const pkg of rawPackages) {
        const profileId = (pkg.profile_id ?? "").trim();
        if (!profileId || seenProfileIds.has(profileId)) continue;
        seenProfileIds.add(profileId);
        nextPackageProfiles.push({
          id: profileId,
          name: pkg.profile_name ?? profileId,
          profile_name: pkg.profile_name ?? profileId,
          photographer_id: projectData.photographer_id,
          created_at: null,
        });
      }
    }

    if (projectData) {
      setProject(projectData);
      setProjectName(projectData.project_name || projectData.name || projectData.title || "");
      setPortalStatus(projectData.portal_status || projectData.status || "inactive");
      setShootDate(projectData.shoot_date || projectData.event_date || "");
      setOrderDueDate(projectData.order_due_date || "");
      setExpirationDate(projectData.expiration_date || "");
      setPackageProfileId(projectData.package_profile_id || "");
      setEmailRequired(Boolean(projectData.email_required));
      setCheckoutContactRequired(Boolean(projectData.checkout_contact_required));
      setInternalNotes(projectData.internal_notes || "");
      setProjectAccessMode(projectData.access_mode === 'pin' ? 'pin' : 'public');
      setProjectPin(projectData.access_pin || '');

      const hasPersistedGallerySettings =
        projectData.gallery_settings &&
        typeof projectData.gallery_settings === "object" &&
        !Array.isArray(projectData.gallery_settings) &&
        Object.keys(projectData.gallery_settings).length > 0;

      if (hasPersistedGallerySettings) {
        const normalized = normalizeEventGallerySettings(projectData.gallery_settings);
        setGalleryLanguage(normalized.galleryLanguage);
        setExtras(normalized.extras);
        setBranding(normalized.branding);
        setLinkedContacts(normalized.linkedContacts);
        setShare(normalized.share);
      } else {
        try {
          const raw = window.localStorage.getItem(storageKey);
          if (raw) {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const normalized = normalizeEventGallerySettings(
              parsed.extras || parsed.branding
                ? parsed
                : {
                    galleryLanguage: parsed.galleryLanguage,
                    extras: parsed,
                  },
            );
            setGalleryLanguage(normalized.galleryLanguage);
            setExtras(normalized.extras);
            setBranding(normalized.branding);
            setLinkedContacts(normalized.linkedContacts);
            setShare(normalized.share);
          }
        } catch {}
      }
    }

    setPackageProfiles(nextPackageProfiles);

    setLoading(false);
  }

  function setExtra<K extends keyof EventGalleryExtraSettings>(key: K, value: EventGalleryExtraSettings[K]) {
    setExtras((prev) => ({ ...prev, [key]: value }));
  }

  function setBrandingField<K extends keyof EventGalleryBrandingSettings>(
    key: K,
    value: EventGalleryBrandingSettings[K],
  ) {
    setBranding((prev) => ({ ...prev, [key]: value }));
  }

  async function saveAll() {
    setSaving(true);
    setSaveNotice(null);

    const payload: Record<string, unknown> = {
      portal_status: portalStatus,
      shoot_date: shootDate || null,
      order_due_date: orderDueDate || null,
      expiration_date: expirationDate || null,
      package_profile_id: packageProfileId || null,
      email_required: emailRequired,
      checkout_contact_required: checkoutContactRequired,
      internal_notes: internalNotes || null,
      access_mode: projectAccessMode,
      access_pin: projectAccessMode === 'pin' ? (projectPin || null) : null,
      access_updated_at: new Date().toISOString(),
      access_updated_source: 'cloud',
      gallery_settings: normalizeEventGallerySettings({
        galleryLanguage,
        extras,
        branding,
        linkedContacts,
        share,
      }),
    };

    if (project) {
      if ("project_name" in project) payload.project_name = projectName || null;
      else if ("name" in project) payload.name = projectName || null;
      else payload.title = projectName || null;
    }

    try {
      const supabaseClient = createClient();
      const { data: { session } } = await supabaseClient.auth.getSession();
      const response = await fetch(`/api/dashboard/events/${projectId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify(payload),
      });

      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        details?: string | null;
        code?: string | null;
        project?: ProjectRow | null;
      };

      if (response.status === 401) {
        window.location.href = "/sign-in";
        return;
      }

      if (!response.ok || result.ok === false) {
        const detail = result.details ? ` (${result.details})` : "";
        const code = result.code ? ` [${result.code}]` : "";
        throw new Error(`[${response.status}] ${result.message || "Failed to save project settings."}${detail}${code}`);
      }

      if (result.project) {
        setProject(result.project);
      }

      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ galleryLanguage, extras, branding, linkedContacts, share })
        );
      } catch {}
      setSaveNotice("Saved");
      setTimeout(() => setSaveNotice(null), 2500);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to save project settings.");
    } finally {
      setSaving(false);
    }
  }

  function saveAsPreset() {
    const name = window.prompt("Preset name");
    if (!name) return;
    try {
      const key = "studioos_gallery_presets";
      const current = JSON.parse(window.localStorage.getItem(key) || "[]") as Array<Record<string, unknown>>;
      current.push({
        id: crypto.randomUUID(),
        name,
        createdAt: new Date().toISOString(),
        values: {
          galleryLanguage,
          portalStatus,
          emailRequired,
          checkoutContactRequired,
          packageProfileId,
          extras,
          branding,
          linkedContacts,
          share,
        },
      });
      window.localStorage.setItem(key, JSON.stringify(current));
      setSaveNotice(`Preset “${name}” saved`);
      setTimeout(() => setSaveNotice(null), 2500);
    } catch {
      alert("Unable to save preset on this browser.");
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-[#f6f7fb] flex items-center justify-center text-sm text-neutral-600">Loading settings...</div>;
  }

  const statusOptions = [
    { value: "active", label: "Active" },
    { value: "inactive", label: "Inactive" },
    { value: "pre_release", label: "Pre-Released" },
    { value: "closed", label: "Closed" },
  ];

  const introLayoutOptions: VisualChoiceOption<EventGalleryBrandingSettings["introLayout"]>[] = [
    {
      value: "split",
      label: "Split Hero",
      description: "Text panel on one side, image atmosphere on the other.",
      preview: (
        <div className="grid h-24 grid-cols-[1.2fr_0.8fr] gap-2 bg-neutral-950 p-2">
          <div
            className="rounded-xl"
            style={{ background: "linear-gradient(135deg, #121212, #2b2b2b)" }}
          />
          <div className="rounded-xl border border-white/10 bg-black/60 p-2">
            <div className="h-2 w-12 rounded-full bg-neutral-500" />
            <div className="mt-3 h-3 w-20 rounded-full bg-neutral-300" />
            <div className="mt-2 h-2 w-16 rounded-full bg-neutral-600" />
            <div className="mt-4 h-6 w-16 rounded-full border border-neutral-400" />
          </div>
        </div>
      ),
    },
    {
      value: "centered",
      label: "Centered Statement",
      description: "Balanced, clean intro with the event title in the middle.",
      preview: (
        <div
          className="flex h-24 items-center justify-center p-2"
          style={{ background: "linear-gradient(135deg, #111, #343434)" }}
        >
          <div className="text-center">
            <div className="mx-auto h-2 w-12 rounded-full bg-neutral-500" />
            <div className="mx-auto mt-3 h-3 w-24 rounded-full bg-neutral-300" />
            <div className="mx-auto mt-2 h-2 w-16 rounded-full bg-neutral-600" />
          </div>
        </div>
      ),
    },
    {
      value: "minimal",
      label: "Minimal Entrance",
      description: "Quiet overlay with the least amount of UI before entry.",
      preview: (
        <div
          className="flex h-24 items-center justify-center p-2"
          style={{ background: "linear-gradient(135deg, #0a0a0a, #1b1b1b)" }}
        >
          <div className="h-3 w-28 rounded-full bg-neutral-400" />
        </div>
      ),
    },
  ];

  const themeOptions: VisualChoiceOption<EventGalleryBrandingSettings["themePreset"]>[] = [
    {
      value: "signature",
      label: "Signature",
      description: "Balanced Studio OS look with clean type and calm contrast.",
      preview: (
        <div className="h-24 p-3" style={{ background: "linear-gradient(135deg, #0a0a0a, #202020)" }}>
          <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-600">Studio OS</div>
          <div className="mt-6 h-3 w-24 rounded-full bg-neutral-300" />
          <div className="mt-2 h-2 w-16 rounded-full bg-neutral-500" />
        </div>
      ),
    },
    {
      value: "editorial",
      label: "Editorial",
      description: "More refined and story-driven, with softer hierarchy.",
      preview: (
        <div className="h-24 p-3" style={{ background: "linear-gradient(135deg, #101010, #2c2c2c)" }}>
          <div
            className="text-[18px] leading-none text-neutral-300"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
          >
            Editorial
          </div>
          <div className="mt-3 h-px w-10 bg-neutral-500" />
          <div className="mt-3 h-2 w-20 rounded-full bg-neutral-600" />
        </div>
      ),
    },
    {
      value: "cinema",
      label: "Cinema",
      description: "Stronger uppercase treatment with a more dramatic intro feel.",
      preview: (
        <div className="h-24 p-3" style={{ background: "linear-gradient(135deg, #060606, #242424)" }}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-neutral-300">Cinema</div>
          <div className="mt-6 h-3 w-24 rounded-full bg-neutral-400" />
          <div className="mt-2 h-2 w-14 rounded-full bg-neutral-600" />
        </div>
      ),
    },
  ];

  const toneOptions: VisualChoiceOption<EventGalleryBrandingSettings["tone"]>[] = [
    {
      value: "ink",
      label: "Ink",
      description: "Deep black with cool gray type.",
      preview: <div className="grid h-24 grid-cols-3"><div className="bg-[#080808]" /><div className="bg-[#131313]" /><div className="bg-[#cfcfcf]" /></div>,
    },
    {
      value: "graphite",
      label: "Graphite",
      description: "Dark slate base with polished neutral grays.",
      preview: <div className="grid h-24 grid-cols-3"><div className="bg-[#0f1012]" /><div className="bg-[#1a1d22]" /><div className="bg-[#c8ccd2]" /></div>,
    },
    {
      value: "smoke",
      label: "Smoke",
      description: "Softer charcoal finish with lighter typography.",
      preview: <div className="grid h-24 grid-cols-3"><div className="bg-[#141414]" /><div className="bg-[#232323]" /><div className="bg-[#cdcdcd]" /></div>,
    },
  ];

  const accentOptions: VisualChoiceOption<EventGalleryBrandingSettings["accentColor"]>[] = [
    {
      value: "studio-red",
      label: "Studio Red",
      description: "A restrained Studio OS red for key buttons and premium accents.",
      preview: <div className="grid h-24 grid-cols-3"><div className="bg-[#12090a]" /><div className="bg-[#7f1d1d]" /><div className="bg-[#f5e8e8]" /></div>,
    },
    {
      value: "champagne",
      label: "Champagne",
      description: "Soft warm highlights for a quieter luxury finish.",
      preview: <div className="grid h-24 grid-cols-3"><div className="bg-[#15120f]" /><div className="bg-[#c4a574]" /><div className="bg-[#f6efe4]" /></div>,
    },
    {
      value: "ivory",
      label: "Ivory",
      description: "Clean monochrome accents with minimal warmth.",
      preview: <div className="grid h-24 grid-cols-3"><div className="bg-[#111111]" /><div className="bg-[#f1ede6]" /><div className="bg-[#faf8f2]" /></div>,
    },
  ];

  const heroTextAlignOptions: VisualChoiceOption<EventGalleryBrandingSettings["heroTextAlign"]>[] = [
    {
      value: "left",
      label: "Left Align",
      description: "A more editorial layout with strong image-side balance.",
      preview: (
        <div
          className="flex h-24 items-center p-3"
          style={{ background: "linear-gradient(135deg, #0b0b0b, #2a2a2a)" }}
        >
          <div>
            <div className="h-2 w-10 rounded-full bg-neutral-600" />
            <div className="mt-3 h-3 w-24 rounded-full bg-neutral-200" />
            <div className="mt-2 h-2 w-16 rounded-full bg-neutral-500" />
          </div>
        </div>
      ),
    },
    {
      value: "center",
      label: "Centered",
      description: "More formal and statement-driven for landing pages.",
      preview: (
        <div
          className="flex h-24 items-center justify-center p-3"
          style={{ background: "linear-gradient(135deg, #0b0b0b, #2a2a2a)" }}
        >
          <div className="text-center">
            <div className="mx-auto h-2 w-10 rounded-full bg-neutral-600" />
            <div className="mx-auto mt-3 h-3 w-24 rounded-full bg-neutral-200" />
            <div className="mx-auto mt-2 h-2 w-16 rounded-full bg-neutral-500" />
          </div>
        </div>
      ),
    },
  ];

  const heroOverlayOptions: VisualChoiceOption<EventGalleryBrandingSettings["heroOverlayStrength"]>[] = [
    {
      value: "soft",
      label: "Soft",
      description: "Lighter treatment that keeps more of the cover visible.",
      preview: (
        <div
          className="h-24"
          style={{ background: "linear-gradient(135deg, rgba(15,15,15,0.4), rgba(255,255,255,0.08))" }}
        />
      ),
    },
    {
      value: "balanced",
      label: "Balanced",
      description: "The safest premium default for most event covers.",
      preview: (
        <div
          className="h-24"
          style={{ background: "linear-gradient(135deg, rgba(15,15,15,0.6), rgba(255,255,255,0.12))" }}
        />
      ),
    },
    {
      value: "dramatic",
      label: "Dramatic",
      description: "Deeper contrast for stronger type and moodier covers.",
      preview: (
        <div
          className="h-24"
          style={{ background: "linear-gradient(135deg, rgba(0,0,0,0.84), rgba(255,255,255,0.06))" }}
        />
      ),
    },
  ];


  const densityOptions: VisualChoiceOption<EventGalleryBrandingSettings["gridDensity"]>[] = [
    {
      value: "airy",
      label: "Airy",
      description: "More breathing room between photos.",
      preview: <div className="grid h-24 grid-cols-3 gap-3 bg-neutral-50 p-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="rounded-lg bg-neutral-300" />)}</div>,
    },
    {
      value: "balanced",
      label: "Balanced",
      description: "A polished middle ground for most galleries.",
      preview: <div className="grid h-24 grid-cols-3 gap-2 bg-neutral-50 p-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="rounded-lg bg-neutral-400" />)}</div>,
    },
    {
      value: "tight",
      label: "Tight",
      description: "Denser mosaic for a more energetic wall of images.",
      preview: <div className="grid h-24 grid-cols-3 gap-1 bg-neutral-50 p-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="rounded-md bg-neutral-500" />)}</div>,
    },
  ];

  const spacingOptions: VisualChoiceOption<EventGalleryBrandingSettings["imageSpacing"]>[] = densityOptions.map((option) => ({
    ...option,
    description:
      option.value === "airy"
        ? "Wider white space around each photo."
        : option.value === "balanced"
          ? "Clean spacing that still feels efficient."
          : "A more compact layout for high-volume events.",
  }));

  const photoLayoutOptions: VisualChoiceOption<EventGalleryBrandingSettings["photoLayout"]>[] = [
    {
      value: "subway",
      label: "Subway Grid",
      description: "Clean structured rows with a polished gallery wall feel.",
      preview: (
        <div className="grid h-24 grid-cols-4 gap-2 bg-neutral-50 p-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="rounded-lg bg-neutral-400" />
          ))}
        </div>
      ),
    },
    {
      value: "cascade",
      label: "Cascade Wall",
      description: "A more fluid photo fall with staggered image heights.",
      preview: (
        <div className="grid h-24 grid-cols-4 gap-2 bg-neutral-50 p-3">
          <div className="row-span-2 rounded-lg bg-neutral-700" />
          <div className="rounded-lg bg-neutral-300" />
          <div className="row-span-2 rounded-lg bg-neutral-500" />
          <div className="rounded-lg bg-neutral-300" />
          <div className="rounded-lg bg-neutral-400" />
          <div className="rounded-lg bg-neutral-500" />
        </div>
      ),
    },
    {
      value: "editorial",
      label: "Editorial Mix",
      description: "Featured hero moments mixed with a richer supporting wall.",
      preview: (
        <div className="grid h-24 grid-cols-4 gap-2 bg-neutral-50 p-3">
          <div className="col-span-2 row-span-2 rounded-lg bg-neutral-800" />
          <div className="rounded-lg bg-neutral-300" />
          <div className="rounded-lg bg-neutral-400" />
          <div className="rounded-lg bg-neutral-500" />
          <div className="rounded-lg bg-neutral-300" />
        </div>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-[#f5f5f5] px-4 py-6 md:px-8">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href={`/dashboard/projects/${projectId}`} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-neutral-900">
              <ArrowLeft size={16} />
              Back to Event
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {saveNotice ? <span className="inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-2 text-sm font-semibold text-green-700"><Check size={16} />{saveNotice}</span> : null}
            <button onClick={() => router.push(`/dashboard/projects/${projectId}`)} className="rounded-2xl border border-neutral-300 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-800 transition hover:border-neutral-500">Cancel</button>
            <button onClick={saveAsPreset} className="rounded-2xl px-5 py-2.5 text-sm font-semibold text-neutral-800 transition hover:text-[#991b1b]">Save as a Preset</button>
            <button onClick={saveAll} disabled={saving} className="rounded-2xl bg-neutral-950 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(0,0,0,0.16)] transition hover:bg-[#991b1b] disabled:opacity-60">{saving ? "Saving..." : "Save"}</button>
          </div>
        </div>

        <div className="overflow-hidden rounded-[30px] border border-neutral-200 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.06)]">
          <div className="border-b border-neutral-200 px-6 py-5 md:px-8">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-[-0.03em] text-neutral-800">{projectName || "Event Settings"}</h1>
              <button className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 text-neutral-600 hover:text-neutral-900">
                <Pencil size={14} />
              </button>
            </div>
          </div>

          <div className="grid min-h-[820px] grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="border-r border-neutral-200 bg-[#fafafa]">
              <div className="grid grid-cols-2 gap-3 border-b border-neutral-200 px-5 py-5">
                <button className="rounded-[18px] border border-[#7f1d1d] bg-neutral-950 px-4 py-5 text-center text-sm font-bold text-white shadow-[0_12px_24px_rgba(0,0,0,0.14)]">
                  <Settings2 className="mx-auto mb-2" size={26} />
                  Settings
                </button>
                <button onClick={() => router.push(`/dashboard/projects/${projectId}`)} className="rounded-[18px] px-4 py-5 text-center text-sm font-bold text-neutral-800 hover:bg-neutral-100">
                  <ImageIcon className="mx-auto mb-2" size={26} />
                  Cover
                </button>
              </div>
              <nav className="space-y-1 p-4">
                {sections.map((section) => {
                  const Icon = section.icon;
                  const active = activeSection === section.key;
                  return (
                    <button
                      key={section.key}
                      onClick={() => setActiveSection(section.key)}
                      className={cx(
                        "flex w-full items-center gap-3 rounded-[16px] px-4 py-3 text-left text-[15px] font-semibold transition",
                        active
                          ? "bg-neutral-950 text-white shadow-[0_10px_22px_rgba(0,0,0,0.14)]"
                          : "text-neutral-800 hover:bg-neutral-100"
                      )}
                    >
                      <Icon size={18} />
                      {section.label}
                    </button>
                  );
                })}
              </nav>
            </aside>

            <main className="bg-white p-6 md:p-8">
              {activeSection === "general" && (
                <div className="space-y-6">
                  <Card title="General">
                    <div className="grid gap-5 md:grid-cols-2">
                      <Field label="Shoot Date*" hint="The date of the photo session or event">
                        <input type="date" value={shootDate} onChange={(e) => setShootDate(e.target.value)} className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400" />
                      </Field>
                      <Field label="Project/Event Name">
                        <input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400" />
                      </Field>
                      <Field label="Order Due Date" hint="Optional date on which client orders are due">
                        <input type="date" value={orderDueDate} onChange={(e) => setOrderDueDate(e.target.value)} className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400" />
                      </Field>
                      <Field label="Gallery Expiration Date" hint="Optional date the gallery becomes inactive">
                        <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400" />
                      </Field>
                    </div>
                    <Field label="Gallery Language" hint="Choose the language for your gallery interface">
                      <div className="relative max-w-md">
                        <select value={galleryLanguage} onChange={(e) => setGalleryLanguage(e.target.value)} className="w-full appearance-none rounded-xl border border-neutral-200 bg-white px-4 py-3 pr-10 text-sm text-neutral-700">
                          <option>English (US)</option>
                          <option>English (CA)</option>
                          <option>French</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-neutral-600" size={18} />
                      </div>
                    </Field>
                    <ToggleRow title="Allow Social Sharing" description="Show a social share message on the gallery" checked={extras.allowSocialSharing} onChange={(next) => setExtra("allowSocialSharing", next)} />
                    {extras.allowSocialSharing ? (
                      <textarea value={extras.socialShareMessage} onChange={(e) => setExtra("socialShareMessage", e.target.value)} className="min-h-[110px] w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400" placeholder="Check out the photos from this gallery!" />
                    ) : null}
                    <ToggleRow title="Allow Black & White Filtering" description="Clients may view and order black and white versions of your photos" checked={extras.allowBlackWhiteFiltering} onChange={(next) => setExtra("allowBlackWhiteFiltering", next)} />
                  </Card>
                </div>
              )}

              {activeSection === "branding" && (
                <div className="space-y-8">
                  {/* Live Preview */}
                  <BrandPreview branding={branding} projectName={projectName || "Event Gallery"} />

                  {/* Style */}
                  <Card title="Style" description="Set the visual tone of your gallery.">
                    <div className="grid gap-6 lg:grid-cols-2">
                      <BackgroundModePicker
                        value={branding.backgroundMode}
                        onChange={(next) => setBrandingField("backgroundMode", next)}
                      />
                      <FontDropdown
                        value={branding.fontPreset}
                        onChange={(next) => setBrandingField("fontPreset", next)}
                      />
                    </div>

                    <div className="mt-2 grid gap-5 sm:grid-cols-3">
                      <div>
                        <div className="mb-2 text-[13px] font-semibold text-neutral-800">Theme</div>
                        <div className="relative">
                          <select
                            value={branding.themePreset}
                            onChange={(e) => setBrandingField("themePreset", e.target.value as EventGalleryBrandingSettings["themePreset"])}
                            className="w-full appearance-none rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 pr-10 text-sm text-neutral-800"
                          >
                            {themeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-4 text-neutral-400" />
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 text-[13px] font-semibold text-neutral-800">Tone</div>
                        <div className="relative">
                          <select
                            value={branding.tone}
                            onChange={(e) => setBrandingField("tone", e.target.value as EventGalleryBrandingSettings["tone"])}
                            className="w-full appearance-none rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 pr-10 text-sm text-neutral-800"
                          >
                            {toneOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-4 text-neutral-400" />
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 text-[13px] font-semibold text-neutral-800">Accent</div>
                        <div className="relative">
                          <select
                            value={branding.accentColor}
                            onChange={(e) => setBrandingField("accentColor", e.target.value as EventGalleryBrandingSettings["accentColor"])}
                            className="w-full appearance-none rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 pr-10 text-sm text-neutral-800"
                          >
                            {accentOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-4 text-neutral-400" />
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* Layout */}
                  <Card title="Gallery Layout" description="Control how photos are arranged.">
                    <VisualChoiceGrid
                      title="Photo Wall Style"
                      value={branding.photoLayout}
                      options={photoLayoutOptions}
                      onChange={(next) => setBrandingField("photoLayout", next)}
                    />
                    <VisualChoiceGrid
                      title="Grid Density"
                      value={branding.gridDensity}
                      options={densityOptions}
                      onChange={(next) => setBrandingField("gridDensity", next)}
                    />
                    <VisualChoiceGrid
                      title="Image Spacing"
                      value={branding.imageSpacing}
                      options={spacingOptions}
                      onChange={(next) => setBrandingField("imageSpacing", next)}
                    />
                    <ToggleRow
                      title="Show Hero Header"
                      description="Display a large cover section at the top of the gallery."
                      checked={branding.showHeroHeader}
                      onChange={(next) => setBrandingField("showHeroHeader", next)}
                    />
                    {branding.showHeroHeader && (
                      <div className="grid gap-5 sm:grid-cols-2">
                        <div>
                          <div className="mb-2 text-[13px] font-semibold text-neutral-800">Text Alignment</div>
                          <div className="relative">
                            <select
                              value={branding.heroTextAlign}
                              onChange={(e) => setBrandingField("heroTextAlign", e.target.value as EventGalleryBrandingSettings["heroTextAlign"])}
                              className="w-full appearance-none rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 pr-10 text-sm text-neutral-800"
                            >
                              {heroTextAlignOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-4 text-neutral-400" />
                          </div>
                        </div>
                        <div>
                          <div className="mb-2 text-[13px] font-semibold text-neutral-800">Overlay Strength</div>
                          <div className="relative">
                            <select
                              value={branding.heroOverlayStrength}
                              onChange={(e) => setBrandingField("heroOverlayStrength", e.target.value as EventGalleryBrandingSettings["heroOverlayStrength"])}
                              className="w-full appearance-none rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 pr-10 text-sm text-neutral-800"
                            >
                              {heroOverlayOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-4 text-neutral-400" />
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>

                  {/* Intro Experience */}
                  <Card title="Intro Page" description="The first thing clients see before entering the gallery.">
                    <ToggleRow
                      title="Show Intro Page"
                      description="Present a full-screen welcome page before the photo gallery opens."
                      checked={branding.introEnabled}
                      onChange={(next) => setBrandingField("introEnabled", next)}
                    />
                    {branding.introEnabled && (
                      <>
                        <div>
                          <div className="mb-2 text-[13px] font-semibold text-neutral-800">Intro Layout</div>
                          <div className="relative">
                            <select
                              value={branding.introLayout}
                              onChange={(e) => setBrandingField("introLayout", e.target.value as EventGalleryBrandingSettings["introLayout"])}
                              className="w-full appearance-none rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 pr-10 text-sm text-neutral-800"
                            >
                              {introLayoutOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <ChevronDown size={15} className="pointer-events-none absolute right-3.5 top-4 text-neutral-400" />
                          </div>
                        </div>
                        <Field label="Intro Headline" hint="Leave blank to use the event name.">
                          <input
                            value={branding.introHeadline}
                            onChange={(e) => setBrandingField("introHeadline", e.target.value)}
                            className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400"
                            placeholder="A private gallery for your event"
                          />
                        </Field>
                        <Field label="Intro Message">
                          <textarea
                            value={branding.introMessage}
                            onChange={(e) => setBrandingField("introMessage", e.target.value)}
                            className="min-h-[90px] w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400"
                            placeholder="Welcome message or ordering notes."
                          />
                        </Field>
                        <Field label="Enter Button Label">
                          <input
                            value={branding.introCtaLabel}
                            onChange={(e) => setBrandingField("introCtaLabel", e.target.value)}
                            className="w-full max-w-xs rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400"
                            placeholder="Enter Gallery"
                          />
                        </Field>
                        <ToggleRow
                          title="Show Studio Mark"
                          description="Display the studio logo or business name on the intro page."
                          checked={branding.showStudioMark}
                          onChange={(next) => setBrandingField("showStudioMark", next)}
                        />
                        <ToggleRow
                          title="Use Event Cover on Intro"
                          description="Use the event cover image as the intro background."
                          checked={branding.useCoverAsIntro}
                          onChange={(next) => setBrandingField("useCoverAsIntro", next)}
                        />
                      </>
                    )}
                  </Card>

                  {/* Marketing Banner */}
                  <Card title="Marketing Banner" description="Promote an offer at the top of the gallery.">
                    <ToggleRow
                      title="Enable Banner"
                      description="Show a subtle banner across the top of the client gallery."
                      checked={branding.marketingBannerEnabled}
                      onChange={(next) => setBrandingField("marketingBannerEnabled", next)}
                    />
                    {branding.marketingBannerEnabled && (
                      <div className="grid gap-4">
                        <Field label="Banner Message">
                          <textarea
                            value={branding.marketingBannerText}
                            onChange={(e) => setBrandingField("marketingBannerText", e.target.value)}
                            className="min-h-[80px] w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400"
                            placeholder="Complimentary shipping on framed prints through Sunday."
                          />
                        </Field>
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field label="Link Label">
                            <input
                              value={branding.marketingBannerLinkLabel}
                              onChange={(e) => setBrandingField("marketingBannerLinkLabel", e.target.value)}
                              className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400"
                              placeholder="View Offer"
                            />
                          </Field>
                          <Field label="Link URL">
                            <input
                              value={branding.marketingBannerLinkUrl}
                              onChange={(e) => setBrandingField("marketingBannerLinkUrl", e.target.value)}
                              className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400"
                              placeholder="https://example.com"
                            />
                          </Field>
                        </div>
                      </div>
                    )}
                  </Card>
                </div>
              )}

              {activeSection === "privacy" && (
                <div className="space-y-6">
                  <Card title="Access & Privacy">
                    <div>
                      <div className="mb-3 text-[13px] font-semibold text-neutral-800">Status</div>
                      <div className="space-y-4">
                        {statusOptions.map((option) => (
                          <label key={option.value} className="flex items-start gap-3 rounded-2xl border border-neutral-200 px-4 py-4">
                            <input type="radio" checked={portalStatus === option.value} onChange={() => setPortalStatus(option.value)} className="mt-1 h-5 w-5" />
                            <div>
                              <div className="text-[15px] font-semibold text-neutral-900">{option.label}</div>
                              <div className="mt-1 text-sm text-neutral-600">
                                {option.value === "active" && "Active galleries are live and viewable."}
                                {option.value === "inactive" && "Inactive galleries are not live and are not viewable."}
                                {option.value === "pre_release" && "Collect visitor emails before the gallery is active."}
                                {option.value === "closed" && "Gallery remains visible but ordering is closed."}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-3 text-[13px] font-semibold text-neutral-800">Gallery Access</div>
                      <div className="space-y-4">
                        <label className="flex items-start gap-3 rounded-2xl border border-neutral-200 px-4 py-4">
                          <input type="radio" checked={projectAccessMode === "public"} onChange={() => setProjectAccessMode("public")} className="mt-1 h-5 w-5" />
                          <div>
                            <div className="text-[15px] font-semibold text-neutral-900">Public</div>
                            <div className="mt-1 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">Anyone with the link can open this gallery unless an album uses its own PIN.</div>
                          </div>
                        </label>
                        <label className="flex items-start gap-3 rounded-2xl border border-neutral-200 px-4 py-4">
                          <input type="radio" checked={projectAccessMode === "pin"} onChange={() => setProjectAccessMode("pin")} className="mt-1 h-5 w-5" />
                          <div>
                            <div className="text-[15px] font-semibold text-neutral-900">Project PIN</div>
                            <div className="mt-1 text-sm text-neutral-600">Clients must enter this PIN before opening the project.</div>
                          </div>
                        </label>
                      </div>
                    </div>

                    {projectAccessMode === "pin" ? <input value={projectPin} onChange={(e) => setProjectPin(e.target.value)} className="max-w-md rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400" placeholder="Project PIN" /> : null}
                    <ToggleRow title="Email required" description="Require visitors to enter their email address to view the gallery" checked={emailRequired} onChange={setEmailRequired} />
                    <Field label="Client Email Capture Foundation" hint="This does not gate entry yet. It defines how this event should be prepared for future capture workflows.">
                      <div className="relative max-w-md">
                        <select value={extras.emailCaptureMode} onChange={(e) => setExtra("emailCaptureMode", e.target.value as EventGalleryExtraSettings["emailCaptureMode"])} className="w-full appearance-none rounded-xl border border-neutral-200 bg-white px-4 py-3 pr-10 text-sm text-neutral-700">
                          <option value="off">Off</option>
                          <option value="optional">Optional capture</option>
                          <option value="required">Required before entry</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-neutral-600" size={18} />
                      </div>
                    </Field>
                  </Card>
                </div>
              )}

              {activeSection === "free-digital" && (
                <div className="space-y-6">
                  <Card title="Free Digitals/Downloads" description="Rules allow you to customize who gets to download photos for free.">
                    <div className="overflow-hidden rounded-2xl border border-neutral-200">
                      <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] bg-neutral-50 px-5 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-600">
                        <div>Rule Name</div>
                        <div>Level</div>
                        <div>Downloads</div>
                        <div>Resolution</div>
                      </div>
                      <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] px-5 py-4 text-sm text-neutral-800">
                        <div>
                          {extras.freeDigitalRuleEnabled
                            ? extras.freeDigitalAudience === "person"
                              ? extras.freeDigitalTargetName ||
                                extras.freeDigitalTargetEmail ||
                                "Specific person"
                              : "Free download rule"
                            : "No active rule"}
                        </div>
                        <div>{extras.freeDigitalAudience === "gallery" ? "Gallery" : extras.freeDigitalAudience === "album" ? "Album" : "Person"}</div>
                        <div>{extras.freeDigitalDownloadLimit === "unlimited" ? "Unlimited" : extras.freeDigitalDownloadLimit}</div>
                        <div>{extras.freeDigitalResolution === "original" ? "Original" : extras.freeDigitalResolution === "large" ? "Large" : "Web"}</div>
                      </div>
                    </div>

                    <ToggleRow title="Enable free digital rule" description="Create a downloadable rule for this gallery or album." checked={extras.freeDigitalRuleEnabled} onChange={(next) => setExtra("freeDigitalRuleEnabled", next)} />
                    {extras.freeDigitalRuleEnabled ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Who should be able to download photos for free?">
                          <select value={extras.freeDigitalAudience} onChange={(e) => setExtra("freeDigitalAudience", e.target.value as EventGalleryExtraSettings["freeDigitalAudience"])} className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400">
                            <option value="gallery">All visitors to this gallery</option>
                            <option value="album">Visitors to a specific album</option>
                            <option value="person">One specific person</option>
                          </select>
                        </Field>
                        <Field label="What size files should be delivered?">
                          <select value={extras.freeDigitalResolution} onChange={(e) => setExtra("freeDigitalResolution", e.target.value as EventGalleryExtraSettings["freeDigitalResolution"])} className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400">
                            <option value="original">Original</option>
                            <option value="large">Large</option>
                            <option value="web">Web</option>
                          </select>
                        </Field>
                        <Field label="How many photos can each visitor download?">
                          <select value={extras.freeDigitalDownloadLimit} onChange={(e) => setExtra("freeDigitalDownloadLimit", e.target.value as EventGalleryExtraSettings["freeDigitalDownloadLimit"])} className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400">
                            <option value="unlimited">Unlimited</option>
                            <option value="10">10</option>
                            <option value="5">5</option>
                            <option value="1">1</option>
                          </select>
                        </Field>
                        {extras.freeDigitalAudience === "person" ? (
                          <>
                            <Field label="Approved person's name (optional)">
                              <input
                                value={extras.freeDigitalTargetName}
                                onChange={(e) =>
                                  setExtra("freeDigitalTargetName", e.target.value)
                                }
                                className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400"
                                placeholder="Ex. Harout"
                              />
                            </Field>
                            <Field label="Approved person's email">
                              <input
                                list="free-digital-person-choices"
                                value={extras.freeDigitalTargetEmail}
                                onChange={(e) =>
                                  setExtra("freeDigitalTargetEmail", e.target.value)
                                }
                                className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400"
                                placeholder="name@example.com"
                              />
                              <datalist id="free-digital-person-choices">
                                {linkedContacts.map((contact) => (
                                  <option
                                    key={contact.id}
                                    value={contact.email}
                                    label={contact.name || contact.role || contact.email}
                                  />
                                ))}
                              </datalist>
                              <div className="mt-2 text-xs text-neutral-500">
                                Only this invited person/email will be able to use the free download rule.
                              </div>
                            </Field>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    <ToggleRow title='Show "Download All" button in gallery' checked={extras.showDownloadAllButton} onChange={(next) => setExtra("showDownloadAllButton", next)} />
                    {extras.showDownloadAllButton ? (
                      <>
                        <ToggleRow
                          title='Require a separate PIN for "Download All"'
                          description="Add an extra PIN gate just for full-gallery downloads."
                          checked={extras.downloadPinEnabled}
                          onChange={(next) => setExtra("downloadPinEnabled", next)}
                        />
                        {extras.downloadPinEnabled ? (
                          <Field
                            label='Download All PIN'
                            hint="Clients will need this extra PIN when they click Download All."
                          >
                            <input
                              value={extras.downloadPin}
                              onChange={(e) => setExtra("downloadPin", e.target.value)}
                              className="max-w-md rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400"
                              placeholder="Set a download PIN"
                            />
                          </Field>
                        ) : null}
                      </>
                    ) : null}
                    <ToggleRow title="Allow clients to download their favorites" description='Show a "Download Favorites" button on the client Favorites tab.' checked={extras.allowClientFavoriteDownloads} onChange={(next) => setExtra("allowClientFavoriteDownloads", next)} />
                    {extras.allowClientFavoriteDownloads ? (
                      <ToggleRow title='Require a paid "All Digitals" order first' description="Only unlock favorite downloads after this visitor has purchased the gallery's full digital set." checked={extras.favoriteDownloadsRequireAllDigitalsPurchase} onChange={(next) => setExtra("favoriteDownloadsRequireAllDigitalsPurchase", next)} />
                    ) : null}
                    <ToggleRow title="Apply a watermark to the downloaded files" checked={extras.watermarkDownloads} onChange={(next) => setExtra("watermarkDownloads", next)} />
                    <ToggleRow title="Include a Print Release" checked={extras.includePrintRelease} onChange={(next) => setExtra("includePrintRelease", next)} />
                  </Card>
                </div>
              )}

              {activeSection === "store" && (
                <div className="space-y-6">
                  <Card title="Shopping Cart/Store" description="Allow clients to place orders in the gallery.">
                    <Field label="Price Sheet">
                      <div className="relative max-w-md">
                        <select value={packageProfileId} onChange={(e) => setPackageProfileId(e.target.value)} className="w-full appearance-none rounded-xl border border-neutral-200 bg-white px-4 py-3 pr-10 text-sm text-neutral-700">
                          <option value="">Choose price sheet</option>
                          {packageProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>{profile.profile_name || profile.name || profile.id}</option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-neutral-600" size={18} />
                      </div>
                      {packageProfiles.length === 0 ? (
                        <div className="mt-2 text-sm text-neutral-600">
                          No price sheets found yet. Create one in{" "}
                          <Link href="/dashboard/packages" className="font-semibold text-neutral-900 underline underline-offset-4">
                            Price Sheets
                          </Link>
                          , then come back here to assign it to this event.
                        </div>
                      ) : null}
                    </Field>
                    <Field label="Minimum Order Amount (optional)" hint="Set a minimum order amount for this gallery">
                      <input value={extras.minimumOrderAmount} onChange={(e) => setExtra("minimumOrderAmount", e.target.value)} className="max-w-md rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400" placeholder="ex. $20.00" />
                    </Field>
                    <ToggleRow title="Allow Cropping" description="Clients may crop photos on orders" checked={extras.allowCropping} onChange={(next) => setExtra("allowCropping", next)} />
                    <ToggleRow title="Enable Store" description="Allow your clients to shop by product first" checked={extras.enableStore} onChange={(next) => setExtra("enableStore", next)} />
                    <ToggleRow title="Enable Abandoned Cart Email" description="Automatically send a reminder email to clients who abandon their shopping carts" checked={extras.enableAbandonedCartEmail} onChange={(next) => setExtra("enableAbandonedCartEmail", next)} />
                    <ToggleRow title="Show Buy All Button" checked={extras.showBuyAllButton} onChange={(next) => setExtra("showBuyAllButton", next)} />
                    <ToggleRow title="Offer Packages Only" description="Hide a la carte items and allow clients to only purchase packages" checked={extras.offerPackagesOnly} onChange={(next) => setExtra("offerPackagesOnly", next)} />
                    <ToggleRow title="Allow Client to Pay Later" checked={extras.allowClientToPayLater} onChange={(next) => setExtra("allowClientToPayLater", next)} />
                    <ToggleRow title="Allow Client to Comment on Items in Cart" checked={extras.allowClientComments} onChange={(next) => setExtra("allowClientComments", next)} />
                  </Card>
                </div>
              )}

              {activeSection === "advanced" && (
                <div className="space-y-6">
                  <Card title="Advanced" description="Configure your advanced settings.">
                    <ToggleRow title='Hide the "All Photos" Album' description="Show only the albums you've created" checked={extras.hideAllPhotosAlbum} onChange={(next) => setExtra("hideAllPhotosAlbum", next)} />
                    <ToggleRow title="Hide Album Photo Count" description="On the main gallery view, hide the photo count for each album" checked={extras.hideAlbumPhotoCount} onChange={(next) => setExtra("hideAlbumPhotoCount", next)} />
                    <ToggleRow title="Automatically Send Gallery to Archive After Expiration" description="Archiving frees up space after the expiration date." checked={extras.autoArchiveAfterExpiration} onChange={(next) => setExtra("autoArchiveAfterExpiration", next)} />
                    <ToggleRow title="Send Email Campaign" description="Automatically send emails to your clients and gallery visitors" checked={extras.sendEmailCampaign} onChange={(next) => setExtra("sendEmailCampaign", next)} />
                    <ToggleRow title="Set Album Cover Images automatically" description="During upload, allow the system to select a photo as the album cover" checked={extras.autoChooseAlbumCover} onChange={(next) => setExtra("autoChooseAlbumCover", next)} />
                    <ToggleRow title="Set Project/Event Cover automatically" description="During upload, allow the system to select a photo as the event cover" checked={extras.autoChooseProjectCover} onChange={(next) => setExtra("autoChooseProjectCover", next)} />
                    <Field label="Automatic cover source">
                      <div className="relative max-w-md">
                        <select value={extras.coverSource} onChange={(e) => setExtra("coverSource", e.target.value as EventGalleryExtraSettings["coverSource"])} className="w-full appearance-none rounded-xl border border-neutral-200 bg-white px-4 py-3 pr-10 text-sm text-neutral-700">
                          <option value="first_valid">First valid photo</option>
                          <option value="newest">Newest photo</option>
                          <option value="oldest">Oldest photo</option>
                          <option value="manual">Manual only</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-neutral-600" size={18} />
                      </div>
                    </Field>
                    <Field label="Internal Notes">
                      <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} className="min-h-[120px] w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400" placeholder="Private notes for studio workflow" />
                    </Field>
                  </Card>

                  <Card title="Future Event Foundation" description="Prepare this event for later live feeds, guest scans, instant uploads, and notification workflows without changing the current gallery behavior.">
                    <ToggleRow
                      title="Live Event Mode Foundation"
                      description="Expose live-mode readiness on the client landing page and preserve a clean extension point for real-time feeds later."
                      checked={extras.liveGalleryMode}
                      onChange={(next) => setExtra("liveGalleryMode", next)}
                    />
                    <Field label="Guest Identification Mode">
                      <div className="relative max-w-md">
                        <select value={extras.guestIdentificationMode} onChange={(e) => setExtra("guestIdentificationMode", e.target.value as EventGalleryExtraSettings["guestIdentificationMode"])} className="w-full appearance-none rounded-xl border border-neutral-200 bg-white px-4 py-3 pr-10 text-sm text-neutral-700">
                          <option value="none">Standard event access</option>
                          <option value="qr">QR guest mode foundation</option>
                          <option value="barcode">Barcode guest mode foundation</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-neutral-600" size={18} />
                      </div>
                    </Field>
                    <ToggleRow
                      title="Instant Upload Feed Foundation"
                      description="Reserve this event for near real-time image appearance and live wall updates later."
                      checked={extras.instantPhotoDelivery}
                      onChange={(next) => setExtra("instantPhotoDelivery", next)}
                    />
                    <ToggleRow
                      title="Order Notification Hooks"
                      description="Mark the event ready for downstream push, Apple Watch, or order alert integrations later."
                      checked={extras.orderNotificationHooks}
                      onChange={(next) => setExtra("orderNotificationHooks", next)}
                    />
                  </Card>

                  <Card title="Cover shortcuts" description="Quick links to cover selection tools for this project and its albums.">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Link href={`/dashboard/projects/${projectId}`} className="flex items-center justify-between rounded-2xl border border-neutral-200 px-4 py-4 text-sm font-semibold text-neutral-900 hover:bg-neutral-50">
                        <div className="flex items-center gap-3"><ImageIcon size={18} />Choose project cover</div>
                        <ArrowLeft className="rotate-180" size={16} />
                      </Link>
                      <Link href={`/dashboard/projects/${projectId}`} className="flex items-center justify-between rounded-2xl border border-neutral-200 px-4 py-4 text-sm font-semibold text-neutral-900 hover:bg-neutral-50">
                        <div className="flex items-center gap-3"><FolderOpen size={18} />Open album manager</div>
                        <ArrowLeft className="rotate-180" size={16} />
                      </Link>
                    </div>
                  </Card>
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
