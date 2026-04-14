"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { VisualSlot } from "@/components/visual-slot";
import type { StudioPanel } from "@/lib/studio-os-content";

type PanelScreenshotModalProps = {
  panel: StudioPanel | null;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
};

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function PanelScreenshotModal({
  panel,
  onClose,
  onPrevious,
  onNext,
}: PanelScreenshotModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!panel) {
      return;
    }

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onPrevious();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        onNext();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable =
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [];

      if (!focusable.length) {
        event.preventDefault();
        closeButtonRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;

      if (previousActiveElementRef.current?.isConnected) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [panel, onClose, onNext, onPrevious]);

  if (!panel) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="absolute inset-0 bg-neutral-950/80 backdrop-blur-[8px]" />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`studio-panel-title-${panel.id}`}
        className="relative z-10 w-full max-w-[1210px] overflow-hidden rounded-[24px] border border-white/10 bg-white shadow-[0_32px_80px_rgba(12,12,12,0.36)]"
        style={{ maxHeight: "92vh" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Close button */}
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white/90 text-neutral-700 transition hover:bg-white hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
          aria-label={`Close ${panel.title} screenshot`}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1.4fr)_360px]" style={{ maxHeight: "92vh" }}>
          {/* Screenshot area */}
          <div className="relative min-w-0 overflow-hidden bg-[linear-gradient(180deg,#111111_0%,#050505_100%)] p-3 sm:p-4">
            <VisualSlot
              src={panel.screenshot}
              alt={panel.alt}
              label={panel.title}
              hint="Panel screenshot"
              dark
              fit="contain"
              aspectRatio="16 / 10"
              sizes="(min-width: 1024px) 55vw, 100vw"
              className="w-full rounded-[18px] border border-white/10 bg-black/30"
              imageClassName="p-0"
            />

            {/* Keyboard arrow hint — overlaid on screenshot bottom */}
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={onPrevious}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/70 transition hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                aria-label={`Previous panel`}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                ← Prev
              </button>
              <span className="text-[10px] font-medium text-white/30">or use keyboard arrows</span>
              <button
                type="button"
                onClick={onNext}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/70 transition hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                aria-label={`Next panel`}
              >
                Next →
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Info panel */}
          <div className="relative z-10 flex min-w-0 flex-col gap-5 overflow-y-auto bg-white p-7 sm:p-8">
            <div className="space-y-4">
              {panel.badge ? (
                <div className="inline-flex rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-600">
                  {panel.badge}
                </div>
              ) : null}

              <div>
                <h3
                  id={`studio-panel-title-${panel.id}`}
                  className="text-3xl font-black tracking-tight text-neutral-950"
                >
                  {panel.title}
                </h3>
                <p className="mt-3 text-[15px] leading-7 text-neutral-600">
                  {panel.description}
                </p>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
                  Key workflow
                </div>
                <ul className="mt-3 space-y-2.5">
                  {panel.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-3 text-sm font-medium text-neutral-700"
                    >
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: panel.accent.color }}
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-auto border-t border-neutral-100 pt-5">
              <div className="flex flex-col gap-3">
                <Link
                  href="/studio-os/download"
                  className="inline-flex w-full items-center justify-center rounded-xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                >
                  Download App
                </Link>

                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
