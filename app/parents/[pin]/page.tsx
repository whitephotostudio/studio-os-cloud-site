"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, Heart,
  Mail, Monitor, Phone, ShoppingBag, Truck, User, X, Info,
  Package, Plus, ShoppingCart, Printer, Download, Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ── Types ──────────────────────────────────────────────────────────────────
type StudentRow = {
  id: string; first_name: string; last_name: string | null;
  photo_url: string | null; class_id: string | null; school_id: string;
  class_name?: string | null; folder_name?: string | null; pin?: string | null;
};
type SchoolRow = {
  id: string; school_name: string | null;
  photographer_id: string | null; package_profile_id: string | null;
};
type PackageItemValue = string | {
  qty?: number | string | null; name?: string | null;
  type?: string | null; size?: string | null; finish?: string | null;
};
type PackageRow = {
  id: string; name: string; description: string | null;
  price_cents: number; items?: PackageItemValue[] | null;
  profile_id?: string | null; category?: string | null;
};
type GalleryImage = { id: string; url: string; };
type DrawerView = "product-select" | "category-list" | "build-package" | "checkout";
type ItemSlot = { label: string; assignedImageUrl: string | null; };

// ── Constants ──────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://bwqhzczxoevouiondjak.supabase.co";
const BUCKET = "thumbs";

// ── Category config ────────────────────────────────────────────────────────
type TileConfig = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }> | null;
  keywords: string[];
};

