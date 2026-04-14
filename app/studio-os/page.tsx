import Link from "next/link";

import { SiteHeader } from "../../components/site-header";
import { StudioPanelShowcase } from "@/components/studio-panel-showcase";
import { VisualSlot } from "@/components/visual-slot";
import { studioFeatureAssets } from "@/lib/studio-os-content";

function QrGrid() {
  const pattern = [
    [1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0],
    [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 0],
    [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0],
    [1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1],
  ];

  return (
    <div
      className="grid gap-1.5"
      style={{ gridTemplateColumns: "repeat(11, minmax(0, 1fr))" }}
    >
      {pattern.flat().map((cell, index) => (
        <div
          key={index}
          className="aspect-square rounded-[2px]"
          style={{
            background: cell ? "#111111" : "rgba(17,17,17,0.08)",
          }}
        />
      ))}
    </div>
  );
}

function QrWorkflowPlaceholder({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="grid h-full grid-cols-[108px_minmax(0,1fr)] gap-4 rounded-[18px] border border-white/10 bg-white/95 p-4 text-neutral-900 shadow-[0_18px_36px_rgba(0,0,0,0.18)]">
      <div className="rounded-2xl bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
        <QrGrid />
      </div>
      <div className="flex flex-col justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
            Workflow capture
          </div>
          <div className="mt-2 text-lg font-semibold tracking-tight text-neutral-950">
            {title}
          </div>
          <p className="mt-2 text-sm leading-6 text-neutral-600">{detail}</p>
        </div>
        <div className="mt-4 inline-flex w-fit rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          Scan confirmed
        </div>
      </div>
    </div>
  );
}

