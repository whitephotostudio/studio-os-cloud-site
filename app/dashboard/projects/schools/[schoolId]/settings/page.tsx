"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  defaultEventGallerySettings,
  normalizeEventGallerySettings,
  type EventGallerySettings,
  type EventGalleryExtraSettings,
} from "@/lib/event-gallery-settings";
import { resolvePackageProfileId } from "@/lib/package-profile-selection";
import { WhatsNewDot } from "@/components/whats-new-dot";

type SchoolRow = {
  school_name?: string | null;
  photographer_id?: string | null;
  status?: string | null;
  shoot_date?: string | null;
  order_due_date?: string | null;
  expiration_date?: string | null;
  archive_date?: string | null;
  package_profile_id?: string | null;
  email_required?: boolean | null;
  checkout_contact_required?: boolean | null;
  internal_notes?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  gallery_settings?: unknown;
  screenshot_protection_desktop?: boolean | null;
  screenshot_protection_mobile?: boolean | null;
  screenshot_protection_watermark?: boolean | null;
  group_label_singular?: string | null;
  group_label_plural?: string | null;
};
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
type GalleryPreset = {
  id: string;
  name: string;
  createdAt: string;
  values: {
    galleryLanguage: string;
    portalStatus: string;
    checkoutContactRequired: boolean;
    packageProfileId: string;
    extras: ExtraSettings;
  };
};

type ExtraSettings = EventGalleryExtraSettings;

const defaultExtras: ExtraSettings = {
  ...defaultEventGallerySettings.extras,
};

const sections = [
  { key: "general", label: "General", icon: Settings2 },
  { key: "privacy", label: "Access & Privacy", icon: ShieldCheck },
  { key: "free-digital", label: "Free Digitals", icon: Download },
  { key: "store", label: "Shopping Cart/Store", icon: ShoppingCart },
  { key: "advanced", label: "Advanced", icon: Sparkles },
] as const;

type SectionKey = (typeof sections)[number]["key"];

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const fieldClass =
  "w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-[#b91c1c] focus:outline-none focus:ring-2 focus:ring-[#fecaca]";

const selectClass =
  "w-full appearance-none rounded-xl border border-neutral-300 bg-white px-4 py-3 pr-10 text-sm text-neutral-900 focus:border-[#b91c1c] focus:outline-none focus:ring-2 focus:ring-[#fecaca]";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition",
        checked ? "border-[#111111] bg-[#111111]" : "border-neutral-300 bg-neutral-200"
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
    <div className="rounded-[24px] border border-neutral-200 bg-white p-6 shadow-[0_8px_30px_rgba(17,17,17,0.05)]">
      <h3 className="text-[15px] font-semibold text-neutral-900">{title}</h3>
      {description ? <p className="mt-1 text-sm text-neutral-600">{description}</p> : null}
      <div className="mt-5 space-y-5">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
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

