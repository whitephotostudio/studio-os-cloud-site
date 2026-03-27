"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Save,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type ClassCollectionRow = {
  id: string;
  title?: string | null;
  slug?: string | null;
  kind?: string | null;
  access_mode?: string | null;
  access_pin?: string | null;
  sort_order?: number | null;
};

type ExtraSettings = {
  allowSocialSharing: boolean;
  socialShareMessage: string;
  allowBlackWhiteFiltering: boolean;
  galleryStatus: "active" | "inactive" | "closed";
  galleryAccess: "inherit" | "public" | "private";
  classPin: string;
  emailRequired: boolean;
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
  hidePhotoCount: boolean;
  autoArchiveAfterExpiration: boolean;
  sendEmailCampaign: boolean;
  autoChooseCover: boolean;
  internalNotes: string;
};

const defaultExtras: ExtraSettings = {
  allowSocialSharing: true,
  socialShareMessage: "Check out the photos from this gallery!",
  allowBlackWhiteFiltering: false,
  galleryStatus: "active",
  galleryAccess: "inherit",
  classPin: "",
  emailRequired: false,
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
  hidePhotoCount: false,
  autoArchiveAfterExpiration: false,
  sendEmailCampaign: false,
  autoChooseCover: true,
  internalNotes: "",
};

const sections = [
  { key: "general", label: "General", icon: Settings2 },
  { key: "privacy", label: "Access & Privacy", icon: ShieldCheck },
  { key: "free-digital", label: "Free Digitals", icon: Download },
  { key: "store", label: "Shopping Cart/Store", icon: ShoppingCart },
  { key: "advanced", label: "Advanced", icon: Sparkles },
] as const;

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function slugify(value: string) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "class";
}

function collectionAccessToGalleryAccess(value: string | null | undefined): ExtraSettings["galleryAccess"] {
  const mode = clean(value).toLowerCase();
  if (mode === "pin" || mode === "private" || mode === "protected") return "private";
  if (mode === "public") return "public";
  return "inherit";
}

function galleryAccessToCollectionMode(value: ExtraSettings["galleryAccess"]) {
  if (value === "private") return "pin";
  if (value === "public") return "public";
  return "inherit_project";
}

