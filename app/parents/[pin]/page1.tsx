"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  Mail,
  Phone,
  ShoppingBag,
  Truck,
  User,
  X,
  Info,
  Package,
  Plus,
  ShoppingCart,
  Printer,
  Download,
  Sparkles,
  Clock3,
  Palette,
  Eye,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// ── Types ──────────────────────────────────────────────────────────────────
type StudentRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  photo_url: string | null;
  class_id: string | null;
  school_id: string;
  class_name?: string | null;
  folder_name?: string | null;
  pin?: string | null;
};

type SchoolRow = {
  id: string;
  school_name: string | null;
  photographer_id: string | null;
  package_profile_id: string | null;
  local_school_id?: string | null;
};

type ProjectRow = {
  id: string;
  portal_status?: string | null;
  order_due_date?: string | null;
  expiration_date?: string | null;
  project_name?: string | null;
  name?: string | null;
  title?: string | null;
};

type PackageItemValue =
  | string
  | {
      qty?: number | string | null;
      name?: string | null;
      type?: string | null;
      size?: string | null;
      finish?: string | null;
    };

type PackageRow = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  items?: PackageItemValue[] | null;
  profile_id?: string | null;
  category?: string | null;
};

type GalleryImage = { id: string; url: string };

type BackdropRow = {
  id: string;
  name: string;
  image_url: string;
  thumbnail_url: string | null;
  tier: "free" | "premium";
  price_cents: number;
  category: string | null;
  tags: string[] | null;
  sort_order: number;
};
type DrawerView =
  | "product-select"
  | "category-list"
  | "build-package"
  | "checkout";
type ItemSlot = { label: string; assignedImageUrl: string | null };

function makeIndexedLabel(baseLabel: string, index: number, total: number): string {
  return total > 1 ? `${baseLabel} (${index} of ${total})` : baseLabel;
}

// ── Constants ──────────────────────────────────────────────────────────────
const SUPABASE_URL = "https://bwqhzczxoevouiondjak.supabase.co";
const BUCKET = "thumbs";
const NOBG_BUCKET = "nobg-photos";

const BACKDROP_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "solid", label: "Solids" },
  { key: "gradient", label: "Gradients" },
  { key: "scenic", label: "Scenic" },
  { key: "holiday", label: "Holiday" },
  { key: "sports", label: "Sports" },
  { key: "custom", label: "Custom" },
];

// ── Category config ────────────────────────────────────────────────────────
type TileConfig = {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }> | null;
  keywords: string[];
};

const TILES: TileConfig[] = [
  {
    key: "package",
    label: "Packages",
    icon: Package,
    keywords: ["package"],
  },
  {
    key: "print",
    label: "Prints",
    icon: Printer,
    keywords: ["print"],
  },
  { key: "canvas", label: "Canvases", icon: null, keywords: ["canvas"] },
  {
    key: "digital",
    label: "Digitals",
    icon: Download,
    keywords: ["digital", "download", "usb"],
  },
  { key: "metal", label: "Metal Prints", icon: null, keywords: ["metal"] },
  {
    key: "specialty",
    label: "Specialty",
    icon: Sparkles,
    keywords: ["specialty", "magnet", "mug", "ornament", "coaster", "puzzle"],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function formatPackageItem(item: PackageItemValue): string {
  if (typeof item === "string") return item;
  const qty =
    item.qty !== undefined &&
    item.qty !== null &&
    String(item.qty).trim() !== ""
      ? `${item.qty} `
      : "";
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
  } catch {
    return null;
  }
}

function publicUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

function normalizeStorageFolder(path: string): string {
  return path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function uniqueFolders(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const folder = normalizeStorageFolder(value ?? "");
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);
    out.push(folder);
  }
  return out;
}

function isImageFileName(name: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

function getCategory(pkg: PackageRow): string {
  const cat = (pkg.category ?? "").toLowerCase().trim();
  if (cat && cat !== "package") {
    if (cat === "digital") return "digital";
    if (cat === "canvas") return "canvas";
    if (cat === "metal") return "metal";
    if (cat === "print") return "print";
    if (cat === "specialty") return "specialty";
  }

  const n = pkg.name.toLowerCase();
  if (n.includes("digital") || n.includes("download") || n.includes("usb"))
    return "digital";
  if (n.includes("canvas")) return "canvas";
  if (n.includes("metal")) return "metal";
  if (
    n.includes("magnet") ||
    n.includes("mug") ||
    n.includes("ornament") ||
    n.includes("coaster") ||
    n.includes("puzzle")
  )
    return "specialty";
  if (cat === "print" || /^\d+x\d+/.test(n)) return "print";
  return "package";
}

function buildSlots(pkg: PackageRow, orderQty: number = 1): ItemSlot[] {
  const slots: ItemSlot[] = [];
  const safeOrderQty = Math.max(1, orderQty);

  for (const item of pkg.items ?? []) {
    const baseLabel = formatPackageItem(item);
    const qty =
      typeof item === "object" && item.qty
        ? parseInt(String(item.qty), 10) || 1
        : 1;

    for (let copy = 0; copy < safeOrderQty; copy++) {
      for (let i = 0; i < qty; i++) {
        const slotIndex = copy * qty + i + 1;
        const slotTotal = qty * safeOrderQty;
        slots.push({
          label: makeIndexedLabel(baseLabel, slotIndex, slotTotal),
          assignedImageUrl: null,
        });
      }
    }
  }

  if (slots.length === 0) {
    for (let i = 0; i < safeOrderQty; i++) {
      slots.push({
        label: makeIndexedLabel(pkg.name, i + 1, safeOrderQty),
        assignedImageUrl: null,
      });
    }
  }

  return slots;
}

function deduplicatePackages(pkgs: PackageRow[]): PackageRow[] {
  const seen = new Set<string>();
  return pkgs.filter((pkg) => {
    const key = `${pkg.name.toLowerCase().trim()}|${pkg.price_cents}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getProjectName(project: ProjectRow | null): string {
  return project?.project_name || project?.name || project?.title || "Gallery";
}


type PreviewKind = "package" | "print" | "canvas" | "digital" | "metal" | "specialty";

function getPreviewKind(key: string): PreviewKind {
  if (key === "print") return "print";
  if (key === "canvas") return "canvas";
  if (key === "digital") return "digital";
  if (key === "metal") return "metal";
  if (key === "specialty") return "specialty";
  return "package";
}

function renderPhotoSurface(imageUrl?: string | null, style?: React.CSSProperties) {
  if (!imageUrl) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04))",
          color: "rgba(255,255,255,0.55)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          ...style,
        }}
      >
        Preview
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt=""
      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", ...style }}
    />
  );
}

function parsePrintRatio(sizeLabel?: string | null) {
  const match = (sizeLabel ?? "").match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  if (!match) return { w: 4, h: 5 };
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return { w: 4, h: 5 };
  const w = Math.min(a, b);
  const h = Math.max(a, b);
  return { w, h };
}

function getPrintScale(sizeLabel?: string | null) {
  const match = (sizeLabel ?? "").match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  if (!match) return 1;
  const a = Number(match[1]);
  const b = Number(match[2]);
  const area = a * b;
  if (area <= 35) return 0.82;
  if (area <= 80) return 1.0;
  if (area <= 160) return 1.18;
  if (area <= 320) return 1.34;
  return 1.48;
}

function renderPremiumMockup(kind: PreviewKind, imageUrl?: string | null, variant = 0, compact = false, sizeLabel?: string | null) {
  const ratio = parsePrintRatio(sizeLabel);
  const sizeScale = getPrintScale(sizeLabel);
  const shell: React.CSSProperties = {
    width: "100%",
    height: "100%",
    position: "relative",
    overflow: "hidden",
    borderRadius: compact ? 14 : 18,
    background:
      kind === "digital"
        ? "linear-gradient(180deg, #10131a 0%, #1e2431 100%)"
        : kind === "metal"
        ? "linear-gradient(180deg, #dadfe5 0%, #c4cbd3 100%)"
        : kind === "canvas"
        ? "linear-gradient(180deg, #efe7dc 0%, #ddd2c5 100%)"
        : kind === "specialty"
        ? "linear-gradient(180deg, #f2efeb 0%, #ddd7d0 100%)"
        : "linear-gradient(180deg, #f5f2ee 0%, #e5dfd7 100%)",
  };

  const sceneBackground = (src: string) => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `url(${src})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    />
  );

  const framedPhoto = (
    photoStyle: React.CSSProperties,
    frameStyle?: React.CSSProperties,
    innerStyle?: React.CSSProperties,
    extra?: React.ReactNode
  ) => (
    <div
      style={{
        position: "absolute",
        ...photoStyle,
        background: "transparent",
        overflow: "hidden",
        boxShadow: "0 18px 40px rgba(25,25,25,0.22)",
        ...frameStyle,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          background: "transparent",
          ...innerStyle,
        }}
      >
        {renderPhotoSurface(imageUrl, { objectFit: "cover", objectPosition: "center center" })}
      </div>
      {extra}
    </div>
  );

  const portraitFrameStyle = (baseWidth: number, top: string, left: string) => ({
    left,
    top,
    width: `${baseWidth * sizeScale}%`,
    aspectRatio: `${ratio.w} / ${ratio.h}`,
    height: "auto",
    borderRadius: compact ? 2 : 3,
    padding: 0,
  } as React.CSSProperties);

  if (kind === "package") {
    return (
      <div style={shell}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at top, rgba(255,255,255,0.88), rgba(255,255,255,0.18) 42%, transparent 72%)",
          }}
        />
        {[0, 1, 2].map((idx) => (
          <div
            key={idx}
            style={{
              position: "absolute",
              width: compact ? 78 : 106,
              height: compact ? 104 : 142,
              top: compact ? 26 + idx * 4 : 28 + idx * 6,
              left: compact
                ? idx === 0
                  ? 18
                  : idx === 1
                  ? 58
                  : 100
                : idx === 0
                ? 26
                : idx === 1
                ? 86
                : 146,
              transform:
                idx === 0 ? "rotate(-8deg)" : idx === 1 ? "rotate(0deg)" : "rotate(8deg)",
              borderRadius: 14,
              background: "#fff",
              padding: compact ? 6 : 8,
              boxShadow: "0 18px 36px rgba(20,20,20,0.16)",
            }}
          >
            <div style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: 8 }}>
              {renderPhotoSurface(imageUrl)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (kind === "digital") {
    return (
      <div style={shell}>
        <div
          style={{
            position: "absolute",
            inset: compact ? "18% 12% 22%" : "14% 10% 24%",
            borderRadius: 16,
            background: "#121722",
            boxShadow: "0 20px 40px rgba(0,0,0,0.35)",
            padding: compact ? 8 : 12,
          }}
        >
          <div style={{ width: "100%", height: "100%", borderRadius: 10, overflow: "hidden", background: "#0c111a" }}>
            {renderPhotoSurface(imageUrl)}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: compact ? 24 : 18,
            transform: "translateX(-50%)",
            width: compact ? 90 : 120,
            height: compact ? 10 : 12,
            borderRadius: 999,
            background: "rgba(255,255,255,0.18)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: compact ? 16 : 18,
            top: compact ? 16 : 18,
            background: "rgba(255,255,255,0.12)",
            color: "#fff",
            borderRadius: 999,
            padding: compact ? "5px 8px" : "6px 10px",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          Instant
        </div>
      </div>
    );
  }

  if (kind === "specialty") {
    return (
      <div style={shell}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0.08))",
          }}
        />
        <div style={{ position: "absolute", left: compact ? 18 : 24, bottom: compact ? 24 : 26 }}>
          <div
            style={{
              width: compact ? 66 : 84,
              height: compact ? 74 : 94,
              borderRadius: 14,
              background: "#fff",
              padding: 7,
              boxShadow: "0 12px 30px rgba(40,40,40,0.18)",
              transform: variant % 2 === 0 ? "rotate(-7deg)" : "rotate(0deg)",
            }}
          >
            <div style={{ width: "100%", height: "100%", borderRadius: 10, overflow: "hidden" }}>
              {renderPhotoSurface(imageUrl)}
            </div>
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            right: compact ? 22 : 28,
            top: compact ? 24 : 28,
            width: compact ? 62 : 78,
            height: compact ? 62 : 78,
            borderRadius: 999,
            background: "#f4efe8",
            boxShadow: "0 12px 24px rgba(40,40,40,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <div style={{ width: "72%", height: "72%", borderRadius: 999, overflow: "hidden" }}>
            {renderPhotoSurface(imageUrl)}
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            right: compact ? 16 : 20,
            bottom: compact ? 18 : 22,
            width: compact ? 76 : 96,
            height: compact ? 56 : 74,
            borderRadius: 14,
            background: "#fff",
            boxShadow: "0 14px 24px rgba(40,40,40,0.16)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#8b7e71",
            fontSize: compact ? 10 : 12,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Gift
        </div>
      </div>
    );
  }

  if (variant === 0) {
    return (
      <div style={shell}>
        {sceneBackground("/mockups/prints/wall.webp")}
        {framedPhoto(
          compact
            ? portraitFrameStyle(9.8, "3.5%", `${29 - ((9.8 * sizeScale) / 2)}%`)
            : portraitFrameStyle(8.2, "3%", `${32 - ((8.2 * sizeScale) / 2)}%`),
          {
            background: "transparent",
            boxShadow:
              kind === "canvas"
                ? "0 22px 42px rgba(25,25,25,0.22)"
                : "0 16px 34px rgba(25,25,25,0.20)",
          },
          {
            background: "transparent",
            borderRadius: kind === "canvas" ? (compact ? 2 : 3) : 2,
          }
        )}
      </div>
    );
  }

  if (variant === 1) {
    return (
      <div style={shell}>
        {sceneBackground("/mockups/prints/desktop.webp")}
        {framedPhoto(
          compact
            ? portraitFrameStyle(11.5, "42%", `${16 - ((11.5 * sizeScale - 11.5) / 2)}%`)
            : portraitFrameStyle(9.5, "37.5%", `${14 - ((9.5 * sizeScale - 9.5) / 2)}%`),
          {
            background: "transparent",
            boxShadow:
              kind === "canvas"
                ? "0 12px 28px rgba(25,25,25,0.22)"
                : "0 14px 28px rgba(25,25,25,0.20)",
            transform: compact ? "rotate(-1.2deg)" : "rotate(-1.8deg)",
          },
          { background: "transparent", borderRadius: kind === "canvas" ? (compact ? 2 : 3) : 2 }
        )}
      </div>
    );
  }

  if (kind === "canvas") {
    return (
      <div style={shell}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(255,255,255,0.38), rgba(255,255,255,0.06))",
          }}
        />
        {framedPhoto(
          compact
            ? { left: "30%", top: "18%", width: "40%", height: "62%", borderRadius: 4 }
            : { left: "31%", top: "16%", width: "38%", height: "66%", borderRadius: 6 },
          {
            background: "transparent",
            padding: 0,
            boxShadow: "0 18px 36px rgba(40,40,40,0.18)",
          },
          { background: "transparent", borderRadius: compact ? 4 : 6 }
        )}
        <div
          style={{
            position: "absolute",
            inset: compact ? "18% 30% 18% 30%" : "16% 31% 18% 31%",
            borderRadius: compact ? 4 : 6,
            boxShadow: "inset -6px 0 12px rgba(0,0,0,0.10), inset 6px 0 12px rgba(255,255,255,0.15)",
            pointerEvents: "none",
          }}
        />
      </div>
    );
  }

  if (kind === "metal") {
    return (
      <div style={shell}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.03))",
          }}
        />
        {framedPhoto(
          compact
            ? portraitFrameStyle(24, "16%", `${50 - ((24 * sizeScale) / 2)}%`)
            : portraitFrameStyle(22, "12%", `${50 - ((22 * sizeScale) / 2)}%`),
          {
            background: "transparent",
            boxShadow: "0 22px 40px rgba(24,30,38,0.22)",
          },
          { borderRadius: compact ? 3 : 4 },
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(120deg, rgba(255,255,255,0.0) 18%, rgba(255,255,255,0.30) 38%, rgba(255,255,255,0.08) 55%, rgba(255,255,255,0.0) 78%)",
              mixBlendMode: "screen",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div style={shell}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(255,255,255,0.34), rgba(255,255,255,0.06))",
        }}
      />
      {framedPhoto(
        compact
          ? portraitFrameStyle(24, "16%", `${50 - ((24 * sizeScale) / 2)}%`)
          : portraitFrameStyle(22, "12%", `${50 - ((22 * sizeScale) / 2)}%`),
        {
          background: "transparent",
          boxShadow: "0 18px 36px rgba(25,25,25,0.20)",
        },
        { borderRadius: compact ? 3 : 4 }
      )}
    </div>
  );
}

