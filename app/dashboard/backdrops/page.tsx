// app/dashboard/backdrops/page.tsx — v3: matches desktop app features
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { uploadToR2 } from "@/lib/upload-to-r2-client";
import {
  LogOut, Plus, Trash2, Pencil, Eye, EyeOff, Upload, X, Star, Check, Palette,
  ChevronRight, Grid3X3, Images, CheckCircle2, Copy, Flame, FolderOpen,
} from "lucide-react";

type BackdropRow = {
  id: string; photographer_id: string; name: string; description: string;
  image_url: string; thumbnail_url: string; tier: "free" | "premium";
  price_cents: number; category: string; tags: string[]; sort_order: number;
  active: boolean; created_at: string;
  /** When true, parents can flip this backdrop into landscape orientation in
   *  the parents-portal CHOOSE BACKDROP panel.  Default false → portrait only,
   *  matching every existing backdrop's behavior pre-2026-04-25. */
  supports_landscape: boolean;
};

const SUPABASE_URL = "https://bwqhzczxoevouiondjak.supabase.co";
const BUCKET = "backdrops";

type CatCfg = { key: string; label: string; color: string; bg: string; icon: string };
const CATS: CatCfg[] = [
  { key: "solid", label: "Solid Colors", color: "#6366f1", bg: "#eef2ff", icon: "■" },
  { key: "gradient", label: "Gradients", color: "#8b5cf6", bg: "#f5f3ff", icon: "◐" },
  { key: "scenic", label: "Scenic", color: "#059669", bg: "#ecfdf5", icon: "🏔" },
  { key: "holiday", label: "Holiday", color: "#e11d48", bg: "#fff1f2", icon: "🎄" },
  { key: "sports", label: "Sports", color: "#2563eb", bg: "#eff6ff", icon: "⚽" },
  { key: "custom", label: "Custom", color: "#7c3aed", bg: "#faf5ff", icon: "✦" },
];

const sidebar: React.CSSProperties = { width: 220, minHeight: "100vh", background: "#000", color: "#fff", display: "flex", flexDirection: "column", flexShrink: 0 };
const navItem: React.CSSProperties = { padding: "12px 24px", cursor: "pointer", fontSize: 14, color: "#ccc", textDecoration: "none", display: "block" };
const navActive: React.CSSProperties = { ...navItem, color: "#fff", background: "#1a1a1a" };

