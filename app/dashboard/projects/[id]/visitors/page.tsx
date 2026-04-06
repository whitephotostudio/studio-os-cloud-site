"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Download,
  Edit3,
  Heart,
  Mail,
  Search,
  ShoppingCart,
  Star,
  Users,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/* ── colours ─────────────────────────────────────────────────── */
const bg = "#f5f5f5";
const cardBg = "#fff";
const textPrimary = "#111";
const textMuted = "#666";
const borderColor = "#e5e5e5";
const accentColor = "#111";

/* ── types ───────────────────────────────────────────────────── */
type VisitorOrder = {
  id: string;
  status: string;
  totalCents: number;
  createdAt: string;
};

type VisitorDownload = {
  id: string;
  downloadType: string;
  downloadCount: number;
  mediaIds: string[];
  createdAt: string;
};

type VisitorFavorite = {
  id: string;
  mediaId: string;
  createdAt: string;
};

type Visitor = {
  id: string;
  email: string;
  firstVisit: string;
  lastVisit: string;
  orders: VisitorOrder[];
  downloads: VisitorDownload[];
  favorites: VisitorFavorite[];
  orderCount: number;
  downloadCount: number;
  favoriteCount: number;
};

/* ── helpers ─────────────────────────────────────────────────── */
function fmtDate(iso: string) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(iso: string) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtMoney(cents: number) {
  return "$" + (cents / 100).toFixed(2);
}

function statusBadge(status: string) {
  const colors: Record<string, { bg: string; fg: string }> = {
    completed: { bg: "#dcfce7", fg: "#166534" },
    new: { bg: "#dbeafe", fg: "#1e40af" },
    sent_to_print: { bg: "#fef9c3", fg: "#854d0e" },
    shipped: { bg: "#e0e7ff", fg: "#3730a3" },
    delivered: { bg: "#d1fae5", fg: "#065f46" },
    cancelled: { bg: "#fee2e2", fg: "#991b1b" },
  };
  const c = colors[status] ?? { bg: "#f3f4f6", fg: "#374151" };
  const label = status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  return (
    <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700, background: c.bg, color: c.fg }}>
      {label}
    </span>
  );
}

