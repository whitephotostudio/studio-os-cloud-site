"use client";

import { useEffect, useMemo, useState } from "react";
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
  Save,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type ProjectRow = Record<string, any>;
type PackageProfileRow = { id: string; name?: string | null; profile_name?: string | null };

type ExtraSettings = {
  allowSocialSharing: boolean;
  socialShareMessage: string;
  allowBlackWhiteFiltering: boolean;
  galleryAccess: "public" | "private";
  passwordProtected: boolean;
  password: string;
  freeDigitalRuleEnabled: boolean;
  freeDigitalAudience: "gallery" | "album" | "person";
  freeDigitalResolution: "original" | "large" | "web";
  freeDigitalDownloadLimit: "unlimited" | "10" | "5" | "1";
  showDownloadAllButton: boolean;
  watermarkDownloads: boolean;
  includePrintRelease: boolean;
  enableStore: boolean;
  minimumOrderAmount: string;
  allowCropping: boolean;
  enableAbandonedCartEmail: boolean;
  showBuyAllButton: boolean;
  offerPackagesOnly: boolean;
  allowClientToPayLater: boolean;
  allowClientComments: boolean;
  hideAllPhotosAlbum: boolean;
  hideAlbumPhotoCount: boolean;
  autoArchiveAfterExpiration: boolean;
  sendEmailCampaign: boolean;
  autoChooseAlbumCover: boolean;
  autoChooseProjectCover: boolean;
  coverSource: "first_valid" | "newest" | "oldest" | "manual";
};

