"use client";

import { ArrowUpRight, Cloud, FolderKanban, Image as ImageIcon, LayoutGrid, ReceiptText, ScanQrCode, ShieldCheck, ShoppingBag } from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";

import { PanelScreenshotModal } from "@/components/panel-screenshot-modal";
import { studioPanels, type StudioPanelIcon } from "@/lib/studio-os-content";

const iconMap: Record<
  StudioPanelIcon,
  ComponentType<{ color?: string; size?: number; strokeWidth?: number }>
> = {
  admin: ShieldCheck,
  photographer: ScanQrCode,
  orderForms: ReceiptText,
  sorter: FolderKanban,
  backdrops: ImageIcon,
  composites: LayoutGrid,
  orders: ShoppingBag,
  cloud: Cloud,
};

function joinClasses(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function StudioPanelShowcase() {
  const [activePanelId, setActivePanelId] = useState<string | null>(null);

  const activePanel =
    studioPanels.find((panel) => panel.id === activePanelId) ?? null;
  const activePanelIndex = activePanelId
    ? studioPanels.findIndex((panel) => panel.id === activePanelId)
    : -1;

  function showPanelAt(index: number) {
    const nextIndex = (index + studioPanels.length) % studioPanels.length;
    setActivePanelId(studioPanels[nextIndex]?.id ?? null);
  }

  return (
    <>
      <div className="overflow-x-auto rounded-[24px] border border-neutral-200 bg-neutral-50 px-6 py-5">
        <div className="mb-4 text-center text-[10px] font-bold uppercase tracking-widest text-neutral-400">
          8 panels. One connected app.
        </div>

        <div className="flex min-w-[640px] items-start justify-between gap-1">
          {studioPanels.map((panel, index) => {
            const Icon = iconMap[panel.icon];
            const isActive = panel.id === activePanelId;

            return (
              <div key={panel.id} className="flex flex-1 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActivePanelId(panel.id)}
                  className={joinClasses(
                    "group flex flex-shrink-0 flex-col items-center rounded-[20px] px-2 py-1 text-center outline-none transition duration-200",
                    "hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_10px_24px_rgba(15,23,42,0.08)]",
                    "focus-visible:-translate-y-0.5 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:shadow-[0_10px_24px_rgba(15,23,42,0.08)]",
                    isActive && "bg-white shadow-[0_10px_24px_rgba(15,23,42,0.08)]",
                  )}
                  aria-haspopup="dialog"
                  aria-expanded={isActive}
                  aria-label={`View ${panel.title} panel screenshot`}
                >
                  <span
                    className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl border transition duration-200 group-hover:shadow-sm group-focus-visible:shadow-sm"
                    style={{
                      background: panel.accent.bg,
                      borderColor: panel.accent.border,
                    }}
                  >
                    <Icon
                      size={22}
                      strokeWidth={1.6}
                      color={panel.accent.color}
                    />
                  </span>

                  <span className="text-xs font-bold leading-tight text-neutral-800">
                    {panel.title}
                  </span>
                  <span className="mt-0.5 max-w-[72px] text-[9px] leading-tight text-neutral-400">
                    {panel.subtitle}
                  </span>
                  <span className="mt-1 flex h-[10px] items-center gap-1 text-[9px] font-semibold tracking-wide text-neutral-500 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                    View panel
                    <ArrowUpRight className="h-2.5 w-2.5" />
                  </span>
                </button>

                {index < studioPanels.length - 1 ? (
                  <div className="mx-0.5 mt-[-28px] flex flex-1 items-center">
                    <div
                      className="h-px flex-1"
                      style={{ borderTop: "1.5px dashed #d4d4d4" }}
                    />
                    <div className="flex-shrink-0 text-[10px] text-neutral-300">
                      &#8250;
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <PanelScreenshotModal
        panel={activePanel}
        onClose={() => setActivePanelId(null)}
        onPrevious={() => {
          if (activePanelIndex >= 0) {
            showPanelAt(activePanelIndex - 1);
          }
        }}
        onNext={() => {
          if (activePanelIndex >= 0) {
            showPanelAt(activePanelIndex + 1);
          }
        }}
      />
    </>
  );
}
