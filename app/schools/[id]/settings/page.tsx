"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import {
  ArrowLeft,
  LogOut,
  School,
  Tag,
  Calendar,
  Bell,
  Shield,
  Save,
  Check,
  Users,
  Share2,
  X,
  Send,
  Copy,
  ExternalLink,
  RefreshCw,
  Trash2,
} from "lucide-react";

type SchoolRow = {
  id: string;
  school_name: string;
  photographer_id: string | null;
  package_profile_id: string | null;
  shoot_date: string | null;
  order_due_date: string | null;
  expiration_date: string | null;
  notes: string | null;
  status: string | null;
  access: string | null;
  password_protected: boolean | null;
  email_required: boolean | null;
};

type Profile = { id: string; name: string };

type RegistrationRow = {
  id: string;
  email: string;
  created_at: string;
  notified_at: string | null;
};

const TABS = [
  { key: "general", label: "General", icon: School },
  { key: "access", label: "Access & Privacy", icon: Shield },
  { key: "pricing", label: "Price Sheet", icon: Tag },
  { key: "dates", label: "Dates & Deadlines", icon: Calendar },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "registrations", label: "Pre-Release List", icon: Users },
];

const sidebar: React.CSSProperties = {
  width: 220,
  minHeight: "100vh",
  background: "#000",
  display: "flex",
  flexDirection: "column",
};

const navItem: React.CSSProperties = {
  padding: "12px 24px",
  fontSize: 14,
  color: "#ccc",
  textDecoration: "none",
  display: "block",
};

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: checked ? "#111" : "#ccc",
        cursor: "pointer",
        position: "relative",
        transition: "background 0.2s",
        flexShrink: 0,
        border: "none",
        padding: 0,
      }}
      aria-pressed={checked}
    >
      <div
        style={{
          position: "absolute",
          top: 3,
          left: checked ? 22 : 3,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

function RadioOption({
  label,
  description,
  selected,
  onClick,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "14px 16px",
        border: `2px solid ${selected ? "#111" : "#e5e5e5"}`,
        borderRadius: 10,
        cursor: "pointer",
        marginBottom: 10,
        background: selected ? "#fafafa" : "#fff",
        textAlign: "left",
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          border: `2px solid ${selected ? "#111" : "#ccc"}`,
          background: selected ? "#111" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 1,
          flexShrink: 0,
        }}
      >
        {selected && (
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#fff",
            }}
          />
        )}
      </div>

      <div>
        <div style={{ fontWeight: 600, fontSize: 14, color: "#111" }}>{label}</div>
        {description && (
          <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{description}</div>
        )}
      </div>
    </button>
  );
}

