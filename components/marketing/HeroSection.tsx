import Image from "next/image";
import Link from "next/link";
import { ArrowRight, LockKeyhole, Play, ShieldCheck } from "lucide-react";
import { Reveal } from "./Reveal";

const projects = [
  { name: "Northview School 2026", meta: "School gallery", progress: "Released" },
  { name: "Harbor View Wedding", meta: "Wedding delivery", progress: "Proofing" },
  { name: "Cityside Sports League", meta: "Team ordering", progress: "Syncing" },
];

const stats = [
  { label: "Orders", value: "128" },
  { label: "Galleries", value: "42" },
  { label: "Downloads", value: "3.8k" },
  { label: "Private Access", value: "PIN" },
];

const badges = [
  "Desktop + Cloud Sync",
  "Parent PIN Access",
  "Print-Ready Orders",
  "AI Background Upsells",
];

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-neutral-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_52%_44%,rgba(139,18,22,0.48),rgba(42,8,10,0.28)_30%,transparent_58%),linear-gradient(118deg,#030303_0%,#120707_48%,#050505_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_28%,rgba(239,68,68,0.18),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(255,255,255,0.08),transparent_26%)]" />
      <div className="hero-glow absolute inset-0 opacity-45" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-white to-transparent" />

      <div className="relative mx-auto grid min-h-[calc(100vh-92px)] max-w-7xl items-center gap-12 px-4 pb-16 pt-16 sm:min-h-[calc(100vh-112px)] sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8 lg:pb-24 lg:pt-24">
        <div className="max-w-3xl">
          <Reveal delay={80} className="marketing-kicker mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-white/70 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            AI-assisted Studio OS Cloud
          </Reveal>

          <Reveal as="h1" delay={170} className="marketing-display max-w-4xl text-white">
            One Platform. Every Photography Workflow.
          </Reveal>

          <Reveal as="p" delay={280} className="marketing-body mt-6 max-w-2xl text-white/70">
            Studio OS Cloud gives photographers premium galleries, client ordering,
            private access, and AI-assisted production tools &mdash; from school
            picture day to weddings, portraits, sports, and events.
          </Reveal>

          <Reveal delay={390} className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="marketing-button premium-button inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-neutral-950 shadow-[0_20px_60px_rgba(255,255,255,0.18)] transition hover:bg-neutral-100"
            >
              Get Early Access
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/preview"
              className="marketing-button premium-button inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 py-3 text-white backdrop-blur transition hover:bg-white/20"
            >
              <Play className="h-4 w-4 fill-white" />
              View Platform Demo
            </Link>
          </Reveal>
        </div>

        <div className="relative mx-auto w-full max-w-3xl lg:max-w-none">
          <div className="marketing-caption drift-badge absolute bottom-36 right-[17rem] z-30 hidden max-w-[190px] rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-white shadow-2xl backdrop-blur xl:block">
            Desktop + Cloud Sync
          </div>
          <div className="marketing-caption drift-badge absolute -right-1 top-16 hidden max-w-[175px] rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-white shadow-2xl backdrop-blur xl:block [animation-delay:1.2s]">
            Parent PIN Access
          </div>
          <div className="marketing-caption drift-badge absolute bottom-20 left-6 z-20 hidden max-w-[180px] rounded-2xl border border-red-300/25 bg-red-500/20 px-4 py-3 text-white shadow-2xl backdrop-blur lg:block [animation-delay:2s]">
            AI Background Upsells
          </div>
          <div className="marketing-caption drift-badge absolute bottom-20 right-[17rem] z-30 hidden max-w-[180px] rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-white shadow-2xl backdrop-blur lg:block [animation-delay:2.8s]">
            Print-Ready Orders
          </div>

          <Reveal delay={260} className="relative rounded-[2rem] border border-white/10 bg-white/[0.06] p-3 shadow-[0_40px_120px_rgba(0,0,0,0.5)] backdrop-blur lg:translate-x-6">
            <div className="rounded-[1.6rem] border border-white/10 bg-neutral-950 p-2">
              <div className="overflow-hidden rounded-[1.25rem] border border-white/10 bg-neutral-900">
                <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.04] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/30" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
                  </div>
                  <div className="marketing-kicker text-white/40">
                    Dashboard
                  </div>
                </div>

                <div className="grid min-h-[430px] gap-4 p-4 md:grid-cols-[190px_1fr]">
                  <aside className="hidden rounded-2xl border border-white/10 bg-black/30 p-4 md:block">
                    <div className="marketing-kicker text-white/40">
                      Studio OS
                    </div>
                    <div className="mt-6 space-y-2">
                      {["Schools", "Projects", "Galleries", "Orders", "Downloads"].map((item) => (
                        <div
                          key={item}
                          className={`marketing-caption rounded-xl px-3 py-2 ${
                            item === "Projects"
                              ? "bg-white text-neutral-950"
                              : "text-white/60"
                          }`}
                        >
                          {item}
                        </div>
                      ))}
                    </div>
                  </aside>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                      {stats.map((stat, index) => (
                        <div
                          key={stat.label}
                          className="dashboard-card-in rounded-2xl border border-white/10 bg-white/[0.06] p-4"
                          style={{ animationDelay: `${120 + index * 80}ms` }}
                        >
                          <div className="marketing-caption text-white/50">{stat.label}</div>
                          <div className="mt-2 text-2xl font-semibold leading-none text-white">
                            {stat.value}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                      <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="marketing-caption font-semibold text-white">
                            Active projects
                          </div>
                          <div className="marketing-caption text-white/50">
                            Cloud-ready galleries and production state
                          </div>
                        </div>
                        <div className="marketing-caption rounded-full bg-red-500 px-3 py-1 font-semibold text-white">
                          Live
                        </div>
                      </div>
                      <div className="space-y-3">
                        {projects.map((project) => (
                          <div
                            key={project.name}
                            className="dashboard-card-in grid gap-3 rounded-xl border border-white/10 bg-black/25 p-3 sm:grid-cols-[1fr_auto]"
                            style={{ animationDelay: `${280 + projects.indexOf(project) * 90}ms` }}
                          >
                            <div>
                              <div className="marketing-caption font-semibold text-white">
                                {project.name}
                              </div>
                              <div className="marketing-caption mt-1 text-white/50">
                                {project.meta}
                              </div>
                            </div>
                            <div className="marketing-caption self-start rounded-full border border-white/10 px-3 py-1 text-white/60">
                              {project.progress}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={520}>
            <div className="float-slow relative -mt-28 ml-auto w-[210px] rounded-[2rem] border border-white/20 bg-neutral-950 p-2 shadow-[0_35px_100px_rgba(0,0,0,0.55)] sm:w-[245px] lg:mr-8">
              <div className="overflow-hidden rounded-[1.55rem] border border-white/10 bg-white text-neutral-950">
              <div className="bg-[linear-gradient(145deg,#111,#3a0b0b)] px-4 py-5 text-white">
                <div className="flex items-center justify-between">
                  <div className="marketing-kicker text-white/60">
                    Gallery
                  </div>
                  <div className="marketing-caption inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-1 font-semibold">
                    <LockKeyhole className="h-3 w-3" />
                    PIN
                  </div>
                </div>
                <div className="marketing-card-title mt-8 text-white">
                  Student Gallery
                  <span className="block text-white/60">Northview School</span>
                </div>
              </div>
              <div className="space-y-3 p-4">
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-neutral-100">
                    <Image
                      src="/phone-gallery-student-1.png"
                      alt="Student portrait gallery preview"
                      fill
                      sizes="120px"
                      className="object-cover object-[50%_24%]"
                    />
                  </div>
                  <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-neutral-100">
                    <Image
                      src="/phone-gallery-student-2.png"
                      alt="Student portrait gallery preview"
                      fill
                      sizes="120px"
                      className="object-cover object-[50%_24%]"
                    />
                  </div>
                </div>
                <div className="rounded-xl border border-neutral-200 p-3">
                  <div className="marketing-caption flex items-center gap-2 font-semibold text-neutral-700">
                    <ShieldCheck className="h-4 w-4 text-red-500" />
                    Private client gallery
                  </div>
                </div>
                <Link
                  href="/parents"
                  className="marketing-button flex items-center justify-center rounded-full bg-neutral-950 px-4 py-3 text-white"
                >
                  Order Photos
                </Link>
              </div>
              </div>
            </div>
          </Reveal>

          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:hidden">
            {badges.map((badge) => (
              <div
                key={badge}
                className="marketing-caption rounded-full border border-white/10 bg-white/[0.07] px-4 py-2 text-center font-semibold text-white/70"
              >
                {badge}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