const TILES: TileConfig[] = [
  { key: "package", label: "Packages",       icon: Package,   keywords: ["package"] },
  { key: "print",   label: "Prints",         icon: Printer,   keywords: ["print"] },
  { key: "canvas",  label: "Canvases",       icon: null,      keywords: ["canvas"] },
  { key: "digital", label: "Digitals",       icon: Download,  keywords: ["digital", "download", "usb"] },
  { key: "metal",   label: "Metal Prints",   icon: null,      keywords: ["metal"] },
  { key: "specialty", label: "Specialty",    icon: Sparkles,  keywords: ["specialty", "magnet", "mug", "ornament", "coaster", "puzzle"] },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function formatPackageItem(item: PackageItemValue): string {
  if (typeof item === "string") return item;
  const qty = item.qty !== undefined && item.qty !== null && String(item.qty).trim() !== "" ? `${item.qty} ` : "";
  const name = item.name?.trim() || "";
  const type = item.type?.trim() || "";
  const size = item.size?.trim() || "";
  const finish = item.finish?.trim() || "";
  return [qty + name, type, size, finish].filter(Boolean).join(" · ").trim() || "Package item";
}

function folderFromPhotoUrl(photoUrl: string): string | null {
  try {
    const marker = `/object/public/${BUCKET}/`;
    const idx = photoUrl.indexOf(marker);
    if (idx === -1) return null;
    const decoded = decodeURIComponent(photoUrl.slice(idx + marker.length));
    const parts = decoded.split("/");
    if (parts.length < 2) return null;
    return parts.slice(0, parts.length - 1).join("/");
  } catch { return null; }
}

function publicUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

function getCategory(pkg: PackageRow): string {
  const cat = (pkg.category ?? "").toLowerCase().trim();
  if (cat && cat !== "package") {
    // Map known categories
    if (cat === "digital") return "digital";
    if (cat === "canvas") return "canvas";
    if (cat === "metal") return "metal";
    if (cat === "print") return "print";
    if (cat === "specialty") return "specialty";
  }
  // Fallback: infer from name
  const n = pkg.name.toLowerCase();
  if (n.includes("digital") || n.includes("download") || n.includes("usb")) return "digital";
  if (n.includes("canvas")) return "canvas";
  if (n.includes("metal")) return "metal";
  if (n.includes("magnet") || n.includes("mug") || n.includes("ornament") || n.includes("coaster") || n.includes("puzzle")) return "specialty";
  if (cat === "print" || /^\d+x\d+/.test(n)) return "print";
  return "package";
}

function buildSlots(pkg: PackageRow): ItemSlot[] {
  const slots: ItemSlot[] = [];
  for (const item of pkg.items ?? []) {
    const baseLabel = formatPackageItem(item);
    const qty = typeof item === "object" && item.qty ? parseInt(String(item.qty), 10) || 1 : 1;
    for (let i = 0; i < qty; i++) {
      slots.push({ label: qty > 1 ? `${baseLabel} (${i + 1} of ${qty})` : baseLabel, assignedImageUrl: null });
    }
  }
  if (slots.length === 0) slots.push({ label: pkg.name, assignedImageUrl: null });
  return slots;
}

// Deduplicate packages by name+price (same item synced from multiple profiles)
function deduplicatePackages(pkgs: PackageRow[]): PackageRow[] {
  const seen = new Set<string>();
  return pkgs.filter(pkg => {
    const key = `${pkg.name.toLowerCase().trim()}|${pkg.price_cents}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Styles ─────────────────────────────────────────────────────────────────
const darkInput: React.CSSProperties = {
  width: "100%", border: "1px solid #2e2e2e", borderRadius: 8,
  padding: "11px 14px", fontSize: 14, outline: "none",
  boxSizing: "border-box", color: "#fff", background: "#1c1c1c", fontFamily: "inherit",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 10, fontWeight: 700, color: "#888",
  marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.08em",
};

// ══════════════════════════════════════════════════════════════════════════
export default function ParentGalleryPage() {
  const supabase = useMemo(() => createClient(), []);
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const pin = decodeURIComponent(String(params.pin ?? ""));
  const schoolId = searchParams.get("school") ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [student, setStudent] = useState<StudentRow | null>(null);
  const [schoolName, setSchoolName] = useState("");
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<PackageRow | null>(null);

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerView, setDrawerView] = useState<DrawerView>("product-select");
  const [activeCategoryKey, setActiveCategoryKey] = useState<string>("package");

  // Package builder
  const [slots, setSlots] = useState<ItemSlot[]>([]);
  const [activeSlotIndex, setActiveSlotIndex] = useState<number | null>(null);

  // Checkout
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"pickup" | "shipping">("pickup");
  const [shippingName, setShippingName] = useState("");
  const [shippingAddress1, setShippingAddress1] = useState("");
  const [shippingAddress2, setShippingAddress2] = useState("");
  const [shippingCity, setShippingCity] = useState("");
  const [shippingProvince, setShippingProvince] = useState("");
  const [shippingPostalCode, setShippingPostalCode] = useState("");
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [orderId, setOrderId] = useState("");
  const [placed, setPlaced] = useState(false);

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        if (!pin) { setError("Missing PIN."); setLoading(false); return; }
        setLoading(true); setError("");

        const { data: currentSchool } = schoolId
          ? await supabase.from("schools").select("id,school_name,photographer_id,package_profile_id").eq("id", schoolId).maybeSingle<SchoolRow>()
          : { data: null as SchoolRow | null };

        const schoolNameForMatch = currentSchool?.school_name?.trim() ?? "";
        let schoolIdsToSearch: string[] = [];
        if (schoolNameForMatch) {
          const { data: sns } = await supabase.from("schools").select("id").ilike("school_name", schoolNameForMatch);
          schoolIdsToSearch = Array.from(new Set([...(sns ?? []).map((s) => s.id), ...(schoolId ? [schoolId] : [])]));
        } else if (schoolId) { schoolIdsToSearch = [schoolId]; }

        let studentCandidates: StudentRow[] = [];
        const q = supabase.from("students").select("id,first_name,last_name,photo_url,class_id,school_id,class_name,folder_name,pin").eq("pin", pin);
        const { data } = schoolIdsToSearch.length > 0 ? await q.in("school_id", schoolIdsToSearch) : await q;
        studentCandidates = data ?? [];
        if (!studentCandidates.length) throw new Error("Student not found for this PIN.");

        const primaryStudent =
          studentCandidates.find((s) => s.school_id === schoolId && !!s.photo_url) ??
          studentCandidates.find((s) => !!s.photo_url) ??
          studentCandidates.find((s) => s.school_id === schoolId) ??
          studentCandidates[0];

        const { data: activeSchool } = await supabase.from("schools").select("id,school_name,photographer_id,package_profile_id").eq("id", primaryStudent.school_id).maybeSingle<SchoolRow>();

        // Load photos from storage
        const combinedImages: GalleryImage[] = [];
        const seenUrls = new Set<string>();
        let listedFromStorage = false;

        if (primaryStudent.photo_url) {
          const folder = folderFromPhotoUrl(primaryStudent.photo_url);
          if (folder) {
            const { data: storageFiles } = await supabase.storage.from(BUCKET).list(folder, { limit: 100, sortBy: { column: "name", order: "asc" } });
            if (storageFiles?.length) {
              for (const file of storageFiles) {
                if (!file.name || file.name.startsWith(".")) continue;
                const url = publicUrl(`${folder}/${file.name}`);
                if (!seenUrls.has(url)) { seenUrls.add(url); combinedImages.push({ id: file.id ?? file.name, url }); }
              }
              listedFromStorage = combinedImages.length > 0;
            }
          }
        }
        if (!listedFromStorage) {
          for (const s of studentCandidates) {
            if (s.photo_url && !seenUrls.has(s.photo_url)) { seenUrls.add(s.photo_url); combinedImages.push({ id: `student-${s.id}`, url: s.photo_url }); }
          }
        }

        // Load packages
        let packageRows: PackageRow[] = [];
        if (activeSchool?.photographer_id) {
          const normalizedProfile = (activeSchool.package_profile_id ?? "").trim().toLowerCase();
          if (normalizedProfile && normalizedProfile !== "default") {
            const { data: p } = await supabase.from("packages").select("id,name,description,price_cents,items,profile_id,category").eq("photographer_id", activeSchool.photographer_id).eq("active", true).eq("profile_id", activeSchool.package_profile_id).order("price_cents", { ascending: true });
            if (p?.length) packageRows = p;
          }
          if (packageRows.length === 0) {
            const { data: p } = await supabase.from("packages").select("id,name,description,price_cents,items,profile_id,category").eq("photographer_id", activeSchool.photographer_id).eq("active", true).order("price_cents", { ascending: true });
            packageRows = p ?? [];
          }
        }

        // Deduplicate
        packageRows = deduplicatePackages(packageRows);

        if (!mounted) return;
        setStudent(primaryStudent);
        setSchoolName(activeSchool?.school_name ?? currentSchool?.school_name ?? "");
        setImages(combinedImages);
        setSelectedImageIndex(0);
        setPackages(packageRows);
        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load gallery.");
        setLoading(false);
      }
    }
    void load();
    return () => { mounted = false; };
  }, [pin, schoolId, supabase]);

  const selectedImage = images[selectedImageIndex] ?? null;

  function goBack() { router.push("/parents"); }
  function goPrev() { if (!images.length) return; setSelectedImageIndex((p) => (p === 0 ? images.length - 1 : p - 1)); }
  function goNext() { if (!images.length) return; setSelectedImageIndex((p) => (p === images.length - 1 ? 0 : p + 1)); }

  function openBuyDrawer() { setDrawerView("product-select"); setDrawerOpen(true); setActiveSlotIndex(null); }

  function openCategory(catKey: string) {
    setActiveCategoryKey(catKey);
    setDrawerView("category-list");
  }

  function selectPackage(pkg: PackageRow) {
    setSelectedPkg(pkg);
    const newSlots = buildSlots(pkg);
    setSlots(newSlots.map((s) => ({ ...s, assignedImageUrl: selectedImage?.url ?? null })));
    setActiveSlotIndex(null);
    // Digital packages skip the build step — go straight to checkout
    if (getCategory(pkg) === "digital") {
      setDrawerView("checkout");
    } else {
      setDrawerView("build-package");
    }
  }

  function assignImageToSlot(imageUrl: string) {
    if (activeSlotIndex === null) return;
    setSlots((prev) => prev.map((s, i) => i === activeSlotIndex ? { ...s, assignedImageUrl: imageUrl } : s));
    const nextEmpty = slots.findIndex((s, i) => i > activeSlotIndex && !s.assignedImageUrl);
    setActiveSlotIndex(nextEmpty >= 0 ? nextEmpty : null);
  }

  const allSlotsAssigned = slots.every((s) => s.assignedImageUrl !== null);

  // Packages filtered by active category
  const packagesInCategory = packages.filter(p => getCategory(p) === activeCategoryKey);

  // Tiles with counts
  const tilesWithData = TILES.map(tile => ({
    ...tile,
    count: packages.filter(p => getCategory(p) === tile.key).length,
    minPrice: (() => {
      const pkgs = packages.filter(p => getCategory(p) === tile.key);
      return pkgs.length ? Math.min(...pkgs.map(p => p.price_cents)) / 100 : null;
    })(),
  })).filter(t => t.count > 0); // Only show tiles that have items

  async function handlePlaceOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!student || !selectedPkg) return;
    if (!parentEmail.trim()) { setOrderError("Email is required."); return; }
    if (deliveryMethod === "shipping" && (!shippingName.trim() || !shippingAddress1.trim() || !shippingCity.trim() || !shippingProvince.trim() || !shippingPostalCode.trim())) {
      setOrderError("Please complete the shipping information."); return;
    }
    setPlacing(true); setOrderError("");

    const { data: schoolRow } = await supabase.from("schools").select("photographer_id").eq("id", student.school_id).maybeSingle();
    const packagePrice = selectedPkg.price_cents / 100;
    const isDigital = getCategory(selectedPkg) === "digital";

    const slotsSummary = isDigital
      ? `Digital download order`
      : slots.map((s, i) => `Item ${i + 1}: ${s.label} → ${s.assignedImageUrl ?? "no photo"}`).join("\n");
    const shippingBlock = deliveryMethod === "shipping"
      ? [`Delivery: shipping`, `Name: ${shippingName.trim()}`, `Address: ${shippingAddress1.trim()}`, shippingAddress2.trim() ? `Line 2: ${shippingAddress2.trim()}` : "", `City: ${shippingCity.trim()}`, `Province: ${shippingProvince.trim()}`, `Postal: ${shippingPostalCode.trim()}`].filter(Boolean).join("\n")
      : "Delivery: pickup";

    const combinedNotes = [notes.trim(), isDigital ? "DIGITAL ORDER" : "PHOTO SELECTIONS:\n" + slotsSummary, shippingBlock].filter(Boolean).join("\n\n");

    const { data: orderRow, error: orderErr } = await supabase.from("orders").insert({
      school_id: student.school_id, class_id: student.class_id ?? null, student_id: student.id,
      photographer_id: schoolRow?.photographer_id ?? null,
      parent_name: parentName.trim() || null, parent_email: parentEmail.trim() || null, parent_phone: parentPhone.trim() || null,
      customer_name: parentName.trim() || null, customer_email: parentEmail.trim() || null,
      package_id: selectedPkg.id, package_name: selectedPkg.name, package_price: packagePrice,
      special_notes: combinedNotes || null, notes: combinedNotes || null,
      status: isDigital ? "digital_pending" : "new",
      seen_by_photographer: false,
      subtotal_cents: selectedPkg.price_cents, tax_cents: 0,
      total_cents: selectedPkg.price_cents, total_amount: packagePrice, currency: "cad",
    }).select("id").single();

    if (orderErr || !orderRow) { setOrderError(orderErr?.message ?? "Failed to place order."); setPlacing(false); return; }

    const itemsToInsert = isDigital
      ? [{ order_id: orderRow.id, product_name: selectedPkg.name, quantity: 1, price: packagePrice, unit_price_cents: selectedPkg.price_cents, line_total_cents: selectedPkg.price_cents, sku: null }]
      : slots.map((slot) => ({ order_id: orderRow.id, product_name: slot.label, quantity: 1, price: packagePrice / slots.length, unit_price_cents: Math.round(selectedPkg.price_cents / slots.length), line_total_cents: Math.round(selectedPkg.price_cents / slots.length), sku: slot.assignedImageUrl ?? null }));

    await supabase.from("order_items").insert(itemsToInsert);
    setOrderId(orderRow.id); setPlaced(true); setPlacing(false);
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ height: "100vh", background: "#080808", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width: 30, height: 30, border: "2px solid #222", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.75s linear infinite" }} />
      <span style={{ color: "#555", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" }}>Loading gallery</span>
    </div>
  );

  if (error || !student) return (
    <div style={{ height: "100vh", background: "#080808", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 400, background: "#111", border: "1px solid #1e1e1e", borderRadius: 16, padding: "44px 36px", textAlign: "center" }}>
        <div style={{ fontSize: 44, marginBottom: 16 }}>🔍</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", margin: "0 0 10px" }}>Gallery Not Found</h1>
        <p style={{ fontSize: 14, color: "#666", lineHeight: 1.7, margin: "0 0 24px" }}>{error || "Unable to load this gallery."}</p>
        <button type="button" onClick={goBack} style={{ background: "#fff", color: "#000", border: "none", borderRadius: 999, padding: "12px 24px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>← Back</button>
      </div>
    </div>
  );

  if (placed) return (
    <div style={{ height: "100vh", background: "#080808", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 440, background: "#111", border: "1px solid #1e1e1e", borderRadius: 20, padding: "52px 40px", textAlign: "center" }}>
        <div style={{ width: 68, height: 68, borderRadius: "50%", background: "#0f2e0f", border: "1.5px solid #1f5c1f", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
          <Check size={30} color="#4ade80" strokeWidth={2.5} />
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "#fff", margin: "0 0 10px" }}>Order Placed!</h1>
        <p style={{ fontSize: 14, color: "#888", lineHeight: 1.7, margin: "0 0 8px" }}>Your order has been sent to the photographer.</p>
        {parentEmail && <p style={{ fontSize: 13, color: "#555", margin: "0 0 24px" }}>Confirmation sent to <strong style={{ color: "#bbb" }}>{parentEmail}</strong></p>}
        <div style={{ background: "#161616", border: "1px solid #222", borderRadius: 10, padding: "12px 16px", marginBottom: 28 }}>
          <p style={{ fontSize: 10, color: "#444", margin: "0 0 5px", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700 }}>Order Reference</p>
          <p style={{ fontSize: 11, fontFamily: "monospace", color: "#555", margin: 0, wordBreak: "break-all" }}>{orderId}</p>
        </div>
        <button type="button" onClick={goBack} style={{ background: "#fff", color: "#000", border: "none", borderRadius: 999, padding: "13px 32px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Done</button>
      </div>
    </div>
  );

  // ── Main Gallery ──────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        html,body{margin:0;padding:0;height:100%;overflow:hidden;}
        @keyframes spin{to{transform:rotate(360deg)}}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:2px;}
      `}</style>

      <div style={{ position: "fixed", inset: 0, background: "#080808", color: "#fff", display: "flex", flexDirection: "column", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", overflow: "hidden" }}>

        {/* Top bar */}
        <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", borderBottom: "1px solid #141414", position: "relative", zIndex: 20 }}>
          <button type="button" onClick={goBack} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#aaa", border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer", padding: 0 }}>
            <ArrowLeft size={15} strokeWidth={2} /> Back
          </button>
          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none" }}>
            <div style={{ fontSize: 10, color: "#444", letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600 }}>{schoolName}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginTop: 1 }}>{student.first_name} {student.last_name ?? ""}&apos;s Gallery</div>
          </div>
          <button type="button" onClick={openBuyDrawer} style={{ background: "#fff", color: "#000", border: "none", borderRadius: 999, padding: "8px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            Buy Photo
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

          {/* Photo viewer */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
            <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 48px" }}>
              {images.length > 1 && (
                <button type="button" onClick={goPrev} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
                  <ChevronLeft size={20} strokeWidth={1.5} />
                </button>
              )}
              {selectedImage
                ? <img key={selectedImage.id} src={selectedImage.url} alt={student.first_name} style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", objectFit: "contain", display: "block", userSelect: "none" }} />
                : <div style={{ color: "#333", fontSize: 14 }}>No photos available</div>
              }
              {images.length > 1 && (
                <button type="button" onClick={goNext} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
                  <ChevronRight size={20} strokeWidth={1.5} />
                </button>
              )}
            </div>

            {/* Bottom bar */}
            <div style={{ flexShrink: 0, borderTop: "1px solid #141414", padding: "12px 20px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <div style={{ display: "flex", gap: 28 }}>
                <button type="button" style={{ background: "transparent", border: "none", color: "#555", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, padding: 0 }}>
                  <Heart size={13} strokeWidth={1.5} /> Favorite
                </button>
                <button type="button" onClick={openBuyDrawer} style={{ background: "transparent", border: "none", color: "#555", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, padding: 0 }}>
                  <ShoppingBag size={13} strokeWidth={1.5} /> Buy Photo
                </button>
              </div>
              {images.length > 0 && (
                <div style={{ display: "flex", gap: 5, overflowX: "auto", maxWidth: "100%", paddingBottom: 2, scrollbarWidth: "none" }}>
                  {images.map((img, idx) => {
                    const active = idx === selectedImageIndex;
                    return (
                      <button key={img.id} type="button" onClick={() => setSelectedImageIndex(idx)}
                        style={{ flexShrink: 0, padding: 0, background: "transparent", border: active ? "2px solid #fff" : "2px solid transparent", borderRadius: 5, overflow: "hidden", cursor: "pointer", opacity: active ? 1 : 0.4, transition: "opacity 0.12s, border-color 0.12s" }}>
                        <img src={img.url} alt="" style={{ width: 52, height: 52, objectFit: "cover", display: "block" }} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right drawer */}
          {drawerOpen && (
            <div style={{ width: 460, display: "flex", flexDirection: "column", background: "#1a1a1a", borderLeft: "1px solid #222", flexShrink: 0, overflow: "hidden" }}>

              {/* Drawer header */}
              <div style={{ height: 56, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 18px", gap: 8, borderBottom: "1px solid #252525", background: "#141414" }}>
                {drawerView !== "product-select" && (
                  <button type="button"
                    onClick={() => {
                      if (drawerView === "checkout") setDrawerView("build-package");
                      else if (drawerView === "build-package") setDrawerView("category-list");
                      else setDrawerView("product-select");
                    }}
                    style={{ background: "transparent", border: "none", color: "#aaa", cursor: "pointer", padding: 4, borderRadius: 6, display: "flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 500 }}>
                    <ChevronLeft size={16} /> Back
                  </button>
                )}
                <h2 style={{ flex: 1, margin: 0, textAlign: drawerView === "product-select" ? "left" : "center", fontSize: 12, fontWeight: 800, color: "#fff", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  {drawerView === "product-select" && "Select a Product"}
                  {drawerView === "category-list" && (TILES.find(t => t.key === activeCategoryKey)?.label ?? "Select")}
                  {drawerView === "build-package" && selectedPkg && `Building: ${selectedPkg.name}`}
                  {drawerView === "checkout" && "Checkout"}
                </h2>
                <button type="button" onClick={() => setDrawerOpen(false)} style={{ background: "transparent", border: "none", color: "#666", cursor: "pointer", padding: 4, borderRadius: 6, display: "flex" }}>
                  <X size={18} />
                </button>
              </div>

              {/* Drawer content */}
              <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>

                {/* ══ PRODUCT SELECT ══════════════════════════════════════ */}
                {drawerView === "product-select" && (
                  <>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.06)", borderRadius: 999, padding: "6px 16px", fontSize: 12, color: "#888" }}>
                        <Info size={12} /> Pricing info
                      </div>
                    </div>

                    {/* Dynamic category tiles — only show categories with items */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 22 }}>
                      {tilesWithData.map(tile => {
                        const Icon = tile.icon;
                        return (
                          <button key={tile.key} type="button" onClick={() => openCategory(tile.key)}
                            style={{ background: "#242424", border: "1px solid #2e2e2e", borderRadius: 14, padding: 0, cursor: "pointer", textAlign: "left", overflow: "hidden" }}>
                            <div style={{ height: 150, background: "#1e1e1e", overflow: "hidden", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {(tile.key === "package" || tile.key === "print") && selectedImage
                                ? <img src={selectedImage.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                : Icon ? <Icon size={36} color="#333" />
                                : <span style={{ fontSize: 11, fontWeight: 700, color: "#333", letterSpacing: "0.08em", textTransform: "uppercase" }}>{tile.label}</span>
                              }
                              {selectedImage && (tile.key === "package" || tile.key === "print") && (
                                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 50%)" }} />
                              )}
                            </div>
                            <div style={{ padding: "11px 13px 13px" }}>
                              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{tile.label}</div>
                              <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>
                                {tile.minPrice !== null ? `From $${tile.minPrice.toFixed(2)}` : "Available"}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Quick package list — only real packages */}
                    {packages.filter(p => getCategory(p) === "package").length > 0 && (
                      <>
                        <div style={{ fontSize: 10, fontWeight: 800, color: "#555", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>Package List</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {packages.filter(p => getCategory(p) === "package").map((pkg) => (
                            <div key={pkg.id} style={{ background: "#242424", border: "1px solid #2e2e2e", borderRadius: 12, padding: "13px 14px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: pkg.items?.length ? 8 : 12 }}>
                                <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{pkg.name}</div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: "#aaa", flexShrink: 0, marginLeft: 12 }}>${(pkg.price_cents / 100).toFixed(2)}</div>
                              </div>
                              {pkg.items?.length ? (
                                <div style={{ fontSize: 12, color: "#666", lineHeight: 1.8, marginBottom: 12 }}>
                                  {pkg.items.map((item, idx) => <div key={idx}>· {formatPackageItem(item)}</div>)}
                                </div>
                              ) : null}
                              <button type="button" onClick={() => selectPackage(pkg)}
                                style={{ width: "100%", background: "#fff", color: "#000", border: "none", borderRadius: 999, padding: "11px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                                Select Package
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* ══ CATEGORY LIST ══════════════════════════════════════ */}
                {drawerView === "category-list" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {packagesInCategory.length === 0 && (
                      <div style={{ background: "#242424", borderRadius: 12, padding: 28, color: "#666", fontSize: 13, textAlign: "center" }}>
                        No items available in this category.
                      </div>
                    )}
                    {packagesInCategory.map((pkg) => (
                      <div key={pkg.id} style={{ background: "#242424", border: "1px solid #2e2e2e", borderRadius: 14, overflow: "hidden" }}>
                        <div style={{ display: "flex", gap: 14, padding: "15px 15px 0" }}>
                          <div style={{ width: 80, height: 100, background: "#1e1e1e", borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>
                            {selectedImage && <img src={selectedImage.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{pkg.name}</div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: "#aaa", marginBottom: 8 }}>${(pkg.price_cents / 100).toFixed(2)}</div>
                            {pkg.items?.length ? (
                              <div style={{ fontSize: 12, color: "#666", lineHeight: 1.9 }}>
                                {pkg.items.map((item, idx) => <div key={idx}>· {formatPackageItem(item)}</div>)}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div style={{ padding: 15 }}>
                          <button type="button" onClick={() => selectPackage(pkg)}
                            style={{ width: "100%", background: "#fff", color: "#000", border: "none", borderRadius: 999, padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                            {getCategory(pkg) === "digital" ? "Order Digital" : "Select"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ══ BUILD PACKAGE ══════════════════════════════════════ */}
                {drawerView === "build-package" && selectedPkg && (
                  <>
                    <p style={{ fontSize: 13, color: "#777", margin: "0 0 18px", lineHeight: 1.6 }}>
                      Click a slot to select it, then tap a photo to assign it.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 22 }}>
                      {slots.map((slot, i) => {
                        const isActive = activeSlotIndex === i;
                        return (
                          <div key={i} onClick={() => setActiveSlotIndex(isActive ? null : i)}
                            style={{ display: "flex", alignItems: "center", gap: 14, background: isActive ? "#1e2a1e" : "#242424", border: isActive ? "1.5px solid #3a7a3a" : "1px solid #2e2e2e", borderRadius: 12, padding: "12px 14px", cursor: "pointer", transition: "border-color 0.15s, background 0.15s" }}>
                            <div style={{ width: 64, height: 64, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "#1a1a1a", border: isActive ? "2px solid #4ade80" : "2px solid #2e2e2e", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                              {slot.assignedImageUrl
                                ? <img src={slot.assignedImageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                : <Plus size={20} color={isActive ? "#4ade80" : "#444"} />
                              }
                              {isActive && <div style={{ position: "absolute", inset: 0, background: "rgba(74,222,128,0.15)", borderRadius: 6 }} />}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 3 }}>{slot.label}</div>
                              {slot.assignedImageUrl ? (
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
                                  <span style={{ fontSize: 11, color: "#4ade80" }}>Photo {images.findIndex(img => img.url === slot.assignedImageUrl) + 1} of {images.length} assigned</span>
                                </div>
                              ) : (
                                <div style={{ fontSize: 11, color: isActive ? "#aaa" : "#555" }}>{isActive ? "↓ Select a photo below" : "Tap to assign a photo"}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {activeSlotIndex !== null && (
                      <>
                        <div style={{ fontSize: 10, fontWeight: 800, color: "#555", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
                          Choose photo for slot {activeSlotIndex + 1}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 22 }}>
                          {images.map((img, idx) => {
                            const isAssigned = slots[activeSlotIndex]?.assignedImageUrl === img.url;
                            return (
                              <button key={img.id} type="button" onClick={() => assignImageToSlot(img.url)}
                                style={{ padding: 0, border: isAssigned ? "2.5px solid #4ade80" : "2px solid transparent", borderRadius: 8, overflow: "hidden", cursor: "pointer", background: "transparent", position: "relative", aspectRatio: "1" }}>
                                <img src={img.url} alt={`Photo ${idx + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                                {isAssigned && (
                                  <div style={{ position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: "50%", background: "#4ade80", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                    <Check size={11} color="#000" strokeWidth={3} />
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}

                    <button type="button" onClick={() => { if (allSlotsAssigned) setDrawerView("checkout"); }} disabled={!allSlotsAssigned}
                      style={{ width: "100%", background: allSlotsAssigned ? "#fff" : "#222", color: allSlotsAssigned ? "#000" : "#444", border: allSlotsAssigned ? "none" : "1px solid #333", borderRadius: 999, padding: "14px", fontSize: 14, fontWeight: 800, cursor: allSlotsAssigned ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "background 0.2s, color 0.2s" }}>
                      <ShoppingCart size={16} />
                      {allSlotsAssigned ? "Continue to Checkout" : `Assign all ${slots.length} photos to continue`}
                    </button>
                  </>
                )}

                {/* ══ CHECKOUT ══════════════════════════════════════════ */}
                {drawerView === "checkout" && selectedPkg && (
                  <form onSubmit={handlePlaceOrder} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ background: "#242424", border: "1px solid #2e2e2e", borderRadius: 12, padding: "14px 16px", marginBottom: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: getCategory(selectedPkg) !== "digital" ? 10 : 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{selectedPkg.name}</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>${(selectedPkg.price_cents / 100).toFixed(2)}</div>
                      </div>
                      {getCategory(selectedPkg) !== "digital" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {slots.map((slot, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ width: 36, height: 36, borderRadius: 6, overflow: "hidden", flexShrink: 0, background: "#1a1a1a" }}>
                                {slot.assignedImageUrl && <img src={slot.assignedImageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                              </div>
                              <div style={{ fontSize: 12, color: "#888" }}>{slot.label}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {getCategory(selectedPkg) === "digital" && (
                        <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Digital download — photos will be emailed to you</div>
                      )}
                    </div>

                    <div>
                      <label style={labelStyle}>Name</label>
                      <div style={{ position: "relative" }}>
                        <User size={13} color="#555" style={{ position: "absolute", left: 12, top: 12 }} />
                        <input value={parentName} onChange={(e) => setParentName(e.target.value)} placeholder="Jane Smith" style={{ ...darkInput, paddingLeft: 34 }} />
                      </div>
                    </div>

                    <div>
                      <label style={labelStyle}>Email *</label>
                      <div style={{ position: "relative" }}>
                        <Mail size={13} color="#555" style={{ position: "absolute", left: 12, top: 12 }} />
                        <input type="email" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} placeholder="jane@email.com" required style={{ ...darkInput, paddingLeft: 34 }} />
                      </div>
                    </div>

                    <div>
                      <label style={labelStyle}>Phone</label>
                      <div style={{ position: "relative" }}>
                        <Phone size={13} color="#555" style={{ position: "absolute", left: 12, top: 12 }} />
                        <input value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="(555) 000-0000" style={{ ...darkInput, paddingLeft: 34 }} />
                      </div>
                    </div>

                    {getCategory(selectedPkg) !== "digital" && (
                      <div>
                        <label style={labelStyle}>Delivery</label>
                        <div style={{ display: "flex", gap: 8 }}>
                          {(["pickup", "shipping"] as const).map((m) => (
                            <button key={m} type="button" onClick={() => setDeliveryMethod(m)}
                              style={{ flex: 1, border: "none", background: deliveryMethod === m ? "#fff" : "#242424", outline: deliveryMethod === m ? "none" : "1px solid #333", outlineOffset: -1, color: deliveryMethod === m ? "#000" : "#666", borderRadius: 8, padding: "11px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "background 0.15s, color 0.15s" }}>
                              {m === "shipping" && <Truck size={13} />}
                              {m.charAt(0).toUpperCase() + m.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {deliveryMethod === "shipping" && getCategory(selectedPkg) !== "digital" && (
                      <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                        <input value={shippingName} onChange={(e) => setShippingName(e.target.value)} placeholder="Full name" style={darkInput} />
                        <input value={shippingAddress1} onChange={(e) => setShippingAddress1(e.target.value)} placeholder="Address line 1" style={darkInput} />
                        <input value={shippingAddress2} onChange={(e) => setShippingAddress2(e.target.value)} placeholder="Address line 2 (optional)" style={darkInput} />
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <input value={shippingCity} onChange={(e) => setShippingCity(e.target.value)} placeholder="City" style={darkInput} />
                          <input value={shippingProvince} onChange={(e) => setShippingProvince(e.target.value)} placeholder="Province" style={darkInput} />
                        </div>
                        <input value={shippingPostalCode} onChange={(e) => setShippingPostalCode(e.target.value)} placeholder="Postal code" style={darkInput} />
                      </div>
                    )}

                    <div>
                      <label style={labelStyle}>Notes</label>
                      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Special requests…" rows={3} style={{ ...darkInput, resize: "vertical" }} />
                    </div>

                    {orderError && <div style={{ background: "#1e0a0a", border: "1px solid #4a1a1a", borderRadius: 8, padding: "10px 13px", color: "#f87171", fontSize: 12 }}>{orderError}</div>}

                    <div style={{ background: "#141414", border: "1px solid #252525", borderRadius: 10, padding: "12px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#555", marginBottom: 8 }}>
                        <span>Subtotal</span><span>${(selectedPkg.price_cents / 100).toFixed(2)}</span>
                      </div>
                      <div style={{ borderTop: "1px solid #222", paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, color: "#fff" }}>
                        <span>Total</span><span>${(selectedPkg.price_cents / 100).toFixed(2)}</span>
                      </div>
                    </div>

                    <button type="submit" disabled={placing}
                      style={{ width: "100%", background: placing ? "#222" : "#fff", color: placing ? "#555" : "#000", border: "none", borderRadius: 999, padding: "15px", fontSize: 15, fontWeight: 800, cursor: placing ? "not-allowed" : "pointer" }}>
                      {placing ? "Placing Order…" : getCategory(selectedPkg) === "digital" ? "Order Digital Photos" : "Place Order"}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
