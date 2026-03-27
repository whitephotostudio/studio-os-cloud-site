"use client";

import { KeyboardEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, ImagePlus, Settings, ChevronRight, Search } from "lucide-react";

type ProjectRow = {
  id: string;
  title?: string | null;
  client_name?: string | null;
  workflow_type?: string | null;
  status?: string | null;
  portal_status?: string | null;
  shoot_date?: string | null;
  event_date?: string | null;
  cover_photo_url?: string | null;
};

type CollectionRow = {
  id: string;
  project_id?: string | null;
  kind?: string | null;
};

type MediaRow = {
  id: string;
  project_id?: string | null;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function projectNameOf(project: ProjectRow) {
  return clean(project.title) || "Untitled Event";
}

function projectSubtitleOf(project: ProjectRow) {
  return clean(project.client_name) || "Client gallery";
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return "No date set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date set";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusLabel(project: ProjectRow) {
  return clean(project.portal_status) || clean(project.status) || "inactive";
}

function fallbackEventGradient(title: string) {
  const gradients = [
    "linear-gradient(135deg, rgba(17,24,39,0.96) 0%, rgba(185,28,28,0.94) 100%)",
    "linear-gradient(135deg, rgba(15,23,42,0.96) 0%, rgba(8,145,178,0.92) 100%)",
    "linear-gradient(135deg, rgba(6,78,59,0.96) 0%, rgba(17,24,39,0.96) 100%)",
    "linear-gradient(135deg, rgba(30,41,59,0.96) 0%, rgba(194,65,12,0.92) 100%)",
    "linear-gradient(135deg, rgba(30,58,138,0.94) 0%, rgba(15,118,110,0.92) 100%)",
    "linear-gradient(135deg, rgba(55,48,163,0.9) 0%, rgba(127,29,29,0.94) 100%)",
  ];

  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }

  return gradients[Math.abs(hash) % gradients.length];
}

function bgStyle(project: ProjectRow) {
  const cover = clean(project.cover_photo_url);
  if (cover) {
    return {
      backgroundImage: `linear-gradient(180deg, rgba(10,18,42,0.18) 0%, rgba(10,18,42,0.48) 100%), url(${cover})`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    } as const;
  }

  return {
    backgroundImage: fallbackEventGradient(projectNameOf(project)),
  } as const;
}

export default function EventsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [albumCounts, setAlbumCounts] = useState<Record<string, number>>({});
  const [imageCounts, setImageCounts] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const response = await fetch("/api/dashboard/events", {
          method: "GET",
          cache: "no-store",
        });

        const payload = (await response.json()) as {
          ok?: boolean;
          message?: string;
          projects?: ProjectRow[];
          albumCounts?: Record<string, number>;
          imageCounts?: Record<string, number>;
        };

        if (response.status === 401) {
          window.location.href = "/sign-in";
          return;
        }

        if (!response.ok || payload.ok === false) {
          throw new Error(payload.message || "Failed to load events.");
        }

        if (!mounted) return;
        setProjects(payload.projects ?? []);
        setAlbumCounts(payload.albumCounts ?? {});
        setImageCounts(payload.imageCounts ?? {});
        setLoading(false);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load events.");
        setLoading(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return projects;

    return projects.filter((project) => {
      const title = projectNameOf(project).toLowerCase();
      const subtitle = projectSubtitleOf(project).toLowerCase();
      const status = statusLabel(project).toLowerCase();
      return title.includes(q) || subtitle.includes(q) || status.includes(q);
    });
  }, [projects, searchQuery]);

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>, href: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      router.push(href);
    }
  }

  return (
    <div className="min-h-screen bg-[#f3f5f9] px-6 py-6 text-[#13234a] lg:px-10">
      <div className="mx-auto max-w-[1480px]">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <Link href="/dashboard" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-[#667085] transition hover:text-[#13234a]">
              <ArrowLeft size={16} />
              Back to dashboard
            </Link>
            <h1 className="text-5xl font-bold tracking-[-0.04em] text-[#13234a]">Events</h1>
            <p className="mt-4 text-xl text-[#667085]">Weddings, baptisms, engagements, private events, and client galleries.</p>
          </div>

          <Link href="/dashboard/projects/new" className="inline-flex items-center gap-3 rounded-[22px] bg-[#0c1633] px-7 py-5 text-xl font-semibold text-white shadow-sm transition hover:-translate-y-0.5">
            <span className="text-2xl leading-none">+</span>
            New Project
          </Link>
        </div>

        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full max-w-[560px]">
            <Search
              size={18}
              className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[#667085]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search events, client name, or status..."
              className="h-14 w-full rounded-[18px] border border-[#d9dfeb] bg-white pl-12 pr-4 text-[16px] text-[#13234a] outline-none transition focus:border-[#13234a] focus:ring-2 focus:ring-[#13234a]/10"
            />
          </div>
        </div>

        {loading ? (
          <div className="rounded-[28px] border border-[#d9dfeb] bg-white p-10 text-lg text-[#667085]">Loading events…</div>
        ) : error ? (
          <div className="rounded-[28px] border border-[#f0c6c6] bg-[#fff5f5] p-6 text-[#b42318]">{error}</div>
        ) : filteredProjects.length === 0 ? (
          <div className="rounded-[28px] border border-[#d9dfeb] bg-white p-10 text-lg text-[#667085]">No events found.</div>
        ) : (
          <div className="grid gap-7 md:grid-cols-2 xl:grid-cols-3">
            {filteredProjects.map((project) => {
              const href = `/dashboard/projects/${project.id}`;
              const hovered = hoveredProjectId === project.id;
              return (
                <div
                  key={project.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(href)}
                  onKeyDown={(event) => handleCardKeyDown(event, href)}
                  onMouseEnter={() => setHoveredProjectId(project.id)}
                  onMouseLeave={() => setHoveredProjectId((prev) => (prev === project.id ? null : prev))}
                  className="cursor-pointer overflow-hidden rounded-[34px] bg-white shadow-[0_12px_40px_rgba(16,24,40,0.06)] transition"
                  style={{
                    border: hovered ? "2px solid #b91c1c" : "1px solid #d8dfeb",
                    transform: hovered ? "translateY(-1px)" : "translateY(0)",
                  }}
                >
                  <div className="relative min-h-[250px]" style={bgStyle(project)}>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent" />
                    <div className="relative z-20 flex h-full flex-col justify-between px-7 py-7 text-white">
                      <div className="flex items-start justify-between gap-4">
                        <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/16 px-4 py-2 text-sm font-semibold backdrop-blur-sm">
                          <ImagePlus size={15} />
                          EVENT
                        </span>
                        <div className="flex gap-2">
                          <Link
                            href={href}
                            onClick={(e) => e.stopPropagation()}
                            className="relative z-30 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/14 px-4 py-2 text-sm font-semibold backdrop-blur-sm hover:bg-white/22"
                          >
                            <ImagePlus size={15} />
                            Cover
                          </Link>
                          <Link
                            href={`${href}/settings`}
                            onClick={(e) => e.stopPropagation()}
                            className="relative z-30 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/14 px-4 py-2 text-sm font-semibold backdrop-blur-sm hover:bg-white/22"
                          >
                            <Settings size={15} />
                            Settings
                          </Link>
                        </div>
                      </div>

                      <div
                        className="relative z-10 mt-6 block rounded-[24px] p-1 text-white transition hover:opacity-95"
                        aria-label={`Open event ${projectNameOf(project)}`}
                      >
                        <h2 className="text-[3rem] font-bold leading-none tracking-[-0.04em]">{projectNameOf(project)}</h2>
                        <p className="mt-4 text-2xl text-white/92">{projectSubtitleOf(project)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 px-6 pt-6">
                    <div className="rounded-[22px] border border-[#d9dfeb] bg-[#fbfcfe] p-4">
                      <div className="text-sm font-medium text-[#667085]">Albums</div>
                      <div className="mt-3 text-4xl font-bold tracking-[-0.03em] text-[#13234a]">{albumCounts[project.id] ?? 0}</div>
                    </div>
                    <div className="rounded-[22px] border border-[#d9dfeb] bg-[#fbfcfe] p-4">
                      <div className="text-sm font-medium text-[#667085]">Images</div>
                      <div className="mt-3 text-4xl font-bold tracking-[-0.03em] text-[#13234a]">{imageCounts[project.id] ?? 0}</div>
                    </div>
                    <div className="rounded-[22px] border border-[#d9dfeb] bg-[#fbfcfe] p-4">
                      <div className="text-sm font-medium text-[#667085]">Status</div>
                      <div className="mt-3 text-2xl font-bold capitalize tracking-[-0.02em] text-[#13234a]">{statusLabel(project)}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between px-6 py-6">
                    <div className="inline-flex items-center gap-2 text-lg font-medium text-[#667085]">
                      <CalendarDays size={18} />
                      {formatDisplayDate(project.event_date || project.shoot_date)}
                    </div>
                    <div className={`inline-flex items-center gap-2 text-lg font-semibold transition ${hovered ? "text-[#b91c1c]" : "text-[#13234a]"}`}>
                      Open event
                      <ChevronRight size={18} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
