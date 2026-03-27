// app/dashboard/packages/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  LogOut, Plus, ArrowLeft, Pencil, Trash2, Package, Printer,
  Download, Sparkles, SquareStack, Copy, MoreVertical, Check, X,
  AlertTriangle, ChevronDown,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type PackageItem =
  | { name?: string; qty?: number | string; type?: string; size?: string; finish?: string }
  | string;

type Pkg = {
  id: string;
  local_id: string | null;
  profile_id: string | null;
  profile_name: string | null;
  name: string;
  description: string | null;
  price_cents: number;
  items: PackageItem[];
  active: boolean;
  category: string | null;
};

type Profile = {
  id: string;
  name: string;
  photographer_id: string | null;
  created_at: string;
  packages: Pkg[];
  count: number;
};

// ── Categories ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { key: "package",   label: "Packages",       icon: Package,  subtitle: "Print bundles",             color: "#f0f9ff", keywords: ["package"] },
  { key: "print",     label: "Prints",          icon: Printer,  subtitle: "Individual prints",         color: "#fefce8", keywords: ["print"] },
  { key: "digital",   label: "Digitals",        icon: Download, subtitle: "Downloads + digital files", color: "#f0fdf4", keywords: ["digital", "download", "usb"] },
  { key: "specialty", label: "Specialty Items", icon: Sparkles, subtitle: "Magnets, mugs, canvas",     color: "#fdf4ff", keywords: ["specialty", "canvas", "magnet", "mug", "metal"] },
];

function getCategoryKey(pkg: Pkg): string {
  const cat = (pkg.category ?? "").toLowerCase().trim();
  if (cat) {
    for (const c of CATEGORIES) {
      if (c.keywords.some(k => cat.includes(k))) return c.key;
    }
  }
  const name = pkg.name.toLowerCase();
  if (name.includes("digital") || name.includes("download") || name.includes("usb")) return "digital";
  if (name.includes("canvas") || name.includes("magnet") || name.includes("mug") ||
      name.includes("ornament") || name.includes("metal") || name.includes("acrylic")) return "specialty";
  if (name.includes("print") || /\d+x\d+/i.test(name)) return "print";
  return "package";
}

function formatItem(item: PackageItem): string {
  if (typeof item === "string") return item;
  const qty = item.qty ? `${item.qty}× ` : "";
  const name = item.name?.trim() || "";
  const size = item.size?.trim() || "";
  const finish = item.finish?.trim() || "";
  return [qty + name, size, finish].filter(Boolean).join(" ");
}

