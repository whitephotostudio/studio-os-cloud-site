"use client";

// Per-school orders page.
//
// Route: /dashboard/projects/schools/[schoolId]/orders
//
// Thin wrapper around <GalleryOrdersPanel>.  Fetches the school name for
// the header and nothing else — all the real work lives in the panel.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-is-mobile";
import { GalleryOrdersPanel } from "@/components/gallery-orders/gallery-orders-panel";

type SchoolMeta = {
  id: string;
  school_name: string | null;
};

export default function SchoolOrdersPage() {
  const [supabase] = useState(() => createClient());
  const params = useParams();
  const isMobile = useIsMobile();
  const schoolId = String(params?.schoolId ?? "");

  const [school, setSchool] = useState<SchoolMeta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!schoolId) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("schools")
        .select("id, school_name")
        .eq("id", schoolId)
        .maybeSingle();
      if (!cancelled) {
        setSchool((data as SchoolMeta | null) ?? null);
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, schoolId]);

  const schoolName =
    school?.school_name?.trim() ||
    (loading ? "Loading school…" : "Unknown school");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f7f5f2",
        padding: isMobile ? 14 : 28,
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <Link
          href={`/dashboard/projects/schools/${schoolId}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "#111827",
            textDecoration: "none",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          <ArrowLeft size={14} /> Back to school
        </Link>

        <div style={{ marginTop: 12, marginBottom: 18 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              fontWeight: 800,
              color: "#6b7280",
              textTransform: "uppercase",
            }}
          >
            Orders
          </div>
          <h1
            style={{
              margin: "4px 0 0",
              fontSize: isMobile ? 22 : 28,
              fontWeight: 900,
              color: "#111827",
            }}
          >
            {schoolName}
          </h1>
          <div
            style={{
              marginTop: 4,
              fontSize: 13,
              color: "#6b7280",
              fontWeight: 600,
            }}
          >
            Every order placed by parents from this school — search, inspect line items,
            and resolve questions fast.
          </div>
        </div>

        <GalleryOrdersPanel schoolId={schoolId} />
      </div>
    </div>
  );
}
