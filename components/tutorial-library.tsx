"use client";

import { ArrowRight, ChevronLeft, ChevronRight, Clock3, ExternalLink, Play } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  formatTimestamp,
  tutorialThumbnailUrl,
  tutorialWatchUrl,
  type Tutorial,
  type TutorialGroup,
} from "@/lib/tutorials";

type TutorialLibraryProps = {
  groups: TutorialGroup[];
  playlistId: string;
};

function embedUrl(tutorial: Tutorial, startAt: number, autoplay: boolean) {
  const params = new URLSearchParams({
    rel: "0",
    modestbranding: "1",
    color: "white",
  });
  if (startAt > 0) params.set("start", String(startAt));
  if (autoplay) params.set("autoplay", "1");
  return `https://www.youtube-nocookie.com/embed/${tutorial.youtubeId}?${params.toString()}`;
}

export function TutorialLibrary({ groups, playlistId }: TutorialLibraryProps) {
  const tutorials = useMemo(() => groups.flatMap((group) => group.tutorials), [groups]);
  const playable = useMemo(() => tutorials.filter((t) => t.youtubeId), [tutorials]);
  const [activeSlug, setActiveSlug] = useState<string>(playable[0]?.slug ?? tutorials[0]?.slug ?? "");
  const [startAt, setStartAt] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [playerKey, setPlayerKey] = useState(0);
  const playerRef = useRef<HTMLDivElement | null>(null);

  const active = tutorials.find((t) => t.slug === activeSlug) ?? tutorials[0];
  const activeIndex = playable.findIndex((t) => t.slug === active?.slug);
  const previous = activeIndex > 0 ? playable[activeIndex - 1] : undefined;
  const next = activeIndex >= 0 && activeIndex < playable.length - 1 ? playable[activeIndex + 1] : undefined;

  const play = useCallback((tutorial: Tutorial, at = 0) => {
    if (!tutorial.youtubeId) return;
    setActiveSlug(tutorial.slug);
    setStartAt(at);
    setAutoplay(true);
    setPlayerKey((key) => key + 1);
    playerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  if (!active) return null;

  return (
    <div className="grid gap-12">
      <div ref={playerRef} className="scroll-mt-28 sm:scroll-mt-36">
        <div className="overflow-hidden rounded-[1.75rem] border border-neutral-200 bg-neutral-950 shadow-[0_30px_80px_rgba(0,0,0,0.18)]">
          <div className="relative aspect-video w-full bg-black">
            {active.youtubeId ? (
              <iframe
                key={`${active.slug}-${playerKey}`}
                src={embedUrl(active, startAt, autoplay)}
                title={`Studio OS tutorial ${active.number}: ${active.title}`}
                className="absolute inset-0 h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-white/60">
                <p className="marketing-body">This video is being published — check back shortly.</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="marketing-kicker text-red-600">
              Tutorial {active.number} · {active.duration}
            </p>
            <h2 className="marketing-title mt-3">{active.title}</h2>
            <p className="marketing-body mt-4 text-neutral-600">{active.blurb}</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {previous ? (
                <button
                  type="button"
                  onClick={() => play(previous)}
                  className="marketing-caption inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-4 py-2.5 font-medium text-neutral-700 transition hover:bg-neutral-50 hover:text-neutral-950"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {previous.number} · {previous.title}
                </button>
              ) : null}
              {next ? (
                <button
                  type="button"
                  onClick={() => play(next)}
                  className="marketing-caption inline-flex items-center gap-1.5 rounded-full bg-neutral-950 px-4 py-2.5 font-medium text-white transition hover:bg-black"
                >
                  Next: {next.number} · {next.title}
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : null}
              {active.youtubeId ? (
                <a
                  href={tutorialWatchUrl(active)}
                  target="_blank"
                  rel="noreferrer"
                  className="marketing-caption inline-flex items-center gap-1.5 px-2 py-2.5 font-medium text-neutral-600 transition hover:text-neutral-950"
                >
                  Watch on YouTube <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-neutral-200 bg-neutral-50 p-5 sm:p-6">
            <h3 className="marketing-caption text-xs font-semibold uppercase tracking-wider text-neutral-950">
              In this video
            </h3>
            <ol className="mt-3 grid gap-1">
              {active.chapters.map((chapter) => (
                <li key={chapter.at}>
                  <button
                    type="button"
                    onClick={() => play(active, chapter.at)}
                    className="marketing-caption flex w-full items-baseline gap-3 rounded-xl px-2.5 py-1.5 text-left text-neutral-700 transition hover:bg-white hover:text-neutral-950"
                  >
                    <span className="w-9 shrink-0 font-mono text-[0.75rem] tabular-nums text-red-600">
                      {formatTimestamp(chapter.at)}
                    </span>
                    <span>{chapter.label}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <div className="grid gap-12">
        {groups.map((group) => (
          <section key={group.heading} aria-label={group.heading}>
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200 pb-4">
              <div>
                <h2 className="marketing-card-title">{group.heading}</h2>
                <p className="marketing-caption mt-1.5 text-neutral-500">{group.intro}</p>
              </div>
              <p className="marketing-caption text-neutral-400">
                {group.tutorials.length === 1
                  ? "1 video"
                  : `${group.tutorials.length} videos`}
              </p>
            </div>
            <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {group.tutorials.map((tutorial) => {
                const isActive = tutorial.slug === active.slug;
                return (
                  <button
                    key={tutorial.slug}
                    type="button"
                    onClick={() => play(tutorial)}
                    aria-pressed={isActive}
                    disabled={!tutorial.youtubeId}
                    className={`group overflow-hidden rounded-[1.5rem] border bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-[0_18px_45px_rgba(0,0,0,0.08)] disabled:cursor-default disabled:hover:translate-y-0 ${
                      isActive ? "border-red-600 ring-2 ring-red-600/15" : "border-neutral-200"
                    }`}
                  >
                    <div className="relative aspect-video w-full overflow-hidden bg-neutral-900">
                      {tutorial.youtubeId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={tutorialThumbnailUrl(tutorial)}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="h-full w-full bg-[radial-gradient(circle_at_30%_20%,rgba(204,0,0,0.45),transparent_55%),linear-gradient(160deg,#1c1c1f,#0b0b0d)]" />
                      )}
                      <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 font-mono text-[0.7rem] font-semibold text-white backdrop-blur">
                        {tutorial.number}
                      </span>
                      <span className="marketing-caption absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-[0.7rem] font-semibold text-white backdrop-blur">
                        <Clock3 className="h-3 w-3" />
                        {tutorial.duration}
                      </span>
                      {tutorial.youtubeId ? (
                        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-neutral-950 shadow-lg">
                            <Play className="ml-0.5 h-6 w-6 fill-current" />
                          </span>
                        </span>
                      ) : null}
                    </div>
                    <div className="p-5">
                      <h3 className="marketing-card-title text-[1.15rem]">{tutorial.title}</h3>
                      <p className="marketing-caption mt-2 line-clamp-3 text-neutral-600">{tutorial.blurb}</p>
                      <p className="marketing-caption mt-4 inline-flex items-center gap-1.5 font-semibold text-red-700">
                        {tutorial.youtubeId ? "Play" : "Coming soon"}
                        {tutorial.youtubeId ? <ArrowRight className="h-3.5 w-3.5" /> : null}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {playlistId ? (
        <p className="marketing-caption text-neutral-500">
          Prefer YouTube? The whole series is in the{" "}
          <a
            href={`https://www.youtube.com/playlist?list=${playlistId}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-neutral-800 underline decoration-neutral-300 underline-offset-4 transition hover:text-neutral-950"
          >
            Studio OS Tutorials playlist
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}