export default function BackdropsPage() {
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [pgId, setPgId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");
  const [backdrops, setBackdrops] = useState<BackdropRow[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filters
  const [quickFilter, setQuickFilter] = useState<string | null>(null);
  const [thumbSize, setThumbSize] = useState(220);

  // Popularity
  const [pickCounts, setPickCounts] = useState<Record<string, number>>({});
  const [revenueBd, setRevenueBd] = useState<Record<string, number>>({});
  const [popularLoaded, setPopularLoaded] = useState(false);
  const [sortPopular, setSortPopular] = useState(false);

  // Editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [editBd, setEditBd] = useState<BackdropRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editCat, setEditCat] = useState("solid");
  const [editTier, setEditTier] = useState<"free" | "premium">("free");
  const [editPrice, setEditPrice] = useState("0");
  const [editUrl, setEditUrl] = useState("");
  const [editSupportsLandscape, setEditSupportsLandscape] = useState(false);
  const [saving, setSaving] = useState(false);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [upQueue, setUpQueue] = useState(0);
  const [upDone, setUpDone] = useState(0);
  const [upCat, setUpCat] = useState("solid");
  const [upTier, setUpTier] = useState<"free" | "premium">("free");
  const [upPrice, setUpPrice] = useState("0");
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => { init(); }, []);

  async function init() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = "/sign-in"; return; }
    setUserEmail(user.email ?? "");
    const { data: pg } = await supabase.from("photographers").select("id").eq("user_id", user.id).maybeSingle();
    if (!pg) { setLoading(false); return; }
    setPgId(pg.id);
    await load(pg.id);
  }

  async function load(pid?: string) {
    const id = pid ?? pgId; if (!id) return;
    setLoading(true);
    const { data } = await supabase.from("backdrop_catalog").select("*").eq("photographer_id", id).order("sort_order");
    setBackdrops((data ?? []) as BackdropRow[]);
    setLoading(false);
  }

  function resetPopularityCache() {
    setPickCounts({});
    setRevenueBd({});
    setPopularLoaded(false);
    setSortPopular(false);
  }

  // ── Popularity ──
  async function loadPopularity() {
    if (!pgId) return;
    try {
      const bdIds = backdrops.map(b => b.id);
      if (!bdIds.length) { setPopularLoaded(true); return; }
      const { data } = await supabase.from("backdrop_selections").select("backdrop_id").in("backdrop_id", bdIds);
      const rows = (data ?? []) as { backdrop_id: string }[];
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.backdrop_id] = (counts[r.backdrop_id] ?? 0) + 1;
      const rev: Record<string, number> = {};
      for (const bd of backdrops) {
        if (bd.tier === "premium") rev[bd.id] = (counts[bd.id] ?? 0) * bd.price_cents;
      }
      setPickCounts(counts);
      setRevenueBd(rev);
      setPopularLoaded(true);
    } catch { setPopularLoaded(true); }
  }

  function togglePopular() {
    if (!popularLoaded) { loadPopularity().then(() => setSortPopular(true)); }
    else setSortPopular(!sortPopular);
  }

  // ── Upload ──
  async function handleBulkUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter(f => /\.(jpe?g|png|webp)$/i.test(f.name));
    if (!files.length || !pgId) return;
    setUploading(true); setUpQueue(files.length); setUpDone(0);
    const base = backdrops.length > 0 ? Math.max(...backdrops.map(b => b.sort_order)) + 1 : 1;
    for (let i = 0; i < files.length; i++) {
      try {
        const f = files[i];
        const ext = f.name.split(".").pop()?.toLowerCase() || "jpg";
        const obj = `${pgId}/${Date.now()}_${i}_${Math.random().toString(36).slice(2,8)}.${ext}`;
        // Upload to Cloudflare R2
        const accessToken = (await supabase.auth.getSession()).data.session?.access_token || "";
        const storageKey = `backdrops/${obj}`;
        const r2Result = await uploadToR2(f, storageKey, accessToken);
        const url = r2Result?.publicUrl || `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${obj}`;

        // ✅ PERF: Generate a 560px thumbnail for the backdrop picker so
        // parents aren't downloading the full-resolution image 50× in the
        // thumbnail grid. Failure is non-fatal — we fall back to the
        // original url, which preserves the pre-fix behavior.
        let thumbUrl = url;
        try {
          const thumbRes = await fetch("/api/dashboard/generate-thumbnails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ storagePath: storageKey }),
          });
          if (thumbRes.ok) {
            const thumbJson = (await thumbRes.json()) as { thumbnailUrl?: string | null };
            if (thumbJson?.thumbnailUrl) thumbUrl = thumbJson.thumbnailUrl;
          }
        } catch (thumbErr) {
          console.warn("Backdrop thumbnail generation failed (non-fatal):", thumbErr);
        }

        const name = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        await supabase.from("backdrop_catalog").insert({
          photographer_id: pgId, name, description: "", image_url: url, thumbnail_url: thumbUrl,
          category: upCat, tier: upTier,
          price_cents: upTier === "premium" ? Math.round(parseFloat(upPrice || "0") * 100) : 0,
          sort_order: base + i, active: true,
        });
        setUpDone(p => p + 1);
      } catch (err) { console.error(err); }
    }
    setUploading(false); setShowUpload(false);
    if (fileRef.current) fileRef.current.value = "";
    await load();
  }

  // ── CRUD ──
  function openEditor(bd?: BackdropRow) {
    if (bd) { setEditBd(bd); setEditName(bd.name); setEditDesc(bd.description||""); setEditCat(bd.category||"solid"); setEditTier(bd.tier); setEditPrice((bd.price_cents/100).toFixed(2)); setEditUrl(bd.image_url); setEditSupportsLandscape(Boolean(bd.supports_landscape)); }
    else { setEditBd(null); setEditName(""); setEditDesc(""); setEditCat(activeCat||"solid"); setEditTier("free"); setEditPrice("0"); setEditUrl(""); setEditSupportsLandscape(false); }
    setEditorOpen(true);
  }

  async function saveEditor() {
    if (!pgId || !editName.trim()) return; setSaving(true);
    const payload = { photographer_id: pgId, name: editName.trim(), description: editDesc.trim(), image_url: editUrl, thumbnail_url: editUrl, category: editCat, tier: editTier, price_cents: editTier === "premium" ? Math.round(parseFloat(editPrice||"0")*100) : 0, active: true, supports_landscape: editSupportsLandscape };
    try {
      if (editBd) {
        const { error } = await supabase.from("backdrop_catalog").update(payload).eq("id", editBd.id);
        if (error) throw error;
        setBackdrops((prev) => prev.map((row) => (row.id === editBd.id ? { ...row, ...payload } : row)));
      } else {
        const o = backdrops.length > 0 ? Math.max(...backdrops.map(b=>b.sort_order))+1 : 1;
        const { data, error } = await supabase.from("backdrop_catalog").insert({ ...payload, sort_order: o }).select("*").single();
        if (error) throw error;
        if (data) setBackdrops((prev) => [...prev, data as BackdropRow]);
      }
      resetPopularityCache();
      setEditorOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function duplicateOne(bd: BackdropRow) {
    if (!pgId) return;
    const o = backdrops.length > 0 ? Math.max(...backdrops.map(b=>b.sort_order))+1 : 1;
    const { data, error } = await supabase.from("backdrop_catalog").insert({
      photographer_id: pgId, name: `${bd.name} (copy)`, description: bd.description,
      image_url: bd.image_url, thumbnail_url: bd.thumbnail_url,
      category: bd.category, tier: bd.tier, price_cents: bd.price_cents,
      sort_order: o, active: bd.active, supports_landscape: bd.supports_landscape ?? false,
    }).select("*").single();
    if (error) {
      console.error(error);
      return;
    }
    if (data) {
      setBackdrops((prev) => [...prev, data as BackdropRow]);
      resetPopularityCache();
    }
  }

  // ── Bulk + single actions ──
  async function bulkTier(tier: "free"|"premium", cents=0) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const { error } = await supabase.from("backdrop_catalog").update({ tier, price_cents: tier==="premium"?cents:0 }).in("id", ids);
    if (error) {
      console.error(error);
      return;
    }
    const idSet = new Set(ids);
    setBackdrops((prev) => prev.map((row) => (idSet.has(row.id) ? { ...row, tier, price_cents: tier==="premium"?cents:0 } : row)));
    setSelectedIds(new Set());
    resetPopularityCache();
  }
  async function bulkCat(cat: string) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const { error } = await supabase.from("backdrop_catalog").update({ category: cat }).in("id", ids);
    if (error) {
      console.error(error);
      return;
    }
    const idSet = new Set(ids);
    setBackdrops((prev) => prev.map((row) => (idSet.has(row.id) ? { ...row, category: cat } : row)));
    setSelectedIds(new Set());
  }
  async function bulkDel() {
    const ids = Array.from(selectedIds);
    if (!ids.length || !confirm(`Delete ${ids.length} backdrop(s)?`)) return;
    const { error } = await supabase.from("backdrop_catalog").delete().in("id", ids);
    if (error) {
      console.error(error);
      return;
    }
    const idSet = new Set(ids);
    setBackdrops((prev) => prev.filter((row) => !idSet.has(row.id)));
    setSelectedIds(new Set());
    resetPopularityCache();
  }
  async function bulkVis(active: boolean) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const { error } = await supabase.from("backdrop_catalog").update({ active }).in("id", ids);
    if (error) {
      console.error(error);
      return;
    }
    const idSet = new Set(ids);
    setBackdrops((prev) => prev.map((row) => (idSet.has(row.id) ? { ...row, active } : row)));
    setSelectedIds(new Set());
  }
  // 2026-04-25: bulk landscape opt-in / opt-out.  Lets photographer flip
  // every selected backdrop's supports_landscape flag in one click instead
  // of editing each row individually.
  async function bulkLandscape(supports: boolean) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const { error } = await supabase
      .from("backdrop_catalog")
      .update({ supports_landscape: supports })
      .in("id", ids);
    if (error) {
      console.error(error);
      return;
    }
    const idSet = new Set(ids);
    setBackdrops((prev) =>
      prev.map((row) => (idSet.has(row.id) ? { ...row, supports_landscape: supports } : row)),
    );
    setSelectedIds(new Set());
  }
  async function delOne(id: string) {
    if (!confirm("Delete?")) return;
    const { error } = await supabase.from("backdrop_catalog").delete().eq("id", id);
    if (error) {
      console.error(error);
      return;
    }
    setBackdrops((prev) => prev.filter((row) => row.id !== id));
    resetPopularityCache();
  }
  async function toggleVis(bd: BackdropRow) {
    const active = !bd.active;
    const { error } = await supabase.from("backdrop_catalog").update({ active }).eq("id", bd.id);
    if (error) {
      console.error(error);
      return;
    }
    setBackdrops((prev) => prev.map((row) => (row.id === bd.id ? { ...row, active } : row)));
  }
  async function quickTier(bd: BackdropRow) {
    const tier = bd.tier==="free"?"premium":"free";
    const price_cents = tier==="premium"?499:0;
    const { error } = await supabase.from("backdrop_catalog").update({ tier, price_cents }).eq("id", bd.id);
    if (error) {
      console.error(error);
      return;
    }
    setBackdrops((prev) => prev.map((row) => (row.id === bd.id ? { ...row, tier, price_cents } : row)));
    resetPopularityCache();
  }
  function toggleSel(id: string) { setSelectedIds(p => { const n = new Set(p); if(n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function selAll() { const ids = filtered.map(b=>b.id); setSelectedIds(p => { if(ids.every(id=>p.has(id))) return new Set(); return new Set(ids); }); }
  async function signOut() { await supabase.auth.signOut(); window.location.href="/sign-in"; }

  // ── Derived ──
  let filtered = backdrops.slice();
  if (activeCat) filtered = filtered.filter(b => b.category === activeCat);
  if (quickFilter === "free") filtered = filtered.filter(b => b.tier === "free");
  else if (quickFilter === "premium") filtered = filtered.filter(b => b.tier === "premium");
  else if (quickFilter === "hidden") filtered = filtered.filter(b => !b.active);
  if (sortPopular && popularLoaded) filtered.sort((a, b) => (pickCounts[b.id] ?? 0) - (pickCounts[a.id] ?? 0));

  const groups = CATS.map(c => ({ ...c, bds: backdrops.filter(b => b.category === c.key) })).filter(g => g.bds.length > 0);
  const allSel = filtered.length > 0 && filtered.every(b => selectedIds.has(b.id));
  const totalFree = backdrops.filter(b => b.tier === "free").length;
  const totalPremium = backdrops.filter(b => b.tier === "premium").length;
  const totalHidden = backdrops.filter(b => !b.active).length;
  const revenuePerClient = backdrops.filter(b => b.tier === "premium").reduce((s, b) => s + b.price_cents, 0);
  const totalEarned = Object.values(revenueBd).reduce((s, v) => s + v, 0);

  // ── Stat chip helper ──
  function StatChip({ value, label, color, filterKey }: { value: string; label: string; color: string; filterKey?: string }) {
    const active = quickFilter === filterKey && !!filterKey;
    return (
      <button
        onClick={filterKey ? () => { setQuickFilter(quickFilter === filterKey ? null : filterKey); setSelectedIds(new Set()); } : undefined}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
          background: active ? `${color}25` : `${color}0a`,
          borderRadius: 10, border: active ? `2px solid ${color}` : `1px solid ${color}20`,
          cursor: filterKey ? "pointer" : "default", transition: "all 0.15s",
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 800, color }}>{value}</span>
        <span style={{ fontSize: 12, color: "#888" }}>{label}</span>
        {active && <X size={12} color={color} />}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#fafafa" }}>
      <div style={sidebar}>
        <div style={{ background: "#fff", padding: "20px 24px" }}><span style={{ fontWeight: 800, fontSize: 16, color: "#000" }}>Studio OS</span></div>
        <nav style={{ flex: 1, paddingTop: 16 }}>
          <Link href="/dashboard" style={navItem}>Dashboard</Link>
          <Link href="/dashboard/schools" style={navItem}>Schools</Link>
          <Link href="/dashboard/orders" style={navItem}>Orders</Link>
          <Link href="/dashboard/packages" style={navItem}>Packages</Link>
          <Link href="/dashboard/backdrops" style={navActive}><span style={{ display:"flex",alignItems:"center",gap:8 }}><Palette size={15}/> Backdrops</span></Link>
          <Link href="/dashboard/settings" style={navItem}>Settings</Link>
          <Link href="/dashboard/membership" style={navItem}>Membership</Link>
        </nav>
        <button onClick={signOut} style={{ margin:16, padding:"10px", background:"transparent", border:"1px solid #333", borderRadius:8, color:"#ccc", cursor:"pointer", display:"flex", alignItems:"center", gap:8, fontSize:13 }}><LogOut size={14}/> Sign Out</button>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "28px 32px 0", background: "#fff", borderBottom: "1px solid #eee" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: "#111" }}>Backdrops</h1>
              <p style={{ margin: "4px 0 0", color: "#888", fontSize: 13 }}>Organize by category. Set free or premium. Matches your Studio OS desktop app.</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={()=>setShowUpload(true)} style={{ display:"flex",alignItems:"center",gap:6,background:"#fff",border:"1.5px solid #ddd",borderRadius:10,padding:"9px 16px",fontSize:13,fontWeight:600,cursor:"pointer",color:"#333" }}><Upload size={15}/> Bulk Upload</button>
              <button onClick={()=>openEditor()} style={{ display:"flex",alignItems:"center",gap:6,background:"#111",color:"#fff",border:"none",borderRadius:10,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:"pointer" }}><Plus size={15}/> Add Single</button>
            </div>
          </div>

          {/* Stats — clickable filters */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <StatChip value={`${backdrops.length}`} label="Total" color="#6366f1" />
            <StatChip value={`${totalFree}`} label="Free" color="#06b6d4" filterKey="free" />
            <StatChip value={`${totalPremium}`} label="Premium" color="#f59e0b" filterKey="premium" />
            <StatChip value={`${totalHidden}`} label="Hidden" color="#888888" filterKey="hidden" />
            <StatChip value={`$${(revenuePerClient / 100).toFixed(2)}`} label="Revenue/client" color="#16a34a" />
            {popularLoaded && totalEarned > 0 && (
              <StatChip value={`$${(totalEarned / 100).toFixed(2)}`} label="Total earned" color="#059669" />
            )}

            <div style={{ flex: 1 }} />

            {/* Popular sort */}
            <button onClick={togglePopular} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 999,
              border: sortPopular ? "2px solid #ea580c" : "1.5px solid #ddd", cursor: "pointer",
              background: sortPopular ? "#fff7ed" : "#fff", color: sortPopular ? "#ea580c" : "#888",
              fontSize: 12, fontWeight: sortPopular ? 700 : 500, transition: "all 0.15s",
            }}>
              <Flame size={14} /> Popular {sortPopular && <X size={12} />}
            </button>

            {/* Thumb slider */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
              <Grid3X3 size={14} color="#bbb" />
              <input type="range" min={150} max={350} value={thumbSize} onChange={e => setThumbSize(Number(e.target.value))}
                style={{ width: 100, accentColor: "#888" }} />
              <Images size={14} color="#bbb" />
            </div>
          </div>

          {/* Category tabs */}
          <div style={{ display: "flex", gap: 4, overflowX: "auto" }}>
            <button onClick={() => { setActiveCat(null); setSelectedIds(new Set()); }} style={{ padding: "10px 18px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: !activeCat ? "#fff" : "transparent", color: !activeCat ? "#111" : "#888", borderBottom: !activeCat ? "2px solid #111" : "2px solid transparent" }}>All ({backdrops.length})</button>
            {CATS.map(cat => {
              const n = backdrops.filter(b => b.category === cat.key).length;
              const on = activeCat === cat.key;
              return <button key={cat.key} onClick={() => { setActiveCat(on ? null : cat.key); setSelectedIds(new Set()); }} style={{ padding: "10px 16px", borderRadius: "10px 10px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: on ? 700 : 500, background: on ? "#fff" : "transparent", color: on ? cat.color : "#888", borderBottom: on ? `2px solid ${cat.color}` : "2px solid transparent", display: "flex", alignItems: "center", gap: 6 }}><span>{cat.icon}</span>{cat.label}{n > 0 && <span style={{ fontSize: 11, opacity: 0.6 }}>({n})</span>}</button>;
            })}
          </div>
        </div>

        {/* Bulk bar */}
        {selectedIds.size > 0 && (
          <div style={{ background: "#f0f4ff", borderBottom: "1px solid #d0d8f0", padding: "10px 32px", display: "flex", alignItems: "center", gap: 10, fontSize: 13, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700 }}>{selectedIds.size} selected</span>
            <div style={{ width: 1, height: 20, background: "#ccc" }} />
            <button onClick={() => bulkTier("free")} style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#059669" }}>Set Free</button>
            <button onClick={() => bulkTier("premium", 499)} style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#d97706" }}>Premium $4.99</button>
            <button onClick={() => bulkTier("premium", 799)} style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#d97706" }}>Premium $7.99</button>
            <div style={{ width: 1, height: 20, background: "#ccc" }} />
            {/* 2026-04-25: bulk Portrait/Landscape toggle.  Lets photographer
                opt-in/out a whole folder (Holiday, Scenic, etc.) in one
                click instead of editing each row. */}
            <button
              onClick={() => bulkLandscape(true)}
              title="Allow these backdrops to render in landscape on the parents portal"
              style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#1d4ed8" }}
            >
              ↔ Landscape on
            </button>
            <button
              onClick={() => bulkLandscape(false)}
              title="Restrict these backdrops to portrait only"
              style={{ background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#555" }}
            >
              Portrait only
            </button>
            <div style={{ width: 1, height: 20, background: "#ccc" }} />
            {CATS.map(c => <button key={c.key} onClick={() => bulkCat(c.key)} style={{ background: c.bg, border: `1px solid ${c.color}30`, borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600, color: c.color }}>{c.icon} {c.label}</button>)}
            <div style={{ flex: 1 }} />
            <button onClick={() => bulkVis(true)} style={{ background: "#f0fdf4", border: "1px solid #a7f3d0", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, color: "#059669" }}><Eye size={12} style={{ marginRight: 4 }} />Show</button>
            <button onClick={() => bulkVis(false)} style={{ background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, color: "#666" }}><EyeOff size={12} style={{ marginRight: 4 }} />Hide</button>
            <button onClick={bulkDel} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#ef4444" }}><Trash2 size={12} style={{ marginRight: 4 }} />Delete</button>
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>
          {loading ? <div style={{ textAlign: "center", padding: 60, color: "#888" }}>Loading…</div>
          : backdrops.length === 0 ? (
            <div style={{ textAlign: "center", padding: 80, background: "#fff", borderRadius: 16, border: "2px dashed #e0e0e0" }}>
              <Palette size={48} color="#ccc" style={{ marginBottom: 16 }} />
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#333", margin: "0 0 8px" }}>No backdrops yet</h2>
              <p style={{ color: "#888", fontSize: 14, margin: "0 0 24px", lineHeight: 1.7 }}>Upload backdrop images or sync from Studio OS desktop app.</p>
              <button onClick={() => setShowUpload(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#111", color: "#fff", border: "none", borderRadius: 10, padding: "12px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}><Upload size={16} /> Upload Backdrops</button>
            </div>
          ) : activeCat === null && !quickFilter && !sortPopular ? (
            /* Folder view */
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {groups.map(g => (
                <div key={g.key} style={{ background: "#fff", borderRadius: 14, border: "1px solid #eee", overflow: "hidden" }}>
                  <button onClick={() => setActiveCat(g.key)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", background: g.bg, border: "none", cursor: "pointer", borderBottom: "1px solid #eee" }}>
                    <span style={{ fontSize: 22 }}>{g.icon}</span>
                    <div style={{ flex: 1, textAlign: "left" }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>{g.label}</div>
                      <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                        {g.bds.length} backdrop{g.bds.length !== 1 ? "s" : ""}
                        <span style={{ color: "#059669" }}> · {g.bds.filter(b => b.tier === "free").length} free</span>
                        <span style={{ color: "#d97706" }}> · {g.bds.filter(b => b.tier === "premium").length} premium</span>
                      </div>
                    </div>
                    <ChevronRight size={18} color="#999" />
                  </button>
                  {g.bds.length > 0 && (
                    <div style={{ display: "flex", gap: 8, padding: "14px 20px", overflowX: "auto" }}>
                      {g.bds.slice(0, 8).map(bd => (
                        <div key={bd.id} style={{ position: "relative", flexShrink: 0 }}>
                          <img loading="lazy" src={bd.image_url} alt={bd.name} style={{ width: 100, height: 70, objectFit: "cover", borderRadius: 8, display: "block", border: "1px solid #eee" }} />
                          <div style={{ position: "absolute", top: 4, right: 4, background: bd.tier === "premium" ? "#f59e0b" : "#22c55e", color: bd.tier === "premium" ? "#000" : "#fff", fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 4 }}>{bd.tier === "premium" ? `$${(bd.price_cents / 100).toFixed(2)}` : "FREE"}</div>
                          {!bd.active && <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.6)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}><EyeOff size={14} color="#999" /></div>}
                        </div>
                      ))}
                      {g.bds.length > 8 && <div style={{ flexShrink: 0, width: 100, height: 70, borderRadius: 8, background: "#f5f5f5", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#999", fontWeight: 600 }}>+{g.bds.length - 8}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* Grid view */
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <button onClick={selAll} style={{ display: "flex", alignItems: "center", gap: 6, background: allSel ? "#eef2ff" : "#fff", border: "1px solid #ddd", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#555" }}>
                  {allSel ? <CheckCircle2 size={14} color="#6366f1" /> : <Grid3X3 size={14} />} {allSel ? "Deselect" : "Select all"} ({filtered.length})
                </button>
                <span style={{ fontSize: 12, color: "#999" }}>Click to select · Double-click to edit · Click tier badge to toggle</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))`, gap: 14 }}>
                {filtered.map(bd => {
                  const sel = selectedIds.has(bd.id);
                  const picks = pickCounts[bd.id] ?? 0;
                  const earned = revenueBd[bd.id] ?? 0;
                  return (
                    <div key={bd.id} onClick={() => toggleSel(bd.id)} onDoubleClick={() => openEditor(bd)} style={{
                      background: "#fff", borderRadius: 12, overflow: "hidden", cursor: "pointer",
                      border: sel ? "2px solid #6366f1" : "1px solid #eee",
                      boxShadow: sel ? "0 0 0 3px rgba(99,102,241,0.15)" : "0 1px 3px rgba(0,0,0,0.04)",
                      opacity: bd.active ? 1 : 0.5, transition: "all 0.15s",
                    }}>
                      <div style={{ height: Math.round(thumbSize * 0.6), position: "relative", overflow: "hidden" }}>
                        <img loading="lazy" src={bd.image_url} alt={bd.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        {/* Selection */}
                        <div style={{ position: "absolute", top: 6, left: 6, width: 22, height: 22, borderRadius: "50%", background: sel ? "#6366f1" : "rgba(255,255,255,0.85)", border: sel ? "none" : "1.5px solid #ccc", display: "flex", alignItems: "center", justifyContent: "center" }}>{sel && <Check size={13} color="#fff" strokeWidth={3} />}</div>
                        {/* 2026-04-25: tiny landscape badge so photographer can
                            see at a glance which backdrops are opted in to
                            landscape on the parents portal, without opening
                            the editor. */}
                        {bd.supports_landscape && (
                          <div title="Supports landscape on parents portal" style={{ position: "absolute", top: 6, left: 32, background: "#1d4ed8", color: "#fff", fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 5, letterSpacing: "0.04em" }}>↔ LANDSCAPE</div>
                        )}
                        {/* Tier badge */}
                        <button onClick={e => { e.stopPropagation(); quickTier(bd); }} style={{ position: "absolute", top: 6, right: 6, background: bd.tier === "premium" ? "#f59e0b" : "#22c55e", color: bd.tier === "premium" ? "#000" : "#fff", fontSize: 9, fontWeight: 800, padding: "3px 7px", borderRadius: 6, border: "none", cursor: "pointer" }}>{bd.tier === "premium" ? `★ $${(bd.price_cents / 100).toFixed(2)}` : "FREE"}</button>
                        {/* Hidden overlay */}
                        {!bd.active && <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ background: "#666", color: "#fff", padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700 }}>Hidden</span></div>}
                        {/* Popular badge */}
                        {sortPopular && popularLoaded && picks > 0 && (
                          <div style={{ position: "absolute", bottom: 6, left: 6, background: "#ea580c", borderRadius: 6, padding: "2px 7px", display: "flex", alignItems: "center", gap: 3, boxShadow: "0 2px 6px rgba(0,0,0,0.3)" }}>
                            <Flame size={10} color="#fff" />
                            <span style={{ fontSize: 9, fontWeight: 800, color: "#fff" }}>{picks} pick{picks !== 1 ? "s" : ""}</span>
                          </div>
                        )}
                      </div>
                      <div style={{ padding: "10px 12px" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: bd.active ? "#111" : "#999", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bd.name}</div>
                        {sortPopular && popularLoaded && earned > 0 && (
                          <div style={{ fontSize: 10, fontWeight: 700, color: "#16a34a", marginTop: 2 }}>Earned ${(earned / 100).toFixed(2)}</div>
                        )}
                        <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                          <button onClick={e => { e.stopPropagation(); openEditor(bd); }} style={{ flex: 1, background: "#f5f5f5", border: "none", borderRadius: 6, padding: 6, cursor: "pointer", fontSize: 11, color: "#666", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}><Pencil size={11} /> Edit</button>
                          <button onClick={e => { e.stopPropagation(); toggleVis(bd); }} title={bd.active ? "Hide" : "Show"} style={{ background: "#f5f5f5", border: "none", borderRadius: 6, padding: "6px 8px", cursor: "pointer", color: "#666", display: "flex", alignItems: "center" }}>{bd.active ? <Eye size={12} /> : <EyeOff size={12} />}</button>
                          <button onClick={e => { e.stopPropagation(); duplicateOne(bd); }} title="Duplicate" style={{ background: "#f5f5f5", border: "none", borderRadius: 6, padding: "6px 8px", cursor: "pointer", color: "#666", display: "flex", alignItems: "center" }}><Copy size={12} /></button>
                          <button onClick={e => { e.stopPropagation(); delOne(bd.id); }} title="Delete" style={{ background: "#fef2f2", border: "none", borderRadius: 6, padding: "6px 8px", cursor: "pointer", color: "#ef4444", display: "flex", alignItems: "center" }}><Trash2 size={12} /></button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bulk Upload Modal */}
      {showUpload && (
        <div onClick={() => setShowUpload(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 500, background: "#fff", borderRadius: 20, padding: 32, boxShadow: "0 24px 80px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Bulk Upload</h2>
              <button onClick={() => setShowUpload(false)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: 6, cursor: "pointer", display: "flex", color: "#666" }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: 13, color: "#888", margin: "0 0 20px", lineHeight: 1.6 }}>Select multiple images. They&apos;ll share the category and tier below.</p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Category</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {CATS.map(c => <button key={c.key} onClick={() => setUpCat(c.key)} style={{ padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontSize: 12, fontWeight: upCat === c.key ? 700 : 500, border: upCat === c.key ? `2px solid ${c.color}` : "1.5px solid #e1e3e8", background: upCat === c.key ? c.bg : "#fff", color: upCat === c.key ? c.color : "#666" }}>{c.icon} {c.label}</button>)}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pricing</label>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => setUpTier("free")} style={{ flex: 1, padding: 14, borderRadius: 12, cursor: "pointer", textAlign: "center", border: upTier === "free" ? "2px solid #22c55e" : "1.5px solid #e1e3e8", background: upTier === "free" ? "#f0fdf4" : "#fff" }}><div style={{ fontSize: 13, fontWeight: 700, color: upTier === "free" ? "#166534" : "#999" }}>Free</div><div style={{ fontSize: 11, color: "#888" }}>Included</div></button>
                <button onClick={() => setUpTier("premium")} style={{ flex: 1, padding: 14, borderRadius: 12, cursor: "pointer", textAlign: "center", border: upTier === "premium" ? "2px solid #f59e0b" : "1.5px solid #e1e3e8", background: upTier === "premium" ? "#fffbeb" : "#fff" }}><div style={{ fontSize: 13, fontWeight: 700, color: upTier === "premium" ? "#92400e" : "#999" }}>Premium</div><div style={{ fontSize: 11, color: "#888" }}>Paid add-on</div></button>
              </div>
            </div>
            {upTier === "premium" && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 6, textTransform: "uppercase" }}>Price (USD)</label>
                <input type="number" min="0" step="0.01" value={upPrice} onChange={e => setUpPrice(e.target.value)} placeholder="4.99" style={{ width: "100%", border: "1.5px solid #e1e3e8", borderRadius: 10, padding: "10px 14px", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleBulkUpload} style={{ display: "none" }} />
            {uploading ? (
              <div style={{ textAlign: "center", padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#333", marginBottom: 8 }}>Uploading {upDone}/{upQueue}…</div>
                <div style={{ height: 6, background: "#eee", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", background: "#111", borderRadius: 3, width: `${upQueue > 0 ? (upDone / upQueue) * 100 : 0}%`, transition: "width 0.3s" }} /></div>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} style={{ width: "100%", padding: 14, background: "#111", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Images size={18} /> Choose Images</button>
            )}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editorOpen && (
        <div onClick={() => setEditorOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 500, background: "#fff", borderRadius: 20, padding: 32, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{editBd ? "Edit Backdrop" : "Add Backdrop"}</h2>
              <button onClick={() => setEditorOpen(false)} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, padding: 6, cursor: "pointer", display: "flex", color: "#666" }}><X size={18} /></button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {editUrl && <img loading="lazy" src={editUrl} alt="" style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 12, border: "1px solid #eee" }} />}
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 5, textTransform: "uppercase" }}>Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} placeholder="e.g. Classic Grey" style={{ width: "100%", border: "1.5px solid #e1e3e8", borderRadius: 10, padding: "10px 14px", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 5, textTransform: "uppercase" }}>Description</label>
                <input value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Optional" style={{ width: "100%", border: "1.5px solid #e1e3e8", borderRadius: 10, padding: "10px 14px", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 5, textTransform: "uppercase" }}>Category</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {CATS.map(c => <button key={c.key} onClick={() => setEditCat(c.key)} style={{ padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontSize: 12, fontWeight: editCat === c.key ? 700 : 500, border: editCat === c.key ? `2px solid ${c.color}` : "1.5px solid #e1e3e8", background: editCat === c.key ? c.bg : "#fff", color: editCat === c.key ? c.color : "#666" }}>{c.label}</button>)}
                </div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 5, textTransform: "uppercase" }}>Pricing Tier</label>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setEditTier("free")} style={{ flex: 1, padding: 14, borderRadius: 12, cursor: "pointer", textAlign: "center", border: editTier === "free" ? "2px solid #22c55e" : "1.5px solid #e1e3e8", background: editTier === "free" ? "#f0fdf4" : "#fff" }}><div style={{ fontSize: 13, fontWeight: 700, color: editTier === "free" ? "#166534" : "#999" }}>Free</div></button>
                  <button onClick={() => setEditTier("premium")} style={{ flex: 1, padding: 14, borderRadius: 12, cursor: "pointer", textAlign: "center", border: editTier === "premium" ? "2px solid #f59e0b" : "1.5px solid #e1e3e8", background: editTier === "premium" ? "#fffbeb" : "#fff" }}><div style={{ fontSize: 13, fontWeight: 700, color: editTier === "premium" ? "#92400e" : "#999" }}>Premium</div></button>
                </div>
              </div>
              {editTier === "premium" && (
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 5, textTransform: "uppercase" }}>Price (USD)</label>
                  <input type="number" min="0" step="0.01" value={editPrice} onChange={e => setEditPrice(e.target.value)} style={{ width: "100%", border: "1.5px solid #e1e3e8", borderRadius: 10, padding: "10px 14px", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
                </div>
              )}
              {/* Orientation: scenic / wide backdrops can opt in to landscape mode.
                  Default off so existing portrait-only backdrops behave exactly
                  as before.  Parent UI flips a Portrait/Landscape toggle on
                  these in the CHOOSE BACKDROP panel. */}
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#666", marginBottom: 5, textTransform: "uppercase" }}>Orientation</label>
                <button
                  type="button"
                  onClick={() => setEditSupportsLandscape((v) => !v)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 12,
                    padding: 14, borderRadius: 12, cursor: "pointer", textAlign: "left",
                    border: editSupportsLandscape ? "2px solid #2563eb" : "1.5px solid #e1e3e8",
                    background: editSupportsLandscape ? "#eff6ff" : "#fff",
                  }}
                >
                  <span style={{
                    width: 22, height: 22, borderRadius: 6,
                    border: editSupportsLandscape ? "none" : "1.5px solid #ccc",
                    background: editSupportsLandscape ? "#2563eb" : "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    {editSupportsLandscape && <Check size={14} color="#fff" strokeWidth={3} />}
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: editSupportsLandscape ? "#1d4ed8" : "#333" }}>
                      Supports landscape
                    </span>
                    <span style={{ display: "block", fontSize: 11, color: "#888", marginTop: 2, lineHeight: 1.5 }}>
                      Tick if this scenery looks right rotated wide. Parents will
                      see a Portrait/Landscape toggle in the CHOOSE BACKDROP panel.
                      Leave off for tight or vertical-only backdrops.
                    </span>
                  </span>
                </button>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                <button onClick={() => setEditorOpen(false)} style={{ flex: 1, background: "#fff", border: "1.5px solid #ddd", borderRadius: 10, padding: 11, fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#333" }}>Cancel</button>
                <button onClick={saveEditor} disabled={saving || !editName.trim()} style={{ flex: 1, background: "#111", color: "#fff", border: "none", borderRadius: 10, padding: 11, fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: saving ? 0.5 : 1 }}>{saving ? "Saving…" : editBd ? "Save" : "Add"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