const Toggle = ({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) => (
  <button
    onClick={() => onChange(!checked)}
    className={`h-7 w-12 rounded-full transition-colors ${
      checked ? "bg-[#134f82]" : "bg-neutral-300"
    }`}
    aria-pressed={checked}
  >
    <div
      className={`h-5 w-5 transform rounded-full bg-white transition-transform ${
        checked ? "translate-x-6" : "translate-x-1"
      }`}
    />
  </button>
);

export default function ClassSettingsPage() {
  const params = useParams();
  const schoolId = params.schoolId as string;
  const classId = params.classId as string;
  const decodedClassId = decodeURIComponent(classId);

  const supabase = useMemo(() => createClient(), []);

  const [activeSection, setActiveSection] = useState<string>("general");
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [syncProjectId, setSyncProjectId] = useState<string | null>(null);
  const [classCollectionId, setClassCollectionId] = useState<string | null>(null);
  const [nextSortOrder, setNextSortOrder] = useState(0);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  // Form state
  const [extras, setExtras] = useState<ExtraSettings>(defaultExtras);
  const [classDisplayName, setClassDisplayName] = useState(decodedClassId);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setSyncWarning(null);
        setSaveNotice(null);

        const localKey = `studioos_class_settings_${schoolId}_${classId}`;
        let nextExtras = defaultExtras;

        const savedExtras = localStorage.getItem(localKey);
        if (savedExtras) {
          try {
            nextExtras = { ...defaultExtras, ...JSON.parse(savedExtras) };
          } catch {
            nextExtras = defaultExtras;
          }
        }

        const schoolProjectBySchoolId = await supabase
          .from("projects")
          .select("id")
          .eq("workflow_type", "school")
          .eq("school_id", schoolId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const schoolProjectByLinkedSchoolId =
          schoolProjectBySchoolId.data
            ? { data: null as { id: string } | null }
            : await supabase
                .from("projects")
                .select("id")
                .eq("workflow_type", "school")
                .eq("linked_school_id", schoolId)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();

        const fallbackProjectBySchoolId =
          schoolProjectBySchoolId.data || schoolProjectByLinkedSchoolId.data
            ? { data: null as { id: string } | null }
            : await supabase
                .from("projects")
                .select("id")
                .eq("school_id", schoolId)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();

        const projectId =
          schoolProjectBySchoolId.data?.id ||
          schoolProjectByLinkedSchoolId.data?.id ||
          fallbackProjectBySchoolId.data?.id ||
          null;

        setSyncProjectId(projectId);

        if (projectId) {
          const { data: collectionRows, error: collectionError } = await supabase
            .from("collections")
            .select("id,title,slug,kind,access_mode,access_pin,sort_order")
            .eq("project_id", projectId)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true });

          if (collectionError) throw collectionError;

          const normalizedClassName = clean(decodedClassId).toLowerCase();
          const classSlug = slugify(decodedClassId);
          const rows = (collectionRows ?? []) as ClassCollectionRow[];
          const existingClassCollection =
            rows.find((row) => clean(row.kind).toLowerCase() === "class" && clean(row.title).toLowerCase() === normalizedClassName) ||
            rows.find((row) => clean(row.kind).toLowerCase() === "class" && clean(row.slug) === classSlug) ||
            null;

          setClassCollectionId(existingClassCollection?.id ?? null);
          setNextSortOrder(
            rows.length
              ? Math.max(...rows.map((row) => Number(row.sort_order ?? 0))) + 1
              : 0
          );

          if (existingClassCollection) {
            setClassDisplayName(clean(existingClassCollection.title) || decodedClassId);
            nextExtras = {
              ...nextExtras,
              galleryAccess: collectionAccessToGalleryAccess(existingClassCollection.access_mode),
              classPin: clean(existingClassCollection.access_pin),
            };
          } else {
            setClassDisplayName(decodedClassId);
          }
        } else {
          setClassCollectionId(null);
          setNextSortOrder(0);
          setClassDisplayName(decodedClassId);
          setSyncWarning("No synced school project was found yet. Class PIN changes here will stay local until a school project exists.");
        }

        setExtras(nextExtras);
      } catch (error) {
        console.error("Error fetching class settings data:", error);
        setSyncWarning("Could not load synced class password settings.");
        setClassDisplayName(decodedClassId);
        setExtras(defaultExtras);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [schoolId, classId, decodedClassId, supabase]);

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setSaveNotice(null);
      const nextClassDisplayName = clean(classDisplayName) || decodedClassId;

      const localKey = `studioos_class_settings_${schoolId}_${classId}`;
      localStorage.setItem(localKey, JSON.stringify(extras));

      if (syncProjectId) {
        const accessMode = galleryAccessToCollectionMode(extras.galleryAccess);
        const accessPin = extras.galleryAccess === "private" ? clean(extras.classPin) || null : null;
        const payload = {
          access_mode: accessMode,
          access_pin: accessPin,
          access_updated_at: new Date().toISOString(),
          access_updated_source: "cloud",
          visibility: extras.galleryAccess === "private" ? "private" : "public",
        };

        if (classCollectionId) {
          const { error } = await supabase
            .from("collections")
            .update({
              title: nextClassDisplayName,
              ...payload,
            })
            .eq("id", classCollectionId)
            .eq("project_id", syncProjectId);

          if (error) throw error;
        } else {
          const { data, error } = await supabase
            .from("collections")
            .insert({
              project_id: syncProjectId,
              kind: "class",
              title: nextClassDisplayName,
              slug: slugify(decodedClassId),
              sort_order: nextSortOrder,
              ...payload,
            })
            .select("id")
            .single();

          if (error) throw error;
          setClassCollectionId(data?.id ?? null);
          setNextSortOrder((prev) => prev + 1);
        }

        setClassDisplayName(nextClassDisplayName);
        setSaveNotice("Saved and synced");
      } else {
        setClassDisplayName(nextClassDisplayName);
        setSaveNotice("Saved locally");
      }

      setHasChanges(false);
    } catch (error) {
      console.error("Error saving class settings:", error);
      setSaveNotice("Could not save class settings");
    } finally {
      setIsSaving(false);
      window.setTimeout(() => setSaveNotice(null), 2500);
    }
  };

  const handleCancel = () => {
    setHasChanges(false);
    setSaveNotice(null);
    void (async () => {
      setLoading(true);
      try {
        const localKey = `studioos_class_settings_${schoolId}_${classId}`;
        let nextExtras = defaultExtras;
        const savedExtras = localStorage.getItem(localKey);
        if (savedExtras) {
          try {
            nextExtras = { ...defaultExtras, ...JSON.parse(savedExtras) };
          } catch {
            nextExtras = defaultExtras;
          }
        }

        if (syncProjectId) {
          const { data: row } = await supabase
            .from("collections")
            .select("id,title,access_mode,access_pin")
            .eq("id", classCollectionId ?? "")
            .maybeSingle();

          if (row) {
            setClassDisplayName(clean((row as ClassCollectionRow).title) || decodedClassId);
            nextExtras = {
              ...nextExtras,
              galleryAccess: collectionAccessToGalleryAccess((row as ClassCollectionRow).access_mode),
              classPin: clean((row as ClassCollectionRow).access_pin),
            };
          } else {
            setClassDisplayName(decodedClassId);
          }
        } else {
          setClassDisplayName(decodedClassId);
        }

        setExtras(nextExtras);
      } finally {
        setLoading(false);
      }
    })();
  };

  const handleExtrasChange = <K extends keyof ExtraSettings>(key: K, value: ExtraSettings[K]) => {
    setExtras((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f7fb]">
        <div className="text-neutral-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f7fb] px-4 py-6 md:px-8">
      <div className="mx-auto max-w-[1500px]">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            href={`/dashboard/projects/schools/${schoolId}/classes/${encodeURIComponent(classId)}`}
            className="flex items-center gap-2 text-[#134f82] hover:underline"
          >
            <ArrowLeft size={20} />
            Back to Class
          </Link>
          <div className="flex items-center gap-3">
            {saveNotice ? (
              <span className="rounded-lg bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
                {saveNotice}
              </span>
            ) : null}
            <button
              onClick={handleCancel}
              disabled={!hasChanges || isSaving}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="flex items-center gap-2 rounded-lg bg-[#134f82] px-4 py-2 text-white hover:bg-[#0d3a5a] disabled:opacity-50"
            >
              <Save size={18} />
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        {syncWarning ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {syncWarning}
          </div>
        ) : null}

        {/* Main Content */}
        <div className="grid min-h-[820px] grid-cols-1 gap-6 md:grid-cols-[300px_minmax(0,1fr)]">
          {/* Sidebar Navigation */}
          <div className="rounded-[24px] border border-neutral-200 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.04)] h-fit">
            <div className="space-y-2">
              {sections.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.key;
                return (
                  <button
                    key={section.key}
                    onClick={() => setActiveSection(section.key)}
                    className={`w-full flex items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors ${
                      isActive
                        ? "bg-[#134f82] text-white"
                        : "text-neutral-800 hover:bg-neutral-100"
                    }`}
                  >
                    <Icon size={18} />
                    <span className="text-sm font-medium">{section.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main Content Area */}
          <div className="space-y-6">
            {/* General Section */}
            {activeSection === "general" && (
              <div className="rounded-[24px] border border-neutral-200 bg-white p-6 shadow-[0_12px_50px_rgba(15,23,42,0.06)]">
                <h2 className="mb-6 text-xl font-semibold text-neutral-900">
                  General
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-2">
                      Class/Gallery Name
                    </label>
                    <input
                      type="text"
                      value={classDisplayName}
                      onChange={(e) => {
                        setClassDisplayName(e.target.value);
                        setHasChanges(true);
                      }}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-4 py-2 font-medium text-neutral-800 placeholder-neutral-400 focus:border-[#134f82] focus:outline-none"
                      placeholder="Class name"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-2">
                      Gallery Language
                    </label>
                    <select
                      value="en"
                      className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-neutral-900 focus:border-[#134f82] focus:outline-none"
                    >
                      <option value="en">English</option>
                      <option value="es">Spanish</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                    </select>
                  </div>

                  <div className="border-t border-neutral-200 pt-4">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-neutral-700">
                        Social Sharing
                      </label>
                      <Toggle
                        checked={extras.allowSocialSharing}
                        onChange={(value) =>
                          handleExtrasChange("allowSocialSharing", value)
                        }
                      />
                    </div>
                    {extras.allowSocialSharing && (
                      <input
                        type="text"
                        value={extras.socialShareMessage}
                        onChange={(e) =>
                          handleExtrasChange("socialShareMessage", e.target.value)
                        }
                        className="mt-3 w-full rounded-lg border border-neutral-300 px-4 py-2 text-neutral-900 placeholder-neutral-400 focus:border-[#134f82] focus:outline-none"
                        placeholder="Enter social share message"
                      />
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
                    <label className="text-sm font-medium text-neutral-700">
                      B&W Filtering
                    </label>
                    <Toggle
                      checked={extras.allowBlackWhiteFiltering}
                      onChange={(value) =>
                        handleExtrasChange("allowBlackWhiteFiltering", value)
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Access & Privacy Section */}
            {activeSection === "privacy" && (
              <div className="rounded-[24px] border border-neutral-200 bg-white p-6 shadow-[0_12px_50px_rgba(15,23,42,0.06)]">
                <h2 className="mb-6 text-xl font-semibold text-neutral-900">
                  Access & Privacy
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-2">
                      Status
                    </label>
                    <select
                      value={extras.galleryStatus}
                      onChange={(e) =>
                        handleExtrasChange(
                          "galleryStatus",
                          e.target.value as "active" | "inactive" | "closed"
                        )
                      }
                      className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-neutral-900 focus:border-[#134f82] focus:outline-none"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-neutral-700 mb-2">
                      Gallery Access
                    </label>
                    <select
                      value={extras.galleryAccess}
                      onChange={(e) =>
                        handleExtrasChange(
                          "galleryAccess",
                          e.target.value as "inherit" | "public" | "private"
                        )
                      }
                      className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-neutral-900 focus:border-[#134f82] focus:outline-none"
                    >
                      <option value="inherit">Inherit School Settings</option>
                      <option value="public">Public</option>
                      <option value="private">Class PIN</option>
                    </select>
                  </div>

                  {extras.galleryAccess === "private" && (
                    <div>
                      <label className="block text-sm font-medium text-neutral-700 mb-2">
                        Class PIN
                      </label>
                      <input
                        type="text"
                        value={extras.classPin}
                        onChange={(e) =>
                          handleExtrasChange("classPin", e.target.value)
                        }
                        className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-neutral-900 placeholder-neutral-400 focus:border-[#134f82] focus:outline-none"
                        placeholder="Enter PIN"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
                    <label className="text-sm font-medium text-neutral-700">
                      Email Required
                    </label>
                    <Toggle
                      checked={extras.emailRequired}
                      onChange={(value) =>
                        handleExtrasChange("emailRequired", value)
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Free Digitals Section */}
            {activeSection === "free-digital" && (
              <div className="rounded-[24px] border border-neutral-200 bg-white p-6 shadow-[0_12px_50px_rgba(15,23,42,0.06)]">
                <h2 className="mb-6 text-xl font-semibold text-neutral-900">
                  Free Digitals
                </h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
                    <label className="text-sm font-medium text-neutral-700">
                      Enable Free Digital Rule
                    </label>
                    <Toggle
                      checked={extras.freeDigitalRuleEnabled}
                      onChange={(value) =>
                        handleExtrasChange("freeDigitalRuleEnabled", value)
                      }
                    />
                  </div>

                  {extras.freeDigitalRuleEnabled && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-2">
                          Audience
                        </label>
                        <select
                          value={extras.freeDigitalAudience}
                          onChange={(e) =>
                            handleExtrasChange(
                              "freeDigitalAudience",
                              e.target.value as "gallery" | "album" | "person"
                            )
                          }
                          className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-neutral-900 focus:border-[#134f82] focus:outline-none"
                        >
                          <option value="gallery">Gallery</option>
                          <option value="album">Album</option>
                          <option value="person">Person</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-2">
                          Resolution
                        </label>
                        <select
                          value={extras.freeDigitalResolution}
                          onChange={(e) =>
                            handleExtrasChange(
                              "freeDigitalResolution",
                              e.target.value as "original" | "large" | "web"
                            )
                          }
                          className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-neutral-900 focus:border-[#134f82] focus:outline-none"
                        >
                          <option value="original">Original</option>
                          <option value="large">Large</option>
                          <option value="web">Web</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-2">
                          Download Limit
                        </label>
                        <select
                          value={extras.freeDigitalDownloadLimit}
                          onChange={(e) =>
                            handleExtrasChange(
                              "freeDigitalDownloadLimit",
                              e.target.value as "unlimited" | "10" | "5" | "1"
                            )
                          }
                          className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-neutral-900 focus:border-[#134f82] focus:outline-none"
                        >
                          <option value="unlimited">Unlimited</option>
                          <option value="10">10</option>
                          <option value="5">5</option>
                          <option value="1">1</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
                        <label className="text-sm font-medium text-neutral-700">
                          Show Download All Button
                        </label>
                        <Toggle
                          checked={extras.showDownloadAllButton}
                          onChange={(value) =>
                            handleExtrasChange("showDownloadAllButton", value)
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
                        <label className="text-sm font-medium text-neutral-700">
                          Watermark Downloads
                        </label>
                        <Toggle
                          checked={extras.watermarkDownloads}
                          onChange={(value) =>
                            handleExtrasChange("watermarkDownloads", value)
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
                        <label className="text-sm font-medium text-neutral-700">
                          Include Print Release
                        </label>
                        <Toggle
                          checked={extras.includePrintRelease}
                          onChange={(value) =>
                            handleExtrasChange("includePrintRelease", value)
                          }
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Shopping Cart/Store Section */}
            {activeSection === "store" && (
              <div className="rounded-[24px] border border-neutral-200 bg-white p-6 shadow-[0_12px_50px_rgba(15,23,42,0.06)]">
                <h2 className="mb-6 text-xl font-semibold text-neutral-900">
                  Shopping Cart/Store
                </h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
                    <label className="text-sm font-medium text-neutral-700">
                      Enable Store
                    </label>
                    <Toggle
                      checked={extras.enableStore}
                      onChange={(value) =>
                        handleExtrasChange("enableStore", value)
                      }
                    />
                  </div>

                  {extras.enableStore && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-neutral-700 mb-2">
                          Minimum Order Amount
                        </label>
                        <input
                          type="text"
                          value={extras.minimumOrderAmount}
                          onChange={(e) =>
                            handleExtrasChange("minimumOrderAmount", e.target.value)
                          }
                          className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-neutral-900 placeholder-neutral-400 focus:border-[#134f82] focus:outline-none"
                          placeholder="Enter minimum amount"
                        />
                      </div>

                      <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
                        <label className="text-sm font-medium text-neutral-700">
                          Allow Cropping
                        </label>
                        <Toggle
                          checked={extras.allowCropping}
                          onChange={(value) =>
                            handleExtrasChange("allowCropping", value)
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
                        <label className="text-sm font-medium text-neutral-700">
                          Abandoned Cart Email
                        </label>
                        <Toggle
                          checked={extras.enableAbandonedCartEmail}
                          onChange={(value) =>
                            handleExtrasChange("enableAbandonedCartEmail", value)
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
                        <label className="text-sm font-medium text-neutral-700">
                          Show Buy All Button
                        </label>
                        <Toggle
                          checked={extras.showBuyAllButton}
                          onChange={(value) =>
                            handleExtrasChange("showBuyAllButton", value)
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
                        <label className="text-sm font-medium text-neutral-700">
                          Offer Packages Only
                        </label>
                        <Toggle
                          checked={extras.offerPackagesOnly}
                          onChange={(value) =>
                            handleExtrasChange("offerPackagesOnly", value)
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
                        <label className="text-sm font-medium text-neutral-700">
                          Allow Pay Later
                        </label>
                        <Toggle
                          checked={extras.allowClientToPayLater}
                          onChange={(value) =>
                            handleExtrasChange("allowClientToPayLater", value)
                          }
                        />
                      </div>

                      <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
                        <label className="text-sm font-medium text-neutral-700">
                          Allow Client Comments
                        </label>
                        <Toggle
                          checked={extras.allowClientComments}
                          onChange={(value) =>
                            handleExtrasChange("allowClientComments", value)
                          }
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Advanced Section */}
            {activeSection === "advanced" && (
              <div className="rounded-[24px] border border-neutral-200 bg-white p-6 shadow-[0_12px_50px_rgba(15,23,42,0.06)]">
                <h2 className="mb-6 text-xl font-semibold text-neutral-900">
                  Advanced
                </h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
                    <label className="text-sm font-medium text-neutral-700">
                      Hide Photo Count
                    </label>
                    <Toggle
                      checked={extras.hidePhotoCount}
                      onChange={(value) =>
                        handleExtrasChange("hidePhotoCount", value)
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
                    <label className="text-sm font-medium text-neutral-700">
                      Auto-Archive After Expiration
                    </label>
                    <Toggle
                      checked={extras.autoArchiveAfterExpiration}
                      onChange={(value) =>
                        handleExtrasChange("autoArchiveAfterExpiration", value)
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
                    <label className="text-sm font-medium text-neutral-700">
                      Send Email Campaign
                    </label>
                    <Toggle
                      checked={extras.sendEmailCampaign}
                      onChange={(value) =>
                        handleExtrasChange("sendEmailCampaign", value)
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between border-t border-neutral-200 pt-4">
                    <label className="text-sm font-medium text-neutral-700">
                      Auto-Choose Cover
                    </label>
                    <Toggle
                      checked={extras.autoChooseCover}
                      onChange={(value) =>
                        handleExtrasChange("autoChooseCover", value)
                      }
                    />
                  </div>

                  <div className="border-t border-neutral-200 pt-4">
                    <label className="block text-sm font-medium text-neutral-700 mb-2">
                      Internal Notes
                    </label>
                    <textarea
                      value={extras.internalNotes}
                      onChange={(e) =>
                        handleExtrasChange("internalNotes", e.target.value)
                      }
                      className="w-full rounded-lg border border-neutral-300 px-4 py-2 text-neutral-900 placeholder-neutral-400 focus:border-[#134f82] focus:outline-none"
                      placeholder="Add internal notes for this class..."
                      rows={4}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
