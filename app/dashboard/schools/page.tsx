// app/dashboard/schools/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import { LogOut, School, ChevronDown, Check } from "lucide-react";

type School = {
  id: string;
  school_name: string;
  photographer_id: string | null;
  package_profile_id: string | null;
  created_at: string;
};

type Profile = {
  id: string;
  name: string;
};

const sidebar: React.CSSProperties = {
  width: 220, minHeight: "100vh", background: "#000",
  display: "flex", flexDirection: "column",
};
const navItem: React.CSSProperties = {
  padding: "12px 24px", fontSize: 14, color: "#ccc",
  textDecoration: "none", display: "block",
};
const navActive: React.CSSProperties = { ...navItem, color: "#fff", background: "#1a1a1a" };

export default function SchoolsPage() {
  const supabase = createClient();
  const [schools, setSchools] = useState<School[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);

    // Load schools (deduplicated by name, keep latest)
    const { data: schoolData } = await supabase
      .from("schools")
      .select("id, school_name, photographer_id, package_profile_id, created_at")
      .order("school_name");

    // Deduplicate by school_name keeping the one with package_profile_id set, or latest
    const seen = new Map<string, School>();
    for (const s of schoolData ?? []) {
      const key = s.school_name?.toLowerCase().trim();
      if (!seen.has(key) || s.package_profile_id) {
        seen.set(key, s);
      }
    }
    setSchools(Array.from(seen.values()));

    // Load unique profiles from packages table
    const { data: pkgData } = await supabase
      .from("packages")
      .select("profile_id, profile_name");

    const profileMap = new Map<string, string>();
    for (const p of pkgData ?? []) {
      if (p.profile_id && p.profile_name) {
        profileMap.set(p.profile_id, p.profile_name);
      }
    }
    setProfiles(Array.from(profileMap.entries()).map(([id, name]) => ({ id, name })));

    setLoading(false);
  }

  async function assignProfile(schoolId: string, profileId: string | null) {
    setSaving(schoolId);
    
    // Update ALL schools with same name (handles Flutter duplicates)
    const school = schools.find(s => s.id === schoolId);
    if (school) {
      await supabase
        .from("schools")
        .update({ package_profile_id: profileId })
        .eq("school_name", school.school_name);
    }

    setSaving(null);
    setSaved(schoolId);
    setOpenDropdown(null);
    setTimeout(() => setSaved(null), 2000);
    loadData();
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  const getProfileName = (profileId: string | null) => {
    if (!profileId) return null;
    return profiles.find(p => p.id === profileId)?.name ?? null;
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f0f0f0" }}>
      {/* Sidebar */}
      <div style={sidebar}>
        <div style={{ background: "#fff", padding: "20px 24px" }}><Logo /></div>
        <nav style={{ flex: 1, paddingTop: 16 }}>
          <Link href="/dashboard" style={navItem}>Dashboard</Link>
          <Link href="/dashboard/schools" style={navActive}>Schools</Link>
          <Link href="/dashboard/orders" style={navItem}>Orders</Link>
          <Link href="/dashboard/packages" style={navItem}>Packages</Link>
          <Link href="/dashboard/settings" style={navItem}>Settings</Link>
        </nav>
        <button onClick={signOut} style={{ margin: 16, padding: "10px", background: "transparent", border: "1px solid #333", borderRadius: 8, color: "#ccc", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <LogOut size={14} /> Sign Out
        </button>
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: "40px" }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "#111" }}>Schools</h1>
          <p style={{ margin: "6px 0 0", color: "#666", fontSize: 14 }}>
            Assign a pricing profile to each school — parents will see that school's specific packages.
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#666" }}>Loading...</div>
        ) : schools.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, background: "#fff", borderRadius: 12, border: "2px dashed #e5e5e5" }}>
            <School size={40} color="#ccc" style={{ marginBottom: 12 }} />
            <p style={{ color: "#666" }}>No schools found. Sync from Flutter first.</p>
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e5e5", overflow: "hidden" }}>
            {/* Header row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 200px", padding: "12px 20px", borderBottom: "1px solid #e5e5e5", background: "#f8f8f8" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em" }}>School Name</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em" }}>Assigned Price Sheet</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em" }}>Action</span>
            </div>

            {schools.map((school, i) => {
              const assignedName = getProfileName(school.package_profile_id);
              const isOpen = openDropdown === school.id;

              return (
                <div key={school.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 200px", padding: "16px 20px", borderBottom: i < schools.length - 1 ? "1px solid #f0f0f0" : "none", alignItems: "center", position: "relative" }}>
                  {/* School name */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: "#f0f0f0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <School size={18} color="#666" />
                    </div>
                    <span style={{ fontWeight: 600, fontSize: 15, color: "#111" }}>{school.school_name}</span>
                  </div>

                  {/* Assigned profile */}
                  <div>
                    {assignedName ? (
                      <span style={{ fontSize: 13, background: "#f0fdf4", color: "#16a34a", padding: "4px 12px", borderRadius: 20, fontWeight: 500 }}>
                        ✓ {assignedName}
                      </span>
                    ) : (
                      <span style={{ fontSize: 13, color: "#999", fontStyle: "italic" }}>No price sheet assigned</span>
                    )}
                  </div>

                  {/* Dropdown */}
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={() => setOpenDropdown(isOpen ? null : school.id)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "#f5f5f5", border: "1px solid #e5e5e5", borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#333", fontWeight: 500 }}
                    >
                      {saving === school.id ? "Saving..." : saved === school.id ? "✓ Saved!" : "Assign Price Sheet"}
                      <ChevronDown size={14} />
                    </button>

                    {isOpen && (
                      <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#fff", border: "1px solid #e5e5e5", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 50, minWidth: 220, overflow: "hidden" }}>
                        {/* No profile option */}
                        <button
                          onClick={() => assignProfile(school.id, null)}
                          style={{ width: "100%", padding: "10px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontSize: 13, color: "#666", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #f0f0f0" }}
                        >
                          <span style={{ width: 16 }}>{!school.package_profile_id ? "✓" : ""}</span>
                          No specific profile (show all)
                        </button>

                        {profiles.length === 0 ? (
                          <div style={{ padding: "12px 16px", fontSize: 13, color: "#999" }}>
                            No profiles yet — sync packages from Flutter first
                          </div>
                        ) : (
                          profiles.map(profile => (
                            <button
                              key={profile.id}
                              onClick={() => assignProfile(school.id, profile.id)}
                              style={{ width: "100%", padding: "10px 16px", background: school.package_profile_id === profile.id ? "#f0fdf4" : "none", border: "none", cursor: "pointer", textAlign: "left", fontSize: 13, color: "#111", display: "flex", alignItems: "center", gap: 8, fontWeight: school.package_profile_id === profile.id ? 600 : 400 }}
                            >
                              <span style={{ width: 16, color: "#16a34a" }}>{school.package_profile_id === profile.id ? "✓" : ""}</span>
                              {profile.name}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Info box */}
        <div style={{ marginTop: 24, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "14px 18px", fontSize: 13, color: "#92400e" }}>
          💡 <strong>How it works:</strong> When a parent enters their PIN on the portal, they'll see only the packages assigned to their school's price sheet. If no price sheet is assigned, all active packages will be shown.
        </div>
      </div>

      {/* Close dropdowns on outside click */}
      {openDropdown && (
        <div onClick={() => setOpenDropdown(null)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
      )}
    </div>
  );
}
