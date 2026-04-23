"use client";

// Per-event orders page.
//
// Route: /dashboard/projects/[id]/orders
//
// Thin wrapper around <GalleryOrdersPanel> for event-type projects.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useIsMobile } from "@/lib/use-is-mobile";
import { GalleryOrdersPanel } from "@/components/gallery-orders/gallery-orders-panel";

type ProjectMeta = {
  id: string;
  title: string | null;
  client_name: string | null;
};

export default function ProjectOrdersPage() {
  const [supabase] = useState(() => createClient());
  const params = useParams();
  const isMobile = useIsMobile();
  const projectId = String(params?.id ?? "");

  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!projectId) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("projects")
        .select("id, title, client_name")
        .eq("id", projectId)
        .maybeSingle();
      if (!cancelled) {
        setProject((data as ProjectMeta | null) ?? null);
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, projectId]);

  const eventName =
    project?.title?.trim() ||
    (loading ? "Loading event…" : "Unknown event");
  const clientName = project?.client_name?.trim() ?? "";

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
          href={`/dashboard/projects/${projectId}`}
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
          <ArrowLeft size={14} /> Back to event
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
            {eventName}
          </h1>
          {clientName ? (
            <div
              style={{
                marginTop: 4,
                fontSize: 13,
                color: "#6b7280",
                fontWeight: 700,
              }}
            >
              {clientName}
            </div>
          ) : null}
          <div
            style={{
              marginTop: 4,
              fontSize: 13,
              color: "#6b7280",
              fontWeight: 600,
            }}
          >
            Every order from this event — search, inspect line items, and resolve
            questions fast.
          </div>
        </div>

        <GalleryOrdersPanel projectId={projectId} />
      </div>
    </div>
  );
}