/* ── page ────────────────────────────────────────────────────── */
export default function EventVisitorsPage() {
  const supabase = useMemo(() => createClient(), []);
  const params = useParams();
  const projectId = String(params.id ?? "");

  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedVisitor, setSelectedVisitor] = useState<Visitor | null>(null);
  const [editingEmail, setEditingEmail] = useState<{ id: string; email: string } | null>(null);
  const [savingEmail, setSavingEmail] = useState(false);

  // Email composer
  const [showComposer, setShowComposer] = useState(false);
  const [emailForm, setEmailForm] = useState({ subject: "", headline: "", message: "" });
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailResult, setEmailResult] = useState<{ sent: number; failed: number; total: number } | null>(null);

  const [branding, setBranding] = useState<{
    businessName: string;
    logoUrl: string;
    studioPhone: string;
    studioEmail: string;
    studioAddress: string;
  }>({ businessName: "", logoUrl: "", studioPhone: "", studioEmail: "", studioAddress: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: pg } = await supabase
        .from("photographers")
        .select("business_name, studio_email, billing_email, logo_url, studio_phone, studio_address")
        .eq("user_id", user.id)
        .maybeSingle();
      if (pg) {
        const p = pg as Record<string, unknown>;
        setBranding({
          businessName: (p.business_name as string) || "",
          logoUrl: (p.logo_url as string) || "",
          studioPhone: (p.studio_phone as string) || "",
          studioEmail: (p.studio_email as string) || (p.billing_email as string) || "",
          studioAddress: (p.studio_address as string) || "",
        });
      }
    }

    const res = await fetch(`/api/dashboard/events/${projectId}/visitors`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setProjectName(data.projectName || "");
      setVisitors(data.visitors || []);
    }
    setLoading(false);
  }, [supabase, projectId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return visitors;
    const q = search.toLowerCase();
    return visitors.filter((v) => v.email.toLowerCase().includes(q) || v.orders.some((o) => o.id.toLowerCase().includes(q)));
  }, [visitors, search]);

  const allSelected = filtered.length > 0 && filtered.every((v) => selected.has(v.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(filtered.map((v) => v.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function saveEmailEdit() {
    if (!editingEmail) return;
    setSavingEmail(true);
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`/api/dashboard/events/${projectId}/visitors`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ visitorId: editingEmail.id, newEmail: editingEmail.email }),
    });
    setEditingEmail(null);
    setSavingEmail(false);
    await load();
  }

  async function sendMassEmail() {
    setSendingEmail(true);
    const recipientEmails = visitors.filter((v) => selected.has(v.id)).map((v) => v.email);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/dashboard/visitors/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ recipients: recipientEmails, subject: emailForm.subject, headline: emailForm.headline, message: emailForm.message }),
    });
    const data = await res.json();
    if (data.ok) setEmailResult({ sent: data.sent, failed: data.failed, total: data.total });
    else alert(data.message || "Failed to send emails.");
    setSendingEmail(false);
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: bg }}>
        <div style={{ fontSize: 14, color: textMuted }}>Loading visitors…</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: bg }}>
      {/* Main content */}
      <div style={{ flex: 1, padding: "32px 40px", maxWidth: selectedVisitor ? "calc(100% - 440px)" : "100%" }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <Link href={`/dashboard/projects/${projectId}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: textMuted, fontSize: 13, textDecoration: "none", marginBottom: 12 }}>
            <ArrowLeft size={14} /> Back to {projectName || "Event"}
          </Link>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: textPrimary, margin: 0 }}>
                <Users size={22} style={{ marginRight: 8, verticalAlign: "middle" }} />
                Gallery Visitors
              </h1>
              <div style={{ fontSize: 13, color: textMuted, marginTop: 4 }}>
                {projectName} &middot; {visitors.length} visitor{visitors.length !== 1 ? "s" : ""}
              </div>
            </div>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => {
                  setEmailForm({ subject: `Update from ${branding.businessName || "Your Photographer"}`, headline: "A message from your photographer", message: "" });
                  setEmailResult(null);
                  setShowComposer(true);
                }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", background: accentColor, color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
              >
                <Mail size={16} /> Email {selected.size} Visitor{selected.size !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 20, maxWidth: 480 }}>
          <Search size={16} style={{ position: "absolute", left: 12, top: 11, color: textMuted }} />
          <input
            type="text"
            placeholder="Search by email or order ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", padding: "10px 12px 10px 36px", border: `1px solid ${borderColor}`, borderRadius: 8, fontSize: 13, color: textPrimary, background: cardBg, boxSizing: "border-box" }}
          />
        </div>

        {/* Table */}
        <div style={{ background: cardBg, borderRadius: 12, border: `1px solid ${borderColor}`, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr 80px 80px 80px 100px", padding: "12px 16px", background: "#fafafa", borderBottom: `1px solid ${borderColor}`, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: textMuted }}>
            <div><input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ width: 16, height: 16, cursor: "pointer" }} /></div>
            <div>Visitor</div>
            <div>Last Activity</div>
            <div>Favs</div>
            <div>Orders</div>
            <div>DLs</div>
            <div>Actions</div>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: textMuted, fontSize: 14 }}>
              {search ? "No visitors match your search." : "No visitors yet."}
            </div>
          ) : (
            filtered.map((v) => (
              <div key={v.id} style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr 80px 80px 80px 100px", padding: "14px 16px", borderBottom: `1px solid ${borderColor}`, alignItems: "center", background: selectedVisitor?.id === v.id ? "#f9fafb" : "transparent", cursor: "pointer" }} onClick={() => setSelectedVisitor(v)}>
                <div onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggleOne(v.id)} style={{ width: 16, height: 16, cursor: "pointer" }} />
                </div>
                <div>
                  {editingEmail?.id === v.id ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                      <input type="text" value={editingEmail.email} onChange={(e) => setEditingEmail({ ...editingEmail, email: e.target.value })} style={{ padding: "4px 8px", border: `1px solid ${borderColor}`, borderRadius: 4, fontSize: 13, color: textPrimary, width: 220 }} />
                      <button type="button" onClick={saveEmailEdit} disabled={savingEmail} style={{ padding: "4px 8px", background: accentColor, color: "#fff", border: "none", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>{savingEmail ? "…" : <Check size={14} />}</button>
                      <button type="button" onClick={() => setEditingEmail(null)} style={{ padding: "4px 8px", background: "#eee", color: textPrimary, border: "none", borderRadius: 4, fontSize: 11, cursor: "pointer" }}><X size={14} /></button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, fontWeight: 600, color: textPrimary }}>{v.email}</div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: textMuted }}>{fmtDateTime(v.lastVisit)}</div>
                <div>{v.favoriteCount > 0 ? <span style={{ fontSize: 12, fontWeight: 700, color: "#e11d48" }}><Star size={12} style={{ marginRight: 2, verticalAlign: "middle" }} />{v.favoriteCount}</span> : <span style={{ fontSize: 12, color: "#ccc" }}>-</span>}</div>
                <div>{v.orderCount > 0 ? <span style={{ fontSize: 12, fontWeight: 700, color: "#166534" }}><ShoppingCart size={12} style={{ marginRight: 2, verticalAlign: "middle" }} />{v.orderCount}</span> : <span style={{ fontSize: 12, color: "#ccc" }}>-</span>}</div>
                <div>{v.downloadCount > 0 ? <span style={{ fontSize: 12, fontWeight: 700, color: "#1e40af" }}><Download size={12} style={{ marginRight: 2, verticalAlign: "middle" }} />{v.downloadCount}</span> : <span style={{ fontSize: 12, color: "#ccc" }}>-</span>}</div>
                <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  <button type="button" title="Edit email" onClick={() => setEditingEmail({ id: v.id, email: v.email })} style={{ padding: 6, background: "#f3f4f6", border: "none", borderRadius: 4, cursor: "pointer", color: textMuted }}><Edit3 size={14} /></button>
                  <button type="button" title="View details" onClick={() => setSelectedVisitor(v)} style={{ padding: 6, background: "#f3f4f6", border: "none", borderRadius: 4, cursor: "pointer", color: textMuted }}><ChevronRight size={14} /></button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Side panel */}
      {selectedVisitor && (
        <div style={{ width: 440, background: cardBg, borderLeft: `1px solid ${borderColor}`, overflowY: "auto", height: "100vh", position: "sticky", top: 0 }}>
          <div style={{ padding: "20px 24px", borderBottom: `1px solid ${borderColor}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: textPrimary }}>{selectedVisitor.email}</div>
              <div style={{ fontSize: 12, color: textMuted, marginTop: 2 }}>First visit: {fmtDate(selectedVisitor.firstVisit)}</div>
            </div>
            <button type="button" onClick={() => setSelectedVisitor(null)} style={{ background: "none", border: "none", cursor: "pointer", color: textMuted }}><X size={18} /></button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: borderColor }}>
            <div style={{ background: cardBg, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: textPrimary }}>{selectedVisitor.favoriteCount}</div>
              <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>Favorites</div>
            </div>
            <div style={{ background: cardBg, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: textPrimary }}>{selectedVisitor.orderCount}</div>
              <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>Orders</div>
            </div>
            <div style={{ background: cardBg, padding: "16px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: textPrimary }}>{selectedVisitor.downloadCount}</div>
              <div style={{ fontSize: 11, color: textMuted, marginTop: 2 }}>Downloads</div>
            </div>
          </div>

          {/* Favorites */}
          <div style={{ padding: "20px 24px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary, marginBottom: 12 }}>
              <Star size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Favorites ({selectedVisitor.favorites.length})
            </div>
            {selectedVisitor.favorites.length === 0 ? (
              <div style={{ fontSize: 13, color: textMuted }}>No favorites.</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {selectedVisitor.favorites.map((f) => (
                  <div key={f.id} style={{ padding: "6px 10px", background: "#fef2f2", borderRadius: 6, fontSize: 11, color: "#991b1b", fontWeight: 600 }}>
                    {(f.mediaId || "").slice(0, 8)}… <span style={{ color: "#999", fontWeight: 400 }}>{fmtDate(f.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Orders */}
          <div style={{ padding: "0 24px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary, marginBottom: 12 }}>
              <ShoppingCart size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Orders ({selectedVisitor.orders.length})
            </div>
            {selectedVisitor.orders.length === 0 ? (
              <div style={{ fontSize: 13, color: textMuted }}>No orders placed.</div>
            ) : (
              selectedVisitor.orders.map((o) => (
                <Link key={o.id} href={`/dashboard/orders?highlight=${o.id}`} style={{ display: "block", padding: "12px 16px", background: "#f9fafb", borderRadius: 8, marginBottom: 8, textDecoration: "none", border: `1px solid ${borderColor}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: textPrimary }}>Order {o.id.slice(0, 8)}…</div>
                    {statusBadge(o.status)}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: textMuted }}>
                    <span>{fmtDate(o.createdAt)}</span>
                    <span style={{ fontWeight: 700, color: textPrimary }}>{o.totalCents > 0 ? fmtMoney(o.totalCents) : "-"}</span>
                  </div>
                </Link>
              ))
            )}
          </div>

          {/* Downloads */}
          <div style={{ padding: "0 24px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: textPrimary, marginBottom: 12 }}>
              <Download size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Downloads ({selectedVisitor.downloads.length})
            </div>
            {selectedVisitor.downloads.length === 0 ? (
              <div style={{ fontSize: 13, color: textMuted }}>No downloads.</div>
            ) : (
              selectedVisitor.downloads.map((d) => (
                <div key={d.id} style={{ padding: "12px 16px", background: "#f9fafb", borderRadius: 8, marginBottom: 8, border: `1px solid ${borderColor}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: textPrimary }}>{d.mediaIds.length} photo{d.mediaIds.length !== 1 ? "s" : ""}</div>
                    <div style={{ fontSize: 11, color: textMuted }}>{fmtDateTime(d.createdAt)}</div>
                  </div>
                  {d.mediaIds.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 11, color: textMuted, lineHeight: 1.6 }}>
                      {d.mediaIds.slice(0, 8).map((mid, i) => (
                        <span key={i} style={{ display: "inline-block", padding: "2px 8px", background: "#e5e7eb", borderRadius: 4, marginRight: 4, marginBottom: 4 }}>{mid.slice(0, 12)}…</span>
                      ))}
                      {d.mediaIds.length > 8 && <span>+{d.mediaIds.length - 8} more</span>}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Email Composer Modal */}
      {showComposer && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: cardBg, borderRadius: 12, width: "100%", maxWidth: 900, maxHeight: "90vh", overflow: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ padding: "20px 28px", borderBottom: `1px solid ${borderColor}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: textPrimary }}><Mail size={20} style={{ marginRight: 8, verticalAlign: "middle" }} />Send Email to {selected.size} Visitor{selected.size !== 1 ? "s" : ""}</div>
              <button type="button" onClick={() => { setShowComposer(false); setEmailResult(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: textMuted }}><X size={20} /></button>
            </div>

            {emailResult ? (
              <div style={{ padding: "40px 28px", textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>&#9993;</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: textPrimary, marginBottom: 8 }}>Emails Sent!</div>
                <div style={{ fontSize: 14, color: textMuted }}>{emailResult.sent} sent{emailResult.failed > 0 ? `, ${emailResult.failed} failed` : ""}</div>
                <button type="button" onClick={() => { setShowComposer(false); setEmailResult(null); setSelected(new Set()); }} style={{ marginTop: 24, padding: "10px 24px", background: accentColor, color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>Done</button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 340px", padding: "24px 28px", borderRight: `1px solid ${borderColor}` }}>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: textMuted, marginBottom: 4 }}>To</div>
                    <div style={{ fontSize: 13, color: textPrimary, padding: "8px 12px", background: "#f9fafb", border: `1px solid ${borderColor}`, borderRadius: 6, maxHeight: 80, overflowY: "auto" }}>{visitors.filter((v) => selected.has(v.id)).map((v) => v.email).join(", ")}</div>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: textMuted, marginBottom: 4 }}>Subject</div>
                    <input type="text" value={emailForm.subject} onChange={(e) => setEmailForm((f) => ({ ...f, subject: e.target.value }))} style={{ width: "100%", padding: "10px 12px", border: `1px solid ${borderColor}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", color: textPrimary, background: "#fff" }} />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: textMuted, marginBottom: 4 }}>Headline</div>
                    <input type="text" value={emailForm.headline} onChange={(e) => setEmailForm((f) => ({ ...f, headline: e.target.value }))} style={{ width: "100%", padding: "10px 12px", border: `1px solid ${borderColor}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", color: textPrimary, background: "#fff" }} />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: textMuted, marginBottom: 4 }}>Message</div>
                    <textarea value={emailForm.message} onChange={(e) => setEmailForm((f) => ({ ...f, message: e.target.value }))} rows={8} style={{ width: "100%", padding: "10px 12px", border: `1px solid ${borderColor}`, borderRadius: 6, fontSize: 13, boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", color: textPrimary, background: "#fff" }} placeholder="Write your message here…" />
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button type="button" onClick={() => setShowComposer(false)} style={{ padding: "10px 20px", background: "#fff", color: textPrimary, border: `1px solid ${borderColor}`, borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                    <button type="button" onClick={sendMassEmail} disabled={sendingEmail || !emailForm.subject || !emailForm.message} style={{ padding: "10px 24px", background: accentColor, color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer", opacity: sendingEmail || !emailForm.subject || !emailForm.message ? 0.5 : 1 }}>{sendingEmail ? "Sending…" : `Send to ${selected.size}`}</button>
                  </div>
                </div>
                <div style={{ flex: "1 1 340px", padding: "24px 28px", background: "#fafafa" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: textMuted, marginBottom: 12 }}>Email Preview</div>
                  <div style={{ background: "#e5e5e5", borderRadius: 6, padding: 20 }}>
                    <div style={{ background: "#fff", borderRadius: 6, overflow: "hidden", maxWidth: 400, margin: "0 auto" }}>
                      <div style={{ background: "#111", padding: "20px 24px", textAlign: "center" }}>
                        {branding.logoUrl ? <img src={branding.logoUrl} alt={branding.businessName} style={{ maxHeight: 44, maxWidth: 180 }} /> : <div style={{ fontSize: 18, fontWeight: 900, color: "#fff" }}>{branding.businessName || "Studio OS"}</div>}
                      </div>
                      <div style={{ textAlign: "center", padding: "24px 20px 12px", fontSize: 18, fontWeight: 800, color: "#111" }}>{emailForm.headline || "Your headline…"}</div>
                      <div style={{ margin: "0 20px 20px", padding: "14px 16px", background: "#f9fafb", borderLeft: "3px solid #111", borderRadius: 2 }}>
                        <div style={{ fontSize: 12, color: "#333", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{emailForm.message || "Your message…"}</div>
                      </div>
                      <div style={{ padding: "12px 20px", background: "#f5f5f5", textAlign: "center" }}>
                        <div style={{ fontSize: 10, color: "#999" }}>&copy; {new Date().getFullYear()} {branding.businessName || "Studio OS"}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
