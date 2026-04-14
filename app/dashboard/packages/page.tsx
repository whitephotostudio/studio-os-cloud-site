// app/dashboard/packages/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getPackageCategory, type PackageCategory } from "@/lib/package-categories";
import {
  LogOut, Plus, ArrowLeft, Pencil, Trash2, Package, Printer,
  Download, Sparkles, SquareStack, Copy, MoreVertical, Check, X, Square,
  AlertTriangle, ChevronDown, GripVertical, FileDown,
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
  sort_order: number | null;
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

const CATEGORIES: Array<{
  key: PackageCategory;
  label: string;
  icon: typeof Package;
  subtitle: string;
  color: string;
}> = [
  { key: "package", label: "Packages", icon: Package, subtitle: "Bundles (prints + wallets)", color: "#eef7ff" },
  { key: "print", label: "Prints", icon: Printer, subtitle: "Individual print items", color: "#fff7d9" },
  { key: "digital", label: "Digitals", icon: Download, subtitle: "Downloads + digital files", color: "#edf9f1" },
  { key: "specialty", label: "Specialty Items", icon: Sparkles, subtitle: "Magnets, mugs, ornaments...", color: "#fbf0fb" },
  { key: "metal", label: "Metal Prints", icon: SquareStack, subtitle: "Metal products", color: "#f2f4f7" },
  { key: "canvas", label: "Canvases", icon: Square, subtitle: "Canvas products", color: "#f7f3ea" },
];

const PRINT_SIZES = [
  { value: "4x6",       label: "4×6" },
  { value: "5x7",       label: "5×7" },
  { value: "8x10",      label: "8×10" },
  { value: "8_wallets", label: "8 Wallets" },
  { value: "11x14",     label: "11×14" },
  { value: "16x20",     label: "16×20" },
  { value: "20x24",     label: "20×24" },
  { value: "24x30",     label: "24×30" },
  { value: "custom",    label: "Custom Size" },
];

// ── Package Pack Presets ──────────────────────────────────────────────────────

type PackagePreset = {
  name: string;
  description: string;
  priceCents: number;
  items: { name: string; qty: number }[];
};

type PackagePack = {
  id: string;
  label: string;
  description: string;
  presets: PackagePreset[];
};

const PACKAGE_PACKS: PackagePack[] = [
  {
    id: "basic_bundle",
    label: "Basic Print Bundles",
    description: "Simple combos of popular print sizes — great as a starting point.",
    presets: [
      { name: "Package A — 1 5×7 + 1 8×10", description: "One 5×7 and one 8×10 print", priceCents: 3500, items: [{ name: "5×7 Print", qty: 1 }, { name: "8×10 Print", qty: 1 }] },
      { name: "Package B — 2 5×7 + 1 8×10", description: "Two 5×7s and one 8×10 print", priceCents: 5000, items: [{ name: "5×7 Print", qty: 2 }, { name: "8×10 Print", qty: 1 }] },
      { name: "Package C — 2 5×7 + 2 8×10", description: "Two 5×7s and two 8×10 prints", priceCents: 7500, items: [{ name: "5×7 Print", qty: 2 }, { name: "8×10 Print", qty: 2 }] },
    ],
  },
  {
    id: "school_essentials",
    label: "School Photo Essentials",
    description: "Classic school photography packages parents expect.",
    presets: [
      { name: "Economy Pack", description: "Two wallet-size and one 5×7", priceCents: 2500, items: [{ name: "Wallet Sheet (8 wallets)", qty: 1 }, { name: "5×7 Print", qty: 1 }] },
      { name: "Standard Pack", description: "Two 5×7s, one 8×10, and wallets", priceCents: 4500, items: [{ name: "Wallet Sheet (8 wallets)", qty: 1 }, { name: "5×7 Print", qty: 2 }, { name: "8×10 Print", qty: 1 }] },
      { name: "Deluxe Pack", description: "The full set — large print, medium prints, wallets", priceCents: 6500, items: [{ name: "Wallet Sheet (8 wallets)", qty: 1 }, { name: "5×7 Print", qty: 2 }, { name: "8×10 Print", qty: 2 }, { name: "11×14 Print", qty: 1 }] },
      { name: "Ultimate Pack", description: "Everything plus a wall portrait", priceCents: 9500, items: [{ name: "Wallet Sheet (8 wallets)", qty: 2 }, { name: "5×7 Print", qty: 3 }, { name: "8×10 Print", qty: 2 }, { name: "11×14 Print", qty: 1 }, { name: "16×20 Print", qty: 1 }] },
    ],
  },
  {
    id: "family_portrait",
    label: "Family / Portrait Sessions",
    description: "Packages for portrait sessions, family shoots, and senior photos.",
    presets: [
      { name: "Mini Session", description: "One 8×10 and four wallets", priceCents: 3500, items: [{ name: "8×10 Print", qty: 1 }, { name: "Wallet Sheet (8 wallets)", qty: 1 }] },
      { name: "Portrait Collection", description: "One 11×14, two 8×10, and two 5×7", priceCents: 8500, items: [{ name: "5×7 Print", qty: 2 }, { name: "8×10 Print", qty: 2 }, { name: "11×14 Print", qty: 1 }] },
      { name: "Premium Portrait", description: "Wall art plus prints and wallets", priceCents: 15000, items: [{ name: "Wallet Sheet (8 wallets)", qty: 2 }, { name: "5×7 Print", qty: 4 }, { name: "8×10 Print", qty: 3 }, { name: "11×14 Print", qty: 1 }, { name: "16×20 Print", qty: 1 }] },
    ],
  },
  {
    id: "event_coverage",
    label: "Event / Sports Packages",
    description: "Quick-sell packages for sports, dance, and event photography.",
    presets: [
      { name: "Single Pose", description: "One 8×10 and one 5×7", priceCents: 3000, items: [{ name: "5×7 Print", qty: 1 }, { name: "8×10 Print", qty: 1 }] },
      { name: "Team + Individual", description: "Group print and individual prints", priceCents: 5000, items: [{ name: "5×7 Team Photo", qty: 1 }, { name: "5×7 Print", qty: 2 }, { name: "8×10 Print", qty: 1 }] },
      { name: "Sports Memory Mate", description: "Memory mate composite with extras", priceCents: 4000, items: [{ name: "8×10 Memory Mate", qty: 1 }, { name: "Wallet Sheet (8 wallets)", qty: 1 }, { name: "5×7 Print", qty: 1 }] },
    ],
  },
  {
    id: "digital_bundles",
    label: "Digital Download Bundles",
    description: "Digital-only packages for clients who want files, not prints.",
    presets: [
      { name: "Single Digital", description: "One high-resolution digital download", priceCents: 1500, items: [{ name: "High-Res Digital Download", qty: 1 }] },
      { name: "5 Digitals Bundle", description: "Five retouched digital files", priceCents: 5000, items: [{ name: "High-Res Digital Download", qty: 5 }] },
      { name: "Full Gallery Digital", description: "All images from the session as digital downloads", priceCents: 12000, items: [{ name: "Full Gallery Digital Download", qty: 1 }] },
    ],
  },
];

function matchSizePreset(name: string): string {
  const n = name.trim().toLowerCase().replace(/×/g, "x");
  for (const s of PRINT_SIZES) {
    if (s.value === "custom") continue;
    if (n === s.label.toLowerCase().replace(/×/g, "x") || n === s.value) return s.value;
  }
  return "custom";
}

function getCategoryKey(pkg: Pkg): PackageCategory {
  return getPackageCategory(pkg);
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
  const [editSizePreset, setEditSizePreset] = useState("custom");
  const [saving, setSaving]           = useState(false);

  // Drag-to-reorder
  const [dragIdx, setDragIdx]     = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Search & bulk tools
  const [searchQuery, setSearchQuery]     = useState("");
  const [showBulkAdjust, setShowBulkAdjust] = useState(false);
  const [bulkPercent, setBulkPercent]       = useState("");

  // Package pack modal
  const [showPackPicker, setShowPackPicker]   = useState(false);
  const [selectedPack, setSelectedPack]       = useState<PackagePack | null>(null);
  const [packSelections, setPackSelections]   = useState<Set<number>>(new Set());
  const [insertingPack, setInsertingPack]     = useState(false);

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

  // Default profile
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);

  // Outside-click is handled by a transparent backdrop rendered when menu is open

  // ── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setUserEmail(user.email ?? "");

    const { data: pg } = await supabase.from("photographers")
      .select("id,default_package_profile_id").eq("user_id", user.id).maybeSingle();
    if (!pg) { setLoading(false); return; }
    setPgId(pg.id);
    setDefaultProfileId((pg as Record<string, unknown>).default_package_profile_id as string | null ?? null);

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
        .order("sort_order", { ascending: true, nullsFirst: false })
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
    setEditSizePreset(matchSizePreset(pkg.name));
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

  async function handleDrop(categoryPkgs: Pkg[], fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) { setDragIdx(null); setDragOverIdx(null); return; }
    const reordered = [...categoryPkgs];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    // Optimistic UI: update sort_order in profiles so the sorted list re-renders immediately
    setProfiles(prev => prev.map(profile => {
      if (profile.id !== selectedProfile?.id) return profile;
      const newPackages = [...profile.packages];
      for (let idx = 0; idx < reordered.length; idx++) {
        const pkgIndex = newPackages.findIndex(p => p.id === reordered[idx].id);
        if (pkgIndex >= 0) newPackages[pkgIndex] = { ...newPackages[pkgIndex], sort_order: idx };
      }
      return { ...profile, packages: newPackages };
    }));
    setDragIdx(null);
    setDragOverIdx(null);

    // Persist to DB
    await Promise.all(
      reordered.map((pkg, idx) =>
        supabase.from("packages").update({ sort_order: idx }).eq("id", pkg.id)
      )
    );
  }

  async function deletePkg(id: string) {
    if (!confirm("Delete this item? This cannot be undone.")) return;
    await supabase.from("packages").delete().eq("id", id);
    await loadData();
  }

  function exportPriceListPDF() {
    if (!selectedProfile) return;
    const allPkgs = selectedProfile.packages.filter(p => p.active);
    const grouped = new Map<string, Pkg[]>();
    for (const pkg of allPkgs) {
      const cat = getCategoryKey(pkg);
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(pkg);
    }

    const catSections = CATEGORIES
      .filter(cat => grouped.has(cat.key) && grouped.get(cat.key)!.length > 0)
      .map(cat => {
        const pkgs = grouped.get(cat.key)!.sort((a, b) => a.price_cents - b.price_cents);
        const rows = pkgs.map(pkg => {
          const itemDesc = (pkg.items || []).map(item => {
            if (typeof item === "string") return item;
            const qty = item.qty ? `${item.qty}× ` : "";
            return `${qty}${item.name || item.size || ""}`.trim();
          }).filter(Boolean).join(", ");
          return `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:500">${pkg.name}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;font-size:13px">${itemDesc || pkg.description || ""}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600">$${(pkg.price_cents / 100).toFixed(2)}</td>
          </tr>`;
        }).join("");
        return `<h2 style="margin:28px 0 10px;font-size:17px;color:#111;border-bottom:2px solid #111;padding-bottom:6px">${cat.label}</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
            <thead><tr style="background:#f8f8f8">
              <th style="padding:8px 12px;text-align:left;font-size:13px;color:#555;font-weight:600">Item</th>
              <th style="padding:8px 12px;text-align:left;font-size:13px;color:#555;font-weight:600">Details</th>
              <th style="padding:8px 12px;text-align:right;font-size:13px;color:#555;font-weight:600">Price</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
      }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>${selectedProfile.name} — Price List</title>
      <style>@media print { body { -webkit-print-color-adjust: exact; } } body { font-family: -apple-system, system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #111; }</style>
    </head><body>
      <div style="text-align:center;margin-bottom:32px">
        <h1 style="margin:0 0 6px;font-size:26px">${selectedProfile.name}</h1>
        <p style="margin:0;color:#888;font-size:14px">Price List · ${allPkgs.length} items · Generated ${new Date().toLocaleDateString()}</p>
      </div>
      ${catSections}
      <div style="margin-top:40px;text-align:center;color:#bbb;font-size:12px">Generated from Studio OS Cloud</div>
    </body></html>`;

    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.print(); }
  }

  async function bulkAdjustPrices() {
    const pct = parseFloat(bulkPercent);
    if (!pct || !selectedProfile) return;
    const pkgs = selectedProfile.packages.filter(p =>
      (!selectedCategory || getCategoryKey(p) === selectedCategory) && p.price_cents > 0
    );
    if (!pkgs.length) return;
    const direction = pct > 0 ? "increase" : "decrease";
    if (!confirm(`This will ${direction} prices on ${pkgs.length} item${pkgs.length !== 1 ? "s" : ""} by ${Math.abs(pct)}%. Continue?`)) return;

    const multiplier = 1 + pct / 100;
    await Promise.all(
      pkgs.map(pkg => {
        const newPrice = Math.round(pkg.price_cents * multiplier);
        return supabase.from("packages").update({ price_cents: newPrice }).eq("id", pkg.id);
      })
    );
    setShowBulkAdjust(false);
    setBulkPercent("");
    await loadData();
  }

  async function duplicatePkg(pkg: Pkg) {
    if (!pgId) return;
    const copy = {
      name:            `${pkg.name} (Copy)`,
      price_cents:     pkg.price_cents,
      items:           pkg.items,
      active:          pkg.active,
      photographer_id: pgId,
      profile_id:      pkg.profile_id,
      profile_name:    pkg.profile_name,
      category:        pkg.category,
      description:     pkg.description,
    };
    const { data } = await supabase.from("packages").insert(copy).select().single();
    await loadData();
    if (data) openEdit(data as Pkg);
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

  async function addAllSizes() {
    if (!selectedProfile || !pgId) return;
    const cat = selectedCategory || "prints";
    const existingNames = new Set(
      selectedProfile.packages
        .filter(p => getCategoryKey(p) === cat)
        .map(p => p.name.trim().toLowerCase().replace(/×/g, "x"))
    );
    const toAdd = PRINT_SIZES.filter(
      s => s.value !== "custom" && !existingNames.has(s.label.toLowerCase().replace(/×/g, "x"))
    );
    if (toAdd.length === 0) {
      alert("All standard sizes already exist in this category.");
      return;
    }
    const rows = toAdd.map(s => ({
      name:            s.label,
      price_cents:     0,
      items:           [{ name: `${s.label} Print`, qty: 1 }],
      active:          true,
      photographer_id: pgId,
      profile_id:      selectedProfile.id,
      profile_name:    selectedProfile.name,
      category:        cat,
    }));
    await supabase.from("packages").insert(rows);
    await loadData();
  }

  function openPackPicker() {
    setSelectedPack(null);
    setPackSelections(new Set());
    setShowPackPicker(true);
  }

  function selectPack(pack: PackagePack) {
    setSelectedPack(pack);
    // Select all by default
    setPackSelections(new Set(pack.presets.map((_, i) => i)));
  }

  function togglePackPreset(index: number) {
    setPackSelections(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function insertSelectedPacks() {
    if (!selectedProfile || !pgId || !selectedPack) return;
    const presets = selectedPack.presets.filter((_, i) => packSelections.has(i));
    if (presets.length === 0) return;
    setInsertingPack(true);
    try {
      const rows = presets.map(p => ({
        name: p.name,
        description: p.description,
        price_cents: p.priceCents,
        items: p.items,
        active: true,
        photographer_id: pgId,
        profile_id: selectedProfile.id,
        profile_name: selectedProfile.name,
        category: "package",
      }));
      await supabase.from("packages").insert(rows);
      await loadData();
      setShowPackPicker(false);
      setSelectedPack(null);
    } finally {
      setInsertingPack(false);
    }
  }

  async function setAsDefaultProfile(profileId: string) {
    if (!pgId) return;
    const { error } = await supabase
      .from("photographers")
      .update({ default_package_profile_id: profileId })
      .eq("id", pgId);
    if (!error) {
      setDefaultProfileId(profileId);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/sign-in";
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function categoryCount(profile: Profile, catKey: PackageCategory) {
    return profile.packages.filter(p => getCategoryKey(p) === catKey).length;
  }
  function categoryMinPrice(profile: Profile, catKey: PackageCategory) {
    const pkgs = profile.packages.filter(p => getCategoryKey(p) === catKey);
    if (!pkgs.length) return null;
    return Math.min(...pkgs.map(p => p.price_cents)) / 100;
  }
  function categoryHasActive(profile: Profile, catKey: PackageCategory) {
    const pkgs = profile.packages.filter(p => getCategoryKey(p) === catKey);
    return pkgs.length > 0 && pkgs.some(p => p.active);
  }
  async function toggleCategory(profile: Profile, catKey: PackageCategory) {
    const pkgs = profile.packages.filter(p => getCategoryKey(p) === catKey);
    if (!pkgs.length) return;
    const hasActive = pkgs.some(p => p.active);
    const newActive = !hasActive;

    // Optimistic UI
    setProfiles(prev => prev.map(pr => {
      if (pr.id !== profile.id) return pr;
      return {
        ...pr,
        packages: pr.packages.map(pkg =>
          getCategoryKey(pkg) === catKey ? { ...pkg, active: newActive } : pkg
        ),
      };
    }));

    // Persist
    await Promise.all(
      pkgs.map(pkg => supabase.from("packages").update({ active: newActive }).eq("id", pkg.id))
    );
  }

  const pkgsInCategory = (selectedProfile?.packages.filter(pkg => {
    if (selectedCategory && getCategoryKey(pkg) !== selectedCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const nameMatch = pkg.name.toLowerCase().includes(q);
      const descMatch = (pkg.description ?? "").toLowerCase().includes(q);
      const priceMatch = (pkg.price_cents / 100).toFixed(2).includes(q);
      if (!nameMatch && !descMatch && !priceMatch) return false;
    }
    return true;
  }) || []).sort((a, b) => {
    const aOrder = a.sort_order ?? 999999;
    const bOrder = b.sort_order ?? 999999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.price_cents - b.price_cents;
  });

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
        <Link href="/dashboard/settings" style={navItem}>Settings</Link>
        <Link href="/dashboard/membership" style={navItem}>Membership</Link>
      </nav>
      <button onClick={signOut} style={{ margin: 16, padding: "10px", background: "transparent", border: "1px solid #333", borderRadius: 8, color: "#ccc", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <LogOut size={14} /> Sign Out
      </button>
    </div>
  );

  // ── Modals ─────────────────────────────────────────────────────────────────

  // NOTE: Overlay is intentionally inlined (not a component) to prevent
  // React from remounting the subtree on every state change, which would
  // steal focus from inputs inside the modal.
  const overlayStyle: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };

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
                  {/* Top accent bar — green for default, red for others */}
                  <div style={{ height: 4, background: defaultProfileId === profile.id ? "#059669" : "#c00", borderRadius: "12px 12px 0 0" }} />

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
                        {defaultProfileId === profile.id && (
                          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#059669", background: "#ecfdf5", padding: "3px 10px", borderRadius: 99, verticalAlign: "middle", letterSpacing: "0.03em", border: "1px solid #bbf7d0" }}>
                            ✓ Default
                          </span>
                        )}
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
                            <button
                              onClick={e => {
                                e.stopPropagation(); setMenuOpenId(null);
                                setAsDefaultProfile(profile.id);
                              }}
                              style={{ width: "100%", padding: "10px 16px", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: defaultProfileId === profile.id ? "#059669" : "#333", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}
                            >
                              <Check size={13} /> {defaultProfileId === profile.id ? "Default Price Sheet" : "Set as Default"}
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
          <div style={overlayStyle}>
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
                      All items from &ldquo;{profiles.find(p => p.id === newSheetDupFrom)?.name}&rdquo; will be copied.
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
          </div>
        )}

        {/* ── Rename modal ── */}
        {renamingProfile && (
          <div style={overlayStyle}>
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
          </div>
        )}

        {/* ── Delete confirmation modal ── */}
        {deletingProfile && (
          <div style={overlayStyle}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 440, maxWidth: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <AlertTriangle size={20} color="#ef4444" />
                </div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#111" }}>Delete Price Sheet?</h2>
              </div>

              <p style={{ color: "#555", fontSize: 14, margin: "0 0 12px", lineHeight: 1.5 }}>
                <strong>&ldquo;{deletingProfile.name}&rdquo;</strong> and all <strong>{deletingProfile.count} items</strong> inside it will be permanently deleted.
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
          </div>
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
              const isActive = categoryHasActive(selectedProfile, cat.key);
              return (
                <div
                  key={cat.key}
                  style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e5e5", overflow: "hidden", opacity: count > 0 && !isActive ? 0.5 : 1, transition: "opacity 0.2s" }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)")}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}
                >
                  <div
                    onClick={() => setSelectedCategory(cat.key)}
                    style={{ height: 100, background: cat.color, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                  >
                    <Icon size={36} color="#aaa" />
                  </div>
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <div
                        onClick={() => setSelectedCategory(cat.key)}
                        style={{ fontWeight: 700, fontSize: 15, color: "#111", cursor: "pointer" }}
                      >
                        {cat.label}
                      </div>
                      {count > 0 && (
                        <button
                          onClick={e => { e.stopPropagation(); toggleCategory(selectedProfile, cat.key); }}
                          style={{
                            width: 38, height: 22, borderRadius: 11, border: "none", cursor: "pointer", padding: 0,
                            background: isActive ? "#22c55e" : "#d4d4d4",
                            position: "relative", transition: "background 0.2s",
                          }}
                          title={isActive ? "Disable this category" : "Enable this category"}
                        >
                          <div style={{
                            width: 18, height: 18, borderRadius: 9, background: "#fff",
                            position: "absolute", top: 2,
                            left: isActive ? 18 : 2,
                            transition: "left 0.2s",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                          }} />
                        </button>
                      )}
                    </div>
                    <div onClick={() => setSelectedCategory(cat.key)} style={{ fontSize: 13, color: "#888", cursor: "pointer" }}>
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
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={openPackPicker}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "#fff", color: "#000", border: "1px solid #e5e5e5", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}
            >
              <Package size={16} /> Add Package Pack
            </button>
            <button
              onClick={addAllSizes}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "#fff", color: "#000", border: "1px solid #e5e5e5", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}
            >
              <Plus size={16} /> Add All Sizes
            </button>
            <button
              onClick={addPackage}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", background: "#000", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}
            >
              <Plus size={16} /> Add Item
            </button>
          </div>
        </div>

        {/* Search & bulk tools */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search items..."
              style={{ width: "100%", padding: "9px 14px 9px 36px", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 14, color: "#111", background: "#fff" }}
            />
            <svg style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <button
            onClick={() => setShowBulkAdjust(!showBulkAdjust)}
            style={{ padding: "9px 16px", background: showBulkAdjust ? "#111" : "#fff", color: showBulkAdjust ? "#fff" : "#555", border: "1px solid #e5e5e5", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" }}
          >
            Adjust Prices
          </button>
          <button
            onClick={exportPriceListPDF}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#fff", color: "#555", border: "1px solid #e5e5e5", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" }}
          >
            <FileDown size={15} /> Export PDF
          </button>
        </div>

        {showBulkAdjust && (
          <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", padding: "14px 16px", background: "#fafafa", borderRadius: 10, border: "1px solid #e5e5e5" }}>
            <span style={{ fontSize: 13, color: "#555", fontWeight: 500 }}>Adjust all prices by</span>
            <input
              value={bulkPercent}
              onChange={e => setBulkPercent(e.target.value)}
              placeholder="e.g. 10 or -5"
              style={{ width: 90, padding: "7px 10px", border: "1px solid #e5e5e5", borderRadius: 6, fontSize: 14, textAlign: "center" }}
            />
            <span style={{ fontSize: 13, color: "#555" }}>%</span>
            <button
              onClick={bulkAdjustPrices}
              disabled={!bulkPercent || isNaN(parseFloat(bulkPercent))}
              style={{ padding: "7px 16px", background: "#000", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: !bulkPercent ? 0.4 : 1 }}
            >
              Apply
            </button>
            <span style={{ fontSize: 12, color: "#aaa", marginLeft: 4 }}>
              {bulkPercent && !isNaN(parseFloat(bulkPercent))
                ? `${parseFloat(bulkPercent) > 0 ? "+" : ""}${bulkPercent}% on ${pkgsInCategory.filter(p => p.price_cents > 0).length} items`
                : "Enter + to increase, - to decrease"}
            </span>
          </div>
        )}

        {/* Edit modal */}
        {editingPkg && (
          <div style={overlayStyle}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 560, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Edit Item</h2>
                <button onClick={() => setEditingPkg(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#999" }}>
                  <X size={20} />
                </button>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#333" }}>Package Name</label>
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="e.g. Standard Pack, 8×10 Print, Family Bundle"
                  style={inputStyle}
                />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {PRINT_SIZES.filter(s => s.value !== "custom").map(s => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => { setEditName(s.label); setEditSizePreset(s.value); }}
                      style={{
                        padding: "4px 10px", fontSize: 12, borderRadius: 6, cursor: "pointer", fontWeight: 500,
                        border: editName === s.label ? "1px solid #2563eb" : "1px solid #e5e5e5",
                        background: editName === s.label ? "#eff6ff" : "#fafafa",
                        color: editName === s.label ? "#2563eb" : "#666",
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#333" }}>Price ($)</label>
                  <input value={editPrice} onChange={e => { const v = e.target.value; if (v === "" || /^\d*\.?\d{0,2}$/.test(v)) setEditPrice(v); }} type="text" inputMode="decimal" placeholder="0.00" style={inputStyle} />
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
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>Package Contents</label>
                </div>
                {editItems.map((item, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <div style={{ flex: 1, display: "flex", gap: 8 }}>
                      <select
                        value={PRINT_SIZES.some(s => s.label === item.name || s.value === item.name) ? (PRINT_SIZES.find(s => s.label === item.name || s.value === item.name)?.value ?? "custom") : "custom"}
                        onChange={e => {
                          const n = [...editItems];
                          const match = PRINT_SIZES.find(s => s.value === e.target.value);
                          if (match && match.value !== "custom") {
                            n[i] = { ...n[i], name: match.label };
                          }
                          setEditItems(n);
                        }}
                        style={{ flex: 1, padding: "8px 12px", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 14, color: "#111", background: "#fff", appearance: "auto" }}
                      >
                        {PRINT_SIZES.map(s => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                      {(!PRINT_SIZES.some(s => s.label === item.name && s.value !== "custom")) && (
                        <input
                          value={item.name}
                          onChange={e => { const n = [...editItems]; n[i] = { ...n[i], name: e.target.value }; setEditItems(n); }}
                          placeholder="Custom name"
                          style={{ flex: 1, padding: "8px 12px", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 14, color: "#111" }}
                        />
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 12, color: "#888", fontWeight: 500 }}>Qty</span>
                      <select
                        value={item.qty}
                        onChange={e => { const n = [...editItems]; n[i] = { ...n[i], qty: parseInt(e.target.value) || 1 }; setEditItems(n); }}
                        style={{ width: 60, padding: "8px 6px", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 14, color: "#111", background: "#fff", textAlign: "center", appearance: "auto" }}
                      >
                        {[1,2,3,4,5,6,7,8,10,12,16,20,24].map(q => (
                          <option key={q} value={q}>{q}</option>
                        ))}
                      </select>
                    </div>
                    <button type="button" onClick={() => setEditItems(editItems.filter((_, j) => j !== i))}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#ccc", padding: 4 }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setEditItems([...editItems, { name: "", qty: 1 }])}
                  style={{ width: "100%", padding: "10px", border: "1px dashed #d4d4d4", borderRadius: 8, background: "#fafafa", cursor: "pointer", fontSize: 13, color: "#666", fontWeight: 500, marginTop: 4 }}>
                  + Add Item
                </button>
                {editItems.length === 0 && (
                  <p style={{ fontSize: 13, color: "#bbb", margin: "8px 0 0", fontStyle: "italic" }}>No contents listed — add an item above.</p>
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
          </div>
        )}

        {/* Package Pack picker modal */}
        {showPackPicker && (
          <div style={overlayStyle}>
            <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 640, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                    {selectedPack ? selectedPack.label : "Choose a Package Pack"}
                  </h2>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#666" }}>
                    {selectedPack
                      ? "Select which packages to add, then customize prices and contents after."
                      : "Pre-built bundles to get you started — fully customizable after adding."}
                  </p>
                </div>
                <button onClick={() => { setShowPackPicker(false); setSelectedPack(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#999" }}>
                  <X size={20} />
                </button>
              </div>

              {!selectedPack ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {PACKAGE_PACKS.map(pack => (
                    <button
                      key={pack.id}
                      onClick={() => selectPack(pack)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        border: "1px solid #e5e5e5",
                        borderRadius: 12,
                        padding: "16px 18px",
                        background: "#fafafa",
                        cursor: "pointer",
                        transition: "border-color 0.15s",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = "#000")}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = "#e5e5e5")}
                    >
                      <div style={{ fontWeight: 700, fontSize: 15, color: "#111" }}>{pack.label}</div>
                      <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>{pack.description}</div>
                      <div style={{ fontSize: 12, color: "#999", marginTop: 6 }}>{pack.presets.length} packages</div>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setSelectedPack(null)}
                    style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "#2563eb", fontSize: 13, fontWeight: 600, marginBottom: 16, padding: 0 }}
                  >
                    <ArrowLeft size={14} /> Back to packs
                  </button>

                  {/* Select all / none */}
                  <div style={{ display: "flex", gap: 12, marginBottom: 14, fontSize: 13 }}>
                    <button
                      onClick={() => setPackSelections(new Set(selectedPack.presets.map((_, i) => i)))}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#2563eb", fontWeight: 600, padding: 0 }}
                    >
                      Select all
                    </button>
                    <button
                      onClick={() => setPackSelections(new Set())}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#666", fontWeight: 500, padding: 0 }}
                    >
                      Clear
                    </button>
                  </div>

                  <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
                    {selectedPack.presets.map((preset, i) => {
                      const selected = packSelections.has(i);
                      return (
                        <button
                          key={i}
                          onClick={() => togglePackPreset(i)}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            border: selected ? "2px solid #000" : "1px solid #e5e5e5",
                            borderRadius: 12,
                            padding: "14px 16px",
                            background: selected ? "#f8f9fb" : "#fff",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 700, fontSize: 14, color: "#111", display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{
                                  width: 18, height: 18, borderRadius: 4,
                                  border: selected ? "none" : "2px solid #ccc",
                                  background: selected ? "#000" : "#fff",
                                  display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                                }}>
                                  {selected && <Check size={12} color="#fff" strokeWidth={3} />}
                                </span>
                                {preset.name}
                              </div>
                              <div style={{ fontSize: 13, color: "#666", marginTop: 4, marginLeft: 26 }}>{preset.description}</div>
                              <div style={{ fontSize: 12, color: "#999", marginTop: 6, marginLeft: 26 }}>
                                {preset.items.map(it => `${it.qty}× ${it.name}`).join(", ")}
                              </div>
                            </div>
                            <div style={{ fontWeight: 700, fontSize: 14, color: "#059669", whiteSpace: "nowrap", marginLeft: 12 }}>
                              ${(preset.priceCents / 100).toFixed(2)}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ display: "flex", gap: 12 }}>
                    <button
                      onClick={insertSelectedPacks}
                      disabled={insertingPack || packSelections.size === 0}
                      style={{
                        flex: 1, padding: "12px", background: "#000", color: "#fff",
                        border: "none", borderRadius: 8, cursor: packSelections.size === 0 ? "not-allowed" : "pointer",
                        fontWeight: 600, fontSize: 14, opacity: insertingPack || packSelections.size === 0 ? 0.5 : 1,
                      }}
                    >
                      {insertingPack ? "Adding..." : `Add ${packSelections.size} package${packSelections.size !== 1 ? "s" : ""}`}
                    </button>
                    <button
                      onClick={() => { setShowPackPicker(false); setSelectedPack(null); }}
                      style={{ flex: 1, padding: "12px", background: "#f5f5f5", color: "#333", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Item list */}
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e5e5", overflow: "hidden" }}>
          {pkgsInCategory.length === 0 ? (
            <div style={{ padding: 60, textAlign: "center" }}>
              {catMeta && <catMeta.icon size={36} color="#ddd" style={{ marginBottom: 12 }} />}
              <p style={{ color: "#999", margin: 0, fontSize: 14, fontWeight: 600 }}>No {catMeta?.label.toLowerCase()} yet</p>
              <p style={{ color: "#bbb", fontSize: 13, marginTop: 6 }}>
                Click &ldquo;Add Item&rdquo; above or sync from the Studio OS app.
              </p>
            </div>
          ) : (
            pkgsInCategory.map((pkg, i) => (
              <div
                key={pkg.id}
                draggable
                onDragStart={() => { setDragIdx(i); }}
                onDragOver={e => { e.preventDefault(); setDragOverIdx(i); }}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                onDrop={e => { e.preventDefault(); if (dragIdx !== null) handleDrop(pkgsInCategory, dragIdx, i); }}
                style={{
                  display: "flex", alignItems: "center", padding: "16px 20px",
                  borderBottom: i < pkgsInCategory.length - 1 ? "1px solid #f0f0f0" : "none",
                  opacity: pkg.active ? (dragIdx === i ? 0.4 : 1) : 0.5,
                  background: dragOverIdx === i && dragIdx !== i ? "#f0f7ff" : "transparent",
                  transition: "background 0.15s ease",
                  cursor: "grab",
                }}
              >
                <div style={{ marginRight: 12, color: "#ccc", cursor: "grab", flexShrink: 0, display: "flex", alignItems: "center" }}>
                  <GripVertical size={18} />
                </div>
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
                    onClick={() => duplicatePkg(pkg)}
                    title="Duplicate"
                    style={{ padding: "7px 10px", background: "none", border: "1px solid #e5e5e5", borderRadius: 6, cursor: "pointer", color: "#aaa" }}
                  >
                    <Copy size={14} />
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
