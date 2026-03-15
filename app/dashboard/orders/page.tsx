// app/dashboard/orders/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Check, ChevronDown, LogOut, Printer,
  RefreshCw, School2, Settings, ShoppingBag,
  UserCircle2, Users, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";

type Order = {
  id: string;
  created_at: string;
  status: string;
  seen_by_photographer: boolean;
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
  package_name: string;
  package_price: number;
  special_notes: string | null;
  student: { first_name: string; last_name: string | null; photo_url: string | null } | null;
  school: { school_name: string } | null;
  class: { class_name: string } | null;
};

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  new:           { bg:"#fef2f2", color:"#ef4444", label:"New" },
  reviewed:      { bg:"#fffbeb", color:"#d97706", label:"Reviewed" },
  sent_to_print: { bg:"#eff6ff", color:"#3b82f6", label:"Sent to Print" },
  completed:     { bg:"#f0fdf4", color:"#16a34a", label:"Completed" },
};

const STATUS_FLOW = ["new","reviewed","sent_to_print","completed"];

export default function OrdersPage() {
  const supabase = createClient();
  const [loading, setLoading]       = useState(true);
  const [orders, setOrders]         = useState<Order[]>([]);
  const [filter, setFilter]         = useState<string>("all");
  const [selected, setSelected]     = useState<Order | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [userEmail, setUserEmail]   = useState("");
  const [pgId, setPgId]             = useState<string | null>(null);

  useEffect(() => { load(); }, []); // eslint-disable-line

  // Real-time: subscribe to new orders
  useEffect(() => {
    if (!pgId) return;
    const channel = supabase.channel("orders-realtime")
      .on("postgres_changes", { event:"INSERT", schema:"public", table:"orders", filter:`photographer_id=eq.${pgId}` },
        () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [pgId]); // eslint-disable-line

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setUserEmail(user.email ?? "");

    const { data: pg } = await supabase.from("photographers")
      .select("id").eq("user_id", user.id).maybeSingle();
    if (!pg) { setLoading(false); return; }
    setPgId(pg.id);

    const { data: rows } = await supabase.from("orders")
      .select(`
        id, created_at, status, seen_by_photographer,
        parent_name, parent_email, parent_phone,
        package_name, package_price, special_notes,
        student:students(first_name, last_name, photo_url),
        school:schools(school_name),
        class:classes(class_name)
      `)
      .eq("photographer_id", pg.id)
      .order("created_at", { ascending: false });

    setOrders((rows as any) ?? []);
    setLoading(false);
  }

  async function markSeen(orderId: string) {
    await supabase.from("orders").update({ seen_by_photographer: true }).eq("id", orderId);
  }

  async function updateStatus(orderId: string, newStatus: string) {
    setUpdatingId(orderId);
    await supabase.from("orders").update({ status: newStatus, seen_by_photographer: true }).eq("id", orderId);
    await load();
    if (selected?.id === orderId) setSelected(prev => prev ? { ...prev, status: newStatus, seen_by_photographer: true } : null);
    setUpdatingId(null);
  }

  function openOrder(order: Order) {
    setSelected(order);
    if (!order.seen_by_photographer) markSeen(order.id);
  }

  const filtered = filter === "all" ? orders : orders.filter(o => o.status === filter);
  const newCount = orders.filter(o => !o.seen_by_photographer).length;

  async function handleSignOut() { await supabase.auth.signOut(); window.location.href = "/sign-in"; }

  return (
    <div style={{ display:"flex",minHeight:"100vh",background:"#f0f0f0" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.55}}`}</style>

      {/* SIDEBAR */}
      <aside style={{ width:220,flexShrink:0,background:"#000",display:"flex",flexDirection:"column",position:"sticky",top:0,height:"100vh" }}>
        <div style={{ background:"#fff",padding:"16px 20px" }}><Logo /></div>
        <nav style={{ flex:1,padding:"12px 8px" }}>
          {[
            { label:"Dashboard", href:"/dashboard" },
            { label:"Schools", href:"/dashboard" },
            { label:"Orders", href:"/dashboard/orders", active:true, badge: newCount },
            { label:"Settings", href:"#" },
          ].map((item: any) => (
            <Link key={item.label} href={item.href}
              style={{ display:"flex",alignItems:"center",gap:10,background:item.active?"rgba(255,255,255,0.15)":"transparent",color:item.active?"#fff":"rgba(255,255,255,0.65)",borderRadius:7,padding:"10px 12px",fontSize:13,fontWeight:500,textDecoration:"none",marginBottom:2,position:"relative" }}>
              {item.label}
              {item.badge > 0 && (
                <span style={{ background:"#ef4444",color:"#fff",borderRadius:999,padding:"2px 7px",fontSize:11,fontWeight:700,marginLeft:"auto",animation:"pulse 1.5s infinite" }}>
                  {item.badge}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div style={{ borderTop:"1px solid rgba(255,255,255,0.1)",padding:"8px 8px 16px" }}>
          <button type="button" onClick={handleSignOut}
            style={{ display:"flex",alignItems:"center",gap:10,width:"100%",background:"transparent",border:"none",borderRadius:7,padding:"10px 12px",fontSize:13,color:"rgba(255,255,255,0.5)",cursor:"pointer" }}>
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <div style={{ flex:1,display:"flex",flexDirection:"column",minWidth:0 }}>
        <header style={{ display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fff",borderBottom:"1px solid #e5e5e5",padding:"12px 32px",position:"sticky",top:0,zIndex:10 }}>
          <div style={{ display:"flex",alignItems:"center",gap:8 }}>
            <Link href="/dashboard" style={{ display:"flex",alignItems:"center",gap:5,color:"#888",textDecoration:"none",fontSize:13 }}>
              <ArrowLeft size={14} /> Dashboard
            </Link>
            <span style={{ color:"#ddd" }}>/</span>
            <span style={{ fontSize:13,fontWeight:600,color:"#333" }}>Orders</span>
            {newCount > 0 && (
              <span style={{ background:"#ef4444",color:"#fff",borderRadius:999,padding:"3px 10px",fontSize:12,fontWeight:700,animation:"pulse 1.5s infinite" }}>
                {newCount} new
              </span>
            )}
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:10 }}>
            <button type="button" onClick={load} style={{ background:"none",border:"1px solid #e5e5e5",borderRadius:8,padding:"7px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontSize:12,color:"#666" }}>
              <RefreshCw size={13} /> Refresh
            </button>
            <div style={{ display:"flex",alignItems:"center",gap:8,border:"1px solid #e5e5e5",borderRadius:999,padding:"6px 14px" }}>
              <UserCircle2 size={16} color="#aaa" />
              <span style={{ fontSize:13,color:"#444" }}>{userEmail}</span>
            </div>
          </div>
        </header>

        <main style={{ flex:1,background:"#f0f0f0",padding:"28px 32px",display:"flex",gap:24 }}>
          {/* Orders list */}
          <div style={{ flex:1,minWidth:0 }}>
            {/* Filter tabs */}
            <div style={{ display:"flex",gap:8,marginBottom:20 }}>
              {["all","new","reviewed","sent_to_print","completed"].map(s => {
                const cfg = s === "all" ? { label:"All Orders" } : STATUS_COLORS[s];
                const count = s === "all" ? orders.length : orders.filter(o => o.status === s).length;
                return (
                  <button key={s} type="button" onClick={() => setFilter(s)}
                    style={{ padding:"7px 14px",borderRadius:8,border: filter === s ? "2px solid #000" : "2px solid #e5e5e5",background: filter === s ? "#000" : "#fff",color: filter === s ? "#fff" : "#555",fontSize:12,fontWeight:600,cursor:"pointer" }}>
                    {(cfg as any).label ?? s} ({count})
                  </button>
                );
              })}
            </div>

            {loading && <p style={{ color:"#999",fontSize:13 }}>Loading orders…</p>}

            {!loading && filtered.length === 0 && (
              <div style={{ background:"#fff",border:"2px dashed #ddd",borderRadius:12,padding:"60px 32px",textAlign:"center" }}>
                <ShoppingBag size={40} color="#ccc" style={{ margin:"0 auto 12px" }} />
                <p style={{ fontSize:15,fontWeight:600,color:"#555",margin:0 }}>No orders yet</p>
                <p style={{ fontSize:13,color:"#999",marginTop:6 }}>Orders placed by parents will appear here</p>
              </div>
            )}

            <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
              {filtered.map(order => {
                const cfg = STATUS_COLORS[order.status] ?? STATUS_COLORS.new;
                const isNew = !order.seen_by_photographer;
                return (
                  <div key={order.id} onClick={() => openOrder(order)}
                    style={{ background:"#fff",borderRadius:12,border: isNew ? "2px solid #ef4444" : "1px solid #e5e5e5",padding:"16px 20px",cursor:"pointer",boxShadow: isNew ? "0 0 0 3px rgba(239,68,68,0.1)" : "0 1px 3px rgba(0,0,0,0.06)",display:"flex",alignItems:"center",gap:16,animation: isNew ? "pulse 2s infinite" : "none" }}
                    onMouseEnter={e => (e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,0.1)")}
                    onMouseLeave={e => (e.currentTarget.style.boxShadow= isNew ? "0 0 0 3px rgba(239,68,68,0.1)" : "0 1px 3px rgba(0,0,0,0.06)")}>

                    {/* Student photo */}
                    <div style={{ width:48,height:48,borderRadius:10,overflow:"hidden",flexShrink:0,background:"#f0f0f0" }}>
                      {order.student?.photo_url
                        ? <img src={order.student.photo_url} alt="" style={{ width:"100%",height:"100%",objectFit:"cover" }} />
                        : <div style={{ width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}>👤</div>
                      }
                    </div>

                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:3 }}>
                        <p style={{ fontSize:14,fontWeight:700,color:"#111",margin:0 }}>
                          {order.student?.first_name} {order.student?.last_name}
                        </p>
                        {isNew && <span style={{ background:"#ef4444",color:"#fff",borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:700 }}>NEW</span>}
                      </div>
                      <p style={{ fontSize:12,color:"#888",margin:0 }}>
                        {order.school?.school_name} · {order.class?.class_name} · {order.package_name} — <strong>${Number(order.package_price).toFixed(2)}</strong>
                      </p>
                      {order.parent_name && <p style={{ fontSize:11,color:"#aaa",margin:"2px 0 0" }}>Parent: {order.parent_name}</p>}
                    </div>

                    <div style={{ display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0 }}>
                      <span style={{ background:cfg.bg,color:cfg.color,borderRadius:6,padding:"3px 10px",fontSize:11,fontWeight:700 }}>{cfg.label}</span>
                      <span style={{ fontSize:11,color:"#bbb" }}>{new Date(order.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Order detail panel */}
          {selected && (
            <div style={{ width:340,flexShrink:0,background:"#fff",borderRadius:14,border:"1px solid #e5e5e5",padding:"24px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",position:"sticky",top:80,height:"fit-content",maxHeight:"calc(100vh - 120px)",overflowY:"auto" }}>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
                <h3 style={{ fontSize:16,fontWeight:700,color:"#111",margin:0 }}>Order Details</h3>
                <button type="button" onClick={() => setSelected(null)}
                  style={{ background:"none",border:"none",cursor:"pointer",color:"#aaa",padding:4 }}><X size={16} /></button>
              </div>

              {/* Student photo */}
              {selected.student?.photo_url && (
                <img src={selected.student.photo_url} alt="" style={{ width:"100%",borderRadius:10,marginBottom:16,objectFit:"cover",maxHeight:200 }} />
              )}

              <div style={{ marginBottom:16 }}>
                <p style={{ fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#999",margin:"0 0 4px" }}>Student</p>
                <p style={{ fontSize:15,fontWeight:700,color:"#111",margin:0 }}>{selected.student?.first_name} {selected.student?.last_name}</p>
                <p style={{ fontSize:12,color:"#888",marginTop:3 }}>{selected.school?.school_name} · {selected.class?.class_name}</p>
              </div>

              <div style={{ marginBottom:16 }}>
                <p style={{ fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#999",margin:"0 0 4px" }}>Package</p>
                <p style={{ fontSize:14,fontWeight:700,color:"#111",margin:0 }}>{selected.package_name}</p>
                <p style={{ fontSize:18,fontWeight:800,color:"#111",margin:"4px 0 0" }}>${Number(selected.package_price).toFixed(2)}</p>
              </div>

              {selected.parent_name && (
                <div style={{ marginBottom:12 }}>
                  <p style={{ fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#999",margin:"0 0 4px" }}>Parent</p>
                  <p style={{ fontSize:13,color:"#333",margin:0 }}>{selected.parent_name}</p>
                  {selected.parent_email && <p style={{ fontSize:12,color:"#888",margin:"2px 0 0" }}>{selected.parent_email}</p>}
                  {selected.parent_phone && <p style={{ fontSize:12,color:"#888",margin:"2px 0 0" }}>{selected.parent_phone}</p>}
                </div>
              )}

              {selected.special_notes && (
                <div style={{ background:"#fffbeb",border:"1px solid #fde68a",borderRadius:8,padding:"10px 14px",marginBottom:16 }}>
                  <p style={{ fontSize:11,fontWeight:700,color:"#92400e",margin:"0 0 4px",textTransform:"uppercase",letterSpacing:"0.1em" }}>Special Notes</p>
                  <p style={{ fontSize:13,color:"#78350f",margin:0 }}>{selected.special_notes}</p>
                </div>
              )}

              {/* Status flow buttons */}
              <div style={{ borderTop:"1px solid #f0f0f0",paddingTop:16 }}>
                <p style={{ fontSize:11,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:"#999",margin:"0 0 10px" }}>Update Status</p>
                <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                  {STATUS_FLOW.map((s, idx) => {
                    const cfg = STATUS_COLORS[s];
                    const isCurrent = selected.status === s;
                    const isDone = STATUS_FLOW.indexOf(selected.status) > idx;
                    return (
                      <button key={s} type="button"
                        disabled={isCurrent || updatingId === selected.id}
                        onClick={() => updateStatus(selected.id, s)}
                        style={{ display:"flex",alignItems:"center",gap:10,padding:"11px 14px",borderRadius:9,border: isCurrent ? `2px solid ${cfg.color}` : "2px solid #e5e5e5",background: isCurrent ? cfg.bg : isDone ? "#f9f9f9" : "#fff",cursor: isCurrent ? "default" : "pointer",opacity: updatingId === selected.id ? 0.5 : 1 }}>
                        <div style={{ width:20,height:20,borderRadius:"50%",background: isCurrent || isDone ? cfg.color : "#e5e5e5",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                          {isDone || isCurrent ? <Check size={11} color="#fff" strokeWidth={3} /> : null}
                        </div>
                        <span style={{ fontSize:13,fontWeight:600,color: isCurrent ? cfg.color : isDone ? "#aaa" : "#555" }}>
                          {s === "new" ? "New" : s === "reviewed" ? "Mark Reviewed" : s === "sent_to_print" ? "✓ Send to Print" : "Mark Completed"}
                        </span>
                        {s === "sent_to_print" && !isCurrent && (
                          <Printer size={14} color="#3b82f6" style={{ marginLeft:"auto" }} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
