// app/dashboard/packages/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { LogOut, Plus, ArrowLeft, Pencil, Trash2, Package, Printer, Download, Sparkles, SquareStack } from "lucide-react";

type PackageItem = { name?: string; qty?: number | string; type?: string; size?: string; finish?: string } | string;

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
  packages: Pkg[];
  count: number;
};

const CATEGORIES = [
  { key: "package",   label: "Packages",        icon: Package,      subtitle: "Print bundles",           color: "#f0f9ff", keywords: ["package"] },
  { key: "print",     label: "Prints",           icon: Printer,      subtitle: "Individual prints",       color: "#fefce8", keywords: ["print"] },
  { key: "digital",   label: "Digitals",         icon: Download,     subtitle: "Downloads + digital files", color: "#f0fdf4", keywords: ["digital", "download", "usb"] },
  { key: "specialty", label: "Specialty Items",  icon: Sparkles,     subtitle: "Magnets, mugs, canvas",   color: "#fdf4ff", keywords: ["specialty", "canvas", "magnet", "mug"] },
];

function getCategoryKey(pkg: Pkg): string {
  const cat = (pkg.category ?? "").toLowerCase().trim();
  if (cat) {
    for (const c of CATEGORIES) {
      if (c.keywords.some(k => cat.includes(k))) return c.key;
    }
  }
  // Fallback: sniff name
  const name = pkg.name.toLowerCase();
  if (name.includes("digital") || name.includes("download") || name.includes("usb")) return "digital";
  if (name.includes("canvas") || name.includes("magnet") || name.includes("mug") || name.includes("ornament")) return "specialty";
  if (name.includes("print") || /\d+x\d+/.test(name)) return "print";
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

const sidebar: React.CSSProperties = {
  width: 220, minHeight: "100vh", background: "#000", color: "#fff",
  display: "flex", flexDirection: "column", flexShrink: 0,
};
const navItem: React.CSSProperties = {
  padding: "12px 24px", cursor: "pointer", fontSize: 14,
  color: "#ccc", textDecoration: "none", display: "block",
};
const navActive: React.CSSProperties = { ...navItem, color: "#fff", background: "#1a1a1a" };

export default function PackagesPage() {
  const supabase = createClient();
  const [allPackages, setAllPackages] = useState<Pkg[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pgId, setPgId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");

  // Edit state
  const [editingPkg, setEditingPkg] = useState<Pkg | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editItems, setEditItems] = useState<{ name: string; qty: number }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { init(); }, []); // eslint-disable-line

  async function init() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setUserEmail(user.email ?? "");

    const { data: pg } = await supabase.from("photographers")
      .select("id").eq("user_id", user.id).maybeSingle();
    if (!pg) { setLoading(false); return; }
    setPgId(pg.id);

    await loadPackages(pg.id);
  }

  async function loadPackages(photographerId?: string) {
    const pid = photographerId ?? pgId;
    if (!pid) return;
    setLoading(true);

    const { data } = await supabase
      .from("packages")
      .select("*")
      .eq("photographer_id", pid)
      .order("profile_name")
      .order("price_cents");

    if (data) {
      setAllPackages(data);
      const profileMap = new Map<string, Profile>();
      for (const pkg of data) {
        const profileKey = pkg.profile_id || "default";
        const profileName = pkg.profile_name || "Default";
        if (!profileMap.has(profileKey)) {
          profileMap.set(profileKey, { id: profileKey, name: profileName, packages: [], count: 0 });
        }
        const p = profileMap.get(profileKey)!;
        p.packages.push(pkg);
        p.count++;
      }
      setProfiles(Array.from(profileMap.values()));

      // Refresh selected profile if open
      if (selectedProfile) {
        const refreshed = profileMap.get(selectedProfile.id);
        if (refreshed) setSelectedProfile(refreshed);
      }
    }
    setLoading(false);
  }

  function openEdit(pkg: Pkg) {
    setEditingPkg(pkg);
    setEditName(pkg.name);
    setEditPrice((pkg.price_cents / 100).toFixed(2));
    setEditDesc(pkg.description || "");
    setEditCategory(pkg.category || "package");
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
      name: editName.trim(),
      description: editDesc.trim() || null,
      price_cents: Math.round(parseFloat(editPrice) * 100),
      category: editCategory,
      items: editItems.filter(i => i.name.trim()).map(i => ({ name: i.name, qty: i.qty })),
    }).eq("id", editingPkg.id);
    setSaving(false);
    setEditingPkg(null);
    await loadPackages();
  }

  async function deletePkg(id: string) {
    if (!confirm("Delete this package? This cannot be undone.")) return;
    await supabase.from("packages").delete().eq("id", id);
    await loadPackages();
    setSelectedCategory(null);
  }

  async function addPackage() {
    if (!selectedProfile || !pgId) return;
    await supabase.from("packages").insert({
      name: "New Package",
      price_cents: 0,
      items: [],
      active: true,
      photographer_id: pgId,
      profile_id: selectedProfile.id === "default" ? null : selectedProfile.id,
      profile_name: selectedProfile.name === "Default" ? null : selectedProfile.name,
      category: selectedCategory || "package",
    });
    await loadPackages();
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  // Get packages for selected category
  const pkgsInCategory = selectedProfile?.packages.filter(pkg =>
    !selectedCategory || getCategoryKey(pkg) === selectedCategory
  ) || [];

  // Category counts for the selected profile
  function categoryCount(profile: Profile, catKey: string) {
    return profile.packages.filter(p => getCategoryKey(p) === catKey).length;
  }

  function categoryMinPrice(profile: Profile, catKey: string) {
    const pkgs = profile.packages.filter(p => getCategoryKey(p) === catKey);
    if (!pkgs.length) return null;
    return Math.min(...pkgs.map(p => p.price_cents)) / 100;
  }

  // ── Profile list ────────────────────────────────────────────────────────────
  if (!selectedProfile) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "#f0f0f0" }}>
        <div style={sidebar}>
          <div style={{ background: "#fff", padding: "20px 24px" }}><span style={{ fontWeight: 800, fontSize: 16, color: "#000" }}>Studio OS</span></div>
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

        <div style={{ flex: 1, padding: "40px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
            <div>
              <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "#111" }}>Price Sheets</h1>
              <p style={{ margin: "4px 0 0", color: "#666", fontSize: 14 }}>Pricing profiles synced from Studio OS app</p>
            </div>
            <span style={{ fontSize: 13, color: "#666" }}>{userEmail}</span>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 60, color: "#666" }}>Loading packages…</div>
          ) : profiles.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, background: "#fff", borderRadius: 12, border: "2px dashed #e5e5e5" }}>
              <SquareStack size={40} color="#ccc" style={{ marginBottom: 12 }} />
              <p style={{ color: "#666", margin: "0 0 8px", fontWeight: 600 }}>No packages found</p>
              <p style={{ color: "#999", fontSize: 13, margin: 0 }}>Sync packages from the Studio OS Flutter app to see them here.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 }}>
              {profiles.map(profile => (
                <div
                  key={profile.id}
                  onClick={() => { setSelectedProfile(profile); setSelectedCategory(null); }}
                  style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e5e5", padding: 24, cursor: "pointer", position: "relative", overflow: "hidden" }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.1)")}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}
                >
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: "#000" }} />
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                      <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#111" }}>{profile.name}</h3>
                      <span style={{ fontSize: 12, background: "#f0f0f0", color: "#666", padding: "3px 8px", borderRadius: 20 }}>
                        {profile.count} items
                      </span>
                    </div>
                    {/* Category breakdown */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
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
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Category grid ───────────────────────────────────────────────────────────
  if (!selectedCategory) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", background: "#f0f0f0" }}>
        <div style={sidebar}>
          <div style={{ background: "#fff", padding: "20px 24px" }}><span style={{ fontWeight: 800, fontSize: 16, color: "#000" }}>Studio OS</span></div>
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

        <div style={{ flex: 1, padding: "40px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
            <button onClick={() => setSelectedProfile(null)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: "#666", fontSize: 14 }}>
              <ArrowLeft size={16} /> Price Sheets
            </button>
            <span style={{ color: "#ccc" }}>/</span>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: "#111" }}>{selectedProfile.name}</h1>
            <span style={{ fontSize: 13, background: "#f0f0f0", color: "#666", padding: "4px 10px", borderRadius: 20 }}>
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
                  <div style={{ height: 120, background: cat.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon size={40} color="#aaa" />
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

  // ── Package list in category ─────────────────────────────────────────────────
  const catMeta = CATEGORIES.find(c => c.key === selectedCategory)!;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f0f0f0" }}>
      <div style={sidebar}>
        <div style={{ background: "#fff", padding: "20px 24px" }}><span style={{ fontWeight: 800, fontSize: 16, color: "#000" }}>Studio OS</span></div>
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

      <div style={{ flex: 1, padding: "40px" }}>
        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24, fontSize: 14, color: "#666" }}>
          <button onClick={() => setSelectedProfile(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#666" }}>Price Sheets</button>
          <span>/</span>
          <button onClick={() => setSelectedCategory(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#666" }}>{selectedProfile.name}</button>
          <span>/</span>
          <span style={{ color: "#111", fontWeight: 600 }}>{catMeta.label}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: "#111" }}>{catMeta.label}</h1>
          <button onClick={addPackage} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "#000", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
            <Plus size={16} /> Add Item
          </button>
        </div>

        {/* Edit modal */}
        {editingPkg && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 540, maxHeight: "85vh", overflowY: "auto" }}>
              <h2 style={{ margin: "0 0 24px", fontSize: 18, fontWeight: 700 }}>Edit Package</h2>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#333" }}>Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 14, color: "#111", boxSizing: "border-box" }} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#333" }}>Price ($)</label>
                  <input value={editPrice} onChange={e => setEditPrice(e.target.value)} type="number" step="0.01"
                    style={{ width: "100%", padding: "10px 12px", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 14, color: "#111", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#333" }}>Category</label>
                  <select value={editCategory} onChange={e => setEditCategory(e.target.value)}
                    style={{ width: "100%", padding: "10px 12px", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 14, color: "#111", boxSizing: "border-box" }}>
                    {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#333" }}>Description</label>
                <input value={editDesc} onChange={e => setEditDesc(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 14, color: "#111", boxSizing: "border-box" }} />
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>Contents</label>
                  <button type="button" onClick={() => setEditItems([...editItems, { name: "", qty: 1 }])}
                    style={{ fontSize: 13, color: "#2563eb", background: "none", border: "none", cursor: "pointer" }}>+ Add item</button>
                </div>
                {editItems.map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input value={item.name} onChange={e => { const n = [...editItems]; n[i] = { ...n[i], name: e.target.value }; setEditItems(n); }}
                      style={{ flex: 1, padding: "8px 12px", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 14, color: "#111" }}
                      placeholder="e.g. 8x10 Lustre Print" />
                    <input type="number" min="1" value={item.qty}
                      onChange={e => { const n = [...editItems]; n[i] = { ...n[i], qty: parseInt(e.target.value) || 1 }; setEditItems(n); }}
                      style={{ width: 64, padding: "8px 12px", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 14, color: "#111" }} />
                    <button type="button" onClick={() => setEditItems(editItems.filter((_, j) => j !== i))}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#ccc" }}><Trash2 size={15} /></button>
                  </div>
                ))}
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
          </div>
        )}

        {/* Package list */}
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e5e5", overflow: "hidden" }}>
          {pkgsInCategory.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center" }}>
              <catMeta.icon size={36} color="#ddd" style={{ marginBottom: 12 }} />
              <p style={{ color: "#999", margin: 0, fontSize: 14 }}>No {catMeta.label.toLowerCase()} yet.</p>
              <p style={{ color: "#bbb", fontSize: 13, marginTop: 6 }}>
                Add packages from the Studio OS app and sync, or click &quot;Add Item&quot; above.
              </p>
            </div>
          ) : (
            pkgsInCategory.map((pkg, i) => (
              <div key={pkg.id} style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: i < pkgsInCategory.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 15, color: "#111" }}>{pkg.name}</span>
                    {pkg.category && (
                      <span style={{ fontSize: 11, background: "#f0f0f0", color: "#888", padding: "2px 8px", borderRadius: 20, fontWeight: 500 }}>
                        {CATEGORIES.find(c => c.key === getCategoryKey(pkg))?.label ?? pkg.category}
                      </span>
                    )}
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
                </div>
                <div style={{ fontWeight: 700, fontSize: 17, color: "#111", marginRight: 20, flexShrink: 0 }}>
                  ${(pkg.price_cents / 100).toFixed(2)}
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button onClick={() => openEdit(pkg)}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 14px", background: "#f5f5f5", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#333" }}>
                    <Pencil size={13} /> Edit
                  </button>
                  <button onClick={() => deletePkg(pkg.id)}
                    style={{ padding: "7px 10px", background: "none", border: "1px solid #e5e5e5", borderRadius: 6, cursor: "pointer", color: "#ccc" }}>
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