const PREVIEW_LABELS = ["Wall", "Desk", "Close-up"];

function renderMockupStrip(
  kind: PreviewKind,
  imageUrl: string | null | undefined,
  activeVariant: number,
  sizeLabel: string | null | undefined,
  onSelect: (variant: number) => void
) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 14 }}>
      {[0, 1, 2].map((variant) => {
        const active = activeVariant === variant;
        return (
          <button
            key={variant}
            type="button"
            onClick={() => onSelect(variant)}
            style={{
              border: active ? "1px solid rgba(255,255,255,0.48)" : "1px solid rgba(255,255,255,0.10)",
              background: active ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.035)",
              borderRadius: 12,
              padding: 8,
              cursor: "pointer",
              width: "100%",
              minHeight: 96,
            }}
          >
            <div style={{ width: "100%", height: 60, borderRadius: 10, overflow: "hidden", background: "#1b1b1b" }}>
              {renderPremiumMockup(kind, imageUrl, variant, true, sizeLabel)}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: active ? "#fff" : "#9a9a9a" }}>
              {PREVIEW_LABELS[variant]}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Nobg helpers ──────────────────────────────────────────────────────────
function nobgPublicUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${NOBG_BUCKET}/${path}`;
}

/** Client-side canvas composite: backdrop image + nobg (transparent foreground) */
/** Repeating diagonal watermark overlay — prevents screenshots from being usable */
function WatermarkOverlay({ text, logoUrl }: { text: string; logoUrl?: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: 4,
        borderRadius: 6,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "-50%",
          left: "-50%",
          width: "200%",
          height: "200%",
          transform: "rotate(-30deg)",
          display: "flex",
          flexDirection: "column",
          gap: logoUrl ? 64 : 48,
          justifyContent: "center",
        }}
      >
        {Array.from({ length: 20 }).map((_, row) => (
          <div
            key={row}
            style={{
              display: "flex",
              gap: logoUrl ? 48 : 32,
              whiteSpace: "nowrap",
              paddingLeft: row % 2 === 0 ? 0 : 80,
              alignItems: "center",
            }}
          >
            {Array.from({ length: 12 }).map((_, col) =>
              logoUrl ? (
                <img
                  key={col}
                  src={logoUrl}
                  alt=""
                  draggable={false}
                  style={{
                    width: 60,
                    height: 60,
                    objectFit: "contain",
                    opacity: 0.22,
                    userSelect: "none",
                    pointerEvents: "none",
                    filter: "drop-shadow(0 0 2px rgba(0,0,0,0.4))",
                  }}
                />
              ) : (
                <span
                  key={col}
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.28)",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    fontFamily: "system-ui, sans-serif",
                    textShadow: "0 0 4px rgba(0,0,0,0.5)",
                    WebkitTextStroke: "0.3px rgba(0,0,0,0.15)",
                  } as React.CSSProperties}
                >
                  {text}
                </span>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CompositeCanvas({
  backdropUrl,
  nobgUrl,
  fallbackUrl,
  width,
  height,
  style,
}: {
  backdropUrl: string;
  nobgUrl: string | null;
  fallbackUrl: string;
  width: number;
  height: number;
  style?: React.CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;
    setReady(false);

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const bgImg = new Image();
    bgImg.crossOrigin = "anonymous";
    const fgImg = new Image();
    fgImg.crossOrigin = "anonymous";

    let bgLoaded = false;
    let fgLoaded = false;

    function draw() {
      if (cancelled || !bgLoaded || !fgLoaded) return;
      ctx!.clearRect(0, 0, width, height);

      // Draw backdrop (cover)
      const bgRatio = bgImg.naturalWidth / bgImg.naturalHeight;
      const canvasRatio = width / height;
      let sx = 0, sy = 0, sw = bgImg.naturalWidth, sh = bgImg.naturalHeight;
      if (bgRatio > canvasRatio) {
        sw = bgImg.naturalHeight * canvasRatio;
        sx = (bgImg.naturalWidth - sw) / 2;
      } else {
        sh = bgImg.naturalWidth / canvasRatio;
        sy = (bgImg.naturalHeight - sh) / 2;
      }
      ctx!.filter = "blur(3px)";
      ctx!.drawImage(bgImg, sx, sy, sw, sh, 0, 0, width, height);
      ctx!.filter = "none";

      // Draw foreground (contain, centered)
      const fgRatio = fgImg.naturalWidth / fgImg.naturalHeight;
      let dw: number, dh: number;
      if (fgRatio > canvasRatio) {
        dw = width;
        dh = width / fgRatio;
      } else {
        dh = height;
        dw = height * fgRatio;
      }
      const dx = (width - dw) / 2;
      const dy = (height - dh) / 2;
      ctx!.drawImage(fgImg, dx, dy, dw, dh);

      setReady(true);
    }

    bgImg.onload = () => { bgLoaded = true; draw(); };
    fgImg.onload = () => { fgLoaded = true; draw(); };
    bgImg.onerror = () => { bgLoaded = true; draw(); };
    fgImg.onerror = () => {
      // If nobg fails, fall back to original photo
      fgImg.src = fallbackUrl;
    };

    bgImg.src = backdropUrl;
    fgImg.src = nobgUrl || fallbackUrl;

    return () => { cancelled = true; };
  }, [backdropUrl, nobgUrl, fallbackUrl, width, height]);

  return (
    <div style={{ position: "relative", width, height, ...style }}>
      <canvas
        ref={canvasRef}
        style={{
          width,
          height,
          display: "block",
          borderRadius: 6,
          opacity: ready ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
      />
      {!ready && (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#444",
          fontSize: 12,
        }}>
          Loading preview…
        </div>
      )}
    </div>
  );
}

/** Tiny canvas composite for photo strip thumbnails (72×72) */
function MiniComposite({
  backdropUrl,
  nobgUrl,
  fallbackUrl,
  size = 72,
}: {
  backdropUrl: string;
  nobgUrl: string;
  fallbackUrl: string;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const bgImg = new Image();
    bgImg.crossOrigin = "anonymous";
    const fgImg = new Image();
    fgImg.crossOrigin = "anonymous";

    let bgDone = false, fgDone = false;

    function draw() {
      if (!bgDone || !fgDone) return;
      ctx!.clearRect(0, 0, size, size);
      // BG cover (square crop)
      const bgR = bgImg.naturalWidth / bgImg.naturalHeight;
      let sx = 0, sy = 0, sw = bgImg.naturalWidth, sh = bgImg.naturalHeight;
      if (bgR > 1) { sw = sh; sx = (bgImg.naturalWidth - sw) / 2; }
      else { sh = sw; sy = (bgImg.naturalHeight - sh) / 2; }
      ctx!.filter = "blur(2px)";
      ctx!.drawImage(bgImg, sx, sy, sw, sh, 0, 0, size, size);
      ctx!.filter = "none";
      // FG contain
      const fR = fgImg.naturalWidth / fgImg.naturalHeight;
      let dw: number, dh: number;
      if (fR > 1) { dw = size; dh = size / fR; } else { dh = size; dw = size * fR; }
      ctx!.drawImage(fgImg, (size - dw) / 2, (size - dh) / 2, dw, dh);
    }

    bgImg.onload = () => { bgDone = true; draw(); };
    fgImg.onload = () => { fgDone = true; draw(); };
    bgImg.onerror = () => { bgDone = true; draw(); };
    fgImg.onerror = () => { fgDone = true; draw(); };

    bgImg.src = backdropUrl;
    fgImg.src = nobgUrl || fallbackUrl;
  }, [backdropUrl, nobgUrl, fallbackUrl, size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, display: "block" }}
    />
  );
}

/** Smaller backdrop thumbnail with canvas composite preview */
function BackdropThumbCanvas({
  backdropUrl,
  nobgUrl,
  fallbackUrl,
  selected,
  isPremium,
  onClick,
}: {
  backdropUrl: string;
  nobgUrl: string | null;
  fallbackUrl: string;
  selected: boolean;
  isPremium: boolean;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 80;
    const h = 100;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = size * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const bgImg = new Image();
    bgImg.crossOrigin = "anonymous";
    const fgImg = new Image();
    fgImg.crossOrigin = "anonymous";

    let bgDone = false, fgDone = false;

    function draw() {
      if (!bgDone || !fgDone) return;
      ctx!.clearRect(0, 0, size, h);
      // BG cover
      const bgR = bgImg.naturalWidth / bgImg.naturalHeight;
      const cR = size / h;
      let sx2 = 0, sy2 = 0, sw2 = bgImg.naturalWidth, sh2 = bgImg.naturalHeight;
      if (bgR > cR) { sw2 = bgImg.naturalHeight * cR; sx2 = (bgImg.naturalWidth - sw2) / 2; }
      else { sh2 = bgImg.naturalWidth / cR; sy2 = (bgImg.naturalHeight - sh2) / 2; }
      ctx!.filter = "blur(2px)";
      ctx!.drawImage(bgImg, sx2, sy2, sw2, sh2, 0, 0, size, h);
      ctx!.filter = "none";
      // FG contain
      const fR = fgImg.naturalWidth / fgImg.naturalHeight;
      let dw2: number, dh2: number;
      if (fR > cR) { dw2 = size; dh2 = size / fR; } else { dh2 = h; dw2 = h * fR; }
      ctx!.drawImage(fgImg, (size - dw2) / 2, (h - dh2) / 2, dw2, dh2);
    }

    bgImg.onload = () => { bgDone = true; draw(); };
    fgImg.onload = () => { fgDone = true; draw(); };
    bgImg.onerror = () => { bgDone = true; draw(); };
    fgImg.onerror = () => { fgDone = true; draw(); };

    bgImg.src = backdropUrl;
    fgImg.src = nobgUrl || fallbackUrl;
  }, [backdropUrl, nobgUrl, fallbackUrl]);

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "relative",
        padding: 0,
        border: selected ? "2px solid #fff" : "2px solid transparent",
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        background: "#1a1a1a",
        transition: "all 0.2s ease",
        transform: selected ? "scale(1.05)" : "scale(1)",
        boxShadow: selected ? "0 0 20px rgba(255,255,255,0.12)" : "none",
        outline: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: 80, height: 100, display: "block", borderRadius: 8 }}
      />
      {isPremium && (
        <div style={{
          position: "absolute",
          top: 4,
          right: 4,
          background: "linear-gradient(135deg, #f59e0b, #d97706)",
          color: "#000",
          fontSize: 8,
          fontWeight: 800,
          padding: "2px 5px",
          borderRadius: 4,
          letterSpacing: "0.05em",
        }}>
          ★
        </div>
      )}
    </button>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const darkInput: React.CSSProperties = {
  width: "100%",
  border: "1px solid #2e2e2e",
  borderRadius: 8,
  padding: "11px 14px",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
  color: "#fff",
  background: "#1c1c1c",
  fontFamily: "inherit",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 700,
  color: "#888",
  marginBottom: 5,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

// ══════════════════════════════════════════════════════════════════════════
export default function ParentGalleryPage() {
  const supabase = useMemo(() => createClient(), []);
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const pin = decodeURIComponent(String(params.pin ?? ""));
  const schoolId = searchParams.get("school") ?? "";
  const checkoutStatus = searchParams.get("checkout") ?? "";
  const sessionId = searchParams.get("session_id") ?? "";
  const mode = searchParams.get("mode") ?? "school";
  const isSchoolMode = mode !== "event" && !!schoolId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [student, setStudent] = useState<StudentRow | null>(null);
  const [schoolName, setSchoolName] = useState("");
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<PackageRow | null>(null);
  const [selectedOrderQty, setSelectedOrderQty] = useState(1);
  const [packageQuantities, setPackageQuantities] = useState<Record<string, number>>({});
  const [cardPreviewVariant, setCardPreviewVariant] = useState<Record<string, number>>({});

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
  const [deliveryMethod, setDeliveryMethod] = useState<"pickup" | "shipping">(
    "pickup"
  );
  const [shippingName, setShippingName] = useState("");
  const [shippingAddress1, setShippingAddress1] = useState("");
  const [shippingAddress2, setShippingAddress2] = useState("");
  const [shippingCity, setShippingCity] = useState("");
  const [shippingProvince, setShippingProvince] = useState("");
  const [shippingPostalCode, setShippingPostalCode] = useState("");
  const [placing, setPlacing] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [orderId, setOrderId] = useState("");
  const [placed, setPlaced] = useState(false);

  // Pre-release capture
  const [captureEmail, setCaptureEmail] = useState("");
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureDone, setCaptureDone] = useState(false);
  const [captureError, setCaptureError] = useState("");

  // ── Backdrop selector (school mode only) ────────────────────────────────
  const [backdropPickerOpen, setBackdropPickerOpen] = useState(false);
  const [backdrops, setBackdrops] = useState<BackdropRow[]>([]);
  const [selectedBackdrop, setSelectedBackdrop] = useState<BackdropRow | null>(null);
  const [confirmedBackdrop, setConfirmedBackdrop] = useState<BackdropRow | null>(null);
  const [backdropCategory, setBackdropCategory] = useState("all");
  const [nobgUrls, setNobgUrls] = useState<Record<string, string>>({});
  const [compositeDataUrl, setCompositeDataUrl] = useState<string | null>(null);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [premiumTarget, setPremiumTarget] = useState<BackdropRow | null>(null);
  const [photographerId, setPhotographerId] = useState<string | null>(null);
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const [watermarkLogoUrl, setWatermarkLogoUrl] = useState<string>("");

  // ── Gallery views + favorites + studio info ──────────────────────────────
  const [activeView, setActiveView] = useState<"photos" | "favorites" | "about">("photos");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [studioInfo, setStudioInfo] = useState<{
    businessName: string;
    logoUrl: string;
    address: string;
    phone: string;
    email: string;
  }>({ businessName: "", logoUrl: "", address: "", phone: "", email: "" });

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        if (!pin) {
          setError("Missing PIN.");
          setLoading(false);
          return;
        }

        setLoading(true);
        setError("");

        const { data: currentSchool } = schoolId
          ? await supabase
              .from("schools")
              .select("id,school_name,photographer_id,package_profile_id,local_school_id")
              .eq("id", schoolId)
              .maybeSingle<SchoolRow>()
          : { data: null as SchoolRow | null };

        const schoolNameForMatch = currentSchool?.school_name?.trim() ?? "";
        let schoolIdsToSearch: string[] = [];
        let schoolRowsForMatch: SchoolRow[] = currentSchool ? [currentSchool] : [];

        if (schoolNameForMatch) {
          const { data: sns } = await supabase
            .from("schools")
            .select("id,school_name,photographer_id,package_profile_id,local_school_id")
            .ilike("school_name", schoolNameForMatch)
            .order("created_at", { ascending: false });

          schoolRowsForMatch = sns ?? schoolRowsForMatch;
          schoolIdsToSearch = Array.from(
            new Set([...(schoolRowsForMatch ?? []).map((s) => s.id), ...(schoolId ? [schoolId] : [])])
          );
        } else if (schoolId) {
          schoolIdsToSearch = [schoolId];
        }

        let studentCandidates: StudentRow[] = [];
        const q = supabase
          .from("students")
          .select(
            "id,first_name,last_name,photo_url,class_id,school_id,class_name,folder_name,pin"
          )
          .eq("pin", pin);

        const { data } =
          schoolIdsToSearch.length > 0
            ? await q.in("school_id", schoolIdsToSearch)
            : await q;

        studentCandidates = data ?? [];
        if (!studentCandidates.length) {
          throw new Error("Student not found for this PIN.");
        }

        const primaryStudent =
          studentCandidates.find((s) => s.school_id === schoolId && !!s.photo_url) ??
          studentCandidates.find((s) => !!s.photo_url) ??
          studentCandidates.find((s) => s.school_id === schoolId) ??
          studentCandidates[0];

        const { data: activeSchool } = await supabase
          .from("schools")
          .select("id,school_name,photographer_id,package_profile_id,local_school_id")
          .eq("id", primaryStudent.school_id)
          .maybeSingle<SchoolRow>();

        const { data: activeProject } = await supabase
          .from("projects")
          .select("*")
          .eq("school_id", primaryStudent.school_id)
          .limit(1)
          .maybeSingle<ProjectRow>();

        // Load photos from storage
        const combinedImages: GalleryImage[] = [];
        const seenUrls = new Set<string>();

        const candidateFolders = uniqueFolders([
          ...studentCandidates.map((s) => folderFromPhotoUrl(s.photo_url ?? "")),
          ...studentCandidates.flatMap((s) =>
            (schoolRowsForMatch.length ? schoolRowsForMatch : activeSchool ? [activeSchool] : [])
              .map((school) =>
                school.local_school_id && s.class_name && s.folder_name
                  ? `${school.local_school_id}/${s.class_name}/${s.folder_name}`
                  : null
              )
          ),
          activeSchool?.local_school_id && primaryStudent.class_name && primaryStudent.folder_name
            ? `${activeSchool.local_school_id}/${primaryStudent.class_name}/${primaryStudent.folder_name}`
            : null,
        ]);

        for (const folder of candidateFolders) {
          const { data: storageFiles } = await supabase.storage
            .from(BUCKET)
            .list(folder, {
              limit: 200,
              sortBy: { column: "name", order: "asc" },
            });

          if (!storageFiles?.length) continue;

          for (const file of storageFiles) {
            if (!file.name || file.name.startsWith(".") || !isImageFileName(file.name)) continue;
            const url = publicUrl(`${folder}/${file.name}`);
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);
            combinedImages.push({ id: file.id ?? `${folder}/${file.name}`, url });
          }
        }

        if (!combinedImages.length) {
          for (const s of studentCandidates) {
            if (s.photo_url && !seenUrls.has(s.photo_url)) {
              seenUrls.add(s.photo_url);
              combinedImages.push({ id: `student-${s.id}`, url: s.photo_url });
            }
          }
        }

        // Load packages
        let packageRows: PackageRow[] = [];
        if (activeSchool?.photographer_id) {
          const normalizedProfile = (activeSchool.package_profile_id ?? "")
            .trim()
            .toLowerCase();

          if (normalizedProfile && normalizedProfile !== "default") {
            const { data: p } = await supabase
              .from("packages")
              .select(
                "id,name,description,price_cents,items,profile_id,category"
              )
              .eq("photographer_id", activeSchool.photographer_id)
              .eq("active", true)
              .eq("profile_id", activeSchool.package_profile_id)
              .order("price_cents", { ascending: true });

            if (p?.length) packageRows = p;
          }

          if (packageRows.length === 0) {
            const { data: p } = await supabase
              .from("packages")
              .select(
                "id,name,description,price_cents,items,profile_id,category"
              )
              .eq("photographer_id", activeSchool.photographer_id)
              .eq("active", true)
              .order("price_cents", { ascending: true });

            packageRows = p ?? [];
          }
        }

        packageRows = deduplicatePackages(packageRows);

        // ── Load backdrop catalog + nobg URLs (school mode only) ──────
        let backdropRows: BackdropRow[] = [];
        const nobgUrlMap: Record<string, string> = {};
        let resolvedPhotographerId: string | null = null;

        if (activeSchool?.photographer_id) {
          resolvedPhotographerId = activeSchool.photographer_id;

          // Load backdrops for this photographer
          const { data: bdRows } = await supabase
            .from("backdrop_catalog")
            .select("id,name,image_url,thumbnail_url,tier,price_cents,category,tags,sort_order")
            .eq("photographer_id", activeSchool.photographer_id)
            .eq("active", true)
            .order("sort_order", { ascending: true });

          backdropRows = (bdRows ?? []) as BackdropRow[];

          // Try to find nobg (cutout) versions for each photo
          // They live in nobg-photos bucket with same folder structure
          for (const folder of candidateFolders) {
            try {
              console.log(`[Gallery] Checking nobg-photos bucket folder: ${folder}`);
              const { data: nobgFiles, error: nobgErr } = await supabase.storage
                .from(NOBG_BUCKET)
                .list(folder, { limit: 200, sortBy: { column: "name", order: "asc" } });

              if (nobgErr) {
                console.warn(`[Gallery] nobg bucket list error for ${folder}:`, nobgErr.message);
                continue;
              }

              console.log(`[Gallery] nobg-photos/${folder}: ${nobgFiles?.length ?? 0} files found`, nobgFiles?.map((ff: any) => ff.name));

              if (nobgFiles?.length) {
                for (const f of nobgFiles) {
                  if (!f.name || !isImageFileName(f.name)) continue;
                  // Match nobg to original by base name
                  // cutout files are named like "photo_cutout.png"
                  const baseName = f.name.replace(/_cutout/i, "").replace(/\.png$/i, "");
                  // Find matching original
                  let matched = false;
                  for (const origImg of combinedImages) {
                    const origName = origImg.url.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
                    if (origName.toLowerCase() === baseName.toLowerCase() ||
                        origImg.url.split("/").pop()?.replace(/\.[^.]+$/, "").toLowerCase() === f.name.replace(/\.[^.]+$/, "").toLowerCase()) {
                      nobgUrlMap[origImg.id] = nobgPublicUrl(`${folder}/${f.name}`);
                      console.log(`[Gallery] Matched nobg: ${f.name} -> origImg.id=${origImg.id} (origName=${origName})`);
                      matched = true;
                      break;
                    }
                  }
                  if (!matched) {
                    console.warn(`[Gallery] No match for nobg file: ${f.name} (baseName=${baseName}), origNames:`, combinedImages.map(i => i.url.split("/").pop()));
                  }
                }
              }
            } catch (nobgCatchErr) {
              console.warn(`[Gallery] nobg bucket error for folder ${folder}:`, nobgCatchErr);
            }
          }

          console.log(`[Gallery] Final nobgUrlMap: ${Object.keys(nobgUrlMap).length} entries`, nobgUrlMap);
        }


        if (!mounted) return;

        setStudent(primaryStudent);
        setSchoolName(activeSchool?.school_name ?? currentSchool?.school_name ?? "");
        setProject(activeProject ?? null);
        setImages(combinedImages);
        setSelectedImageIndex(0);
        setPackages(packageRows);
        setBackdrops(backdropRows);
        setNobgUrls(nobgUrlMap);
        setPhotographerId(resolvedPhotographerId);

        // Fetch photographer watermark settings + studio info
        if (resolvedPhotographerId) {
          const { data: pgRow } = await supabase
            .from("photographers")
            .select("watermark_enabled, watermark_logo_url, business_name, studio_address, studio_phone, studio_email")
            .eq("id", resolvedPhotographerId)
            .maybeSingle();
          if (pgRow) {
            setWatermarkEnabled(pgRow.watermark_enabled !== false);
            setWatermarkLogoUrl(pgRow.watermark_logo_url || "");
            setStudioInfo({
              businessName: pgRow.business_name || "",
              logoUrl: pgRow.watermark_logo_url || "",
              address: pgRow.studio_address || "",
              phone: pgRow.studio_phone || "",
              email: pgRow.studio_email || "",
            });
          }
        }

        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load gallery.");
        setLoading(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [pin, schoolId, supabase]);

  useEffect(() => {
    let active = true;

    async function confirmCheckout() {
      if (checkoutStatus !== "success" || !sessionId || placed) return;
      try {
        setConfirmingPayment(true);
        setOrderError("");
        const res = await fetch("/api/stripe/checkout/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const json = (await res.json()) as {
          ok: boolean;
          message?: string;
          orderId?: string;
          customerEmail?: string | null;
        };
        if (!res.ok || !json.ok) {
          throw new Error(json.message || "Payment confirmation failed.");
        }
        if (!active) return;
        setOrderId(json.orderId || "");
        if (json.customerEmail) setParentEmail(json.customerEmail);
        setPlaced(true);
        setDrawerOpen(false);
      } catch (err) {
        if (!active) return;
        setOrderError(err instanceof Error ? err.message : "Payment confirmation failed.");
      } finally {
        if (active) setConfirmingPayment(false);
      }
    }

    void confirmCheckout();

    if (checkoutStatus === "cancel") {
      setOrderError("Checkout was cancelled. Your order draft is still saved — you can try again anytime.");
      setDrawerOpen(true);
      setDrawerView("checkout");
    }

    return () => {
      active = false;
    };
  }, [checkoutStatus, sessionId, placed]);

  const selectedImage = images[selectedImageIndex] ?? null;
  const orderingDisabled =
    !!project?.order_due_date &&
    new Date() > new Date(project.order_due_date);

  function goBack() {
    router.push("/parents");
  }

  function toggleFavorite(imageId: string) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  }

  function goPrev() {
    if (!images.length) return;
    setSelectedImageIndex((p) => (p === 0 ? images.length - 1 : p - 1));
  }

  function goNext() {
    if (!images.length) return;
    setSelectedImageIndex((p) => (p === images.length - 1 ? 0 : p + 1));
  }

  function openBuyDrawer() {
    if (orderingDisabled) return;
    setBackdropPickerOpen(false);
    setDrawerView("product-select");
    setDrawerOpen(true);
    setActiveSlotIndex(null);
  }

  function openCategory(catKey: string) {
    setActiveCategoryKey(catKey);
    setDrawerView("category-list");
  }

  function getChosenQty(pkgId: string) {
    return Math.max(1, packageQuantities[pkgId] ?? 1);
  }

  function setChosenQty(pkgId: string, nextQty: number) {
    setPackageQuantities((prev) => ({ ...prev, [pkgId]: Math.max(1, nextQty) }));
  }

  function selectPackage(pkg: PackageRow) {
    if (orderingDisabled) return;

    const chosenQty = getChosenQty(pkg.id);
    setSelectedOrderQty(chosenQty);
    setSelectedPkg(pkg);
    const newSlots = buildSlots(pkg, chosenQty);
    setSlots(
      newSlots.map((s) => ({
        ...s,
        assignedImageUrl: selectedImage?.url ?? null,
      }))
    );
    setActiveSlotIndex(null);

    if (getCategory(pkg) === "digital") {
      setDrawerView("checkout");
    } else {
      setDrawerView("build-package");
    }
  }

  function assignImageToSlot(imageUrl: string) {
    if (activeSlotIndex === null) return;
    setSlots((prev) =>
      prev.map((s, i) =>
        i === activeSlotIndex ? { ...s, assignedImageUrl: imageUrl } : s
      )
    );
    const nextEmpty = slots.findIndex(
      (s, i) => i > activeSlotIndex && !s.assignedImageUrl
    );
    setActiveSlotIndex(nextEmpty >= 0 ? nextEmpty : null);
  }

  const allSlotsAssigned = slots.every((s) => s.assignedImageUrl !== null);
  const packagesInCategory = packages.filter(
    (p) => getCategory(p) === activeCategoryKey
  );

  const tilesWithData = TILES.map((tile) => ({
    ...tile,
    count: packages.filter((p) => getCategory(p) === tile.key).length,
    minPrice: (() => {
      const pkgs = packages.filter((p) => getCategory(p) === tile.key);
      return pkgs.length ? Math.min(...pkgs.map((p) => p.price_cents)) / 100 : null;
    })(),
  })).filter((t) => t.count > 0);

  // ── Backdrop helpers (school mode only) ─────────────────────────────────
  const hasBackdrops = isSchoolMode && backdrops.length > 0;
  const currentNobgUrl = selectedImage ? (nobgUrls[selectedImage.id] ?? null) : null;

  // Generate a composite data URL for use in buy section mockups
  useEffect(() => {
    if (!confirmedBackdrop || !currentNobgUrl || !selectedImage) {
      setCompositeDataUrl(null);
      return;
    }

    let cancelled = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 600, H = 800;
    canvas.width = W;
    canvas.height = H;

    const bgImg = new Image();
    bgImg.crossOrigin = "anonymous";
    const fgImg = new Image();
    fgImg.crossOrigin = "anonymous";

    let bgDone = false, fgDone = false;

    function draw() {
      if (cancelled || !bgDone || !fgDone) return;
      ctx!.clearRect(0, 0, W, H);
      // BG cover
      const bgR = bgImg.naturalWidth / bgImg.naturalHeight;
      const cR = W / H;
      let sx = 0, sy = 0, sw = bgImg.naturalWidth, sh = bgImg.naturalHeight;
      if (bgR > cR) { sw = bgImg.naturalHeight * cR; sx = (bgImg.naturalWidth - sw) / 2; }
      else { sh = bgImg.naturalWidth / cR; sy = (bgImg.naturalHeight - sh) / 2; }
      ctx!.filter = "blur(4px)";
      ctx!.drawImage(bgImg, sx, sy, sw, sh, 0, 0, W, H);
      ctx!.filter = "none";
      // FG contain
      const fR = fgImg.naturalWidth / fgImg.naturalHeight;
      let dw: number, dh: number;
      if (fR > cR) { dw = W; dh = W / fR; } else { dh = H; dw = H * fR; }
      ctx!.drawImage(fgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
      if (!cancelled) {
        setCompositeDataUrl(canvas.toDataURL("image/png"));
      }
    }

    bgImg.onload = () => { bgDone = true; draw(); };
    fgImg.onload = () => { fgDone = true; draw(); };
    bgImg.onerror = () => { bgDone = true; draw(); };
    fgImg.onerror = () => { fgDone = true; draw(); };

    bgImg.src = confirmedBackdrop.image_url;
    fgImg.src = currentNobgUrl;

    return () => { cancelled = true; };
  }, [confirmedBackdrop, currentNobgUrl, selectedImage]);

  // Use composite in buy section when backdrop is confirmed
  const effectiveImageUrl = compositeDataUrl ?? selectedImage?.url ?? null;

  // Premium backdrop pricing — added to checkout total
  const premiumBackdropCents =
    confirmedBackdrop?.tier === "premium" ? (confirmedBackdrop.price_cents ?? 0) : 0;
  const filteredBackdrops = backdropCategory === "all"
    ? backdrops
    : backdrops.filter((b) => b.category === backdropCategory);
  const backdropCategoriesWithData = BACKDROP_CATEGORIES.filter(
    (cat) => cat.key === "all" || backdrops.some((b) => b.category === cat.key)
  );

  function handleBackdropClick(backdrop: BackdropRow) {
    if (backdrop.tier === "premium") {
      setPremiumTarget(backdrop);
      setShowPremiumModal(true);
    } else {
      setSelectedBackdrop(backdrop);
    }
  }

  function handleConfirmBackdrop() {
    setConfirmedBackdrop(selectedBackdrop);
    setBackdropPickerOpen(false);
  }

  function handleClearBackdrop() {
    setConfirmedBackdrop(null);
    setSelectedBackdrop(null);
    setCompositeDataUrl(null);
  }

  /** Given an image URL (from slot assignment), find its nobg URL if available */
  function nobgForUrl(url: string | null): string | null {
    if (!url) return null;
    const match = images.find((i) => i.url === url);
    return match ? (nobgUrls[match.id] ?? null) : null;
  }

  function handleUnlockPremium() {
    if (premiumTarget) {
      setSelectedBackdrop(premiumTarget);
      setConfirmedBackdrop(premiumTarget);
      setShowPremiumModal(false);
      setPremiumTarget(null);
    }
  }

  function openBackdropPicker() {
    if (drawerOpen) setDrawerOpen(false);
    setBackdropPickerOpen(true);
    if (!selectedBackdrop && backdrops.length > 0) {
      setSelectedBackdrop(backdrops[0]);
    }
  }

  async function handlePlaceOrder(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (orderingDisabled) {
      setOrderError("Ordering is no longer available for this gallery.");
      return;
    }

    if (!student || !selectedPkg) return;
    if (!parentEmail.trim()) {
      setOrderError("Email is required.");
      return;
    }

    if (
      deliveryMethod === "shipping" &&
      (!shippingName.trim() ||
        !shippingAddress1.trim() ||
        !shippingCity.trim() ||
        !shippingProvince.trim() ||
        !shippingPostalCode.trim())
    ) {
      setOrderError("Please complete the shipping information.");
      return;
    }

    setPlacing(true);
    setOrderError("");

    const { data: schoolRow } = await supabase
      .from("schools")
      .select("photographer_id")
      .eq("id", student.school_id)
      .maybeSingle();

    const packagePrice = selectedPkg.price_cents / 100;
    const backdropAddOnCents = premiumBackdropCents;
    const totalCents = (selectedPkg.price_cents * selectedOrderQty) + backdropAddOnCents;
    const isDigital = getCategory(selectedPkg) === "digital";

    const backdropNote = confirmedBackdrop
      ? `BACKDROP: ${confirmedBackdrop.name}${confirmedBackdrop.tier === "premium" ? ` (Premium · $${(backdropAddOnCents / 100).toFixed(2)})` : " (Included)"}`
      : "";

    const slotsSummary = isDigital
      ? `Digital download order`
      : slots
          .map(
            (s, i) => `Item ${i + 1}: ${s.label} → ${s.assignedImageUrl ?? "no photo"}`
          )
          .join("\n");

    const shippingBlock =
      deliveryMethod === "shipping"
        ? [
            `Delivery: shipping`,
            `Name: ${shippingName.trim()}`,
            `Address: ${shippingAddress1.trim()}`,
            shippingAddress2.trim() ? `Line 2: ${shippingAddress2.trim()}` : "",
            `City: ${shippingCity.trim()}`,
            `Province: ${shippingProvince.trim()}`,
            `Postal: ${shippingPostalCode.trim()}`,
          ]
            .filter(Boolean)
            .join("\n")
        : "Delivery: pickup";

    const combinedNotes = [
      notes.trim(),
      backdropNote,
      isDigital ? "DIGITAL ORDER" : "PHOTO SELECTIONS:\n" + slotsSummary,
      shippingBlock,
    ]
      .filter(Boolean)
      .join("\n\n");

    const { data: orderRow, error: orderErr } = await supabase
      .from("orders")
      .insert({
        school_id: student.school_id,
        class_id: student.class_id ?? null,
        student_id: student.id,
        photographer_id: schoolRow?.photographer_id ?? null,
        parent_name: parentName.trim() || null,
        parent_email: parentEmail.trim() || null,
        parent_phone: parentPhone.trim() || null,
        customer_name: parentName.trim() || null,
        customer_email: parentEmail.trim() || null,
        package_id: selectedPkg.id,
        package_name: selectedPkg.name,
        package_price: packagePrice,
        special_notes: combinedNotes || null,
        notes: combinedNotes || null,
        status: isDigital ? "payment_pending" : "payment_pending",
        seen_by_photographer: false,
        subtotal_cents: selectedPkg.price_cents * selectedOrderQty,
        tax_cents: 0,
        total_cents: totalCents,
        total_amount: totalCents / 100,
        currency: "cad",
      })
      .select("id")
      .single();

    if (orderErr || !orderRow) {
      setOrderError(orderErr?.message ?? "Failed to create order draft.");
      setPlacing(false);
      return;
    }

    const itemsToInsert = isDigital
      ? [
          {
            order_id: orderRow.id,
            product_name: selectedPkg.name,
            quantity: selectedOrderQty,
            price: packagePrice,
            unit_price_cents: selectedPkg.price_cents,
            line_total_cents: selectedPkg.price_cents * selectedOrderQty,
            sku: selectedImage?.url ?? null,
          },
        ]
      : slots.map((slot) => ({
          order_id: orderRow.id,
          product_name: slot.label,
          quantity: 1,
          price: (packagePrice * selectedOrderQty) / Math.max(slots.length, 1),
          unit_price_cents: Math.round((selectedPkg.price_cents * selectedOrderQty) / Math.max(slots.length, 1)),
          line_total_cents: Math.round((selectedPkg.price_cents * selectedOrderQty) / Math.max(slots.length, 1)),
          sku: slot.assignedImageUrl ?? null,
        }));

    // Add premium backdrop as a separate line item
    if (backdropAddOnCents > 0 && confirmedBackdrop) {
      itemsToInsert.push({
        order_id: orderRow.id,
        product_name: `★ Premium Backdrop: ${confirmedBackdrop.name}`,
        quantity: 1,
        price: backdropAddOnCents / 100,
        unit_price_cents: backdropAddOnCents,
        line_total_cents: backdropAddOnCents,
        sku: confirmedBackdrop.image_url ?? null,
      });
    }

    const { error: orderItemsError } = await supabase.from("order_items").insert(itemsToInsert);

    if (orderItemsError) {
      setOrderError(orderItemsError.message || "Failed to prepare order items.");
      setPlacing(false);
      return;
    }

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: orderRow.id,
          pin,
          schoolId: student.school_id,
          customerEmail: parentEmail.trim(),
        }),
      });

      const json = (await res.json()) as { ok: boolean; message?: string; url?: string };
      if (!res.ok || !json.ok || !json.url) {
        throw new Error(json.message || "Failed to start secure checkout.");
      }

      window.location.href = json.url;
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : "Failed to start secure checkout.");
      setPlacing(false);
      return;
    }
  }

  async function handlePreReleaseSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const email = captureEmail.trim().toLowerCase();
    if (!project?.id) {
      setCaptureError("This gallery is not linked to a project yet.");
      return;
    }
    if (!email) {
      setCaptureError("Please enter your email.");
      return;
    }

    setCaptureBusy(true);
    setCaptureError("");

    // Route through server API so we pick up the IP rate limit + service
    // client on the write. Keeps the public anon key off this table path
    // once the permissive INSERT policy is tightened.
    try {
      const response = await fetch("/api/portal/pre-release-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, email }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        setCaptureBusy(false);
        setCaptureError(
          typeof payload.message === "string"
            ? payload.message
            : "We couldn't save your email. Please try again.",
        );
        return;
      }
    } catch {
      setCaptureBusy(false);
      setCaptureError("Network error. Please try again.");
      return;
    }

    setCaptureBusy(false);

    setCaptureDone(true);
    setCaptureEmail("");
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        style={{
          height: "100vh",
          background: "#080808",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div
          style={{
            width: 30,
            height: 30,
            border: "2px solid #222",
            borderTopColor: "#fff",
            borderRadius: "50%",
            animation: "spin 0.75s linear infinite",
          }}
        />
        <span
          style={{
            color: "#555",
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Loading gallery
        </span>
      </div>
    );
  }

  if (error || !student) {
    return (
      <div
        style={{
          height: "100vh",
          background: "#080808",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 400,
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 16,
            padding: "44px 36px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 44, marginBottom: 16 }}>🔍</div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: "#fff",
              margin: "0 0 10px",
            }}
          >
            Gallery Not Found
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#666",
              lineHeight: 1.7,
              margin: "0 0 24px",
            }}
          >
            {error || "Unable to load this gallery."}
          </p>
          <button
            type="button"
            onClick={goBack}
            style={{
              background: "#fff",
              color: "#000",
              border: "none",
              borderRadius: 999,
              padding: "12px 24px",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (confirmingPayment) {
    return (
      <div
        style={{
          height: "100vh",
          background: "#080808",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 440,
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 20,
            padding: "52px 40px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 16, color: "#888", marginBottom: 10 }}>Verifying payment…</div>
          <div style={{ fontSize: 13, color: "#555", lineHeight: 1.7 }}>We are confirming your Stripe checkout and syncing it to the photographer dashboard.</div>
        </div>
      </div>
    );
  }

  if (placed) {
    return (
      <div
        style={{
          height: "100vh",
          background: "#080808",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 440,
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 20,
            padding: "52px 40px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: "50%",
              background: "#0f2e0f",
              border: "1.5px solid #1f5c1f",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 24px",
            }}
          >
            <Check size={30} color="#4ade80" strokeWidth={2.5} />
          </div>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: "#fff",
              margin: "0 0 10px",
            }}
          >
            Order Placed!
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#888",
              lineHeight: 1.7,
              margin: "0 0 8px",
            }}
          >
            Your payment was completed and the order is now in the photographer queue.
          </p>
          {parentEmail && (
            <p style={{ fontSize: 13, color: "#555", margin: "0 0 24px" }}>
              Receipt sent to{" "}
              <strong style={{ color: "#bbb" }}>{parentEmail}</strong>
            </p>
          )}
          <div
            style={{
              background: "#161616",
              border: "1px solid #222",
              borderRadius: 10,
              padding: "12px 16px",
              marginBottom: 28,
            }}
          >
            <p
              style={{
                fontSize: 10,
                color: "#444",
                margin: "0 0 5px",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                fontWeight: 700,
              }}
            >
              Order Reference
            </p>
            <p
              style={{
                fontSize: 11,
                fontFamily: "monospace",
                color: "#555",
                margin: 0,
                wordBreak: "break-all",
              }}
            >
              {orderId}
            </p>
          </div>
          <button
            type="button"
            onClick={goBack}
            style={{
              background: "#fff",
              color: "#000",
              border: "none",
              borderRadius: 999,
              padding: "13px 32px",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // ── Project state gates ──────────────────────────────────────────────────
  if (project?.portal_status === "inactive") {
    return (
      <div
        style={{
          height: "100vh",
          background: "#080808",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 460,
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 20,
            padding: "48px 36px",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#fff",
              margin: "0 0 10px",
            }}
          >
            Gallery Not Available
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#777",
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            This gallery is currently not available.
          </p>
        </div>
      </div>
    );
  }

  if (project?.portal_status === "pre_release") {
    return (
      <>
        <style>{`html,body{margin:0;padding:0;height:100%;overflow:hidden;}`}</style>
        <div
          style={{
            minHeight: "100vh",
            background:
              "radial-gradient(circle at top, #152238 0%, #0b0b0b 45%, #080808 100%)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              background: "rgba(17,17,17,0.88)",
              border: "1px solid #242424",
              borderRadius: 24,
              padding: "44px 38px",
              boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 999,
                padding: "8px 14px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.09)",
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#c8d3e8",
                marginBottom: 20,
              }}
            >
              <Clock3 size={14} />
              Coming Soon
            </div>

            <h1
              style={{
                fontSize: 34,
                lineHeight: 1.1,
                fontWeight: 800,
                margin: "0 0 12px",
              }}
            >
              {getProjectName(project)}
            </h1>

            <p
              style={{
                fontSize: 15,
                color: "#8f95a3",
                lineHeight: 1.8,
                margin: "0 0 24px",
              }}
            >
              This gallery is not open yet. Enter your email and we’ll notify you
              when it becomes available.
            </p>

            {captureDone ? (
              <div
                style={{
                  background: "#0f2e0f",
                  border: "1px solid #1f5c1f",
                  color: "#c8ffd7",
                  borderRadius: 14,
                  padding: "16px 18px",
                  fontSize: 14,
                  lineHeight: 1.6,
                }}
              >
                Thanks — your email has been registered.
              </div>
            ) : (
              <form onSubmit={handlePreReleaseSubmit}>
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Email Address</label>
                  <div style={{ position: "relative" }}>
                    <Mail
                      size={14}
                      color="#666"
                      style={{ position: "absolute", left: 12, top: 12 }}
                    />
                    <input
                      type="email"
                      value={captureEmail}
                      onChange={(e) => setCaptureEmail(e.target.value)}
                      placeholder="parent@email.com"
                      required
                      style={{ ...darkInput, paddingLeft: 36 }}
                    />
                  </div>
                </div>

                {captureError && (
                  <div
                    style={{
                      background: "#1e0a0a",
                      border: "1px solid #4a1a1a",
                      borderRadius: 8,
                      padding: "10px 13px",
                      color: "#f87171",
                      fontSize: 12,
                      marginBottom: 14,
                    }}
                  >
                    {captureError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={captureBusy}
                  style={{
                    width: "100%",
                    background: "#fff",
                    color: "#000",
                    border: "none",
                    borderRadius: 999,
                    padding: "14px 18px",
                    fontSize: 14,
                    fontWeight: 800,
                    cursor: captureBusy ? "not-allowed" : "pointer",
                    opacity: captureBusy ? 0.7 : 1,
                  }}
                >
                  {captureBusy ? "Saving..." : "Notify Me"}
                </button>
              </form>
            )}

            <button
              type="button"
              onClick={goBack}
              style={{
                marginTop: 18,
                background: "transparent",
                border: "none",
                color: "#999",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                padding: 0,
              }}
            >
              ← Back
            </button>
          </div>
        </div>
      </>
    );
  }

  if (project?.portal_status === "closed") {
    return (
      <div
        style={{
          height: "100vh",
          background: "#080808",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 460,
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 20,
            padding: "48px 36px",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#fff",
              margin: "0 0 10px",
            }}
          >
            Gallery Closed
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#777",
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            This gallery is currently closed.
          </p>
        </div>
      </div>
    );
  }

  if (
    project?.expiration_date &&
    new Date() > new Date(project.expiration_date)
  ) {
    return (
      <div
        style={{
          height: "100vh",
          background: "#080808",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 460,
            background: "#111",
            border: "1px solid #1e1e1e",
            borderRadius: 20,
            padding: "48px 36px",
            textAlign: "center",
          }}
        >
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#fff",
              margin: "0 0 10px",
            }}
          >
            Gallery Expired
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#777",
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            This gallery is no longer available.
          </p>
        </div>
      </div>
    );
  }

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

      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#080808",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
          overflow: "hidden",
        }}
      >
        {/* Top bar */}
        <div
          style={{
            height: 52,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 20px",
            borderBottom: "1px solid #141414",
            position: "relative",
            zIndex: 20,
          }}
        >
          {/* Left: logo + brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <button type="button" onClick={goBack} style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: 0 }}>
              <ArrowLeft size={16} color="#666" />
            </button>
            {studioInfo.logoUrl ? (
              <img src={studioInfo.logoUrl} alt="" style={{ height: 28, objectFit: "contain", maxWidth: 120 }} />
            ) : studioInfo.businessName ? (
              <span style={{ fontSize: 14, fontWeight: 800, color: "#fff", letterSpacing: "0.04em", textTransform: "uppercase" }}>{studioInfo.businessName}</span>
            ) : null}
          </div>

          {/* Center: nav tabs */}
          <div style={{ display: "flex", gap: 4, position: "absolute", left: "50%", transform: "translateX(-50%)" }}>
            {(["photos", "favorites", "about"] as const).map((tab) => {
              const isActive = activeView === tab;
              const label = tab === "photos" ? "Photos" : tab === "favorites" ? `Favorites${favorites.size > 0 ? ` (${favorites.size})` : ""}` : "About";
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveView(tab)}
                  style={{
                    background: "transparent",
                    border: "none",
                    borderBottom: isActive ? "2px solid #fff" : "2px solid transparent",
                    color: isActive ? "#fff" : "#666",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "14px 16px",
                    cursor: "pointer",
                    transition: "color 0.15s",
                    letterSpacing: "0.01em",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Right: cart */}
          <button
            type="button"
            onClick={openBuyDrawer}
            disabled={orderingDisabled}
            style={{
              background: orderingDisabled ? "#2b2b2b" : "#fff",
              color: orderingDisabled ? "#777" : "#000",
              border: "none",
              borderRadius: 999,
              padding: "8px 18px",
              fontSize: 12,
              fontWeight: 700,
              cursor: orderingDisabled ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ShoppingCart size={14} />
            {orderingDisabled ? "Closed" : "Buy Photo"}
          </button>
        </div>

        {orderingDisabled && (
          <div
            style={{
              flexShrink: 0,
              background: "#1b1510",
              borderBottom: "1px solid #2f2416",
              color: "#d2b48c",
              padding: "10px 18px",
              fontSize: 12,
              textAlign: "center",
              letterSpacing: "0.02em",
            }}
          >
            Ordering for this gallery has ended. You can still view the photos.
          </div>
        )}

        {/* Body */}

        {/* ── About view ────────────────────────────────────────────── */}
        {activeView === "about" && (
          <div style={{ flex: 1, overflow: "auto", display: "flex", justifyContent: "center", padding: "60px 20px" }}>
            <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
              {studioInfo.logoUrl ? (
                <img src={studioInfo.logoUrl} alt="" style={{ height: 60, objectFit: "contain", marginBottom: 28, display: "block", margin: "0 auto 28px" }} />
              ) : studioInfo.businessName ? (
                <div style={{ fontSize: 28, fontWeight: 900, color: "#fff", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 28 }}>{studioInfo.businessName}</div>
              ) : null}

              {studioInfo.address && (
                <div style={{ color: "#ccc", fontSize: 15, lineHeight: 1.8, marginBottom: 24, whiteSpace: "pre-line" }}>{studioInfo.address}</div>
              )}

              {studioInfo.phone && (
                <a href={`tel:${studioInfo.phone}`} style={{ display: "block", color: "#fff", fontSize: 15, fontWeight: 600, marginBottom: 12, textDecoration: "underline", textUnderlineOffset: 4 }}>{studioInfo.phone}</a>
              )}

              {studioInfo.email && (
                <a href={`mailto:${studioInfo.email}`} style={{ display: "block", color: "#fff", fontSize: 15, fontWeight: 600, marginBottom: 24, textDecoration: "underline", textUnderlineOffset: 4 }}>{studioInfo.email}</a>
              )}

              {!studioInfo.address && !studioInfo.phone && !studioInfo.email && (
                <div style={{ color: "#555", fontSize: 14 }}>No studio contact info available yet.</div>
              )}
            </div>
          </div>
        )}

        {/* ── Favorites view ────────────────────────────────────────── */}
        {activeView === "favorites" && (
          <div style={{ flex: 1, overflow: "auto", padding: "30px 20px" }}>
            {favorites.size === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 20px", color: "#555" }}>
                <Heart size={36} strokeWidth={1.2} color="#333" />
                <div style={{ fontSize: 16, fontWeight: 700, color: "#888", marginTop: 14 }}>No favorites yet</div>
                <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>Tap the heart icon on any photo to add it here.</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, maxWidth: 1200, margin: "0 auto" }}>
                {images.filter((img) => favorites.has(img.id)).map((img, idx) => (
                  <div
                    key={img.id}
                    onClick={() => { setSelectedImageIndex(images.indexOf(img)); setActiveView("photos"); }}
                    style={{ position: "relative", aspectRatio: "3/4", borderRadius: 6, overflow: "hidden", cursor: "pointer", background: "#111" }}
                  >
                    <img src={img.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    {watermarkEnabled && <WatermarkOverlay text={schoolName || "PROOF"} logoUrl={watermarkLogoUrl} />}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(img.id); }}
                      style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.5)", border: "none", borderRadius: 999, padding: 6, cursor: "pointer" }}
                    >
                      <Heart size={16} fill="#ef4444" color="#ef4444" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ flex: 1, display: activeView === "photos" ? "flex" : "none", overflow: "hidden", minHeight: 0 }}>
          {/* Photo viewer */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            <div
              onContextMenu={(e) => e.preventDefault()}
              style={{
                flex: 1,
                minHeight: 0,
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "18px 52px 10px",
                WebkitUserSelect: "none",
                userSelect: "none",
              }}
            >
              {images.length > 1 && (
                <button
                  type="button"
                  onClick={goPrev}
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 38,
                    height: 38,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.07)",
                    border: "none",
                    color: "#fff",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 2,
                  }}
                >
                  <ChevronLeft size={20} strokeWidth={1.5} />
                </button>
              )}

              {selectedImage ? (() => {
                const activeBackdrop = confirmedBackdrop || (backdropPickerOpen ? selectedBackdrop : null);
                const isPreview = !confirmedBackdrop && backdropPickerOpen && !!selectedBackdrop;
                return activeBackdrop && currentNobgUrl ? (
                  <div style={{ position: "relative", width: 560, maxWidth: "100%", aspectRatio: "3 / 4" }}>
                    <CompositeCanvas
                      key={`${selectedImage.id}-${activeBackdrop.id}`}
                      backdropUrl={activeBackdrop.image_url}
                      nobgUrl={currentNobgUrl}
                      fallbackUrl={selectedImage.url}
                      width={560}
                      height={747}
                      style={{ borderRadius: 6 }}
                    />
                    {confirmedBackdrop && (
                      <button
                        type="button"
                        onClick={handleClearBackdrop}
                        style={{
                          position: "absolute",
                          top: 10,
                          right: 10,
                          background: "rgba(0,0,0,0.65)",
                          backdropFilter: "blur(8px)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: 999,
                          padding: "5px 12px",
                          color: "#ccc",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          zIndex: 3,
                        }}
                      >
                        <X size={12} /> Remove Backdrop
                      </button>
                    )}
                    <div style={{
                      position: "absolute",
                      bottom: 10,
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: isPreview ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.65)",
                      backdropFilter: "blur(8px)",
                      border: isPreview
                        ? "1px solid rgba(255,255,255,0.15)"
                        : "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 999,
                      padding: "5px 14px",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}>
                      {isPreview ? (
                        <>
                          <Eye size={12} color="#60a5fa" /> {activeBackdrop.name}
                          <span style={{ color: "#60a5fa", fontSize: 10, fontWeight: 500 }}>Preview</span>
                        </>
                      ) : (
                        <>
                          <Check size={12} color="#4ade80" /> {activeBackdrop.name}
                        </>
                      )}
                      {activeBackdrop.tier === "premium" && (
                        <span style={{ color: "#f59e0b", fontSize: 10 }}>★ Premium</span>
                      )}
                    </div>
                    {watermarkEnabled && <WatermarkOverlay text={schoolName || "PROOF"} logoUrl={watermarkLogoUrl} />}
                  </div>
                ) : (
                  <div style={{ position: "relative", width: 560, maxWidth: "100%", aspectRatio: "3 / 4", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <img
                      key={selectedImage.id}
                      src={selectedImage.url}
                      alt={student.first_name}
                      draggable={false}
                      style={{
                        maxWidth: "100%",
                        maxHeight: "100%",
                        borderRadius: 6,
                        width: "auto",
                        height: "auto",
                        objectFit: "contain",
                        display: "block",
                        userSelect: "none",
                        WebkitUserDrag: "none",
                        pointerEvents: "none",
                      } as React.CSSProperties}
                    />
                    {watermarkEnabled && <WatermarkOverlay text={schoolName || "PROOF"} logoUrl={watermarkLogoUrl} />}
                  </div>
                );
              })() : (
                <div style={{ color: "#333", fontSize: 14 }}>No photos available</div>
              )}

              {images.length > 1 && (
                <button
                  type="button"
                  onClick={goNext}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 38,
                    height: 38,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.07)",
                    border: "none",
                    color: "#fff",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 2,
                  }}
                >
                  <ChevronRight size={20} strokeWidth={1.5} />
                </button>
              )}
            </div>

            {/* Confirm backdrop button — shown during preview */}
            {backdropPickerOpen && selectedBackdrop && currentNobgUrl && !confirmedBackdrop && (
              <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
                <button
                  type="button"
                  onClick={handleConfirmBackdrop}
                  style={{
                    background: "#fff",
                    color: "#000",
                    border: "none",
                    borderRadius: 999,
                    padding: "10px 32px",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    transition: "transform 0.1s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.03)")}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                >
                  <Check size={15} strokeWidth={2.5} /> Use This Backdrop
                </button>
              </div>
            )}

            {/* Bottom bar */}
            <div
              style={{
                flexShrink: 0,
                borderTop: "1px solid #141414",
                padding: "12px 20px 18px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => selectedImage && toggleFavorite(selectedImage.id)}
                  style={{
                    background: selectedImage && favorites.has(selectedImage.id) ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.04)",
                    border: selectedImage && favorites.has(selectedImage.id) ? "1px solid rgba(239,68,68,0.4)" : "1px solid rgba(255,255,255,0.1)",
                    color: selectedImage && favorites.has(selectedImage.id) ? "#f87171" : "#aaa",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "9px 18px",
                    borderRadius: 999,
                    transition: "all 0.18s ease",
                  }}
                >
                  <Heart size={14} strokeWidth={1.8} fill={selectedImage && favorites.has(selectedImage.id) ? "#f87171" : "none"} /> {selectedImage && favorites.has(selectedImage.id) ? "Favorited" : "Favorite"}
                </button>

                {hasBackdrops && (
                  <button
                    type="button"
                    onClick={openBackdropPicker}
                    style={{
                      background: backdropPickerOpen ? "rgba(239,68,68,0.12)" : "transparent",
                      border: backdropPickerOpen ? "1.5px solid #ef4444" : "1.5px solid #ef4444",
                      color: "#ef4444",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      fontSize: 12,
                      fontWeight: 700,
                      borderRadius: 999,
                      padding: "9px 20px",
                      transition: "all 0.18s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(239,68,68,0.15)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = backdropPickerOpen ? "rgba(239,68,68,0.12)" : "transparent";
                    }}
                  >
                    <Palette size={14} strokeWidth={1.8} /> Change Backdrop
                  </button>
                )}

                <button
                  type="button"
                  onClick={openBuyDrawer}
                  disabled={orderingDisabled}
                  style={{
                    background: orderingDisabled ? "rgba(255,255,255,0.02)" : "rgba(74,222,128,0.08)",
                    border: orderingDisabled ? "1px solid rgba(255,255,255,0.05)" : "1px solid rgba(74,222,128,0.3)",
                    color: orderingDisabled ? "#3d3d3d" : "#4ade80",
                    cursor: orderingDisabled ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 12,
                    fontWeight: 700,
                    padding: "9px 20px",
                    borderRadius: 999,
                    transition: "all 0.18s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!orderingDisabled) {
                      e.currentTarget.style.background = "rgba(74,222,128,0.15)";
                      e.currentTarget.style.borderColor = "rgba(74,222,128,0.5)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!orderingDisabled) {
                      e.currentTarget.style.background = "rgba(74,222,128,0.08)";
                      e.currentTarget.style.borderColor = "rgba(74,222,128,0.3)";
                    }
                  }}
                >
                  <ShoppingBag size={14} strokeWidth={1.8} /> Buy Photo
                </button>
              </div>

              {images.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    gap: 5,
                    overflowX: "auto",
                    maxWidth: "100%",
                    paddingBottom: 2,
                    scrollbarWidth: "none",
                  }}
                >
                  {images.map((img, idx) => {
                    const active = idx === selectedImageIndex;
                    const hasNobg = !!nobgUrls[img.id];
                    const showComposite = !!confirmedBackdrop && hasNobg;
                    return (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => setSelectedImageIndex(idx)}
                        style={{
                          flexShrink: 0,
                          padding: 0,
                          background: "transparent",
                          border: active
                            ? "2px solid #fff"
                            : "2px solid transparent",
                          borderRadius: 5,
                          overflow: "hidden",
                          cursor: "pointer",
                          opacity: active ? 1 : 0.4,
                          transition: "opacity 0.12s, border-color 0.12s",
                          position: "relative",
                        }}
                      >
                        {showComposite ? (
                          <MiniComposite
                            backdropUrl={confirmedBackdrop!.image_url}
                            nobgUrl={nobgUrls[img.id]}
                            fallbackUrl={img.url}
                            size={72}
                          />
                        ) : (
                          <img
                            src={img.url}
                            alt=""
                            style={{
                              width: 72,
                              height: 72,
                              objectFit: "contain",
                              display: "block",
                            }}
                          />
                        )}
                        {hasNobg && !showComposite && (
                          <span
                            title="Background removed — backdrop ready"
                            style={{
                              position: "absolute",
                              top: 3,
                              right: 3,
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: "#4ade80",
                              border: "1px solid rgba(0,0,0,0.3)",
                            }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right drawer */}
          {drawerOpen && (
            <div
              style={{
                width: 620,
                display: "flex",
                flexDirection: "column",
                background: "#1a1a1a",
                borderLeft: "1px solid #222",
                flexShrink: 0,
                overflow: "hidden",
              }}
            >
              {/* Drawer header */}
              <div
                style={{
                  height: 56,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 18px",
                  gap: 8,
                  borderBottom: "1px solid #252525",
                  background: "#141414",
                }}
              >
                {drawerView !== "product-select" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (drawerView === "checkout") setDrawerView("build-package");
                      else if (drawerView === "build-package")
                        setDrawerView("category-list");
                      else setDrawerView("product-select");
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#aaa",
                      cursor: "pointer",
                      padding: 4,
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    <ChevronLeft size={16} /> Back
                  </button>
                )}

                <h2
                  style={{
                    flex: 1,
                    margin: 0,
                    textAlign: drawerView === "product-select" ? "left" : "center",
                    fontSize: 12,
                    fontWeight: 800,
                    color: "#fff",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  {drawerView === "product-select" && "Select a Product"}
                  {drawerView === "category-list" &&
                    (TILES.find((t) => t.key === activeCategoryKey)?.label ??
                      "Select")}
                  {drawerView === "build-package" &&
                    selectedPkg &&
                    `Building: ${selectedPkg.name}`}
                  {drawerView === "checkout" && "Checkout"}
                </h2>

                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#666",
                    cursor: "pointer",
                    padding: 4,
                    borderRadius: 6,
                    display: "flex",
                  }}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Drawer content */}
              <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
                {/* ══ PRODUCT SELECT ══════════════════════════════════════ */}
                {drawerView === "product-select" && (
                  <>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          background: "rgba(255,255,255,0.06)",
                          borderRadius: 999,
                          padding: "6px 16px",
                          fontSize: 12,
                          color: "#888",
                        }}
                      >
                        <Info size={12} /> Pricing info
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                        gap: 12,
                        marginBottom: 22,
                      }}
                    >
                      {tilesWithData.map((tile) => {
                        const Icon = tile.icon;
                        return (
                          <button
                            key={tile.key}
                            type="button"
                            onClick={() => openCategory(tile.key)}
                            style={{
                              background: "#242424",
                              border: "1px solid #2e2e2e",
                              borderRadius: 14,
                              padding: 0,
                              cursor: "pointer",
                              textAlign: "left",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                height: 150,
                                background: "#1e1e1e",
                                overflow: "hidden",
                                position: "relative",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {renderPremiumMockup(
                                getPreviewKind(tile.key),
                                effectiveImageUrl
                              )}

                              <div
                                style={{
                                  position: "absolute",
                                  inset: 0,
                                  background:
                                    "linear-gradient(to top, rgba(5,10,18,0.38) 0%, transparent 52%)",
                                }}
                              />

                              <div
                                style={{
                                  position: "absolute",
                                  top: 12,
                                  left: 12,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  background: "rgba(10,14,24,0.72)",
                                  color: "#fff",
                                  border: "1px solid rgba(255,255,255,0.12)",
                                  borderRadius: 999,
                                  padding: "6px 10px",
                                  fontSize: 10,
                                  fontWeight: 800,
                                  letterSpacing: "0.08em",
                                  textTransform: "uppercase",
                                  backdropFilter: "blur(8px)",
                                }}
                              >
                                {Icon ? <Icon size={12} color="#d9e5ff" /> : null}
                                {tile.label}
                              </div>
                            </div>

                            <div style={{ padding: "11px 13px 13px" }}>
                              <div
                                style={{
                                  fontSize: 15,
                                  fontWeight: 700,
                                  color: "#fff",
                                }}
                              >
                                {tile.label}
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "#aaa",
                                  marginTop: 2,
                                }}
                              >
                                {tile.minPrice !== null
                                  ? `From $${tile.minPrice.toFixed(2)}`
                                  : "Available"}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {packages.filter((p) => getCategory(p) === "package").length > 0 && (
                      <>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            color: "#555",
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            marginBottom: 12,
                          }}
                        >
                          Package List
                        </div>

                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                          }}
                        >
                          {packages
                            .filter((p) => getCategory(p) === "package")
                            .map((pkg) => (
                              <div
                                key={pkg.id}
                                style={{
                                  background: "linear-gradient(180deg, #242424 0%, #1f1f1f 100%)",
                                  border: "1px solid #2e2e2e",
                                  borderRadius: 16,
                                  padding: "13px 14px 15px",
                                  boxShadow: "0 10px 26px rgba(0,0,0,0.18)",
                                }}
                              >
                                <div
                                  style={{
                                    height: 144,
                                    borderRadius: 14,
                                    overflow: "hidden",
                                    marginBottom: 14,
                                    background: "#171717",
                                  }}
                                >
                                  {renderPremiumMockup("package", effectiveImageUrl)}
                                </div>
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "flex-start",
                                    marginBottom: pkg.items?.length ? 8 : 12,
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: 15,
                                      fontWeight: 700,
                                      color: "#fff",
                                    }}
                                  >
                                    {pkg.name}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 14,
                                      fontWeight: 700,
                                      color: "#aaa",
                                      flexShrink: 0,
                                      marginLeft: 12,
                                    }}
                                  >
                                    ${(pkg.price_cents / 100).toFixed(2)}
                                  </div>
                                </div>

                                {pkg.items?.length ? (
                                  <div
                                    style={{
                                      fontSize: 12,
                                      color: "#666",
                                      lineHeight: 1.8,
                                      marginBottom: 12,
                                    }}
                                  >
                                    {pkg.items.map((item, idx) => (
                                      <div key={idx}>· {formatPackageItem(item)}</div>
                                    ))}
                                  </div>
                                ) : null}

                                <button
                                  type="button"
                                  onClick={() => selectPackage(pkg)}
                                  style={{
                                    width: "100%",
                                    background: "#fff",
                                    color: "#000",
                                    border: "none",
                                    borderRadius: 999,
                                    padding: "11px",
                                    fontSize: 13,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                >
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
                      <div
                        style={{
                          background: "#242424",
                          borderRadius: 12,
                          padding: 28,
                          color: "#666",
                          fontSize: 13,
                          textAlign: "center",
                        }}
                      >
                        No items available in this category.
                      </div>
                    )}

                    {packagesInCategory.map((pkg) => {
                      const previewKind = getPreviewKind(getCategory(pkg));
                      const previewVariant = cardPreviewVariant[pkg.id] ?? 0;
                      const chosenQty = getChosenQty(pkg.id);
                      return (
                      <div
                        key={pkg.id}
                        style={{
                          background: "linear-gradient(180deg, #242424 0%, #1f1f1f 100%)",
                          border: "1px solid #2e2e2e",
                          borderRadius: 18,
                          overflow: "hidden",
                          boxShadow: "0 12px 30px rgba(0,0,0,0.18)",
                        }}
                      >
                        <div
                          style={{
                            height: 196,
                            background: "#181818",
                            position: "relative",
                          }}
                        >
                          {renderPremiumMockup(previewKind, effectiveImageUrl, previewVariant, false, pkg.name)}
                          <div
                            style={{
                              position: "absolute",
                              inset: 0,
                              background:
                                "linear-gradient(to top, rgba(0,0,0,0.32), transparent 58%)",
                            }}
                          />
                          <div
                            style={{
                              position: "absolute",
                              left: 14,
                              top: 14,
                              background: "rgba(9,14,22,0.76)",
                              color: "#fff",
                              borderRadius: 999,
                              border: "1px solid rgba(255,255,255,0.12)",
                              padding: "6px 10px",
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: "0.08em",
                              textTransform: "uppercase",
                              backdropFilter: "blur(8px)",
                            }}
                          >
                            {TILES.find((t) => t.key === getCategory(pkg))?.label ?? "Product"}
                          </div>
                        </div>

                        <div style={{ padding: 16 }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              gap: 12,
                              marginBottom: 4,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 17,
                                fontWeight: 700,
                                color: "#fff",
                                lineHeight: 1.3,
                              }}
                            >
                              {pkg.name}
                            </div>
                            <div
                              style={{
                                fontSize: 15,
                                fontWeight: 700,
                                color: "#f4f4f4",
                                flexShrink: 0,
                              }}
                            >
                              ${(pkg.price_cents / 100).toFixed(2)}
                            </div>
                          </div>

                          <div
                            style={{
                              fontSize: 12,
                              color: "#9a9a9a",
                              lineHeight: 1.65,
                            }}
                          >
                            {pkg.description?.trim() ||
                              "Professionally presented with premium preview scenes and clean ordering controls."}
                          </div>

                          {renderMockupStrip(previewKind, effectiveImageUrl, previewVariant, pkg.name, (variant) => setCardPreviewVariant((prev) => ({ ...prev, [pkg.id]: variant })))}

                          {pkg.items?.length ? (
                            <div
                              style={{
                                marginTop: 14,
                                display: "grid",
                                gap: 6,
                              }}
                            >
                              {pkg.items.slice(0, 4).map((item, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    fontSize: 12,
                                    color: "#b0b0b0",
                                    background: "rgba(255,255,255,0.04)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                    borderRadius: 10,
                                    padding: "8px 10px",
                                  }}
                                >
                                  {formatPackageItem(item)}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <div style={{ padding: "0 16px 16px" }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 12,
                              marginBottom: 14,
                              padding: "10px 12px",
                              borderRadius: 12,
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 800, color: "#8d8d8d", letterSpacing: "0.08em", textTransform: "uppercase" }}>Quantity</div>
                              <div style={{ fontSize: 12, color: "#bfbfbf", marginTop: 2 }}>Choose how many of this item to order.</div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <button
                                type="button"
                                onClick={() => setChosenQty(pkg.id, chosenQty - 1)}
                                style={{ width: 32, height: 32, borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#fff", fontSize: 18, cursor: "pointer" }}
                              >
                                -
                              </button>
                              <div style={{ minWidth: 20, textAlign: "center", color: "#fff", fontWeight: 700 }}>{chosenQty}</div>
                              <button
                                type="button"
                                onClick={() => setChosenQty(pkg.id, chosenQty + 1)}
                                style={{ width: 32, height: 32, borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#fff", fontSize: 18, cursor: "pointer" }}
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => selectPackage(pkg)}
                            style={{
                              width: "100%",
                              background: "#fff",
                              color: "#000",
                              border: "none",
                              borderRadius: 999,
                              padding: "12px",
                              fontSize: 13,
                              fontWeight: 700,
                              cursor: "pointer",
                              boxShadow: "0 8px 20px rgba(255,255,255,0.08)",
                            }}
                          >
                            {getCategory(pkg) === "digital"
                              ? "Order Digital"
                              : `Select (${chosenQty})`}
                          </button>
                        </div>
                      </div>
                    )})}
                  </div>
                )}

                {/* ══ BUILD PACKAGE ══════════════════════════════════════ */}
                {drawerView === "build-package" && selectedPkg && (
                  <>
                    <p
                      style={{
                        fontSize: 13,
                        color: "#777",
                        margin: "0 0 18px",
                        lineHeight: 1.6,
                      }}
                    >
                      Click a slot to select it, then tap a photo to assign it.
                    </p>

                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        marginBottom: 22,
                      }}
                    >
                      {slots.map((slot, i) => {
                        const isActive = activeSlotIndex === i;
                        return (
                          <div
                            key={i}
                            onClick={() => setActiveSlotIndex(isActive ? null : i)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 14,
                              background: isActive ? "#1e2a1e" : "#242424",
                              border: isActive
                                ? "1.5px solid #3a7a3a"
                                : "1px solid #2e2e2e",
                              borderRadius: 12,
                              padding: "12px 14px",
                              cursor: "pointer",
                              transition: "border-color 0.15s, background 0.15s",
                            }}
                          >
                            <div
                              style={{
                                width: 64,
                                height: 64,
                                borderRadius: 8,
                                overflow: "hidden",
                                flexShrink: 0,
                                background: "#1a1a1a",
                                border: isActive
                                  ? "2px solid #4ade80"
                                  : "2px solid #2e2e2e",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                position: "relative",
                              }}
                            >
                              {slot.assignedImageUrl ? (() => {
                                const slotNobg = nobgForUrl(slot.assignedImageUrl);
                                return confirmedBackdrop && slotNobg ? (
                                  <MiniComposite
                                    backdropUrl={confirmedBackdrop.image_url}
                                    nobgUrl={slotNobg}
                                    fallbackUrl={slot.assignedImageUrl}
                                    size={48}
                                  />
                                ) : (
                                  <img
                                    src={slot.assignedImageUrl}
                                    alt=""
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      objectFit: "contain",
                                    }}
                                  />
                                );
                              })() : (
                                <Plus size={20} color={isActive ? "#4ade80" : "#444"} />
                              )}

                              {isActive && (
                                <div
                                  style={{
                                    position: "absolute",
                                    inset: 0,
                                    background: "rgba(74,222,128,0.15)",
                                    borderRadius: 6,
                                  }}
                                />
                              )}
                            </div>

                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 700,
                                  color: "#fff",
                                  marginBottom: 3,
                                }}
                              >
                                Slot {i + 1} of {slots.length}
                              </div>

                              <div
                                style={{
                                  fontSize: 11,
                                  color: "#8a8a8a",
                                  marginBottom: 4,
                                }}
                              >
                                {slot.label}
                              </div>

                              {slot.assignedImageUrl ? (
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                  }}
                                >
                                  <div
                                    style={{
                                      width: 6,
                                      height: 6,
                                      borderRadius: "50%",
                                      background: "#4ade80",
                                      flexShrink: 0,
                                    }}
                                  />
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: "#4ade80",
                                    }}
                                  >
                                    {isActive
                                      ? `Selected for slot ${i + 1} of ${slots.length}`
                                      : `Assigned to slot ${i + 1} of ${slots.length}`}
                                  </span>
                                </div>
                              ) : (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: isActive ? "#aaa" : "#555",
                                  }}
                                >
                                  {isActive ? "↓ Choose the photo for this slot below" : `Tap to assign slot ${i + 1}`}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {activeSlotIndex !== null && (
                      <>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            color: "#555",
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            marginBottom: 10,
                          }}
                        >
                          Choose photo for slot {activeSlotIndex + 1} of {slots.length}
                        </div>

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(4, 1fr)",
                            gap: 8,
                            marginBottom: 22,
                          }}
                        >
                          {images.map((img, idx) => {
                            const isAssigned =
                              slots[activeSlotIndex]?.assignedImageUrl === img.url;
                            const imgNobg = nobgUrls[img.id];
                            const showComp = !!confirmedBackdrop && !!imgNobg;
                            return (
                              <button
                                key={img.id}
                                type="button"
                                onClick={() => assignImageToSlot(img.url)}
                                style={{
                                  padding: 0,
                                  border: isAssigned
                                    ? "2.5px solid #4ade80"
                                    : "2px solid transparent",
                                  borderRadius: 8,
                                  overflow: "hidden",
                                  cursor: "pointer",
                                  background: "transparent",
                                  position: "relative",
                                  aspectRatio: "1",
                                }}
                              >
                                {showComp ? (
                                  <MiniComposite
                                    backdropUrl={confirmedBackdrop!.image_url}
                                    nobgUrl={imgNobg}
                                    fallbackUrl={img.url}
                                    size={120}
                                  />
                                ) : (
                                  <img
                                    src={img.url}
                                    alt={`Photo ${idx + 1}`}
                                    style={{
                                      width: "100%",
                                      height: "100%",
                                      objectFit: "contain",
                                      display: "block",
                                    }}
                                  />
                                )}
                                {isAssigned && (
                                  <div
                                    style={{
                                      position: "absolute",
                                      top: 4,
                                      right: 4,
                                      width: 18,
                                      height: 18,
                                      borderRadius: "50%",
                                      background: "#4ade80",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                    }}
                                  >
                                    <Check size={11} color="#000" strokeWidth={3} />
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        if (allSlotsAssigned) setDrawerView("checkout");
                      }}
                      disabled={!allSlotsAssigned}
                      style={{
                        width: "100%",
                        background: allSlotsAssigned ? "#fff" : "#222",
                        color: allSlotsAssigned ? "#000" : "#444",
                        border: allSlotsAssigned ? "none" : "1px solid #333",
                        borderRadius: 999,
                        padding: "14px",
                        fontSize: 14,
                        fontWeight: 800,
                        cursor: allSlotsAssigned ? "pointer" : "not-allowed",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        transition: "background 0.2s, color 0.2s",
                      }}
                    >
                      <ShoppingCart size={16} />
                      {allSlotsAssigned
                        ? "Continue to Checkout"
                        : `Assign all ${slots.length} photos to continue`}
                    </button>
                  </>
                )}

                {/* ══ CHECKOUT ══════════════════════════════════════════ */}
                {drawerView === "checkout" && selectedPkg && (
                  <form
                    onSubmit={handlePlaceOrder}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                    }}
                  >
                    <div
                      style={{
                        background: "#242424",
                        border: "1px solid #2e2e2e",
                        borderRadius: 12,
                        padding: "14px 16px",
                        marginBottom: 4,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom:
                            getCategory(selectedPkg) !== "digital" ? 10 : 0,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: "#fff",
                          }}
                        >
                          {selectedPkg.name}
                        </div>
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 800,
                            color: "#fff",
                          }}
                        >
                          ${(selectedPkg.price_cents / 100).toFixed(2)}
                        </div>
                      </div>

                      {getCategory(selectedPkg) !== "digital" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {slots.map((slot, i) => (
                            <div
                              key={i}
                              style={{ display: "flex", alignItems: "center", gap: 10 }}
                            >
                              <div
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 6,
                                  overflow: "hidden",
                                  flexShrink: 0,
                                  background: "#1a1a1a",
                                }}
                              >
                                {slot.assignedImageUrl && (() => {
                                  const slotNobg = nobgForUrl(slot.assignedImageUrl);
                                  return confirmedBackdrop && slotNobg ? (
                                    <MiniComposite
                                      backdropUrl={confirmedBackdrop.image_url}
                                      nobgUrl={slotNobg}
                                      fallbackUrl={slot.assignedImageUrl}
                                      size={42}
                                    />
                                  ) : (
                                    <img
                                      src={slot.assignedImageUrl}
                                      alt=""
                                      style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "contain",
                                      }}
                                    />
                                  );
                                })()}
                              </div>
                              <div style={{ fontSize: 12, color: "#888" }}>
                                {slot.label}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {getCategory(selectedPkg) === "digital" && (
                        <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                          Digital download — photos will be emailed to you
                        </div>
                      )}
                    </div>

                    <div>
                      <label style={labelStyle}>Name</label>
                      <div style={{ position: "relative" }}>
                        <User
                          size={13}
                          color="#555"
                          style={{ position: "absolute", left: 12, top: 12 }}
                        />
                        <input
                          value={parentName}
                          onChange={(e) => setParentName(e.target.value)}
                          placeholder="Jane Smith"
                          style={{ ...darkInput, paddingLeft: 34 }}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={labelStyle}>Email *</label>
                      <div style={{ position: "relative" }}>
                        <Mail
                          size={13}
                          color="#555"
                          style={{ position: "absolute", left: 12, top: 12 }}
                        />
                        <input
                          type="email"
                          value={parentEmail}
                          onChange={(e) => setParentEmail(e.target.value)}
                          placeholder="jane@email.com"
                          required
                          style={{ ...darkInput, paddingLeft: 34 }}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={labelStyle}>Phone</label>
                      <div style={{ position: "relative" }}>
                        <Phone
                          size={13}
                          color="#555"
                          style={{ position: "absolute", left: 12, top: 12 }}
                        />
                        <input
                          value={parentPhone}
                          onChange={(e) => setParentPhone(e.target.value)}
                          placeholder="(555) 000-0000"
                          style={{ ...darkInput, paddingLeft: 34 }}
                        />
                      </div>
                    </div>

                    {getCategory(selectedPkg) !== "digital" && (
                      <div>
                        <label style={labelStyle}>Delivery</label>
                        <div style={{ display: "flex", gap: 8 }}>
                          {(["pickup", "shipping"] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setDeliveryMethod(m)}
                              style={{
                                flex: 1,
                                border: "none",
                                background: deliveryMethod === m ? "#fff" : "#242424",
                                outline:
                                  deliveryMethod === m
                                    ? "none"
                                    : "1px solid #333",
                                outlineOffset: -1,
                                color: deliveryMethod === m ? "#000" : "#666",
                                borderRadius: 8,
                                padding: "11px",
                                fontSize: 13,
                                fontWeight: 700,
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 6,
                                transition: "background 0.15s, color 0.15s",
                              }}
                            >
                              {m === "shipping" && <Truck size={13} />}
                              {m.charAt(0).toUpperCase() + m.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {deliveryMethod === "shipping" &&
                      getCategory(selectedPkg) !== "digital" && (
                        <div
                          style={{
                            background: "#141414",
                            border: "1px solid #252525",
                            borderRadius: 10,
                            padding: 12,
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          <input
                            value={shippingName}
                            onChange={(e) => setShippingName(e.target.value)}
                            placeholder="Full name"
                            style={darkInput}
                          />
                          <input
                            value={shippingAddress1}
                            onChange={(e) => setShippingAddress1(e.target.value)}
                            placeholder="Address line 1"
                            style={darkInput}
                          />
                          <input
                            value={shippingAddress2}
                            onChange={(e) => setShippingAddress2(e.target.value)}
                            placeholder="Address line 2 (optional)"
                            style={darkInput}
                          />
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 8,
                            }}
                          >
                            <input
                              value={shippingCity}
                              onChange={(e) => setShippingCity(e.target.value)}
                              placeholder="City"
                              style={darkInput}
                            />
                            <input
                              value={shippingProvince}
                              onChange={(e) => setShippingProvince(e.target.value)}
                              placeholder="Province"
                              style={darkInput}
                            />
                          </div>
                          <input
                            value={shippingPostalCode}
                            onChange={(e) => setShippingPostalCode(e.target.value)}
                            placeholder="Postal code"
                            style={darkInput}
                          />
                        </div>
                      )}

                    <div>
                      <label style={labelStyle}>Notes</label>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Special requests…"
                        rows={3}
                        style={{ ...darkInput, resize: "vertical" }}
                      />
                    </div>

                    {orderError && (
                      <div
                        style={{
                          background: "#1e0a0a",
                          border: "1px solid #4a1a1a",
                          borderRadius: 8,
                          padding: "10px 13px",
                          color: "#f87171",
                          fontSize: 12,
                        }}
                      >
                        {orderError}
                      </div>
                    )}

                    <div
                      style={{
                        background: "#141414",
                        border: "1px solid #252525",
                        borderRadius: 10,
                        padding: "12px 14px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          color: "#666",
                          marginBottom: 10,
                          lineHeight: 1.5,
                        }}
                      >
                        Secure card checkout powered by Stripe. Studio OS will route the photographer payout automatically after payment.
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 12,
                          color: "#555",
                          marginBottom: 8,
                        }}
                      >
                        <span>Subtotal</span>
                        <span>${(selectedPkg.price_cents / 100).toFixed(2)}</span>
                      </div>
                      {premiumBackdropCents > 0 && confirmedBackdrop && (
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 12,
                            color: "#f59e0b",
                            marginBottom: 8,
                          }}
                        >
                          <span>★ {confirmedBackdrop.name}</span>
                          <span>${(premiumBackdropCents / 100).toFixed(2)}</span>
                        </div>
                      )}
                      <div
                        style={{
                          borderTop: "1px solid #222",
                          paddingTop: 8,
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 15,
                          fontWeight: 700,
                          color: "#fff",
                        }}
                      >
                        <span>Total</span>
                        <span>${((selectedPkg.price_cents + premiumBackdropCents) / 100).toFixed(2)}</span>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={placing || orderingDisabled}
                      style={{
                        width: "100%",
                        background:
                          placing || orderingDisabled ? "#222" : "#fff",
                        color: placing || orderingDisabled ? "#555" : "#000",
                        border: "none",
                        borderRadius: 999,
                        padding: "15px",
                        fontSize: 15,
                        fontWeight: 800,
                        cursor:
                          placing || orderingDisabled ? "not-allowed" : "pointer",
                      }}
                    >
                      {placing
                        ? "Redirecting to secure checkout…"
                        : orderingDisabled
                        ? "Ordering Closed"
                        : getCategory(selectedPkg) === "digital"
                        ? "Pay for Digital Photos"
                        : "Continue to Secure Checkout"}
                    </button>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* ── Backdrop Picker Panel (school mode only) ─────────────── */}
          {backdropPickerOpen && hasBackdrops && !drawerOpen && (
            <div
              style={{
                width: 520,
                display: "flex",
                flexDirection: "column",
                background: "#111",
                borderLeft: "1px solid #1e1e1e",
                flexShrink: 0,
                overflow: "hidden",
              }}
            >
              {/* Panel header */}
              <div style={{
                padding: "16px 18px",
                borderBottom: "1px solid #1e1e1e",
                background: "#0d0d0d",
              }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}>
                  <h2 style={{
                    margin: 0,
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "#fff",
                  }}>
                    Choose Backdrop
                  </h2>
                  <button
                    type="button"
                    onClick={() => setBackdropPickerOpen(false)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#666",
                      cursor: "pointer",
                      fontSize: 18,
                      padding: 4,
                      lineHeight: 1,
                      display: "flex",
                    }}
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Nobg status */}
                {!currentNobgUrl && (
                  <div style={{
                    padding: "8px 12px",
                    marginBottom: 10,
                    borderRadius: 6,
                    background: "rgba(245,158,11,0.1)",
                    border: "1px solid rgba(245,158,11,0.25)",
                    fontSize: 11,
                    color: "#f59e0b",
                    lineHeight: 1.5,
                  }}>
                    ⚠️ No background-removed version found for this photo. Run <strong>Background Removal</strong> in
                    the desktop app, then <strong>Cloud Sync</strong> to enable backdrop compositing.
                  </div>
                )}

                {/* Category tabs */}
                <div style={{
                  display: "flex",
                  gap: 4,
                  overflowX: "auto",
                  paddingBottom: 2,
                  scrollbarWidth: "none",
                }}>
                  {backdropCategoriesWithData.map((cat) => {
                    const active = backdropCategory === cat.key;
                    const count = cat.key === "all"
                      ? backdrops.length
                      : backdrops.filter((b) => b.category === cat.key).length;
                    return (
                      <button
                        key={cat.key}
                        type="button"
                        onClick={() => setBackdropCategory(cat.key)}
                        style={{
                          flexShrink: 0,
                          padding: "7px 14px",
                          borderRadius: 999,
                          border: "none",
                          background: active ? "#fff" : "rgba(255,255,255,0.06)",
                          color: active ? "#000" : "#888",
                          fontSize: 11,
                          fontWeight: active ? 800 : 600,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        {cat.label}
                        <span style={{ fontSize: 10, opacity: 0.6, fontWeight: 500 }}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live preview */}
              {selectedBackdrop && selectedImage && (
                <div style={{
                  padding: "16px 18px 12px",
                  borderBottom: "1px solid #1a1a1a",
                  display: "flex",
                  gap: 14,
                  alignItems: "center",
                  background: "#0a0a0a",
                }}>
                  <div style={{
                    flexShrink: 0,
                    borderRadius: 10,
                    overflow: "hidden",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}>
                    <CompositeCanvas
                      key={`preview-${selectedImage.id}-${selectedBackdrop.id}`}
                      backdropUrl={selectedBackdrop.image_url}
                      nobgUrl={currentNobgUrl}
                      fallbackUrl={selectedImage.url}
                      width={110}
                      height={142}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#555",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}>
                      Live Preview
                    </div>
                    <div style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "#fff",
                      marginBottom: 2,
                    }}>
                      {selectedBackdrop.name}
                    </div>
                    <div style={{
                      fontSize: 11,
                      color: selectedBackdrop.tier === "premium" ? "#f59e0b" : "#4ade80",
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      marginBottom: 12,
                    }}>
                      {selectedBackdrop.tier === "premium"
                        ? `★ Premium · $${(selectedBackdrop.price_cents / 100).toFixed(2)}`
                        : "✓ Included Free"}
                    </div>
                    <button
                      type="button"
                      onClick={handleConfirmBackdrop}
                      style={{
                        background: "#fff",
                        color: "#000",
                        border: "none",
                        borderRadius: 999,
                        padding: "10px 22px",
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: "pointer",
                        letterSpacing: "0.02em",
                      }}
                    >
                      Use This Backdrop
                    </button>
                  </div>
                </div>
              )}

              {/* Backdrop grid */}
              <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
                {/* Free section */}
                {filteredBackdrops.some((b) => b.tier === "free") && (
                  <>
                    <div style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: "#4ade80",
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      marginBottom: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}>
                      <span style={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: "rgba(74, 222, 128, 0.12)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                      }}>✓</span>
                      Included with Gallery
                    </div>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
                      gap: 8,
                      marginBottom: 20,
                    }}>
                      {filteredBackdrops.filter((b) => b.tier === "free").map((backdrop) => (
                        <BackdropThumbCanvas
                          key={backdrop.id}
                          backdropUrl={backdrop.thumbnail_url || backdrop.image_url}
                          nobgUrl={currentNobgUrl}
                          fallbackUrl={selectedImage?.url ?? ""}
                          selected={selectedBackdrop?.id === backdrop.id}
                          isPremium={false}
                          onClick={() => handleBackdropClick(backdrop)}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* Premium section */}
                {filteredBackdrops.some((b) => b.tier === "premium") && (
                  <>
                    <div style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: "#f59e0b",
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      marginBottom: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}>
                      <span style={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: "rgba(245, 158, 11, 0.12)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 9,
                      }}>★</span>
                      Premium Backdrops
                    </div>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
                      gap: 8,
                      marginBottom: 14,
                    }}>
                      {filteredBackdrops.filter((b) => b.tier === "premium").map((backdrop) => (
                        <BackdropThumbCanvas
                          key={backdrop.id}
                          backdropUrl={backdrop.thumbnail_url || backdrop.image_url}
                          nobgUrl={currentNobgUrl}
                          fallbackUrl={selectedImage?.url ?? ""}
                          selected={selectedBackdrop?.id === backdrop.id}
                          isPremium={true}
                          onClick={() => handleBackdropClick(backdrop)}
                        />
                      ))}
                    </div>
                    <div style={{
                      background: "rgba(245, 158, 11, 0.06)",
                      border: "1px solid rgba(245, 158, 11, 0.12)",
                      borderRadius: 10,
                      padding: "10px 14px",
                      fontSize: 11,
                      color: "#a0875a",
                      lineHeight: 1.6,
                    }}>
                      Premium backdrops are paid add-ons. Your photographer earns directly when you pick a premium backdrop.
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Premium Backdrop Unlock Modal ───────────────────────────── */}
        {showPremiumModal && premiumTarget && (
          <div
            onClick={() => setShowPremiumModal(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.7)",
              backdropFilter: "blur(8px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 100,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: 400,
                background: "#151515",
                border: "1px solid #2a2a2a",
                borderRadius: 20,
                padding: "36px 32px",
                textAlign: "center",
              }}
            >
              {selectedImage && (
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
                  <div style={{
                    borderRadius: 14,
                    overflow: "hidden",
                    boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}>
                    <CompositeCanvas
                      key={`modal-${selectedImage.id}-${premiumTarget.id}`}
                      backdropUrl={premiumTarget.image_url}
                      nobgUrl={currentNobgUrl}
                      fallbackUrl={selectedImage.url}
                      width={160}
                      height={210}
                    />
                  </div>
                </div>
              )}

              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "rgba(245,158,11,0.1)",
                border: "1px solid rgba(245,158,11,0.2)",
                borderRadius: 999,
                padding: "5px 12px",
                fontSize: 10,
                fontWeight: 800,
                color: "#f59e0b",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 14,
              }}>
                ★ Premium Backdrop
              </div>

              <h3 style={{
                fontSize: 20,
                fontWeight: 800,
                color: "#fff",
                margin: "0 0 6px",
              }}>
                {premiumTarget.name}
              </h3>
              <p style={{
                fontSize: 13,
                color: "#888",
                margin: "0 0 20px",
                lineHeight: 1.6,
              }}>
                Unlock this premium backdrop for a one-time fee. Your photographer earns from every premium backdrop chosen.
              </p>

              <div style={{
                background: "#1a1a1a",
                border: "1px solid #252525",
                borderRadius: 12,
                padding: "14px 18px",
                marginBottom: 18,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}>
                <span style={{ fontSize: 13, color: "#888" }}>Backdrop add-on</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>
                  ${(premiumTarget.price_cents / 100).toFixed(2)}
                </span>
              </div>

              <button
                type="button"
                onClick={handleUnlockPremium}
                style={{
                  width: "100%",
                  background: "linear-gradient(135deg, #f59e0b, #d97706)",
                  color: "#000",
                  border: "none",
                  borderRadius: 999,
                  padding: "14px",
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: "pointer",
                  marginBottom: 10,
                }}
              >
                Unlock for ${(premiumTarget.price_cents / 100).toFixed(2)}
              </button>

              <button
                type="button"
                onClick={() => setShowPremiumModal(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#555",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  padding: "8px 16px",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}