const defaultExtras: ExtraSettings = {
  allowSocialSharing: true,
  socialShareMessage: "Check out the photos from this gallery!",
  allowBlackWhiteFiltering: false,
  galleryAccess: "public",
  passwordProtected: false,
  password: "",
  freeDigitalRuleEnabled: false,
  freeDigitalAudience: "gallery",
  freeDigitalResolution: "original",
  freeDigitalDownloadLimit: "unlimited",
  showDownloadAllButton: false,
  watermarkDownloads: false,
  includePrintRelease: false,
  enableStore: true,
  minimumOrderAmount: "",
  allowCropping: false,
  enableAbandonedCartEmail: true,
  showBuyAllButton: false,
  offerPackagesOnly: false,
  allowClientToPayLater: false,
  allowClientComments: false,
  hideAllPhotosAlbum: false,
  hideAlbumPhotoCount: false,
  autoArchiveAfterExpiration: false,
  sendEmailCampaign: false,
  autoChooseAlbumCover: true,
  autoChooseProjectCover: true,
  coverSource: "first_valid",
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

function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition",
        checked ? "border-[#0f172a] bg-[#0f172a]" : "border-neutral-300 bg-neutral-200"
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
    <div className="rounded-[24px] border border-neutral-200 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
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
  const [extras, setExtras] = useState<ExtraSettings>(defaultExtras);

  const storageKey = `studioos_project_settings_${projectId}`;

  useEffect(() => {
    void loadAll();
  }, [projectId]);

  async function loadAll() {
    setLoading(true);

    const [{ data: projectData }, packageResult] = await Promise.all([
      supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
      supabase.from("package_profiles").select("id,name,profile_name").order("created_at", { ascending: false }),
    ]);

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
    }

    setPackageProfiles((packageResult.data as PackageProfileRow[] | null) || []);

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ExtraSettings> & { galleryLanguage?: string };
        setExtras({ ...defaultExtras, ...parsed });
        if (parsed.galleryLanguage) setGalleryLanguage(parsed.galleryLanguage);
      }
    } catch {}

    setLoading(false);
  }

  function setExtra<K extends keyof ExtraSettings>(key: K, value: ExtraSettings[K]) {
    setExtras((prev) => ({ ...prev, [key]: value }));
  }

  async function saveAll() {
    setSaving(true);
    setSaveNotice(null);

    const payload: Record<string, any> = {
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
    };

    if (project) {
      if ("project_name" in project) payload.project_name = projectName || null;
      else if ("name" in project) payload.name = projectName || null;
      else payload.title = projectName || null;
    }

    const { error } = await supabase.from("projects").update(payload).eq("id", projectId);

    if (!error) {
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ ...extras, galleryLanguage })
        );
      } catch {}
      setSaveNotice("Saved");
      setTimeout(() => setSaveNotice(null), 2500);
    } else {
      alert(error.message);
    }

    setSaving(false);
  }

  function saveAsPreset() {
    const name = window.prompt("Preset name");
    if (!name) return;
    try {
      const key = "studioos_gallery_presets";
      const current = JSON.parse(window.localStorage.getItem(key) || "[]") as Array<any>;
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

  return (
    <div className="min-h-screen bg-[#f6f7fb] px-4 py-6 md:px-8">
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
            <button onClick={() => router.push(`/dashboard/projects/${projectId}`)} className="rounded-2xl border border-[#94bce5] bg-white px-5 py-2.5 text-sm font-semibold text-neutral-800">Cancel</button>
            <button onClick={saveAsPreset} className="rounded-2xl px-5 py-2.5 text-sm font-semibold text-neutral-800 hover:text-neutral-900">Save as a Preset</button>
            <button onClick={saveAll} disabled={saving} className="rounded-2xl bg-[#0f172a] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Saving..." : "Save"}</button>
          </div>
        </div>

        <div className="overflow-hidden rounded-[30px] border border-neutral-200 bg-white shadow-[0_12px_50px_rgba(15,23,42,0.06)]">
          <div className="border-b border-neutral-200 px-6 py-5 md:px-8">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-[-0.03em] text-neutral-800">{projectName || "Event Settings"}</h1>
              <button className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 text-neutral-600 hover:text-neutral-900">
                <Pencil size={14} />
              </button>
            </div>
          </div>

          <div className="grid min-h-[820px] grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="border-r border-neutral-200 bg-[#fbfcfe]">
              <div className="grid grid-cols-2 gap-3 border-b border-neutral-200 px-5 py-5">
                <button className="rounded-[18px] bg-[#d9ecff] px-4 py-5 text-center text-sm font-bold text-neutral-800">
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
                        active ? "bg-[#134f82] text-white" : "text-neutral-800 hover:bg-neutral-100"
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
                        <select value={galleryLanguage} onChange={(e) => setGalleryLanguage(e.target.value)} className="w-full appearance-none rounded-xl border border-neutral-200 px-4 py-3 pr-10 text-sm">
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
                        <div>{extras.freeDigitalRuleEnabled ? "Original" : "No active rule"}</div>
                        <div>{extras.freeDigitalAudience === "gallery" ? "Gallery" : extras.freeDigitalAudience === "album" ? "Album" : "Person"}</div>
                        <div>{extras.freeDigitalDownloadLimit === "unlimited" ? "Unlimited" : extras.freeDigitalDownloadLimit}</div>
                        <div>{extras.freeDigitalResolution === "original" ? "Original" : extras.freeDigitalResolution === "large" ? "Large" : "Web"}</div>
                      </div>
                    </div>

                    <ToggleRow title="Enable free digital rule" description="Create a downloadable rule for this gallery or album." checked={extras.freeDigitalRuleEnabled} onChange={(next) => setExtra("freeDigitalRuleEnabled", next)} />
                    {extras.freeDigitalRuleEnabled ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Who should be able to download photos for free?">
                          <select value={extras.freeDigitalAudience} onChange={(e) => setExtra("freeDigitalAudience", e.target.value as ExtraSettings["freeDigitalAudience"])} className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400">
                            <option value="gallery">All visitors to this gallery</option>
                            <option value="album">Visitors to a specific album</option>
                            <option value="person">One specific person</option>
                          </select>
                        </Field>
                        <Field label="What size files should be delivered?">
                          <select value={extras.freeDigitalResolution} onChange={(e) => setExtra("freeDigitalResolution", e.target.value as ExtraSettings["freeDigitalResolution"])} className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400">
                            <option value="original">Original</option>
                            <option value="large">Large</option>
                            <option value="web">Web</option>
                          </select>
                        </Field>
                        <Field label="How many photos can each visitor download?">
                          <select value={extras.freeDigitalDownloadLimit} onChange={(e) => setExtra("freeDigitalDownloadLimit", e.target.value as ExtraSettings["freeDigitalDownloadLimit"])} className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400">
                            <option value="unlimited">Unlimited</option>
                            <option value="10">10</option>
                            <option value="5">5</option>
                            <option value="1">1</option>
                          </select>
                        </Field>
                      </div>
                    ) : null}
                    <ToggleRow title='Show "Download All" button in gallery' checked={extras.showDownloadAllButton} onChange={(next) => setExtra("showDownloadAllButton", next)} />
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
                        <select value={packageProfileId} onChange={(e) => setPackageProfileId(e.target.value)} className="w-full appearance-none rounded-xl border border-neutral-200 px-4 py-3 pr-10 text-sm">
                          <option value="">Choose price sheet</option>
                          {packageProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>{profile.profile_name || profile.name || profile.id}</option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-3.5 text-neutral-600" size={18} />
                      </div>
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
                        <select value={extras.coverSource} onChange={(e) => setExtra("coverSource", e.target.value as ExtraSettings["coverSource"])} className="w-full appearance-none rounded-xl border border-neutral-200 px-4 py-3 pr-10 text-sm">
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
