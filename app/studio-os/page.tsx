import { SiteHeader } from "../../components/site-header";
import Link from "next/link";

// ── QR Code Visual (CSS art) ─────────────────────────────────────────────────
function QRVisual({ light = false }: { light?: boolean }) {
  const pattern = [
    [1,1,1,1,1,1,1,0,1,0,1],
    [1,0,0,0,0,0,1,0,0,1,0],
    [1,0,1,1,1,0,1,0,1,0,1],
    [1,0,1,1,1,0,1,1,0,1,0],
    [1,0,1,1,1,0,1,0,1,1,1],
    [1,0,0,0,0,0,1,1,0,0,0],
    [1,1,1,1,1,1,1,0,1,0,1],
    [0,1,0,1,0,0,0,1,0,1,0],
    [1,0,1,0,1,1,1,0,1,0,1],
    [0,1,0,1,0,0,1,1,0,1,0],
    [1,1,1,1,1,1,1,0,1,1,1],
  ];
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(11, 1fr)", gap:2, width:88 }}>
      {pattern.flat().map((cell, i) => (
        <div key={i} style={{ width:6, height:6, borderRadius:1,
          background: cell ? (light ? "#fff" : "#171717") : "transparent" }} />
      ))}
    </div>
  );
}

// ── Class Composite Grid ─────────────────────────────────────────────────────
function CollageGrid() {
  const colors = [
    "#fca5a5","#a5b4fc","#6ee7b7","#fde68a","#f9a8d4",
    "#93c5fd","#d9f99d","#fcd34d","#c4b5fd","#86efac",
    "#fb923c","#67e8f9","#a3e635","#f472b6","#34d399",
    "#60a5fa","#fbbf24","#e879f9","#4ade80","#fb7185",
    "#a78bfa","#38bdf8","#facc15","#f87171","#2dd4bf",
    "#818cf8","#fb923c","#84cc16","#f472b6","#22d3ee",
  ];
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:5 }}>
      {colors.map((color, i) => (
        <div key={i} style={{ aspectRatio:"3/4", borderRadius:8, background:color,
          display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ width:12, height:12, borderRadius:"50%", background:"rgba(255,255,255,0.65)" }} />
        </div>
      ))}
    </div>
  );
}

// ── Workflow Step Strip ───────────────────────────────────────────────────────
const workflowSteps = [
  { icon:"📋", label:"Set Up Job",    sub:"School roster or event client" },
  { icon:"📷", label:"Capture",       sub:"QR scan · zero mix-ups" },
  { icon:"🗂️", label:"Sort & Review", sub:"Batch, crop, select" },
  { icon:"✨", label:"AI Edit",       sub:"BG removal + retouch" },
  { icon:"🖼️", label:"Composites",    sub:"Noritsu-ready PDF" },
  { icon:"☁️", label:"Deliver",       sub:"Cloud → clients & parents" },
];