function genProfileId(): string {
  return `profile_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const sidebar: React.CSSProperties = {
  width: 220, minHeight: "100vh", background: "#000", color: "#fff",
  display: "flex", flexDirection: "column", flexShrink: 0,
};
const navItem: React.CSSProperties = {
  padding: "12px 24px", cursor: "pointer", fontSize: 14,
  color: "#ccc", textDecoration: "none", display: "block",
};
const navActive: React.CSSProperties = { ...navItem, color: "#fff", background: "#1a1a1a" };
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", border: "1px solid #e5e5e5",
  borderRadius: 8, fontSize: 14, color: "#111", boxSizing: "border-box",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function PackagesPage() {
  const supabase = createClient();

  // Data
  const [profiles, setProfiles]           = useState<Profile[]>([]);
  const [loading, setLoading]             = useState(true);
  const [pgId, setPgId]                   = useState<string | null>(null);
  const [userEmail, setUserEmail]         = useState("");

  // Navigation
  const [selectedProfile, setSelectedProfile]   = useState<Profile | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Edit item modal
  const [editingPkg, setEditingPkg]   = useState<Pkg | null>(null);
  const [editName, setEditName]       = useState("");
  const [editPrice, setEditPrice]     = useState("");
  const [editDesc, setEditDesc]       = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editItems, setEditItems]     = useState<{ name: string; qty: number }[]>([]);
  const [editActive, setEditActive]   = useState(true);
  const [saving, setSaving]           = useState(false);

  // New price sheet modal
  const [showNewSheet, setShowNewSheet]       = useState(false);
  const [newSheetName, setNewSheetName]       = useState("");
  const [newSheetDupFrom, setNewSheetDupFrom] = useState<string>(""); // profile id to duplicate
  const [creatingSheet, setCreatingSheet]     = useState(false);

  // Rename price sheet
  const [renamingProfile, setRenamingProfile] = useState<Profile | null>(null);
  const [renameValue, setRenameValue]         = useState("");
  const [renaming, setRenaming]               = useState(false);

  // Delete price sheet
  const [deletingProfile, setDeletingProfile] = useState<Profile | null>(null);
  const [deleting, setDeleting]               = useState(false);
  const [deleteUsageInfo, setDeleteUsageInfo] = useState<{ schools: number; projects: number } | null>(null);

  // Profile card menu
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  useEffect(() => { init(); }, []); // eslint-disable-line

  // Outside-click is handled by a transparent backdrop rendered when menu is open

  // ── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setUserEmail(user.email ?? "");

    const { data: pg } = await supabase.from("photographers")
      .select("id").eq("user_id", user.id).maybeSingle();
    if (!pg) { setLoading(false); return; }
    setPgId(pg.id);

    await loadData(pg.id);
  }

  async function loadData(photographerId?: string) {
    const pid = photographerId ?? pgId;
    if (!pid) return;
    setLoading(true);

    // Load profiles and packages in parallel
    const [profilesRes, packagesRes] = await Promise.all([
      supabase.from("package_profiles")
        .select("id,name,photographer_id,created_at")
        .eq("photographer_id", pid)
        .order("created_at"),
      supabase.from("packages")
        .select("*")
        .eq("photographer_id", pid)
        .order("profile_name")
        .order("price_cents"),
    ]);

    const rawProfiles = (profilesRes.data ?? []) as Omit<Profile, "packages" | "count">[];
    const rawPackages = (packagesRes.data ?? []) as Pkg[];

    // Group packages by profile_id
    const pkgsByProfile = new Map<string, Pkg[]>();
    for (const pkg of rawPackages) {
      const key = pkg.profile_id ?? "default";
      if (!pkgsByProfile.has(key)) pkgsByProfile.set(key, []);
      pkgsByProfile.get(key)!.push(pkg);
    }

    const built: Profile[] = rawProfiles.map(p => {
      const pkgs = pkgsByProfile.get(p.id) ?? [];
      return { ...p, packages: pkgs, count: pkgs.length };
    });

    // If packages exist for a profile not in package_profiles (edge case), surface them
    for (const [profileId, pkgs] of pkgsByProfile.entries()) {
      if (!built.find(p => p.id === profileId)) {
        const sample = pkgs[0];
        built.push({
          id: profileId,
          name: sample.profile_name ?? profileId,
          photographer_id: pid,
          created_at: new Date().toISOString(),
          packages: pkgs,
          count: pkgs.length,
        });
      }
    }

    setProfiles(built);

    // Keep selected profile in sync
    if (selectedProfile) {
      const refreshed = built.find(p => p.id === selectedProfile.id);
      if (refreshed) setSelectedProfile(refreshed);
      else { setSelectedProfile(null); setSelectedCategory(null); }
    }

    setLoading(false);
  }

  // ── Price sheet CRUD ───────────────────────────────────────────────────────

  async function createSheet() {
    if (!pgId || !newSheetName.trim()) return;
    setCreatingSheet(true);
    const newId = genProfileId();

    // Insert into package_profiles
    await supabase.from("package_profiles").insert({
      id: newId,
      name: newSheetName.trim(),
      photographer_id: pgId,
    });

    // If duplicating, copy all packages from source profile
    if (newSheetDupFrom) {
      const srcPackages = profiles.find(p => p.id === newSheetDupFrom)?.packages ?? [];
      if (srcPackages.length > 0) {
        const copies = srcPackages.map(pkg => ({
          local_id: `${newId}_${pkg.local_id ?? pkg.id}`,
          photographer_id: pgId,
          profile_id: newId,
          profile_name: newSheetName.trim(),
          name: pkg.name,
          description: pkg.description,
          price_cents: pkg.price_cents,
          items: pkg.items,
          active: pkg.active,
          category: pkg.category,
        }));
        await supabase.from("packages").insert(copies);
      }
    }

    setCreatingSheet(false);
    setShowNewSheet(false);
    setNewSheetName("");
    setNewSheetDupFrom("");
    await loadData();
  }

  async function renameSheet() {
    if (!renamingProfile || !renameValue.trim()) return;
    setRenaming(true);
    await supabase.from("package_profiles")
      .update({ name: renameValue.trim() })
      .eq("id", renamingProfile.id);
    // Update profile_name on all associated packages
    await supabase.from("packages")
      .update({ profile_name: renameValue.trim() })
      .eq("profile_id", renamingProfile.id);
    setRenaming(false);
    setRenamingProfile(null);
    setRenameValue("");
    await loadData();
  }

  async function checkDeleteUsage(profileId: string) {
    const [schoolsRes, projectsRes] = await Promise.all([
      supabase.from("schools").select("id", { count: "exact", head: true }).eq("package_profile_id", profileId),
      supabase.from("projects").select("id", { count: "exact", head: true }).eq("package_profile_id", profileId),
    ]);
    setDeleteUsageInfo({
      schools: schoolsRes.count ?? 0,
      projects: projectsRes.count ?? 0,
    });
  }

  async function deleteSheet() {
    if (!deletingProfile) return;
    setDeleting(true);
    // Delete all packages in this profile first
    await supabase.from("packages").delete().eq("profile_id", deletingProfile.id);
    // Delete the profile
    await supabase.from("package_profiles").delete().eq("id", deletingProfile.id);
    setDeleting(false);
    setDeletingProfile(null);
    setDeleteUsageInfo(null);
    if (selectedProfile?.id === deletingProfile.id) {
      setSelectedProfile(null);
      setSelectedCategory(null);
    }
    await loadData();
  }

  // ── Item CRUD ──────────────────────────────────────────────────────────────

  function openEdit(pkg: Pkg) {
    setEditingPkg(pkg);
    setEditName(pkg.name);
    setEditPrice((pkg.price_cents / 100).toFixed(2));
    setEditDesc(pkg.description || "");
    setEditCategory(getCategoryKey(pkg));
    setEditActive(pkg.active);
    const items = (pkg.items ?? []).map(item => {
      if (typeof item === "string") return { name: item, qty: 1 };
      return { name: item.name?.trim() || "", qty: parseInt(String(item.qty ?? 1)) || 1 };
    });
    setEditItems(items.length > 0 ? items : [{ name: "", qty: 1 }]);
  }

  async function saveEdit() {
    if (!editingPkg) return;
    setSaving(true);
    await supabase.from("packages").update({
      name:        editName.trim(),
      description: editDesc.trim() || null,
      price_cents: Math.round(parseFloat(editPrice) * 100),
      category:    editCategory,
      active:      editActive,
      items:       editItems.filter(i => i.name.trim()).map(i => ({ name: i.name.trim(), qty: i.qty })),
    }).eq("id", editingPkg.id);
    setSaving(false);
    setEditingPkg(null);
    await loadData();
  }

  async function deletePkg(id: string) {
    if (!confirm("Delete this item? This cannot be undone.")) return;
    await supabase.from("packages").delete().eq("id", id);
    await loadData();
  }

  async function addPackage() {
    if (!selectedProfile || !pgId) return;
    const newPkg = {
      name:            "New Item",
      price_cents:     0,
      items:           [],
      active:          true,
      photographer_id: pgId,
      profile_id:      selectedProfile.id,
      profile_name:    selectedProfile.name,
      category:        selectedCategory || "package",
    };
    const { data } = await supabase.from("packages").insert(newPkg).select().single();
    await loadData();
    if (data) openEdit(data as Pkg);
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function categoryCount(profile: Profile, catKey: string) {
    return profile.packages.filter(p => getCategoryKey(p) === catKey).length;
  }
  function categoryMinPrice(profile: Profile, catKey: string) {
    const pkgs = profile.packages.filter(p => getCategoryKey(p) === catKey);
    if (!pkgs.length) return null;
    return Math.min(...pkgs.map(p => p.price_cents)) / 100;
  }

  const pkgsInCategory = selectedProfile?.packages.filter(pkg =>
    !selectedCategory || getCategoryKey(pkg) === selectedCategory
  ) || [];

  const catMeta = CATEGORIES.find(c => c.key === selectedCategory);

  // ── Sidebar ────────────────────────────────────────────────────────────────

  const Sidebar = () => (
    <div style={sidebar}>
      <div style={{ background: "#fff", padding: "20px 24px" }}>
        <span style={{ fontWeight: 800, fontSize: 16, color: "#000" }}>Studio OS</span>
      </div>
      <nav style={{ flex: 1, paddingTop: 16 }}>
        <Link href="/dashboard" style={navItem}>Dashboard</Link>
        <Link href="/dashboard/schools" style={navItem}>Schools</Link>
        <Link href="/dashboard/orders" style={navItem}>Orders</Link>
        <Link href="/dashboard/packages" style={navActive}>Packages</Link>
      </nav>
      <button onClick={signOut} style={{ margin: 16, padding: "10px", background: "transparent", border: "1px solid #333", borderRadius: 8, color: "#ccc", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <LogOut size={14} /> Sign Out
      </button>
    </div>
  );

  // ── Modals ─────────────────────────────────────────────────────────────────

  const Overlay = ({ children }: { children: React.ReactNode }) => (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      {children}
    </div>
  );

  // ── Profile list view ──────────────────────────────────────────────────────

  if (!selectedProfile) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "#f0f0f0" }}>
        <Sidebar />

        <div style={{ flex: 1, padding: "40px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 }}>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "#111" }}>Price Sheets</h1>
              <p style={{ margin: "4px 0 0", color: "#666", fontSize: 14 }}>
                Manage pricing profiles — assign to any school or event project
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, color: "#666" }}>{userEmail}</span>
              <button
                onClick={() => { setNewSheetName(""); setNewSheetDupFrom(""); setShowNewSheet(true); }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "#000", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}
              >
                <Plus size={16} /> New Price Sheet
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ height: 180, background: "#fff", borderRadius: 12, border: "1px solid #e5e5e5", animation: "pulse 1.5s ease-in-out infinite" }} />
              ))}
            </div>
          ) : profiles.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, background: "#fff", borderRadius: 12, border: "2px dashed #e5e5e5" }}>
              <SquareStack size={40} color="#ccc" style={{ marginBottom: 12 }} />
              <p style={{ color: "#666", margin: "0 0 8px", fontWeight: 600 }}>No price sheets yet</p>
              <p style={{ color: "#999", fontSize: 13, margin: "0 0 20px" }}>
                Create a price sheet or sync packages from the Studio OS app.
              </p>
              <button
                onClick={() => { setNewSheetName(""); setNewSheetDupFrom(""); setShowNewSheet(true); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", background: "#000", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}
              >
                <Plus size={16} /> Create Price Sheet
              </button>
            </div>
          ) : (
            <>
            {/* Transparent backdrop — closes any open kebab menu on outside click */}
            {menuOpenId && (
              <div
                style={{ position: "fixed", inset: 0, zIndex: 8 }}
                onClick={() => setMenuOpenId(null)}
              />
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 }}>
              {profiles.map(profile => (
                <div
                  key={profile.id}
                  style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e5e5", position: "relative", transition: "border-color 0.15s, box-shadow 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#cc0000"; e.currentTarget.style.boxShadow = "0 0 0 2px rgba(204,0,0,0.12)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#e5e5e5"; e.currentTarget.style.boxShadow = "none"; }}
                >
                  {/* Top accent bar — rounded top to match card radius */}
                  <div style={{ height: 4, background: "#c00", borderRadius: "12px 12px 0 0" }} />

                  <div style={{ padding: 24 }}>
                    {/* Header row */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                      <h3
                        onClick={() => { setSelectedProfile(profile); setSelectedCategory(null); }}
                        style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#111", cursor: "pointer", flex: 1, paddingRight: 8 }}
                        onMouseEnter={e => (e.currentTarget.style.color = "#cc0000")}
                        onMouseLeave={e => (e.currentTarget.style.color = "#111")}
                      >
                        {profile.name}
                      </h3>

                      {/* Kebab menu */}
                      <div style={{ position: "relative" }}>
                        <button
                          onClick={e => { e.stopPropagation(); setMenuOpenId(menuOpenId === profile.id ? null : profile.id); }}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#999", borderRadius: 4, display: "flex" }}
                        >
                          <MoreVertical size={16} />
                        </button>
                        {menuOpenId === profile.id && (
                          <div style={{ position: "absolute", right: 0, top: "100%", background: "#fff", border: "1px solid #e5e5e5", borderRadius: 8, boxShadow: "0 4px 20px rgba(0,0,0,0.12)", zIndex: 10, width: 180, overflow: "hidden" }}>
                            <button
                              onClick={e => { e.stopPropagation(); setMenuOpenId(null); setSelectedProfile(profile); setSelectedCategory(null); }}
                              style={{ width: "100%", padding: "10px 16px", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#333", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}
                            >
                              <Package size={13} /> Open
                            </button>
                            <button
                              onClick={e => {
                                e.stopPropagation(); setMenuOpenId(null);
                                setRenamingProfile(profile); setRenameValue(profile.name);
                              }}
                              style={{ width: "100%", padding: "10px 16px", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#333", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}
                            >
                              <Pencil size={13} /> Rename
                            </button>
                            <button
                              onClick={e => {
                                e.stopPropagation(); setMenuOpenId(null);
                                setNewSheetName(`${profile.name} (copy)`);
                                setNewSheetDupFrom(profile.id);
                                setShowNewSheet(true);
                              }}
                              style={{ width: "100%", padding: "10px 16px", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#333", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}
                            >
                              <Copy size={13} /> Duplicate
                            </button>
                            <div style={{ borderTop: "1px solid #f0f0f0" }} />
                            <button
                              onClick={e => {
                                e.stopPropagation(); setMenuOpenId(null);
                                setDeletingProfile(profile);
                                setDeleteUsageInfo(null);
                                checkDeleteUsage(profile.id);
                              }}
                              style={{ width: "100%", padding: "10px 16px", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#ef4444", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}
                            >
                              <Trash2 size={13} /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Category breakdown */}
                    <div
                      onClick={() => { setSelectedProfile(profile); setSelectedCategory(null); }}
                      style={{ cursor: "pointer" }}
                    >
                      {profile.count === 0 ? (
                        <p style={{ fontSize: 13, color: "#bbb", margin: "0 0 16px" }}>No items yet — click to add some</p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 16 }}>
                          {CATEGORIES.map(cat => {
                            const count = categoryCount(profile, cat.key);
                            if (count === 0) return null;
                            const Icon = cat.icon;
                            const minP = categoryMinPrice(profile, cat.key);
                            return (
                              <div key={cat.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#666" }}>
                                <Icon size={13} color="#aaa" />
                                <span>{count} {cat.label}</span>
                                {minP !== null && <span style={{ marginLeft: "auto", color: "#999" }}>from ${minP.toFixed(2)}</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Item count badge */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, background: "#f0f0f0", color: "#666", padding: "3px 8px", borderRadius: 20 }}>
                          {profile.count} item{profile.count !== 1 ? "s" : ""}
                        </span>
                        <span style={{ fontSize: 12, color: "#aaa" }}>Click to manage →</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Quick-add card */}
              <div
                onClick={() => { setNewSheetName(""); setNewSheetDupFrom(""); setShowNewSheet(true); }}
                style={{ background: "#fff", borderRadius: 12, border: "2px dashed #e5e5e5", padding: 24, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 180, gap: 8, transition: "border-color 0.15s, background 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#cc0000"; e.currentTarget.style.background = "#fff5f5"; (e.currentTarget.querySelector("span") as HTMLElement).style.color = "#cc0000"; (e.currentTarget.querySelector("svg") as SVGElement).style.color = "#cc0000"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#e5e5e5"; e.currentTarget.style.background = "#fff"; (e.currentTarget.querySelector("span") as HTMLElement).style.color = "#999"; (e.currentTarget.querySelector("svg") as SVGElement).style.color = "#ccc"; }}
              >
                <Plus size={28} color="#ccc" />
                <span style={{ color: "#999", fontSize: 14, fontWeight: 600 }}>New Price Sheet</span>
              </div>
            </div>
            </>
          )}
        </div>

        {/* ── New price sheet modal ── */}
        {showNewSheet && (
          <Overlay>
            <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 460, maxWidth: "100%" }}>
              <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700 }}>New Price Sheet</h2>
              <p style={{ color: "#888", fontSize: 13, margin: "0 0 24px" }}>
                Create a blank sheet or duplicate an existing one.
              </p>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#333" }}>Sheet Name</label>
                <input
                  autoFocus
                  value={newSheetName}
                  onChange={e => setNewSheetName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && createSheet()}
                  placeholder="e.g. Spring 2026 School Pricing"
                  style={inputStyle}
                />
              </div>

              {profiles.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#333" }}>
                    Start from (optional)
                  </label>
                  <div style={{ position: "relative" }}>
                    <select
                      value={newSheetDupFrom}
                      onChange={e => setNewSheetDupFrom(e.target.value)}
                      style={{ ...inputStyle, appearance: "none", paddingRight: 36 }}
                    >
                      <option value="">— Blank sheet —</option>
                      {profiles.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.count} items)</option>
                      ))}
                    </select>
                    <ChevronDown size={15} color="#999" style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                  </div>
                  {newSheetDupFrom && (
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#888" }}>
                      All items from "{profiles.find(p => p.id === newSheetDupFrom)?.name}" will be copied.
                    </p>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={createSheet}
                  disabled={creatingSheet || !newSheetName.trim()}
                  style={{ flex: 1, padding: "12px", background: "#000", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14, opacity: (creatingSheet || !newSheetName.trim()) ? 0.5 : 1 }}
                >
                  {creatingSheet ? "Creating…" : newSheetDupFrom ? "Duplicate & Create" : "Create Sheet"}
                </button>
                <button
                  onClick={() => setShowNewSheet(false)}
                  style={{ flex: 1, padding: "12px", background: "#f5f5f5", color: "#333", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </Overlay>
        )}

        {/* ── Rename modal ── */}
        {renamingProfile && (
          <Overlay>
            <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 400, maxWidth: "100%" }}>
              <h2 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700 }}>Rename Price Sheet</h2>
              <input
                autoFocus
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => e.key === "Enter" && renameSheet()}
                style={{ ...inputStyle, marginBottom: 16 }}
              />
              <div style={{ display: "flex", gap: 12 }}>
                <button onClick={renameSheet} disabled={renaming || !renameValue.trim()}
                  style={{ flex: 1, padding: "12px", background: "#000", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14, opacity: renaming ? 0.5 : 1 }}>
                  {renaming ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setRenamingProfile(null)}
                  style={{ flex: 1, padding: "12px", background: "#f5f5f5", color: "#333", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
                  Cancel
                </button>
              </div>
            </div>
          </Overlay>
        )}

        {/* ── Delete confirmation modal ── */}
        {deletingProfile && (
          <Overlay>
            <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 440, maxWidth: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <AlertTriangle size={20} color="#ef4444" />
                </div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111" }}>Delete Price Sheet?</h2>
              </div>

              <p style={{ color: "#555", fontSize: 14, margin: "0 0 12px", lineHeight: 1.5 }}>
                <strong>"{deletingProfile.name}"</strong> and all <strong>{deletingProfile.count} items</strong> inside it will be permanently deleted.
              </p>

              {deleteUsageInfo === null ? (
                <p style={{ fontSize: 13, color: "#aaa", marginBottom: 20 }}>Checking usage…</p>
              ) : (deleteUsageInfo.schools > 0 || deleteUsageInfo.projects > 0) ? (
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "12px 14px", marginBottom: 20 }}>
                  <p style={{ margin: 0, fontSize: 13, color: "#92400e", fontWeight: 600 }}>
                    ⚠️ This sheet is assigned to:
                  </p>
                  {deleteUsageInfo.schools > 0 && <p style={{ margin: "4px 0 0", fontSize: 13, color: "#92400e" }}>{deleteUsageInfo.schools} school{deleteUsageInfo.schools !== 1 ? "s" : ""}</p>}
                  {deleteUsageInfo.projects > 0 && <p style={{ margin: "4px 0 0", fontSize: 13, color: "#92400e" }}>{deleteUsageInfo.projects} project{deleteUsageInfo.projects !== 1 ? "s" : ""}</p>}
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "#b45309" }}>Their assignment will be cleared on delete.</p>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 20 }}>
                  <Check size={14} color="#22c55e" />
                  <span style={{ fontSize: 13, color: "#666" }}>Not currently assigned to any school or project.</span>
                </div>
              )}

              <div style={{ display: "flex", gap: 12 }}>
                <button onClick={deleteSheet} disabled={deleting || deleteUsageInfo === null}
                  style={{ flex: 1, padding: "12px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14, opacity: (deleting || deleteUsageInfo === null) ? 0.6 : 1 }}>
                  {deleting ? "Deleting…" : "Delete"}
                </button>
                <button onClick={() => { setDeletingProfile(null); setDeleteUsageInfo(null); }}
                  style={{ flex: 1, padding: "12px", background: "#f5f5f5", color: "#333", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
                  Cancel
                </button>
              </div>
            </div>
          </Overlay>
        )}
      </div>
    );
  }

  // ── Category grid view ─────────────────────────────────────────────────────

  if (!selectedCategory) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "#f0f0f0" }}>
        <Sidebar />

        <div style={{ flex: 1, padding: "40px" }}>
          {/* Breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 32, fontSize: 14 }}>
            <button onClick={() => setSelectedProfile(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#666", display: "flex", alignItems: "center", gap: 4 }}>
              <ArrowLeft size={14} /> Price Sheets
            </button>
            <span style={{ color: "#ccc" }}>/</span>
            <span style={{ color: "#111", fontWeight: 700, fontSize: 18 }}>{selectedProfile.name}</span>
            <span style={{ fontSize: 12, background: "#f0f0f0", color: "#666", padding: "3px 8px", borderRadius: 20 }}>
              {selectedProfile.count} items
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
            {CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const count = categoryCount(selectedProfile, cat.key);
              const minP = categoryMinPrice(selectedProfile, cat.key);
              return (
                <div
                  key={cat.key}
                  onClick={() => setSelectedCategory(cat.key)}
                  style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e5e5", overflow: "hidden", cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)")}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}
                >
                  <div style={{ height: 100, background: cat.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={36} color="#aaa" />
                  </div>
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#111", marginBottom: 4 }}>{cat.label}</div>
                    <div style={{ fontSize: 13, color: "#888" }}>
                      {count > 0
                        ? <>{count} item{count !== 1 ? "s" : ""}{minP !== null ? ` · from $${minP.toFixed(2)}` : ""}</>
                        : <span style={{ color: "#ccc" }}>No items yet</span>
                      }
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Item list view ─────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f0f0f0" }}>
      <Sidebar />

      <div style={{ flex: 1, padding: "40px" }}>
        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24, fontSize: 14, color: "#666" }}>
          <button onClick={() => setSelectedProfile(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#666" }}>
            Price Sheets
          </button>
          <span>/</span>
          <button onClick={() => setSelectedCategory(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#666" }}>
            {selectedProfile.name}
          </button>
          <span>/</span>
          <span style={{ color: "#111", fontWeight: 600 }}>{catMeta?.label}</span>
        </div>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: "#111" }}>{catMeta?.label}</h1>
          <button
            onClick={addPackage}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "#000", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}
          >
            <Plus size={16} /> Add Item
          </button>
        </div>

        {/* Edit modal */}
        {editingPkg && (
          <Overlay>
            <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 560, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Edit Item</h2>
                <button onClick={() => setEditingPkg(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#999" }}>
                  <X size={20} />
                </button>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#333" }}>Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} style={inputStyle} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#333" }}>Price ($)</label>
                  <input value={editPrice} onChange={e => setEditPrice(e.target.value)} type="number" step="0.01" style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#333" }}>Category</label>
                  <div style={{ position: "relative" }}>
                    <select value={editCategory} onChange={e => setEditCategory(e.target.value)}
                      style={{ ...inputStyle, appearance: "none", paddingRight: 36 }}>
                      {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <ChevronDown size={15} color="#999" style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#333" }}>Description</label>
                <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Optional description" style={inputStyle} />
              </div>

              {/* Active toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, padding: "12px 14px", background: "#f9f9f9", borderRadius: 8 }}>
                <button
                  onClick={() => setEditActive(!editActive)}
                  style={{ width: 40, height: 22, borderRadius: 11, background: editActive ? "#22c55e" : "#d1d5db", border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s" }}
                >
                  <span style={{ position: "absolute", top: 2, left: editActive ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
                </button>
                <span style={{ fontSize: 13, color: "#555", fontWeight: 500 }}>
                  {editActive ? "Active (visible in app & portal)" : "Inactive (hidden)"}
                </span>
              </div>

              {/* Contents */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>Package Contents</label>
                  <button type="button" onClick={() => setEditItems([...editItems, { name: "", qty: 1 }])}
                    style={{ fontSize: 13, color: "#2563eb", background: "none", border: "none", cursor: "pointer", fontWeight: 500 }}>
                    + Add line
                  </button>
                </div>
                {editItems.map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <input
                      value={item.name}
                      onChange={e => { const n = [...editItems]; n[i] = { ...n[i], name: e.target.value }; setEditItems(n); }}
                      placeholder={`Item ${i + 1} (e.g. 8×10 Lustre Print)`}
                      style={{ flex: 1, padding: "8px 12px", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 14, color: "#111" }}
                    />
                    <input
                      type="number" min="1" value={item.qty}
                      onChange={e => { const n = [...editItems]; n[i] = { ...n[i], qty: parseInt(e.target.value) || 1 }; setEditItems(n); }}
                      style={{ width: 60, padding: "8px 10px", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 14, color: "#111", textAlign: "center" }}
                    />
                    <button type="button" onClick={() => setEditItems(editItems.filter((_, j) => j !== i))}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#ccc", padding: 4 }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                {editItems.length === 0 && (
                  <p style={{ fontSize: 13, color: "#bbb", margin: 0, fontStyle: "italic" }}>No contents listed — add lines above.</p>
                )}
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <button onClick={saveEdit} disabled={saving}
                  style={{ flex: 1, padding: "12px", background: "#000", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14, opacity: saving ? 0.6 : 1 }}>
                  {saving ? "Saving…" : "Save Changes"}
                </button>
                <button onClick={() => setEditingPkg(null)}
                  style={{ flex: 1, padding: "12px", background: "#f5f5f5", color: "#333", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
                  Cancel
                </button>
              </div>
            </div>
          </Overlay>
        )}

        {/* Item list */}
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e5e5", overflow: "hidden" }}>
          {pkgsInCategory.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center" }}>
              {catMeta && <catMeta.icon size={36} color="#ddd" style={{ marginBottom: 12 }} />}
              <p style={{ color: "#999", margin: 0, fontSize: 14, fontWeight: 600 }}>No {catMeta?.label.toLowerCase()} yet</p>
              <p style={{ color: "#bbb", fontSize: 13, marginTop: 6 }}>
                Click "Add Item" above or sync from the Studio OS app.
              </p>
            </div>
          ) : (
            pkgsInCategory.map((pkg, i) => (
              <div
                key={pkg.id}
                style={{
                  display: "flex", alignItems: "center", padding: "16px 20px",
                  borderBottom: i < pkgsInCategory.length - 1 ? "1px solid #f0f0f0" : "none",
                  opacity: pkg.active ? 1 : 0.5,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600, fontSize: 15, color: "#111" }}>{pkg.name}</span>
                    {!pkg.active && (
                      <span style={{ fontSize: 11, background: "#fef2f2", color: "#ef4444", padding: "2px 8px", borderRadius: 20 }}>Inactive</span>
                    )}
                  </div>
                  {pkg.items?.length > 0 && (
                    <div style={{ fontSize: 13, color: "#888" }}>
                      {(pkg.items as PackageItem[]).map((item, j) => (
                        <span key={j}>{formatItem(item)}{j < pkg.items.length - 1 ? " · " : ""}</span>
                      ))}
                    </div>
                  )}
                  {pkg.description && (
                    <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>{pkg.description}</div>
                  )}
                </div>
                <div style={{ fontWeight: 700, fontSize: 17, color: "#111", marginRight: 20, flexShrink: 0 }}>
                  ${(pkg.price_cents / 100).toFixed(2)}
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => openEdit(pkg)}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 14px", background: "#f5f5f5", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#333" }}
                  >
                    <Pencil size={13} /> Edit
                  </button>
                  <button
                    onClick={() => deletePkg(pkg.id)}
                    style={{ padding: "7px 10px", background: "none", border: "1px solid #e5e5e5", borderRadius: 6, cursor: "pointer", color: "#ccc" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