export default function SchoolSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const schoolId = params.id as string;

  const [school, setSchool] = useState<SchoolRow | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "general");
  const [loading, setLoading] = useState(true);

  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [loadingRegs, setLoadingRegs] = useState(false);
  const [deletingRegId, setDeletingRegId] = useState<string | null>(null);

  const [showShare, setShowShare] = useState(false);
  const [shareStep, setShareStep] = useState<"menu" | "registered" | "others" | "copied">("menu");
  const [customEmails, setCustomEmails] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [schoolName, setSchoolName] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("active");
  const [access, setAccess] = useState("private");
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [emailRequired, setEmailRequired] = useState(false);
  const [packageProfileId, setPackageProfileId] = useState("");
  const [shootDate, setShootDate] = useState("");
  const [orderDueDate, setOrderDueDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");

  useEffect(() => {
    loadData();
  }, [schoolId]);

  useEffect(() => {
    if (activeTab === "registrations") {
      loadRegistrations();
    }
  }, [activeTab, schoolId]);

  async function loadData() {
    setLoading(true);

    const { data: s } = await supabase
      .from("schools")
      .select(
        "id,school_name,photographer_id,package_profile_id,shoot_date,order_due_date,expiration_date,notes,status,access,password_protected,email_required",
      )
      .eq("id", schoolId)
      .maybeSingle();

    if (s) {
      setSchool(s);
      setSchoolName(s.school_name || "");
      setNotes(s.notes || "");
      setStatus(s.status || "active");
      setAccess(s.access || "private");
      setPasswordProtected(s.password_protected ?? false);
      setEmailRequired(s.email_required ?? false);
      setPackageProfileId(s.package_profile_id || "");
      setShootDate(s.shoot_date ? s.shoot_date.split("T")[0] : "");
      setOrderDueDate(s.order_due_date ? s.order_due_date.split("T")[0] : "");
      setExpirationDate(s.expiration_date ? s.expiration_date.split("T")[0] : "");
    }

    const { data: pkgs } = await supabase.from("packages").select("profile_id,profile_name");
    const map = new Map<string, string>();
    for (const p of pkgs ?? []) {
      if (p.profile_id && p.profile_name) map.set(p.profile_id, p.profile_name);
    }
    setProfiles(Array.from(map.entries()).map(([id, name]) => ({ id, name })));

    setLoading(false);
  }

  function getPortalLink() {
    if (typeof window === "undefined") return "/parents";
    return `${window.location.origin}/parents?school=${schoolId}`;
  }

  function copyLink() {
    navigator.clipboard.writeText(getPortalLink());
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2500);
    setShareStep("copied");
  }

  async function loadRegistrations() {
    setLoadingRegs(true);

    const { data } = await supabase
      .from("pre_release_registrations")
      .select("id,email,created_at,notified_at")
      .eq("school_id", schoolId)
      .order("created_at", { ascending: false });

    setRegistrations(data ?? []);
    setLoadingRegs(false);
  }

  async function deleteRegistration(id: string) {
    setDeletingRegId(id);

    await supabase.from("pre_release_registrations").delete().eq("id", id);

    setDeletingRegId(null);
    loadRegistrations();
  }

  async function sendToRegistered() {
    setSendingEmail(true);

    await supabase
      .from("pre_release_registrations")
      .update({ notified_at: new Date().toISOString() })
      .eq("school_id", schoolId)
      .is("notified_at", null);

    setSendingEmail(false);
    setEmailSent(true);
    loadRegistrations();
  }

  async function save() {
    setSaving(true);

    const payload = {
      school_name: schoolName,
      package_profile_id: packageProfileId || null,
      shoot_date: shootDate || null,
      order_due_date: orderDueDate || null,
      expiration_date: expirationDate || null,
      notes: notes || null,
      status,
      access,
      password_protected: passwordProtected,
      email_required: emailRequired,
    };

    await supabase.from("schools").update(payload).eq("id", schoolId);

    if (school?.school_name) {
      await supabase.from("schools").update(payload).eq("school_name", school.school_name);
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    loadData();
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        Loading...
      </div>
    );
  }

  const assignedProfile = profiles.find((p) => p.id === packageProfileId);
  const statusColors: Record<string, string> = {
    active: "#16a34a",
    inactive: "#ef4444",
    "pre-released": "#f59e0b",
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f0f0f0" }}>
      <div style={sidebar}>
        <div style={{ background: "#fff", padding: "20px 24px" }}>
          <Logo />
        </div>

        <nav style={{ flex: 1, paddingTop: 16 }}>
          <Link href="/dashboard" style={navItem}>
            Dashboard
          </Link>
          <Link href="/dashboard/schools" style={navItem}>
            Schools
          </Link>
          <Link href="/dashboard/orders" style={navItem}>
            Orders
          </Link>
          <Link href="/dashboard/packages" style={navItem}>
            Packages
          </Link>
        </nav>

        <button
          onClick={signOut}
          style={{
            margin: 16,
            padding: "10px",
            background: "transparent",
            border: "1px solid #333",
            borderRadius: 8,
            color: "#ccc",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
          }}
        >
          <LogOut size={14} /> Sign Out
        </button>
      </div>

      <div style={{ flex: 1, padding: "40px", maxWidth: 720 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 28,
            fontSize: 14,
            color: "#666",
          }}
        >
          <button
            onClick={() => router.back()}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#666",
            }}
          >
            <ArrowLeft size={15} /> Back
          </button>
          <span style={{ color: "#ccc" }}>/</span>
          <span>Schools</span>
          <span style={{ color: "#ccc" }}>/</span>
          <span style={{ color: "#111", fontWeight: 600 }}>{school?.school_name}</span>
          <span style={{ color: "#ccc" }}>/</span>
          <span>Settings</span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 28,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 52,
                height: 52,
                background: "#111",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <School size={24} color="#fff" />
            </div>

            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111" }}>
                {school?.school_name}
              </h1>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <span
                  style={{
                    fontSize: 12,
                    background:
                      status === "active"
                        ? "#f0fdf4"
                        : status === "inactive"
                          ? "#fef2f2"
                          : "#fffbeb",
                    color: statusColors[status] || "#666",
                    padding: "2px 10px",
                    borderRadius: 20,
                    fontWeight: 600,
                    textTransform: "capitalize",
                  }}
                >
                  ● {status}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => {
                setShowShare(true);
                setShareStep("menu");
                setEmailSent(false);
                loadRegistrations();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 18px",
                background: "#fff",
                color: "#111",
                border: "1px solid #e5e5e5",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              <Share2 size={15} /> Share
            </button>

            <button
              onClick={save}
              disabled={saving}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                background: saved ? "#16a34a" : "#000",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
                transition: "background 0.2s",
              }}
            >
              {saved ? (
                <>
                  <Check size={15} /> Saved!
                </>
              ) : saving ? (
                "Saving..."
              ) : (
                <>
                  <Save size={15} /> Save Changes
                </>
              )}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 2,
            marginBottom: 24,
            background: "#e8e8e8",
            padding: 4,
            borderRadius: 10,
            width: "fit-content",
            flexWrap: "wrap",
          }}
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "8px 14px",
                  background: activeTab === tab.key ? "#fff" : "transparent",
                  border: "none",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: activeTab === tab.key ? 600 : 400,
                  color: activeTab === tab.key ? "#111" : "#666",
                  boxShadow:
                    activeTab === tab.key ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                  transition: "all 0.15s",
                }}
              >
                <Icon size={13} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "general" && (
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #e5e5e5",
              padding: 28,
            }}
          >
            <h2 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 700 }}>
              General Settings
            </h2>

            <div style={{ marginBottom: 20 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#333",
                  marginBottom: 7,
                }}
              >
                School Name
              </label>
              <input
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "11px 14px",
                  border: "1px solid #e5e5e5",
                  borderRadius: 8,
                  fontSize: 14,
                  color: "#111",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#333",
                  marginBottom: 7,
                }}
              >
                Internal Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="e.g. Contact: Mrs. Smith | Grade 4–8 | Special instructions..."
                style={{
                  width: "100%",
                  padding: "11px 14px",
                  border: "1px solid #e5e5e5",
                  borderRadius: 8,
                  fontSize: 14,
                  color: "#111",
                  boxSizing: "border-box",
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
              <p style={{ margin: "5px 0 0", fontSize: 12, color: "#999" }}>
                Only visible to you, not parents
              </p>
            </div>
          </div>
        )}

        {activeTab === "access" && (
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #e5e5e5",
              padding: 28,
            }}
          >
            <h2 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700 }}>
              Access & Privacy
            </h2>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "#888" }}>
              Control who can access this school&apos;s parent portal.
            </p>

            <div style={{ marginBottom: 28 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#333",
                  marginBottom: 12,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Status
              </div>

              <RadioOption
                label="Active"
                description="Parents can log in and place orders"
                selected={status === "active"}
                onClick={() => setStatus("active")}
              />
              <RadioOption
                label="Inactive"
                description="Portal is closed — parents cannot log in"
                selected={status === "inactive"}
                onClick={() => setStatus("inactive")}
              />
              <RadioOption
                label="Pre-Released"
                description="Collect parent emails before going live"
                selected={status === "pre-released"}
                onClick={() => setStatus("pre-released")}
              />
            </div>

            <div style={{ marginBottom: 28 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#333",
                  marginBottom: 12,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Portal Access
              </div>

              <RadioOption
                label="Private (PIN required)"
                description="Parents must enter their child's PIN to access"
                selected={access === "private"}
                onClick={() => setAccess("private")}
              />
              <RadioOption
                label="Public"
                description="Anyone with the link can view"
                selected={access === "public"}
                onClick={() => setAccess("public")}
              />
            </div>

            <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 20 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#333",
                  marginBottom: 16,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Options
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 20,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#111" }}>
                    Email required
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                    Require parents to enter their email before viewing
                  </div>
                </div>
                <Toggle checked={emailRequired} onChange={setEmailRequired} />
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#111" }}>
                    Require contact info at checkout
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                    Parents must provide name, email & phone when ordering
                  </div>
                </div>
                <Toggle checked={passwordProtected} onChange={setPasswordProtected} />
              </div>
            </div>
          </div>
        )}

        {activeTab === "pricing" && (
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #e5e5e5",
              padding: 28,
            }}
          >
            <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
              Price Sheet
            </h2>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "#888" }}>
              Choose which pricing profile parents see when ordering for this school.
            </p>

            <RadioOption
              label="No specific profile"
              description="Show all active packages"
              selected={!packageProfileId}
              onClick={() => setPackageProfileId("")}
            />

            {profiles.length === 0 ? (
              <div
                style={{
                  padding: "20px",
                  textAlign: "center",
                  color: "#999",
                  fontSize: 13,
                  border: "1px dashed #e5e5e5",
                  borderRadius: 8,
                }}
              >
                No pricing profiles found — sync packages from Flutter first
              </div>
            ) : (
              profiles.map((profile) => (
                <RadioOption
                  key={profile.id}
                  label={profile.name}
                  description={`Profile ID: ${profile.id}`}
                  selected={packageProfileId === profile.id}
                  onClick={() => setPackageProfileId(profile.id)}
                />
              ))
            )}

            {assignedProfile && (
              <div
                style={{
                  marginTop: 16,
                  padding: "12px 16px",
                  background: "#f0fdf4",
                  borderRadius: 8,
                  fontSize: 13,
                  color: "#16a34a",
                }}
              >
                ✓ Currently showing <strong>{assignedProfile.name}</strong> packages to parents
              </div>
            )}

            <div style={{ marginTop: 16, textAlign: "right" }}>
              <Link
                href="/dashboard/packages"
                style={{ fontSize: 13, color: "#2563eb", textDecoration: "none" }}
              >
                Manage price sheets →
              </Link>
            </div>
          </div>
        )}

        {activeTab === "dates" && (
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #e5e5e5",
              padding: 28,
            }}
          >
            <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
              Dates & Deadlines
            </h2>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "#888" }}>
              Set key dates for this school&apos;s photo session.
            </p>

            {[
              {
                label: "Shoot Date",
                value: shootDate,
                set: setShootDate,
                hint: "The date of the photo session",
              },
              {
                label: "Order Due Date",
                value: orderDueDate,
                set: setOrderDueDate,
                hint: "Deadline for parents to place orders",
              },
              {
                label: "Gallery Expiration Date",
                value: expirationDate,
                set: setExpirationDate,
                hint: "After this date the portal will automatically become inactive — parents can no longer log in",
              },
            ].map((field) => (
              <div key={field.label} style={{ marginBottom: 22 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#333",
                    marginBottom: 7,
                  }}
                >
                  {field.label}
                </label>
                <input
                  type="date"
                  value={field.value}
                  onChange={(e) => field.set(e.target.value)}
                  style={{
                    padding: "11px 14px",
                    border: "1px solid #e5e5e5",
                    borderRadius: 8,
                    fontSize: 14,
                    color: "#111",
                    width: 220,
                  }}
                />
                <p style={{ margin: "5px 0 0", fontSize: 12, color: "#999" }}>
                  {field.hint}
                </p>
              </div>
            ))}

            {expirationDate && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: "12px 16px",
                  fontSize: 13,
                  color: "#dc2626",
                }}
              >
                🔒 This school&apos;s portal will automatically close on{" "}
                <strong>
                  {new Date(expirationDate).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </strong>
              </div>
            )}
          </div>
        )}

        {activeTab === "registrations" && (
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #e5e5e5",
              padding: 28,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                Pre-Release Registrations
              </h2>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  type="button"
                  onClick={loadRegistrations}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "7px 12px",
                    background: "#fff",
                    border: "1px solid #e5e5e5",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#555",
                  }}
                >
                  <RefreshCw size={14} />
                  Refresh
                </button>

                <span
                  style={{
                    fontSize: 13,
                    background: "#f0f0f0",
                    color: "#666",
                    padding: "4px 12px",
                    borderRadius: 20,
                  }}
                >
                  {registrations.length} registered
                </span>
              </div>
            </div>

            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#888" }}>
              Parents who registered to be notified when photos go live. When you&apos;re
              ready, change status to <strong>Active</strong> and send them the portal
              link.
            </p>

            <div
              style={{
                background: "#f8f8f8",
                borderRadius: 8,
                padding: "12px 16px",
                marginBottom: 20,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: "#666",
                  flex: 1,
                  fontFamily: "monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {getPortalLink()}
              </span>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(getPortalLink())}
                style={{
                  padding: "5px 12px",
                  background: "#000",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                Copy Link
              </button>
            </div>

            {loadingRegs ? (
              <div style={{ textAlign: "center", padding: 40, color: "#999" }}>Loading...</div>
            ) : registrations.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: 40,
                  color: "#ccc",
                  border: "1px dashed #e5e5e5",
                  borderRadius: 8,
                }}
              >
                <Users size={32} style={{ marginBottom: 8 }} />
                <p style={{ margin: 0, fontSize: 13 }}>No registrations yet</p>
              </div>
            ) : (
              <div style={{ border: "1px solid #e5e5e5", borderRadius: 8, overflow: "hidden" }}>
                {registrations.map((reg, i) => (
                  <div
                    key={reg.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "12px 16px",
                      borderBottom:
                        i < registrations.length - 1 ? "1px solid #f0f0f0" : "none",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: "50%",
                        background: "#f0f0f0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                        flexShrink: 0,
                      }}
                    >
                      {reg.email[0].toUpperCase()}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          color: "#111",
                          fontWeight: 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {reg.email}
                      </div>
                      <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>
                        Registered {new Date(reg.created_at).toLocaleDateString()}
                      </div>
                    </div>

                    {reg.notified_at ? (
                      <span
                        style={{
                          fontSize: 12,
                          background: "#f0fdf4",
                          color: "#16a34a",
                          padding: "3px 10px",
                          borderRadius: 20,
                          whiteSpace: "nowrap",
                        }}
                      >
                        ✓ Notified
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: 12,
                          background: "#fffbeb",
                          color: "#92400e",
                          padding: "3px 10px",
                          borderRadius: 20,
                          whiteSpace: "nowrap",
                        }}
                      >
                        Pending
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => deleteRegistration(reg.id)}
                      disabled={deletingRegId === reg.id}
                      style={{
                        marginLeft: 6,
                        width: 34,
                        height: 34,
                        borderRadius: 8,
                        border: "1px solid #e5e5e5",
                        background: "#fff",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#666",
                        flexShrink: 0,
                        opacity: deletingRegId === reg.id ? 0.5 : 1,
                      }}
                      title="Delete registration"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "notifications" && (
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              border: "1px solid #e5e5e5",
              padding: 28,
            }}
          >
            <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 700 }}>
              Notifications
            </h2>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "#888" }}>
              Coming soon — email reminders and order alerts per school.
            </p>
            <div style={{ padding: "40px 0", textAlign: "center", color: "#ccc" }}>
              <Bell size={40} style={{ marginBottom: 12 }} />
              <p style={{ margin: 0, fontSize: 14 }}>
                Notification settings coming in a future update
              </p>
            </div>
          </div>
        )}
      </div>

      {showShare && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              width: "100%",
              maxWidth: 480,
              overflow: "hidden",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "20px 24px",
                borderBottom: "1px solid #f0f0f0",
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111" }}>
                  Share School Portal
                </h2>
                <p style={{ margin: "3px 0 0", fontSize: 13, color: "#888" }}>
                  {school?.school_name}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowShare(false);
                  setShareStep("menu");
                  setEmailSent(false);
                }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#999",
                  padding: 4,
                }}
              >
                <X size={20} />
              </button>
            </div>

            {shareStep === "menu" && (
              <div style={{ padding: "8px 0" }}>
                {[
                  {
                    icon: <Users size={22} color="#6366f1" />,
                    bg: "#eef2ff",
                    label: "Email registered parents",
                    sub: `${registrations.filter((r) => !r.notified_at).length} pending notification${registrations.filter((r) => !r.notified_at).length !== 1 ? "s" : ""}`,
                    action: () => {
                      setShareStep("registered");
                      loadRegistrations();
                    },
                  },
                  {
                    icon: <Send size={22} color="#0ea5e9" />,
                    bg: "#e0f2fe",
                    label: "Email others",
                    sub: "Send portal link to specific emails",
                    action: () => setShareStep("others"),
                  },
                  {
                    icon: <Copy size={22} color="#16a34a" />,
                    bg: "#f0fdf4",
                    label: "Copy portal link",
                    sub: getPortalLink(),
                    action: copyLink,
                  },
                ].map((item, i) => (
                  <button
                    key={i}
                    onClick={item.action}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      padding: "16px 24px",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      borderBottom: i < 2 ? "1px solid #f5f5f5" : "none",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#fafafa")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: item.bg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {item.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15, color: "#111" }}>
                        {item.label}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#999",
                          marginTop: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.sub}
                      </div>
                    </div>
                    <ExternalLink size={16} color="#ccc" />
                  </button>
                ))}

                <div style={{ padding: "16px 24px" }}>
                  <button
                    onClick={() => setShowShare(false)}
                    style={{
                      width: "100%",
                      padding: "11px",
                      background: "#f5f5f5",
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 14,
                      color: "#666",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {shareStep === "registered" && (
              <div style={{ padding: 24 }}>
                <button
                  onClick={() => setShareStep("menu")}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#666",
                    fontSize: 13,
                    marginBottom: 16,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  ← Back
                </button>

                <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "#111" }}>
                  Email Registered Parents
                </h3>
                <p style={{ margin: "0 0 20px", fontSize: 13, color: "#888" }}>
                  This will mark all pending registrations as notified. Send them this
                  link in your email client:
                </p>

                <div
                  style={{
                    background: "#f8f8f8",
                    borderRadius: 8,
                    padding: "12px 14px",
                    marginBottom: 20,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontFamily: "monospace",
                      color: "#333",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {getPortalLink()}
                  </span>
                  <button
                    onClick={copyLink}
                    style={{
                      padding: "5px 12px",
                      background: "#000",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {linkCopied ? "Copied!" : "Copy"}
                  </button>
                </div>

                <div
                  style={{
                    border: "1px solid #e5e5e5",
                    borderRadius: 8,
                    overflow: "hidden",
                    marginBottom: 20,
                    maxHeight: 200,
                    overflowY: "auto",
                  }}
                >
                  {registrations.length === 0 ? (
                    <div style={{ padding: "20px", textAlign: "center", color: "#999", fontSize: 13 }}>
                      No registrations yet
                    </div>
                  ) : (
                    registrations.map((reg, i) => (
                      <div
                        key={reg.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 14px",
                          borderBottom:
                            i < registrations.length - 1 ? "1px solid #f5f5f5" : "none",
                        }}
                      >
                        <span style={{ fontSize: 13, color: "#111" }}>{reg.email}</span>
                        {reg.notified_at ? (
                          <span
                            style={{
                              fontSize: 11,
                              color: "#16a34a",
                              background: "#f0fdf4",
                              padding: "2px 8px",
                              borderRadius: 20,
                            }}
                          >
                            ✓ Notified
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 11,
                              color: "#f59e0b",
                              background: "#fffbeb",
                              padding: "2px 8px",
                              borderRadius: 20,
                            }}
                          >
                            Pending
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {emailSent ? (
                  <div
                    style={{
                      background: "#f0fdf4",
                      border: "1px solid #bbf7d0",
                      borderRadius: 8,
                      padding: "12px 16px",
                      textAlign: "center",
                      fontSize: 14,
                      color: "#16a34a",
                      fontWeight: 600,
                    }}
                  >
                    ✓ All registrations marked as notified!
                  </div>
                ) : (
                  <button
                    onClick={sendToRegistered}
                    disabled={sendingEmail || registrations.filter((r) => !r.notified_at).length === 0}
                    style={{
                      width: "100%",
                      padding: "12px",
                      background: "#111",
                      color: "#fff",
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 14,
                      fontWeight: 600,
                      opacity:
                        registrations.filter((r) => !r.notified_at).length === 0 ? 0.4 : 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <Send size={15} />
                    {sendingEmail
                      ? "Marking..."
                      : `Mark ${registrations.filter((r) => !r.notified_at).length} as Notified`}
                  </button>
                )}
              </div>
            )}

            {shareStep === "others" && (
              <div style={{ padding: 24 }}>
                <button
                  onClick={() => setShareStep("menu")}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#666",
                    fontSize: 13,
                    marginBottom: 16,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  ← Back
                </button>

                <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "#111" }}>
                  Email Others
                </h3>
                <p style={{ margin: "0 0 20px", fontSize: 13, color: "#888" }}>
                  Copy the portal link and paste it into your email to send to specific
                  parents.
                </p>

                <div
                  style={{
                    background: "#f8f8f8",
                    borderRadius: 8,
                    padding: "12px 14px",
                    marginBottom: 16,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontFamily: "monospace",
                      color: "#333",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {getPortalLink()}
                  </span>
                  <button
                    onClick={copyLink}
                    style={{
                      padding: "5px 12px",
                      background: "#000",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {linkCopied ? "✓ Copied!" : "Copy"}
                  </button>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#555",
                      marginBottom: 6,
                    }}
                  >
                    Email addresses (comma separated)
                  </label>
                  <textarea
                    value={customEmails}
                    onChange={(e) => setCustomEmails(e.target.value)}
                    rows={3}
                    placeholder="parent1@email.com, parent2@email.com"
                    style={{
                      width: "100%",
                      border: "1px solid #e5e5e5",
                      borderRadius: 8,
                      padding: "10px 12px",
                      fontSize: 13,
                      color: "#111",
                      boxSizing: "border-box",
                      resize: "none",
                      fontFamily: "inherit",
                    }}
                  />
                </div>

                <a
                  href={`mailto:${customEmails}?subject=Your child's photos are ready!&body=Hi!%0A%0AYour child's school photos are now available. Visit the link below to view and order:%0A%0A${encodeURIComponent(getPortalLink())}%0A%0AYou'll need to select your school and enter your child's PIN from the photo envelope.%0A%0AThank you!`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    width: "100%",
                    padding: "12px",
                    background: "#111",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: "none",
                    boxSizing: "border-box",
                  }}
                >
                  <Send size={15} /> Open in Mail App
                </a>
              </div>
            )}

            {shareStep === "copied" && (
              <div style={{ padding: "40px 24px", textAlign: "center" }}>
                <div
                  style={{
                    width: 60,
                    height: 60,
                    background: "#f0fdf4",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 16px",
                  }}
                >
                  <Check size={28} color="#16a34a" />
                </div>

                <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: "#111" }}>
                  Link Copied!
                </h3>
                <p style={{ margin: "0 0 6px", fontSize: 13, color: "#888" }}>
                  Portal link is in your clipboard:
                </p>
                <p
                  style={{
                    margin: "0 0 24px",
                    fontSize: 12,
                    fontFamily: "monospace",
                    color: "#555",
                    background: "#f8f8f8",
                    padding: "8px 12px",
                    borderRadius: 6,
                  }}
                >
                  {getPortalLink()}
                </p>

                <button
                  onClick={() => setShareStep("menu")}
                  style={{
                    padding: "10px 24px",
                    background: "#f5f5f5",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontSize: 14,
                    color: "#666",
                  }}
                >
                  ← Back
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}