// ── Page ─────────────────────────────────────────────────────────────────────
export default function StudioOSPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <SiteHeader />

      <main
        className="px-4 py-16 sm:py-24"
        style={{ background:"radial-gradient(ellipse 80% 40% at 50% 0%, rgba(239,68,68,0.06), transparent)" }}
      >
        <div className="max-w-6xl mx-auto space-y-10">

          {/* ── Hero ──────────────────────────────────────────────────────── */}
          <div className="text-center space-y-5 max-w-3xl mx-auto pb-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-red-50 border border-red-100 px-4 py-1.5 text-xs font-bold text-red-500 tracking-widest uppercase">
              ✦ Studio OS · Desktop + Mobile
            </div>
            <h1 className="text-5xl sm:text-[62px] font-black tracking-tight text-neutral-950 leading-[1.05]">
              School days. Events.<br />
              <span className="text-red-500">Any shoot.</span>
            </h1>
            <p className="text-lg text-neutral-500 max-w-xl mx-auto leading-relaxed">
              One platform for every job you take. AI tools, smart workflows, and cloud delivery — whether it&apos;s 800 students or a 40-person corporate event.
            </p>
            <div className="flex items-center justify-center gap-3 pt-1">
              <Link href="/preview"
                className="inline-flex items-center gap-2 rounded-2xl bg-neutral-950 px-6 py-3 text-sm font-bold text-white shadow-lg hover:bg-neutral-800 transition-colors">
                See it live →
              </Link>
              <Link href="/pricing"
                className="inline-flex items-center gap-2 rounded-2xl border border-neutral-200 px-6 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors">
                View pricing
              </Link>
            </div>
          </div>

          {/* ── Workflow Strip ─────────────────────────────────────────────── */}
          <div className="rounded-[24px] border border-neutral-200 bg-neutral-50 px-6 py-5 overflow-x-auto">
            <div className="flex items-center justify-between gap-2 min-w-[600px]">
              {workflowSteps.map((step, i) => (
                <div key={step.label} className="flex items-center gap-2 flex-1">
                  <div className="flex flex-col items-center text-center flex-shrink-0">
                    <div className="text-2xl mb-1">{step.icon}</div>
                    <div className="text-xs font-bold text-neutral-800">{step.label}</div>
                    <div className="text-[10px] text-neutral-400 mt-0.5">{step.sub}</div>
                  </div>
                  {i < workflowSteps.length - 1 && (
                    <div className="flex-1 flex items-center gap-0.5 mt-[-18px] mx-1">
                      {Array.from({length:4}).map((_,j) => (
                        <div key={j} className="flex-1 h-px bg-neutral-300" />
                      ))}
                      <div className="text-neutral-300 text-xs flex-shrink-0">›</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Bento Grid ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* ① AI Backdrop Removal — 2-col wide, dark */}
            <div
              className="md:col-span-2 rounded-[28px] p-8 overflow-hidden relative flex flex-col justify-between"
              style={{ background:"linear-gradient(135deg,#0f0f0f 0%,#1a1a1a 100%)", minHeight:330 }}
            >
              <div className="absolute inset-0 pointer-events-none"
                style={{ background:"radial-gradient(circle at 30% 60%, rgba(239,68,68,0.14), transparent 55%)" }} />

              <div className="relative z-10 space-y-2">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 border border-red-500/30 px-3 py-1 text-xs font-bold text-red-400 tracking-wide">
                  ✦ AI Powered · GPU Accelerated
                </div>
                <h2 className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-[1.05]">
                  Swap backdrops.<br />
                  <span className="text-red-400">Live. One click.</span>
                </h2>
                <p className="text-neutral-400 text-sm max-w-xs">
                  AI removes any background instantly. Pick a new backdrop — GPU preview renders on-screen in real time. No flattening, no waiting.
                </p>
              </div>

              {/* Before / After */}
              <div className="relative z-10 flex items-end gap-3 mt-8">
                <div className="flex-1 space-y-1.5">
                  <div className="text-[10px] font-bold text-neutral-600 uppercase tracking-wider">Before</div>
                  <div className="relative rounded-2xl overflow-hidden flex items-end justify-center"
                    style={{ height:118, background:"linear-gradient(135deg,#f97316,#ef4444,#8b5cf6)" }}>
                    <div className="absolute" style={{ top:12, left:"50%", transform:"translateX(-50%)",
                      width:34, height:34, borderRadius:"50%", background:"rgba(210,180,140,0.85)" }} />
                    <div style={{ width:54, height:68, borderRadius:"27px 27px 0 0", background:"rgba(185,155,125,0.85)" }} />
                  </div>
                </div>

                <div className="flex flex-col items-center gap-1.5 pb-10">
                  <div className="w-9 h-9 rounded-full bg-red-500 flex items-center justify-center text-white text-sm font-black shadow-lg shadow-red-500/40">→</div>
                </div>

                <div className="flex-1 space-y-1.5">
                  <div className="text-[10px] font-bold text-neutral-600 uppercase tracking-wider">After</div>
                  <div className="relative rounded-2xl overflow-hidden flex items-end justify-center border border-white/10"
                    style={{ height:118, background:"rgba(255,255,255,0.03)" }}>
                    <div className="absolute inset-0 opacity-20"
                      style={{ backgroundImage:"repeating-conic-gradient(#555 0% 25%,transparent 0% 50%)", backgroundSize:"10px 10px" }} />
                    <div className="absolute z-10" style={{ top:12, left:"50%", transform:"translateX(-50%)",
                      width:34, height:34, borderRadius:"50%", background:"rgba(220,190,155,0.95)" }} />
                    <div className="relative z-10" style={{ width:54, height:68, borderRadius:"27px 27px 0 0", background:"rgba(195,165,135,0.95)" }} />
                    <div className="absolute top-2 right-2 z-20 flex items-center justify-center rounded-full text-white text-xs font-black"
                      style={{ width:22, height:22, background:"#22c55e" }}>✓</div>
                  </div>
                </div>

                <div className="flex-1 space-y-1.5">
                  <div className="text-[10px] font-bold text-neutral-600 uppercase tracking-wider">New backdrop</div>
                  <div className="relative rounded-2xl overflow-hidden flex items-end justify-center"
                    style={{ height:118, background:"linear-gradient(160deg,#1e3a5f,#2563eb)" }}>
                    <div className="absolute" style={{ top:12, left:"50%", transform:"translateX(-50%)",
                      width:34, height:34, borderRadius:"50%", background:"rgba(220,190,155,0.95)" }} />
                    <div style={{ width:54, height:68, borderRadius:"27px 27px 0 0", background:"rgba(195,165,135,0.95)" }} />
                    <div className="absolute top-2 left-2 z-20 flex items-center justify-center rounded-full text-white"
                      style={{ fontSize:8, fontWeight:800, background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.25)", padding:"2px 6px", borderRadius:6 }}>LIVE</div>
                  </div>
                </div>

                <div className="pb-4 text-right flex-shrink-0">
                  <div className="text-5xl font-black text-white leading-none">1</div>
                  <div className="text-xs text-neutral-400 font-medium">click</div>
                </div>
              </div>
            </div>

            {/* ② QR Capture — 1-col, red */}
            <div className="rounded-[28px] flex flex-col justify-between p-8"
              style={{ background:"linear-gradient(145deg,#ef4444 0%,#dc2626 100%)", minHeight:330 }}>
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-red-200 uppercase tracking-widest">School Day · Sports · Events · Any Shoot</div>
                <h2 className="text-3xl font-black text-white tracking-tight leading-tight">
                  Scan.<br />Know.<br />Shoot.
                </h2>
                <p className="text-red-100 text-sm leading-relaxed">
                  Auto-generate a QR code for every student, athlete, or guest. Scan before you shoot — Studio OS confirms exactly who&apos;s in frame.
                </p>
              </div>
              <div className="mt-5 flex flex-col gap-3">
                <div className="flex gap-3 items-end justify-center">
                  <div className="bg-white rounded-2xl p-3 shadow-2xl shadow-red-900/30">
                    <QRVisual />
                    <div className="mt-1.5 text-center font-black text-neutral-700" style={{ fontSize:8, letterSpacing:"0.12em" }}>
                      EMMA JOHNSON · GR 4B
                    </div>
                  </div>
                  <div className="bg-white rounded-2xl p-3 shadow-2xl shadow-red-900/30">
                    <QRVisual />
                    <div className="mt-1.5 text-center font-black text-neutral-700" style={{ fontSize:8, letterSpacing:"0.12em" }}>
                      JAKE TORRES · SOCCER #7
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 justify-center flex-wrap">
                  {["School","Sports day","Graduation","Corporate","Dance recital"].map(tag => (
                    <span key={tag} className="rounded-full px-2 py-0.5 text-[10px] font-bold text-red-100"
                      style={{ background:"rgba(255,255,255,0.15)", border:"1px solid rgba(255,255,255,0.2)" }}>{tag}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* ③ Class Composite Builder — 2-col */}
            <div className="md:col-span-2 rounded-[28px] border border-neutral-200 bg-neutral-50 p-8 overflow-hidden">
              <div className="grid md:grid-cols-2 gap-8 items-center">
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full bg-neutral-200 px-3 py-1 text-xs font-bold text-neutral-700">
                    ⚡ One-Click Composite · Noritsu-Ready
                  </div>
                  <h2 className="text-4xl font-black text-neutral-950 tracking-tight leading-tight">
                    Every class.<br />Print-ready.
                  </h2>
                  <p className="text-neutral-500 text-sm leading-relaxed">
                    Smart layout engine auto-picks columns based on class size. Multiple template families. Exports JPG + PDF at print resolution.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {["Smart columns","Elementary + Graduation templates","School branding","Noritsu PDF export","Manual crop overrides"].map(tag => (
                      <span key={tag} className="rounded-full bg-white border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600">{tag}</span>
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <CollageGrid />
                  <div className="absolute -bottom-2 -right-2 rounded-xl px-3 py-2 text-xs font-black text-white shadow-xl"
                    style={{ background:"#0a0a0a" }}>
                    Class 4B · 30 students ✓
                  </div>
                </div>
              </div>
            </div>

            {/* ④ Roster Import — 1-col */}
            <div className="rounded-[28px] border border-neutral-200 bg-white p-8 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl"
                  style={{ background:"#f0fdf4", border:"1px solid #bbf7d0" }}>📋</div>
                <h2 className="text-xl font-black text-neutral-950 tracking-tight leading-snug">
                  Excel in.<br />QR codes out.
                </h2>
                <p className="text-neutral-500 text-sm leading-relaxed">
                  Import your school roster. Studio OS auto-generates student IDs, 5-digit PINs, and QR codes for every student.
                </p>
              </div>
              <div className="mt-5 space-y-2">
                {[
                  { label:"Johnson, Emma · Gr 4B", pin:"#81428" },
                  { label:"Martinez, Leo · Gr 4B",  pin:"#53901" },
                  { label:"Chen, Lily · Gr 5A",     pin:"#72044" },
                ].map(({ label, pin }) => (
                  <div key={label} className="flex items-center gap-2.5 rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2">
                    <div style={{ width:7, height:7, borderRadius:"50%", background:"#22c55e", flexShrink:0 }} />
                    <div className="text-xs font-semibold text-neutral-700 truncate flex-1">{label}</div>
                    <div className="text-[10px] font-mono font-bold text-neutral-400">{pin}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ⑤ Smart Orders — 1-col */}
            <div className="rounded-[28px] border border-neutral-200 bg-white p-8 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl"
                  style={{ background:"#fefce8", border:"1px solid #fef08a" }}>🗂️</div>
                <h2 className="text-xl font-black text-neutral-950 tracking-tight leading-snug">
                  Orders.<br />Auto-matched.
                </h2>
                <p className="text-neutral-500 text-sm leading-relaxed">
                  Photos matched to orders automatically. Print PDFs ready when you are. Track status from shoot to fulfilment.
                </p>
              </div>
              <div className="mt-5 space-y-2">
                {[
                  { name:"Emma Johnson",  status:"Ready to print", color:"#22c55e", bg:"#f0fdf4", border:"#bbf7d0" },
                  { name:"Leo Martinez",  status:"Needs attention", color:"#f59e0b", bg:"#fffbeb", border:"#fde68a" },
                  { name:"Lily Chen",     status:"Printed ✓",       color:"#3b82f6", bg:"#eff6ff", border:"#bfdbfe" },
                ].map(({ name, status, color, bg, border }) => (
                  <div key={name} className="flex items-center gap-2.5 rounded-xl px-3 py-2"
                    style={{ background:bg, border:`1px solid ${border}` }}>
                    <div className="text-xs font-bold flex-1 text-neutral-700">{name}</div>
                    <div className="text-[10px] font-bold" style={{ color }}>{status}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ⑥ Two Modes — 1-col, dark */}
            <div className="rounded-[28px] p-8 flex flex-col justify-between"
              style={{ background:"linear-gradient(135deg,#0f0f0f 0%,#1c1c1c 100%)", minHeight:200 }}>
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Built for every job</div>
                <h2 className="text-xl font-black text-white tracking-tight leading-snug">
                  School day<br />or any event.
                </h2>
                <p className="text-neutral-400 text-sm">One tap to switch workflow. Everything adapts — roster, QR codes, composites, cloud delivery.</p>
              </div>
              <div className="mt-5 space-y-2">
                <div className="rounded-xl px-3 py-2.5 flex items-center gap-2.5"
                  style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)" }}>
                  <span className="text-base">🏫</span>
                  <div>
                    <div className="text-xs font-bold text-white">School Mode</div>
                    <div className="text-[10px] text-neutral-500">Rosters · Classes · Composites · Parents portal</div>
                  </div>
                </div>
                <div className="rounded-xl px-3 py-2.5 flex items-center gap-2.5"
                  style={{ background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.25)" }}>
                  <span className="text-base">🎉</span>
                  <div>
                    <div className="text-xs font-bold text-red-300">Event Mode</div>
                    <div className="text-[10px] text-red-500/80">Sports · Grad · Corporate · Dance · Any event</div>
                  </div>
                </div>
              </div>
            </div>

            {/* ⑦ Cloud + Parents Portal — full width */}
            <div className="md:col-span-3 rounded-[28px] border border-neutral-200 overflow-hidden bg-white">
              <div className="grid md:grid-cols-2 items-stretch">

                {/* Copy */}
                <div className="p-10 flex flex-col justify-center space-y-4"
                  style={{ borderRight:"1px solid #f5f5f5" }}>
                  <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 border border-blue-100 px-3 py-1 text-xs font-bold text-blue-600 w-fit">
                    ☁️ Studio Cloud · Always in sync
                  </div>
                  <h2 className="text-4xl font-black text-neutral-950 tracking-tight leading-tight">
                    Sync once.<br />Clients access everywhere.
                  </h2>
                  <p className="text-neutral-500 text-sm leading-relaxed max-w-sm">
                    Every job — school or event — syncs live to Studio Cloud. Parents, athletes, families, and corporate clients each get their own access link. No logins to manage.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {["Live sync","Album PIN control","Parents portal","Client galleries","Digital orders","Public or private"].map(tag => (
                      <span key={tag} className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-700">{tag}</span>
                    ))}
                  </div>
                </div>

                {/* Visual */}
                <div className="flex items-center justify-center py-10 px-8 relative overflow-hidden"
                  style={{ background:"#0a0a0a" }}>
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ background:"radial-gradient(circle at 60% 40%, rgba(59,130,246,0.12), transparent 55%)" }} />

                  <div className="relative z-10 w-full max-w-xs space-y-3">
                    {/* Sync status bar */}
                    <div className="rounded-2xl px-4 py-3 flex items-center gap-3"
                      style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)" }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:"#22c55e", flexShrink:0 }} />
                      <div>
                        <div className="text-xs font-bold text-white">Riverside Soccer Day 2025</div>
                        <div className="text-[10px] text-neutral-500 mt-0.5">312 photos synced · Client gallery live</div>
                      </div>
                      <div className="ml-auto text-[10px] font-bold text-green-400">LIVE</div>
                    </div>

                    {/* Album list */}
                    {[
                      { name:"Grade 4 — Class Photos",      status:"Public",       count:"124 photos" },
                      { name:"Riverside Soccer Day 2025",   status:"PIN protected", count:"312 photos" },
                      { name:"Corporate Headshots — ACME",  status:"Private",      count:"48 photos" },
                      { name:"Grad Ceremony — Lincoln High", status:"Public",       count:"540 photos" },
                    ].map(({ name, status, count }) => (
                      <div key={name} className="rounded-xl px-3 py-2.5 flex items-center gap-2.5"
                        style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ width:6, height:6, borderRadius:"50%", flexShrink:0,
                          background: status==="Public" ? "#22c55e" : status==="PIN protected" ? "#f59e0b" : "#6b7280" }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-white truncate">{name}</div>
                          <div className="text-[10px] text-neutral-500">{count}</div>
                        </div>
                        <div className="text-[10px] font-bold text-neutral-500 flex-shrink-0">{status}</div>
                      </div>
                    ))}

                    <div className="text-[10px] text-neutral-600 text-center pt-1">Powered by Supabase</div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* ── CTA ───────────────────────────────────────────────────────── */}
          <div className="rounded-[28px] p-10 text-center space-y-4"
            style={{ background:"linear-gradient(135deg,#0f0f0f 0%,#1a1a1a 100%)" }}>
            <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Ready to level up?</div>
            <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
              Every shoot. One platform.
            </h2>
            <p className="text-neutral-400 text-sm">
              School days, sports days, grad nights, corporate — Studio OS handles it all.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <Link href="/preview"
                className="inline-flex items-center gap-2 rounded-2xl bg-red-500 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-red-500/25 hover:bg-red-600 transition-colors">
                Book a demo →
              </Link>
              <Link href="/pricing"
                className="inline-flex items-center gap-2 rounded-2xl border border-neutral-700 px-6 py-3 text-sm font-semibold text-neutral-300 hover:border-neutral-500 hover:text-white transition-colors">
                See pricing
              </Link>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