export default function SchoolSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const params = useParams();
  const router = useRouter();
  const schoolId = String(params.schoolId ?? "");

  const [activeSection, setActiveSection] = useState<SectionKey>("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [packageProfiles, setPackageProfiles] = useState<PackageProfileRow[]>([]);

  const [schoolName, setSchoolName] = useState("");
  const [portalStatus, setPortalStatus] = useState("inactive");
  const [shootDate, setShootDate] = useState("");
  const [orderDueDate, setOrderDueDate] = useState("");
  // archive_date — when set, the parents-portal "Older photos" tab shows
  // urgency copy ("Archived May 31 — last chance") for this school.
  const [archiveDate, setArchiveDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [galleryLanguage, setGalleryLanguage] = useState("English (US)");
  const [packageProfileId, setPackageProfileId] = useState("");
  const [checkoutContactRequired, setCheckoutContactRequired] = useState(false);
  const [internalNotes, setInternalNotes] = useState("");
  const [extras, setExtras] = useState<ExtraSettings>(defaultExtras);
  const [fullGallerySettings, setFullGallerySettings] = useState<EventGallerySettings>(
    defaultEventGallerySettings,
  );
  const [photographerPlan, setPhotographerPlan] = useState<string>("");

  // Screenshot protection toggles (parents portal only).
  const [protectDesktop, setProtectDesktop] = useState(false);
  const [protectMobile, setProtectMobile] = useState(false);
  const [protectWatermark, setProtectWatermark] = useState(false);

  // 2026-04-26: Per-school grouping label.  Some studios shoot
  // universities ("Faculty"), elementary ("Grade"), or corporate
  // ("Department") — defaults to Class / Classes for K-12.
  const [groupLabelSingular, setGroupLabelSingular] = useState("Class");
  const [groupLabelPlural, setGroupLabelPlural] = useState("Classes");

  const storageKey = `studioos_school_settings_${schoolId}`;

  const loadAll = useCallback(async () => {
    setLoading(true);

    const [{ data: schoolData }] = await Promise.all([
      supabase.from("schools").select("*").eq("id", schoolId).maybeSingle(),
    ]);

    let nextPackageProfiles: PackageProfileRow[] = [];
    let nextPackageProfilePackages: PackageProfilePackageRow[] = [];

    if (schoolData?.photographer_id) {
      const [profileResult, packagesResult] = await Promise.all([
        supabase
          .from("package_profiles")
          .select("id,name,photographer_id,created_at")
          .eq("photographer_id", schoolData.photographer_id)
          .order("created_at", { ascending: false }),
        supabase
          .from("packages")
          .select("profile_id,profile_name")
          .eq("photographer_id", schoolData.photographer_id)
          .order("profile_name"),
      ]);

      const rawProfiles = (profileResult.data ?? []) as PackageProfileRow[];
      const rawPackages = (packagesResult.data ?? []) as PackageProfilePackageRow[];
      nextPackageProfilePackages = rawPackages;
      const seenProfileIds = new Set(rawProfiles.map((profile) => profile.id).filter(Boolean));

      nextPackageProfiles = [...rawProfiles];

      for (const pkg of rawPackages) {
        const profileId = (pkg.profile_id ?? "").trim();
        if (!profileId || seenProfileIds.has(profileId)) continue;
        seenProfileIds.add(profileId);
        nextPackageProfiles.push({
          id: profileId,
          name: pkg.profile_name ?? profileId,
          profile_name: pkg.profile_name ?? profileId,
          photographer_id: schoolData.photographer_id,
          created_at: null,
        });
      }

      // Fetch photographer plan
      const { data: pgRow } = await supabase
        .from("photographers")
        .select("subscription_plan_code")
        .eq("id", schoolData.photographer_id)
        .maybeSingle();
      setPhotographerPlan((pgRow as Record<string, unknown> | null)?.subscription_plan_code as string || "");
    }

    if (schoolData) {
      const storedSettings = normalizeEventGallerySettings(schoolData.gallery_settings);
      setSchoolName(schoolData.school_name || "");
      setPortalStatus(schoolData.status || "inactive");
      setShootDate(schoolData.shoot_date || "");
      setOrderDueDate(schoolData.order_due_date || "");
      setArchiveDate(((schoolData as { archive_date?: string | null }).archive_date as string | null) || "");
      setExpirationDate(schoolData.expiration_date || "");
      setPackageProfileId(
        resolvePackageProfileId({
          selectedProfileId:
            schoolData.package_profile_id || storedSettings.extras.priceSheetProfileId,
          packageProfiles: nextPackageProfiles,
          packages: nextPackageProfilePackages,
        }) || "",
      );
      setCheckoutContactRequired(Boolean(schoolData.checkout_contact_required));
      setInternalNotes(schoolData.internal_notes || "");
      setProtectDesktop(Boolean(schoolData.screenshot_protection_desktop));
      setProtectMobile(Boolean(schoolData.screenshot_protection_mobile));
      setProtectWatermark(Boolean(schoolData.screenshot_protection_watermark));
      setGroupLabelSingular(
        (schoolData.group_label_singular || "").trim() || "Class",
      );
      setGroupLabelPlural(
        (schoolData.group_label_plural || "").trim() || "Classes",
      );
      setFullGallerySettings(storedSettings);
      setGalleryLanguage(storedSettings.galleryLanguage);
      setExtras({
        ...defaultExtras,
        ...storedSettings.extras,
      });
    }

    setPackageProfiles(nextPackageProfiles);

    if (!schoolData?.gallery_settings) {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<ExtraSettings> & { galleryLanguage?: string };
          setExtras({ ...defaultExtras, ...parsed });
          if (parsed.galleryLanguage) setGalleryLanguage(parsed.galleryLanguage);
          setFullGallerySettings((prev) => ({
            ...prev,
            galleryLanguage: parsed.galleryLanguage || prev.galleryLanguage,
            extras: { ...prev.extras, ...parsed },
          }));
        }
      } catch {}
    }

    setLoading(false);
  }, [schoolId, storageKey, supabase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAll();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadAll]);

  function setExtra<K extends keyof ExtraSettings>(key: K, value: ExtraSettings[K]) {
    setExtras((prev) => ({ ...prev, [key]: value }));
  }

  async function saveAll() {
    setSaving(true);
    setSaveNotice(null);

    const nextGallerySettings: EventGallerySettings = {
      ...fullGallerySettings,
      galleryLanguage,
      extras: {
        ...fullGallerySettings.extras,
        ...extras,
        priceSheetProfileId: packageProfileId || "",
      },
    };

    const payload: Partial<SchoolRow> = {
      school_name: schoolName || null,
      status: portalStatus || null,
      shoot_date: shootDate || null,
      order_due_date: orderDueDate || null,
      archive_date: archiveDate || null,
      expiration_date: expirationDate || null,
      package_profile_id: packageProfileId || null,
      email_required: true,
      checkout_contact_required: checkoutContactRequired,
      internal_notes: internalNotes || null,
      gallery_settings: nextGallerySettings,
      screenshot_protection_desktop: protectDesktop,
      screenshot_protection_mobile: protectMobile,
      screenshot_protection_watermark: protectWatermark,
      group_label_singular: groupLabelSingular.trim() || "Class",
      group_label_plural: groupLabelPlural.trim() || "Classes",
    };

    try {
      const response = await fetch(`/api/dashboard/schools/${schoolId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const rawResult = await response.text();
      let result = {} as {
        ok?: boolean;
        message?: string;
        emailSummary?: {
          attempted: number;
          sent: number;
          failed: number;
          warning?: string | null;
          type?: "campaign" | "gallery_release";
        } | null;
      };
      if (rawResult) {
        try {
          result = JSON.parse(rawResult) as typeof result;
        } catch {
          result = {};
        }
      }

      if (!response.ok || result.ok === false) {
        const fallbackMessage =
          rawResult && !rawResult.trim().startsWith("<")
            ? rawResult.trim()
            : "Failed to save school settings.";
        throw new Error(result.message || fallbackMessage);
      }

      setFullGallerySettings(nextGallerySettings);
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            ...extras,
            galleryLanguage,
            portalStatus,
            checkoutContactRequired,
            shootDate,
            orderDueDate,
            expirationDate,
            internalNotes,
          })
        );
      } catch {}
      if (result.emailSummary?.warning) {
        setSaveNotice(`Saved · ${result.emailSummary.warning}`);
      } else if (result.emailSummary && result.emailSummary.attempted > 0) {
        setSaveNotice(
          `Saved · ${result.emailSummary.sent} email${result.emailSummary.sent === 1 ? "" : "s"} sent`,
        );
      } else if (result.emailSummary && result.emailSummary.attempted === 0) {
        setSaveNotice("Saved · No campaign recipients yet");
      } else {
        setSaveNotice("Saved");
      }
      setTimeout(() => setSaveNotice(null), 2500);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to save school settings.");
    }

    setSaving(false);
  }

  function saveAsPreset() {
    const name = window.prompt("Preset name");
    if (!name) return;
    try {
      const key = "studioos_gallery_presets";
      const current = JSON.parse(window.localStorage.getItem(key) || "[]") as GalleryPreset[];
      current.push({
        id: crypto.randomUUID(),
        name,
        createdAt: new Date().toISOString(),
        values: {
          galleryLanguage,
          portalStatus,
          checkoutContactRequired,
          packageProfileId,
          extras,
        },
      });
      window.localStorage.setItem(key, JSON.stringify(current));
      setSaveNotice(`Preset "${name}" saved`);
      setTimeout(() => setSaveNotice(null), 2500);
    } catch {
      alert("Unable to save preset on this browser.");
    }
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f5f5f5] text-sm text-neutral-600">Loading settings...</div>;
  }

  const statusOptions = [
    { value: "active", label: "Active" },
    { value: "inactive", label: "Inactive" },
    { value: "pre_release", label: "Pre-Release" },
    { value: "closed", label: "Closed" },
  ];

  return (
    <div className="min-h-screen bg-[#f5f5f5] px-4 py-6 md:px-8">
      <div className="mx-auto max-w-[1500px]">
        {/* Top bar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href={`/dashboard/projects/schools/${schoolId}`} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-600 hover:text-neutral-900">
              <ArrowLeft size={16} />
              Back to School
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {saveNotice ? <span className="inline-flex items-center gap-2 rounded-full border border-[#fecaca] bg-[#fff5f5] px-3 py-2 text-sm font-semibold text-[#b91c1c]"><Check size={16} />{saveNotice}</span> : null}
            <button onClick={() => router.push(`/dashboard/projects/schools/${schoolId}`)} className="rounded-2xl border border-neutral-300 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:border-neutral-400 hover:bg-neutral-50">Cancel</button>
            <button onClick={saveAsPreset} className="rounded-2xl px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:text-[#991b1b]">Save as a Preset</button>
            <button onClick={saveAll} disabled={saving} className="rounded-2xl bg-neutral-950 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(0,0,0,0.16)] transition hover:bg-[#991b1b] disabled:opacity-60">{saving ? "Saving..." : "Save"}</button>
          </div>
        </div>

        {/* Main card */}
        <div className="overflow-hidden rounded-[30px] border border-neutral-200 bg-white shadow-[0_12px_40px_rgba(0,0,0,0.06)]">
          {/* Header with school name */}
          <div className="border-b border-neutral-200 px-6 py-5 md:px-8">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-[-0.03em] text-neutral-800">{schoolName || "School Settings"}</h1>
              <button className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 text-neutral-600 hover:text-neutral-900">
                <Pencil size={14} />
              </button>
            </div>
          </div>

          {/* Two-column layout */}
          <div className="grid min-h-[820px] grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
            {/* Sidebar */}
            <aside className="border-r border-neutral-200 bg-[#fafafa]">
              {/* Settings / Cover tabs */}
              <div className="grid grid-cols-2 gap-3 border-b border-neutral-200 px-5 py-5">
                <button className="rounded-[18px] border border-[#7f1d1d] bg-neutral-950 px-4 py-5 text-center text-sm font-bold text-white shadow-[0_12px_24px_rgba(0,0,0,0.14)]">
                  <Settings2 className="mx-auto mb-2" size={26} />
                  Settings
                </button>
                <button onClick={() => router.push(`/dashboard/projects/schools/${schoolId}`)} className="rounded-[18px] px-4 py-5 text-center text-sm font-bold text-neutral-900 transition hover:bg-neutral-100">
                  <ImageIcon className="mx-auto mb-2" size={26} />
                  Cover
                </button>
              </div>

              {/* Section navigation */}
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
                          : "text-neutral-900 hover:bg-neutral-100"
                      )}
                    >
                      <Icon size={18} />
                      {section.label}
                    </button>
                  );
                })}
              </nav>
            </aside>

            {/* Content area */}
            <main className="bg-white p-6 md:p-8">
              {/* General */}
              {activeSection === "general" && (
                <div className="space-y-6">
                  <Card title="General">
                    <div className="grid gap-5 md:grid-cols-2">
                      <Field label="Shoot Date*" hint="The date of the photo session">
                        <input type="date" value={shootDate} onChange={(e) => setShootDate(e.target.value)} className={fieldClass} />
                      </Field>
                      <Field label="School Name">
                        <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} className={fieldClass} />
                      </Field>
                      <Field label="Order Due Date" hint="School pickup closes after this date — late orders ship with handling fee">
                        <input type="date" value={orderDueDate} onChange={(e) => setOrderDueDate(e.target.value)} className={fieldClass} />
                      </Field>
                      <Field label="Gallery Expiration Date" hint="Optional date the gallery becomes inactive">
                        <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} className={fieldClass} />
                      </Field>
                      <Field
                        label={
                          <span style={{ position: "relative", display: "inline-block", paddingRight: 14 }}>
                            Archive Date
                            <WhatsNewDot
                              featureId="combine-orders-school-archive-date-v1"
                              asBareDot
                              top={-2}
                              right={-2}
                              size={9}
                            />
                          </span>
                        }
                        hint='Optional. Surfaces "last chance" copy on the parents Older photos tab.'
                      >
                        <input type="date" value={archiveDate} onChange={(e) => setArchiveDate(e.target.value)} className={fieldClass} />
                      </Field>
                    </div>
                    <Field label="Price Sheet">
                      <div className="relative max-w-md">
                        <select value={packageProfileId} onChange={(e) => setPackageProfileId(e.target.value)} className={selectClass}>
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
                          , then come back here to assign it to this school.
                        </div>
                      ) : null}
                    </Field>
                    <Field label="Gallery Language" hint="Choose the language for your gallery interface">
                      <div className="relative max-w-md">
                        <select value={galleryLanguage} onChange={(e) => setGalleryLanguage(e.target.value)} className={selectClass}>
                          <option>English (US)</option>
                          <option>English (CA)</option>
                          <option>French</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-neutral-600" size={18} />
                      </div>
                    </Field>
                    <ToggleRow title="Allow Social Sharing" description="Show a social share message on the gallery" checked={extras.allowSocialSharing} onChange={(next) => setExtra("allowSocialSharing", next)} />
                    {extras.allowSocialSharing ? (
                      <textarea value={extras.socialShareMessage} onChange={(e) => setExtra("socialShareMessage", e.target.value)} className={cx("min-h-[110px]", fieldClass)} placeholder="Check out the photos from this gallery!" />
                    ) : null}
                    <ToggleRow title="Allow Black & White Filtering" description="Clients may view and order black and white versions of your photos" checked={extras.allowBlackWhiteFiltering} onChange={(next) => setExtra("allowBlackWhiteFiltering", next)} />
                  </Card>
                </div>
              )}

              {/* Access & Privacy */}
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
                                {option.value === "pre_release" && "Collect parent emails before the gallery goes live, then send release emails when it is activated."}
                                {option.value === "closed" && "Closed galleries are no longer viewable by parents."}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-3 text-[13px] font-semibold text-neutral-800">School Access</div>
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-4">
                          <div className="text-[15px] font-semibold text-neutral-900">Parent email + student PIN</div>
                          <div className="mt-1 text-sm leading-6 text-neutral-600">
                            School galleries always ask for the parent email address and the student PIN from the photo envelope or synced school records.
                          </div>
                        </div>
                        <div className="rounded-2xl border border-[#fecaca] bg-[#fff5f5] px-4 py-4">
                          <div className="text-[15px] font-semibold text-[#991b1b]">PINs stay synced from Studio OS App</div>
                          <div className="mt-1 text-sm leading-6 text-[#7f1d1d]">
                            If you need to change a student PIN, update the student record in the synced app workflow. School-wide public access and a separate school PIN are not used in this flow.
                          </div>
                        </div>
                        {photographerPlan === "starter" && (
                          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-4">
                            <div className="text-[15px] font-semibold text-amber-900">Upgrade for Full Student Access Control</div>
                            <div className="mt-1 text-sm leading-6 text-amber-800">
                              Your current Starter plan ($49/mo) does not include individual student password/PIN management. Upgrade to the <b>Core plan ($99/mo)</b> to set unique PINs per student and get full control over school gallery access through the Studio OS App.
                            </div>
                            <Link
                              href="/dashboard/billing"
                              className="mt-3 inline-block rounded-lg bg-neutral-900 px-5 py-2 text-sm font-bold text-white hover:bg-neutral-700 transition"
                            >
                              Upgrade Now
                            </Link>
                          </div>
                        )}
                        <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-4">
                          <div className="text-[15px] font-semibold text-neutral-900">Prerelease email capture</div>
                          <div className="mt-1 text-sm leading-6 text-neutral-600">
                            When a school is in pre-release, parent emails collected from the portal are saved and used for gallery-ready release emails and later school campaigns.
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 2026-04-26: Per-school grouping label.  Universities
                        call them Faculties, elementary schools call them
                        Grades, corporate shoots call them Departments.
                        Defaults to Class / Classes for the K-12 case. */}
                    <div>
                      <div className="mb-3 text-[13px] font-semibold text-neutral-800">Grouping Label</div>
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
                        Tell the system what to call the per-school grouping. Use <b>Faculty / Faculties</b> for universities, <b>Grade / Grades</b> for elementary, or anything that fits — it shows up everywhere a parent or photographer would otherwise see &quot;Class&quot;.
                      </div>
                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-600">
                            Singular
                          </span>
                          <input
                            type="text"
                            value={groupLabelSingular}
                            onChange={(e) => setGroupLabelSingular(e.target.value)}
                            placeholder="Class"
                            maxLength={64}
                            className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-900 outline-none focus:border-neutral-400"
                          />
                          <span className="text-[11px] text-neutral-500">
                            Examples: Class, Faculty, Grade, Department
                          </span>
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-600">
                            Plural
                          </span>
                          <input
                            type="text"
                            value={groupLabelPlural}
                            onChange={(e) => setGroupLabelPlural(e.target.value)}
                            placeholder="Classes"
                            maxLength={64}
                            className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-neutral-900 outline-none focus:border-neutral-400"
                          />
                          <span className="text-[11px] text-neutral-500">
                            Examples: Classes, Faculties, Grades, Departments
                          </span>
                        </label>
                      </div>
                    </div>

                    {/* Screenshot protection — protects photographer IP in
                        the parents portal.  Applies only to /parents and
                        /g gallery routes; never affects photographer
                        previews in the dashboard. */}
                    <div>
                      <div className="mb-3 text-[13px] font-semibold text-neutral-800">Screenshot Protection</div>
                      <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-900">
                        Makes it harder for parents to screenshot your photos before they buy. These toggles affect <b>only</b> the parent gallery — your dashboard previews stay clean.
                      </div>
                      <div className="mt-4 space-y-3">
                        <ToggleRow
                          title="Desktop Protection"
                          description="Blurs the gallery the moment the tab loses focus or a common screenshot keystroke is pressed (Cmd+Shift+3/4/5, Win+Shift+S, PrtScr)."
                          checked={protectDesktop}
                          onChange={setProtectDesktop}
                        />
                        <ToggleRow
                          title="Mobile Protection"
                          description="Half of each photo stays blurred at all times. Press-and-hold shifts the blur so parents can preview the full image but can never capture a clean screenshot."
                          checked={protectMobile}
                          onChange={setProtectMobile}
                        />
                        <ToggleRow
                          title="Session watermark overlay"
                          description="Burns a faint diagonal watermark (school name · PIN · date) across every displayed image. Doesn't stop screenshots but makes leaks traceable back to the source."
                          checked={protectWatermark}
                          onChange={setProtectWatermark}
                        />
                      </div>
                    </div>
                  </Card>
                </div>
              )}

              {/* Free Digitals */}
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
                        <div>{extras.freeDigitalRuleEnabled ? "Original" : "No active rule"}</div>
                        <div>{extras.freeDigitalAudience === "gallery" ? "Gallery" : "Person"}</div>
                        <div>{extras.freeDigitalDownloadLimit === "unlimited" ? "Unlimited" : extras.freeDigitalDownloadLimit}</div>
                        <div>{extras.freeDigitalResolution === "original" ? "Original" : extras.freeDigitalResolution === "large" ? "Large" : "Web"}</div>
                      </div>
                    </div>

                    <ToggleRow title="Enable free digital rule" description="Create a downloadable rule for this school gallery." checked={extras.freeDigitalRuleEnabled} onChange={(next) => setExtra("freeDigitalRuleEnabled", next)} />
                    {extras.freeDigitalRuleEnabled ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Who should be able to download photos for free?">
                          <select value={extras.freeDigitalAudience} onChange={(e) => setExtra("freeDigitalAudience", e.target.value as ExtraSettings["freeDigitalAudience"])} className={fieldClass}>
                            <option value="gallery">All visitors to this gallery</option>
                            <option value="person">One specific person</option>
                          </select>
                        </Field>
                        <Field label="What size files should be delivered?">
                          <select value={extras.freeDigitalResolution} onChange={(e) => setExtra("freeDigitalResolution", e.target.value as ExtraSettings["freeDigitalResolution"])} className={fieldClass}>
                            <option value="original">Original</option>
                            <option value="large">Large</option>
                            <option value="web">Web</option>
                          </select>
                        </Field>
                        <Field label="How many photos can each visitor download?">
                          <select value={extras.freeDigitalDownloadLimit} onChange={(e) => setExtra("freeDigitalDownloadLimit", e.target.value as ExtraSettings["freeDigitalDownloadLimit"])} className={fieldClass}>
                            <option value="unlimited">Unlimited</option>
                            <option value="10">10</option>
                            <option value="5">5</option>
                            <option value="1">1</option>
                          </select>
                        </Field>
                        {extras.freeDigitalAudience === "person" ? (
                          <>
                            <Field
                              label="Approved parent name"
                              hint="Optional label for your own reference."
                            >
                              <input
                                value={extras.freeDigitalTargetName}
                                onChange={(e) =>
                                  setExtra("freeDigitalTargetName", e.target.value)
                                }
                                className={fieldClass}
                                placeholder="Ex. Nicole Abrahamyan"
                              />
                            </Field>
                            <Field
                              label="Approved parent email"
                              hint="Only this email can use the free download rule."
                            >
                              <input
                                value={extras.freeDigitalTargetEmail}
                                onChange={(e) =>
                                  setExtra("freeDigitalTargetEmail", e.target.value)
                                }
                                className={fieldClass}
                                placeholder="parent@example.com"
                                type="email"
                              />
                            </Field>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    <ToggleRow
                      title="Show proof watermark in gallery"
                      description="Control whether parents see your proof watermark while viewing this gallery. Downloaded files stay clean unless the download watermark switch is turned on."
                      checked={extras.showProofWatermark}
                      onChange={(next) => setExtra("showProofWatermark", next)}
                    />
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
                            hint="Parents will need this extra PIN when they click Download All."
                          >
                            <input
                              value={extras.downloadPin}
                              onChange={(e) => setExtra("downloadPin", e.target.value)}
                              className={cx("max-w-md", fieldClass)}
                              placeholder="Set a download PIN"
                            />
                          </Field>
                        ) : null}
                      </>
                    ) : null}
                    <ToggleRow
                      title="Apply a watermark to the downloaded files"
                      description="Turn this on only if the delivered download itself should include the watermark."
                      checked={extras.watermarkDownloads}
                      onChange={(next) => setExtra("watermarkDownloads", next)}
                    />
                    <ToggleRow title="Include a Print Release" checked={extras.includePrintRelease} onChange={(next) => setExtra("includePrintRelease", next)} />
                  </Card>
                </div>
              )}

              {/* Shopping Cart/Store */}
              {activeSection === "store" && (
                <div className="space-y-6">
                  <Card title="Shopping Cart/Store" description="Allow clients to place orders in the gallery.">
                    <Field label="Price Sheet">
                      <div className="relative max-w-md">
                        <select value={packageProfileId} onChange={(e) => setPackageProfileId(e.target.value)} className={selectClass}>
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
                          , then come back here to assign it to this school.
                        </div>
                      ) : null}
                    </Field>
                    <Field label="Minimum Order Amount (optional)" hint="Set a minimum order amount for this gallery">
                      <input value={extras.minimumOrderAmount} onChange={(e) => setExtra("minimumOrderAmount", e.target.value)} className={cx("max-w-md", fieldClass)} placeholder="ex. $20.00" />
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

              {/* Advanced */}
              {activeSection === "advanced" && (
                <div className="space-y-6">
                  <Card title="Advanced" description="Configure your advanced settings.">
                    <ToggleRow title='Hide the "All Photos" Album' description="Show only the albums you've created" checked={extras.hideAllPhotosAlbum} onChange={(next) => setExtra("hideAllPhotosAlbum", next)} />
                    <ToggleRow title="Hide Album Photo Count" description="On the main gallery view, hide the photo count for each album" checked={extras.hideAlbumPhotoCount} onChange={(next) => setExtra("hideAlbumPhotoCount", next)} />
                    <ToggleRow title="Automatically Send Gallery to Archive After Expiration" description="Archiving frees up space after the expiration date." checked={extras.autoArchiveAfterExpiration} onChange={(next) => setExtra("autoArchiveAfterExpiration", next)} />
                    <ToggleRow title="Send Email Campaign" description="Automatically send emails to your clients and gallery visitors" checked={extras.sendEmailCampaign} onChange={(next) => setExtra("sendEmailCampaign", next)} />
                    <ToggleRow title="Set Album Cover Images automatically" description="During upload, allow the system to select a photo as the album cover" checked={extras.autoChooseAlbumCover} onChange={(next) => setExtra("autoChooseAlbumCover", next)} />
                    <ToggleRow title="Set School Cover automatically" description="During upload, allow the system to select a photo as the school cover" checked={extras.autoChooseProjectCover} onChange={(next) => setExtra("autoChooseProjectCover", next)} />
                    <Field label="Automatic cover source">
                      <div className="relative max-w-md">
                        <select value={extras.coverSource} onChange={(e) => setExtra("coverSource", e.target.value as ExtraSettings["coverSource"])} className={selectClass}>
                          <option value="first_valid">First valid photo</option>
                          <option value="newest">Newest photo</option>
                          <option value="oldest">Oldest photo</option>
                          <option value="manual">Manual only</option>
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-neutral-600" size={18} />
                      </div>
                    </Field>
                    <Field label="Internal Notes">
                      <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} className={cx("min-h-[120px]", fieldClass)} placeholder="Private notes for studio workflow" />
                    </Field>
                  </Card>

                  <Card title="Cover shortcuts" description="Quick links to cover selection tools for this school and its classes.">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Link href={`/dashboard/projects/schools/${schoolId}`} className="flex items-center justify-between rounded-2xl border border-neutral-200 px-4 py-4 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-50">
                        <div className="flex items-center gap-3"><ImageIcon size={18} />Choose school cover</div>
                        <ArrowLeft className="rotate-180" size={16} />
                      </Link>
                      <Link href={`/dashboard/projects/schools/${schoolId}`} className="flex items-center justify-between rounded-2xl border border-neutral-200 px-4 py-4 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-50">
                        <div className="flex items-center gap-3"><FolderOpen size={18} />Open class manager</div>
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