export default function StudioOSPage() {
  const { backdrops, cloud, cloudGallery, composites, excel, scan } = studioFeatureAssets;

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <SiteHeader />

      <main
        className="px-4 py-16 sm:py-24"
        style={{
          background:
            "radial-gradient(ellipse 80% 40% at 50% 0%, rgba(239,68,68,0.06), transparent)",
        }}
      >
        <div className="mx-auto max-w-6xl space-y-10">
          <div className="mx-auto max-w-3xl space-y-5 pb-2 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-red-500">
              ✦ Studio OS · Desktop + Mobile
            </div>
            <h1 className="text-5xl font-black leading-[1.05] tracking-tight text-neutral-950 sm:text-[62px]">
              Run your entire workflow.
              <br />
              <span className="text-red-500">One desktop app.</span>
            </h1>
            <p className="mx-auto max-w-xl text-lg leading-relaxed text-neutral-500">
              Capture faster, stay organized, and prepare every order with
              confidence — all in one connected system built for real
              photographers.
            </p>
            <div className="flex items-center justify-center gap-3 pt-1">
              <Link
                href="/studio-os/download"
                className="inline-flex items-center gap-2 rounded-2xl bg-neutral-950 px-6 py-3 text-sm font-bold text-white shadow-lg transition-colors hover:bg-neutral-800"
              >
                Download App →
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 rounded-2xl border border-neutral-200 px-6 py-3 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
              >
                Create Account
              </Link>
            </div>
          </div>

          <StudioPanelShowcase />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div
              className="relative overflow-hidden rounded-[28px] p-8 md:col-span-2"
              style={{
                background:
                  "linear-gradient(135deg,#0f0f0f 0%,#1a1a1a 100%)",
                minHeight: 330,
              }}
            >
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(circle at 30% 60%, rgba(239,68,68,0.14), transparent 55%)",
                }}
              />

              <div className="relative z-10 flex h-full flex-col justify-between">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/20 px-3 py-1 text-xs font-bold tracking-wide text-red-400">
                    ✦ AI Background Removal · Extra Revenue
                  </div>
                  <h2 className="text-4xl font-black leading-[1.05] tracking-tight text-white sm:text-5xl">
                    Turn backgrounds
                    <br />
                    <span className="text-red-400">into profit.</span>
                  </h2>
                  <p className="max-w-xs text-sm text-neutral-400">
                    Offer clean, professional backdrop upgrades without slowing
                    down your workflow. No green screen required — every upgrade
                    becomes revenue you keep.
                  </p>
                </div>

                {/* Approved screenshot slots stay stable so final exported captures can swap in cleanly. */}
                <div className="relative z-10 mt-8 grid items-end gap-3 lg:grid-cols-[1fr_auto_1fr_1fr_auto]">
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                      Before
                    </div>
                    <VisualSlot
                      src={backdrops.before.src}
                      alt={backdrops.before.alt}
                      label={backdrops.before.label}
                      hint={backdrops.before.hint}
                      dark
                      aspectRatio="4 / 5"
                      className="rounded-2xl border border-white/10 bg-white/5"
                      objectPosition={backdrops.before.objectPosition}
                    />
                  </div>

                  <div className="flex flex-col items-center gap-1.5 pb-10">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500 text-sm font-black text-white shadow-lg shadow-red-500/40">
                      →
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                      Processed
                    </div>
                    <VisualSlot
                      src={backdrops.processed.src}
                      alt={backdrops.processed.alt}
                      label={backdrops.processed.label}
                      hint={backdrops.processed.hint}
                      dark
                      aspectRatio="4 / 5"
                      className="rounded-2xl border border-white/10 bg-white/5"
                      objectPosition={backdrops.processed.objectPosition}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-600">
                      New backdrop
                    </div>
                    <div className="relative">
                      <VisualSlot
                        src={backdrops.live.src}
                        alt={backdrops.live.alt}
                        label={backdrops.live.label}
                        hint={backdrops.live.hint}
                        dark
                        aspectRatio="4 / 5"
                        className="rounded-2xl border border-white/10 bg-white/5"
                        objectPosition={backdrops.live.objectPosition}
                      />
                      <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/20 bg-white/15 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-white">
                        LIVE
                      </div>
                    </div>
                  </div>

                  <div className="pb-4 text-right">
                    <div className="text-5xl font-black leading-none text-white">
                      1
                    </div>
                    <div className="text-xs font-medium text-neutral-400">
                      click
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              className="flex flex-col justify-between rounded-[28px] p-8"
              style={{
                background:
                  "linear-gradient(145deg,#ef4444 0%,#dc2626 100%)",
                minHeight: 330,
              }}
            >
              <div className="space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-red-200">
                  School Day · Sports · Events · Any Shoot
                </div>
                <h2 className="text-3xl font-black leading-tight tracking-tight text-white">
                  Capture without
                  <br />
                  slowing down.
                </h2>
                <p className="text-sm leading-relaxed text-red-100">
                  Keep photo day moving with a fast, structured workflow. Scan
                  before you shoot, confirm who&apos;s in frame, and keep every
                  session organized — no mix-ups, no corrections later.
                </p>
              </div>

              <div className="mt-6 space-y-3">
                <VisualSlot
                  src={scan[0].src}
                  alt={scan[0].alt}
                  label={scan[0].label}
                  hint={scan[0].hint}
                  dark
                  aspectRatio="16 / 9"
                  className="rounded-[22px] border border-white/15 bg-white/10"
                  objectPosition={scan[0].objectPosition}
                  fallback={
                    <QrWorkflowPlaceholder
                      title="Emma Johnson · Grade 4B"
                      detail="Scanner reads the code, confirms the roster record, and keeps the next capture moving."
                    />
                  }
                />

                <VisualSlot
                  src={scan[1].src}
                  alt={scan[1].alt}
                  label={scan[1].label}
                  hint={scan[1].hint}
                  dark
                  fit="contain"
                  aspectRatio="16 / 9"
                  className="rounded-[22px] border border-white/15 bg-white/10"
                  imageClassName="p-3"
                  objectPosition={scan[1].objectPosition}
                  fallback={
                    <QrWorkflowPlaceholder
                      title="Jake Torres · Soccer #7"
                      detail="Use the same workflow for sports, events, graduations, and roster-based jobs outside school day."
                    />
                  }
                />

                <div className="flex flex-wrap justify-center gap-2">
                  {[
                    "School",
                    "Sports day",
                    "Graduation",
                    "Corporate",
                    "Dance recital",
                  ].map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] font-bold text-red-100"
                      style={{ background: "rgba(255,255,255,0.15)" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-neutral-200 bg-neutral-50 p-8 md:col-span-2">
              <div className="grid items-center gap-8 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full bg-neutral-200 px-3 py-1 text-xs font-bold text-neutral-700">
                    ⚡ Class Composites · Print-Ready
                  </div>
                  <h2 className="text-4xl font-black leading-tight tracking-tight text-neutral-950">
                    Professional composites.
                    <br />
                    Done in one click.
                  </h2>
                  <p className="text-sm leading-relaxed text-neutral-500">
                    Stop spending hours building class composites manually.
                    Studio OS builds them for you — AI handles head sizing and
                    alignment, you add your branding, and each composite gets
                    assigned to the right class automatically with its own
                    pricing.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {[
                      "One-click AI build",
                      "AI head sizing + crop",
                      "Fast logo insert",
                      "Full manual control",
                      "Auto-assign by class",
                      "Separate composite pricing",
                    ].map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="relative">
                  <VisualSlot
                    src={composites.src}
                    alt={composites.alt}
                    label={composites.label}
                    hint={composites.hint}
                    fit="contain"
                    aspectRatio="10 / 7"
                    className="rounded-[24px] border border-neutral-200 bg-white shadow-[0_20px_40px_rgba(15,23,42,0.08)]"
                    objectPosition={composites.objectPosition}
                  />
                  <div
                    className="absolute -bottom-2 -right-2 rounded-xl px-3 py-2 text-xs font-black text-white shadow-xl"
                    style={{ background: "#0a0a0a" }}
                  >
                    Print-ready · auto-assigned by class
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-[28px] border border-neutral-200 bg-white p-8">
              <div className="space-y-2">
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl"
                  style={{
                    background: "#f0fdf4",
                    border: "1px solid #bbf7d0",
                  }}
                >
                  📋
                </div>
                <h2 className="text-xl font-black leading-snug tracking-tight text-neutral-950">
                  Roster in.
                  <br />
                  Photo day ready.
                </h2>
                <p className="text-sm leading-relaxed text-neutral-500">
                  Upload your school spreadsheet and Studio OS handles the rest
                  — student IDs, PINs, and QR codes generated automatically.
                  <span className="mt-3 block">
                    No extra software needed. What used to take hours takes
                    minutes.
                  </span>
                </p>
              </div>

              <div className="mt-5">
                <VisualSlot
                  src={excel.src}
                  alt={excel.alt}
                  label={excel.label}
                  hint={excel.hint}
                  fit="contain"
                  aspectRatio="16 / 9"
                  className="rounded-[22px] border border-neutral-200 bg-neutral-50 shadow-[0_18px_32px_rgba(15,23,42,0.06)]"
                  objectPosition={excel.objectPosition}
                />
              </div>
            </div>

            <div className="md:col-span-3 flex justify-center">
              <div className="grid w-full gap-4 md:max-w-[calc(66.666%-0.35rem)] md:grid-cols-2">
                <div className="flex flex-col justify-between rounded-[28px] border border-neutral-200 bg-white p-8">
                  <div className="space-y-2">
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl"
                      style={{
                        background: "#fefce8",
                        border: "1px solid #fef08a",
                      }}
                    >
                      🗂️
                    </div>
                    <h2 className="text-xl font-black leading-snug tracking-tight text-neutral-950">
                      Prepare orders
                      <br />
                      with confidence.
                    </h2>
                    <p className="text-sm leading-relaxed text-neutral-500">
                      Every photo matched to the right student automatically.
                      Review before production — no surprises, no reprints.
                    </p>
                  </div>
                  <div className="mt-5 space-y-2">
                    {[
                      {
                        name: "Emma Johnson",
                        status: "Ready to print",
                        color: "#22c55e",
                        bg: "#f0fdf4",
                        border: "#bbf7d0",
                      },
                      {
                        name: "Leo Martinez",
                        status: "Needs attention",
                        color: "#f59e0b",
                        bg: "#fffbeb",
                        border: "#fde68a",
                      },
                      {
                        name: "Lily Chen",
                        status: "Printed ✓",
                        color: "#3b82f6",
                        bg: "#eff6ff",
                        border: "#bfdbfe",
                      },
                    ].map(({ bg, border, color, name, status }) => (
                      <div
                        key={name}
                        className="flex items-center gap-2.5 rounded-xl px-3 py-2"
                        style={{ background: bg, border: `1px solid ${border}` }}
                      >
                        <div className="flex-1 text-xs font-bold text-neutral-700">
                          {name}
                        </div>
                        <div className="text-[10px] font-bold" style={{ color }}>
                          {status}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div
                  className="flex flex-col justify-between rounded-[28px] p-8"
                  style={{
                    background:
                      "linear-gradient(135deg,#0f0f0f 0%,#1c1c1c 100%)",
                    minHeight: 200,
                  }}
                >
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                      Built for every job
                    </div>
                    <h2 className="text-xl font-black leading-snug tracking-tight text-white">
                      One system.
                      <br />
                      Every shoot type.
                    </h2>
                    <p className="text-sm text-neutral-400">
                      Switch between School and Event mode in one tap. Rosters,
                      QR codes, composites, and cloud delivery all adapt with
                      you.
                    </p>
                  </div>
                  <div className="mt-5 space-y-2">
                    <div
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.1)",
                      }}
                    >
                      <span className="text-base">🏫</span>
                      <div>
                        <div className="text-xs font-bold text-white">
                          School Mode
                        </div>
                        <div className="text-[10px] text-neutral-500">
                          Rosters · Classes · Composites · Parents portal
                        </div>
                      </div>
                    </div>
                    <div
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
                      style={{
                        background: "rgba(239,68,68,0.12)",
                        border: "1px solid rgba(239,68,68,0.25)",
                      }}
                    >
                      <span className="text-base">🎉</span>
                      <div>
                        <div className="text-xs font-bold text-red-300">
                          Event Mode
                        </div>
                        <div className="text-[10px] text-red-500/80">
                          Sports · Grad · Corporate · Dance · Any event
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-neutral-200 bg-white md:col-span-3">
              <div className="grid items-stretch md:grid-cols-2">
                <div
                  className="flex flex-col justify-center space-y-4 p-10"
                  style={{ borderRight: "1px solid #f5f5f5" }}
                >
                  <div className="inline-flex w-fit items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600">
                    ☁️ Studio OS Cloud · Connected
                  </div>
                  <h2 className="text-4xl font-black leading-tight tracking-tight text-neutral-950">
                    Desktop workflow.
                    <br />
                    Online delivery.
                  </h2>
                  <p className="max-w-sm text-sm leading-relaxed text-neutral-500">
                    Your Studio OS desktop connects directly to online galleries,
                    parent ordering, and final delivery. Every job syncs live —
                    parents and clients get their own access link without you
                    lifting a finger.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {[
                      "Live sync",
                      "Album PIN control",
                      "Parents portal",
                      "Client galleries",
                      "Digital orders",
                      "Public or private",
                    ].map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div
                  className="relative flex items-center justify-center overflow-hidden px-8 py-10"
                  style={{
                    background:
                      "linear-gradient(180deg,#ffffff 0%,#f8fafc 100%)",
                  }}
                >
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "radial-gradient(circle at 60% 40%, rgba(59,130,246,0.08), transparent 58%)",
                    }}
                  />

                  <div className="relative z-10 w-full max-w-[760px]">
                    <div className="relative h-[270px] sm:h-[340px] lg:h-[400px]">
                      <div className="absolute bottom-0 left-0 w-[68%] sm:w-[70%]">
                        <VisualSlot
                          src={cloud.src}
                          alt={cloud.alt}
                          label={cloud.label}
                          hint={cloud.hint}
                          fit="contain"
                          aspectRatio="16 / 10"
                          className="rounded-[24px] border border-neutral-200 bg-white shadow-[0_24px_48px_rgba(15,23,42,0.12)]"
                          objectPosition={cloud.objectPosition}
                        />
                      </div>

                      <div className="absolute right-0 top-0 w-[88%] sm:w-[86%]">
                        <VisualSlot
                          src={cloudGallery.src}
                          alt={cloudGallery.alt}
                          label={cloudGallery.label}
                          hint={cloudGallery.hint}
                          fit="contain"
                          aspectRatio="16 / 10"
                          className="rounded-[24px] border border-neutral-200 bg-white shadow-[0_28px_56px_rgba(15,23,42,0.16)]"
                          objectPosition={cloudGallery.objectPosition}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            className="space-y-4 rounded-[28px] p-10 text-center"
            style={{
              background:
                "linear-gradient(135deg,#0f0f0f 0%,#1a1a1a 100%)",
            }}
          >
            <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
              Take control of your workflow
            </div>
            <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
              Stop juggling tools.
              <br />
              Start running your business.
            </h2>
            <p className="text-sm text-neutral-400">
              One connected system for every shoot — from the first capture to
              final delivery.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <Link
                href="/studio-os"
                className="inline-flex items-center gap-2 rounded-2xl bg-red-500 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-red-500/25 transition-colors hover:bg-red-600"
              >
                Start Free Trial →
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-2xl border border-neutral-700 px-6 py-3 text-sm font-semibold text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white"
              >
                See pricing
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
